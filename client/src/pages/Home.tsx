// Home.tsx
// Design: Tactical Dark Ops — dark background, character card grid,
// header with title and character count, amber accent system

import CharacterCard from '@/components/CharacterCard';
import CharacterProfile from '@/components/CharacterProfile';
import { Character, characters } from '@/lib/characters';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export default function Home() {
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);

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
              {characters.length} unit{characters.length !== 1 ? 's' : ''} on record
            </p>
          </div>
        </div>

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
      </header>

      {/* Main content */}
      <main className="container py-8">
        {/* Section label */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="h-px flex-1"
            style={{ background: 'oklch(1 0 0 / 0.06)' }}
          />
          <span
            className="text-[10px] uppercase tracking-[0.2em] px-3"
            style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.4 0.01 264)', fontWeight: 600 }}
          >
            All Characters
          </span>
          <div
            className="h-px flex-1"
            style={{ background: 'oklch(1 0 0 / 0.06)' }}
          />
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              onClick={setSelectedCharacter}
            />
          ))}
        </div>
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
