// StoryReader.tsx
// Full-screen story panel reader — custom design inspired by Freeroam but elevated.
// Layout:
//   - Ambient blurred backdrop (panel image fills the sides, dark scrim over it)
//   - Center portrait panel filling full viewport height
//   - Navigation halos on left/right edges
//   - Spoken dialogue: large bold white Lora text at bottom, character name in accent color above with a colored underline
//   - Narration: italic Lora text at bottom, slightly smaller
//   - No speech bubble — all text rendered as bottom overlay
//   - Choice options: frosted glass pills below the panel

import { trpc } from '@/lib/trpc';
import { getFreeroamAuthHeaders } from '@/lib/freeroamHeaders';
import { ApiWorld } from '@/components/WorldCard';
import StoryMenu from '@/components/StoryMenu';
import CharacterPanel from '@/components/CharacterPanel';
import { ActionBarComposer, ChoiceComposer } from '@/components/StoryActionComposers';
import { Bookmark, ChevronLeft, ChevronRight, X, Loader2, ImageIcon, Home, ChevronDown, ChevronUp, Zap, Clapperboard, Users, Image as ImageLucide, Share2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';

interface StoryReaderProps {
  world: ApiWorld;
  initialPanelId: string;
  onClose: () => void;
}

type PanelData = {
  panel_id: string;
  world_id: string;
  next_panel_id: string | null;
  prev_panel_id: string | null;
  is_action: boolean;
  requires_action: boolean;
  depth: number;
  forward_state: string;
  panel_content: {
    type: string;
    narration: string | null;
    images: Array<{
      url: string;
      prompt: string;
      generation_type: string | null;
      visible_characters: Record<string, { name: string; external_id: string }>;
      shot: string | null;
      is_nsfw: boolean | null;
    }>;
    speech_bubbles: Array<{
      text: string;
      character: string;
      style: string;
      isRequiresActionChat: boolean;
    }>;
    choice: {
      question: string;
      options: Array<{ text: string; action_panel_external_id: string }>;
      selected_choice: string | null;
      is_chat: boolean;
    } | null;
    chapter_header: string | null;
    chapter_start: unknown;
    chapter_end: unknown;
    depth: number;
    is_chat: boolean;
  };
  next_panel: (Omit<PanelData, 'next_panel'> & { next_panel: unknown }) | null;
  show_jump_to_latest: boolean;
  jump_to_latest_panel_id: string | null;
  is_owner: boolean;
};

// Deterministic accent color per character name — mirrors Freeroam's cyrb53-based characterColor.ts
function getAccentColor(name: string): string {
  if (!name || typeof name !== 'string') return 'hsl(0, 70%, 40%)';
  const normalizedName = name.toLowerCase().trim();
  // cyrb53 hash — mirrors Freeroam's shared-components/src/utils/characterColor.ts
  const cyrb53 = (str: string, seed = 0): number => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  const hue = cyrb53(normalizedName) % 360;
  // Use Freeroam's actual HSL values: rgb(130,214,214) = hsl(180, 53%, 67%) for Spike
  return `hsl(${hue}, 53%, 67%)`;
}

export default function StoryReader({ world, initialPanelId, onClose: onCloseProp }: StoryReaderProps) {
  const onClose = () => {
    // Stop any playing audio before closing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    onCloseProp();
  };
  const utils = trpc.useUtils();
  const [currentPanel, setCurrentPanel] = useState<PanelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Lock body scroll when reader is open to prevent mobile browser chrome from toggling
  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevPos = document.body.style.position;
    const prevTop = document.body.style.top;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = prev;
      document.body.style.position = prevPos;
      document.body.style.top = prevTop;
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
    };
  }, []);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isImagePolling, setIsImagePolling] = useState(false); // true when polling for image generation specifically
  const [visible, setVisible] = useState(false);
  // AbortController-based polling (matches Freeroam's sequential for-loop pattern)
  const pollAbortRef = useRef<AbortController | null>(null);
  // Panel cache: store visited panels by panel_id for instant back/forward navigation
  const panelCache = useRef<Map<string, PanelData>>(new Map());
  // Ref to latest loadPanel for use in polling callbacks
  const loadPanelRef = useRef<((panelId: string, worldId: string) => Promise<void>) | null>(null);
  const setPanelMutation = trpc.worlds.setPanel.useMutation();
  const generateSpeechMutation = trpc.voice.generateSpeech.useMutation();

  // TTS state
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Debug: flashes true briefly when ElevenLabs is actually called (cache miss)
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  // Set to true by triggerTTS when it successfully starts playing audio for a panel.
  // The auto-advance fallback timer checks this to avoid firing while voice is playing or pending.
  const ttsWillPlayRef = useRef(false);
  // Set to true by triggerTTS when it confirms no voice will play (no voice assigned, no narrator).
  // Lets the fallback timer fire at reading speed instead of 2x.
  const ttsConfirmedNoVoiceRef = useRef(false);
  // Voice assignments cache: character_name -> voice data (null = no voice assigned, undefined = not yet fetched).
  // characterId is stored with the entry so cache lookups always use the stable Freeroam id, not __narrator__.
  type VoiceCacheEntry = {
    voiceId: string;
    voiceName: string;
    stability: string | null;
    similarityBoost: string | null;
    style: string | null;
    languageCode: string | null;
    characterId: string;
  } | null;
  const voiceCache = useRef<Map<string, VoiceCacheEntry>>(new Map());

  // Load auto-play setting on mount
  const { data: autoPlaySetting } = trpc.voice.getSetting.useQuery({ key: 'auto_play_enabled' });
  useEffect(() => {
    if (autoPlaySetting !== undefined && autoPlaySetting !== null) {
      setAutoPlayEnabled(autoPlaySetting !== 'false');
    }
  }, [autoPlaySetting]);

  // Narrator voice settings
  const { data: narratorVoiceId } = trpc.voice.getSetting.useQuery({ key: 'narrator_voice_id' });

  // Debug mode
  const { data: debugModeSetting } = trpc.voice.getSetting.useQuery({ key: 'debug_mode' });
  const debugMode = debugModeSetting === 'true';

  // Auto-advance settings
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(false);
  const [autoAdvanceReadingSpeed, setAutoAdvanceReadingSpeed] = useState(1.0);
  const [autoAdvanceMinDelay, setAutoAdvanceMinDelay] = useState(2);
  const [autoAdvanceStaticDelay, setAutoAdvanceStaticDelay] = useState(3);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noVoiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPanelIdRef = useRef<string | null>(null);
  // Refs for values used inside async closures (audio.onended) to avoid stale captures
  const autoAdvanceEnabledRef = useRef(false);
  const autoAdvanceMinDelayRef = useRef(2);
  const autoAdvanceReadingSpeedRef = useRef(1.0);
  /** True while generateSpeech / poll is in progress for the current panel (not yet playing or failed). */
  const ttsInFlightRef = useRef(false);
  const { data: autoAdvanceSetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_enabled' });
  const { data: readingSpeedSetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_reading_speed' });
  const { data: minDelaySetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_min_delay' });
  const { data: staticDelaySetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_static_delay' });
  useEffect(() => { if (autoAdvanceSetting !== undefined) { const v = autoAdvanceSetting === 'true'; setAutoAdvanceEnabled(v); autoAdvanceEnabledRef.current = v; } }, [autoAdvanceSetting]);
  useEffect(() => {
    if (readingSpeedSetting) {
      const v = parseFloat(readingSpeedSetting);
      setAutoAdvanceReadingSpeed(v);
      autoAdvanceReadingSpeedRef.current = v;
    }
  }, [readingSpeedSetting]);
  useEffect(() => { if (minDelaySetting) { const v = parseFloat(minDelaySetting); setAutoAdvanceMinDelay(v); autoAdvanceMinDelayRef.current = v; } }, [minDelaySetting]);
  useEffect(() => { if (staticDelaySetting) setAutoAdvanceStaticDelay(parseFloat(staticDelaySetting)); }, [staticDelaySetting]);

  // Swipe-down gesture to open menu
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  // Bookmark state — set of bookmarked panel IDs for this world
  const [bookmarkedPanelIds, setBookmarkedPanelIds] = useState<Set<string>>(new Set());
  const [isTogglingBookmark, setIsTogglingBookmark] = useState(false);
  const addBookmarkMutation = trpc.worlds.addBookmark.useMutation();
  const removeBookmarkMutation = trpc.worlds.removeBookmark.useMutation();

  // Character panel state
  const [charPanelOpen, setCharPanelOpen] = useState(false);

  // Auto-advance pause: true while the user has an action input open or Characters panel open
  const [autoAdvancePaused, setAutoAdvancePaused] = useState(false);
  // Ref so pause/resume helpers can access the timer without stale closures
  const autoAdvancePausedRef = useRef(false);

  const pauseAutoAdvance = useCallback(() => {
    autoAdvancePausedRef.current = true;
    setAutoAdvancePaused(true);
    // Cancel any timers that are running
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (noVoiceTimerRef.current) {
      clearTimeout(noVoiceTimerRef.current);
      noVoiceTimerRef.current = null;
    }
  }, []);

  const resumeAutoAdvance = useCallback(() => {
    autoAdvancePausedRef.current = false;
    setAutoAdvancePaused(false);
  }, []);

  // Action bar state
  const [actionBarVisible, setActionBarVisible] = useState(true);
  const [activeInputMode, setActiveInputMode] = useState<'act' | 'direct' | 'image' | null>(null);
  // Text buffers live in ActionBarComposer / ChoiceComposer so typing does not re-render
  // this whole reader (ambient blur + panel + dialogue is expensive on mobile).
  const [isSendingAction, setIsSendingAction] = useState(false);
  // Text the user submitted — shown centered on screen while the next panel generates
  const [pendingActionText, setPendingActionText] = useState<string | null>(null);
  const sendActionMutation = trpc.worlds.sendAction.useMutation();

  const handleActionBarButton = (mode: 'act' | 'direct' | 'image') => {
    if (activeInputMode === mode) {
      setActiveInputMode(null);
      // Resume auto-advance when input is dismissed (unless char panel is still open)
      if (!charPanelOpen) resumeAutoAdvance();
    } else {
      setActiveInputMode(mode);
      // Pause auto-advance (and cancel any running timer) while user is composing
      pauseAutoAdvance();
    }
  };

  const handleSendAction = useCallback(async (
    text: string,
    actionType: 'choice' | 'take-action' | 'image' | 'steer-story',
    characterChanges?: {
      add_character_ids: string[];
      remove_character_ids: string[];
      new_main_character_id: string | null;
      old_main_character_id: string | null;
      batch_character_update: boolean;
    } | null,
    displayText?: string
  ) => {
    if (!panel || !text.trim() || isSendingAction) return;
    setIsSendingAction(true);
    setActiveInputMode(null);
    setPendingActionText(text.trim());
    try {
      const result = await sendActionMutation.mutateAsync({
        worldId: world.external_id,
        panelId: panel.panel_id,
        actionText: text,
        displayText: displayText ?? text,
        actionType,
        characterChanges: characterChanges ?? null,
      });
      // Display the action panel content directly
      const actionPanel = {
        panel_id: result.action_panel_id,
        world_id: world.external_id,
        next_panel_id: result.next_panel_id,
        prev_panel_id: result.prev_panel_id ?? panel.panel_id,
        is_action: true,
        requires_action: false,
        depth: panel.depth,
        forward_state: result.forward_state,
        panel_content: result.action_panel_content,
        next_panel: null,
        show_jump_to_latest: false,
        jump_to_latest_panel_id: null,
        text_feedback: [],
        is_owner: true,
        image_prompt_edit_enabled: false,
        phone_unread_count: 0,
        phone: { total: 0, by_app: {}, recent: [], version: null, seen_at_by_app: {} },
        phone_experiment_enabled: false,
        in_world_time: null,
        location: null,
      };
      const actionPanelData = actionPanel as unknown as PanelData;
      // Store action panel in cache so backward navigation can traverse it
      panelCache.current.set(result.action_panel_id, actionPanelData);
      setCurrentPanel(actionPanelData); currentPanelIdRef.current = (actionPanelData)?.panel_id ?? null;
      // Save position
      setPanelMutation.mutate({ worldId: world.external_id, panelId: result.action_panel_id });
      // Determine if this is an image action (check action text prefix)
      const isImageAction = text.toLowerCase().startsWith('change the image to');
      // Handle next panel navigation based on forward_state
      if (result.forward_state === 'awaiting_choice' && result.next_panel_id) {
        // Choice panel is already generated — navigate to it immediately
        await (loadPanelRef.current ?? loadPanel)(result.next_panel_id, world.external_id);
      } else if (result.forward_state === 'generating' || result.forward_state === 'ready') {
        // Poll for the next panel — Freeroam may return next_panel_id before the panel exists
        // startPolling handles both cases: polls nextReady until ready, then loads the panel
        startPolling(result.action_panel_id, isImageAction);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send action');
      setPendingActionText(null);
    } finally {
      setIsSendingAction(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSendingAction, sendActionMutation, world.external_id]);

  // Regenerate polling state
  const [isRegeneratePolling, setIsRegeneratePolling] = useState(false);
  const [regenerateTimedOut, setRegenerateTimedOut] = useState(false);
  const regeneratePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRegeneratePolling = useCallback(() => {
    if (regeneratePollRef.current) {
      clearInterval(regeneratePollRef.current);
      regeneratePollRef.current = null;
    }
    setIsRegeneratePolling(false);
  }, []);

  const startRegeneratePolling = useCallback((worldId: string) => {
    setIsRegeneratePolling(true);
    setRegenerateTimedOut(false);
    let elapsed = 0;
    const INTERVAL = 1500;
    const TIMEOUT = 60000;
    regeneratePollRef.current = setInterval(async () => {
      elapsed += INTERVAL;
      if (elapsed >= TIMEOUT) {
        stopRegeneratePolling();
        setRegenerateTimedOut(true);
        setTimeout(() => setRegenerateTimedOut(false), 3000);
        return;
      }
      try {
                const params = encodeURIComponent(JSON.stringify({ '0': { json: { worldId } } }));
        const res = await fetch(`/api/trpc/worlds.get?batch=1&input=${params}`, {
          credentials: 'include',
          headers: {
          ...getFreeroamAuthHeaders(),
        },
        });
        if (!res.ok) return;
        const json = await res.json();
        const data = json?.[0]?.result?.data?.json;
        const panelId = data?.panel_id;
        if (panelId) {
          stopRegeneratePolling();
          await loadPanel(panelId, worldId);
          toast.success('Story regenerated successfully');
        }
      } catch {
        // Non-fatal — keep polling
      }
    }, INTERVAL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRegeneratePolling]);

  useEffect(() => () => stopRegeneratePolling(), [stopRegeneratePolling]);

  // Like state
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState<number | undefined>(undefined);
  const [isTogglingLike, setIsTogglingLike] = useState(false);

  // NSFW image replacement state
  const [nsfwImageUrl, setNsfwImageUrl] = useState<string | null>(null);
  const [isGeneratingNsfwImage, setIsGeneratingNsfwImage] = useState(false); // Seedream / Atlas image job
  const [isClassifyingNsfwImage, setIsClassifyingNsfwImage] = useState(false); // DeepSeek classify phase
  // Session guards: processed = finished decision for panel; inFlight = generate/poll currently running
  const nsfwProcessedPanelsRef = useRef<Set<string>>(new Set());
  const nsfwInFlightRef = useRef<Set<string>>(new Set());
  // Session maps so navigating away and back restores the right NSFW art (not only "last sticky")
  const nsfwByPanelIdRef = useRef<Map<string, string>>(new Map());
  const nsfwByArtKeyRef = useRef<Map<string, string>>(new Map()); // Freeroam prompt|url → NSFW url
  /**
   * Freeroam only sends character_references on panels where the art was (re)generated.
   * Later panels reuse the same art with empty refs. We remember refs by art key for the
   * whole reader session so regenerate works on any same-art panel.
   * Not cleared on regenerate (only NSFW image maps are).
   */
  const nsfwCharRefsByArtKeyRef = useRef<Map<string, Record<string, {
    external_id: string;
    name: string;
    appearance: string | null;
    headshot_url: string | null;
    is_main_character: boolean;
  }>>>(new Map());
  // Bump to force the NSFW effect to re-run for regenerate (same panel_id)
  const [nsfwRegenNonce, setNsfwRegenNonce] = useState(0);
  // Set to panelId when user clicks regenerate — consumed once by the NSFW effect
  const nsfwForceRegenPanelRef = useRef<string | null>(null);
  // Monotonic run id so Strict Mode cleanup / panel change does not clear a newer run's badges
  const nsfwRunIdRef = useRef(0);
  const generateNsfwImageMutation = trpc.voice.generateNsfwImage.useMutation();
  const clearImageCacheEntryMutation = trpc.voice.clearImageCacheEntry.useMutation();
  const { data: unrestrictedImagesSettingData } = trpc.voice.getSetting.useQuery({ key: 'unrestricted_images' });
  const unrestrictedImagesEnabled = unrestrictedImagesSettingData === 'true';

  const freeroamArtKey = (prompt?: string | null, url?: string | null) =>
    (prompt?.trim() || url || '').trim();

  /** Local NSFW files reuse the same path per panel; strip query for map keys. */
  const nsfwUrlBase = (url: string) => url.split('?')[0];
  /**
   * Cache-bust only after regenerate (same path overwritten). Do NOT bust on every panel
   * visit — a new ?v= reloads ambient CSS backgroundImage and causes a visible flash.
   */
  const nsfwUrlForDisplay = (url: string, cacheBust: boolean) =>
    cacheBust ? `${nsfwUrlBase(url)}?v=${Date.now()}` : nsfwUrlBase(url);

  const rememberNsfwImage = (panelId: string, artKey: string, url: string, cacheBust = false) => {
    const base = nsfwUrlBase(url);
    nsfwByPanelIdRef.current.set(panelId, base);
    if (artKey) {
      nsfwByArtKeyRef.current.set(artKey, base);
      // Seed every panel we already know that shares this Freeroam art so next-panel
      // navigation restores NSFW without a full reader remount.
      for (const [pid, p] of panelCache.current.entries()) {
        const pImg = p.panel_content?.images?.[0];
        if (freeroamArtKey(pImg?.prompt, pImg?.url) === artKey) {
          nsfwByPanelIdRef.current.set(pid, base);
          nsfwProcessedPanelsRef.current.add(pid);
        }
      }
    }
    nsfwProcessedPanelsRef.current.add(panelId);
    // Only paint if user is still on this panel (avoid stale writes after navigation)
    if (currentPanelIdRef.current === panelId) {
      setNsfwImageUrl(nsfwUrlForDisplay(base, cacheBust));
    }
  };

  const lookupSessionNsfw = (panelId: string, artKey: string): string | null =>
    nsfwByPanelIdRef.current.get(panelId)
    ?? (artKey ? nsfwByArtKeyRef.current.get(artKey) ?? null : null);

  /** Always hit the server — React Query can cache an early not_found and never show a later ready. */
  const fetchImageCacheFresh = (input: {
    panelId: string;
    freeroamImageUrl?: string;
    freeroamImagePrompt?: string;
  }) => utils.voice.checkImageReady.fetch(input, { staleTime: 0, gcTime: 0 });

  type NsfwCharRef = {
    external_id: string;
    name: string;
    appearance: string | null;
    headshot_url: string | null;
    is_main_character: boolean;
  };

  /** Freeroam only attaches character_references on panels where the image was (re)generated. */
  const getPanelCharacterReferences = (panel: PanelData | null | undefined): Record<string, NsfwCharRef> =>
    (panel as unknown as { character_references?: Record<string, NsfwCharRef> } | null)
      ?.character_references ?? {};

  /** Remember cast for this Freeroam art so later same-art panels / regenerate still have headshots. */
  const rememberCharRefsForArt = (artKey: string | undefined, refs: Record<string, NsfwCharRef>) => {
    if (!artKey || Object.keys(refs).length === 0) return;
    nsfwCharRefsByArtKeyRef.current.set(artKey, refs);
  };

  /**
   * Resolve cast for NSFW generate / regenerate:
   * 1) this panel's character_references
   * 2) session map by art key (seen earlier this reader session)
   * 3) any panelCache entry with the same freeroam image URL or prompt that still has refs
   */
  const resolveCharacterReferencesForArt = (
    panel: PanelData,
    freeroamImageUrl?: string,
    freeroamImagePrompt?: string,
  ): Record<string, NsfwCharRef> => {
    const artKey = freeroamArtKey(freeroamImagePrompt, freeroamImageUrl);

    const own = getPanelCharacterReferences(panel);
    if (Object.keys(own).length > 0) {
      rememberCharRefsForArt(artKey, own);
      return own;
    }

    if (artKey) {
      const remembered = nsfwCharRefsByArtKeyRef.current.get(artKey);
      if (remembered && Object.keys(remembered).length > 0) return remembered;
    }

    // Array.from avoids MapIterator downlevelIteration requirement under default tsc target
    const cachedPanels = Array.from(panelCache.current.values());
    for (let i = 0; i < cachedPanels.length; i++) {
      const p = cachedPanels[i];
      const pImg = p.panel_content?.images?.[0];
      if (!pImg) continue;
      const sameUrl = !!(freeroamImageUrl && pImg.url === freeroamImageUrl);
      const samePrompt = !!(freeroamImagePrompt && pImg.prompt === freeroamImagePrompt);
      if (!sameUrl && !samePrompt) continue;
      const refs = getPanelCharacterReferences(p);
      if (Object.keys(refs).length > 0) {
        rememberCharRefsForArt(artKey, refs);
        return refs;
      }
    }
    return {};
  };

  /** Story text (narration + non-action dialogue) for NSFW classify/enhance context. */
  const extractPanelStoryText = (p: { panel_id?: string; panel_content?: PanelData['panel_content'] } | null | undefined) => {
    if (!p?.panel_content) return null;
    const parts: string[] = [];
    if (p.panel_content.narration) parts.push(p.panel_content.narration);
    const bubbles = (p.panel_content.speech_bubbles as Array<{ text?: string; style?: string }> | undefined)
      ?.filter(b => b.style !== 'action')
      .map(b => b.text)
      .filter(Boolean) as string[] | undefined;
    if (bubbles?.length) parts.push(...bubbles);
    return parts.join(' ').trim() || null;
  };

  // panelId → story text seen this session (prev panel is often missing from API; only next is embedded)
  const panelStoryTextRef = useRef<Map<string, string>>(new Map());

  const rememberPanelStoryText = (panel: PanelData | null | undefined) => {
    if (!panel?.panel_id) return;
    const text = extractPanelStoryText(panel);
    if (text) panelStoryTextRef.current.set(panel.panel_id, text);
    // Also remember embedded next panel text when Freeroam sends it
    const next = panel.next_panel as PanelData | null | undefined;
    if (next?.panel_id) {
      const nextText = extractPanelStoryText(next);
      if (nextText) panelStoryTextRef.current.set(next.panel_id, nextText);
    }
  };
  const likeMutation = trpc.worlds.like.useMutation();
  const unlikeMutation = trpc.worlds.unlike.useMutation();

  // Story menu state
  const [menuOpen, setMenuOpen] = useState(false);
  // Full bookmark list with thumbnails (for the menu)
  const [bookmarkList, setBookmarkList] = useState<Array<{ panel_external_id: string; depth: number; image_url: string; type: 'bookmark' | 'progress' }>>([]);
  const [progressPanel, setProgressPanel] = useState<{ panel_external_id: string; depth: number; image_url: string; updated_at: string; type: 'progress' } | null>(null);
  // World detail for tags and related worlds
  const [worldDetail, setWorldDetail] = useState<{ tags: Array<{ id: number; name: string; is_fandom: boolean; emoji: string | null }>; related_worlds: Array<{ external_id: string; name: string; logline: string; cover_image_url: string | null; owner: { username: string; is_verified: boolean; avatar_url: string | null }; interaction_count: number; tag_name: string; tag_is_fandom: boolean }> } | null>(null);
  const [worldCharacters, setWorldCharacters] = useState<Array<{ name: string; external_id: string }>>([]);
  // Chapters from journal endpoint
  const [chapters, setChapters] = useState<Array<{ chapter_number: number; panel_external_id: string; image_url: string }>>([]);
  // Full journal data for Journal tab
  const [journalData, setJournalData] = useState<{
    summary: string | null;
    compressedSummaries: Array<{ type: string; level: number; chapter_numbers: number[]; content: string }>;
    entityCharacters: Array<{ name: string; state: string; appearance: string; display_headshot_url: string; headshot_url: string }>;
    entityLocations: Array<{ name: string; description: string; position: string }>;
    entityMisc: Array<{ name: string; description: string; state: string }>;
    narrativeThreads: Array<{ id: string; title: string; importance: string; status: string; notes: string[] }>;
  } | null>(null);

  // Choice ideas visibility preference
  const [showChoiceIdeasByDefault, setShowChoiceIdeasByDefault] = useState(true);
  const [choiceIdeasVisible, setChoiceIdeasVisible] = useState(true);

  // Stop any in-progress polling by aborting the AbortController
  const stopPolling = useCallback(() => {
    if (pollAbortRef.current) {
      pollAbortRef.current.abort();
      pollAbortRef.current = null;
    }
    setIsPolling(false);
    setIsImagePolling(false);
  }, []);

  // Poll getPanel directly every 2s when the panel ID is known but the panel isn't available yet.
  // Used as a fallback when loadPanel fails all retries but next_panel_id is already set.
  const startDirectPanelPolling = useCallback((targetPanelId: string) => {
    if (pollAbortRef.current) pollAbortRef.current.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setIsPolling(true);
    (async () => {
      for (let i = 0; i < 120 && !controller.signal.aborted; i++) {
        try {
          if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));
          if (controller.signal.aborted) return;
          await loadPanelRef.current?.(targetPanelId, world.external_id);
          // If loadPanel succeeded, it sets currentPanel and isNavigating=false
          // We just need to clear the polling state
          if (!controller.signal.aborted) {
            pollAbortRef.current = null;
            setIsPolling(false);
          }
          return;
        } catch {
          if (controller.signal.aborted) return;
          // Keep retrying
        }
      }
      // Timed out
      if (!controller.signal.aborted) {
        pollAbortRef.current = null;
        setIsPolling(false);
        toast.error('Failed to load next panel after multiple attempts');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.external_id]);

  // Start polling for next panel using Freeroam's sequential for-loop pattern (500ms, max 240 iterations)
  // Polls nextReady every 500ms. When ready, always loads the panel (auto-navigates).
  const startPolling = useCallback((panelId: string, isImage = false) => {
    // Abort any existing poll
    if (pollAbortRef.current) pollAbortRef.current.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setIsPolling(true);
    if (isImage) setIsImagePolling(true);
    (async () => {
      const extraHeaders = getFreeroamAuthHeaders();
      for (let i = 0; i < 240 && !controller.signal.aborted; i++) {
        try {
          const res = await fetch(
            `/api/trpc/worlds.nextReady?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { json: { panelId } } }))}`,
            { credentials: 'include', signal: controller.signal, headers: extraHeaders }
          );
          if (res.ok) {
            const data = await res.json();
            const result = data?.[0]?.result?.data?.json;
            // Detect image generation: partial.done=true means text is complete,
            // image is now being generated. Show the image icon spinner.
            if (result && !result.ready && result.partial?.done === true) {
              setIsImagePolling(true);
            }
            if (result?.ready && result?.panel_id) {
              if (!controller.signal.aborted) {
                pollAbortRef.current = null;
                setIsPolling(false);
                setIsImagePolling(false);
                // Always update the cached panel so future revisits don't re-trigger polling
                const cachedPanel = panelCache.current.get(panelId);
                if (cachedPanel) {
                  panelCache.current.set(panelId, {
                    ...cachedPanel,
                    next_panel_id: result.panel_id,
                    forward_state: 'ready',
                  });
                }
                // Only auto-navigate for action panels.
                // Non-action panels (dialogue/narration) that happen to be in generating
                // state should show the arrow and let the user advance manually.
                const isActionPanel = cachedPanel?.is_action ?? false;
                if (isActionPanel) {
                  await loadPanelRef.current?.(result.panel_id, world.external_id);
                } else {
                  // Update currentPanel state so canGoForward becomes true
                  setCurrentPanel(prev => {
                    if (!prev || prev.panel_id !== panelId) return prev;
                    return { ...prev, next_panel_id: result.panel_id, forward_state: 'ready' };
                  });
                  setIsPolling(false);
                  setIsImagePolling(false);
                  pollAbortRef.current = null;
                }
              }
              return;
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      // Timed out
      if (!controller.signal.aborted) {
        pollAbortRef.current = null;
        setIsPolling(false);
        setIsImagePolling(false);
      }
    })();
  }, [world.external_id]);

  // Cancel any pending auto-advance timer (both the 2x fallback and the no-voice check)
  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (noVoiceTimerRef.current) {
      clearTimeout(noVoiceTimerRef.current);
      noVoiceTimerRef.current = null;
    }
  }, []);

  /** Reading-time delay for a block of text (respects min delay + reading speed). */
  const readingDelayMsForText = useCallback((text: string) => {
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const wpm = 200 * autoAdvanceReadingSpeedRef.current;
    const readingTimeMs = wpm > 0 ? (wordCount / wpm) * 60 * 1000 : 0;
    return Math.max(autoAdvanceMinDelayRef.current * 1000, readingTimeMs);
  }, []);

  /**
   * Schedule auto-advance to nextPanelId after delayMs, only if still on fromPanelId.
   * Always cancels prior timers first so we never leak a 2× fallback under a new timeout id
   * (that race was skipping panels / double-firing into unvoiced panels).
   */
  const scheduleAutoAdvance = useCallback((
    fromPanelId: string,
    nextPanelId: string | null | undefined,
    delayMs: number,
  ) => {
    if (!nextPanelId) return;
    if (!autoAdvanceEnabledRef.current || autoAdvancePausedRef.current) return;
    if (currentPanelIdRef.current !== fromPanelId) return;
    cancelAutoAdvance();
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      if (currentPanelIdRef.current !== fromPanelId) return;
      if (!autoAdvanceEnabledRef.current || autoAdvancePausedRef.current) return;
      loadPanelRef.current?.(nextPanelId, world.external_id);
    }, Math.max(0, delayMs));
  }, [cancelAutoAdvance, world.external_id]);

  /** TTS confirmed this panel will not play audio — arm reading-time auto-advance. */
  const confirmNoVoiceForPanel = useCallback((panel: PanelData) => {
    ttsConfirmedNoVoiceRef.current = true;
    ttsInFlightRef.current = false;
    setIsGeneratingTts(false);
    if (!autoAdvanceEnabledRef.current || autoAdvancePausedRef.current) return;
    if (currentPanelIdRef.current !== panel.panel_id) return;
    if (ttsWillPlayRef.current) return;
    const text =
      panel.panel_content?.speech_bubbles?.[0]?.text
      ?? panel.panel_content?.narration
      ?? '';
    scheduleAutoAdvance(panel.panel_id, panel.next_panel_id, readingDelayMsForText(text));
  }, [readingDelayMsForText, scheduleAutoAdvance]);

  const loadPanel = useCallback(async (panelId: string, worldId: string) => {
    stopPolling();
    cancelAutoAdvance();
    ttsInFlightRef.current = false;
    setPendingActionText(null); // Clear pending action text when navigating to next panel
    setChoiceIdeasVisible(showChoiceIdeasByDefault);
    // Check panel cache first for instant navigation.
    // Only reject if panel_content is null or contains [Max Depth] truncation markers.
    // images can legitimately be null/empty on some panels, so don't require it to be an array.
    // NOTE: This same validity check is also used when caching embedded next_panel data
    //       at line ~514 (loadPanel) and line ~1041 (handleNavigate embedded fast path).
    //       If you change this logic, update those sites too.
    const isPanelContentValid = (pc: PanelData['panel_content']) =>
      pc != null && typeof pc.type === 'string' && pc.type !== '[Max Depth]';
    const cached = panelCache.current.get(panelId);
    if (cached && isPanelContentValid(cached.panel_content)) {
      // Don't serve cached panels with forward_state=generating — they may be stale
      // (cached when the panel was first created, before Freeroam updated it to ready).
      // Always re-fetch generating panels to get the latest state.
      if (cached.forward_state === 'generating') {
        panelCache.current.delete(panelId);
      } else {
        setCurrentPanel(cached); currentPanelIdRef.current = (cached)?.panel_id ?? null;
        setPanelMutation.mutate({ worldId, panelId });
        setIsLoading(false);
        return;
      }
    } else if (cached) {
      // Remove broken cached entry (null or [Max Depth] strings) and fetch fresh
      panelCache.current.delete(panelId);
    }
    setIsNavigating(true);
    // Retry up to 10 times with a 2s delay — Freeroam sometimes returns a panel_id
    // before the panel actually exists, and server-side fetches can fail transiently.
    // More retries with longer gaps gives the panel time to become available.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2000));
        const data = await utils.worlds.getPanel.fetch({ worldId, panelId });
        const panel = data as PanelData;
        // Only cache if panel_content has real data (not [Max Depth] strings)
        if (isPanelContentValid(panel.panel_content)) {
          panelCache.current.set(panelId, panel);
          // Also cache the embedded next_panel if present and valid
          if (panel.next_panel) {
            const next = panel.next_panel as PanelData;
            if (next.panel_id && isPanelContentValid(next.panel_content)) panelCache.current.set(next.panel_id, next);
          }
        }
        setCurrentPanel(panel); currentPanelIdRef.current = (panel)?.panel_id ?? null;
        setPanelMutation.mutate({ worldId, panelId });
        lastErr = null;
        break; // success
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) {
      // The panel fetch failed all retries. If the source panel is an action panel
      // (generating or ready), the target panel may not be available yet.
      // Use startDirectPanelPolling to keep retrying getPanel every 500ms
      // with the spinner showing, until the panel becomes available.
      const currentPanelId = currentPanelIdRef.current;
      const sourcePanelData = currentPanelId ? panelCache.current.get(currentPanelId) : null;
      const shouldFallbackToPoll =
        sourcePanelData?.forward_state === 'generating' ||
        (sourcePanelData?.forward_state === 'ready' && sourcePanelData?.is_action);
      if (shouldFallbackToPoll) {
        // Poll getPanel directly since we already know the target panel_id
        startDirectPanelPolling(panelId);
        return; // Don't clear isNavigating — let polling handle it
      } else {
        toast.error(lastErr instanceof Error ? lastErr.message : 'Failed to load panel');
      }
    }
    setIsNavigating(false);
    setIsLoading(false);
  }, [utils, setPanelMutation, stopPolling, showChoiceIdeasByDefault, startPolling, startDirectPanelPolling]);

  // Load voice_enabled setting
  const { data: voiceEnabledSetting } = trpc.voice.getSetting.useQuery({ key: 'voice_enabled' });
  const voiceEnabled = voiceEnabledSetting !== 'false'; // default true if not set

  // Helper: play an audio clip with error/stall handling for poor connections
  const playAudioClip = useCallback((audioUrl: string, panel: PanelData) => {
    audioRef.current?.pause();
    // Voice owns auto-advance from here — kill reading/2× fallbacks so they can't fire
    // after onended overwrites the timer ref (leaked timeout race).
    cancelAutoAdvance();
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    ttsWillPlayRef.current = true;
    ttsInFlightRef.current = false;
    setIsGeneratingTts(false);
    setIsPlayingAudio(true);

    const textForFallback =
      panel.panel_content?.speech_bubbles?.[0]?.text
      ?? panel.panel_content?.narration
      ?? '';

    const armReadingFallback = () => {
      ttsWillPlayRef.current = false;
      setIsPlayingAudio(false);
      scheduleAutoAdvance(
        panel.panel_id,
        panel.next_panel_id,
        readingDelayMsForText(textForFallback),
      );
    };

    audio.play().catch(() => { armReadingFallback(); });

    audio.onerror = () => { armReadingFallback(); };
    // Stall: don't treat as permanent failure (mobile can stall briefly); leave fallbacks off
    // while still "playing". If it never recovers, user can tap; onended/onerror will handle.
    audio.onstalled = () => { /* keep ttsWillPlayRef true */ };

    audio.onended = () => {
      setIsPlayingAudio(false);
      ttsWillPlayRef.current = false;
      // Clear any stragglers, then post-voice min delay (only if still on this panel)
      cancelAutoAdvance();
      scheduleAutoAdvance(
        panel.panel_id,
        panel.next_panel_id,
        autoAdvanceMinDelayRef.current * 1000,
      );
    };
  }, [cancelAutoAdvance, readingDelayMsForText, scheduleAutoAdvance]);

  // Resolve Freeroam character external_id from world list or panel characters API.
  // Never invent ids — missing id means wait/retry, not generate under __narrator__.
  const resolveCharacterExternalId = useCallback(async (
    charName: string,
    panelId: string,
  ): Promise<string | undefined> => {
    const normalizedCharName = charName.toLowerCase().replace(/-/g, ' ');
    const worldChar = worldCharacters.find(c =>
      c.name?.toLowerCase().replace(/-/g, ' ') === normalizedCharName
    );
    if (worldChar?.external_id) return worldChar.external_id;

    try {
      const panelChars = await utils.worlds.getPanelCharacters.fetch({
        worldId: world.external_id,
        panelId,
      });
      const allPanelChars = [
        ...(panelChars.story_characters ?? []),
        ...(panelChars.world_characters ?? []),
      ];
      if (allPanelChars.length > 0) {
        setWorldCharacters(prev => {
          const existing = new Set(prev.map(c => c.external_id));
          const newChars = allPanelChars
            .filter(c => !existing.has(c.external_id))
            .map(c => ({ name: c.name, external_id: c.external_id }));
          return newChars.length > 0 ? [...prev, ...newChars] : prev;
        });
        const found = allPanelChars.find(c =>
          c.name?.toLowerCase().replace(/-/g, ' ') === normalizedCharName
        );
        if (found?.external_id) return found.external_id;
      }
    } catch {
      // Non-fatal — caller will retry later when worldCharacters loads
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.external_id, worldCharacters]);

  // TTS: trigger speech generation and playback for a panel
  const triggerTTS = useCallback(async (panel: PanelData) => {
    if (!panel.panel_content) return;
    if (!voiceEnabled) return; // Master voice toggle
    const speechBubble = panel.panel_content.speech_bubbles?.[0];
    if (!speechBubble || !speechBubble.text) return;
    // Abort if panel changed while we were awaiting (rapid navigation)
    const thisPanelId = panel.panel_id;
    const checkStillCurrent = () => thisPanelId === currentPanelIdRef.current;

    // Handle narration panels via narrator voice
    if (speechBubble.style === 'narration' || !speechBubble.character) {
      if (!narratorVoiceId) {
        // Narrator voice not loaded/configured yet — don't lock no-voice forever;
        // the narratorVoiceId retry effect will re-fire when the setting arrives.
        // Only confirm no-voice after settings query has resolved to null/empty.
        if (narratorVoiceId === null || narratorVoiceId === '') {
          confirmNoVoiceForPanel(panel);
        }
        return;
      }
      try {
        ttsInFlightRef.current = true;
        setIsGeneratingTts(true);
        // Get previous panel's text and voice for context
        const prevPanel = panel.prev_panel_id ? panelCache.current.get(panel.prev_panel_id) : null;
        const prevText = prevPanel?.panel_content?.speech_bubbles?.[0]?.text ?? prevPanel?.panel_content?.narration ?? undefined;
        const prevVoiceId = narratorVoiceId; // narrator voice is same across panels
        // Get next panel's text and voice for context
        const nextPanel = panel.next_panel as PanelData | null;
        const nextSpeechBubble = nextPanel?.panel_content?.speech_bubbles?.[0];
        const nextText = nextSpeechBubble?.text ?? nextPanel?.panel_content?.narration ?? undefined;
        const nextVoiceId = nextText ? narratorVoiceId : undefined; // assume narrator for narration panels
        const result = await generateSpeechMutation.mutateAsync({
          panelId: panel.panel_id,
          worldId: world.external_id,
          characterName: 'narrator',
          characterId: '__narrator__',
          text: speechBubble.text,
          voiceId: narratorVoiceId,
          stability: '0.5',
          similarityBoost: '0.75',
          style: '0',
          previousText: prevText,
          previousVoiceId: prevText ? prevVoiceId : undefined,
          nextText,
          nextVoiceId,
        });
        if (result.fromCache) setIsGeneratingTts(false); // cache hit — clear immediately
        if (!checkStillCurrent()) { ttsInFlightRef.current = false; return; }
        // If another request is already generating this panel's audio, poll until ready
        if ((result as { generating?: boolean }).generating && !result.audioUrl) {
          // Poll checkTtsReady every 2s until status=ready, then play inline
          const pollCharId = '__narrator__';
          let pollUrl: string | null = null;
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!checkStillCurrent()) { ttsInFlightRef.current = false; return; }
            try {
              const poll = await utils.voice.checkTtsReady.fetch({
                panelId: panel.panel_id,
                worldId: world.external_id,
                characterId: pollCharId,
              });
              if (poll.ready && poll.audioUrl) { pollUrl = poll.audioUrl; break; }
            } catch { /* non-fatal */ }
          }
          if (!checkStillCurrent()) { ttsInFlightRef.current = false; return; }
          if (pollUrl) {
            setCurrentAudioUrl(pollUrl);
            ttsInFlightRef.current = false;
            if (autoPlayEnabled) playAudioClip(pollUrl, panel);
            else confirmNoVoiceForPanel(panel); // have URL but autoplay off — treat as timed read
          } else {
            confirmNoVoiceForPanel(panel);
          }
          return;
        }
        if (result.audioUrl) {
          setCurrentAudioUrl(result.audioUrl);
          ttsInFlightRef.current = false;
          if (autoPlayEnabled) playAudioClip(result.audioUrl, panel);
          else confirmNoVoiceForPanel(panel);
        } else {
          confirmNoVoiceForPanel(panel);
        }
      } catch {
        ttsInFlightRef.current = false;
        setIsGeneratingTts(false);
        confirmNoVoiceForPanel(panel);
      }
      return;
    }

    if (speechBubble.style !== 'spoken') return;

    const charName = speechBubble.character;
    const text = speechBubble.text;

    // Look up voice assignment for this character — always keep characterId with the entry
    let voiceData = voiceCache.current.get(charName);

    // null = previously fetched, confirmed no voice assignment
    if (voiceData === null) {
      confirmNoVoiceForPanel(panel);
      return;
    }

    let charExternalId: string | undefined = voiceData?.characterId;

    // Always re-resolve external_id when missing (name-cache used to drop it and cause __narrator__ misses)
    if (!charExternalId) {
      charExternalId = await resolveCharacterExternalId(charName, panel.panel_id);
      if (!checkStillCurrent()) return;
    }

    if (voiceData === undefined) {
      // Not yet cached — fetch assignment once we have a stable character id
      if (!charExternalId) {
        // Character list not ready yet — wait for worldCharacters retry effects.
        // Do NOT generate, and do NOT mark confirmed no-voice (id may arrive shortly).
        return;
      }
      try {
        const assignment = await utils.voice.getVoiceAssignment.fetch({ characterId: charExternalId });
        if (!checkStillCurrent()) return;
        if (assignment) {
          voiceData = {
            voiceId: assignment.voiceId,
            voiceName: assignment.voiceName,
            stability: assignment.stability ?? null,
            similarityBoost: assignment.similarityBoost ?? null,
            style: assignment.style ?? null,
            languageCode: assignment.languageCode ?? null,
            characterId: charExternalId,
          };
          voiceCache.current.set(charName, voiceData);
        } else {
          voiceData = null;
          voiceCache.current.set(charName, null);
          confirmNoVoiceForPanel(panel);
          return;
        }
      } catch {
        // Don't cache on error — retry next time
        return;
      }
    } else if (voiceData && !voiceData.characterId && charExternalId) {
      // Backfill id onto an older-shaped cache entry if any
      voiceData = { ...voiceData, characterId: charExternalId };
      voiceCache.current.set(charName, voiceData);
    }

    if (!voiceData) {
      confirmNoVoiceForPanel(panel);
      return;
    }

    // Still no id after resolve attempt — wait for character list; don't fall back to __narrator__
    if (!charExternalId && !voiceData.characterId) {
      return;
    }

    // Prefer id stored on the voice entry (stable)
    const lookupCharId = voiceData.characterId || charExternalId!;

    try {
      ttsInFlightRef.current = true;
      setIsGeneratingTts(true);
      // Get previous panel's text and voice for context
      const prevPanelForChar = panel.prev_panel_id ? panelCache.current.get(panel.prev_panel_id) : null;
      const prevTextForChar = prevPanelForChar?.panel_content?.speech_bubbles?.[0]?.text ?? prevPanelForChar?.panel_content?.narration ?? undefined;
      const prevCharName = prevPanelForChar?.panel_content?.speech_bubbles?.[0]?.character;
      const prevVoiceDataForChar = prevCharName ? voiceCache.current.get(prevCharName) : undefined;
      const prevVoiceIdForChar = prevVoiceDataForChar?.voiceId ?? undefined;
      // Get next panel's text and voice for context
      const nextPanelForChar = panel.next_panel as PanelData | null;
      const nextSpeechBubbleForChar = nextPanelForChar?.panel_content?.speech_bubbles?.[0];
      const nextTextForChar = nextSpeechBubbleForChar?.text ?? nextPanelForChar?.panel_content?.narration ?? undefined;
      const nextCharName = nextSpeechBubbleForChar?.character;
      const nextVoiceDataForChar = nextCharName ? voiceCache.current.get(nextCharName) : undefined;
      const nextVoiceIdForChar = nextVoiceDataForChar?.voiceId ?? undefined;
      const result = await generateSpeechMutation.mutateAsync({
        panelId: panel.panel_id,
        worldId: world.external_id,
        characterName: charName,
        characterId: lookupCharId,
        text,
        voiceId: voiceData.voiceId,
        stability: voiceData.stability ?? '0.5',
        similarityBoost: voiceData.similarityBoost ?? '0.75',
        style: voiceData.style ?? '0',
        languageCode: voiceData.languageCode ?? undefined,
        previousText: prevTextForChar,
        previousVoiceId: prevTextForChar ? prevVoiceIdForChar : undefined,
        nextText: nextTextForChar,
        nextVoiceId: nextTextForChar ? nextVoiceIdForChar : undefined,
      });
      if (result.fromCache) setIsGeneratingTts(false); // cache hit — clear immediately
      if (!checkStillCurrent()) { ttsInFlightRef.current = false; return; }

      // If another request is already generating this panel's audio, poll until ready
      if ((result as { generating?: boolean }).generating && !result.audioUrl) {
        let pollUrl: string | null = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (!checkStillCurrent()) { ttsInFlightRef.current = false; return; }
          try {
            const poll = await utils.voice.checkTtsReady.fetch({
              panelId: panel.panel_id,
              worldId: world.external_id,
              characterId: lookupCharId,
            });
            if (poll.ready && poll.audioUrl) { pollUrl = poll.audioUrl; break; }
          } catch { /* non-fatal */ }
        }
        if (!checkStillCurrent()) { ttsInFlightRef.current = false; return; }
        if (pollUrl) {
          setCurrentAudioUrl(pollUrl);
          ttsInFlightRef.current = false;
          if (autoPlayEnabled) playAudioClip(pollUrl, panel);
          else confirmNoVoiceForPanel(panel);
        } else {
          confirmNoVoiceForPanel(panel);
        }
        return;
      }

      if (result.audioUrl) {
        setCurrentAudioUrl(result.audioUrl);
        ttsInFlightRef.current = false;
        if (autoPlayEnabled) playAudioClip(result.audioUrl, panel);
        else confirmNoVoiceForPanel(panel);
      } else {
        confirmNoVoiceForPanel(panel);
      }
    } catch {
      ttsInFlightRef.current = false;
      setIsGeneratingTts(false);
      confirmNoVoiceForPanel(panel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayEnabled, voiceEnabled, narratorVoiceId, world.external_id, worldCharacters, autoAdvanceEnabled, autoAdvanceMinDelay, resolveCharacterExternalId, confirmNoVoiceForPanel, playAudioClip]);

  // Keep loadPanelRef updated with latest loadPanel
  useEffect(() => { loadPanelRef.current = loadPanel; }, [loadPanel]);

  // Helper: only re-fire TTS if nothing is already playing / resolved for this panel
  const maybeRetryTts = useCallback((panel: PanelData | null) => {
    if (!panel) return;
    if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) return;
    if (currentAudioUrl) return;
    triggerTTS(panel);
  }, [currentAudioUrl, triggerTTS]);

  // Trigger TTS when panel changes and has spoken dialogue.
  // Also re-fired by worldCharacters / narratorVoiceId effects when deps arrive after open.
  // NOTE: The actual audio playback is in playAudioClip, which is called from triggerTTS.
  // NOTE: ttsWillPlayRef must be set to true before audio.play() and false on
  //       audio.onended/onerror/onstalled. The auto-advance fallback timer checks it.
  useEffect(() => {
    if (!currentPanel) return;
    // Reset TTS flags — triggerTTS will update them based on outcome
    ttsWillPlayRef.current = false;
    ttsConfirmedNoVoiceRef.current = false;
    ttsInFlightRef.current = false;
    setIsGeneratingTts(false); // Clear stuck GEN badge on panel change
    // Stop any currently playing audio
    audioRef.current?.pause();
    audioRef.current = null;
    setIsPlayingAudio(false);
    setCurrentAudioUrl(null);
    // Choice buffer lives in ChoiceComposer; remounted per panel via key below
    // Reset NSFW badge state on panel change
    setIsGeneratingNsfwImage(false);
    setIsClassifyingNsfwImage(false);
    // Keep story text for prev/current/next NSFW context (prev is not embedded on the API payload)
    rememberPanelStoryText(currentPanel);
    // Remember character_references whenever Freeroam sends them (first art panel), so later
    // same-art panels and regenerate can still resolve headshots without that panel in cache.
    {
      const img = currentPanel.panel_content?.images?.[0];
      const artKey = freeroamArtKey(img?.prompt, img?.url);
      const ownRefs = getPanelCharacterReferences(currentPanel);
      if (Object.keys(ownRefs).length > 0) rememberCharRefsForArt(artKey, ownRefs);
      const next = currentPanel.next_panel as PanelData | null | undefined;
      if (next) {
        const nImg = next.panel_content?.images?.[0];
        const nRefs = getPanelCharacterReferences(next);
        if (Object.keys(nRefs).length > 0) {
          rememberCharRefsForArt(freeroamArtKey(nImg?.prompt, nImg?.url), nRefs);
        }
      }
    }
    // Note: nsfwProcessedPanelsRef is intentionally NOT cleared on panel change
    // to prevent re-processing panels when currentPanel object reference changes for the same panel ID
    // Restore NSFW art for this panel (session map → fresh server cache). Never leave a
    // previously generated panel on Freeroam art just because we navigated away and back.
    if (unrestrictedImagesEnabled) {
      const img = currentPanel.panel_content?.images?.[0];
      const panelId = currentPanel.panel_id;
      const freeroamImageUrl = img?.url ?? undefined;
      const freeroamImagePrompt = img?.prompt ?? undefined;
      const artKey = freeroamArtKey(freeroamImagePrompt, freeroamImageUrl);
      const sessionHit = lookupSessionNsfw(panelId, artKey);
      if (sessionHit) {
        // Stable URL (no cache-bust) so ambient/main don't flash on every nav
        // Seed this panel id so future visits hit panel map first
        nsfwByPanelIdRef.current.set(panelId, nsfwUrlBase(sessionHit));
        nsfwProcessedPanelsRef.current.add(panelId);
        setNsfwImageUrl(nsfwUrlBase(sessionHit));
      } else if (img?.prompt || freeroamImageUrl) {
        // Clear previous panel's NSFW immediately so ambient doesn't show wrong art,
        // then restore if server has ready for this panel/art (prompt OR url is enough).
        setNsfwImageUrl(null);
        (async () => {
          try {
            const cached = await fetchImageCacheFresh({
              panelId,
              freeroamImageUrl,
              freeroamImagePrompt,
            });
            if (currentPanelIdRef.current !== panelId) return;
            if (cached.status === 'ready' && cached.imageUrl) {
              rememberNsfwImage(panelId, artKey, cached.imageUrl, false);
            }
          } catch {
            // leave Freeroam art
          }
        })();
      } else {
        setNsfwImageUrl(null);
      }
    } else {
      setNsfwImageUrl(null);
    }
    // Fire TTS in background (non-blocking). Spoken lines without char id will no-op
    // until worldCharacters retry; narration waits for narratorVoiceId if needed.
    triggerTTS(currentPanel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanel?.panel_id]);

  // Re-fire TTS when worldCharacters first arrives (async after initial load).
  // Spoken dialogue needs stable Freeroam character ids for cache lookup.
  const worldCharactersLoadedRef = useRef(false);
  useEffect(() => {
    if (worldCharacters.length === 0) return;
    if (worldCharactersLoadedRef.current) return; // Only retry on the FIRST population
    worldCharactersLoadedRef.current = true;
    maybeRetryTts(currentPanel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldCharacters]);

  // Re-fire TTS when narrator voice setting arrives after initial panel load.
  const narratorVoiceReadyRef = useRef(false);
  useEffect(() => {
    if (!narratorVoiceId) return;
    if (narratorVoiceReadyRef.current) return;
    narratorVoiceReadyRef.current = true;
    const bubble = currentPanel?.panel_content?.speech_bubbles?.[0];
    const isNarration = !!bubble && (bubble.style === 'narration' || !bubble.character);
    if (!isNarration) return;
    maybeRetryTts(currentPanel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narratorVoiceId]);

  // NSFW image detection and replacement.
  // Server single-flight (unique panelId claim) is the source of truth; client Set is a session optimization.
  useEffect(() => {
    if (!currentPanel || !unrestrictedImagesEnabled) return;
    const img = currentPanel.panel_content?.images?.[0];
    if (!img?.prompt) return;
    const prompt = img.prompt;
    const panelId = currentPanel.panel_id;
    const freeroamImageUrl = img.url ?? undefined;
    const freeroamImagePrompt = img.prompt ?? undefined;
    const artKey = freeroamArtKey(freeroamImagePrompt, freeroamImageUrl);
    // Forced re-run (regenerate button). Keep the flag until generate actually starts so
    // React Strict Mode double-invoke still sees forceRegen=true on the second run.
    const forceRegen = nsfwForceRegenPanelRef.current === panelId;

    // Session hit for this panel or same Freeroam art — restore, never re-generate
    // (unless user just hit regenerate — maps were cleared)
    const sessionHit = lookupSessionNsfw(panelId, artKey);
    if (sessionHit && !forceRegen) {
      rememberNsfwImage(panelId, artKey, sessionHit);
      nsfwProcessedPanelsRef.current.add(panelId);
      return;
    }

    // On force regen, clear any stale locks so we always start a new job
    if (forceRegen) {
      nsfwInFlightRef.current.delete(panelId);
      nsfwProcessedPanelsRef.current.delete(panelId);
    }

    // Already decided this panel this session — restore from server if ready.
    // If still classifying/generating (user left mid-job), unstick and re-poll with badges.
    // If cache was cleared (not_found), prefer session art-key hit over re-running Seedream
    // (common after regenerate wiped sibling rows but this session still has the image).
    if (nsfwProcessedPanelsRef.current.has(panelId) && !forceRegen) {
      (async () => {
        try {
          const sessionAgain = lookupSessionNsfw(panelId, artKey);
          if (sessionAgain) {
            rememberNsfwImage(panelId, artKey, sessionAgain);
            return;
          }
          const cached = await fetchImageCacheFresh({ panelId, freeroamImageUrl, freeroamImagePrompt });
          if (cached.status === 'ready' && cached.imageUrl) {
            rememberNsfwImage(panelId, artKey, cached.imageUrl);
            return;
          }
          if (cached.status === 'skipped') {
            return; // stay on Freeroam art — do not re-classify on remount
          }
          if (cached.status === 'classifying' || cached.status === 'generating') {
            // Job still running on server after we navigated away — re-attach badges + poll
            nsfwProcessedPanelsRef.current.delete(panelId);
            nsfwInFlightRef.current.delete(panelId);
            setNsfwRegenNonce(n => n + 1);
            return;
          }
          if (cached.status === 'not_found') {
            // Only re-run if we truly have no session image for this art
            if (lookupSessionNsfw(panelId, artKey)) {
              rememberNsfwImage(panelId, artKey, lookupSessionNsfw(panelId, artKey)!);
              return;
            }
            nsfwProcessedPanelsRef.current.delete(panelId);
            nsfwInFlightRef.current.delete(panelId);
            setNsfwRegenNonce(n => n + 1);
          }
        } catch { /* non-fatal */ }
      })();
      return;
    }

    // Already running generate/poll for this panel (covers Strict Mode + fast re-entry)
    if (nsfwInFlightRef.current.has(panelId)) return;
    nsfwInFlightRef.current.add(panelId);

    const runId = ++nsfwRunIdRef.current;
    let cancelled = false;
    const isActiveRun = () => !cancelled && nsfwRunIdRef.current === runId;

    (async () => {
      try {
        const cached = await fetchImageCacheFresh({
          panelId,
          freeroamImageUrl,
          freeroamImagePrompt,
        });
        if (!isActiveRun()) return;

        // After regenerate we clear cache — still allow reuse only when NOT forcing
        if (cached.status === 'ready' && cached.imageUrl && !forceRegen) {
          rememberNsfwImage(panelId, artKey, cached.imageUrl);
          nsfwProcessedPanelsRef.current.add(panelId);
          return;
        }
        // Classified SFW earlier (this panel or same art) — do not call Seedream again
        // (unless regenerate forced a cache clear; skipped row should be gone)
        if (cached.status === 'skipped' && !forceRegen) {
          nsfwProcessedPanelsRef.current.add(panelId);
          return;
        }

        // Sync badges from cache status: CHECK = classifying, IMG = Seedream generating
        const applyStatusBadges = (status: string) => {
          if (!isActiveRun()) return;
          setIsClassifyingNsfwImage(status === 'classifying');
          setIsGeneratingNsfwImage(status === 'generating');
        };
        const clearNsfwBadges = () => {
          if (nsfwRunIdRef.current !== runId) return; // newer run owns badges
          setIsClassifyingNsfwImage(false);
          setIsGeneratingNsfwImage(false);
        };

        // Match server Seedream wait (server/nsfwImageCache.ts SEEDREAM_POLL_* ≈ 5 min)
        const pollUntilSettled = async () => {
          for (let i = 0; i < 200; i++) { // 200 × 1.5s ≈ 5 min
            if (!isActiveRun()) return null;
            await new Promise(r => setTimeout(r, 1500));
            const poll = await fetchImageCacheFresh({
              panelId,
              freeroamImageUrl,
              freeroamImagePrompt,
            });
            applyStatusBadges(poll.status);
            if (poll.status === 'ready' && poll.imageUrl) return poll;
            if (poll.status === 'skipped') return poll;
            if (poll.status === 'not_found') return poll;
          }
          return null;
        };

        const adoptReady = (url: string) => {
          // Always store in session maps even if this React run was cancelled (Strict Mode),
          // so a remount / sibling run can restore immediately.
          // Cache-bust only on force regenerate (same file path overwritten on disk).
          rememberNsfwImage(panelId, artKey, url, forceRegen);
          nsfwProcessedPanelsRef.current.add(panelId);
        };

        // Seedream already running (or another tab) — show IMG and wait
        if (cached.status === 'generating' && !forceRegen) {
          applyStatusBadges('generating');
          const poll = await pollUntilSettled();
          clearNsfwBadges();
          if (poll?.status === 'ready' && poll.imageUrl) {
            adoptReady(poll.imageUrl);
            return;
          }
          if (poll?.status === 'skipped') {
            nsfwProcessedPanelsRef.current.add(panelId);
            return;
          }
          // Stale claim released (not_found) — fall through and start our own job
        }

        // DeepSeek in progress elsewhere — show CHECK until classify finishes or Seedream starts
        if (cached.status === 'classifying' && !forceRegen) {
          applyStatusBadges('classifying');
          const poll = await pollUntilSettled();
          clearNsfwBadges();
          if (poll?.status === 'ready' && poll.imageUrl) {
            adoptReady(poll.imageUrl);
            return;
          }
          if (poll?.status === 'skipped') {
            nsfwProcessedPanelsRef.current.add(panelId);
            return;
          }
          // Stale claim released (not_found) — fall through and start our own job
        }

        // character_references usually only exist on the Freeroam panel that first got this art.
        // Full generate requires a non-empty cast (this panel or borrowed from same-art cache).
        // Without refs: keep Freeroam art; do not classify/Seedream (empty headshots = bad swaps).
        const charRefs = resolveCharacterReferencesForArt(currentPanel, freeroamImageUrl, freeroamImagePrompt);
        if (Object.keys(charRefs).length === 0) {
          console.warn('[NSFW] Skipping generate — no character_references for this art yet', {
            panelId,
            freeroamImageUrl,
            artKey,
            forceRegen,
          });
          if (forceRegen) {
            nsfwForceRegenPanelRef.current = null;
            setIsClassifyingNsfwImage(false);
            toast.error('Cannot regenerate: no character references on this panel yet');
          }
          // Do not mark processed: later visit may hit session/cache after the first art panel generates,
          // or we may navigate to a panel that still has refs.
          return;
        }

        // Consume force flag only once we are committed to a real generate
        if (forceRegen && nsfwForceRegenPanelRef.current === panelId) {
          nsfwForceRegenPanelRef.current = null;
        }

        // Show CHECK immediately so regenerate is never a silent no-op
        if (isActiveRun()) {
          setIsClassifyingNsfwImage(true);
          setIsGeneratingNsfwImage(false);
        }

        let actionText = ((currentPanel.panel_content as unknown as { action?: string | null })?.action ?? null) as string | null;
        if (!actionText && currentPanel.prev_panel_id) {
          const prevPanel = panelCache.current.get(currentPanel.prev_panel_id);
          const prevAction = ((prevPanel?.panel_content as unknown as { action?: string | null })?.action ?? null) as string | null;
          if (prevAction) actionText = prevAction;
        }
        if (actionText) {
          actionText = actionText.replace(/^change\s+the\s+image\s+to\s+/i, '').trim();
          if (!actionText) actionText = null;
        }

        try {
          // Freeroam embeds next_panel; prev is only available if visited / remembered this session.
          const prevPanel = currentPanel.prev_panel_id ? panelCache.current.get(currentPanel.prev_panel_id) : undefined;
          const nextPanelData =
            (currentPanel.next_panel as PanelData | null | undefined) ??
            (currentPanel.next_panel_id ? panelCache.current.get(currentPanel.next_panel_id) : undefined);

          rememberPanelStoryText(currentPanel);
          const prevPanelText =
            extractPanelStoryText(prevPanel)
            ?? (currentPanel.prev_panel_id ? panelStoryTextRef.current.get(currentPanel.prev_panel_id) ?? null : null);
          const currentPanelText =
            extractPanelStoryText(currentPanel)
            ?? panelStoryTextRef.current.get(panelId)
            ?? null;
          const nextPanelText =
            extractPanelStoryText(nextPanelData)
            ?? (currentPanel.next_panel_id ? panelStoryTextRef.current.get(currentPanel.next_panel_id) ?? null : null);

          console.log('[NSFW] Starting classify/generate', {
            panelId,
            forceRegen,
            hasPrev: !!prevPanelText,
            hasCurrent: !!currentPanelText,
            hasNext: !!nextPanelText,
            refCount: Object.keys(charRefs).length,
          });

          // While mutateAsync runs (classify → maybe Seedream), poll for CHECK / IMG badges.
          let stopBadgePoll = false;
          const badgePoll = (async () => {
            while (!stopBadgePoll && isActiveRun()) {
              await new Promise(r => setTimeout(r, 500));
              if (stopBadgePoll || !isActiveRun()) break;
              try {
                const s = await fetchImageCacheFresh({
                  panelId,
                  freeroamImageUrl,
                  freeroamImagePrompt,
                });
                applyStatusBadges(s.status);
                if (s.status === 'ready' || s.status === 'skipped' || s.status === 'not_found') break;
              } catch {
                // ignore poll errors
              }
            }
          })();

          const result = await generateNsfwImageMutation.mutateAsync({
            panelId,
            worldId: world.external_id,
            prompt,
            imageUrl: img.url ?? null,
            actionText,
            prevPanelText,
            currentPanelText,
            nextPanelText,
            shot: img.shot ?? null,
            characterReferences: charRefs,
            debug: true, // always log server Seedream prompt for now
          });
          stopBadgePoll = true;
          await badgePoll.catch(() => {});

          // Adopt successful results even if this React effect was cancelled (navigated away /
          // Strict Mode) — store in session maps so coming back restores the image.
          // Do NOT mark "processed" if we only left mid-job; return visit must re-show CHECK/IMG.
          if (result.generating || (result as { classifying?: boolean }).classifying) {
            if (isActiveRun()) {
              applyStatusBadges(result.generating ? 'generating' : 'classifying');
            }
            const poll = await pollUntilSettled();
            if (poll?.status === 'ready' && poll.imageUrl) {
              adoptReady(poll.imageUrl);
            } else if (poll?.status === 'skipped') {
              nsfwProcessedPanelsRef.current.add(panelId);
            }
            // poll null (cancelled / navigated away) or still in progress: leave unprocessed
          } else if (result.imageUrl) {
            adoptReady(result.imageUrl);
          } else if (isActiveRun()) {
            // notNsfw / no image — mark this panel (and same-art panels we know) so remount
            // does not re-run Seedream after a forced regenerate of a skipped panel.
            nsfwProcessedPanelsRef.current.add(panelId);
            if (artKey) {
              for (const [pid, p] of panelCache.current.entries()) {
                const pImg = p.panel_content?.images?.[0];
                if (freeroamArtKey(pImg?.prompt, pImg?.url) === artKey) {
                  nsfwProcessedPanelsRef.current.add(pid);
                }
              }
            }
            if (forceRegen && currentPanelIdRef.current === panelId) {
              console.warn('[NSFW] Regenerate finished without image (notNsfw or empty)', result);
            }
          }
        } catch (err) {
          console.error('[NSFW] client generate failed', err);
          if (forceRegen && currentPanelIdRef.current === panelId) {
            toast.error('Image regenerate failed — see console');
          }
          // Leave unprocessed so a later visit can retry after server released the claim
          nsfwProcessedPanelsRef.current.delete(panelId);
        } finally {
          clearNsfwBadges();
        }
      } catch {
        // Outer catch — non-fatal
      } finally {
        // Always free this panel's client lock when our async ends (even if a newer run
        // incremented runId — that run has its own add). Safe if already deleted.
        nsfwInFlightRef.current.delete(panelId);
      }
    })();

    return () => {
      cancelled = true;
      // Leaving the panel: free lock so coming back can re-attach to a still-running server job
      nsfwInFlightRef.current.delete(panelId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanel?.panel_id, unrestrictedImagesEnabled, nsfwRegenNonce]);

  // Auto-advance timer: fires when panel changes and auto-advance is enabled.
  // Voiced panels: playAudioClip onended → scheduleAutoAdvance(minDelay).
  // Unvoiced panels: reading-time / static delay via scheduleAutoAdvance.
  // While TTS may still start: reading-time no-voice check + 2× fallback that waits if in-flight.
  useEffect(() => {
    if (!currentPanel || !autoAdvanceEnabled || autoAdvancePaused) return;
    // Don't auto-advance on choice, action, or polling panels
    if (currentPanel.requires_action || currentPanel.is_action || isPolling) return;
    // Don't auto-advance if there's no next panel
    if (!currentPanel.next_panel_id) return;

    const panelId = currentPanel.panel_id;
    const nextId = currentPanel.next_panel_id;
    const speechBubble = currentPanel.panel_content?.speech_bubbles?.[0];
    const narration = currentPanel.panel_content?.narration;
    const isSpokenBubble = speechBubble?.style === 'spoken' && !!speechBubble?.text;
    const isNarrationBubble = (speechBubble?.style === 'narration' || !speechBubble?.character) && !!speechBubble?.text;
    const hasNarrationField = !!narration;
    const hasSpeakableText = isSpokenBubble || isNarrationBubble || hasNarrationField;
    const hasAnyText = !!speechBubble?.text || !!narration;
    const textForTiming = speechBubble?.text ?? narration ?? '';
    const totalDelay = readingDelayMsForText(textForTiming);

    if (hasSpeakableText && voiceEnabled) {
      const charName = speechBubble?.character;
      const cachedVoice = charName ? voiceCache.current.get(charName) : undefined;
      const knownNoVoice = cachedVoice === null; // null = fetched, confirmed no voice
      const isNarrationNoVoice = (isNarrationBubble || hasNarrationField) && !narratorVoiceId;

      if (knownNoVoice || isNarrationNoVoice) {
        // Definitely no voice — reading-time advance
        scheduleAutoAdvance(panelId, nextId, totalDelay);
      } else {
        // Voice might play — arm two timers:
        // 1) reading-speed: advance if TTS already confirmed no voice
        // 2) 2× fallback: advance only if audio never started AND TTS is not still in-flight
        noVoiceTimerRef.current = setTimeout(() => {
          noVoiceTimerRef.current = null;
          if (currentPanelIdRef.current !== panelId) return;
          if (ttsConfirmedNoVoiceRef.current && !ttsWillPlayRef.current && !ttsInFlightRef.current) {
            scheduleAutoAdvance(panelId, nextId, 0);
          }
        }, totalDelay);

        autoAdvanceTimerRef.current = setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          if (currentPanelIdRef.current !== panelId) return;
          if (ttsWillPlayRef.current) return; // audio playing — onended owns advance
          if (ttsInFlightRef.current) {
            // Still generating/polling — extend wait (up to ~30s more in 2s steps via re-arm)
            let extensions = 0;
            const extend = () => {
              if (currentPanelIdRef.current !== panelId) return;
              if (ttsWillPlayRef.current) return;
              if (ttsInFlightRef.current && extensions < 15) {
                extensions += 1;
                autoAdvanceTimerRef.current = setTimeout(extend, 2000);
                return;
              }
              // Done waiting — advance if nothing is playing
              if (!ttsWillPlayRef.current) {
                scheduleAutoAdvance(panelId, nextId, 0);
              }
            };
            autoAdvanceTimerRef.current = setTimeout(extend, 2000);
            return;
          }
          // No audio, not in flight — safe to advance (unvoiced or TTS gave up)
          scheduleAutoAdvance(panelId, nextId, 0);
        }, totalDelay * 2);
      }
    } else if (hasAnyText) {
      scheduleAutoAdvance(panelId, nextId, totalDelay);
    } else {
      scheduleAutoAdvance(panelId, nextId, autoAdvanceStaticDelay * 1000);
    }
    return () => cancelAutoAdvance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanel?.panel_id, autoAdvanceEnabled, autoAdvancePaused]);

  // Cleanup: stop polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // Initial load + fetch bookmarks + fetch world detail
  useEffect(() => {
    loadPanel(initialPanelId, world.external_id);
    requestAnimationFrame(() => setVisible(true));

    // Helper: call tRPC endpoint directly (bypasses query cache) so errors don't hit the global error handler
    const trpcGet = async <T,>(procedure: string, input: Record<string, unknown>): Promise<T | null> => {
      try {
                const params = encodeURIComponent(JSON.stringify({ '0': { json: input } }));
        const res = await fetch(`/api/trpc/${procedure}?batch=1&input=${params}`, {
          credentials: 'include',
          headers: {
          ...getFreeroamAuthHeaders(),
        },
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.[0]?.result?.data?.json ?? null;
      } catch {
        return null;
      }
    };

    // Fetch bookmarks
    trpcGet<{ progress_panel: typeof progressPanel; bookmarks: Array<{ panel_external_id: string; depth: number; image_url: string; type: 'bookmark' | 'progress' }> }>('worlds.listBookmarks', { worldId: world.external_id })
      .then((data) => {
        if (!data) return;
        const ids = new Set(data.bookmarks.map(b => b.panel_external_id));
        setBookmarkedPanelIds(ids);
        setBookmarkList(data.bookmarks);
        setProgressPanel(data.progress_panel);
      });
    // Fetch world detail for tags + related worlds + like state
    trpcGet<{ tags: Array<{ id: number; name: string; is_fandom: boolean; emoji: string | null }>; related_worlds: Array<{ external_id: string; name: string; logline: string; cover_image_url: string | null; owner: { username: string; is_verified: boolean; avatar_url: string | null }; interaction_count: number; tag_name: string; tag_is_fandom: boolean }>; characters: Array<{ name: string; external_id: string }>; is_liked: boolean; like_count: number }>('worlds.get', { worldId: world.external_id })
      .then((data) => {
        if (!data) return;
        setWorldDetail({ tags: data.tags, related_worlds: data.related_worlds });
        if (data.characters) setWorldCharacters(data.characters);
        setIsLiked(!!data.is_liked);
        setLikeCount(data.like_count ?? 0);
      });
    // Fetch user preferences for choice ideas setting
    trpcGet<{ resolved_show_choice_ideas_by_default: boolean }>('preferences.get', {})
      .then((data) => {
        if (!data) return;
        const show = !!data.resolved_show_choice_ideas_by_default;
        setShowChoiceIdeasByDefault(show);
        setChoiceIdeasVisible(show);
      });
    // Fetch journal for chapters + journal tab data
    trpcGet<{ summary: string | null; chapters: Array<{ chapter_number: number; panel_external_id: string; image_url: string }>; compressedSummaries: Array<{ type: string; level: number; chapter_numbers: number[]; content: string }>; entityState?: { characters?: Array<{ name: string; state: string; appearance: string; display_headshot_url: string; headshot_url: string }>; locations?: Array<{ name: string; description: string; position: string }>; misc?: Array<{ name: string; description: string; state: string }> }; narrativeThreads?: Array<{ id: string; title: string; importance: string; status: string; notes: string[] }> }>('worlds.getJournal', { worldId: world.external_id })
      .then((data) => {
        if (!data) return;
        setChapters(data.chapters ?? []);
        setJournalData({
          summary: data.summary ?? null,
          compressedSummaries: data.compressedSummaries ?? [],
          entityCharacters: data.entityState?.characters ?? [],
          entityLocations: data.entityState?.locations ?? [],
          entityMisc: data.entityState?.misc ?? [],
          narrativeThreads: data.narrativeThreads ?? [],
        });
      });
  }, []);

  // Poll when forward_state=generating and next_panel_id is null (AI still working).
  // Also restarts polling when navigating back to a panel that is still generating.
  // NOTE: The polling condition (forward_state=generating && !next_panel_id) is also
  //       duplicated in handleNavigate's embedded fast path (line ~1053).
  //       If you change the condition here, update that site too.
  // NOTE: Do NOT add forward_state=ready here — that state is a Freeroam API quirk
  //       that causes unwanted auto-advance on already-generated panels.
  useEffect(() => {
    if (!currentPanel) return;
    const { forward_state, next_panel_id, is_action } = currentPanel;
    // Polling strategy for generating panels:
    // - Action panels OR panels with no next_panel_id yet: use startPolling (nextReady loop, auto-navigates)
    // - Non-action panels with next_panel_id already set: use startDirectPanelPolling
    //   (retries loading the known panel ID without auto-advancing — prevents skipping dialogue panels)
    if (forward_state === 'generating' && !isPolling) {
      if (is_action || !next_panel_id) {
        startPolling(currentPanel.panel_id);
      } else if (next_panel_id) {
        startDirectPanelPolling(next_panel_id);
      }
    }
    // NOTE: Do NOT add isPolling to deps or include stopPolling in cleanup here.
    // Doing so creates an infinite loop: isPolling change → effect re-runs → cleanup
    // calls stopPolling → isPolling changes → effect re-runs → repeat.
    // Polling is stopped by loadPanel and handleNavigate when the panel changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanel?.panel_id, currentPanel?.forward_state, currentPanel?.next_panel_id, currentPanel?.is_action]);

  // Safety reset: if isNavigating has been stuck true for >5s, reset it
  useEffect(() => {
    if (!isNavigating) return;
    const timer = setTimeout(() => setIsNavigating(false), 5000);
    return () => clearTimeout(timer);
  }, [isNavigating]);

  const handleNavigate = useCallback(async (direction: 'prev' | 'next') => {
    // Allow backward navigation even while polling; only block forward when actively polling
    if (!currentPanel || isNavigating) return;
    if (direction === 'next' && isPolling) return;
    const targetId = direction === 'prev' ? currentPanel.prev_panel_id : currentPanel.next_panel_id;
    if (!targetId) return;
    // For action panels going forward: check cache first, then poll if not cached
    if (direction === 'next' && currentPanel.is_action) {
      // If next panel is already cached, use it instantly
      if (targetId && panelCache.current.has(targetId)) {
        await loadPanel(targetId, world.external_id);
        return;
      }
      // Not cached — start polling next-ready
      startPolling(currentPanel.panel_id);
      return;
    }
    // For forward navigation: use the embedded next_panel data if available (instant, no fetch)
    if (direction === 'next' && currentPanel.next_panel) {
      const embedded = currentPanel.next_panel as PanelData;
      stopPolling();
      cancelAutoAdvance();
      // Stop any playing audio so it doesn't bleed into the next panel
      audioRef.current?.pause();
      audioRef.current = null;
      setIsPlayingAudio(false);
      setCurrentAudioUrl(null);
      setIsNavigating(true);
      setChoiceIdeasVisible(showChoiceIdeasByDefault);
      const embeddedPanel = { ...embedded, next_panel: embedded.next_panel ?? null } as PanelData;
      // Store in cache for backward navigation
      panelCache.current.set(embedded.panel_id, embeddedPanel);
      // Also cache the embedded panel's next_panel if present
      if (embedded.next_panel) {
        const next2 = embedded.next_panel as PanelData;
        if (next2.panel_id) panelCache.current.set(next2.panel_id, next2);
      }
      setCurrentPanel(embeddedPanel); currentPanelIdRef.current = (embeddedPanel)?.panel_id ?? null;
      setPanelMutation.mutate({ worldId: world.external_id, panelId: embedded.panel_id });
      setIsNavigating(false);
      setIsLoading(false);
      // If the embedded panel is still generating, start polling.
      // NOTE: This condition mirrors the polling effect at line ~991.
      //       If you change it here, update that effect too.
      // NOTE: Do NOT use forward_state=ready here — see comment in the polling effect.
      // Poll on all generating panels, even if next_panel_id is already set
      // (mirrors the polling effect condition above)
      if (embedded.forward_state === 'generating') {
        startPolling(embedded.panel_id);
      }
      return;
    }
    await loadPanel(targetId, world.external_id);
  }, [currentPanel, isNavigating, isPolling, loadPanel, startPolling, world.external_id, stopPolling, showChoiceIdeasByDefault, setPanelMutation]);

  const handleChoice = useCallback(async (choiceText: string) => {
    // Send the choice as an action to Freeroam — this triggers generation of the action panel
    await handleSendAction(choiceText, 'choice');
  }, [handleSendAction]);

  const handleToggleLike = useCallback(async () => {
    if (isTogglingLike) return;
    setIsTogglingLike(true);
    const wasLiked = isLiked;
    // Optimistic update
    setIsLiked(!wasLiked);
    setLikeCount(prev => prev !== undefined ? (wasLiked ? Math.max(0, prev - 1) : prev + 1) : undefined);
    try {
      const result = wasLiked
        ? await unlikeMutation.mutateAsync({ worldId: world.external_id })
        : await likeMutation.mutateAsync({ worldId: world.external_id });
      setLikeCount(result.like_count);
    } catch (err) {
      // Rollback
      setIsLiked(wasLiked);
      setLikeCount(prev => prev !== undefined ? (wasLiked ? prev + 1 : Math.max(0, prev - 1)) : undefined);
      toast.error(err instanceof Error ? err.message : 'Failed to update like');
    } finally {
      setIsTogglingLike(false);
    }
  }, [isTogglingLike, isLiked, world.external_id, likeMutation, unlikeMutation]);

  const handleRemoveBookmarkFromMenu = useCallback(async (panelId: string) => {
    // Optimistic update
    setBookmarkedPanelIds(prev => { const next = new Set(prev); next.delete(panelId); return next; });
    setBookmarkList(prev => prev.filter(b => b.panel_external_id !== panelId));
    try {
      await removeBookmarkMutation.mutateAsync({ panelId });
    } catch (err) {
      // Rollback
      setBookmarkList(prev => [...prev]); // re-fetch would be ideal but keep simple
      toast.error(err instanceof Error ? err.message : 'Failed to remove bookmark');
    }
  }, [removeBookmarkMutation]);

  const handleToggleBookmark = useCallback(async () => {
    if (!currentPanel || isTogglingBookmark) return;
    const panelId = currentPanel.panel_id;
    const isCurrentlyBookmarked = bookmarkedPanelIds.has(panelId);
    setIsTogglingBookmark(true);
    // Optimistic update
    setBookmarkedPanelIds(prev => {
      const next = new Set(prev);
      if (isCurrentlyBookmarked) next.delete(panelId);
      else next.add(panelId);
      return next;
    });
    try {
      if (isCurrentlyBookmarked) {
        await removeBookmarkMutation.mutateAsync({ panelId });
      } else {
        await addBookmarkMutation.mutateAsync({ panelId });
      }
    } catch (err) {
      // Rollback optimistic update on failure
      setBookmarkedPanelIds(prev => {
        const next = new Set(prev);
        if (isCurrentlyBookmarked) next.add(panelId);
        else next.delete(panelId);
        return next;
      });
      toast.error(err instanceof Error ? err.message : 'Failed to update bookmark');
    } finally {
      setIsTogglingBookmark(false);
    }
  }, [currentPanel, isTogglingBookmark, bookmarkedPanelIds, addBookmarkMutation, removeBookmarkMutation]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept keys when the user is typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') handleNavigate('prev');
      if (e.key === 'ArrowRight') handleNavigate('next');
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNavigate, onClose]);

  const panel = currentPanel;
  const content = panel?.panel_content;
  const image = content?.images?.[0];
  const originalImageUrl = image?.url ?? null;

  // The image URL to display — NSFW replacement takes priority over original
  // Only use NSFW replacement when unrestricted images is enabled
  const imageUrl = (unrestrictedImagesEnabled && nsfwImageUrl) ? nsfwImageUrl : originalImageUrl;

  // Ambient: keep previous background until the next image is decoded, so panel changes
  // don't flash black / freeroam while a (local) NSFW URL loads. Freeroam CDN is usually
  // warm-cached; local /api/nsfw-images was reloading every visit because of ?v= busting.
  const [ambientUrl, setAmbientUrl] = useState<string | null>(null);
  const ambientUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!imageUrl) {
      setAmbientUrl(null);
      ambientUrlRef.current = null;
      return;
    }
    if (imageUrl === ambientUrlRef.current) return;
    let cancelled = false;
    const pre = new window.Image();
    pre.onload = () => {
      if (cancelled) return;
      ambientUrlRef.current = imageUrl;
      setAmbientUrl(imageUrl);
    };
    pre.onerror = () => {
      if (cancelled) return;
      ambientUrlRef.current = imageUrl;
      setAmbientUrl(imageUrl);
    };
    pre.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl]);
  const ambientBg = ambientUrl ?? imageUrl;

  const speechBubble = content?.speech_bubbles?.[0] ?? null;
  const narration = content?.narration ?? null;
  const choice = content?.choice ?? null;
  const isAwaitingChoice = panel?.forward_state === 'awaiting_choice';
  // Show choice UI whenever choice data exists (even when navigating back to a completed choice panel)
  const hasChoice = !!choice && choice.options && choice.options.length > 0;
  const choiceAlreadyMade = hasChoice && !!choice?.selected_choice;
  const canGoBack = !!panel?.prev_panel_id;
  const canGoForward = !isAwaitingChoice && !!panel?.next_panel_id;

  // Text rendering logic
  // speech_bubbles[0].style can be: 'spoken', 'narration', 'action', etc.
  const isSpoken = speechBubble?.style === 'spoken';
  const isNarrationBubble = speechBubble?.style === 'narration';
  const isActionBubble = speechBubble?.style === 'action';
  // Replace hyphens with spaces in character names for display (e.g. 'Aerith-Guthrie' → 'Aerith Guthrie')
  const speakerName = isSpoken ? (speechBubble?.character?.replace(/-/g, ' ') ?? null) : null;
  // Narration: content.narration field, OR speech_bubble with style='narration', OR any unknown/null style (fallback)
  const isUnknownStyle = speechBubble && !isSpoken && !isNarrationBubble && !isActionBubble;
  const narrationText = narration ?? ((isNarrationBubble || isUnknownStyle) ? speechBubble?.text ?? null : null);
  // Dialogue is only spoken style
  const dialogueText = isSpoken ? speechBubble?.text ?? null : null;
  // Action text (user's own action, shown differently)
  const actionText = isActionBubble ? speechBubble?.text ?? null : null;
  const hasText = !!(narrationText || dialogueText || actionText);
  const accentColor = speakerName ? getAccentColor(speakerName) : null;

  // Bookmark state for current panel
  const isBookmarked = panel ? bookmarkedPanelIds.has(panel.panel_id) : false;

  // Touch long-press = Save Image (native); must not also fire advance.
  // Desktop: left-click always advances (middle/right of art = next); right-click = browser Save Image.
  const panelImgPressRef = useRef<{ x: number; y: number; t: number; pointerType: string } | null>(null);

  /** Freeroam desktop: click center of art advances; right-click saves. Mobile: short tap advances, long-press saves. */
  const handlePanelImageNavigate = useCallback((e: ReactMouseEvent<HTMLImageElement>) => {
    if (isNavigating) return;
    // Right-click / middle-click: let the browser handle (context menu for Save Image)
    if (e.button !== 0) return;

    const start = panelImgPressRef.current;
    panelImgPressRef.current = null;
    // Only suppress navigation after a long-press / drag for touch/pen — not mouse
    // (a slow desktop click often exceeds 400ms and was incorrectly blocked).
    if (start && (start.pointerType === 'touch' || start.pointerType === 'pen')) {
      const dt = Date.now() - start.t;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dt > 400 || dist > 14) return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Freeroam-style: left strip = back; center + right = forward
    const leftZone = rect.width * 0.28;
    if (x < leftZone) {
      if (canGoBack) void handleNavigate('prev');
    } else if (canGoForward && !isPolling && !isRegeneratePolling) {
      void handleNavigate('next');
    }
  }, [isNavigating, canGoBack, canGoForward, isPolling, isRegeneratePolling, handleNavigate]);

  /** Unrestricted image regen is available only on panels with character_references (source art). */
  const canRegenerateNsfwImage =
    unrestrictedImagesEnabled
    && !!image?.prompt
    && !!currentPanel
    && Object.keys(getPanelCharacterReferences(currentPanel)).length > 0;

  const handleRegenerateNsfwImage = useCallback(async () => {
    if (!currentPanel) return;
    const panelId = currentPanel.panel_id;
    nsfwProcessedPanelsRef.current.delete(panelId);
    nsfwInFlightRef.current.delete(panelId);
    nsfwByPanelIdRef.current.delete(panelId);
    const img0 = currentPanel.panel_content?.images?.[0];
    const artKey = freeroamArtKey(img0?.prompt, img0?.url);
    if (artKey) nsfwByArtKeyRef.current.delete(artKey);
    setNsfwImageUrl(null);
    setIsClassifyingNsfwImage(true);
    setIsGeneratingNsfwImage(false);
    nsfwForceRegenPanelRef.current = panelId;
    try {
      await clearImageCacheEntryMutation.mutateAsync({
        panelId,
        freeroamImageUrl: img0?.url ?? undefined,
        freeroamImagePrompt: img0?.prompt ?? undefined,
      });
    } catch {
      // Still attempt client re-run even if cache clear fails
    }
    setNsfwRegenNonce(n => n + 1);
  }, [currentPanel, clearImageCacheEntryMutation, freeroamArtKey]);

  return (
    <div
      className="story-reader-root fixed inset-0 z-[100]"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease', background: 'rgb(5,5,5)' }}
    >
      {/* Ambient blurred backdrop — storyAmbientLayer: exact Freeroam CSS with drift animation.
          Uses ambientBg (preloaded) so NSFW panel swaps don't flash while the image loads. */}
      <div
        style={{
          position: 'absolute',
          inset: '-12%',
          backgroundImage: ambientBg ? `url(${ambientBg})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: '50% 50%',
          backgroundRepeat: 'no-repeat',
          filter: 'blur(44px) saturate(1.25) brightness(.55)',
          transform: 'scale(1.18)',
          willChange: 'transform, opacity',
          animation: 'storyAmbientDrift 26s ease-in-out infinite alternate',
        }}
      />
      {/* storyAmbientScrim — exact Freeroam values from console extraction */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(120% 78% at 50% 42%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.34) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(rgba(0,0,0,0.3) 0px, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 56%, rgba(0,0,0,0.42) 86%, rgba(0,0,0,0.72))',
        }}
      />

      {/* Desktop gutters only (outside portrait column) — click to navigate without covering the <img>.
          On mobile the panel is full-width so gutters are 0; center-tap advance is on the image itself. */}
      {canGoBack && (
        <div
          className="fixed left-0 top-0 bottom-0 z-[10]"
          style={{
            width: 'max(0px, calc((100vw - min(100vw, 100dvh * 9 / 16)) / 2))',
            cursor: 'pointer',
          }}
          onClick={() => handleNavigate('prev')}
          aria-label="Previous panel"
        />
      )}
      {(canGoForward || isPolling || isRegeneratePolling) && (
        <div
          className="fixed right-0 top-0 bottom-0 z-[10]"
          style={{
            width: 'max(0px, calc((100vw - min(100vw, 100dvh * 9 / 16)) / 2))',
            cursor: 'pointer',
          }}
          onClick={() => handleNavigate('next')}
          aria-label="Next panel"
        />
      )}

      {/* Left navigation halo — stop above action bar so it never steals Characters/Act taps.
          Use z-[35] (Tailwind has no z-25 by default). */}
      <button
        onClick={() => handleNavigate('prev')}
        disabled={!canGoBack || isNavigating}
        className="absolute left-0 top-0 z-[35] flex items-center justify-start pl-2 sm:pl-4 disabled:opacity-0 transition-opacity"
        style={{
          width: 'clamp(44px, 15vw, 100px)',
          bottom: 'calc(112px + env(safe-area-inset-bottom, 0px))',
          cursor: canGoBack ? 'pointer' : 'default',
        }}
        aria-label="Previous panel"
      >
        <div
          className="flex items-center justify-center"
          style={{ color: 'rgba(255,255,255,0.8)', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </div>
      </button>

      {/* Right navigation halo — same: leave bottom action bar free */}
      <button
        onClick={() => handleNavigate('next')}
        disabled={(!canGoForward && !isPolling && !isRegeneratePolling) || isNavigating}
        className="absolute right-0 top-0 z-[35] flex items-center justify-end pr-2 sm:pr-4 disabled:opacity-0 transition-opacity"
        style={{
          width: 'clamp(44px, 15vw, 100px)',
          bottom: 'calc(112px + env(safe-area-inset-bottom, 0px))',
          cursor: canGoForward ? 'pointer' : 'default',
        }}
        aria-label="Next panel"
      >
        <div
          className="relative flex items-center justify-center"
          style={{ width: '24px', height: '24px', color: regenerateTimedOut ? '#ef4444' : 'rgba(255,255,255,0.8)', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}
        >
          {/* Spinning ring for polling states */}
          {(isPolling || isRegeneratePolling || regenerateTimedOut) && (
            <svg
              className="absolute inset-0"
              viewBox="0 0 24 24"
              style={{
                animation: regenerateTimedOut ? 'none' : 'spin 1s linear infinite',
              }}
            >
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <circle
                cx="12" cy="12" r="10"
                fill="none"
                stroke={regenerateTimedOut ? '#ef4444' : 'rgba(255,255,255,0.7)'}
                strokeWidth="2.5"
                strokeDasharray="47 16"
                strokeLinecap="round"
              />
            </svg>
          )}
          {/* Icon inside the ring — only show icon when not using plain spinner ring */}
          {regenerateTimedOut ? (
            <X size={16} strokeWidth={2.5} style={{ color: '#ef4444' }} />
          ) : (isRegeneratePolling || (isPolling && isImagePolling)) ? (
            <ImageIcon size={14} strokeWidth={2} style={{ opacity: 0.8, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ) : isPolling ? (
            // Plain polling — SVG ring alone is enough, no inner icon
            null
          ) : (
            <ChevronRight size={16} strokeWidth={2} />
          )}
        </div>
      </button>

      {/* Center panel — portrait column only. Image handles short-press left/right navigate
          (Freeroam-style) so we do not put a full-screen overlay over the <img> (that broke
          Save Image). Action bar / top bar use high z-index inside the panel. */}
      <div className="absolute inset-0 z-20 flex items-start justify-center pointer-events-none">
        <div
          className="relative story-reader-panel pointer-events-auto"
          style={{
            height: '100dvh',
            overflow: 'hidden',
            background: '#080808',
          }}
        >
          {/* Menu trigger — only the pill handle is tappable; swipe-down works anywhere on the top strip */}
          <div
            className="absolute top-0 left-0 right-0 z-30 flex flex-col items-center"
            style={{ height: '56px', pointerEvents: 'none' }}
            onTouchStart={(e) => {
              touchStartY.current = e.touches[0].clientY;
              touchStartX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchStartY.current === null || touchStartX.current === null) return;
              const dy = e.changedTouches[0].clientY - touchStartY.current;
              const dx = Math.abs(e.changedTouches[0].clientX - touchStartX.current);
              if (dy > 40 && dx < 60) {
                setMenuOpen(true);
                pauseAutoAdvance();
              }
              touchStartY.current = null;
              touchStartX.current = null;
            }}
          >
            {/* Pill tap target — wider/taller invisible area for easy mobile tap */}
            <div
              onClick={() => { setMenuOpen(true); pauseAutoAdvance(); }}
              aria-label="Open story menu"
              style={{
                width: '80px',
                height: '28px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: '8px',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
            >
              <div style={{
                width: '36px',
                height: '4px',
                borderRadius: '2px',
                background: 'rgba(255,255,255,0.5)',
              }} />
            </div>
          </div>

          {/* Story menu overlay */}
          <StoryMenu
            isOpen={menuOpen}
            onClose={() => { setMenuOpen(false); if (!activeInputMode && !charPanelOpen) resumeAutoAdvance(); }}
            world={world}
            currentDepth={panel?.depth ?? 0}
            progressPanel={progressPanel}
            bookmarks={bookmarkList}
            tags={worldDetail?.tags ?? []}
            relatedWorlds={(worldDetail?.related_worlds ?? []) as Array<{ external_id: string; name: string; logline: string; cover_image_url: string | null; owner: { username: string; is_verified: boolean; avatar_url: string | null }; interaction_count: number; tag_name: string; tag_is_fandom: boolean }>}
            chapters={chapters}
            journalSummary={journalData?.summary}
            compressedSummaries={journalData?.compressedSummaries}
            canEditSummary={!!(journalData)}
            entityCharacters={journalData?.entityCharacters}
            entityLocations={journalData?.entityLocations}
            entityMisc={journalData?.entityMisc}
            narrativeThreads={journalData?.narrativeThreads}
            currentPanelId={panel?.panel_id}
            totalDepth={progressPanel?.depth}
            onNavigateToPanel={(panelId) => loadPanel(panelId, world.external_id)}
            onNavigateToDepth={async (depth) => {
              if (!panel) return;
              try {
                                const params = encodeURIComponent(JSON.stringify({ '0': { json: { worldId: world.external_id, fromPanelId: panel.panel_id, targetDepth: depth } } }));
                const res = await fetch(`/api/trpc/worlds.getPanelAtDepth?batch=1&input=${params}`, {
                  credentials: 'include',
                  headers: {
          ...getFreeroamAuthHeaders(),
        },
                });
                if (!res.ok) return;
                const json = await res.json();
                const data = json?.[0]?.result?.data?.json;
                if (data?.panel_external_id) {
                  await loadPanel(data.panel_external_id, world.external_id);
                  setMenuOpen(false);
                }
              } catch {
                toast.error('Failed to navigate to page');
              }
            }}
            onRemoveBookmark={handleRemoveBookmarkFromMenu}
            isLiked={isLiked}
            likeCount={likeCount}
            onToggleLike={handleToggleLike}
            onRegenerate={async () => {
              try {
                const headers: Record<string, string> = {
                  'content-type': 'application/json',
                  ...getFreeroamAuthHeaders(),
                };
                // Step 1: Regenerate starting scene (story — not panel image)
                const regenRes = await fetch('/api/trpc/worlds.regenerateStartingScene?batch=1', {
                  method: 'POST',
                  credentials: 'include',
                  headers,
                  body: JSON.stringify({ '0': { json: { worldId: world.external_id } } }),
                });
                if (!regenRes.ok) { toast.error('Regenerate story failed'); return; }
                // Step 2: Start generation
                const startRes = await fetch('/api/trpc/worlds.startGeneration?batch=1', {
                  method: 'POST',
                  credentials: 'include',
                  headers,
                  body: JSON.stringify({ '0': { json: { worldId: world.external_id } } }),
                });
                if (!startRes.ok) { toast.error('Start generation failed'); return; }
                const startJson = await startRes.json();
                const startData = startJson?.[0]?.result?.data?.json;
                if (startData?.initial_panel_id) {
                  await loadPanel(startData.initial_panel_id, world.external_id);
                  toast.success('Story regenerated successfully');
                } else {
                  // already_running — poll Get World until panel_id appears
                  startRegeneratePolling(world.external_id);
                }
              } catch {
                toast.error('Failed to regenerate story');
              }
            }}
            onRestart={async () => {
              try {
                const res = await fetch('/api/trpc/worlds.restart?batch=1', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'content-type': 'application/json',
                    ...getFreeroamAuthHeaders(),
                  },
                  body: JSON.stringify({ '0': { json: { worldId: world.external_id } } }),
                });
                if (!res.ok) { toast.error('Restart failed'); return; }
                const json = await res.json();
                const data = json?.[0]?.result?.data?.json;
                if (data?.panel_id) {
                  setCurrentPanel(data); currentPanelIdRef.current = (data)?.panel_id ?? null;
                  setPanelMutation.mutate({ worldId: world.external_id, panelId: data.panel_id });
                  setIsLoading(false);
                  setIsNavigating(false);
                  toast.success('Story restarted from page 1');
                }
              } catch {
                toast.error('Failed to restart story');
              }
            }}
          />

          {/* Top bar — z-40 so buttons sit above the trigger zone */}
          <div
            className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4 pt-3 pb-2 pointer-events-none"
            style={{ background: 'none' }}
          >
            <a
              href="https://getfreeroam.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '16px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em', textDecoration: 'none', pointerEvents: 'auto' }}
            >
              freeroam
            </a>
            <div className="flex items-center gap-2 pointer-events-auto">
              {/* Debug overlay — shown when debug_mode is enabled in preferences */}
              {debugMode && panel && (
                <div style={{
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  color: '#fff',
                  background: 'rgba(0,0,0,0.75)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '4px',
                  padding: '3px 6px',
                  lineHeight: 1.6,
                  maxWidth: '180px',
                  pointerEvents: 'none',
                }}>
                  <div>fs: <span style={{ color: panel.forward_state === 'generating' ? '#f59e0b' : '#4ade80' }}>{panel.forward_state}</span></div>
                  <div>nxt: <span style={{ color: panel.next_panel_id ? '#4ade80' : '#f87171' }}>{panel.next_panel_id ? panel.next_panel_id.slice(0,8) : 'null'}</span></div>
                  <div>poll: <span style={{ color: isPolling ? '#f59e0b' : '#4ade80' }}>{isPolling ? 'true' : 'false'}</span></div>
                  <div>nav: <span style={{ color: isNavigating ? '#f59e0b' : '#4ade80' }}>{isNavigating ? 'true' : 'false'}</span></div>
                  <div>fwd: <span style={{ color: canGoForward ? '#4ade80' : '#f87171' }}>{canGoForward ? 'true' : 'false'}</span></div>
                  <div>act: {panel.is_action ? 'Y' : 'N'} | req: {panel.requires_action ? 'Y' : 'N'}</div>
                </div>
              )}
              {/* Debug: flashes amber while ElevenLabs is generating (cache miss) */}
              {isGeneratingTts && (
                <span
                  className="animate-pulse"
                  style={{ fontSize: '10px', fontFamily: 'Outfit-Medium, Outfit, sans-serif', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '6px', padding: '2px 6px', letterSpacing: '0.05em' }}
                >
                  GEN
                </span>
              )}
              {isClassifyingNsfwImage && (
                <span
                  className="animate-pulse"
                  style={{ fontSize: '10px', fontFamily: 'Outfit-Medium, Outfit, sans-serif', fontWeight: 600, color: '#38bdf8', background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.4)', borderRadius: '6px', padding: '2px 6px', letterSpacing: '0.05em' }}
                  title="Checking if scene needs unrestricted image"
                >
                  CHECK
                </span>
              )}
              {isGeneratingNsfwImage && (
                <span
                  className="animate-pulse"
                  style={{ fontSize: '10px', fontFamily: 'Outfit-Medium, Outfit, sans-serif', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '6px', padding: '2px 6px', letterSpacing: '0.05em' }}
                  title="Generating unrestricted image via Seedream"
                >
                  IMG
                </span>
              )}
              {/* Regenerate unrestricted image — original top-bar placement (not story regenerate) */}
              {canRegenerateNsfwImage && (
                <button
                  onClick={() => { void handleRegenerateNsfwImage(); }}
                  disabled={isClassifyingNsfwImage || isGeneratingNsfwImage}
                  className="flex items-center justify-center rounded-full transition-all hover:bg-white/20 disabled:opacity-40"
                  style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}
                  title="Regenerate unrestricted image for this panel (not the story)"
                >
                  <RefreshCw
                    size={12}
                    strokeWidth={2.5}
                    className={isClassifyingNsfwImage || isGeneratingNsfwImage ? 'animate-spin' : undefined}
                  />
                </button>
              )}
              {/* Core controls — close + bookmark + page (save via right-click / long-press on the image) */}
              <button
                onClick={onClose}
                className="flex items-center justify-center transition-all"
                style={{ color: 'rgba(255,255,255,0.75)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
                title="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
              <button
                onClick={handleToggleBookmark}
                disabled={isTogglingBookmark || !panel}
                className="flex items-center justify-center transition-all disabled:opacity-40"
                style={{ color: isBookmarked ? '#f5c440' : 'rgba(255,255,255,0.75)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
                title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
              >
                <Bookmark
                  size={16}
                  strokeWidth={2}
                  fill={isBookmarked ? '#f5c440' : 'none'}
                />
              </button>
              {panel && (
                <span style={{ fontFamily: 'Outfit-Medium, Outfit, sans-serif', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                  Page {panel.depth}
                </span>
              )}
            </div>
          </div>

          {/* No center loading overlay — right halo spinner is the only indicator */}

          {/* Panel image — fall back to Freeroam art if NSFW URL is broken (e.g. expired Atlas CDN).
              Real <img> so the browser can Save Image / long-press download (Freeroam-style).
              Text stays non-selectable via .story-reader-root; image callout is re-enabled in CSS. */}
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              // Not draggable: HTML5 drag steals desktop clicks. Save via right-click / long-press.
              draggable={false}
              className="story-reader-panel-image w-full h-full"
              style={{
                objectFit: 'cover',
                objectPosition: 'center top',
                zIndex: 0,
                cursor: canGoForward || canGoBack ? 'pointer' : 'default',
              }}
              // Left-click: navigate (center/right → next). Right-click: native Save Image.
              // Touch long-press: Save Image; short tap: navigate (long-press suppressed in handler).
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                panelImgPressRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  t: Date.now(),
                  pointerType: e.pointerType || 'mouse',
                };
              }}
              onPointerCancel={() => { panelImgPressRef.current = null; }}
              onClick={handlePanelImageNavigate}
              onContextMenu={(e) => e.stopPropagation()}
              onError={() => {
                if (nsfwImageUrl && imageUrl === nsfwImageUrl) {
                  console.warn('[NSFW] Failed to load replacement image, reverting to Freeroam art', nsfwImageUrl);
                  setNsfwImageUrl(null);
                }
              }}
            />
          )}

          {/* Bottom text overlay */}
          {hasText && !isLoading && (
            <>
              {/* storyVnDialogue__scrim — late scrim: keep mid/upper art open, darken only the text band */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.06) 64%, rgba(0,0,0,0.22) 78%, rgba(0,0,0,0.42) 92%, rgba(0,0,0,0.52) 100%)',
                }}
              />
              {/* storyVnDialogue: flex column with ::before spacer pushing content to 67dvh anchor.
                  Entire dialogue layer is pointer-events-none (Freeroam-style): text is visual only,
                  so taps/right-clicks pass through to the panel <img> for advance / Save Image.
                  Interactive controls (choices, action bar) keep their own pointer-events. */}
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 'calc(112px + env(safe-area-inset-bottom, 0px))',
                  boxSizing: 'border-box',
                }}
              >
                {/* ::before spacer — pushes content down to 67dvh */}
                <div style={{ flex: '0 1 67dvh', minHeight: 0 }} />
                {/* storyVnDialogue__stack — NOT pointer-events-auto (that blocked center-tap over text) */}
                <div
                  style={{
                    flex: '0 0 auto',
                    width: '100%',
                    maxWidth: '720px',
                    margin: '0 auto',
                    padding: '0 22px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    // Match Freeroam: tight stack between speaker rule and dialogue (~8px, not 14px+)
                    gap: '8px',
                    overflow: 'hidden',
                  }}
                >
                {/* Character name label (spoken dialogue only) — storyVnLine__name exact CSS */}
                {speakerName && accentColor && (
                  <div style={{ display: 'block', margin: 0 }}>
                    {/* Name aligned with dialogue text (paddingLeft 26px); rule stays inset at 15px */}
                    <p
                      style={{
                        fontFamily: 'Outfit-SemiBold, Outfit, sans-serif',
                        fontSize: 'clamp(.98rem, 3.8vw, 1.16rem)',
                        fontWeight: 600,
                        color: accentColor,
                        letterSpacing: '.012em',
                        lineHeight: 1.1,
                        textShadow: '0 0 1px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.7), 0 2px 10px rgba(0,0,0,.45)',
                        margin: 0,
                        paddingLeft: '26px',
                        display: 'block',
                      }}
                    >
                      {speakerName}
                    </p>
                    {/* storyVnLine__rule: left of the name block — do not align with dialogue text */}
                    <div style={{
                      position: 'relative',
                      display: 'block',
                      width: 'min(62%, 260px)',
                      height: '1.5px',
                      borderRadius: '1px',
                      background: `linear-gradient(90deg, currentColor, currentColor 58%, transparent)`,
                      color: accentColor,
                      opacity: 0.7,
                      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))',
                      marginTop: '4px',
                      marginLeft: '15px',
                    }}>
                      {/* ::before dot */}
                      <span style={{
                        position: 'absolute',
                        left: 0,
                        top: '50%',
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: accentColor,
                        transform: 'translate(-1px, -50%)',
                        display: 'block',
                      }} />
                    </div>
                  </div>
                )}

                {/* Dialogue text — Outfit-SemiBold, matches Freeroam spoken style exactly */}
                {dialogueText && (
                  <p
                    style={{
                      fontFamily: 'Outfit-SemiBold, Outfit, sans-serif',
                      fontSize: 'clamp(1.22rem, 5.3vw, 1.56rem)',
                      fontWeight: 600,
                      color: '#fff',
                      lineHeight: 1.26,
                      letterSpacing: '0.004em',
                      paintOrder: 'stroke fill',
                      WebkitTextStroke: '0.9px rgba(0,0,0,0.5)',
                      textShadow: '0 0 1px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.75), 0 1px 5px rgba(0,0,0,0.5), 0 2px 16px rgba(0,0,0,0.45)',
                      margin: 0,
                      paddingLeft: '26px',
                      paddingRight: '26px',
                      animation: 'storyVnLineIn .34s cubic-bezier(.22, .61, .36, 1) both',
                    }}
                  >
                    {dialogueText}
                  </p>
                )}

                {/* Narration text — Outfit-Medium italic, matches Freeroam narration style */}
                {narrationText && (
                  <p
                    style={{
                      fontFamily: 'Outfit-Medium, Outfit, sans-serif',
                      fontSize: 'clamp(1.08rem, 4.4vw, 1.3rem)',
                      fontWeight: 500,
                      fontStyle: 'italic',
                      color: '#f5ecd9',
                      lineHeight: 1.34,
                      textShadow: '0 0 1px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.75)',
                      margin: 0,
                      paddingLeft: '26px',
                      paddingRight: '26px',
                      textAlign: 'center',
                      animation: 'storyVnLineIn .34s cubic-bezier(.22, .61, .36, 1) both',
                    }}
                  >
                    {narrationText}
                  </p>
                )}

                {/* Action text — Freeroam .storyVnLine--action style: slightly smaller, cool blue-white */}
                {actionText && (
                  <p
                    style={{
                      fontFamily: 'Outfit-Medium, Outfit, sans-serif',
                      fontSize: 'clamp(1.05rem, 4.2vw, 1.26rem)',
                      fontWeight: 500,
                      fontStyle: 'italic',
                      color: '#e7eef7',
                      lineHeight: 1.34,
                      textShadow: '0 0 1px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.75)',
                      margin: 0,
                      textAlign: 'center',
                      paddingLeft: 0,
                      paddingRight: 0,
                      animation: 'storyVnLineIn .34s cubic-bezier(.22, .61, .36, 1) both',
                    }}
                  >
                    {actionText}
                  </p>
                )}

                {/* Thought text — Freeroam .storyVnLine--thought style: lighter italic */}
                {!narrationText && !dialogueText && !actionText && speechBubble?.style === 'thought' && (
                  <p
                    style={{
                      fontFamily: 'Outfit-Regular, Outfit, sans-serif',
                      fontSize: 'clamp(1.22rem, 5.3vw, 1.56rem)',
                      fontWeight: 400,
                      fontStyle: 'italic',
                      color: 'hsla(0,0%,100%,.92)',
                      lineHeight: 1.26,
                      margin: 0,
                      paddingLeft: '15px',
                      paddingRight: '26px',
                      animation: 'storyVnLineIn .34s cubic-bezier(.22, .61, .36, 1) both',
                    }}
                  >
                    {speechBubble.text}
                  </p>
                )}
                </div>
              </div>
            </>
          )}

          {/* storyVnRail — right-side feedback buttons (placeholder, endpoints TBD) */}
          {panel && !isLoading && !panel.is_action && (
            <div
              className="absolute z-20 flex flex-col items-center"
              style={{
                right: '12px',
                bottom: 'calc(112px + 20px)',
                gap: '20px',
                pointerEvents: 'none',
              }}
            >
              {[{
                title: 'Thumbs up',
                onClick: () => toast('Feedback — coming soon'),
                svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>,
              }, {
                title: 'Thumbs down',
                onClick: () => toast('Feedback — coming soon'),
                svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>,
              }, {
                title: 'Edit response',
                onClick: () => toast('Edit response — coming soon'),
                svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
              }].map(({ title, onClick, svg }) => (
                <button
                  key={title}
                  title={title}
                  onClick={onClick}
                  className="transition-all hover:brightness-125"
                  style={{
                    width: '20px',
                    height: '20px',
                    pointerEvents: 'auto',
                    color: 'hsla(0,0%,100%,.8)',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.9)) drop-shadow(0 0 5px rgba(0,0,0,.45))',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {svg}
                </button>
              ))}
            </div>
          )}

          {/* Choice options — Freeroam-style with lettered options, OR divider, custom input */}
          {hasChoice && !isLoading && (
            <div
              className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-4 pt-10"
              style={{
                // Strong late bed under choices/input so light text stays readable without veiling the whole panel
                background: 'linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0.12) 68%, transparent 88%)',
                maxHeight: '85dvh',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
                display: 'block',
              }}
            >
              {/* IDEAS/HIDE toggle — always at top so it's reachable regardless of choice list height */}
              {/* Question text */}
              {choice.question && (
                <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: '4px' }}>
                  {choice.question}
                </p>
              )}
              {/* IDEAS/HIDE toggle — centered on its own line below question text */}
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <button
                  onClick={() => setChoiceIdeasVisible(v => !v)}
                  className="inline-flex items-center gap-1 transition-all hover:brightness-125"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}
                >
                  {choiceIdeasVisible ? 'HIDE' : 'IDEAS'}
                  <ChevronDown size={12} strokeWidth={2.5} style={{ transform: choiceIdeasVisible ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
              </div>
              {/* Lettered options — shown based on choiceIdeasVisible, always interactive */}
              {choiceIdeasVisible && choice!.options.map((opt, i) => {
                const isSelected = !!choice!.selected_choice && choice!.selected_choice === opt.text;
                return (
                  <button
                    key={i}
                    onClick={() => handleChoice(opt.text)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-95 group ${isSelected ? 'hover-selected-choice' : 'hover:brightness-110'}`}
                    style={{
                      background: isSelected ? 'rgba(34,197,94,0.25)' : 'rgba(30,30,30,0.65)',
                      border: isSelected ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.22)',
                      borderRadius: '20px',
                      boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.3)',
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      marginBottom: '8px',
                      color: 'rgba(255,255,255,0.95)',
                    }}
                    onMouseEnter={(e) => { if (isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(50,50,60,0.9)'; }}
                    onMouseLeave={(e) => { if (isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.25)'; }}
                  >
                    <span
                      className="flex-shrink-0 flex items-center justify-center rounded-full"
                      style={{ width: '26px', height: '26px', background: isSelected ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)', boxShadow: isSelected ? 'inset 0 0 0 1px rgba(34,197,94,0.6)' : 'inset 0 0 0 1px rgba(255,255,255,0.2)', fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 600, color: isSelected ? 'rgb(134,239,172)' : 'rgba(255,255,255,0.7)' }}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', fontWeight: 500, color: '#fff', lineHeight: 1.45 }}>
                      {opt.text}
                    </span>
                  </button>
                );
              })}
              {/* OR divider + custom input — always shown on choice panels */}
              {choiceIdeasVisible && (
                <div className="flex items-center gap-3 mt-1">
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.15)' }} />
                  <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>OR</span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.15)' }} />
                </div>
              )}
              <ChoiceComposer
                key={panel?.panel_id ?? 'choice'}
                isSending={isSendingAction}
                onSubmit={(text) => { void handleSendAction(text, 'choice'); }}
              />
            </div>
          )}
        {/* Action bar — above image + side nav (z-40). Must receive Characters/Act taps. */}
        <div
          className="absolute left-0 right-0 z-40 transition-all duration-300"
          style={{ bottom: (actionBarVisible && !panel?.requires_action && !panel?.is_action) ? '0' : '-110px' }}
        >
          {/* Pill buttons row */}
          <div
            className="flex items-center gap-1.5 px-2 py-2"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Home button */}
            <a
              href="https://getfreeroam.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:bg-white/10"
              style={{ width: '34px', height: '34px', color: 'rgba(255,255,255,0.6)' }}
            >
              <Home size={15} strokeWidth={2} />
            </a>

            {/* Toggle down button */}
            <button
              onClick={() => { setActionBarVisible(false); setActiveInputMode(null); if (!charPanelOpen) resumeAutoAdvance(); }}
              className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:bg-white/10"
              style={{ width: '34px', height: '34px', color: 'rgba(255,255,255,0.6)' }}
            >
              <ChevronDown size={15} strokeWidth={2} />
            </button>

          {/* Vertical divider — same height as pill buttons, clips pills at the boundary */}
          <div style={{ width: '1px', height: '32px', background: 'rgba(255,255,255,0.2)', flexShrink: 0, marginLeft: '2px', marginRight: '2px' }} />

          {/* Pill action buttons — overflow hidden so pills clip at the divider */}
          <div className="flex items-center gap-1.5 flex-1" style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            {[
              { icon: <Zap size={13} strokeWidth={2} />, label: 'Act', mode: 'act' as const, action: null },
              { icon: <Clapperboard size={13} strokeWidth={2} />, label: 'Direct', mode: 'direct' as const, action: null },
              { icon: <Users size={13} strokeWidth={2} />, label: 'Characters', mode: null, action: () => { setCharPanelOpen(true); pauseAutoAdvance(); } },
                { icon: <ImageLucide size={13} strokeWidth={2} />, label: 'Image', mode: 'image' as const, action: null },
                { icon: <Share2 size={13} strokeWidth={2} />, label: 'Share', mode: null, action: null },
              ].map(({ icon, label, mode, action }) => (
                <button
                  key={label}
                  onClick={() => action ? action() : mode ? handleActionBarButton(mode) : toast(`${label} — coming soon`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0 transition-all hover:brightness-125"
                  style={{
                    fontFamily: 'Outfit-Medium, Outfit, sans-serif',
                    fontSize: '.78rem',
                    fontWeight: 500,
                    fontStyle: 'normal',
                    color: '#fff',
                    background: activeInputMode === mode ? 'hsla(0,0%,100%,.26)' : 'hsla(0,0%,100%,.18)',
                    border: `1px solid ${activeInputMode === mode ? 'hsla(0,0%,100%,.85)' : 'hsla(0,0%,100%,.45)'}`,
                    boxShadow: activeInputMode === mode ? 'inset 0 0 0 1px hsla(0,0%,100%,.25)' : 'none',
                    padding: '4px 10px',
                    borderRadius: '13px',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    whiteSpace: 'nowrap',
                    transition: 'background .15s ease, border-color .15s ease',
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Input field row — isolated component so typing does not re-render the full reader */}
          {activeInputMode && (
            <ActionBarComposer
              mode={activeInputMode}
              isSending={isSendingAction}
              onSubmit={(text, type) => { void handleSendAction(text, type); }}
              onEscape={() => { setActiveInputMode(null); if (!charPanelOpen) resumeAutoAdvance(); }}
            />
          )}
        </div>

        {/* Action bar collapsed — show up arrow only on panels where the bar can appear.
            Choice/action panels force-hide the bar; don't show the restore arrow there. */}
        {!actionBarVisible && !panel?.requires_action && !panel?.is_action && (
          <button
            onClick={() => setActionBarVisible(true)}
            onTouchStart={(e) => {
              const startY = e.touches[0].clientY;
              const onMove = (te: TouchEvent) => {
                if (startY - te.touches[0].clientY > 30) {
                  setActionBarVisible(true);
                  window.removeEventListener('touchmove', onMove);
                }
              };
              window.addEventListener('touchmove', onMove, { passive: true });
              setTimeout(() => window.removeEventListener('touchmove', onMove), 2000);
            }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center px-4 py-1.5 rounded-full transition-all hover:brightness-125"
            style={{ background: 'rgba(10,10,16,0.75)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}
          >
            <ChevronUp size={14} strokeWidth={2} />
          </button>
        )}
        </div>
      </div>

      {/* Character Panel */}
      <CharacterPanel
        isOpen={charPanelOpen}
        onClose={() => { setCharPanelOpen(false); if (!activeInputMode) resumeAutoAdvance(); }}
        worldId={world.external_id}
        panelId={panel?.panel_id ?? ''}
        onSaveChanges={async (adds, removes) => {
          const addNames = adds.map(c => c.name);
          const removeNames = removes.map(c => c.name);
          const parts: string[] = [];
          if (addNames.length > 0) parts.push(`Added characters: ${addNames.join(', ')}`);
          if (removeNames.length > 0) parts.push(`Removed characters: ${removeNames.join(', ')}`);
          await handleSendAction(
            parts.join('. '),
            'choice',
            {
              add_character_ids: adds.map(c => c.id),
              remove_character_ids: removes.map(c => c.id),
              new_main_character_id: null,
              old_main_character_id: null,
              batch_character_update: true,
            }
          );
        }}
        onPlayAs={async (newMainId, oldMainId, newMainName) => {
          setCharPanelOpen(false);
          resumeAutoAdvance();
          await handleSendAction(
            `Changed main character to ${newMainName} - the story will now be written from their perspective`,
            'choice',
            {
              add_character_ids: [],
              remove_character_ids: [],
              new_main_character_id: newMainId,
              old_main_character_id: oldMainId,
              batch_character_update: true,
            }
          );
        }}
        onEditCharacter={async (charId: string, charName: string, oldBackstory: string, newBackstory: string, oldAppearance: string, newAppearance: string, photoChanged?: boolean, newHeadshotUrl?: string) => {
          const backstoryChanged = newBackstory.trim() !== (oldBackstory ?? '').trim();
          const appearanceChanged = newAppearance.trim() !== (oldAppearance ?? '').trim();
          if (!backstoryChanged && !appearanceChanged && !photoChanged) return;

          // Build action_text and display_text based on what changed
          let actionText = 'A character has been edited by the user.';
          const displayParts: string[] = [];
          if (appearanceChanged || photoChanged) {
            actionText += ` Their appearance was changed from "${oldAppearance}" to "${newAppearance}".`;
            displayParts.push('new appearance');
          }
          if (backstoryChanged) {
            actionText += ' Their personality was updated.';
            displayParts.push('updated personality');
          }
          actionText += ' Continue writing the story as though this character has always been this way. Do not acknowledge or address these changes in the narrative.';
          const displayText = `(edited character ${charName}: ${displayParts.join(', ')})`;

          // Close panel and fire sendAction immediately — don't wait for character update
          setCharPanelOpen(false);

          // Fire character update and sendAction in parallel for minimum latency
                    const [, ] = await Promise.all([
            // 1. Update character in Freeroam's database (background)
            fetch('/api/trpc/characters.update?batch=1', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'content-type': 'application/json',
                ...getFreeroamAuthHeaders(),
              },
              body: JSON.stringify({
                '0': {
                  json: {
                    characterId: charId,
                    name: charName,
                    backstory: newBackstory,
                    appearance: newAppearance,
                    ...(photoChanged && newHeadshotUrl ? { headshot_url: newHeadshotUrl } : {}),
                  },
                },
              }),
            }).catch(() => { /* Non-fatal — sendAction still proceeds */ }),
            // 2. Send action to notify the AI
            handleSendAction(actionText, 'choice', {
              add_character_ids: [],
              remove_character_ids: [],
              new_main_character_id: null,
              old_main_character_id: null,
              batch_character_update: true,
            }, displayText),
          ]);
        }}
      />
    </div>
  );
}
