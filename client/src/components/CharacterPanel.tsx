/**
 * CharacterPanel — 3-view overlay for managing story characters
 *
 * View 1: Current story characters (main panel)
 * View 2: Character library browser (add character)
 * View 3: Character detail (from library)
 */

import { trpc } from '@/lib/trpc';
import { getFreeroamAuthHeaders } from '@/lib/freeroamHeaders';
import { useCollections, type Collection } from '@/hooks/useCollections';
import { X, Plus, ArrowLeft, Search, Loader2, Save, FolderOpen, Star, Check, ChevronRight, Info } from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';

type StoryCharacter = {
  id: number;
  external_id: string;
  name: string;
  backstory: string;
  appearance: string;
  headshot_url: string;
  display_headshot_url: string | null;
  removable: boolean;
  is_main_character: boolean;
  is_saved: boolean;
  is_yours: boolean;
  creator_name: string;
};

type LibraryCharacter = {
  external_id: string;
  name: string;
  headshot_url: string | null;
  backstory: string;
  appearance: string;
  is_saved?: boolean;
  is_yours?: boolean;
};

type CharacterPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  worldId: string;
  panelId: string;
  onSaveChanges: (adds: { id: string; name: string }[], removes: { id: string; name: string }[]) => Promise<void>;
  onPlayAs: (newMainId: string, oldMainId: string, newMainName: string) => Promise<void>;
  onEditCharacter: (
    charId: string,
    oldName: string,
    newName: string,
    oldBackstory: string,
    newBackstory: string,
    oldAppearance: string,
    newAppearance: string,
    photoChanged?: boolean,
    newHeadshotUrl?: string
  ) => Promise<void>;
};

type LibraryFilter = 'all' | 'favorites' | 'collections';

const LIBRARY_FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'collections', label: 'Collections' },
];

type HeadshotPair = { headshot_url: string; display_headshot_url: string | null };

function hasHeadshotUrl(c: { headshot_url?: string | null; display_headshot_url?: string | null }): boolean {
  return !!(c.display_headshot_url || c.headshot_url);
}

function toHeadshotPair(
  headshot_url?: string | null,
  display_headshot_url?: string | null
): HeadshotPair | null {
  const primary = display_headshot_url || headshot_url || '';
  if (!primary) return null;
  return {
    headshot_url: headshot_url || display_headshot_url || '',
    display_headshot_url: display_headshot_url || headshot_url || null,
  };
}

/** Warm the browser image cache so story cards paint immediately after add. */
function prefetchHeadshot(url: string | null | undefined) {
  if (!url || typeof window === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

/**
 * Collection list row with cover thumbnail. Falls back to a headshot mosaic or
 * folder icon when the cover URL is missing or fails (common for migrated
 * `/manus-storage/...` covers when local Forge files are absent).
 */
function CollectionFolderRow({
  name,
  count,
  coverImage,
  previewChars,
  onOpen,
}: {
  name: string;
  count: number;
  coverImage?: string | null;
  previewChars: LibraryCharacter[];
  onOpen: () => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    setCoverFailed(false);
  }, [coverImage]);

  const showCover = !!coverImage && !coverFailed;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-2xl w-full text-left transition-all hover:brightness-125"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        className="flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
        style={{
          width: '56px',
          height: '56px',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {showCover ? (
          <img
            src={coverImage!}
            alt=""
            className="w-full h-full"
            style={{ objectFit: 'cover' }}
            onError={() => setCoverFailed(true)}
          />
        ) : previewChars.length > 0 ? (
          <div className="grid grid-cols-2 w-full h-full">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                {previewChars[i]?.headshot_url && (
                  <img
                    src={previewChars[i]!.headshot_url!}
                    alt=""
                    className="w-full h-full"
                    style={{ objectFit: 'cover', objectPosition: 'center top' }}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <FolderOpen size={22} style={{ color: 'rgba(255,255,255,0.25)' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '15px', fontWeight: 600, color: '#fff', lineHeight: 1.3 }} className="truncate">
          {name}
        </p>
        <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
          {count === 0 ? 'Empty' : `${count} character${count === 1 ? '' : 's'} · open folder`}
        </p>
      </div>
      <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
    </button>
  );
}

/**
 * Portrait headshot with placeholder until load, plus fallback between
 * display_headshot_url and headshot_url when one URL fails.
 */
function StoryCharHeadshot({
  name,
  headshotUrl,
  displayHeadshotUrl,
}: {
  name: string;
  headshotUrl: string;
  displayHeadshotUrl: string | null;
}) {
  const primary = displayHeadshotUrl || headshotUrl || '';
  const secondary =
    headshotUrl && headshotUrl !== primary
      ? headshotUrl
      : displayHeadshotUrl && displayHeadshotUrl !== primary
        ? displayHeadshotUrl
        : '';

  const [src, setSrc] = useState(primary);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(!primary);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setSrc(primary);
    setLoaded(false);
    setFailed(!primary);
  }, [primary]);

  // Cached images often skip onLoad — detect already-complete frames
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const showPlaceholder = failed || !src || !loaded;

  return (
    <div className="absolute inset-0">
      {showPlaceholder && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '32px', color: 'rgba(255,255,255,0.2)' }}>
            {(name.replace(/-/g, ' ')[0] || '?').toUpperCase()}
          </span>
        </div>
      )}
      {src && !failed && (
        <img
          ref={imgRef}
          src={src}
          alt={name}
          className="absolute inset-0 w-full h-full"
          style={{
            objectFit: 'cover',
            objectPosition: 'center top',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.15s ease',
          }}
          loading="eager"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (secondary && src !== secondary) {
              setSrc(secondary);
              setLoaded(false);
            } else {
              setFailed(true);
            }
          }}
        />
      )}
    </div>
  );
}

export default function CharacterPanel({
  isOpen,
  onClose,
  worldId,
  panelId,
  onSaveChanges,
  onPlayAs,
  onEditCharacter,
}: CharacterPanelProps) {
  const [isPlayingAs, setIsPlayingAs] = useState(false);
  const [pendingPlayAs, setPendingPlayAs] = useState<string | null>(null); // external_id of char to play as
  const [view, setView] = useState<'main' | 'library' | 'detail' | 'story-detail'>('main');
  const [storyChars, setStoryChars] = useState<StoryCharacter[]>([]);
  const [pendingChanges, setPendingChanges] = useState<Map<string, 'add' | 'remove'>>(new Map());
  const [isLoadingChars, setIsLoadingChars] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Library state
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryChars, setLibraryChars] = useState<LibraryCharacter[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  /** When set, library shows that collection's members instead of the collection list */
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  /** Multi-select queue while browsing the library / a collection folder */
  const [librarySelection, setLibrarySelection] = useState<Set<string>>(() => new Set());

  // Detail state (library character)
  const [detailChar, setDetailChar] = useState<LibraryCharacter | null>(null);
  // Story character detail state
  const [storyDetailChar, setStoryDetailChar] = useState<StoryCharacter | null>(null);

  const utils = trpc.useUtils();
  const { collections, isLoading: isLoadingCollections } = useCollections();

  /**
   * Session cache of known headshots. Freeroam's panel-characters endpoint often
   * returns newly batch-added cast without headshot URLs for a while; we keep URLs
   * from the library / prior loads so cards don't go blank.
   */
  const headshotCacheRef = useRef<Map<string, HeadshotPair>>(new Map());
  const headshotBackfillGen = useRef(0);
  const libraryCharsRef = useRef(libraryChars);
  libraryCharsRef.current = libraryChars;

  const rememberHeadshot = useCallback((
    externalId: string,
    headshot_url?: string | null,
    display_headshot_url?: string | null
  ) => {
    const pair = toHeadshotPair(headshot_url, display_headshot_url);
    if (!pair) return;
    headshotCacheRef.current.set(externalId, pair);
  }, []);

  const applyHeadshotSources = useCallback((
    chars: StoryCharacter[],
    libraryByIdMap?: Map<string, LibraryCharacter>
  ): StoryCharacter[] => {
    return chars.map((c) => {
      if (hasHeadshotUrl(c)) {
        rememberHeadshot(c.external_id, c.headshot_url, c.display_headshot_url);
        return c;
      }
      const fromLib = libraryByIdMap?.get(c.external_id);
      if (fromLib?.headshot_url) {
        rememberHeadshot(c.external_id, fromLib.headshot_url, fromLib.headshot_url);
        return {
          ...c,
          headshot_url: fromLib.headshot_url,
          display_headshot_url: fromLib.headshot_url,
        };
      }
      const cached = headshotCacheRef.current.get(c.external_id);
      if (cached) {
        return { ...c, ...cached };
      }
      return c;
    });
  }, [rememberHeadshot]);

  // Load story characters when panel opens
  const loadStoryChars = useCallback(async () => {
    if (!panelId) return;
    const gen = ++headshotBackfillGen.current;
    setIsLoadingChars(true);
    try {
      const data = await utils.worlds.getPanelCharacters.fetch({ worldId, panelId });
      let chars: StoryCharacter[] = [
        ...data.story_characters,
        ...data.world_characters,
      ] as StoryCharacter[];

      // Prefer already-loaded library for immediate backfill
      let libMap = new Map(libraryCharsRef.current.map((c) => [c.external_id, c]));
      chars = applyHeadshotSources(chars, libMap);

      // If any still missing headshots, fetch library (may already be cached by tRPC)
      const missingAfterCache = chars.filter((c) => !hasHeadshotUrl(c));
      if (missingAfterCache.length > 0) {
        try {
          const lib = await utils.characters.library.fetch();
          if (gen !== headshotBackfillGen.current) return;
          const mapped: LibraryCharacter[] = lib.map((c) => ({
            external_id: c.external_id,
            name: c.name,
            headshot_url: c.headshot_url ?? c.display_headshot_url ?? null,
            backstory: c.backstory ?? c.description ?? '',
            appearance: '',
            is_yours: c.is_yours,
            is_saved: c.is_saved,
          }));
          setLibraryChars((prev) => (prev.length > 0 ? prev : mapped));
          libMap = new Map(mapped.map((c) => [c.external_id, c]));
          for (const c of mapped) {
            if (c.headshot_url) rememberHeadshot(c.external_id, c.headshot_url, c.headshot_url);
          }
          chars = applyHeadshotSources(chars, libMap);
        } catch {
          // Non-fatal — continue with what we have
        }
      }

      if (gen !== headshotBackfillGen.current) return;
      setStoryChars(chars);

      // Background: fill remaining gaps via characters.get (Freeroam detail has headshots
      // even when the panel cast payload is still incomplete after a batch add).
      const stillMissing = chars.filter((c) => !hasHeadshotUrl(c));
      if (stillMissing.length > 0) {
        void Promise.all(
          stillMissing.map(async (c) => {
            try {
              const full = await utils.characters.get.fetch({ characterId: c.external_id });
              const pair = toHeadshotPair(full.headshot_url, full.display_headshot_url);
              if (!pair) return null;
              rememberHeadshot(c.external_id, pair.headshot_url, pair.display_headshot_url);
              prefetchHeadshot(pair.display_headshot_url || pair.headshot_url);
              return { id: c.external_id, ...pair } as const;
            } catch {
              return null;
            }
          })
        ).then((results) => {
          if (gen !== headshotBackfillGen.current) return;
          const updates = new Map(
            results.filter((r): r is { id: string } & HeadshotPair => !!r).map((r) => [r.id, r])
          );
          if (updates.size === 0) return;
          setStoryChars((prev) =>
            prev.map((c) => {
              const u = updates.get(c.external_id);
              if (!u || hasHeadshotUrl(c)) return c;
              return {
                ...c,
                headshot_url: u.headshot_url,
                display_headshot_url: u.display_headshot_url,
              };
            })
          );
        });
      }
    } catch {
      // Non-fatal
    } finally {
      if (gen === headshotBackfillGen.current) setIsLoadingChars(false);
    }
  }, [worldId, panelId, utils, applyHeadshotSources, rememberHeadshot]);

  useEffect(() => {
    if (isOpen) {
      setView('main');
      setPendingChanges(new Map());
      setPendingPlayAs(null);
      setLibraryFilter('all');
      setLibrarySearch('');
      setSelectedCollectionId(null);
      setLibrarySelection(new Set());
      loadStoryChars();
    }
  }, [isOpen, loadStoryChars]);

  // Load library characters
  const loadLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const chars = await utils.characters.library.fetch();
      const mapped = chars.map((c) => ({
        external_id: c.external_id,
        name: c.name,
        headshot_url: c.headshot_url ?? c.display_headshot_url ?? null,
        backstory: c.backstory ?? c.description ?? '',
        appearance: '',
        is_yours: c.is_yours,
        is_saved: c.is_saved,
      }));
      for (const c of mapped) {
        if (c.headshot_url) rememberHeadshot(c.external_id, c.headshot_url, c.headshot_url);
      }
      setLibraryChars(mapped);
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingLibrary(false);
    }
  }, [utils, rememberHeadshot]);

  const handleOpenLibrary = () => {
    setView('library');
    setLibraryFilter('all');
    setLibrarySearch('');
    setSelectedCollectionId(null);
    setLibrarySelection(new Set());
    if (libraryChars.length === 0) loadLibrary();
  };

  const libraryById = useMemo(() => {
    const map = new Map<string, LibraryCharacter>();
    for (const c of libraryChars) map.set(c.external_id, c);
    return map;
  }, [libraryChars]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId]
  );

  const storyCharIds = useMemo(
    () => new Set(storyChars.map((sc) => sc.external_id)),
    [storyChars]
  );

  /** Resolve collection member IDs against the library (placeholders for unresolved). */
  const resolveCollectionMembers = useCallback(
    (col: Collection): LibraryCharacter[] =>
      col.characterIds.map((id) => {
        const known = libraryById.get(id);
        if (known) return known;
        return {
          external_id: id,
          name: id,
          headshot_url: null,
          backstory: '',
          appearance: '',
        };
      }),
    [libraryById]
  );

  const handleOpenDetail = (char: LibraryCharacter) => {
    setDetailChar(char);
    setView('detail');
  };

  const toPendingStoryChar = (char: LibraryCharacter): StoryCharacter => {
    const url = char.headshot_url ?? '';
    // Remember + prefetch so the card paints immediately and survives panel reopen
    // before Freeroam's cast endpoint includes the headshot.
    if (url) {
      rememberHeadshot(char.external_id, url, url);
      prefetchHeadshot(url);
    }
    return {
      id: 0,
      external_id: char.external_id,
      name: char.name,
      backstory: char.backstory,
      appearance: char.appearance,
      headshot_url: url,
      display_headshot_url: url || null,
      removable: true,
      is_main_character: false,
      is_saved: char.is_saved ?? false,
      is_yours: char.is_yours ?? false,
      creator_name: '',
    };
  };

  const handleAddFromLibrary = (char: LibraryCharacter) => {
    // Check if already in story
    if (storyCharIds.has(char.external_id)) {
      toast.info('Character is already in the story');
      setView('main');
      return;
    }
    // Add to pending
    const newPending = new Map(pendingChanges);
    newPending.set(char.external_id, 'add');
    setPendingChanges(newPending);
    setStoryChars(prev => [...prev, toPendingStoryChar(char)]);
    setLibrarySelection((prev) => {
      if (!prev.has(char.external_id)) return prev;
      const next = new Set(prev);
      next.delete(char.external_id);
      return next;
    });
    setView('main');
    toast.success(`${char.name.replace(/-/g, ' ')} added — click Save Changes to confirm`);
  };

  /** Open a collection as a folder of selectable members (no bulk add-all). */
  const handleSelectCollection = (col: Collection) => {
    if (!col.characterIds.length) {
      toast.info('This collection is empty');
      return;
    }
    setSelectedCollectionId(col.id);
    setLibrarySearch('');
    setLibrarySelection(new Set());
    // Members resolve against the library — ensure it is loaded
    if (libraryChars.length === 0) loadLibrary();
  };

  const toggleLibrarySelection = (char: LibraryCharacter) => {
    if (storyCharIds.has(char.external_id)) {
      toast.info('Character is already in the story');
      return;
    }
    setLibrarySelection((prev) => {
      const next = new Set(prev);
      if (next.has(char.external_id)) next.delete(char.external_id);
      else next.add(char.external_id);
      return next;
    });
  };

  /** Resolve selected IDs to character records (library first, then open collection placeholders). */
  const resolveSelectedLibraryChars = useCallback((): LibraryCharacter[] => {
    const collectionMembers = selectedCollection
      ? resolveCollectionMembers(selectedCollection)
      : [];
    const memberById = new Map(collectionMembers.map((c) => [c.external_id, c]));
    const out: LibraryCharacter[] = [];
    Array.from(librarySelection).forEach((id) => {
      const known = libraryById.get(id) ?? memberById.get(id);
      if (known) out.push(known);
      else {
        out.push({
          external_id: id,
          name: id,
          headshot_url: null,
          backstory: '',
          appearance: '',
        });
      }
    });
    return out;
  }, [librarySelection, libraryById, selectedCollection, resolveCollectionMembers]);

  /** Multi-select add: queue every selected character that is not already in the story. */
  const handleAddSelectedToStory = () => {
    const selected = resolveSelectedLibraryChars();
    if (selected.length === 0) {
      toast.info('Select at least one character');
      return;
    }

    const inStory = new Set(storyCharIds);
    const newPending = new Map(pendingChanges);
    const toAdd: StoryCharacter[] = [];
    let skipped = 0;

    for (const char of selected) {
      if (inStory.has(char.external_id) || newPending.get(char.external_id) === 'add') {
        skipped += 1;
        continue;
      }
      newPending.set(char.external_id, 'add');
      toAdd.push(toPendingStoryChar(char));
      inStory.add(char.external_id);
    }

    if (toAdd.length === 0) {
      toast.info(
        skipped > 0
          ? `All selected character${skipped === 1 ? ' is' : 's are'} already in the story`
          : 'No characters to add'
      );
      setLibrarySelection(new Set());
      return;
    }

    setPendingChanges(newPending);
    setStoryChars((prev) => [...prev, ...toAdd]);
    setLibrarySelection(new Set());
    setSelectedCollectionId(null);
    setView('main');

    if (skipped > 0) {
      toast.success(
        `Added ${toAdd.length} character${toAdd.length === 1 ? '' : 's'} (${skipped} already in story) — click Save Changes to confirm`
      );
    } else {
      toast.success(
        `Added ${toAdd.length} character${toAdd.length === 1 ? '' : 's'} — click Save Changes to confirm`
      );
    }
  };

  const selectAllVisible = (chars: LibraryCharacter[]) => {
    const selectable = chars.filter((c) => !storyCharIds.has(c.external_id));
    if (selectable.length === 0) {
      toast.info('All visible characters are already in the story');
      return;
    }
    setLibrarySelection((prev) => {
      const next = new Set(prev);
      for (const c of selectable) next.add(c.external_id);
      return next;
    });
  };

  const clearLibrarySelection = () => setLibrarySelection(new Set());

  const handleToggleRemove = (char: StoryCharacter) => {
    const newPending = new Map(pendingChanges);
    const current = newPending.get(char.external_id);
    if (current === 'add') {
      // Cancel the add
      newPending.delete(char.external_id);
      setStoryChars(prev => prev.filter(sc => sc.external_id !== char.external_id));
    } else if (current === 'remove') {
      // Cancel the remove
      newPending.delete(char.external_id);
    } else {
      // Mark for removal
      newPending.set(char.external_id, 'remove');
    }
    setPendingChanges(newPending);
  };

  const handleSave = async () => {
    const adds: { id: string; name: string }[] = [];
    const removes: { id: string; name: string }[] = [];
    const allKnownChars = [...storyChars, ...libraryChars];
    pendingChanges.forEach((type, id) => {
      const char = allKnownChars.find(c => c.external_id === id);
      const name = char ? char.name.replace(/-/g, ' ') : id;
      if (type === 'add') adds.push({ id, name });
      else if (type === 'remove') removes.push({ id, name });
    });
    // Handle play-as change
    if (pendingPlayAs) {
      const mainChar = storyChars.find(sc => sc.is_main_character);
      const newMainChar = storyChars.find(sc => sc.external_id === pendingPlayAs);
      if (mainChar && newMainChar) {
        setIsSaving(true);
        try {
          await onPlayAs(pendingPlayAs, mainChar.external_id, newMainChar.name.replace(/-/g, ' '));
          onClose();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to change main character');
        } finally {
          setIsSaving(false);
        }
        return;
      }
    }
    if (adds.length === 0 && removes.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      await onSaveChanges(adds, removes);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const hasPendingChanges = pendingChanges.size > 0 || !!pendingPlayAs;

  const searchLower = librarySearch.trim().toLowerCase();

  // Filter library characters (All / Favorites)
  const filteredLibrary = libraryChars.filter((char) => {
    const matchesSearch = !searchLower || char.name.toLowerCase().includes(searchLower);
    const matchesFilter =
      libraryFilter === 'all' ||
      (libraryFilter === 'favorites' && !!char.is_saved);
    return matchesSearch && matchesFilter;
  });

  // Collections list (name search)
  const filteredCollections = collections.filter((col) => {
    if (!searchLower) return true;
    return col.name.toLowerCase().includes(searchLower);
  });

  // Members of the opened collection
  const collectionMembers = selectedCollection
    ? resolveCollectionMembers(selectedCollection).filter(
        (char) => !searchLower || char.name.toLowerCase().includes(searchLower)
      )
    : [];

  /** Character grid currently shown for multi-select (All / Favorites / open collection folder). */
  const selectableLibraryChars = selectedCollection ? collectionMembers : filteredLibrary;
  const selectionCount = librarySelection.size;
  const visibleSelectableCount = selectableLibraryChars.filter((c) => !storyCharIds.has(c.external_id)).length;

  const renderLibraryCharCard = (char: LibraryCharacter) => {
    const inStory = storyCharIds.has(char.external_id);
    const isSelected = librarySelection.has(char.external_id);
    return (
      <div
        key={char.external_id}
        className="relative flex flex-col items-center gap-2 p-4 rounded-2xl transition-all text-left"
        style={{
          background: isSelected ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${
            inStory
              ? 'rgba(34,197,94,0.35)'
              : isSelected
                ? 'rgba(124,58,237,0.65)'
                : 'rgba(255,255,255,0.08)'
          }`,
          opacity: inStory ? 0.7 : 1,
        }}
      >
        <button
          type="button"
          onClick={() => toggleLibrarySelection(char)}
          disabled={inStory}
          className="flex flex-col items-center gap-2 w-full transition-all hover:brightness-125 disabled:hover:brightness-100"
          style={{ border: 'none', background: 'transparent', padding: 0, cursor: inStory ? 'default' : 'pointer' }}
        >
          {char.headshot_url ? (
            <img
              src={char.headshot_url}
              alt={char.name}
              className="rounded-full"
              style={{ width: '72px', height: '72px', objectFit: 'cover' }}
            />
          ) : (
            <div
              className="rounded-full flex items-center justify-center"
              style={{ width: '72px', height: '72px', background: 'rgba(255,255,255,0.08)', fontSize: '28px', color: 'rgba(255,255,255,0.3)' }}
            >
              {(char.name[0] || '?').toUpperCase()}
            </div>
          )}
          <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff', textAlign: 'center', lineHeight: 1.3 }}>
            {char.name.replace(/-/g, ' ')}
          </p>
          <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '11px', color: inStory ? 'rgba(34,197,94,0.9)' : isSelected ? 'rgba(167,139,250,0.95)' : 'rgba(255,255,255,0.4)' }}>
            {inStory ? 'in story' : isSelected ? 'selected' : 'tap to select'}
          </p>
          {!inStory && char.is_saved && (
            <p className="inline-flex items-center gap-1" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '11px', color: 'rgba(250,204,21,0.85)' }}>
              <Star size={10} fill="currentColor" strokeWidth={0} />
              favorite
            </p>
          )}
        </button>
        {/* Multi-select circle — top-right of the card square */}
        {!inStory && (
          <div
            className="absolute top-2 right-2 flex items-center justify-center rounded-full pointer-events-none"
            style={{
              width: '24px',
              height: '24px',
              background: isSelected ? '#7c3aed' : 'rgba(0,0,0,0.45)',
              border: `1.5px solid ${isSelected ? '#a78bfa' : 'rgba(255,255,255,0.35)'}`,
            }}
            aria-hidden
          >
            {isSelected && <Check size={12} strokeWidth={3} color="#fff" />}
          </div>
        )}
        {/* Optional detail peek without leaving multi-select */}
        {!inStory && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDetail(char);
            }}
            className="absolute top-2 left-2 flex items-center justify-center rounded-full transition-all hover:brightness-125"
            style={{
              width: '24px',
              height: '24px',
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.55)',
            }}
            title="View details"
            aria-label={`View details for ${char.name}`}
          >
            <Info size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col w-full sm:w-[min(92vw,820px)] h-[min(94dvh,100%)] sm:h-auto sm:max-h-[88dvh] rounded-t-[22px] sm:rounded-[20px]"
        style={{
          background: 'rgba(18,18,26,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Mobile sheet grab affordance */}
        <div className="flex justify-center pt-2.5 pb-0.5 sm:hidden flex-shrink-0" aria-hidden>
          <div style={{ width: '36px', height: '4px', borderRadius: '999px', background: 'rgba(255,255,255,0.18)' }} />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center justify-center rounded-full transition-all hover:bg-white/10"
          style={{ width: '32px', height: '32px', color: 'rgba(255,255,255,0.5)' }}
        >
          <X size={16} strokeWidth={2} />
        </button>

        {/* ── VIEW 1: MAIN ── */}
        {view === 'main' && (
          <>
            <div className="px-4 sm:px-6 pt-3 sm:pt-6 pb-3 text-center flex-shrink-0">
              <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                Characters
              </h2>
              <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
                Upload yourself, use your OC, or customize any character
              </p>
            </div>

            {/* Add Character button */}
            <div className="px-4 sm:px-6 pb-3 flex-shrink-0">
              <button
                onClick={handleOpenLibrary}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.85)',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                <Plus size={16} strokeWidth={2.5} />
                Add Character
              </button>
            </div>

            {/* Character cards grid — fluid 2-col on mobile, fills width like Freeroam */}
            <div className={`flex-1 overflow-y-auto px-4 sm:px-6 ${hasPendingChanges ? 'pb-3' : 'pb-5 sm:pb-6'}`}>
              {isLoadingChars ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                </div>
              ) : (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 148px), 1fr))' }}
                >
                  {storyChars.map((char) => {
                    const pending = pendingChanges.get(char.external_id);
                    const isRemoving = pending === 'remove';
                    const isAdding = pending === 'add';

                    return (
                      <div
                        key={char.external_id}
                        className="relative w-full cursor-pointer"
                        onClick={() => { setStoryDetailChar(char); setView('story-detail'); }}
                        style={{
                          aspectRatio: '7 / 10',
                          borderRadius: '14px',
                          overflow: 'hidden',
                          border: isRemoving
                            ? '2px solid rgba(239,68,68,0.8)'
                            : isAdding
                            ? '2px solid rgba(34,197,94,0.8)'
                            : char.is_main_character
                            ? '2px solid rgba(234,179,8,0.8)'
                            : '2px solid rgba(255,255,255,0.08)',
                          background: '#1a1a2e',
                          opacity: isRemoving ? 0.55 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Headshot — placeholder until paint; falls back between URL fields */}
                        <StoryCharHeadshot
                          name={char.name}
                          headshotUrl={char.headshot_url}
                          displayHeadshotUrl={char.display_headshot_url}
                        />

                        {/* Gradient overlay */}
                        <div
                          className="absolute inset-0"
                          style={{ background: 'linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.85) 100%)' }}
                        />

                        {/* Top-left badge — 'You' for main, clickable 'Play as' for others */}
                        {char.is_main_character ? (
                          <div
                            className="absolute top-2 left-2 px-2.5 py-1 rounded-full"
                            style={{
                              fontFamily: 'Outfit, sans-serif',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#fff',
                              background: 'rgba(0,0,0,0.55)',
                              backdropFilter: 'blur(6px)',
                            }}
                          >
                            You
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingPlayAs(prev => prev === char.external_id ? null : char.external_id);
                            }}
                            className="absolute top-2 left-2 px-2.5 py-1 rounded-full transition-all hover:brightness-125"
                            style={{
                              fontFamily: 'Outfit, sans-serif',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#fff',
                              background: pendingPlayAs === char.external_id
                                ? 'rgba(34,197,94,0.75)'
                                : 'rgba(0,0,0,0.55)',
                              backdropFilter: 'blur(6px)',
                              border: 'none',
                            }}
                          >
                            {pendingPlayAs === char.external_id ? '✓ Play as' : 'Play as'}
                          </button>
                        )}

                        {/* Minus / restore button */}
                        {char.removable && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleRemove(char); }}
                            className="absolute top-2 right-2 flex items-center justify-center rounded-full transition-all hover:brightness-125"
                            style={{
                              width: '24px',
                              height: '24px',
                              background: isRemoving ? 'rgba(34,197,94,0.8)' : 'rgba(0,0,0,0.6)',
                              color: '#fff',
                              backdropFilter: 'blur(4px)',
                            }}
                          >
                            {isRemoving ? (
                              <Plus size={12} strokeWidth={2.5} />
                            ) : (
                              <span style={{ fontSize: '16px', lineHeight: 1, marginTop: '-1px' }}>−</span>
                            )}
                          </button>
                        )}

                        {/* Name + label at bottom */}
                        <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
                          <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                            {char.name.replace(/-/g, ' ')}
                          </p>
                          {char.is_main_character && (
                            <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '2px' }}>
                              Main Character
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Empty slot */}
                  <button
                    onClick={handleOpenLibrary}
                    className="relative w-full flex flex-col items-center justify-center gap-2 transition-all hover:brightness-125"
                    style={{
                      aspectRatio: '7 / 10',
                      borderRadius: '14px',
                      border: '2px dashed rgba(255,255,255,0.18)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.35)',
                    }}
                  >
                    <Plus size={24} strokeWidth={1.5} />
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px' }}>Add Character</span>
                  </button>
                </div>
              )}
            </div>

            {/* Save Changes — only when there are pending adds/removes/play-as */}
            {hasPendingChanges && (
              <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125 disabled:opacity-50"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#fff',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}
                >
                  {isSaving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} strokeWidth={2} />
                  )}
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── VIEW 2: LIBRARY ── */}
        {view === 'library' && (
          <>
            <div className="px-4 sm:px-6 pt-3 sm:pt-6 pb-3 sm:pb-4 flex-shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => {
                    if (selectedCollectionId !== null) {
                      setSelectedCollectionId(null);
                      setLibrarySearch('');
                      setLibrarySelection(new Set());
                    } else {
                      setLibrarySelection(new Set());
                      setView('main');
                    }
                  }}
                  className="flex items-center gap-1 transition-all hover:brightness-125"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                  Back
                </button>
                <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
                  {selectedCollection
                    ? selectedCollection.name
                    : 'Add Character'}
                </h2>
                {/* Spacer to balance back button */}
                <div style={{ width: '52px' }} />
              </div>
              {selectedCollection && (
                <p className="text-center mb-3" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                  Select characters to add to the story
                </p>
              )}

              {/* Create New Character — only on top-level library */}
              {!selectedCollection && (
                <a
                  href="https://getfreeroam.com/characters/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125 mb-4"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.85)',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    display: 'flex',
                  }}
                >
                  <Plus size={16} strokeWidth={2.5} />
                  Create New Character
                </a>
              )}

              {/* Search */}
              <div className="relative mb-3">
                <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder={
                    selectedCollection
                      ? 'Search collection...'
                      : libraryFilter === 'collections'
                        ? 'Search collections...'
                        : 'Search characters...'
                  }
                  className="w-full outline-none"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '14px',
                    color: 'rgba(255,255,255,0.8)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '10px 12px 10px 36px',
                  }}
                />
              </div>

              {/* Filter chips — hidden while browsing a collection folder */}
              {!selectedCollection && (
                <div className="flex gap-2 flex-wrap">
                  {LIBRARY_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setLibraryFilter(f.id);
                        setSelectedCollectionId(null);
                        setLibrarySearch('');
                        setLibrarySelection(new Set());
                      }}
                      className="px-4 py-1.5 rounded-full transition-all inline-flex items-center gap-1.5"
                      style={{
                        fontFamily: 'Outfit, sans-serif',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: libraryFilter === f.id ? '#fff' : 'rgba(255,255,255,0.45)',
                        background: libraryFilter === f.id ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${libraryFilter === f.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      {f.id === 'favorites' && <Star size={12} strokeWidth={2.5} fill={libraryFilter === f.id ? 'currentColor' : 'none'} />}
                      {f.id === 'collections' && <FolderOpen size={12} strokeWidth={2.5} />}
                      {f.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Multi-select toolbar for character grids (All / Favorites / collection folder) */}
              {(selectedCollection || libraryFilter !== 'collections') && selectableLibraryChars.length > 0 && (
                <div className="flex items-center justify-between gap-2 mt-3">
                  <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                    {selectionCount > 0
                      ? `${selectionCount} selected`
                      : 'Tap to multi-select'}
                  </p>
                  <div className="flex items-center gap-2">
                    {selectionCount > 0 && (
                      <button
                        type="button"
                        onClick={clearLibrarySelection}
                        className="px-3 py-1 rounded-full transition-all hover:brightness-125"
                        style={{
                          fontFamily: 'Outfit, sans-serif',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.55)',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        Clear
                      </button>
                    )}
                    {visibleSelectableCount > 0 && (
                      <button
                        type="button"
                        onClick={() => selectAllVisible(selectableLibraryChars)}
                        className="px-3 py-1 rounded-full transition-all hover:brightness-125"
                        style={{
                          fontFamily: 'Outfit, sans-serif',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.75)',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.14)',
                        }}
                      >
                        Select all
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Library body */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-5 sm:pb-6">
              {/* Collection folder members */}
              {selectedCollection ? (
                isLoadingLibrary ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </div>
                ) : collectionMembers.length === 0 ? (
                  <p className="text-center py-12" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.4)' }}>
                    {searchLower ? 'No matching characters in this collection' : 'This collection is empty'}
                  </p>
                ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                    {collectionMembers.map((char) => renderLibraryCharCard(char))}
                  </div>
                )
              ) : libraryFilter === 'collections' ? (
                /* Collections list — open as folders (no add-all) */
                isLoadingCollections ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </div>
                ) : filteredCollections.length === 0 ? (
                  <p className="text-center py-12" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.4)' }}>
                    {searchLower ? 'No matching collections' : 'No collections yet — create one on the Characters page'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredCollections.map((col) => {
                      const count = col.characterIds.length;
                      const previewIds = col.characterIds.slice(0, 4);
                      const previewChars = previewIds
                        .map((id) => libraryById.get(id))
                        .filter(Boolean) as LibraryCharacter[];
                      return (
                        <CollectionFolderRow
                          key={col.id}
                          name={col.name}
                          count={count}
                          coverImage={col.coverImage}
                          previewChars={previewChars}
                          onOpen={() => handleSelectCollection(col)}
                        />
                      );
                    })}
                  </div>
                )
              ) : /* All / Favorites multi-select grid */
              isLoadingLibrary ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                </div>
              ) : filteredLibrary.length === 0 ? (
                <p className="text-center py-12" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.4)' }}>
                  {searchLower
                    ? 'No matching characters'
                    : libraryFilter === 'favorites'
                      ? 'No favorites yet'
                      : 'No characters found'}
                </p>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  {filteredLibrary.map((char) => renderLibraryCharCard(char))}
                </div>
              )}
            </div>

            {/* Multi-select add footer */}
            {selectionCount > 0 && (
              <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button
                  type="button"
                  onClick={handleAddSelectedToStory}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#fff',
                    background: '#7c3aed',
                    border: '1px solid rgba(167,139,250,0.45)',
                  }}
                >
                  <Plus size={16} strokeWidth={2.5} />
                  Add {selectionCount} to story
                </button>
              </div>
            )}
          </>
        )}

        {/* ── VIEW 3: DETAIL ── */}
        {view === 'detail' && detailChar && (
          <>
            <div className="px-4 sm:px-6 pt-3 sm:pt-6 pb-3 sm:pb-4 flex-shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => setView('library')}
                  className="flex items-center gap-1 transition-all hover:brightness-125"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                  Back
                </button>
                <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
                  {detailChar.name.replace(/-/g, ' ')}
                </h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4">
              <div className="flex gap-5">
                {/* Portrait */}
                <div className="flex-shrink-0">
                  {detailChar.headshot_url ? (
                    <img
                      src={detailChar.headshot_url}
                      alt={detailChar.name}
                      style={{ width: '120px', height: '160px', objectFit: 'cover', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center"
                      style={{ width: '120px', height: '160px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '48px', color: 'rgba(255,255,255,0.2)' }}
                    >
                      {detailChar.name[0]}
                    </div>
                  )}
                </div>

                {/* Fields */}
                <div className="flex-1 flex flex-col gap-4">
                  <div>
                    <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>
                      Name
                    </label>
                    <div
                      className="px-3 py-2 rounded-xl"
                      style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      {detailChar.name.replace(/-/g, ' ')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Personality */}
              <div className="mt-4">
                <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>
                  Personality
                </label>
                <div
                  className="px-3 py-3 rounded-xl"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '13px',
                    color: 'rgba(255,255,255,0.75)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    lineHeight: 1.6,
                    maxHeight: '180px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {detailChar.backstory || 'No personality description available.'}
                </div>
              </div>
            </div>

            {/* Add to Story button */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => handleAddFromLibrary(detailChar)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#fff',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
              >
                <Plus size={16} strokeWidth={2.5} />
                Add to Story
              </button>
            </div>
          </>
        )}

        {/* ── VIEW 4: STORY CHARACTER DETAIL (editable) ── */}
        {view === 'story-detail' && storyDetailChar && (
          <StoryDetailEditView
            char={storyDetailChar}
            onBack={() => setView('main')}
            onEditCharacter={onEditCharacter}
          />
        )}
      </div>
    </div>
  );
}

// ── Separate component to manage edit state cleanly ──
function StoryDetailEditView({
  char,
  onBack,
  onEditCharacter,
}: {
  char: {
    external_id: string;
    name: string;
    backstory: string;
    appearance: string;
    headshot_url: string;
    display_headshot_url: string | null;
    is_main_character: boolean;
    creator_name: string;
  };
  onBack: () => void;
  onEditCharacter: (
    charId: string,
    oldName: string,
    newName: string,
    oldBackstory: string,
    newBackstory: string,
    oldAppearance: string,
    newAppearance: string,
    photoChanged?: boolean,
    newHeadshotUrl?: string
  ) => Promise<void>;
}) {
  const displayName = char.name.replace(/-/g, ' ');
  const [editName, setEditName] = useState(displayName);
  const [editBackstory, setEditBackstory] = useState(char.backstory ?? '');
  const [editAppearance, setEditAppearance] = useState(char.appearance ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [newHeadshotUrl, setNewHeadshotUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameChanged = editName.trim() !== displayName.trim();
  const backstoryChanged = editBackstory.trim() !== (char.backstory ?? '').trim();
  const appearanceChanged = editAppearance.trim() !== (char.appearance ?? '').trim();
  const photoChanged = !!newHeadshotUrl;
  const hasChanges = nameChanged || backstoryChanged || appearanceChanged || photoChanged;

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    try {
      // Convert file to base64 for the tRPC uploadHeadshot procedure
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the data URL prefix (e.g. 'data:image/png;base64,')
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/trpc/characters.uploadHeadshot?batch=1', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...getFreeroamAuthHeaders(),
        },
        body: JSON.stringify({
          '0': { json: { fileBase64: base64, mimeType: file.type, fileName: file.name } },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const url = json?.[0]?.result?.data?.json?.headshot_url;
        setNewHeadshotUrl(url || URL.createObjectURL(file));
      } else {
        setNewHeadshotUrl(URL.createObjectURL(file));
      }
    } catch {
      if (file) setNewHeadshotUrl(URL.createObjectURL(file));
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="px-4 sm:px-6 pt-3 sm:pt-6 pb-3 sm:pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 transition-all hover:brightness-125"
            style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>
          <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
            {editName.trim() || displayName}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4">
        <div className="flex gap-5">
          {/* Portrait — tappable to change photo */}
          <div className="flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPhoto}
              className="relative block transition-all hover:brightness-110"
              style={{ width: '120px', height: '160px', borderRadius: '12px', overflow: 'hidden', border: `1px solid ${photoChanged ? 'rgba(34,197,94,0.6)' : char.is_main_character ? 'rgba(234,179,8,0.5)' : 'rgba(255,255,255,0.1)'}` }}
            >
              {(newHeadshotUrl || char.display_headshot_url || char.headshot_url) ? (
                <img
                  src={newHeadshotUrl || char.display_headshot_url || char.headshot_url}
                  alt={editName.trim() || char.name}
                  className="w-full h-full"
                  style={{ objectFit: 'cover', objectPosition: 'center top' }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '48px', color: 'rgba(255,255,255,0.2)' }}>
                  {(editName.trim() || char.name)[0]}
                </div>
              )}
              {/* Change Photo overlay */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                style={{ background: isUploadingPhoto ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)', backdropFilter: 'blur(1px)' }}
              >
                {isUploadingPhoto ? (
                  <Loader2 size={20} className="animate-spin" style={{ color: '#fff' }} />
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '10px', fontWeight: 600, color: '#fff' }}>Change Photo</span>
                  </>
                )}
              </div>
            </button>
            {char.is_main_character && (
              <div className="mt-2 text-center" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '11px', fontWeight: 700, color: 'rgba(234,179,8,0.9)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Main Character
              </div>
            )}
          </div>

          {/* Name + Creator */}
          <div className="flex-1 flex flex-col gap-4">
            <div>
              <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Character name"
                className="w-full outline-none px-3 py-2 rounded-xl"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '14px',
                  color: '#fff',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${nameChanged ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                }}
              />
            </div>
            <div>
              <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Creator</label>
              <div className="px-3 py-2 rounded-xl" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {char.creator_name || 'Unknown'}
              </div>
            </div>
          </div>
        </div>

        {/* Personality — editable textarea */}
        <div className="mt-4">
          <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Personality</label>
          <textarea
            value={editBackstory}
            onChange={(e) => setEditBackstory(e.target.value)}
            rows={6}
            className="w-full outline-none resize-none"
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '13px',
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${backstoryChanged ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '12px',
              padding: '12px',
              lineHeight: 1.6,
            }}
          />
        </div>

        {/* Appearance — editable textarea */}
        <div className="mt-4">
          <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Appearance</label>
          <textarea
            value={editAppearance}
            onChange={(e) => setEditAppearance(e.target.value)}
            rows={6}
            className="w-full outline-none resize-none"
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '13px',
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${appearanceChanged ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '12px',
              padding: '12px',
              lineHeight: 1.6,
            }}
          />
        </div>
      </div>

      {/* Save Changes button */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={async () => {
            const trimmedName = editName.trim();
            if (!hasChanges || isSaving || !trimmedName) return;
            setIsSaving(true);
            try {
              await onEditCharacter(
                char.external_id,
                displayName,
                trimmedName,
                char.backstory ?? '',
                editBackstory,
                char.appearance ?? '',
                editAppearance,
                photoChanged,
                newHeadshotUrl ?? undefined
              );
            } catch (err) {
              // Error handled upstream
            } finally {
              setIsSaving(false);
            }
          }}
          disabled={!hasChanges || isSaving || !editName.trim()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125 disabled:opacity-40"
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: '15px',
            fontWeight: 600,
            color: hasChanges ? '#fff' : 'rgba(255,255,255,0.5)',
            background: hasChanges ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${hasChanges ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} strokeWidth={2} />}
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </>
  );
}
