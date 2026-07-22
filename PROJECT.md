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
| `client/src/components/CharacterPanel.tsx` | In-reader character panel — view/edit story cast; library multi-select add; collections open as folders (not add-all); headshot backfill after batch add |
| `server/_core/storageProxy.ts` | Serves `/manus-storage/*` — local disk first, then Forge signed redirect when configured |
| `server/nsfwLocalStorage.ts` | Local NSFW image files under `data/nsfw-images/` at `/api/nsfw-images/*` |
| `client/src/components/CharacterProfile.tsx` | Full-screen character detail — tabs for About, Appearance, Full Backstory, Full Appearance |
| `client/src/components/CharacterCard.tsx` | Character card in the roster grid |
| `client/src/components/WorldCard.tsx` | World card in the worlds grid |
| `client/src/components/WorldProfile.tsx` | Slide-in world detail panel — Overview, Characters, Related tabs |
| `client/src/components/SettingsModal.tsx` | Freeroam cookie management + bulk character export |
| `client/src/components/CreateCharacterModal.tsx` | Create / edit / duplicate character modal |
| `server/routers.ts` | All tRPC procedures — Freeroam proxy, TTS, voice settings, collections, export |
| `server/export.ts` | Single-character export helpers + ZIP markdown builders |
| `server/exportJob.ts` | Background bulk-export job runner (ZIP build + storage upload) |
| `server/exportRoute.ts` | REST routes: `/api/export/start`, `/api/export/status/:jobId`, `/api/export/latest` |
| `server/storage.ts` | File storage — Manus Forge S3 when configured; local disk fallback otherwise |
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

The character roster is the default view. It loads characters via `characters.library` — **one** tRPC query that proxies Freeroam's library endpoint:

```
GET https://getfreeroam.com/api/characters/library?page=1&limit=18&filter=
```

### Library load quirk (important)

The request still includes `limit=18` (and `page=1`), but **Freeroam's library API does not actually paginate that way** — the response contains **the user's full character library** in a single payload (all characters with `is_saved`, description, tags, etc.). Treat this as a known Freeroam bug/quirk, not as intentional 18-item paging.

Implications:
- Home and the in-reader CharacterPanel both call `characters.library` once and map the full result client-side.
- Do **not** reintroduce cursor/infinite-scroll loading for this endpoint unless Freeroam changes the API to honor `limit` / pages.
- The server comment in `routers.ts` (`characters.library`) documents this as a single-request full-roster load.

### Filters and Sorting

| Filter | Description |
|---|---|
| ALL / PRIVATE / PUBLIC / UNLISTED | Privacy status filter |
| FAVORITES | Shows only characters the user has favorited on Freeroam (`is_saved === true`) |
| Search | Client-side text search across name and backstory |
| Sort | Most Recent / Oldest First |

### Collections (character collections — local DB)

Character collections are user-owned groups stored in the local database (`collections` and `collection_members` tables). They are **not** Freeroam world collections and are **not** Freeroam's remote character-collection product — they are entirely Companion-local, scoped by Freeroam `accountId`. A character can belong to multiple collections. Collections support sub-collections (via `parentId`).

The `CollectionsStrip` component renders a horizontal scrollable strip of collection cards above the character grid. Clicking a collection filters the grid to show only its members.

These same local character collections are what the in-reader CharacterPanel **Collections** chip uses (open as folder → multi-select members; see [Character Panel](#character-panel-in-reader) below).

### Collection cover images (storage)

Cover uploads go through `collections.uploadCoverImage` → `storagePut`:

- **Forge configured** → file on Manus S3; public path `/manus-storage/{key}` (`storageProxy` tries local disk first, else signed S3 redirect).
- **Forge not configured (typical local/docker)** → file under `data/local-storage/`; public path **`/api/local-storage/{key}`** (same as before the mid-2026 storage URL experiment).

**Migrated Manus DB rows** often still point at `/manus-storage/collection-covers/...`. With Forge, the proxy can still serve them from S3. Without Forge (or missing objects), those covers **404** until re-upload or files exist under `data/local-storage/collection-covers/` (proxy local-first). UI falls back to headshot mosaic / folder icon on load error.

**Note:** A brief experiment returned `/manus-storage/` for local-only `storagePut` too; that was **reverted**. It could not drop MySQL collection rows, but local URL scheme is restored for max compatibility with pre-existing installs.

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

The Settings modal provides a bulk export feature for the full library (single-character export still goes through tRPC `export.single` and returns a base64 ZIP in-process).

**Flow**

1. Client `POST /api/export/start` with the library character array and `x-freeroam-account-id` (not tRPC — large payloads and long jobs).
2. Server inserts a row in `export_jobs` and runs `runExportJob` in the background (`setImmediate`).
3. Job builds a ZIP per character: Freeroam/companion markdown, `character-data.json`, `companion-data.json`, headshots (batched downloads).
4. ZIP is uploaded via `storagePut`, then a download URL is written to the job (`storageGetSignedUrl`).
5. Client polls `/api/export/status/:jobId` every 2 seconds. On modal open, `/api/export/latest` can restore a recent done job or an in-flight one. The job ID is also kept in `localStorage` so polling survives refresh.

**Storage: Manus vs local**

| Environment | How the ZIP is stored | Download URL |
|---|---|---|
| Manus (production) | Manus Forge → S3 via `BUILT_IN_FORGE_API_URL` + `BUILT_IN_FORGE_API_KEY` | Time-limited presigned S3 URL (~24h; job `expiresAt`) |
| Local / Docker (no Forge env) | Files under `data/local-storage/` (gitignored with the rest of `data/`) | Same-origin `/api/local-storage/{key}` served by `registerLocalStorageRoutes` |

If Forge env vars are missing and there is no local fallback, export fails with:

```text
Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY
```

That message comes from `server/storage.ts` (Manus template storage). Local runs do **not** need real Forge keys: `storagePut` / `storageGetSignedUrl` automatically write and serve from disk when those vars are empty. The Settings UI’s **Download Export** link works with either URL shape.

`storagePut` is also used for TTS audio and some image uploads; the same Forge-or-local rule applies there.

---

## World Browser (Worlds Mode)

Switching to Worlds mode loads all of the user's Freeroam worlds via `worlds.listAll` (paginated Freeroam fetch, full roster assembled server-side). Worlds support filtering by privacy status, draft status, and text search, plus sorting by **Most Recent / Oldest First / Popular**.

### World sort (important)

Freeroam's list payload has **no `created_at`**. Sorting still works because Freeroam honors `sort=recent|oldest|popular` on:

```
GET /api/user/{username}/worlds?limit=…&sort=…&cursor=…
```

- **Most Recent / Oldest** — Freeroam order matches sequential numeric `world.id` from the detail endpoint (not the random UUID `external_id`).
- **Popular** — by `interaction_count`.
- **Do not** re-sort the full list by UUID `external_id` (that was tried and scrambles real order).
- `worlds.listAll` **preserves Freeroam's list order** for the requested sort after concatenating pages.

### World Collections

World collections are Freeroam's own collection system for grouping worlds. The app proxies them via `worldCollections.*` procedures. Key quirks:

1. **Freeroam often returns `worlds: []`** on collection detail for private collections even when `world_count > 0`.
2. **Private worlds** are omitted from Freeroam collection payloads in general.
3. App stores membership in local `world_collection_members`, loads IDs via `worldCollections.getMembers`, resolves full cards from the main **`allWorlds` roster**, and merges any API worlds.

**Sort inside a collection:** Freeroam's collection detail does **not** apply the roster sort. The UI orders collection members with `orderWorldsByRoster(members, allWorlds)` so Most Recent / Oldest / Popular match the main archives. When the user changes sort while a collection is open, `fetchAllWorlds` reloads the roster and re-orders open collection members.

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

Invisible tap zones: the left **45%** of the panel advances back; the remainder advances forward (see `StoryReader` hit-zone math). Visible chevron icons sit at the edges for discoverability. Desktop gutters outside the portrait column also navigate.

#### Rapid-tap / back-zone race (fixed)

**Bug:** Rapid taps on the back zone could feel like a **forward** jump (or skip). Causes included:

1. Cached `loadPanel` never set a **sync** nav lock — React `isNavigating` was too slow for double-taps.
2. Target prev/next resolved from **stale** `currentPanel` state instead of `currentPanelIdRef` + `panelCache`.
3. **Auto-advance** could arm immediately after a manual back and undo it.
4. Zone decided from **click** position after layout change, not from **pointerdown**.

**Mitigations in `StoryReader.tsx`:**

| Mechanism | Role |
|---|---|
| `navInFlightRef` | Synchronous lock around every `loadPanel` (including cache hits) and embedded-next path |
| Live panel resolve | `panelCache.get(currentPanelIdRef)` preferred over React `currentPanel` |
| `lastManualNavAtRef` + ~800ms grace | Blocks `scheduleAutoAdvance` right after user prev/next |
| `panelImgPressRef.navDir` | Back vs forward captured on pointerdown; click uses that direction |
| Guarded chevrons/gutters | Ignore clicks while `navInFlightRef` is set |

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

Auto-advance fires via shared `scheduleAutoAdvance(fromPanelId, nextId, delayMs)` (always cancels prior timers first; callbacks no-op if the panel changed or advance is paused):

1. **Voiced panels** — when audio starts, fallbacks are cancelled. `audio.onended` schedules advance after `autoAdvanceMinDelay`. Playback errors re-arm reading-time advance.
2. **Unvoiced panels** — reading-time delay (word count / speed, floored by min delay), or static delay if no text.
3. **Voice maybe** — reading-time check if TTS already confirmed no voice; 2× reading fallback that **waits while `ttsInFlightRef`** (generate/poll) instead of skipping mid-TTS. When TTS confirms no voice, `confirmNoVoiceForPanel` arms reading-time advance.

**Race fixed:** `onended` used to overwrite `autoAdvanceTimerRef` without `clearTimeout` on the 2× fallback, leaking a timer that double-advanced into later (often unvoiced) panels.

Auto-advance is **paused** when any of these are open: action input (Act/Direct/Image), Characters panel, story menu. All use `pauseAutoAdvance()` / `resumeAutoAdvance()`. The pause state is tracked in `autoAdvancePausedRef` (a ref, not state) to avoid stale closures in `audio.onended`.

### Important Refs

| Ref | Purpose |
|---|---|
| `ttsWillPlayRef` | `true` when `audio.play()` has been called and audio hasn't ended yet. Fallbacks skip while this is set. |
| `ttsInFlightRef` | `true` while generateSpeech/poll is running. 2× fallback extends wait instead of advancing early. |
| `ttsConfirmedNoVoiceRef` | `true` when TTS confirmed no audio will play. Arms reading-time advance. |
| `autoAdvancePausedRef` | `true` when auto-advance is paused (action input open, Characters panel open, story menu open). |
| `autoAdvanceEnabledRef` | Mirror of `autoAdvanceEnabled` state — used in async closures to avoid stale state. |
| `autoAdvanceMinDelayRef` | Mirror of `autoAdvanceMinDelay` state — used in async closures. |
| `navInFlightRef` | Sync navigation lock (rapid tap). |
| `lastManualNavAtRef` | Timestamp of last user prev/next; blocks auto-advance for ~800ms. |
| `currentPanelIdRef` | Live panel id for nav targets and NSFW paint guards. |
| `nsfwByPanelIdRef` / `nsfwByArtKeyRef` | Session NSFW URL maps (panel + prompt/URL art keys). |
| `nsfwCharRefsByArtKeyRef` | Borrowed cast for same Freeroam art across panels. |
| `lastFreeroamArtRef` | Last Freeroam art identity — avoid clearing NSFW on same-art nav. |
| `ambientUrlRef` | Last decoded ambient backdrop URL (sticky frame). |

### Story Menu

`StoryMenu.tsx` is a slide-down overlay triggered by tapping the pill handle at the top of the reader. It uses `translateY(-100% → 0)` animation at 0.25s (not `max-height`) for a direct, natural slide-down matching Freeroam's behavior. Frosted full-viewport glass is a separate layer so `backdrop-filter` still samples the story art.

The menu contains:
- **Story tab:** Page scrubber (custom touch-drag slider), bookmarks, chapter list, related worlds
- **Journal tab:** Summary, State, Threads, Preferences sub-tabs
- **Preferences:** Voice on/off, auto-play on/off, auto-advance on/off + delay slider, show choice ideas by default, debug mode toggle

#### Page number input (scrubber)

Controlled page field allows **empty string while typing** so the user can clear and retype (e.g. change `25` → `15`). Do **not** clamp with `Math.max(1, …)` on every keystroke — that blocks erasing the first digit. Clamp / restore on **blur** and on **Go** / Enter. Scrubber thumb uses a resolved numeric value when the field is empty.

### Debug Mode

A debug overlay is available in preferences (Voice Settings → Debug Mode). When enabled, a small overlay appears in the top bar of the reader showing real-time state: `forward_state`, `next_panel_id`, `isPolling`, `isNavigating`, `canGoForward`, `is_action`, `requires_action`. Essential for diagnosing navigation issues.

### Character Panel (in-reader)

`CharacterPanel.tsx` is the full-screen overlay opened from the reader's **Characters** pill. It has four views:

| View | Purpose |
|---|---|
| Main | Current story cast — headshots, Play as, remove/restore, pending add/remove borders |
| Library | Multi-select from Freeroam library / collection folders → **Add N to story** |
| Detail | Optional character detail (info button) → single **Add to Story** |
| Story detail | Edit in-story character personality/appearance/photo |

Changes are **pending** until the user taps **Save Changes**, which calls StoryReader's `onSaveChanges` / `onPlayAs` / `onEditCharacter` (Freeroam `batch_character_update` via `sendAction`).

#### Library chips

There is **no "Yours" chip** — the library already shows the signed-in user's characters only.

| Chip | Behavior |
|---|---|
| **All** | Full library from `characters.library` (see library load quirk above) |
| **Favorites** | `is_saved === true` (Freeroam favorites) |
| **Collections** | User's **local Companion character collections** from `collections.list` (`characterIds`) — **not** Freeroam world collections |

Search is client-side: character name under All/Favorites; collection name under Collections; member name when a collection is open.

#### Multi-select add (All / Favorites / open collection)

- **Tap card** → toggle selection (checkbox at **top-right of the card**, not on the avatar).
- Characters already in the story show **in story** and are not selectable.
- Toolbar: **Select all** / **Clear**; footer **Add N to story** when selection > 0.
- Small **info** button (top-left of card) opens Detail without leaving multi-select.
- Selection clears on filter change, leave folder, leave library, panel close, or successful multi-add.

#### Collections flow (folder model — not add-all)

1. **Collections** chip lists local collections (cover, mosaic, or folder; member count; chevron “open folder”).
2. Tapping a collection opens it as a **folder of members** (same multi-select grid as All/Favorites).
3. **No “Add all”** on the list row or collection footer (removed by product decision).
4. Empty collection → toast; does not open.
5. Library is loaded when opening a collection so members resolve to names/headshots when possible.

#### Headshots missing after batch / cast add (fixed)

Freeroam's panel cast API (`worlds.getPanelCharacters`) often returns **newly batch-added** story characters **without** `headshot_url` for a while. Mitigations in CharacterPanel:

1. **Session headshot cache** — remember + prefetch on add from library.
2. On cast load: backfill from cache → library → background `characters.get`.
3. **`StoryCharHeadshot`** — letter placeholder until image loads; fallback between `display_headshot_url` and `headshot_url`; handle browser-cached images that skip `onLoad`.

Opening the panel or library resets filter/search/selected collection/selection; auto-advance is paused while the panel is open.

---

## TTS Pipeline

Voice generation happens server-side in the `voice.generateSpeech` procedure (`server/routers.ts`).

### Flow (on cache miss)

1. **Cache check** — look up `(panelId, worldId, characterId)` in `tts_cache` (unique index). If `status = 'ready'` with a non-empty URL, return it. If `status = 'generating'` and the row is fresh (under 3 min), return `{ generating: true }` for client poll. Stale `generating` rows or empty URLs are deleted and regeneration proceeds. Spoken dialogue without `characterId` is rejected (no `__narrator__` fallback).
2. **Placeholder insert** — insert a row with `status = 'generating'` before calling any external APIs. This prevents duplicate generation if the user navigates away and back.
3. **Grok tag inference** — call `https://api.x.ai/v1/responses` with `model: 'grok-4.3'` using `GROK_API_KEY`. Send up to 3 turns (prev + current + next panel text) for context. The LLM returns delivery tags like `[nervous]`, `[whispering]`, `[shouting]` prepended to each line. Only the current panel's tagged text is used.
4. **Accent tag** — if the voice assignment has a `languageCode` set (e.g. `'it'`), prepend `[Italian accent]` to the text.
5. **ElevenLabs TTS** — call `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` with `model_id: 'eleven_v3'` and the tagged text.
6. **Storage upload** — upload the MP3 via `storagePut` (Manus Forge S3 when configured; `data/local-storage/` + `/api/local-storage/...` when not — see [Bulk Export](#bulk-export)).
7. **Cache update** — update the placeholder row to `status = 'ready'` with the storage URL.
8. **Cleanup on failure** — if ElevenLabs fails, delete the placeholder row so future requests can retry.

### Client-side TTS Flow (`StoryReader.tsx`)

- `triggerTTS(panel)` is called from the panel-change effect, plus retry effects when `worldCharacters` or `narratorVoiceId` first become available.
- Voice assignments are cached by character **name**, but each entry stores the Freeroam **`characterId`**. Spoken TTS always sends that id — never falls back to `__narrator__` (which caused false cache misses and re-generation).
- If the character id is not resolvable yet, TTS no-ops and waits for the character-list retry instead of generating under the wrong key.
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
| Library `?limit=18` returns the full library | Companion calls `GET /api/characters/library?page=1&limit=18&filter=`, but Freeroam **ignores/mishandles the limit** and returns **all** library characters (with `is_saved`, tags, etc.) in one response. | Documented intentional reliance. `characters.library` is a single full-roster load for Home and CharacterPanel. Do not assume true 18-item pagination. |

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
| `tts_cache` | Cached TTS audio URLs. `status`: `'generating'` or `'ready'`. Unique on `(panelId, worldId, characterId)`. |
| `app_settings` | Key-value store for global settings (narrator voice, auto-play, auto-advance, etc.) |
| `image_cache` | Cached NSFW image replacements. `status`: `'generating'` or `'ready'`. Keyed by `panelId`; also indexed by `freeroamImageUrl` for cross-panel reuse. |

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
| `unrestricted_images` | `'true'` / `'false'` — enables NSFW image replacement pipeline |

---

## NSFW Image Replacement Pipeline

When **Unrestricted Images** is enabled (Preferences → Images), the app replaces Freeroam's censored panel images with AI-generated explicit ones using a three-stage pipeline.

### Pipeline Stages

1. **DeepSeek V4 Flash classification + art style detection** — `deepseek-ai/deepseek-v4-flash` via Atlas Cloud (`https://api.atlascloud.ai/v1/chat/completions`) with `ATLAS_CLOUD_API_KEY`. Receives: (1) Freeroam image prompt, (2) optional user action / image instruction, (3) story text from previous + current + next panels (narration/dialogue). Returns: `isNsfw` (bool) and `artStyle`. Does **not** use vision on the panel image or Freeroam's `is_nsfw` flag. Classifier is **inclusive**: erotic tension, pinning, grinding, arousal, lustful dialogue, pre-sex initiation, **climax euphemisms** ("every last drop", "give you everything", body shaking face-to-face), and intimate framing count as NSFW even without clinical anatomy words; mild image prompts do not override erotic story context. When unsure, prefer `true`. If `isNsfw` is not explicitly `true`, the pipeline exits — no Seedream.

2. **DeepSeek V4 Flash prompt enhancement** — second DeepSeek call. Receives action text plus prev/current/next story text. Writes an image-edit prompt. **Cast** from `character_references` (who is in the image): sex labels derived from each ref’s appearance (woman / man / futanari woman / person) — **never invent a male partner** for woman/futa pairs; no forced hetero pairing. Solo = one person. **Clothing:** in sexual scenes, force nude (refs are often clothed full-body); otherwise only if story/Freeroam prompt states outfit. **Position/setting:** prefer story + Freeroam framing; if sexual and pose/place is unclear, **assume on a bed, lying down** — never default intimacy to standing (refs are often upright portraits). Headshot refs capped to cast size (max 2).

3. **Seedream image generation** — model id and poll/stale budgets live in `server/nsfwImageCache.ts` (`SEEDREAM_EDIT_MODEL`, currently `bytedance/seedream-v5.0-pro/edit`) via Atlas Cloud (`https://api.atlascloud.ai/api/v1/model/generateImage`). Receives the enhanced prompt plus character **reference images** from `headshot_url` (up to 2). Note: Freeroam “headshots” may be **face or full-body** art. Output size: **1600×2400** (2:3 portrait). We do **not** pass Freeroam panel images as Seedream refs (only `headshot_url`). Classify may return an `artStyle` phrase, but we **do not** prepend it when reference images exist — Seedream should take style/species from the refs. A global tag like `[anime furry…]` can incorrectly furry-ize non-furry cast. Art-style prepend is only a fallback if there are **zero** reference images.

### Caching and Cross-Panel Reuse

Results are cached in the `image_cache` table. The cache stores `panelId`, `freeroamImageUrl`, and `freeroamImagePrompt`. Freeroam often advances the story while keeping the **same art**; we only generate a new NSFW replacement when the Freeroam **image prompt** (or source image URL) changes.

Cache lookup order in `checkImageReady` / `generateNsfwImage`:
1. Exact `panelId` match
2. `freeroamImageUrl` match (same source file)
3. `freeroamImagePrompt` match (same art / prompt across panels)

Client also keeps **sticky session maps** for NSFW URLs keyed by `panelId` and Freeroam art keys (**both** image prompt and image URL, not prompt alone). Same-art panels restore without re-running Seedream when possible.

The `generateNsfwImage` procedure also checks the cache in the same order before starting generation. A `'classifying'` claim row is inserted before any API calls (promoted to `'generating'` only after DeepSeek confirms NSFW) to prevent duplicate generation if the user navigates away and back.

### Flash Prevention (main panel + ambient)

**Goal:** Avoid a visible **NSFW → Freeroam → NSFW** (or ambient black/flicker) hop when Unrestricted Images is on.

#### Main panel image (`nsfwImageUrl`)

Lives in the panel-change effect in `StoryReader.tsx`:

- Prefer **session hit** (panel id or same Freeroam art key) and apply NSFW immediately — no intermediate `null`.
- **Only clear** `nsfwImageUrl` when Freeroam **art identity actually changed** (prompt and/or source URL differ from the previous panel). Same-art story stretches keep the sticky NSFW replacement.
- On art change (or first visit without a session hit), async `checkImageReady` may still restore a cached replacement for the new art; until then Freeroam art shows for the **main** portrait (correct for a new scene).

#### Ambient backdrop (blurred sides)

The desktop ambient layer is a **single** blurred `backgroundImage` of the current panel art (Freeroam-style `storyAmbientLayer` + drift animation). It is **not** a dual-layer crossfade.

Mitigations in place:

- Hold the **last fully decoded** ambient URL; do **not** clear ambient when `imageUrl` is briefly `null` mid-restore.
- Compare images by **path base** (strip `?v=` cache-bust) so regenerate query params do not thrash ambient.
- Only switch ambient after the next image has **preloaded** (`Image.onload`); until then keep the previous frame.

#### Known remaining flash (local / Unrestricted on)

Even with the above, **some ambient flash can still occur** when Unrestricted Images is enabled:

1. **Hard URL swap** — one ambient layer; browser re-paints `backgroundImage` + expensive `blur(44px)` / scale / drift when the stable URL finally changes.
2. **True art changes** — main panel switches to new Freeroam (or new NSFW); ambient follows after preload (one intentional cut, not a double hop).
3. **CDN vs local NSFW URL** — Freeroam CDN vs `/api/nsfw-images/...` (or `/manus-storage/...`) are different bases even for “the same” scene after first generation; that forces an ambient update.
4. **Dev vs deploy** — local hosting (Vite, local disk NSFW files, no Forge) often makes reloads and blur recomposites more visible. **Production** (stable CDN/Forge URLs, warmer browser cache, less Strict Mode churn) may be milder, but this is **not guaranteed** until verified on the deployment host.

**Not yet implemented (if flash remains unacceptable):** dual ambient layers with a short opacity crossfade; or keep ambient on Freeroam-only art identity and never point ambient at `/api/nsfw-images` (trade-off: ambient may not match explicit main art).

### Action Text Handling

- The user's action text comes from `panel_content.action` on the current panel, or from the previous panel's action (result panels follow action panels).
- The prefix `'Change the image to '` is stripped before sending to DeepSeek — it is a UI instruction, not an image description.
- If no action text is available, DeepSeek uses the scene context alone.

### When NSFW generation runs

Triggered client-side in `StoryReader` when **all** of:

1. **Unrestricted Images** is enabled  
2. Current panel has `images[0].prompt`  
3. No session hit for this panel / art key, and no `ready` / `skipped` cache for this panel, freeroam image URL, or freeroam image prompt  
4. Panel not already processed this session  
5. **Non-empty `character_references`** after resolve (this panel **or** borrowed from a cached panel / session art map with the same freeroam image URL/prompt). **No refs → no classify/Seedream** (keep Freeroam art). Prevents mid-stretch generates with empty cast/headshots.

**Reuse (no new Seedream):** same Freeroam **image prompt** or **image URL** as a previous `ready` generation (server cache + client sticky maps). Story can advance across many panels with the **same** Freeroam art — we keep the same NSFW replacement until Freeroam’s image prompt/URL changes.

**Important Freeroam quirk:** `character_references` is typically present only on the panel where Freeroam **first generated/changed** that image. Later panels that reuse the same art often have **empty** `character_references`. Client resolves refs by searching `panelCache` for another panel with the same freeroam image URL or prompt that still has refs (usually the first panel that had that art). If neither has refs, generation is skipped until a panel with refs is loaded (or cache already has `ready` for that art).

**Intentional:** gen/reuse can run on a panel that **itself** has empty refs if cast was borrowed for that art. The regenerate button still requires **own** refs on the current panel (source-art panel only).

**Image prompt + Freeroam keeps the same art:** Freeroam may still attach `character_references` on the next panel. Same freeroam URL/prompt → art key reuse applies; not inherently broken. Trade-off: sticky NSFW follows Freeroam art identity, not the user’s failed “change image” intent.

### Atlas generated but image not shown (fixed)

**Symptom:** Atlas Cloud shows a completed Seedream job, but the reader still shows Freeroam art.

**Causes addressed:**

1. **Client poll aborted on effect cancel** — React Strict Mode / remount set `cancelled` and stopped `pollUntilSettled` while Seedream kept running; ready was never adopted. **Fix:** keep polling until ready/skipped/not_found even if the effect was cancelled; always `adoptReady` on success.
2. **Art keys only used prompt** — session restore missed panels that only shared URL. **Fix:** index/lookup by **prompt and URL**.
3. **Paint only if `panelId` matched** — gen finished after navigate/remount left maps filled but UI stuck. **Fix:** also paint if current panel shares the same Freeroam art.
4. **Server lost claim after Seedream** — returned URL without writing `ready`. **Fix:** re-insert `ready` when possible; still return `imageUrl` so the client can display this session.
5. **Regenerate session cleanup** — clear prompt + URL keys and same-art sibling panel entries so stale NSFW is not restored.

Debug: main `<img onError>` logs `[NSFW] Failed to load replacement image` and reverts to Freeroam art if the URL 404s.

### Character References

Source: Freeroam `panel_content.character_references`, mapped on `worlds.getPanel` to a top-level `character_references` object on the panel payload (not re-embedded inside `panel_content` after extract).

**Semantics (confirmed product knowledge — keep this in mind):**  
`character_references` lists **only characters that are in the image** for that panel. Keys are character IDs. Values include name, appearance, headshot, etc. It is **not** “extra world cast” beyond the shot.

**Lifecycle:** Usually populated when Freeroam generates/updates the panel image; **subsequent story panels that keep the same image often omit `character_references`**. Do not assume every NSFW-eligible panel has refs — reuse art-key cache or borrow refs from the panel that first carried this art.

Shape: `Record<characterId, { external_id, name, appearance, headshot_url, is_main_character }>`.

Related field: `images[].visible_characters` is a lighter map (`name`, `external_id` only). Prefer `character_references` when you need headshots / IDs for NSFW.

#### What Freeroam means by “headshot” (important)

Freeroam’s field is named `headshot_url`, but **it is not always a face crop**. In Freeroam UI/API language, a “headshot” can be:

- a true **portrait / head crop**, or  
- a **full-body** character reference image  

Many users (including this project’s author) store **full-body** art under `headshot_url`. Treat `headshot_url` as **“character reference image for likeness”**, not “face only.”

**Implications for NSFW Seedream:**

- Reference images often show **clothing and full pose** — Seedream will copy outfits unless the written prompt explicitly requires nude/bare skin for sexual scenes.  
- Do **not** assume refs are neutral face plates that won’t influence wardrobe or body framing.  
- We still use **only** `headshot_url` (never Freeroam panel images) as Seedream `images[]` refs.

#### Why we do **not** smash character profile appearance into the Seedream prompt

**Do not “rediscover” this the hard way — this is intentional.**

We **used to** pull rich appearance text from the character profile (and/or dump `appearance` from refs into the generation prompt) and merge it with the scene. That caused bad results: wrong body descriptions fighting the Freeroam art, over-specified prompts, and Seedream ignoring or mangling likeness.

**Settled approach:**

1. **Written image prompt** (DeepSeek enhance + story context) drives pose/action/clothing.  
2. **`headshot_url` refs** from `character_references` as Seedream reference images for character likeness (face **and/or** full body — see above). We do **not** pass Freeroam panel images as Seedream refs.  
3. **Do not** paste full character profile appearance into the prompt as if it were ground truth for the frame.

DeepSeek enhance may still use light sex/species descriptors from ref appearance when present; likeness is meant to come from **headshot_url reference images**, not a profile essay.

#### Why we still parse `~~Name` tokens in the Freeroam image prompt

Freeroam’s image prompts tag people as `~~Character-Name` (e.g. `~~Tama-Guthrie`). That string is what Freeroam’s own generator was told.

We use `~~` tokens to:

1. **Align headshots to names as written in the prompt** (matching can fail when Freeroam hallucinates surnames like `~~Kenji-Tanaka` vs ref `Kenji` — then fall back to refs / world characters).  
2. **Drive cast language in the enhance step** (solo vs multi, avoid “both characters” when the prompt only tags one person).  
3. **Cap headshot count** (max 2, and not more than people implied by tokens when tokens are present).

**Note:** If `character_references` is the authoritative “who is in the image,” cast **count** can also come from `Object.keys(character_references).length`. Token parsing remains useful for **name alignment** and for cases where prompt tags and refs disagree. Prefer checking a real panel dump before changing match rules again.

#### Edge case: in the scene / art but missing from the image prompt tags

Freeroam has occasionally had someone relevant who is **not** tagged with `~~Name` in `images[].prompt` (incomplete tagging, POV “you,” etc.). Pure token matching can under-count headshots.

**What we do today:** if token matching yields **no** headshots, fall back to `character_references` (who are in the image) / world characters, still capped.

### Loop Prevention

**Server single-flight (source of truth):** `generateNsfwImage` claims a unique `image_cache` row **before** DeepSeek classification or Seedream. Concurrent callers hit the unique `panelId` constraint and return `generating` / `ready` / `skipped` instead of starting a second job. Stale claim reclaim and Seedream poll limits are shared in `server/nsfwImageCache.ts`. **`checkImageReady` is read-only** (must never delete claims — polling deleted long Seedream jobs and forced re-runs).

**Statuses:**
- `classifying` — DeepSeek NSFW check in progress (no Seedream yet; **no IMG badge**)
- `generating` — Seedream / Atlas image job in progress (**IMG badge** only in this phase)
- `ready` — image URL stored
- `skipped` — classified not-NSFW; remounts must not re-enter generation

Claim is inserted as `classifying`, then promoted to `generating` only after DeepSeek confirms NSFW.

**Client session guards:** `nsfwInFlightRef` blocks overlapping effect runs; `nsfwProcessedPanelsRef` records finished decisions. Regenerate deletes the DB row (`clearImageCacheEntry`), clears both sets for that panel, and bumps `nsfwRegenNonce` so the effect re-runs.

### Regenerate Button

When Unrestricted Images is on, a circular refresh icon appears in the reader top bar **only if the current panel has its own `character_references`** (source-art panel). Clicking it clears session maps + `image_cache` for that panel **and** same Freeroam art (URL/prompt siblings), then re-runs classify/Seedream. Panels that only **reuse** NSFW via art key do not show the button (by design).

### Badge Indicators

- **CHECK badge** (sky blue) — `image_cache.status === 'classifying'` (DeepSeek scene check).
- **IMG badge** (amber `#f59e0b`) — only while `status === 'generating'` (Seedream / Atlas image job).
- **GEN badge** (amber) — ElevenLabs TTS generation (unrelated to images).

Local dev without Manus Forge storage re-hosts Seedream output under `data/nsfw-images/` and serves `/api/nsfw-images/*` (see `server/nsfwLocalStorage.ts`). Atlas raw CDN URLs are downloaded server-side first so the browser does not depend on short-lived/hotlink-blocked OSS links.

### Cache Management

The **Clear Image Cache** button in Voice Settings (Preferences tab) deletes all `image_cache` rows. Use this when old entries lack `freeroamImageUrl` (entries generated before the cross-panel reuse feature was added). After clearing, the next generation will populate `freeroamImageUrl` correctly.

### Environment Variables

| Variable | Purpose |
|---|---|
| `GROK_API_KEY` | Grok API key for TTS delivery tag inference (no longer used for NSFW classification) |
| `ATLAS_CLOUD_API_KEY` | Atlas Cloud API key for DeepSeek classification, DeepSeek prompt enhancement, and Seedream image generation |

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

The ambient backdrop uses Freeroam's exact CSS: a blurred, scaled copy of the panel image with a drift animation (`storyAmbientLayer`). With **Unrestricted Images** off, ambient usually tracks Freeroam CDN art and is relatively stable. With **Unrestricted Images** on, ambient is driven by the same display URL as the main panel (including local `/api/nsfw-images/...` replacements); see **Flash Prevention** under NSFW Image Generation for sticky-frame mitigations and known remaining flash.

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

- **Ambient backdrop flash with Unrestricted Images** — Confirmed more noticeable when unrestricted images are on (local/dev especially). Mitigations: sticky NSFW on same Freeroam art, hold last decoded ambient frame, ignore `?v=` when comparing, preload before ambient swap. **Still can flash** on hard `backgroundImage` + heavy blur repaint, true art changes, or Freeroam CDN ↔ local NSFW URL switches. May be milder on deployment (warmer CDN/cache) but verify there. Future fix if needed: dual ambient layers + short opacity crossfade. See NSFW **Flash Prevention**.
- **Migrated collection covers without binaries** — DB may store `/manus-storage/collection-covers/...` from Manus without local files or Forge. UI falls back to mosaic/folder; re-upload covers (or copy files into `data/local-storage/`) to restore art. See Character Roster **Collection cover images**.
- **World `external_id` is not creation order** — UUID freeroam world ids are not sequential; roster sort relies on Freeroam `sort=` API order (and numeric detail `id`), not client UUID sort.
- **Text to Dialogue API** — ElevenLabs v3 supports a multi-turn dialogue endpoint that could improve delivery continuity. Currently blocked because it returns one combined audio file with no per-turn splitting. Would require ffmpeg or the timestamps endpoint to extract individual clips.
- **Thumbs up/down** — UI exists in the reader rail but not wired to Freeroam's feedback endpoints.
- **Narrator voice picker** — narrator voice is set via a raw voice ID in settings. A proper browse-and-assign dialog (same as character voice picker) would improve UX.
- **Visual countdown bar** — auto-advance has no visual indicator. A thin draining progress bar at the bottom of the panel would help.
- **Debug mode** — a debug overlay is available in preferences (Voice Settings → Debug Mode). Shows `forward_state`, `next_panel_id`, `isPolling`, `isNavigating`, `canGoForward`, `is_action`, `requires_action` in real time. Leave on when investigating navigation issues.
- **Story text brightness** — deliberately kept at `rgba(255,255,255,0.85)` rather than full white. Freeroam uses full white which can wash out against bright panel images. Our softer value is intentional.
- **Choice panel design** — uses `display: block` (not `flex flex-col`) on the outer container to prevent Tailwind's custom `.flex` from squishing button heights.
- **NSFW loop bug** — fixed via server-side atomic claim before classification (see Loop Prevention). Re-test Unrestricted Images before relying on it in production.
- **Story reader text positioning** — text overlay uses Freeroam's exact CSS (`67dvh` flex spacer anchor) but visual alignment still differs slightly from Freeroam's app. Pending further comparison with Freeroam's DevTools CSS.

---

## Storage paths (summary)

| Public URL | When | Backend |
|---|---|---|
| `/manus-storage/{key}` | Forge uploads (covers, exports, TTS, etc.); DB rows from Manus migration | `storageProxy`: local `data/local-storage/{key}` if present, else Forge signed redirect |
| `/api/local-storage/{key}` | Local `storagePut` when Forge is **not** configured | `data/local-storage/` via `registerLocalStorageRoutes` |
| `/api/nsfw-images/{file}` | NSFW Seedream output without Forge | `data/nsfw-images/` |

Do **not** unify local puts onto `/manus-storage/` unless both proxy and local routes are verified on every deploy target — local installs historically used `/api/local-storage/`.

---

## Dev Environment

The sandbox cannot make authenticated requests to Freeroam's API directly (IP-based blocking). The dev environment uses:

- **`FREEROAM_DEV_COOKIE`** — full Freeroam session cookie (copied from browser DevTools) stored as a server env var. Must be the complete cookie string (not just the `session=` value). Used as fallback when no user cookie is in the `x-freeroam-cookie` header.
- **`hasUserCookie` dev bypass** — in `NODE_ENV=development`, `hasUserCookie()` returns `true` when `FREEROAM_DEV_COOKIE` is set, so world/character endpoints don't gate on missing user cookie.
- **Cookie expiry** — Freeroam session cookies expire. When the dev environment stops loading worlds (404 errors), update `FREEROAM_DEV_COOKIE` with a fresh cookie from DevTools and restart the dev server.
- **No Forge env** — without `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY`, storage is local disk only; Manus-migrated `/manus-storage/` objects 404 until re-uploaded or files are copied into `data/local-storage/`.
- **Production logs** — the production server runs on separate Manus infrastructure. Server-side `console.log` output is not accessible from the sandbox. For production debugging, use the database log approach or Atlas Cloud dashboard to observe API calls.

