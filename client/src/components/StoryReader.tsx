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
import { ApiWorld } from '@/components/WorldCard';
import StoryMenu from '@/components/StoryMenu';
import CharacterPanel from '@/components/CharacterPanel';
import { Bookmark, ChevronLeft, ChevronRight, X, Loader2, ImageIcon, Home, ChevronDown, ChevronUp, Zap, Clapperboard, Users, Image as ImageLucide, Share2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Voice assignments cache: character_name -> voice data (null = no voice assigned, undefined = not yet fetched)
  const voiceCache = useRef<Map<string, { voiceId: string; voiceName: string; stability: string | null; similarityBoost: string | null; style: string | null; languageCode: string | null } | null>>(new Map());

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
  const { data: autoAdvanceSetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_enabled' });
  const { data: readingSpeedSetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_reading_speed' });
  const { data: minDelaySetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_min_delay' });
  const { data: staticDelaySetting } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_static_delay' });
  useEffect(() => { if (autoAdvanceSetting !== undefined) { const v = autoAdvanceSetting === 'true'; setAutoAdvanceEnabled(v); autoAdvanceEnabledRef.current = v; } }, [autoAdvanceSetting]);
  useEffect(() => { if (readingSpeedSetting) setAutoAdvanceReadingSpeed(parseFloat(readingSpeedSetting)); }, [readingSpeedSetting]);
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
  const [actionInput, setActionInput] = useState('');
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
      // Auto-fill prefix for Image mode
      setActionInput(mode === 'image' ? 'Change the image to ' : '');
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
    setActionInput('');
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
        const cookie = localStorage.getItem('freeroam_cookie') ?? '';
        const accountId = localStorage.getItem('freeroam_account_id') ?? '';
        const params = encodeURIComponent(JSON.stringify({ '0': { json: { worldId } } }));
        const res = await fetch(`/api/trpc/worlds.get?batch=1&input=${params}`, {
          credentials: 'include',
          headers: {
            ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
            ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
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
      const cookie = localStorage.getItem('freeroam_cookie') ?? '';
      const accountId = localStorage.getItem('freeroam_account_id') ?? '';
      const extraHeaders: Record<string, string> = {};
      if (cookie) extraHeaders['x-freeroam-cookie'] = cookie;
      if (accountId) extraHeaders['x-freeroam-account-id'] = accountId;
      for (let i = 0; i < 240 && !controller.signal.aborted; i++) {
        try {
          const res = await fetch(
            `/api/trpc/worlds.nextReady?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { json: { panelId } } }))}`,
            { credentials: 'include', signal: controller.signal, headers: extraHeaders }
          );
          if (res.ok) {
            const data = await res.json();
            const result = data?.[0]?.result?.data?.json;
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
                await loadPanelRef.current?.(result.panel_id, world.external_id);
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

  const loadPanel = useCallback(async (panelId: string, worldId: string) => {
    stopPolling();
    cancelAutoAdvance();
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
      setCurrentPanel(cached); currentPanelIdRef.current = (cached)?.panel_id ?? null;
      setPanelMutation.mutate({ worldId, panelId });
      setIsLoading(false);
      return;
    } else if (cached) {
      // Remove broken cached entry (null or [Max Depth] strings) and fetch fresh
      panelCache.current.delete(panelId);
    }
    setIsNavigating(true);
    // Retry up to 3 times with a 1s delay — Freeroam sometimes returns a panel_id
    // before the panel actually exists (404/fetch error on first attempt).
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1000));
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
      toast.error(lastErr instanceof Error ? lastErr.message : 'Failed to load panel');
    }
    setIsNavigating(false);
    setIsLoading(false);
  }, [utils, setPanelMutation, stopPolling, showChoiceIdeasByDefault]);

  // Load voice_enabled setting
  const { data: voiceEnabledSetting } = trpc.voice.getSetting.useQuery({ key: 'voice_enabled' });
  const voiceEnabled = voiceEnabledSetting !== 'false'; // default true if not set

  // Helper: play an audio clip with error/stall handling for poor connections
  const playAudioClip = useCallback((audioUrl: string, panel: PanelData) => {
    audioRef.current?.pause();
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    ttsWillPlayRef.current = true;
    setIsGeneratingTts(false);
    audio.play().catch(() => { ttsWillPlayRef.current = false; });
    setIsPlayingAudio(true);

    const handlePlaybackFailure = () => {
      // Audio failed or stalled — clear playing state, let fallback timer handle auto-advance
      ttsWillPlayRef.current = false;
      setIsPlayingAudio(false);
    };
    audio.onerror = handlePlaybackFailure;
    audio.onstalled = handlePlaybackFailure;

    audio.onended = () => {
      setIsPlayingAudio(false);
      ttsWillPlayRef.current = false;
      if (autoAdvanceEnabledRef.current && !autoAdvancePausedRef.current) {
        autoAdvanceTimerRef.current = setTimeout(() => {
          loadPanelRef.current?.(panel.next_panel_id!, world.external_id);
        }, Math.max(0, autoAdvanceMinDelayRef.current * 1000));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.external_id]);

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
        // No narrator voice — signal the fallback timer to fire at reading speed
        ttsConfirmedNoVoiceRef.current = true;
        return;
      }
      try {
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
        if (!checkStillCurrent()) return; // Panel changed while awaiting — abort
        // If another request is already generating this panel's audio, poll until ready
        if ((result as { generating?: boolean }).generating && !result.audioUrl) {
          // Poll checkTtsReady every 2s until status=ready, then play inline
          const pollCharId = '__narrator__';
          let pollUrl: string | null = null;
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!checkStillCurrent()) return;
            try {
              const poll = await utils.voice.checkTtsReady.fetch({
                panelId: panel.panel_id,
                worldId: world.external_id,
                characterId: pollCharId,
              });
              if (poll.ready && poll.audioUrl) { pollUrl = poll.audioUrl; break; }
            } catch { /* non-fatal */ }
          }
          if (!checkStillCurrent()) return;
          if (pollUrl) {
            setCurrentAudioUrl(pollUrl);
            if (autoPlayEnabled) playAudioClip(pollUrl, panel);
          } else {
            setIsGeneratingTts(false);
            ttsConfirmedNoVoiceRef.current = true; // treat as no-voice for auto-advance
          }
          return;
        }
        if (result.audioUrl) {
          setCurrentAudioUrl(result.audioUrl);
          if (autoPlayEnabled) playAudioClip(result.audioUrl, panel);
        }
      } catch { setIsGeneratingTts(false); /* Non-fatal */ }
      return;
    }

    if (speechBubble.style !== 'spoken') return;

    const charName = speechBubble.character;
    const text = speechBubble.text;

    // Look up voice assignment for this character
    let voiceData = voiceCache.current.get(charName);
    let charExternalId: string | undefined;
    if (voiceData === undefined) {
      // Not yet cached — fetch from server
      try {
        // Find the character's external_id from the world's character list (reliable)
        // Fall back to panel's visible_characters if world list doesn't have it
        const normalizedCharName = charName.toLowerCase().replace(/-/g, ' ');
        const worldChar = worldCharacters.find(c =>
          c.name?.toLowerCase().replace(/-/g, ' ') === normalizedCharName
        );
        if (worldChar) {
          charExternalId = worldChar.external_id;
        } else {
          // worldCharacters may be empty on initial reader open (worlds.get not yet resolved).
          // Always call getPanelCharacters as fallback — it returns the current character list
          // directly from Freeroam and is the reliable source for charExternalId.
          try {
            const panelChars = await utils.worlds.getPanelCharacters.fetch({
              worldId: world.external_id,
              panelId: panel.panel_id,
            });
            // Merge story_characters into worldCharacters for future lookups
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
              charExternalId = found?.external_id;
            }
            // Cache null if still not found — prevents repeated getPanelCharacters calls
            if (!charExternalId) voiceCache.current.set(charName, null);
          } catch {
            // Non-fatal — no fallback available
          }
        }
        if (!checkStillCurrent()) return; // Panel changed while awaiting — abort
        if (charExternalId) {
          const assignment = await utils.voice.getVoiceAssignment.fetch({ characterId: charExternalId });
          voiceData = assignment ?? null;
          // Only cache if we got a definitive result (found external_id and queried DB)
          voiceCache.current.set(charName, voiceData);
        }
        // If no external_id found, don't cache null — retry on next panel
      } catch {
        // Don't cache on error — retry next time
      }
    } else {
    }

    if (!voiceData) {
      // Confirmed no voice — signal the fallback timer to fire at reading speed
      ttsConfirmedNoVoiceRef.current = true;
      return;
    }

    try {
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
        characterId: charExternalId ?? undefined,
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
      if (!checkStillCurrent()) return; // Panel changed while awaiting — abort

      // If another request is already generating this panel's audio, poll until ready
      if ((result as { generating?: boolean }).generating && !result.audioUrl) {
        const pollCharId = charExternalId ?? '__narrator__';
        let pollUrl: string | null = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (!checkStillCurrent()) return;
          try {
            const poll = await utils.voice.checkTtsReady.fetch({
              panelId: panel.panel_id,
              worldId: world.external_id,
              characterId: pollCharId,
            });
            if (poll.ready && poll.audioUrl) { pollUrl = poll.audioUrl; break; }
          } catch { /* non-fatal */ }
        }
        if (!checkStillCurrent()) return;
        if (pollUrl) {
          setCurrentAudioUrl(pollUrl);
          if (autoPlayEnabled) playAudioClip(pollUrl, panel);
        } else {
          setIsGeneratingTts(false);
          ttsConfirmedNoVoiceRef.current = true; // treat as no-voice for auto-advance
        }
        return;
      }

      if (result.audioUrl) {
        setCurrentAudioUrl(result.audioUrl);
        if (autoPlayEnabled) playAudioClip(result.audioUrl, panel);
      }
    } catch {
      // Non-fatal — TTS failure should not interrupt navigation
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayEnabled, voiceEnabled, narratorVoiceId, world.external_id, worldCharacters, autoAdvanceEnabled, autoAdvanceMinDelay]);

  // Keep loadPanelRef updated with latest loadPanel
  useEffect(() => { loadPanelRef.current = loadPanel; }, [loadPanel]);

  // Track whether the reader has advanced past the first panel load
  const hasNavigatedRef = useRef(false);

  // Trigger TTS when panel changes and has spoken dialogue.
  // NOTE: TTS is also re-fired by the worldCharacters effect (line ~805) when character
  //       IDs first become available after the initial panel load.
  // NOTE: The actual audio playback is in playAudioClip (line ~522), which is called
  //       from triggerTTS. All 4 audio play sites use playAudioClip.
  // NOTE: ttsWillPlayRef must be set to true before audio.play() and false on
  //       audio.onended/onerror/onstalled. The auto-advance fallback timer checks it.
  useEffect(() => {
    if (!currentPanel) return;
    // Reset TTS flags — triggerTTS will update them based on outcome
    ttsWillPlayRef.current = false;
    ttsConfirmedNoVoiceRef.current = false;
    setIsGeneratingTts(false); // Clear stuck GEN badge on panel change
    // Stop any currently playing audio
    audioRef.current?.pause();
    audioRef.current = null;
    setIsPlayingAudio(false);
    setCurrentAudioUrl(null);
    // Skip auto-play on the very first panel load — TTS cache may not be ready yet.
    // The worldCharacters retry effect below will re-fire TTS once characters are loaded.
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      return;
    }
    // Fire TTS in background (non-blocking)
    triggerTTS(currentPanel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanel?.panel_id]);

  // Re-fire TTS when worldCharacters first arrives (async after initial load).
  // On reader open, triggerTTS runs before worlds.get resolves, so charExternalId is
  // undefined and the server cache lookup misses. This effect retries once characters
  // are available, but only if audio isn't already playing (avoid duplicate generation).
  const worldCharactersLoadedRef = useRef(false);
  useEffect(() => {
    if (worldCharacters.length === 0) return;
    if (worldCharactersLoadedRef.current) return; // Only retry on the FIRST population
    worldCharactersLoadedRef.current = true;
    if (!currentPanel) return;
    // Skip if audio is already playing (TTS succeeded on first attempt)
    if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) return;
    // Skip if audio URL already resolved (cache hit on first attempt)
    if (currentAudioUrl) return;
    // Retry TTS now that character IDs are available
    triggerTTS(currentPanel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldCharacters]);

  // Auto-advance timer: fires when panel changes and auto-advance is enabled.
  // Voice-based advance is handled in triggerTTS audio.onended (playAudioClip helper).
  // This handles panels without voice: text-based timer or static delay.
  // NOTE: Auto-advance is also controlled by autoAdvancePausedRef (set by pauseAutoAdvance/
  //       resumeAutoAdvance). Pause triggers: action input open, Characters panel open,
  //       story menu open. All must be dismissed before advance resumes.
  // NOTE: The advance itself fires in audio.onended (voiced panels) or noVoiceTimer
  //       (unvoiced panels). If you add a new advance path, check both.
  useEffect(() => {
    if (!currentPanel || !autoAdvanceEnabled || autoAdvancePaused) return;
    // Don't auto-advance on choice, action, or polling panels
    if (currentPanel.requires_action || currentPanel.is_action || isPolling) return;
    // Don't auto-advance if there's no next panel
    if (!currentPanel.next_panel_id) return;
    // If voice is enabled and auto-play is on, the audio.onended handler will trigger advance
    // Only set a text-based timer if voice is disabled or no voice assigned
    const speechBubble = currentPanel.panel_content?.speech_bubbles?.[0];
    const narration = currentPanel.panel_content?.narration;
    // A panel has speakable text if it has a spoken or narration speech bubble, or a narration field
    const isSpokenBubble = speechBubble?.style === 'spoken' && !!speechBubble?.text;
    const isNarrationBubble = (speechBubble?.style === 'narration' || !speechBubble?.character) && !!speechBubble?.text;
    const hasNarrationField = !!narration;
    const hasSpeakableText = isSpokenBubble || isNarrationBubble || hasNarrationField;
    // Non-speakable text (action bubbles etc.) — treat as no-voice text
    const hasAnyText = !!speechBubble?.text || !!narration;
    if (hasSpeakableText && voiceEnabled) {
      const textForTiming = speechBubble?.text ?? narration ?? '';
      const wordCount = textForTiming.split(/\s+/).length;
      const wordsPerMinute = 200 * autoAdvanceReadingSpeed;
      const readingTimeMs = (wordCount / wordsPerMinute) * 60 * 1000;
      const totalDelay = Math.max(autoAdvanceMinDelay * 1000, readingTimeMs);
      // Determine if we know for certain that no voice will play on this panel
      const charName = speechBubble?.character;
      const cachedVoice = charName ? voiceCache.current.get(charName) : undefined;
      const knownNoVoice = cachedVoice === null; // null = fetched, confirmed no voice
      // Narration panels with no narrator voice set will never play TTS
      const isNarrationNoVoice = (isNarrationBubble || hasNarrationField) && !narratorVoiceId;
      if (knownNoVoice || isNarrationNoVoice) {
        // Definitely no voice — use reading-time timer directly
        autoAdvanceTimerRef.current = setTimeout(() => {
          loadPanelRef.current?.(currentPanel.next_panel_id!, world.external_id);
        }, totalDelay);
      } else {
        // Voice might play — set a generous fallback timer.
        // The timer checks ttsWillPlayRef (set when audio.play() is called) and
        // ttsConfirmedNoVoiceRef (set when triggerTTS determines no voice is assigned).
        // If either confirms no voice, advance immediately at reading speed.
        // 2x fallback: fires if voice never started
        autoAdvanceTimerRef.current = setTimeout(() => {
          if (!ttsWillPlayRef.current) {
            loadPanelRef.current?.(currentPanel.next_panel_id!, world.external_id);
          }
        }, totalDelay * 2);
        // Reading-speed check: fires sooner if triggerTTS confirms no voice
        // This handles the case where voice lookup completes quickly with null result
        const noVoiceTimer = setTimeout(() => {
          if (ttsConfirmedNoVoiceRef.current && !ttsWillPlayRef.current) {
            // Cancel the 2x timer and advance now
            if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null; }
            loadPanelRef.current?.(currentPanel.next_panel_id!, world.external_id);
          }
        }, totalDelay);
        // Patch cancelAutoAdvance to also clear noVoiceTimer
        const origCancel = autoAdvanceTimerRef.current;
        void origCancel; // suppress lint
        // Store noVoiceTimer in a separate ref so cleanup can reach it
        noVoiceTimerRef.current = noVoiceTimer;
      }
    } else if (hasAnyText) {
      // No voice — use reading time
      const textForTiming2 = speechBubble?.text ?? narration ?? '';
      const wordCount = textForTiming2.split(/\s+/).length;
      const wordsPerMinute = 200 * autoAdvanceReadingSpeed;
      const readingTimeMs = (wordCount / wordsPerMinute) * 60 * 1000;
      const totalDelay = Math.max(autoAdvanceMinDelay * 1000, readingTimeMs);
      autoAdvanceTimerRef.current = setTimeout(() => {
        loadPanelRef.current?.(currentPanel.next_panel_id!, world.external_id);
      }, totalDelay);
    } else {
      // No text — use static delay
      autoAdvanceTimerRef.current = setTimeout(() => {
        loadPanelRef.current?.(currentPanel.next_panel_id!, world.external_id);
      }, autoAdvanceStaticDelay * 1000);
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
        const cookie = localStorage.getItem('freeroam_cookie') ?? '';
        const accountId = localStorage.getItem('freeroam_account_id') ?? '';
        const params = encodeURIComponent(JSON.stringify({ '0': { json: input } }));
        const res = await fetch(`/api/trpc/${procedure}?batch=1&input=${params}`, {
          credentials: 'include',
          headers: {
            ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
            ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
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
    const { forward_state, next_panel_id } = currentPanel;
    const shouldPoll =
      (forward_state === 'generating' && !next_panel_id);
    if (shouldPoll && !isPolling) {
      startPolling(currentPanel.panel_id);
    }
    return () => stopPolling();
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
      if (embedded.forward_state === 'generating' && !embedded.next_panel_id) {
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
  const imageUrl = image?.url ?? null;
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

  return (
    <div
      className="fixed inset-0 z-[100]"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease', background: 'rgb(5,5,5)' }}
    >
      {/* Ambient blurred backdrop — storyAmbientLayer: exact Freeroam CSS with drift animation */}
      <div
        style={{
          position: 'absolute',
          inset: '-12%',
          backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
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
          background: 'linear-gradient(rgba(0,0,0,0.55) 0px, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0) 42%, rgba(0,0,0,0) 56%, rgba(0,0,0,0.42) 86%, rgba(0,0,0,0.72))',
        }}
      />

      {/* Full-viewport invisible tap zones — match Freeroam's 25% width tap areas */}
      {canGoBack && (
        <div
          className="fixed left-0 top-0 bottom-0 z-10"
          style={{ width: '25vw', cursor: 'pointer' }}
          onClick={() => handleNavigate('prev')}
          aria-label="Previous panel"
        />
      )}
      {(canGoForward || isPolling || isRegeneratePolling) && (
        <div
          className="fixed right-0 top-0 bottom-0 z-10"
          style={{ width: '60vw', cursor: 'pointer' }}
          onClick={() => handleNavigate('next')}
          aria-label="Next panel"
        />
      )}

      {/* Left navigation halo */}
      <button
        onClick={() => handleNavigate('prev')}
        disabled={!canGoBack || isNavigating}
        className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-start pl-2 sm:pl-4 disabled:opacity-0 transition-opacity"
        style={{ width: 'clamp(44px, 15vw, 100px)', cursor: canGoBack ? 'pointer' : 'default' }}
        aria-label="Previous panel"
      >
        <div
          className="flex items-center justify-center"
          style={{ color: 'rgba(255,255,255,0.8)', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </div>
      </button>

      {/* Right navigation halo */}
      <button
        onClick={() => handleNavigate('next')}
        disabled={(!canGoForward && !isPolling && !isRegeneratePolling) || isNavigating}
        className="absolute right-0 top-0 bottom-0 z-20 flex items-center justify-end pr-2 sm:pr-4 disabled:opacity-0 transition-opacity"
        style={{ width: 'clamp(44px, 15vw, 100px)', cursor: canGoForward ? 'pointer' : 'default' }}
        aria-label="Next panel"
      >
        <div
          className="relative flex items-center justify-center"
          style={{ width: '40px', height: '40px', color: regenerateTimedOut ? '#ef4444' : 'rgba(255,255,255,0.8)', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}
        >
          {/* Spinning ring for polling states */}
          {(isPolling || isRegeneratePolling || regenerateTimedOut) && (
            <svg
              className="absolute inset-0"
              viewBox="0 0 40 40"
              style={{
                animation: regenerateTimedOut ? 'none' : 'spin 1s linear infinite',
              }}
            >
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <circle
                cx="20" cy="20" r="17"
                fill="none"
                stroke={regenerateTimedOut ? '#ef4444' : 'rgba(255,255,255,0.7)'}
                strokeWidth="2.5"
                strokeDasharray="80 26"
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

      {/* Center panel */}
      <div className="absolute inset-0 flex items-start justify-center">
        <div
          className="relative story-reader-panel"
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
                const cookie = localStorage.getItem('freeroam_cookie') ?? '';
                const accountId = localStorage.getItem('freeroam_account_id') ?? '';
                const params = encodeURIComponent(JSON.stringify({ '0': { json: { worldId: world.external_id, fromPanelId: panel.panel_id, targetDepth: depth } } }));
                const res = await fetch(`/api/trpc/worlds.getPanelAtDepth?batch=1&input=${params}`, {
                  credentials: 'include',
                  headers: {
                    ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
                    ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
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
                const cookie = localStorage.getItem('freeroam_cookie') ?? '';
                const accountId = localStorage.getItem('freeroam_account_id') ?? '';
                const headers: Record<string, string> = {
                  'content-type': 'application/json',
                  ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
                  ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
                };
                // Step 1: Regenerate starting scene
                const regenRes = await fetch('/api/trpc/worlds.regenerateStartingScene?batch=1', {
                  method: 'POST',
                  credentials: 'include',
                  headers,
                  body: JSON.stringify({ '0': { json: { worldId: world.external_id } } }),
                });
                if (!regenRes.ok) { toast.error('Regenerate failed'); return; }
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
                const cookie = localStorage.getItem('freeroam_cookie') ?? '';
                const accountId = localStorage.getItem('freeroam_account_id') ?? '';
                const res = await fetch('/api/trpc/worlds.restart?batch=1', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'content-type': 'application/json',
                    ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
                    ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
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
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)' }}
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
              {/* Audio controls — shown when audio is available */}
              {currentAudioUrl && (
                <button
                  onClick={() => {
                    if (isPlayingAudio) {
                      audioRef.current?.pause();
                      setIsPlayingAudio(false);
                    } else {
                      audioRef.current?.play().catch(() => {});
                      setIsPlayingAudio(true);
                    }
                  }}
                  className="flex items-center justify-center rounded-full transition-all hover:bg-white/20"
                  style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', color: isPlayingAudio ? '#a78bfa' : 'rgba(255,255,255,0.75)' }}
                  title={isPlayingAudio ? 'Pause voice' : 'Play voice'}
                >
                  {isPlayingAudio
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                  }
                </button>
              )}
              {/* X button — no circle */}
              <button
                onClick={onClose}
                className="flex items-center justify-center transition-all"
                style={{ color: 'rgba(255,255,255,0.75)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
                title="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
              {/* Bookmark toggle — no circle, after X */}
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
              {/* Page number — after bookmark */}
              {panel && (
                <span style={{ fontFamily: 'Outfit-Medium, Outfit, sans-serif', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                  Page {panel.depth}
                </span>
              )}
            </div>
          </div>

          {/* No center loading overlay — right halo spinner is the only indicator */}

          {/* Panel image */}
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full"
              style={{ objectFit: 'cover', objectPosition: 'center top' }}
            />
          )}

          {/* Bottom text overlay */}
          {hasText && !isLoading && (
            <>
              {/* storyVnDialogue__scrim — exact Freeroam gradient for text readability */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.4) 74%, rgba(0,0,0,0.58))' }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 z-10 px-5"
                style={{ paddingBottom: 'calc(112px + env(safe-area-inset-bottom, 0px))' }}
              >
                {/* Character name label (spoken dialogue only) — storyVnLine__name exact CSS */}
                {speakerName && accentColor && (
                  <div style={{ display: 'block', margin: '0 0 4px', paddingLeft: '15px' }}>
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
                        display: 'block',
                      }}
                    >
                      {speakerName}
                    </p>
                    {/* storyVnLine__rule: exact Freeroam CSS — wider, with dot at left end */}
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
            </>
          )}

          {/* storyVnRail — right-side feedback buttons (placeholder, endpoints TBD) */}
          {panel && !isLoading && !panel.is_action && (
            <div
              className="absolute z-20 flex flex-col items-center"
              style={{
                right: '12px',
                bottom: 'calc(96px + 20px)',
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
              className="absolute bottom-0 left-0 right-0 z-20 flex flex-col gap-2 px-4 pb-4 pt-10"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 55%, transparent)' }}
            >
              {/* Question + IDEAS/HIDE toggle */}
              {choice.question && (
                <div className="flex items-center gap-2 mb-1">
                  <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.7)', flex: 1 }}>
                    {choice.question}
                  </p>
                  <button
                    onClick={() => setChoiceIdeasVisible(v => !v)}
                    className="flex items-center gap-1 transition-all hover:brightness-125 flex-shrink-0"
                    style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}
                  >
                    {choiceIdeasVisible ? 'HIDE' : 'IDEAS'}
                    <ChevronDown size={12} strokeWidth={2.5} style={{ transform: choiceIdeasVisible ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                </div>
              )}
              {/* Lettered options — shown based on choiceIdeasVisible, always interactive */}
              {choiceIdeasVisible && choice!.options.map((opt, i) => {
                const isSelected = !!choice!.selected_choice && choice!.selected_choice === opt.text;
                return (
                  <button
                    key={i}
                    onClick={() => handleChoice(opt.text)}
                    className={`w-full flex items-start gap-3 px-4 py-3 rounded-2xl transition-all active:scale-95 group ${isSelected ? 'hover-selected-choice' : 'hover:brightness-110'}`}
                    style={{
                      background: isSelected ? 'rgba(34,197,94,0.25)' : 'rgba(30,30,40,0.85)',
                      border: 'none',
                      boxShadow: isSelected ? '0 4px 20px rgba(34,197,94,0.4), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 0 1px rgba(34,197,94,0.5)' : 'inset 0 0 0 1px rgba(255,255,255,0.12)',
                      backdropFilter: 'blur(10px)',
                      textAlign: 'left',
                      cursor: 'pointer',
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
              <div className="flex items-start gap-2 px-4 py-2 rounded-2xl" style={{ background: 'rgba(30,30,40,0.85)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)' }}>
                <textarea
                  rows={1}
                  value={actionInput}
                  onChange={(e) => {
                    setActionInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (actionInput.trim()) handleSendAction(actionInput, 'choice');
                    }
                  }}
                  placeholder="Or type your own"
                  className="flex-1 outline-none resize-none"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', minWidth: 0, lineHeight: 1.5, overflow: 'hidden', maxHeight: '120px', overflowY: 'auto' }}
                />
                <button
                  onClick={() => { if (actionInput.trim()) handleSendAction(actionInput, 'choice'); }}
                  disabled={!actionInput.trim() || isSendingAction}
                  className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:brightness-125 disabled:opacity-40 mt-0.5"
                  style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', color: '#fff' }}
                >
                  {isSendingAction ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={16} strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          )}
        {/* Action bar — hidden on choice/requires_action panels */}
        <div
          className="absolute left-0 right-0 z-30 transition-all duration-300"
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
              onClick={() => { setActionBarVisible(false); setActiveInputMode(null); setActionInput(''); if (!charPanelOpen) resumeAutoAdvance(); }}
              className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:bg-white/10"
              style={{ width: '34px', height: '34px', color: 'rgba(255,255,255,0.6)' }}
            >
              <ChevronDown size={15} strokeWidth={2} />
            </button>

          {/* Pill action buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
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

          {/* Input field row (shown when Act/Direct/Image active) — below pills, closer to keyboard */}
          {activeInputMode && (
            <div
              className="flex items-start gap-2 px-3 py-2"
              style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
            >
              <textarea
                autoFocus
                rows={1}
                value={actionInput}
                onChange={(e) => {
                  setActionInput(e.target.value);
                  // Auto-grow: reset height then set to scrollHeight
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setActiveInputMode(null); setActionInput(''); if (!charPanelOpen) resumeAutoAdvance(); }
                  // Enter without shift submits; shift+Enter adds newline
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (actionInput.trim()) {
                      const type = activeInputMode === 'act' ? 'take-action' : activeInputMode === 'direct' ? 'steer-story' : 'image';
                      handleSendAction(actionInput, type as 'take-action' | 'steer-story' | 'image');
                    }
                  }
                }}
                placeholder={activeInputMode === 'act' ? 'What do you do?' : activeInputMode === 'direct' ? 'Direct the scene...' : 'Describe the image...'}
                className="flex-1 outline-none resize-none"
                style={{
                  fontFamily: 'Outfit-Regular, Outfit, sans-serif',
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.85)',
                  background: 'transparent',
                  border: 'none',
                  minWidth: 0,
                  lineHeight: 1.5,
                  overflow: 'hidden',
                  maxHeight: '120px',
                  overflowY: 'auto',
                }}
              />
              <button
                onClick={() => {
                  if (!actionInput.trim()) return;
                  const type = activeInputMode === 'act' ? 'take-action' : activeInputMode === 'direct' ? 'steer-story' : 'image';
                  handleSendAction(actionInput, type as 'take-action' | 'steer-story' | 'image');
                }}
                disabled={!actionInput.trim() || isSendingAction}
                className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:brightness-125 disabled:opacity-40 mt-0.5"
                style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.15)', color: '#fff' }}
              >
                {isSendingAction ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={18} strokeWidth={2.5} />}
              </button>
            </div>
          )}
        </div>

        {/* Action bar collapsed — show up arrow to restore */}
        {!actionBarVisible && (
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
          const cookie = localStorage.getItem('freeroam_cookie') ?? '';
          const accountId = localStorage.getItem('freeroam_account_id') ?? '';
          const [, ] = await Promise.all([
            // 1. Update character in Freeroam's database (background)
            fetch('/api/trpc/characters.update?batch=1', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'content-type': 'application/json',
                ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
                ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
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
