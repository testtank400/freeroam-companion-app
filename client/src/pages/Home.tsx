// Home.tsx
// Design: Tactical Dark Ops — dark background, character card grid
// Data: cursor-based infinite scroll from getfreeroam API via tRPC proxy
// Automatically loads more when the sentinel div at the bottom enters the viewport

import CharacterCard from '@/components/CharacterCard';
import CharacterProfile from '@/components/CharacterProfile';
import CreateCharacterModal from '@/components/CreateCharacterModal';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import { trpc } from '@/lib/trpc';
import { Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type PrivacyStatus = 'private' | 'public' | 'linked';

export interface ApiCharacter {
  external_id: string;
  name: string;
  backstory: string | null;
  description: string | null;
  headshot_url: string | null;
  display_headshot_url: string | null;
  is_persona: boolean;
  owner: { username: string; display_name: string };
  privacy_status: PrivacyStatus;
}

const USERNAME = 'Test Tank';
const LIMIT = 20;

export default function Home() {
  const [selectedCharacter, setSelectedCharacter] = useState<ApiCharacter | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editCharacter, setEditCharacter] = useState<ApiCharacter | null>(null);
  const [deleteCharacter, setDeleteCharacter] = useState<ApiCharacter | null>(null);
  const deleteMutation = trpc.characters.delete.useMutation();
  const [allCharacters, setAllCharacters] = useState<ApiCharacter[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // Initial load
  const { data, isLoading, isError, refetch, isFetching } = trpc.characters.list.useQuery(
    { username: USERNAME, limit: LIMIT, sort: 'recent', cursor: undefined },
    { staleTime: 60_000 }
  );

  // When initial data arrives, seed the list
  useEffect(() => {
    if (data) {
      setAllCharacters(data.characters as ApiCharacter[]);
      setHasMore(data.has_more);
      setCursor(data.next_cursor ?? undefined);
    }
  }, [data]);

  // Fetch the next page
  const loadMore = useCallback(async () => {
    if (isFetchingMore || !hasMore || !cursor) return;
    setIsFetchingMore(true);
    try {
      const result = await utils.characters.list.fetch({
        username: USERNAME,
        limit: LIMIT,
        sort: 'recent',
        cursor,
      });
      setAllCharacters(prev => [...prev, ...(result.characters as ApiCharacter[])]);
      setHasMore(result.has_more);
      setCursor(result.next_cursor ?? undefined);
    } catch (err) {
      toast.error('Failed to load more characters');
    } finally {
      setIsFetchingMore(false);
    }
  }, [isFetchingMore, hasMore, cursor, utils]);

  // IntersectionObserver watching the sentinel div
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' } // trigger 200px before hitting the very bottom
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Full refresh — reset everything and re-fetch from the top
  const handleRefresh = () => {
    setAllCharacters([]);
    setCursor(undefined);
    setHasMore(true);
    refetch();
  };

  const handleAddCharacter = () => setShowCreateModal(true);

  const handleConfirmDelete = async (character: ApiCharacter) => {
    try {
      await deleteMutation.mutateAsync({ characterId: character.external_id });
      // Remove from local list immediately (optimistic)
      setAllCharacters(prev => prev.filter(c => c.external_id !== character.external_id));
      toast.success(`${character.name} deleted`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete character');
    } finally {
      setDeleteCharacter(null);
    }
  };

  const handleCharacterCreated = () => {
    // Reset and re-fetch from the top
    setAllCharacters([]);
    setCursor(undefined);
    setHasMore(true);
    refetch();
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: 'oklch(0.098 0.008 264)' }}
    >
      {/* Top header bar */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-6 py-3"
        style={{
          background: 'oklch(0.098 0.008 264 / 0.95)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid oklch(1 0 0 / 0.07)',
        }}
      >
        <div className="flex items-center gap-3">
          {/* Logo mark */}
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
          <div>
            <h1
              className="text-base font-bold tracking-widest uppercase leading-none"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)' }}
            >
              Character Roster
            </h1>
            <p
              className="text-[10px] mt-0.5"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
            >
              {isLoading
                ? 'Loading...'
                : `${allCharacters.length} unit${allCharacters.length !== 1 ? 's' : ''} on record${hasMore ? '+' : ''}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

          {/* Add character button */}
          <button
            onClick={handleAddCharacter}
            className="flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all hover:brightness-110"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'oklch(0.769 0.188 70.08 / 0.12)',
              border: '1px solid oklch(0.769 0.188 70.08 / 0.35)',
              color: 'oklch(0.769 0.188 70.08)',
            }}
          >
            <Plus size={14} strokeWidth={2.5} />
            Add Character
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="container py-8">
        {/* Section label */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.06)' }} />
          <span
            className="text-[10px] uppercase tracking-[0.2em] px-3"
            style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.4 0.01 264)', fontWeight: 600 }}
          >
            All Characters
          </span>
          <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.06)' }} />
        </div>

        {/* Initial loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '18px', fontWeight: 700, color: 'oklch(0.4 0.01 264)' }}>
              NO CHARACTERS ON RECORD
            </p>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.35 0.01 264)' }}>
              Your roster is empty.
            </p>
          </div>
        )}

        {/* Card grid */}
        {allCharacters.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {allCharacters.map((character) => (
              <CharacterCard
                key={character.external_id}
                character={character}
                onClick={setSelectedCharacter}
                onEdit={setEditCharacter}
                onDelete={setDeleteCharacter}
              />
            ))}

            {/* Skeleton cards appended while loading more */}
            {isFetchingMore && Array.from({ length: 5 }).map((_, i) => (
              <div
                key={`skeleton-more-${i}`}
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

        {/* Sentinel div — IntersectionObserver watches this to trigger loadMore */}
        <div ref={sentinelRef} className="h-4 mt-4" />

        {/* End of list indicator */}
        {!isLoading && !hasMore && allCharacters.length > 0 && (
          <div className="flex items-center gap-3 mt-6">
            <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.05)' }} />
            <span
              className="text-[10px] uppercase tracking-[0.2em] px-3"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.3 0.01 264)', fontWeight: 600 }}
            >
              End of Roster — {allCharacters.length} units
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
        />
      )}

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        character={deleteCharacter}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteCharacter(null)}
        isDeleting={deleteMutation.isPending}
      />

      {/* Create character modal */}
      <CreateCharacterModal
        open={showCreateModal || !!editCharacter}
        onClose={() => { setShowCreateModal(false); setEditCharacter(null); }}
        onSaved={handleCharacterCreated}
        editCharacter={editCharacter}
      />
    </div>
  );
}
