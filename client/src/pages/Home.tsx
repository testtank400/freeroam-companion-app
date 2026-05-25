// Home.tsx
// Design: Tactical Dark Ops — dark background, character card grid
// Data: cursor-based infinite scroll from getfreeroam API via tRPC proxy
// Automatically loads more when the sentinel div at the bottom enters the viewport

import BulkActionBar from '@/components/BulkActionBar';
import CharacterCard from '@/components/CharacterCard';
import CharacterProfile from '@/components/CharacterProfile';
import CollectionCard from '@/components/CollectionCard';
import CreateCharacterModal from '@/components/CreateCharacterModal';
import DeleteCollectionDialog from '@/components/DeleteCollectionDialog';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import EditCollectionModal from '@/components/EditCollectionModal';
import SettingsModal from '@/components/SettingsModal';
import { Collection, useCollections } from '@/hooks/useCollections';
import { useSavedCharacters } from '@/hooks/useSavedCharacters';
import { trpc } from '@/lib/trpc';
import { ArrowDownUp, ArrowLeft, ChevronDown, FolderPlus, Plus, RefreshCw, Search, Settings, UserPlus, X as XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFreeroamCookie } from '@/hooks/useFreeroamCookie';
import { toast } from 'sonner';

export type PrivacyStatus = 'private' | 'public' | 'unlisted';

export interface ApiCharacter {
  external_id: string;
  name: string;
  backstory: string | null;
  description: string | null;  // appearance data
  headshot_url: string | null;
  display_headshot_url: string | null;
  is_persona: boolean;
  owner: { username: string; display_name: string };
  privacy_status: PrivacyStatus;
  // Library endpoint extras
  is_saved?: boolean;
  tags?: Array<{ name: string; is_fandom: boolean; emoji: string }>;
  creator_username?: string;
  created_at?: string;
  is_yours?: boolean;
}

const USERNAME = 'Test Tank';
const LIMIT = 50;

type SortOption = { value: string; label: string; description: string };
const SORT_OPTIONS: SortOption[] = [
  { value: 'recent',  label: 'Most Recent', description: 'Newest first' },
  { value: 'oldest',  label: 'Oldest First', description: 'Oldest first' },
];

export default function Home() {
  const [selectedCharacter, setSelectedCharacter] = useState<ApiCharacter | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editCharacter, setEditCharacter] = useState<ApiCharacter | null>(null);
  const [deleteCharacter, setDeleteCharacter] = useState<ApiCharacter | null>(null);
  const deleteMutation = trpc.characters.delete.useMutation();
  const [allCharacters, setAllCharacters] = useState<ApiCharacter[]>([]);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [sort, setSort] = useState<string>('recent');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  // null = show all; otherwise only show matching privacy status
  const [privacyFilter, setPrivacyFilter] = useState<PrivacyStatus | null>(null);
  // null = show all; true = personas only; false = characters only
  const [personaFilter, setPersonaFilter] = useState<boolean | null>(null);
  // true = show only saved/favorited characters
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // true = hide NSFW-tagged characters
  const [sfwOnly, setSfwOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // Close sort dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch ALL characters in one request via the library endpoint
  const fetchAll = useCallback(async (_sortValue: string) => {
    setIsLoadingAll(true);
    setAllCharacters([]);
    try {
      const result = await utils.characters.library.fetch();
      // Map library shape to ApiCharacter
      const mapped: ApiCharacter[] = result.map(c => ({
        external_id: c.external_id,
        name: c.name,
        backstory: c.backstory,
        description: c.description,
        headshot_url: c.headshot_url,
        display_headshot_url: c.display_headshot_url,
        is_persona: false,
        owner: { username: c.creator_username, display_name: c.creator_username },
        privacy_status: c.privacy_status,
        is_saved: c.is_saved,
        tags: c.tags,
        creator_username: c.creator_username,
        created_at: c.created_at,
        is_yours: c.is_yours,
      }));
      setAllCharacters(mapped);
      // Seed saved state from the API response
      const savedFromApi = mapped
        .filter(c => c.is_saved)
        .map(c => c.external_id);
      initFromApi(savedFromApi);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('401') || msg.includes('SESSION_EXPIRED') || msg.includes('Unauthorized')) {
        toast.error('Your Freeroam session has expired. Please update your cookie in Settings.', { duration: 8000 });
      } else {
        toast.error('Failed to load characters. Please refresh.');
      }
    } finally {
      setIsLoadingAll(false);
    }
  }, [utils]);

  // Load all on mount and when sort changes
  useEffect(() => {
    fetchAll(sort);
  }, [sort]);

  const isLoading = isLoadingAll && allCharacters.length === 0;
  const isError = false;
  const isFetching = isLoadingAll;

  // Full refresh
  const handleRefresh = () => fetchAll(sort);

  // Change sort
  const handleSortChange = (newSort: string) => {
    if (newSort === sort) { setSortDropdownOpen(false); return; }
    setSort(newSort);
    setSortDropdownOpen(false);
    // useEffect above will trigger fetchAll(newSort)
  };

  const { hasCookie } = useFreeroamCookie();
  const [showSettings, setShowSettings] = useState(false);

  const { isSaved, toggleSave, initFromApi } = useSavedCharacters();
  const { collections, createCollection, renameCollection, updateCollection, deleteCollection, toggleInCollection, isInCollection } = useCollections();
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [deletingCollection, setDeletingCollection] = useState<Collection | null>(null);
  const [showNewCollectionModal, setShowNewCollectionModal] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // Close + Add dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeCollection = activeCollectionId != null ? collections.find(c => c.id === activeCollectionId) ?? null : null;

  // Fetch NSFW flags for all loaded characters (POST mutation to avoid 414 URL-too-large)
  const [nsfwMap, setNsfwMap] = useState<Record<string, boolean>>({});
  const nsfwBatchMutation = trpc.nsfw.getBatch.useMutation({
    onSuccess: (data) => setNsfwMap(data),
  });
  // Refresh NSFW map whenever the character list changes
  useEffect(() => {
    if (allCharacters.length > 0) {
      nsfwBatchMutation.mutate({ characterIds: allCharacters.map(c => c.external_id) });
    }
  }, [allCharacters]);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIndexRef = useRef<number>(-1);

  // Clear selection on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) setSelectedIds(new Set());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds]);

  // Click outside cards to deselect (only when selection is active)
  const gridRef = useRef<HTMLDivElement>(null);
  const bulkBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks inside the card grid or the bulk action bar
      const inGrid = gridRef.current?.contains(target);
      const inBulkBar = bulkBarRef.current?.contains(target);
      if (!inGrid && !inBulkBar) {
        setSelectedIds(new Set());
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedIds]);

  const handleAddCharacter = () => setShowCreateModal(true);

  const handleConfirmDelete = async (character: ApiCharacter) => {
    try {
      await deleteMutation.mutateAsync({ characterId: character.external_id });
      // Remove from local list immediately, then do a full refresh to sync
      setAllCharacters(prev => prev.filter(c => c.external_id !== character.external_id));
      toast.success(`${character.name} deleted`);
      fetchAll(sort);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete character');
    } finally {
      setDeleteCharacter(null);
    }
  };

  const handleCharacterSaved = async (character: ApiCharacter, mode: 'create' | 'edit') => {
    if (mode === 'create') {
      // New character: full refresh to get server-assigned IDs and library metadata
      fetchAll(sort);
      return;
    }
    // Edit or duplicate: fetch only the updated character and patch/prepend in-place
    try {
      // Invalidate the cached single-character query so the profile modal shows fresh data
      await utils.characters.get.invalidate({ characterId: character.external_id });
      await utils.characters.getExtended.invalidate({ characterId: character.external_id });
      const updated = await utils.characters.get.fetch({ characterId: character.external_id });
      const patched: ApiCharacter = {
        external_id: updated.external_id,
        name: updated.name,
        backstory: updated.backstory ?? null,
        description: updated.description ?? null,
        headshot_url: updated.headshot_url ?? null,
        display_headshot_url: updated.display_headshot_url ?? null,
        is_persona: false,
        owner: { username: updated.owner?.username ?? character.owner.username, display_name: updated.owner?.display_name ?? character.owner.display_name },
        privacy_status: updated.privacy_status,
        // Preserve library-only fields from the existing entry
        is_saved: character.is_saved,
        tags: character.tags,
        creator_username: character.creator_username,
        created_at: character.created_at,
        is_yours: character.is_yours,
      };
      setAllCharacters(prev => {
        const exists = prev.some(c => c.external_id === patched.external_id);
        if (exists) {
          // Edit: patch in-place
          return prev.map(c => c.external_id === patched.external_id ? patched : c);
        } else {
          // Duplicate: prepend to top
          return [patched, ...prev];
        }
      });
    } catch {
      // Fallback to full refresh if single-character fetch fails
      fetchAll(sort);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: 'oklch(0.098 0.008 264)' }}
    >
      {/* Top header bar */}
      <header
        className="sticky top-0 z-40 px-3 sm:px-6 py-2 sm:py-3"
        style={{
          background: 'oklch(0.098 0.008 264 / 0.95)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid oklch(1 0 0 / 0.07)',
        }}
      >
        {/* On mobile: two rows (title + controls). On sm+: single row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Back button when in collection view */}
          {activeCollection ? (
            <button
              onClick={() => { setActiveCollectionId(null); setSelectedIds(new Set()); }}
              className="w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:bg-white/10"
              style={{
                background: 'oklch(0.769 0.188 70.08 / 0.12)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
                color: 'oklch(0.769 0.188 70.08)',
              }}
              title="Back to roster"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
          ) : (
            <div
              className="w-8 h-8 flex items-center justify-center rounded-sm"
              style={{
                background: 'oklch(0.769 0.188 70.08 / 0.12)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="oklch(0.769 0.188 70.08)" strokeWidth="1.5" fill="none"/>
                <circle cx="8" cy="8" r="2" fill="oklch(0.769 0.188 70.08)"/>
              </svg>
            </div>
          )}
          <div>
            {activeCollection ? (
              <>
                <p
                  className="text-[10px] uppercase tracking-widest leading-none"
                  style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.45 0.01 264)', fontWeight: 600 }}
                >
                  Character Roster
                </p>
                <h1
                  className="text-base font-bold tracking-widest uppercase leading-none mt-0.5"
                  style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}
                >
                  {activeCollection.name}
                </h1>
                {activeCollection.description && (
                  <p
                    className="text-[10px] mt-0.5 truncate max-w-xs"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
                  >
                    {activeCollection.description}
                  </p>
                )}
              </>
            ) : (
              <h1
                className="text-base font-bold tracking-widest uppercase leading-none"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)' }}
              >
                Character Roster
              </h1>
            )}
            <p
              className="text-[10px] mt-0.5"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
            >
              {isLoading
                ? 'Loading...'
                : (() => {
                    const q = searchQuery.trim().toLowerCase();
                    const visible = allCharacters.filter(c => {
                      const matchesPrivacy = !privacyFilter || c.privacy_status === privacyFilter;
                      const matchesSearch = !q || c.name.toLowerCase().includes(q);
                      return matchesPrivacy && matchesSearch;
                    }).length;
                    const total = allCharacters.length;
                    const isFiltered = privacyFilter || q;
                    const loadingSuffix = isFetching ? '...' : '';
                    return isFiltered
                      ? `${visible} of ${total}${loadingSuffix} unit${total !== 1 ? 's' : ''}`
                      : `${total}${loadingSuffix} unit${total !== 1 ? 's' : ''} on record`;
                  })()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 sm:ml-auto">
          {/* Search bar */}
          <div className="relative flex items-center flex-1 sm:flex-none">
            <Search
              size={13}
              strokeWidth={2}
              className="absolute left-2.5 pointer-events-none"
              style={{ color: 'oklch(0.45 0.01 264)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isFetching && !searchQuery ? 'Loading more...' : 'Search...'}
              className="pl-8 pr-7 py-1.5 rounded-sm text-xs flex-1 sm:flex-none sm:w-48 transition-all min-w-0"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.15 0.01 264)',
                border: `1px solid ${searchQuery ? 'oklch(0.769 0.188 70.08 / 0.4)' : 'oklch(1 0 0 / 0.1)'}`,
                color: 'oklch(0.88 0.005 65)',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
              onBlur={(e) => (e.target.style.borderColor = searchQuery ? 'oklch(0.769 0.188 70.08 / 0.4)' : 'oklch(1 0 0 / 0.1)')}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 flex items-center justify-center transition-colors hover:opacity-80"
                style={{ color: 'oklch(0.45 0.01 264)' }}
                title="Clear search"
              >
                <XIcon size={11} strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Sort dropdown */}
          <div ref={sortDropdownRef} className="relative">
            <button
              onClick={() => setSortDropdownOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all hover:brightness-110"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.18 0.01 264)',
                border: `1px solid ${sortDropdownOpen ? 'oklch(0.769 0.188 70.08 / 0.4)' : 'oklch(1 0 0 / 0.1)'}`,
                color: sortDropdownOpen ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.65 0.01 264)',
              }}
              title="Sort order"
            >
              <ArrowDownUp size={12} strokeWidth={2.5} />
              <span className="hidden sm:inline">{SORT_OPTIONS.find(o => o.value === sort)?.label ?? 'Sort'}</span>
              <ChevronDown
                size={11}
                strokeWidth={2.5}
                style={{
                  transform: sortDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>

            {/* Dropdown panel */}
            {sortDropdownOpen && (
              <div
                className="absolute right-0 mt-1 w-44 rounded-sm overflow-hidden"
                style={{
                  background: 'oklch(0.15 0.01 264)',
                  border: '1px solid oklch(1 0 0 / 0.12)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 50,
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleSortChange(opt.value)}
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                    style={{
                      borderBottom: '1px solid oklch(1 0 0 / 0.06)',
                      background: sort === opt.value ? 'oklch(0.769 0.188 70.08 / 0.08)' : 'transparent',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-semibold tracking-wider uppercase"
                        style={{
                          fontFamily: 'Rajdhani, sans-serif',
                          color: sort === opt.value ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.82 0.005 65)',
                        }}
                      >
                        {opt.label}
                      </p>
                      <p
                        className="text-[10px] mt-0.5"
                        style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
                      >
                        {opt.description}
                      </p>
                    </div>
                    {sort === opt.value && (
                      <div
                        className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0"
                        style={{ background: 'oklch(0.769 0.188 70.08)', marginTop: '4px' }}
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Settings gear button */}
          <button
            onClick={() => setShowSettings(true)}
            className="w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:brightness-110"
            style={{
              background: hasCookie ? 'oklch(0.55 0.15 145 / 0.12)' : 'oklch(0.18 0.01 264)',
              border: hasCookie ? '1px solid oklch(0.55 0.15 145 / 0.35)' : '1px solid oklch(1 0 0 / 0.1)',
              color: hasCookie ? 'oklch(0.65 0.15 145)' : 'oklch(0.55 0.01 264)',
            }}
            title={hasCookie ? 'Settings (cookie set)' : 'Settings (no cookie set)'}
          >
            <Settings size={13} strokeWidth={2} />
          </button>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:brightness-110 disabled:opacity-50"
            style={{
              background: 'oklch(0.18 0.01 264)',
              border: '1px solid oklch(1 0 0 / 0.1)',
              color: 'oklch(0.55 0.01 264)',
            }}
            title="Refresh characters"
          >
            <RefreshCw size={13} strokeWidth={2} className={isFetching ? 'animate-spin' : ''} />
          </button>

          {/* + Add dropdown */}
          <div ref={addRef} className="relative">
                <button
                  onClick={() => setAddOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all hover:brightness-110"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: 'oklch(0.769 0.188 70.08 / 0.12)',
                    border: `1px solid ${addOpen ? 'oklch(0.769 0.188 70.08 / 0.6)' : 'oklch(0.769 0.188 70.08 / 0.35)'}`,
                    color: 'oklch(0.769 0.188 70.08)',
                  }}
                >
                  <Plus size={14} strokeWidth={2.5} />
                  Add
                  <ChevronDown size={11} strokeWidth={2.5} style={{ transform: addOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }} />
                </button>

                {addOpen && (
                  <div
                    className="absolute right-0 mt-1 rounded-sm overflow-hidden"
                    style={{
                      background: 'oklch(0.15 0.01 264)',
                      border: '1px solid oklch(1 0 0 / 0.12)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      zIndex: 50,
                      minWidth: 160,
                    }}
                  >
                    <button
                      onClick={() => { setAddOpen(false); handleAddCharacter(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      style={{ borderBottom: '1px solid oklch(1 0 0 / 0.06)' }}
                    >
                      <UserPlus size={13} strokeWidth={2} style={{ color: 'oklch(0.769 0.188 70.08)' }} />
                      <div>
                        <p className="text-[11px] font-semibold tracking-wide uppercase" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.88 0.005 65)' }}>Character</p>
                        <p className="text-[9px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>Add a new character</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setAddOpen(false); setShowNewCollectionModal(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                    >
                      <FolderPlus size={13} strokeWidth={2} style={{ color: 'oklch(0.769 0.188 70.08)' }} />
                      <div>
                        <p className="text-[11px] font-semibold tracking-wide uppercase" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.88 0.005 65)' }}>Collection</p>
                        <p className="text-[9px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>Group characters together</p>
                      </div>
                    </button>
                  </div>
                )}
          </div>
        </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container py-4 sm:py-8">

        {/* Collections section — only shown when NOT in collection view */}
        {!activeCollectionId && (
          <div className="mb-8">
            <div className="mb-3">
              <span
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.4 0.01 264)', fontWeight: 600 }}
              >
                Collections
              </span>
            </div>

            {collections.length === 0 ? (
              <button
                onClick={() => setShowNewCollectionModal(true)}
                className="flex items-center gap-2 px-4 py-3 rounded-sm w-full transition-all hover:brightness-110"
                style={{
                  background: 'oklch(0.13 0.01 264)',
                  border: '1px dashed oklch(1 0 0 / 0.12)',
                  color: 'oklch(0.4 0.01 264)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px',
                }}
              >
                <span style={{ fontSize: 18 }}>📁</span>
                No collections yet — click to create one
              </button>
            ) : (
              <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {collections.map(col => (
                  <CollectionCard
                    key={col.id}
                    collection={col}
                    characters={allCharacters.filter(c => col.characterIds.includes(c.external_id))}
                    onClick={(c) => setActiveCollectionId(c.id as number)}
                    onEdit={(c) => setEditingCollection(c)}
                    onDelete={(c) => setDeletingCollection(c)}
                  />
                ))}
              </div>
            )}
          </div>
        )}



        {/* Section label + filter chips */}
        <div className="mb-6">
          {/* On mobile: 3-col grid so row 1 = All/Private/Public, row 2 = Unlisted/Favorites.
              On sm+: single flex row with all chips side by side. */}
          <div className="grid grid-cols-3 sm:flex sm:flex-row gap-2">

            {/* All */}
            {(() => {
              const bg = privacyFilter === null ? 'oklch(0.769 0.188 70.08 / 0.15)' : 'oklch(0.15 0.01 264)';
              const border = privacyFilter === null ? '1px solid oklch(0.769 0.188 70.08 / 0.45)' : '1px solid oklch(1 0 0 / 0.08)';
              const color = privacyFilter === null ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.45 0.01 264)';
              return (
                <button
                  onClick={() => setPrivacyFilter(null)}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{ fontFamily: 'Rajdhani, sans-serif', background: bg, border, color }}
                >
                  All
                  {!isLoading && allCharacters.length > 0 && (
                    <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                      {allCharacters.length}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Private */}
            {(() => {
              const count = allCharacters.filter(c => c.privacy_status === 'private').length;
              const bg = privacyFilter === 'private' ? 'oklch(0.22 0.01 264)' : 'oklch(0.15 0.01 264)';
              const border = privacyFilter === 'private' ? '1px solid oklch(1 0 0 / 0.25)' : '1px solid oklch(1 0 0 / 0.08)';
              const color = privacyFilter === 'private' ? 'oklch(0.88 0.005 65)' : 'oklch(0.45 0.01 264)';
              return (
                <button
                  onClick={() => setPrivacyFilter(privacyFilter === 'private' ? null : 'private')}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{ fontFamily: 'Rajdhani, sans-serif', background: bg, border, color }}
                >
                  🔒 Private
                  {!isLoading && count > 0 && (
                    <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Public */}
            {(() => {
              const count = allCharacters.filter(c => c.privacy_status === 'public').length;
              const bg = privacyFilter === 'public' ? 'oklch(0.22 0.08 145 / 0.4)' : 'oklch(0.15 0.01 264)';
              const border = privacyFilter === 'public' ? '1px solid oklch(0.55 0.15 145 / 0.6)' : '1px solid oklch(1 0 0 / 0.08)';
              const color = privacyFilter === 'public' ? 'oklch(0.75 0.15 145)' : 'oklch(0.45 0.01 264)';
              return (
                <button
                  onClick={() => setPrivacyFilter(privacyFilter === 'public' ? null : 'public')}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{ fontFamily: 'Rajdhani, sans-serif', background: bg, border, color }}
                >
                  🌐 Public
                  {!isLoading && count > 0 && (
                    <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Unlisted */}
            {(() => {
              const count = allCharacters.filter(c => c.privacy_status === 'unlisted').length;
              const bg = privacyFilter === 'unlisted' ? 'oklch(0.22 0.08 220 / 0.4)' : 'oklch(0.15 0.01 264)';
              const border = privacyFilter === 'unlisted' ? '1px solid oklch(0.55 0.15 220 / 0.6)' : '1px solid oklch(1 0 0 / 0.08)';
              const color = privacyFilter === 'unlisted' ? 'oklch(0.75 0.15 220)' : 'oklch(0.45 0.01 264)';
              return (
                <button
                  onClick={() => setPrivacyFilter(privacyFilter === 'unlisted' ? null : 'unlisted')}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{ fontFamily: 'Rajdhani, sans-serif', background: bg, border, color }}
                >
                  🔗 Unlisted
                  {!isLoading && count > 0 && (
                    <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Favorites */}
            {(() => {
              const favCount = allCharacters.filter(c => isSaved(c.external_id)).length;
              const isActive = favoritesOnly;
              return (
                <button
                  onClick={() => setFavoritesOnly(v => !v)}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: isActive ? 'oklch(0.65 0.22 25 / 0.2)' : 'oklch(0.15 0.01 264)',
                    border: isActive ? '1px solid oklch(0.65 0.22 25 / 0.5)' : '1px solid oklch(1 0 0 / 0.08)',
                    color: isActive ? 'oklch(0.75 0.18 25)' : 'oklch(0.45 0.01 264)',
                  }}
                >
                  ❤️ Favorites
                  {!isLoading && (
                    <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                      {favCount}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* SFW chip — hides NSFW-tagged characters */}
            {(() => {
              const nsfwCount = allCharacters.filter(c => nsfwMap[c.external_id]).length;
              const isActive = sfwOnly;
              if (nsfwCount === 0 && !isActive) return null;
              return (
                <button
                  onClick={() => setSfwOnly(v => !v)}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: isActive ? 'oklch(0.25 0.1 145 / 0.4)' : 'oklch(0.15 0.01 264)',
                    border: isActive ? '1px solid oklch(0.6 0.15 145 / 0.6)' : '1px solid oklch(1 0 0 / 0.08)',
                    color: isActive ? 'oklch(0.78 0.15 145)' : 'oklch(0.45 0.01 264)',
                  }}
                  title={isActive ? 'Show all characters (including NSFW)' : 'Hide NSFW characters'}
                >
                  🛡️ SFW Only
                  {!isLoading && (
                    <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                      {nsfwCount}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Persona chip — only shown when at least one persona exists */}
            {!isLoading && allCharacters.some(c => c.is_persona) && (() => {
              const personaCount = allCharacters.filter(c => c.is_persona).length;
              const isActive = personaFilter === true;
              return (
                <button
                  onClick={() => setPersonaFilter(isActive ? null : true)}
                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: isActive ? 'oklch(0.25 0.1 300 / 0.4)' : 'oklch(0.15 0.01 264)',
                    border: isActive ? '1px solid oklch(0.6 0.15 300 / 0.6)' : '1px solid oklch(1 0 0 / 0.08)',
                    color: isActive ? 'oklch(0.78 0.15 300)' : 'oklch(0.45 0.01 264)',
                  }}
                >
                  👤 Personas
                  <span className="inline-flex items-center justify-center rounded-sm px-1 min-w-[18px] h-[16px] text-[9px] font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.12)', color: 'inherit' }}>
                    {personaCount}
                  </span>
                </button>
              );
            })()}

          </div>
        </div>

        {/* Initial loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="rounded-sm overflow-hidden animate-pulse"
                style={{ background: 'oklch(0.13 0.01 264)', border: '1px solid oklch(1 0 0 / 0.07)' }}
              >
                <div style={{ paddingBottom: '115%', background: 'oklch(0.16 0.01 264)' }} />
                <div className="p-3 space-y-2">
                  <div className="h-4 rounded" style={{ background: 'oklch(0.18 0.01 264)', width: '70%' }} />
                  <div className="h-3 rounded" style={{ background: 'oklch(0.16 0.01 264)', width: '45%' }} />
                  <div className="h-2 rounded mt-2" style={{ background: 'oklch(0.15 0.01 264)' }} />
                  <div className="h-2 rounded" style={{ background: 'oklch(0.15 0.01 264)', width: '80%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '18px', fontWeight: 700, color: 'oklch(0.65 0.22 25)' }}>
              FAILED TO LOAD CHARACTERS
            </p>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.45 0.01 264)' }}>
              Unable to reach the API. Check your session cookie.
            </p>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.65 0.22 25 / 0.15)',
                border: '1px solid oklch(0.65 0.22 25 / 0.4)',
                color: 'oklch(0.65 0.22 25)',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && allCharacters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            {!hasCookie ? (
              <>
                <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '18px', fontWeight: 700, color: 'oklch(0.4 0.01 264)' }}>
                  NO CHARACTERS ON RECORD
                </p>
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.35 0.01 264)', textAlign: 'center', maxWidth: 360 }}>
                  Add your Freeroam session cookie to load your characters.
                </p>
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all hover:brightness-110"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: 'oklch(0.769 0.188 70.08 / 0.12)',
                    border: '1px solid oklch(0.769 0.188 70.08 / 0.4)',
                    color: 'oklch(0.769 0.188 70.08)',
                  }}
                >
                  <Settings size={13} strokeWidth={2} />
                  Open Settings
                </button>
              </>
            ) : (
              <>
                <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '18px', fontWeight: 700, color: 'oklch(0.4 0.01 264)' }}>
                  NO CHARACTERS ON RECORD
                </p>
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.35 0.01 264)' }}>
                  Your roster is empty.
                </p>
              </>
            )}
          </div>
        )}

        {/* Derive filtered list — applies search, privacy, persona, favorites, and collection filters */}
        {(() => {
          const q = searchQuery.trim().toLowerCase();
          const activeCol = activeCollectionId != null ? collections.find(c => c.id === activeCollectionId) : null;
          // IDs of characters that belong to ANY collection
          const allCollectionIds = new Set(collections.flatMap(col => col.characterIds));
          const visibleCharacters = allCharacters.filter(c => {
            const matchesPrivacy = !privacyFilter || c.privacy_status === privacyFilter;
            // When inside a collection, search only within that collection's members
            const matchesSearch = !q || (activeCol
              ? (activeCol.characterIds.includes(c.external_id) && c.name.toLowerCase().includes(q))
              : c.name.toLowerCase().includes(q));
            const matchesPersona = personaFilter === null || c.is_persona === personaFilter;
            const matchesFavorites = !favoritesOnly || isSaved(c.external_id);
            const matchesCollection = !activeCol || activeCol.characterIds.includes(c.external_id);
            // When searching outside a collection, include collection members in results.
            // When not searching, hide characters that belong to any collection (they live in collection view).
            const notInOtherCollection = activeCol
              ? activeCol.characterIds.includes(c.external_id)
              : (q ? true : !allCollectionIds.has(c.external_id));
            const matchesNsfw = !sfwOnly || !nsfwMap[c.external_id];
            return matchesPrivacy && matchesSearch && matchesPersona && matchesFavorites && matchesCollection && notInOtherCollection && matchesNsfw;
          });

          const filteredEmpty = !isLoading && !isError && allCharacters.length > 0 && visibleCharacters.length === 0;

          return (
            <>
              {/* No results for current filters */}
              {filteredEmpty && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '16px', fontWeight: 700, color: 'oklch(0.4 0.01 264)' }}>
                    NO RESULTS
                  </p>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.35 0.01 264)' }}>
                    {searchQuery
                      ? `No characters match "${searchQuery}"${privacyFilter ? ` with ${privacyFilter} visibility` : ''}${personaFilter ? ' (personas only)' : ''}${favoritesOnly ? ' in favorites' : ''}${activeCollectionId ? ' in this collection' : ''}.`
                      : activeCollectionId
                        ? 'This collection is empty. Add characters from their profile.'
                        : favoritesOnly
                          ? "You haven't saved any characters yet."
                          : personaFilter
                            ? 'No personas found in your roster.'
                            : `None of your characters have ${privacyFilter} visibility.`}

                  </p>
                  <button
                    onClick={() => { setPrivacyFilter(null); setPersonaFilter(null); setFavoritesOnly(false); setSfwOnly(false); setActiveCollectionId(null); setSearchQuery(''); }}
                    className="mt-1 px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                    style={{
                      fontFamily: 'Rajdhani, sans-serif',
                      background: 'oklch(0.769 0.188 70.08 / 0.1)',
                      border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
                      color: 'oklch(0.769 0.188 70.08)',
                    }}
                  >
                    Clear Filters
                  </button>
                </div>
              )}
            </>
          );
        })()}

        {/* Card grid */}
        {allCharacters.length > 0 && (
          <div
            ref={gridRef}
            className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4"
            style={selectedIds.size > 0 ? { userSelect: 'none' } : undefined}
          >
            {allCharacters.filter(c => {
          const q = searchQuery.trim().toLowerCase();
          const activeCol = activeCollectionId != null ? collections.find(col => col.id === activeCollectionId) : null;
          const allCollectionIds = new Set(collections.flatMap(col => col.characterIds));
          const matchesPrivacy = !privacyFilter || c.privacy_status === privacyFilter;
          // When inside a collection, search only within that collection's members
          const matchesSearch = !q || (activeCol
            ? (activeCol.characterIds.includes(c.external_id) && c.name.toLowerCase().includes(q))
            : c.name.toLowerCase().includes(q));
          const matchesPersona = personaFilter === null || c.is_persona === personaFilter;
          const matchesFavorites = !favoritesOnly || isSaved(c.external_id);
          const matchesCollection = !activeCol || activeCol.characterIds.includes(c.external_id);
          // When searching outside a collection, include collection members in results.
          const notInOtherCollection = activeCol
            ? activeCol.characterIds.includes(c.external_id)
            : (q ? true : !allCollectionIds.has(c.external_id));
          const matchesNsfw = !sfwOnly || !nsfwMap[c.external_id];
          return matchesPrivacy && matchesSearch && matchesPersona && matchesFavorites && matchesCollection && notInOtherCollection && matchesNsfw;
        }).map((character) => (
              <CharacterCard
                key={character.external_id}
                character={character}
                onClick={(char, e) => {
                  // Ctrl/Cmd click: toggle selection
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(char.external_id)) next.delete(char.external_id);
                      else next.add(char.external_id);
                      return next;
                    });
                    // Track index for shift-range
                    const visibleList = allCharacters.filter(c => {
                      const q = searchQuery.trim().toLowerCase();
                      const activeCol = activeCollectionId != null ? collections.find(col => col.id === activeCollectionId) : null;
                      const allColIds = new Set(collections.flatMap(col => col.characterIds));
                      const notInOther = activeCol ? activeCol.characterIds.includes(c.external_id) : !allColIds.has(c.external_id);
                      const matchesSearch = !q || (activeCol
                        ? (activeCol.characterIds.includes(c.external_id) && c.name.toLowerCase().includes(q))
                        : c.name.toLowerCase().includes(q));
                      return (!privacyFilter || c.privacy_status === privacyFilter)
                        && matchesSearch
                        && (personaFilter === null || c.is_persona === personaFilter)
                        && (!favoritesOnly || isSaved(c.external_id))
                        && (!activeCol || activeCol.characterIds.includes(c.external_id))
                        && notInOther
                        && (!sfwOnly || !nsfwMap[c.external_id]);
                    });
                    lastSelectedIndexRef.current = visibleList.findIndex(c => c.external_id === char.external_id);
                    return;
                  }
                  // Shift click: range select
                  if (e.shiftKey && lastSelectedIndexRef.current >= 0) {
                    e.preventDefault();
                    const visibleList = allCharacters.filter(c => {
                      const q = searchQuery.trim().toLowerCase();
                      const activeCol = activeCollectionId != null ? collections.find(col => col.id === activeCollectionId) : null;
                      const allColIds = new Set(collections.flatMap(col => col.characterIds));
                      const notInOther = activeCol ? activeCol.characterIds.includes(c.external_id) : !allColIds.has(c.external_id);
                      const matchesSearch = !q || (activeCol
                        ? (activeCol.characterIds.includes(c.external_id) && c.name.toLowerCase().includes(q))
                        : c.name.toLowerCase().includes(q));
                      return (!privacyFilter || c.privacy_status === privacyFilter)
                        && matchesSearch
                        && (personaFilter === null || c.is_persona === personaFilter)
                        && (!favoritesOnly || isSaved(c.external_id))
                        && (!activeCol || activeCol.characterIds.includes(c.external_id))
                        && notInOther
                        && (!sfwOnly || !nsfwMap[c.external_id]);
                    });
                    const currentIdx = visibleList.findIndex(c => c.external_id === char.external_id);
                    const [from, to] = [Math.min(lastSelectedIndexRef.current, currentIdx), Math.max(lastSelectedIndexRef.current, currentIdx)];
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      visibleList.slice(from, to + 1).forEach(c => next.add(c.external_id));
                      return next;
                    });
                    return;
                  }
                  // Normal click: open profile (clear selection if any)
                  if (selectedIds.size > 0) {
                    setSelectedIds(new Set());
                    return;
                  }
                  setSelectedCharacter(char);
                }}
                onEdit={setEditCharacter}
                onDelete={setDeleteCharacter}
                searchQuery={searchQuery}
                isSelected={selectedIds.has(character.external_id)}
              />
            ))}


          </div>
        )}

        {/* End of list indicator */}
        {!isLoading && allCharacters.length > 0 && (
          <div className="flex items-center gap-3 mt-6">
            <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.05)' }} />
            <span
              className="text-[10px] uppercase tracking-[0.2em] px-3"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.3 0.01 264)', fontWeight: 600 }}
            >
              End of Roster — {allCharacters.length} units{privacyFilter ? ` · ${allCharacters.filter(c => c.privacy_status === privacyFilter).length} ${privacyFilter}` : ''}
            </span>
            <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.05)' }} />
          </div>
        )}
      </main>

      {/* Character profile modal */}
      {selectedCharacter && (
        <CharacterProfile
          character={selectedCharacter}
          onClose={() => setSelectedCharacter(null)}
          onUpdated={(updated) => {
            setAllCharacters(prev =>
              prev.map(c => c.external_id === updated.external_id ? updated : c)
            );
            setSelectedCharacter(updated);
          }}
          collections={collections}
          isInCollection={isInCollection}
          onToggleInCollection={toggleInCollection}
          onCreateCollection={createCollection}
          isSaved={selectedCharacter ? isSaved(selectedCharacter.external_id) : false}
          onToggleSave={selectedCharacter ? () => toggleSave(selectedCharacter.external_id, selectedCharacter.name) : undefined}
          onNsfwToggle={(characterId, isNsfw) => {
            setNsfwMap(prev => ({ ...prev, [characterId]: isNsfw }));
          }}
        />
      )}

      {/* Edit / Create collection modal */}
      <EditCollectionModal
        open={showNewCollectionModal || !!editingCollection}
        onClose={() => { setShowNewCollectionModal(false); setEditingCollection(null); }}
        collection={editingCollection}
        onSave={async (name, coverImage, description) => {
          if (editingCollection) {
            updateCollection(editingCollection.id as number, { name, coverImage, description });
          } else {
            // Pass all fields in one shot so the image is saved atomically
            await createCollection(name, coverImage, description);
          }
        }}
      />

      {/* Bulk action bar — shown when characters are selected */}
      <BulkActionBar
        ref={bulkBarRef}
        selectedCount={selectedIds.size}
        selectedIds={Array.from(selectedIds)}
        onClear={() => setSelectedIds(new Set())}
        onBulkFavorite={(ids) => {
          const allCurrentlySaved = ids.every(id => isSaved(id));
          ids.forEach(id => {
            const char = allCharacters.find(c => c.external_id === id);
            if (!char) return;
            // Toggle: if all saved → unsave all; otherwise save all unsaved
            if (allCurrentlySaved || !isSaved(id)) toggleSave(id, char.name);
          });
        }}
        allSaved={(ids) => ids.length > 0 && ids.every(id => isSaved(id))}
        collections={collections}
        isInCollection={isInCollection}
        onToggleInCollection={toggleInCollection}
        onCreateCollection={createCollection}
      />

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        character={deleteCharacter}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteCharacter(null)}
        isDeleting={deleteMutation.isPending}
      />

      {/* Delete collection confirmation dialog */}
      <DeleteCollectionDialog
        collection={deletingCollection}
        onConfirm={(c) => {
          deleteCollection(c.id);
          if (activeCollectionId === c.id) setActiveCollectionId(null);
          setDeletingCollection(null);
        }}
        onCancel={() => setDeletingCollection(null)}
      />

      {/* Create character modal */}
      <CreateCharacterModal
        open={showCreateModal || !!editCharacter}
        onClose={() => { setShowCreateModal(false); setEditCharacter(null); }}
        onSaved={handleCharacterSaved}
        editCharacter={editCharacter}
      />

      {/* Settings modal */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
