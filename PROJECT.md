# Freeroam Companion App — Project Reference

This document describes the architecture, key systems, known quirks, and important implementation decisions for the Freeroam Companion App. It is intended as a living reference for future development.

---

## Overview

The app is a companion reader for [Freeroam](https://getfreeroam.com) — an AI-driven interactive story platform. It proxies Freeroam's API through a tRPC server, adds voice narration via ElevenLabs, and provides a mobile-first story reader UI.

**Stack:** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM (MySQL/TiDB) + Vite

---

## Key File Map

| File | Purpose |
|---|---|
| `client/src/components/StoryReader.tsx` | Main story reader — all panel navigation, TTS, auto-advance, polling |
| `client/src/components/StoryMenu.tsx` | Slide-down story menu with page scrubber and bookmarks |
| `client/src/components/VoicePicker.tsx` | Voice assignment modal for characters |
| `client/src/components/CharacterPanel.tsx` | Side panel showing characters in the current world |
| `server/routers.ts` | All tRPC procedures — Freeroam proxy, TTS generation, voice settings |
| `drizzle/schema.ts` | Database schema — users, collections, voice assignments, TTS cache |
| `server/_core/llm.ts` | Manus built-in LLM helper (not used for TTS tags — see Grok below) |

---

## TTS Pipeline

Voice generation happens server-side in the `voice.generateSpeech` procedure (`server/routers.ts`).

### Flow (on cache miss)

1. **Cache check** — look up `(panelId, worldId, characterId)` in `tts_cache`. If `status = 'ready'`, return the cached URL immediately. If `status = 'generating'`, return `{ generating: true, audioUrl: null }` to tell the client to poll.
2. **Placeholder insert** — insert a row with `status = 'generating'` before calling any external APIs. This prevents duplicate generation if the user navigates away and back.
3. **Grok tag inference** — call `https://api.x.ai/v1/responses` with `model: 'grok-4.3'` using `GROK_API_KEY`. Send up to 3 turns (prev + current + next panel text) for context. The LLM returns delivery tags like `[nervous]`, `[whispering]`, `[shouting]` prepended to each line. Only the current panel's tagged text is used.
4. **Accent tag** — if the voice assignment has a `languageCode` set (e.g. `'it'`), prepend `[Italian accent]` to the text.
5. **ElevenLabs TTS** — call `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` with `model_id: 'eleven_v3'` and the tagged text.
6. **S3 upload** — upload the MP3 to S3 via `storagePut`.
7. **Cache update** — update the placeholder row to `status = 'ready'` with the S3 URL.
8. **Cleanup on failure** — if ElevenLabs fails, delete the placeholder row so future requests can retry.

### Client-side TTS flow (`StoryReader.tsx`)

- `triggerTTS(panel)` is called from two places: the panel-change effect (line ~802) and the worldCharacters retry effect (line ~805).
- The panel-change effect **skips** on the very first panel load (`hasNavigatedRef`) — the worldCharacters retry handles the initial panel once character IDs are available.
- All audio playback goes through `playAudioClip(url, panel)` — a single helper that sets `ttsWillPlayRef`, handles `onerror`/`onstalled` for poor connections, and wires `onended` for auto-advance.
- If the server returns `{ generating: true }`, the client polls `voice.checkTtsReady` every 2 seconds (up to 30 seconds) until `status = 'ready'`, then plays the audio inline.

### Important refs

| Ref | Purpose |
|---|---|
| `ttsWillPlayRef` | `true` when `audio.play()` has been called and audio hasn't ended yet. The auto-advance fallback timer checks this to avoid firing while audio is playing. |
| `ttsConfirmedNoVoiceRef` | `true` when TTS confirmed no voice is assigned. Lets the no-voice timer fire at reading speed. |
| `autoAdvancePausedRef` | `true` when auto-advance is paused (action input open, Characters panel open, story menu open). |
| `autoAdvanceEnabledRef` | Mirror of `autoAdvanceEnabled` state — used in async closures to avoid stale state. |

---

## Panel Navigation & Polling

### Panel cache

`panelCache.current` is a `Map<panelId, PanelData>`. Panels are cached on fetch and on embedded `next_panel` data. The cache validity check (`isPanelContentValid`) requires `pc.type` to be a real string — **not** `'[Max Depth]'` (a tRPC serialization truncation marker). Do not check `Array.isArray(pc.images)` — images can be null on some panels.

### Polling state machine

Polling fires when `forward_state === 'generating' && !next_panel_id`. It calls Freeroam's `nextReady` endpoint every 500ms. When ready, it updates the panel cache entry with the resolved `next_panel_id` and `forward_state: 'ready'`, then loads the next panel.

**Critical:** Do **not** auto-poll on `forward_state === 'ready' && !next_panel_id`. This is a Freeroam API quirk on some already-generated panels and causes unwanted auto-advance.

The polling condition exists in **two places** — both must be kept in sync:
1. The polling `useEffect` (line ~991 in `StoryReader.tsx`)
2. The `handleNavigate` embedded fast path (line ~1058)

### `isNavigating` safety reset

If `isNavigating` gets stuck `true` (network failure, etc.), a `useEffect` resets it to `false` after 5 seconds. This prevents the right arrow from disappearing permanently.

---

## Auto-advance

Auto-advance fires via two paths:

1. **Voiced panels** — `audio.onended` in `playAudioClip` schedules `loadPanel(next_panel_id)` after `autoAdvanceMinDelay` seconds.
2. **Unvoiced panels** — `noVoiceTimer` fires at reading speed when `ttsConfirmedNoVoiceRef` is true (no voice assigned) or after the 2× fallback timeout.

Auto-advance is **paused** when any of these are open: action input (Act/Direct/Image), Characters panel, story menu. All use `pauseAutoAdvance()` / `resumeAutoAdvance()`. The pause state is tracked in `autoAdvancePausedRef` (a ref, not state) to avoid stale closures in `audio.onended`.

---

## Freeroam API Quirks

| Quirk | Impact | Mitigation |
|---|---|---|
| `[Max Depth]` strings in nested panel data | tRPC superjson truncates deeply nested objects. `panel_content.images` may appear as `"[Max Depth]"` in raw responses. | `getPanel` manually extracts and flattens all fields. `isPanelContentValid` checks `pc.type` not `pc.images`. |
| `forward_state: 'ready'` with `next_panel_id: null` | Some panels return this state even when already generated. Auto-polling this causes unwanted advance. | Only auto-poll on `forward_state: 'generating'`. |
| `next_panel_id` returned before panel exists | `sendAction` returns `next_panel_id` immediately but the panel may 404 for a few seconds. | Use `nextReady` polling instead of navigating directly to the ID. |
| Character names use hyphens | Freeroam uses `Aerith-Guthrie` internally. Display replaces hyphens with spaces. | `speechBubble.character.replace(/-/g, ' ')` for display. |

---

## Voice Settings

Voice assignments are stored in `character_voices` with these fields:

| Field | Description |
|---|---|
| `characterId` | Freeroam character external_id |
| `voiceId` | ElevenLabs voice ID |
| `stability` | 0.0–1.0 |
| `similarityBoost` | 0.0–1.0 |
| `style` | 0.0–1.0 |
| `languageCode` | ISO 639-1 code for accent tag (e.g. `'it'` → `[Italian accent]`) |

The narrator voice is stored in `app_settings` under the key `narrator_voice_id`.

---

## Grok Integration

The LLM delivery tag inference uses Grok (`grok-4.3`) via `GROK_API_KEY`. The API uses the **Responses API** endpoint (`/v1/responses`), not the Chat Completions endpoint. The response text is at `output[type=message].content[type=output_text].text`.

The Grok call is **non-fatal** — if it fails for any reason, TTS proceeds without tags.

---

## Database Tables

| Table | Purpose |
|---|---|
| `users` | Manus OAuth users |
| `freeroam_users` | Freeroam account identity (stable across cookie expiry) |
| `collections` | User-owned character groups |
| `collection_members` | Characters in a collection |
| `character_extended` | Full backstory/appearance beyond Freeroam's character limits |
| `character_nsfw` | Per-user NSFW flags for characters |
| `character_voices` | ElevenLabs voice assignments per character |
| `tts_cache` | Cached TTS audio URLs. `status` column: `'generating'` or `'ready'` |
| `app_settings` | Key-value store for global settings (narrator voice, auto-play, etc.) |
| `world_collection_members` | World-to-collection membership (local, since Freeroam hides private worlds) |
| `export_jobs` | Background character export job tracking |

---

## Known Issues / Future Work

- **Text to Dialogue API** — ElevenLabs v3 supports a multi-turn dialogue endpoint that could improve delivery continuity. Currently blocked because it returns one combined audio file with no per-turn splitting. Would require ffmpeg or the timestamps endpoint to extract individual clips.
- **Thumbs up/down** — UI exists but not wired to Freeroam's feedback endpoints.
- **Narrator voice picker** — narrator voice is set via a raw voice ID in settings. A proper browse-and-assign dialog (same as character voice picker) would improve UX.
- **Visual countdown bar** — auto-advance has no visual indicator. A thin draining progress bar at the bottom of the panel would help.
