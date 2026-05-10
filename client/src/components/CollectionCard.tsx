// CollectionCard.tsx
// Portrait card for a collection — same visual language as CharacterCard.
// Shows cover image (or a placeholder grid of character headshots),
// collection name, character count, and hover edit/delete buttons.

import { Collection } from '@/hooks/useCollections';
import { ApiCharacter } from '@/pages/Home';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';

interface CollectionCardProps {
  collection: Collection;
  characters: ApiCharacter[]; // characters in this collection
  onClick: (collection: Collection) => void;
  onEdit: (collection: Collection) => void;
  onDelete: (collection: Collection) => void;
}

const FALLBACK = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWEyNCIvPjwvc3ZnPg==';

/** 2×2 grid of character headshots used when no cover image is set */
function HeadshotGrid({ characters }: { characters: ApiCharacter[] }) {
  const slots = [0, 1, 2, 3].map(i => characters[i] ?? null);
  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
      {slots.map((char, i) => (
        <div key={i} className="overflow-hidden" style={{ background: 'oklch(0.16 0.01 264)' }}>
          {char && (
            <img
              src={char.display_headshot_url ?? char.headshot_url ?? FALLBACK}
              alt={char.name}
              className="w-full h-full object-cover object-top"
              onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function CollectionCard({ collection, characters, onClick, onEdit, onDelete }: CollectionCardProps) {
  const hasCover = !!collection.coverImage;
  const coverImageSrc = collection.coverImage ?? undefined;

  return (
    <div
      className="group char-card relative flex flex-col rounded-sm overflow-hidden cursor-pointer"
      style={{
        background: 'oklch(0.13 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.07)',
      }}
      onClick={() => onClick(collection)}
    >
      {/* Image area */}
      <div className="relative w-full" style={{ paddingBottom: '115%' }}>
        {hasCover ? (
          <img
            src={coverImageSrc}
            alt={collection.name}
            className="absolute inset-0 w-full h-full object-cover object-top"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : characters.length > 0 ? (
          <HeadshotGrid characters={characters} />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2"
            style={{ background: 'oklch(0.15 0.01 264)' }}
          >
            <FolderOpen size={32} style={{ color: 'oklch(0.3 0.01 264)' }} />
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.35 0.01 264)' }}
            >
              Empty
            </span>
          </div>
        )}

        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, oklch(0.13 0.01 264 / 0.85) 70%, oklch(0.13 0.01 264) 100%)',
          }}
        />

        {/* Top-right: Edit + Delete (visible on hover) */}
        <div className="absolute top-2.5 right-2.5 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(collection); }}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors hover:text-amber-400"
            style={{
              background: 'oklch(0.18 0.01 264 / 0.85)',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.7 0.005 65)',
              backdropFilter: 'blur(4px)',
            }}
            title="Edit collection"
          >
            <Pencil size={13} strokeWidth={2} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(collection); }}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors hover:text-red-400"
            style={{
              background: 'oklch(0.18 0.01 264 / 0.85)',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.7 0.005 65)',
              backdropFilter: 'blur(4px)',
            }}
            title="Delete collection"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Collection name + count overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 z-10">
          <h3
            className="text-xl font-bold leading-tight tracking-wide"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              color: 'oklch(0.95 0.005 65)',
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            {collection.name}
          </h3>
          <p
            className="text-xs mt-0.5"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: 'oklch(0.55 0.01 264)',
            }}
          >
            {characters.length} character{characters.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
