# Freeroam Companion App — Comprehensive Project Reference

This document is the authoritative reference for the Freeroam Companion App. It covers every major feature, component, system, and design decision. It is intended to be read by anyone picking up this codebase for the first time or returning after a break.

---

## Overview

The app is a companion reader and character/world manager for [Freeroam](https://getfreeroam.com) — an AI-driven interactive story platform. It proxies Freeroam's API through a tRPC server, adds voice narration via ElevenLabs, and provides a mobile-first story reader UI that in several ways improves on Freeroam's own app.

**Stack:** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM (MySQL/TiDB) + Vite

**Live domain:** `charcards-cxwov3uv.manus.space`

---

## Key File Map

| File | Purpose |
|---|---|
| `client/src/pages/Home.tsx` | Main application shell — character roster, world browser, all modal wiring |
| `client/src/components/StoryReader.tsx` | Full story reader — panel navigation, TTS, auto-advance, polling, action bar |
| `client/src/components/StoryMenu.tsx` | Slide-down story menu — page scrubber, bookmarks, journal, preferences |
| `client/src/components/VoicePicker.tsx` | Voice assignment modal — browse ElevenLabs voices, set stability/similarity/style/language |
| `client/src/components/CharacterPanel.tsx` | In-reader character panel — view/add/remove characters in the current world |
| `client/src/components/CharacterProfile.tsx` | Full-screen character detail — tabs for About, Appearance, Full Backstory, Full Appearance |
| `client/src/components/CharacterCard.tsx` | Character card in the roster grid |
| `client/src/components/WorldCard.tsx` | World card in the worlds grid |
| `client/src/components/WorldProfile.tsx` | Slide-in world detail panel — Overview, Characters, Related tabs |
| `client/src/components/SettingsModal.tsx` | Freeroam cookie management + bulk character export |
| `client/src/components/CreateCharacterModal.tsx` | Create / edit / duplicate character modal |
| `server/routers.ts` | All tRPC procedures — Freeroam proxy, TTS, voice settings, collections, export |
| `server/db.ts` | Database query helpers |
| `drizzle/schema.ts` | Database schema — all tables and types |

---

## Authentication & Session Management

The app uses **two separate auth layers**:

1. **Manus OAuth** — standard OAuth flow for the app itself. Each visitor can log in with their Manus account. The `ctx.user` object is available in all tRPC procedures.

2. **Freeroam session cookie** — a separate cookie from `getfreeroam.com` that the user pastes into the Settings modal. This cookie is stored in `localStorage` (never in the database) and sent as the `x-freeroam-cookie` request header on every API call. The server uses it to proxy requests to Freeroam's API on behalf of the user.

### Cookie Flow

The server function `getFreeroamCookie(ctx)` checks for the `x-freeroam-cookie` header first, then falls back to the owner's environment cookie (`process.env.cookie`). This means the app owner can pre-configure a default cookie so the app works out of the box, while individual users can override it with their own.

`hasUserCookie(ctx)` returns `true` only when a user-provided cookie is present. Character-loading endpoints gate on this — users without a cookie see an empty roster rather than the owner's characters.

### Identity Persistence

When a user saves their cookie, `verifySession` is called to validate it and retrieve the user's stable `accountId` from Freeroam. This `accountId` is stored alongside the cookie in `localStorage` and sent as `x-freeroam-account-id`. All user data (collections, NSFW flags, world collection memberships) is keyed by `accountId` rather than by username or cookie value, so data persists across cookie expiry and username changes.

The `freeroam_users` table stores a mapping of `accountId → username` for display purposes.

---

## Character Roster (Characters Mode)

The character roster is the default view. It loads characters from Freeroam's library endpoint with cursor-based infinite scroll.

### Filters and Sorting

| Filter | Description |
|---|---|
| ALL / PRIVATE / PUBLIC / UNLISTED | Privacy status filter |
| FAVORITES | Shows only characters the user has favorited on Freeroam |
| Search | Client-side text search across name and backstory |
| Sort | Most Recent / Oldest First |

### Collections

Collections are user-owned groups of characters stored in the local database (`collections` and `collection_members` tables). They are **not** Freeroam collections — they are entirely local. A character can belong to multiple collections. Collections support sub-collections (via `parentId`).

The `CollectionsStrip` component renders a horizontal scrollable strip of collection cards above the character grid. Clicking a collection filters the grid to show only its members.

### NSFW Flags

Each user can mark any character as NSFW. The flag is stored in `character_nsfw` keyed by `(characterId, freeroamAccountId)`. NSFW characters show a blur overlay in the grid; clicking reveals them. The NSFW state is per-user.

### Bulk Actions

Selecting multiple characters activates the `BulkActionBar`, which supports:
- Add to collection
- Remove from collection
- Delete (own characters only)
- Export selected

### Character Profile

Clicking a character opens `CharacterProfile` — a full-screen modal with four tabs:

| Tab | Content |
|---|---|
| About | Backstory (Freeroam-limited), tags, owner, privacy |
| Appearance | Appearance/description field |
| Full Backstory | Unlimited backstory from local DB (`character_extended.backstoryFull`) |
| Full Appearance | Unlimited appearance from local DB (`character_extended.appearanceFull`) |

The profile also shows: favorites toggle, NSFW toggle, add-to-collection popover, export button, duplicate button, edit button, and voice assignment entry via `VoicePicker`.

### Extended Character Content

Freeroam's API enforces character limits on backstory and appearance fields. The app stores the full unlimited versions in `character_extended`. When editing a character, the app:
1. Sends a trimmed version to Freeroam (within their limit)
2. Saves the full version to the local DB

The limit is auto-detected from Freeroam's error response and stored in `backstoryLimit` / `appearanceLimit`.

### Bulk Export

The Settings modal provides a bulk export feature. It calls `/api/export/bulk` (a direct REST endpoint, not tRPC) which starts an async export job tracked in `export_jobs`. The client polls `/api/export/status/:jobId` every 2 seconds. When done, a download link is provided. The job ID is persisted in `localStorage` so the user can resume polling after a page refresh.

---

## World Browser (Worlds Mode)

Switching to Worlds mode loads all of the user's Freeroam worlds via `worlds.listAll`. Worlds support filtering by privacy status, draft status, and text search, plus sorting by Most Recent / Oldest First / Popular.

### World Collections

World collections are Freeroam's own collection system for grouping worlds. The app proxies them via `worldCollections.*` procedures. A key problem: **Freeroam's API hides private worlds from collection responses**. The app solves this by:

1. Storing world-to-collection membership locally in `world_collection_members`
2. When loading a collection, fetching from both the Freeroam API and the local DB
3. Merging the results — private worlds that Freeroam omits are re-added from local storage

The `CollectionsStrip` component (shared with character collections) shows world collections above the world grid.

### World Profile

Clicking a world opens `WorldProfile` — a slide-in panel with three tabs:

| Tab | Content |
|---|---|
| Overview | Cover image, logline, tags, interaction count, owner, add-to-collection |
| Characters | Characters in this world (fetched from Freeroam) |
| Related | Related worlds from Freeroam |

From the World Profile, the user can launch the Story Reader.

---

## Story Reader

The Story Reader (`StoryReader.tsx`) is the most complex component in the app. It is a full-screen overlay that renders Freeroam story panels with voice narration, navigation, and action input.

### Panel Structure

Each panel from Freeroam's `getPanel` API contains:

| Field | Description |
|---|---|
| `panel_id` | Unique panel identifier |
| `panel_content` | Images, speech bubbles, narration text, choice data |
| `forward_state` | `ready` / `generating` / `awaiting_choice` / `awaiting_action` |
| `next_panel_id` | ID of the next panel (may be null if still generating) |
| `prev_panel_id` | ID of the previous panel |
| `is_action` | True if this is an action panel (user just submitted an action) |
| `requires_action` | True if the panel requires user input before advancing |
| `next_panel` | Embedded next panel data (when available) |

### Panel Cache

`panelCache.current` is a `Map<panelId, PanelData>`. Panels are cached on fetch and on embedded `next_panel` data. The cache validity check (`isPanelContentValid`) requires `pc.type` to be a real string — **not** `'[Max Depth]'` (a tRPC serialization truncation marker that appears when nested objects exceed superjson's depth limit). Do not check `Array.isArray(pc.images)` — images can be null on some panels.

**Critical:** Never serve a cached panel with `forward_state=generating` — always delete it and re-fetch to get the current state. Stale `generating` panels cause polling to re-trigger and auto-advance unexpectedly.

### Navigation

Navigation is handled by `handleNavigate('prev' | 'next')`. The embedded next panel fast path checks `panel.next_panel` for instant navigation without a server round-trip. Both paths call `loadPanel(panelId)` which:

1. Checks the panel cache (skips if `forward_state=generating`)
2. Retries up to 10 times with 2s delay (Freeroam sometimes returns panel IDs before panels exist)
3. Falls back to `startDirectPanelPolling` if all retries fail on an action panel

Two invisible tap zones cover the left 25% (back) and right 60% (forward) of the screen, matching Freeroam's tap areas. Visible arrow icons sit at the edges at `z-25`.

### Polling State Machine

Polling fires when `forward_state === 'generating'`, regardless of whether `next_panel_id` is set. Freeroam can return `next_panel_id` while still in `generating` state — the panel exists but isn't ready to fetch yet.

| Condition | Method | Behavior |
|---|---|---|
| `generating` + `is_action=true` OR `next_panel_id=null` | `startPolling` (nextReady loop) | Auto-navigates when ready |
| `generating` + `is_action=false` + `next_panel_id` set | `startDirectPanelPolling` | Retries `getPanel` every 500ms, shows spinner, does NOT auto-navigate |
| `startPolling` resolves + `is_action=false` | Update `canGoForward` only | Arrow appears, user taps to advance |

**Critical rules:**
- Do **not** auto-poll on `forward_state === 'ready'` — Freeroam API quirk that causes unwanted auto-advance
- Do **not** add `isPolling` to the polling effect's dependency array — causes infinite loop
- When polling completes, update the panel cache with the resolved `next_panel_id` and `forward_state: 'ready'`

**Polling condition exists in two places — keep in sync:**
1. The polling `useEffect` (~line 1150 in `StoryReader.tsx`)
2. The `handleNavigate` embedded fast path (~line 1196)

**`startDirectPanelPolling`:** Polls `getPanel` directly every 500ms (up to 60 seconds) with spinner showing. Falls back to this from `loadPanel` when all retries fail on an action panel.

### `isNavigating` Safety Reset

If `isNavigating` gets stuck `true` (network failure, etc.), a `useEffect` resets it to `false` after 5 seconds. This prevents the right arrow from disappearing permanently.

### Action Bar

The action bar sits at the bottom of the reader. It contains:

- **Home** — links to `getfreeroam.com`
- **Chevron-down** — minimizes the action bar (preserves all input buffers)
- **Vertical divider** — visual separator between fixed controls and scrollable pills
- **Pill buttons (scrollable):** Act, Direct, Characters, Image, Share

Each pill mode has its own input buffer. Switching modes preserves the buffer. Only the submitted buffer clears on send. The image mode pre-fills "Change the image to " and positions the cursor at the end.

The input row sits below the pills (closer to the keyboard on mobile). It uses a `textarea` that auto-grows via a `useEffect` tied to the value.

### Choice Panel

When a panel has `panel_content.choice`, the choice panel appears at the bottom of the screen. It contains:
- Question text (centered)
- IDEAS/HIDE toggle (centered, below question text)
- Lettered choice buttons (A, B, C...) — scrollable when many choices
- "Or type your own response..." input

The choice panel uses `display: block` (not `flex flex-col`) to prevent Tailwind's custom `.flex` from squishing button heights. Buttons use Freeroam's exact CSS: `rgba(30,30,30,0.65)` background, `1px solid rgba(255,255,255,0.22)` border, `border-radius: 20px`, `backdrop-filter: blur(12px)`. The outer container uses `linear-gradient(to top, rgba(0,0,0,0.82) 40%, transparent)` with `max-height: 85dvh` and `overflow-y: auto` + `-webkit-overflow-scrolling: touch` for iOS scrolling.

### Auto-advance

Auto-advance fires via two paths:

1. **Voiced panels** — `audio.onended` in `playAudioClip` schedules `loadPanel(next_panel_id)` after `autoAdvanceMinDelay` seconds.
2. **Unvoiced panels** — `noVoiceTimer` fires at reading speed when `ttsConfirmedNoVoiceRef` is true (no voice assigned) or after the 2× fallback timeout.

Auto-advance is **paused** when any of these are open: action input (Act/Direct/Image), Characters panel, story menu. All use `pauseAutoAdvance()` / `resumeAutoAdvance()`. The pause state is tracked in `autoAdvancePausedRef` (a ref, not state) to avoid stale closures in `audio.onended`.

### Important Refs

| Ref | Purpose |
|---|---|
| `ttsWillPlayRef` | `true` when `audio.play()` has been called and audio hasn't ended yet. The auto-advance fallback timer checks this to avoid firing while audio is playing. |
| `ttsConfirmedNoVoiceRef` | `true` when TTS confirmed no voice is assigned. Lets the no-voice timer fire at reading speed. |
| `autoAdvancePausedRef` | `true` when auto-advance is paused (action input open, Characters panel open, story menu open). |
| `autoAdvanceEnabledRef` | Mirror of `autoAdvanceEnabled` state — used in async closures to avoid stale state. |
| `autoAdvanceMinDelayRef` | Mirror of `autoAdvanceMinDelay` state — used in async closures. |

### Story Menu

`StoryMenu.tsx` is a slide-down overlay triggered by tapping the pill handle at the top of the reader. It uses `translateY(-100% → 0)` animation at 0.25s (not `max-height`) for a direct, natural slide-down matching Freeroam's behavior. No backdrop overlay — the reader shows through behind it.

The menu contains:
- **Story tab:** Page scrubber (custom touch-drag slider), bookmarks, chapter list, related worlds
- **Journal tab:** Summary, State, Threads, Preferences sub-tabs
- **Preferences:** Voice on/off, auto-play on/off, auto-advance on/off + delay slider, show choice ideas by default, debug mode toggle

### Debug Mode

A debug overlay is available in preferences (Voice Settings → Debug Mode). When enabled, a small overlay appears in the top bar of the reader showing real-time state: `forward_state`, `next_panel_id`, `isPolling`, `isNavigating`, `canGoForward`, `is_action`, `requires_action`. Essential for diagnosing navigation issues.

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

### Client-side TTS Flow (`StoryReader.tsx`)

- `triggerTTS(panel)` is called from two places: the panel-change effect and the worldCharacters retry effect.
- The panel-change effect **skips** on the very first panel load (`hasNavigatedRef`) — the worldCharacters retry handles the initial panel once character IDs are available.
- All audio playback goes through `playAudioClip(url, panel)` — a single helper that sets `ttsWillPlayRef`, handles `onerror`/`onstalled` for poor connections, and wires `onended` for auto-advance.
- If the server returns `{ generating: true }`, the client polls `voice.checkTtsReady` every 2 seconds (up to 30 seconds) until `status = 'ready'`, then plays the audio inline.

### Voice Picker (`VoicePicker.tsx`)

The VoicePicker is a modal for assigning ElevenLabs voices to characters. It has two tabs:

**Select Voice tab:**
- Fetches the ElevenLabs voice library via `voice.listVoices`
- Displays voices as cards with a play button for preview
- Clicking a voice shows the settings panel (collapsible)
- Settings: Stability (0–1), Similarity Boost (0–1), Style (0–1), Language (dropdown for accent anchoring)
- Test section: preset phrases + custom text input + Test button (calls `voice.testVoice` with current settings)
- Closing the picker stops any playing preview audio

**Clone Voice tab:**
- Placeholder for ElevenLabs voice cloning (not yet implemented)

### Narrator Voice

The narrator voice is stored in `app_settings` under the key `narrator_voice_id`. It is set via a raw voice ID in the preferences panel. A proper browse-and-assign dialog (same as the character voice picker) is a planned improvement.

---

## Grok Integration

The LLM delivery tag inference uses Grok (`grok-4.3`) via `GROK_API_KEY`. The API uses the **Responses API** endpoint (`/v1/responses`), not the Chat Completions endpoint. The response text is at `output[type=message].content[type=output_text].text`.

The Grok call is **non-fatal** — if it fails for any reason, TTS proceeds without tags.

**System prompt summary:** The LLM is told it is an audio director for an AI story reader using ElevenLabs v3. It receives up to 3 dialogue turns (prev + current + next) and must add delivery tags to each turn. ALL CAPS text is treated as shouting/yelling. Multiple tags per turn are allowed (e.g. `[nervous][whispering]`). For neutral delivery, the text is returned unchanged.

---

## Freeroam API Quirks

| Quirk | Impact | Mitigation |
|---|---|---|
| `[Max Depth]` strings in nested panel data | tRPC superjson truncates deeply nested objects. `panel_content.images` may appear as `"[Max Depth]"` in raw responses. | `getPanel` manually extracts and flattens all fields. `isPanelContentValid` checks `pc.type` not `pc.images`. |
| `forward_state: 'ready'` with `next_panel_id: null` | Some panels return this state even when already generated. Auto-polling this causes unwanted advance. | Only auto-poll on `forward_state: 'generating'`. |
| `next_panel_id` returned before panel exists | `sendAction` returns `next_panel_id` immediately but the panel may 404 for a few seconds. | `loadPanel` retries up to 10 times with 2s delay. If all retries fail on an action panel, falls back to `startDirectPanelPolling`. |
| `forward_state: 'generating'` with `next_panel_id` already set | Panel ID is known but the panel isn't ready to fetch yet. Polling must still run. | `shouldPoll = forward_state === 'generating'` (no `!next_panel_id` guard). Non-action panels use `startDirectPanelPolling` to avoid auto-advancing. |
| Private worlds hidden from collection responses | Freeroam's API omits private worlds when listing collection members. | Store membership locally in `world_collection_members`. Merge API response with local DB on collection open. |
| Character names use hyphens | Freeroam uses `Aerith-Guthrie` internally. Display replaces hyphens with spaces. | `speechBubble.character.replace(/-/g, ' ')` for display. |
| Cookie-gated endpoints | Without a valid Freeroam session cookie, all character/world endpoints return 401. | `hasUserCookie()` check gates character loading. Users without a cookie see an empty roster. |

---

## Database Tables

| Table | Purpose |
|---|---|
| `users` | Manus OAuth users |
| `freeroam_users` | Freeroam account identity (stable across cookie expiry) — `accountId → username` mapping |
| `collections` | User-owned character groups. Supports sub-collections via `parentId`. |
| `collection_members` | Characters in a collection — `(collectionId, characterId)` |
| `character_extended` | Full unlimited backstory/appearance beyond Freeroam's character limits |
| `character_nsfw` | Per-user NSFW flags — `(characterId, freeroamAccountId)` |
| `export_jobs` | Background character export job tracking — status, progress, download URL |
| `world_collection_members` | World-to-collection membership (local, since Freeroam hides private worlds) |
| `character_voices` | ElevenLabs voice assignments per character — voiceId, stability, similarityBoost, style, languageCode |
| `tts_cache` | Cached TTS audio URLs. `status` column: `'generating'` or `'ready'`. Keyed by `(panelId, worldId, characterId)`. |
| `app_settings` | Key-value store for global settings (narrator voice, auto-play, auto-advance, etc.) |

---

## Voice Settings Fields

| Field | Description |
|---|---|
| `characterId` | Freeroam character external_id |
| `voiceId` | ElevenLabs voice ID |
| `voiceName` | Human-readable voice name for display |
| `stability` | 0.0–1.0 — higher = more consistent, lower = more expressive |
| `similarityBoost` | 0.0–1.0 — higher = closer to original voice sample |
| `style` | 0.0–1.0 — exaggerates the style of the original voice |
| `languageCode` | ISO 639-1 code for accent tag (e.g. `'it'` → `[Italian accent]` prepended to TTS text) |

The narrator voice is stored in `app_settings` under the key `narrator_voice_id`.

---

## App Settings Keys

| Key | Description |
|---|---|
| `narrator_voice_id` | ElevenLabs voice ID for narration panels |
| `voice_enabled` | `'true'` / `'false'` — global voice on/off |
| `auto_play_enabled` | `'true'` / `'false'` — auto-play audio when panel loads |
| `auto_advance_enabled` | `'true'` / `'false'` — auto-advance to next panel after audio ends |
| `auto_advance_min_delay` | Minimum delay in seconds before auto-advance fires |
| `show_choice_ideas_by_default` | `'true'` / `'false'` — whether the IDEAS panel is open by default on choice panels |
| `debug_mode` | `'true'` / `'false'` — shows the real-time state debug overlay in the reader |

---

## Typography

The app uses the **Outfit** font family throughout, matching Freeroam's typography. Loaded via Google Fonts CDN in `client/index.html`.

| Element | Font |
|---|---|
| "freeroam" logo | Lora, Georgia, serif (intentional — matches Freeroam exactly) |
| Dialogue text | Outfit-SemiBold |
| Narration text | Outfit-Medium italic |
| Page number | Outfit-Medium |
| Action input | Outfit-Regular |
| Pill buttons | Outfit-Medium |
| Story menu UI | Outfit-Medium |

**Story text brightness** — deliberately kept at `rgba(255,255,255,0.85)` rather than full white. Freeroam uses full white which can wash out against bright panel images. Our softer value is intentional.

---

## Layout & Responsive Design

The story reader uses `min(100vw, calc(100dvh * 9/16))` for the center panel width. On mobile (portrait, < ~600px viewport), `100vw` wins and the reader fills the full screen. On desktop, the 9:16 portrait column is used with an ambient blurred backdrop on the sides.

The ambient backdrop uses Freeroam's exact CSS: a blurred, scaled copy of the panel image with a drift animation (`storyAmbientLayer`).

The bottom text clearance is a fixed `112px` — sized to clear the action bar (pill row + safe area) without the text position changing when the input row appears.

---

## Choice Panel Design Notes

The choice panel is `absolute bottom-0` and uses `display: block` (not `flex flex-col`) to prevent Tailwind's custom `.flex` from squishing button heights. Key CSS values from Freeroam's DevTools:

- Outer container: `linear-gradient(to top, rgba(0,0,0,0.82) 40%, transparent)`, `max-height: 85dvh`, `overflow-y: auto`, `-webkit-overflow-scrolling: touch`
- Choice buttons: `rgba(30,30,30,0.65)` background, `1px solid rgba(255,255,255,0.22)` border, `border-radius: 20px`, `backdrop-filter: blur(12px)`
- IDEAS/HIDE: centered on its own line below the question text
- Input placeholder: "Or type your own response..."

---

## Known Issues / Future Work

- **Text to Dialogue API** — ElevenLabs v3 supports a multi-turn dialogue endpoint that could improve delivery continuity. Currently blocked because it returns one combined audio file with no per-turn splitting. Would require ffmpeg or the timestamps endpoint to extract individual clips.
- **Thumbs up/down** — UI exists in the reader rail but not wired to Freeroam's feedback endpoints.
- **Narrator voice picker** — narrator voice is set via a raw voice ID in settings. A proper browse-and-assign dialog (same as character voice picker) would improve UX.
- **Visual countdown bar** — auto-advance has no visual indicator. A thin draining progress bar at the bottom of the panel would help.
- **Debug mode** — a debug overlay is available in preferences (Voice Settings → Debug Mode). Shows `forward_state`, `next_panel_id`, `isPolling`, `isNavigating`, `canGoForward`, `is_action`, `requires_action` in real time. Leave on when investigating navigation issues.
- **Story text brightness** — deliberately kept at `rgba(255,255,255,0.85)` rather than full white. Freeroam uses full white which can wash out against bright panel images. Our softer value is intentional.
- **Choice panel design** — uses `display: block` (not `flex flex-col`) on the outer container to prevent Tailwind's custom `.flex` from squishing button heights.

