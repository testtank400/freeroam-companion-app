// Home.tsx
// Design: Tactical Dark Ops — dark background, character card grid,
// header with title and character count, amber accent system
// Data: fetched live from getfreeroam API via tRPC proxy

import CharacterCard from '@/components/CharacterCard';
import CharacterProfile from '@/components/CharacterProfile';
import { trpc } from '@/lib/trpc';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

// Map API privacy_status to our display type
type PrivacyStatus = 'private' | 'public' | 'linked';

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

export default function Home() {
  const [selectedCharacter, setSelectedCharacter] = useState<ApiCharacter | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = trpc.characters.list.useQuery(
    { username: 'Test Tank', limit: 20, sort: 'recent' },
    { staleTime: 60_000 }
  );

  const characters = data?.characters ?? [];

  const handleAddCharacter = () => {
    toast.info('Add character feature coming soon');
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
              {isLoading ? 'Loading...' : `${characters.length} unit${characters.length !== 1 ? 's' : ''} on record`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button
            onClick={() => refetch()}
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

        {/* Loading state */}
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
          <div
            className="flex flex-col items-center justify-center py-20 gap-4"
            style={{ color: 'oklch(0.65 0.22 25)' }}
          >
            <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '18px', fontWeight: 700 }}>
              FAILED TO LOAD CHARACTERS
            </p>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.45 0.01 264)' }}>
              Unable to reach the API. Check your session cookie.
            </p>
            <button
              onClick={() => refetch()}
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
        {!isLoading && !isError && characters.length === 0 && (
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
        {!isLoading && characters.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {characters.map((character) => (
              <CharacterCard
                key={character.external_id}
                character={character}
                onClick={setSelectedCharacter}
              />
            ))}
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
    </div>
  );
}
