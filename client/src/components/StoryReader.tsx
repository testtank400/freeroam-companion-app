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

export default function StoryReader({ world, initialPanelId, onClose }: StoryReaderProps) {
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
  // Pending poll: set by handleSendAction to trigger polling from a useEffect with fresh refs
  const [pendingPollPanelId, setPendingPollPanelId] = useState<string | null>(null);
  const [pendingPollIsImage, setPendingPollIsImage] = useState(false);
  const [visible, setVisible] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Panel cache: store visited panels by panel_id for instant back/forward navigation
  const panelCache = useRef<Map<string, PanelData>>(new Map());
  // Refs to latest stopPolling/loadPanel for use in handleSendAction (avoids stale closure)
  const stopPollingRef = useRef<(() => void) | null>(null);
  const loadPanelRef = useRef<((panelId: string, worldId: string) => Promise<void>) | null>(null);
  const setPanelMutation = trpc.worlds.setPanel.useMutation();
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

  // Action bar state
  const [actionBarVisible, setActionBarVisible] = useState(true);
  const [activeInputMode, setActiveInputMode] = useState<'act' | 'direct' | 'image' | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [isSendingAction, setIsSendingAction] = useState(false);
  const sendActionMutation = trpc.worlds.sendAction.useMutation();

  const handleActionBarButton = (mode: 'act' | 'direct' | 'image') => {
    if (activeInputMode === mode) {
      setActiveInputMode(null);
    } else {
      setActiveInputMode(mode);
      // Auto-fill prefix for Image mode
      setActionInput(mode === 'image' ? 'Change the image to ' : '');
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
        usage: result.usage,
      };
      const actionPanelData = actionPanel as unknown as PanelData;
      // Store action panel in cache so backward navigation can traverse it
      panelCache.current.set(result.action_panel_id, actionPanelData);
      setCurrentPanel(actionPanelData);
      // Save position
      setPanelMutation.mutate({ worldId: world.external_id, panelId: result.action_panel_id });
      // Determine if this is an image action (check action text prefix)
      const isImageAction = text.toLowerCase().startsWith('change the image to');
      // Handle next panel navigation based on forward_state
      if (result.forward_state === 'awaiting_choice' && result.next_panel_id) {
        // Choice panel is already generated — navigate to it immediately
        await (loadPanelRef.current ?? loadPanel)(result.next_panel_id, world.external_id);
      } else if (result.forward_state === 'generating' || result.forward_state === 'ready') {
        // Signal useEffect to start polling with fresh refs (avoids stale closure)
        setPendingPollIsImage(isImageAction);
        setPendingPollPanelId(result.action_panel_id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send action');
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

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setIsPolling(false);
    setIsImagePolling(false);
  }, []);

  const loadPanel = useCallback(async (panelId: string, worldId: string) => {
    stopPolling();
    setChoiceIdeasVisible(showChoiceIdeasByDefault);
    // Check panel cache first for instant navigation
    const cached = panelCache.current.get(panelId);
    if (cached) {
      setCurrentPanel(cached);
      setPanelMutation.mutate({ worldId, panelId });
      setIsLoading(false);
      return;
    }
    setIsNavigating(true);
    try {
      const data = await utils.worlds.getPanel.fetch({ worldId, panelId });
      const panel = data as PanelData;
      // Store in cache
      panelCache.current.set(panelId, panel);
      // Also cache the embedded next_panel if present
      if (panel.next_panel) {
        const next = panel.next_panel as PanelData;
        if (next.panel_id) panelCache.current.set(next.panel_id, next);
      }
      setCurrentPanel(panel);
      setPanelMutation.mutate({ worldId, panelId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load panel');
    } finally {
      setIsNavigating(false);
      setIsLoading(false);
    }
  }, [utils, setPanelMutation, stopPolling, showChoiceIdeasByDefault]);

  // Keep refs updated with latest versions
  useEffect(() => { stopPollingRef.current = stopPolling; }, [stopPolling]);
  useEffect(() => { loadPanelRef.current = loadPanel; }, [loadPanel]);

  // Start polling when handleSendAction signals a pending poll (avoids stale closure)
  useEffect(() => {
    if (!pendingPollPanelId) return;
    setPendingPollPanelId(null); // consume the signal
    setIsPolling(true);
    if (pendingPollIsImage) setIsImagePolling(true);
    const panelIdToWatch = pendingPollPanelId;
    pollingRef.current = setInterval(async () => {
      try {
        const pollResult = await utils.worlds.nextReady.fetch({ panelId: panelIdToWatch });
        if (pollResult.ready) {
          stopPolling();
          await loadPanel(pollResult.panel_id, world.external_id);
        }
      } catch {
        // Non-fatal — keep polling
      }
    }, 1000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPollPanelId]);

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
    trpcGet<{ tags: Array<{ id: number; name: string; is_fandom: boolean; emoji: string | null }>; related_worlds: Array<{ external_id: string; name: string; logline: string; cover_image_url: string | null; owner: { username: string; is_verified: boolean; avatar_url: string | null }; interaction_count: number; tag_name: string; tag_is_fandom: boolean }>; is_liked: boolean; like_count: number }>('worlds.get', { worldId: world.external_id })
      .then((data) => {
        if (!data) return;
        setWorldDetail({ tags: data.tags, related_worlds: data.related_worlds });
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

  // Poll when forward_state is "ready" but next_panel_id is null (AI generating)
  useEffect(() => {
    if (!currentPanel) return;
    const { forward_state, next_panel_id } = currentPanel;
    if (forward_state === 'ready' && !next_panel_id) {
      setIsPolling(true);
      pollingRef.current = setInterval(async () => {
        try {
          const result = await utils.worlds.nextReady.fetch({ panelId: currentPanel.panel_id });
          if (result.ready) {
            stopPolling();
            await loadPanel(result.panel_id, world.external_id);
          }
        } catch {
          // Non-fatal — keep polling
        }
      }, 1000);
    }
    return () => stopPolling();
  }, [currentPanel?.panel_id, currentPanel?.forward_state, currentPanel?.next_panel_id]);

  useEffect(() => () => stopPolling(), [stopPolling]);

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
      setIsPolling(true);
      pollingRef.current = setInterval(async () => {
        try {
          const result = await utils.worlds.nextReady.fetch({ panelId: currentPanel.panel_id });
          if (result.ready) {
            stopPolling();
            await loadPanel(result.panel_id, world.external_id);
          }
        } catch {
          // Non-fatal — keep polling
        }
      }, 1000);
      return;
    }
    // For forward navigation: use the embedded next_panel data if available (instant, no fetch)
    if (direction === 'next' && currentPanel.next_panel) {
      const embedded = currentPanel.next_panel as PanelData;
      stopPolling();
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
      setCurrentPanel(embeddedPanel);
      setPanelMutation.mutate({ worldId: world.external_id, panelId: embedded.panel_id });
      setIsNavigating(false);
      setIsLoading(false);
      // If the embedded panel also has a next_panel_id but no next_panel data, start polling if needed
      if (embedded.forward_state === 'ready' && !embedded.next_panel_id) {
        setIsPolling(true);
        pollingRef.current = setInterval(async () => {
          try {
            const result = await utils.worlds.nextReady.fetch({ panelId: embedded.panel_id });
            if (result.ready) {
              stopPolling();
              await loadPanel(result.panel_id, world.external_id);
            }
          } catch {
            // Non-fatal — keep polling
          }
        }, 1000);
      }
      return;
    }
    await loadPanel(targetId, world.external_id);
  }, [currentPanel, isNavigating, isPolling, loadPanel, world.external_id, utils, stopPolling, showChoiceIdeasByDefault, setPanelMutation]);

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
      {canGoBack && !isNavigating && (
        <div
          className="fixed left-0 top-0 bottom-0 z-10"
          style={{ width: '25vw', cursor: 'pointer' }}
          onClick={() => handleNavigate('prev')}
          aria-label="Previous panel"
        />
      )}
      {(canGoForward || isPolling || isRegeneratePolling) && !isNavigating && (
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
          className="flex items-center justify-center rounded-full transition-all hover:bg-white/20"
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}
        >
          <ChevronLeft size={22} strokeWidth={2} />
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
          className="relative flex items-center justify-center rounded-full transition-all hover:bg-white/20"
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', color: regenerateTimedOut ? '#ef4444' : 'rgba(255,255,255,0.8)' }}
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
            <ChevronRight size={22} strokeWidth={2} />
          )}
        </div>
      </button>

      {/* Center panel */}
      <div className="absolute inset-0 flex items-start justify-center">
        <div
          className="relative"
          style={{
            height: '100dvh',
            // On mobile (narrow screens), fill full width; on wider screens constrain to 9:16
            width: 'min(100vw, calc(100dvh * 9 / 16))',
            overflow: 'hidden',
            background: '#080808',
          }}
        >
          {/* Menu trigger — pill indicator + large tap zone covering the top portion */}
          <div
            className="absolute top-0 left-0 right-0 z-30 flex flex-col items-center"
            style={{ height: '56px', cursor: 'pointer' }}
            onClick={() => setMenuOpen(true)}
            onTouchStart={(e) => {
              touchStartY.current = e.touches[0].clientY;
              touchStartX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchStartY.current === null || touchStartX.current === null) return;
              const dy = e.changedTouches[0].clientY - touchStartY.current;
              const dx = Math.abs(e.changedTouches[0].clientX - touchStartX.current);
              // Swipe down ≥ 40px, more vertical than horizontal
              if (dy > 40 && dx < 60) {
                setMenuOpen(true);
              }
              touchStartY.current = null;
              touchStartX.current = null;
            }}
            aria-label="Open story menu"
          >
            <div
              style={{
                width: '36px',
                height: '4px',
                borderRadius: '2px',
                background: 'rgba(255,255,255,0.5)',
                marginTop: '8px',
              }}
            />
          </div>

          {/* Story menu overlay */}
          <StoryMenu
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
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
                  setCurrentPanel(data);
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
            <span style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '16px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>
              freeroam
            </span>
            <div className="flex items-center gap-2 pointer-events-auto">
              {panel && (
                <span style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>
                  Page {panel.depth}
                </span>
              )}
              {/* Bookmark toggle */}
              <button
                onClick={handleToggleBookmark}
                disabled={isTogglingBookmark || !panel}
                className="flex items-center justify-center rounded-full transition-all hover:bg-white/20 disabled:opacity-40"
                style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', color: isBookmarked ? '#f5c440' : 'rgba(255,255,255,0.75)' }}
                title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
              >
                <Bookmark
                  size={14}
                  strokeWidth={2}
                  fill={isBookmarked ? '#f5c440' : 'none'}
                />
              </button>
              <button
                onClick={onClose}
                className="flex items-center justify-center rounded-full transition-all hover:bg-white/20"
                style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}
                title="Close"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Loading overlay */}
          {(isLoading || isNavigating) && (
            <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <Loader2 size={36} className="animate-spin" style={{ color: 'rgba(255,255,255,0.6)' }} />
            </div>
          )}

          {/* Panel image */}
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full"
              style={{ objectFit: 'cover', objectPosition: 'center top', opacity: isNavigating ? 0.35 : 1, transition: 'opacity 0.15s ease' }}
            />
          )}

          {/* Bottom text overlay */}
          {hasText && !isLoading && !isNavigating && (
            <>
              {/* storyVnDialogue__scrim — exact Freeroam gradient for text readability */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.4) 74%, rgba(0,0,0,0.58))' }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 z-10 px-5"
                style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}
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

                {/* Dialogue text — Outfit SemiBold, matches Freeroam spoken style exactly */}
                {dialogueText && (
                  <p
                    style={{
                      fontFamily: 'Outfit, sans-serif',
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

                {/* Narration text — Outfit Medium italic, matches Freeroam narration style */}
                {narrationText && (
                  <p
                    style={{
                      fontFamily: 'Outfit, sans-serif',
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
                      paddingLeft: '26px',
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
          {panel && !isLoading && !isNavigating && (
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
                svg: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>,
              }, {
                title: 'Thumbs down',
                onClick: () => toast('Feedback — coming soon'),
                svg: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>,
              }, {
                title: 'Edit response',
                onClick: () => toast('Edit response — coming soon'),
                svg: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
              }].map(({ title, onClick, svg }) => (
                <button
                  key={title}
                  title={title}
                  onClick={onClick}
                  className="transition-all hover:brightness-125"
                  style={{
                    width: '30px',
                    height: '30px',
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
          {hasChoice && !isLoading && !isNavigating && (
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
              <div className="flex items-center gap-2 px-4 py-2 rounded-2xl" style={{ background: 'rgba(30,30,40,0.85)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)' }}>
                <input
                  type="text"
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && actionInput.trim()) handleSendAction(actionInput, 'choice'); }}
                  placeholder="Or type your own"
                  className="flex-1 outline-none"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', minWidth: 0 }}
                />
                <button
                  onClick={() => { if (actionInput.trim()) handleSendAction(actionInput, 'choice'); }}
                  disabled={!actionInput.trim() || isSendingAction}
                  className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:brightness-125 disabled:opacity-40"
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
          {/* Input field row (shown when Act/Direct/Image active) */}
          {activeInputMode && (
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ background: 'rgba(10,10,16,0.92)', borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <input
                autoFocus
                type="text"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setActiveInputMode(null); setActionInput(''); }
                  if (e.key === 'Enter' && actionInput.trim()) {
                    const type = activeInputMode === 'act' ? 'take-action' : activeInputMode === 'direct' ? 'steer-story' : 'image';
                    handleSendAction(actionInput, type as 'take-action' | 'steer-story' | 'image');
                  }
                }}
                placeholder={activeInputMode === 'act' ? 'What do you do?' : activeInputMode === 'direct' ? 'Direct the scene...' : 'Describe the image...'}
                className="flex-1 outline-none"
                style={{
                  fontFamily: 'Lora, Georgia, serif',
                  fontSize: '14px',
                  fontStyle: 'italic',
                  color: 'rgba(255,255,255,0.85)',
                  background: 'transparent',
                  border: 'none',
                  minWidth: 0,
                }}
              />
              <button
                onClick={() => {
                  if (!actionInput.trim()) return;
                  const type = activeInputMode === 'act' ? 'take-action' : activeInputMode === 'direct' ? 'steer-story' : 'image';
                  handleSendAction(actionInput, type as 'take-action' | 'steer-story' | 'image');
                }}
                disabled={!actionInput.trim() || isSendingAction}
                className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:brightness-125 disabled:opacity-40"
                style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.15)', color: '#fff' }}
              >
                {isSendingAction ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={18} strokeWidth={2.5} />}
              </button>
            </div>
          )}

          {/* Pill buttons row */}
          <div
            className="flex items-center gap-1.5 px-2 py-2"
            style={{ background: 'rgba(10,10,16,0.88)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.07)' }}
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
              onClick={() => { setActionBarVisible(false); setActiveInputMode(null); setActionInput(''); }}
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
                { icon: <Users size={13} strokeWidth={2} />, label: 'Characters', mode: null, action: () => setCharPanelOpen(true) },
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
        onClose={() => setCharPanelOpen(false)}
        worldId={world.external_id}
        panelId={panel?.panel_id ?? ''}
        onSaveChanges={async (addIds, removeIds) => {
          await handleSendAction(
            addIds.length > 0
              ? `Add characters: ${addIds.join(', ')}`
              : `Remove characters: ${removeIds.join(', ')}`,
            'choice',
            {
              add_character_ids: addIds,
              remove_character_ids: removeIds,
              new_main_character_id: null,
              old_main_character_id: null,
              batch_character_update: true,
            }
          );
        }}
        onPlayAs={async (newMainId, oldMainId, newMainName) => {
          setCharPanelOpen(false);
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
