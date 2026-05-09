// BulkActionBar.tsx
// Floating action bar that appears at the bottom of the screen when
// one or more characters are selected via Ctrl/Cmd or Shift click.
// Actions: Add to Collection, Toggle Favorite, Clear Selection.

import AddToCollectionPopover from '@/components/AddToCollectionPopover';
import { Collection } from '@/hooks/useCollections';
import { FolderPlus, Heart, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  onClear: () => void;
  // Favorite
  onBulkFavorite: (ids: string[]) => void;
  allSaved: (ids: string[]) => boolean; // true if ALL selected are already saved
  // Collections
  collections: Collection[];
  isInCollection: (collectionId: string, characterId: string) => boolean;
  onToggleInCollection: (collectionId: string, characterId: string) => void;
  onCreateCollection: (name: string) => void;
}

export default function BulkActionBar({
  selectedCount,
  selectedIds,
  onClear,
  onBulkFavorite,
  allSaved,
  collections,
  isInCollection,
  onToggleInCollection,
  onCreateCollection,
}: BulkActionBarProps) {
  const [showCollectionPopover, setShowCollectionPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const everySaved = allSaved(selectedIds);

  // Close popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCollectionPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (selectedCount === 0) return null;

  // For the collection popover we use a synthetic "multi" character ID
  // and handle toggling all selected IDs at once
  const handleCollectionToggle = (collectionId: string, _charId: string) => {
    // If any selected char is NOT in the collection, add all; otherwise remove all
    const anyMissing = selectedIds.some(id => !isInCollection(collectionId, id));
    selectedIds.forEach(id => {
      const inCol = isInCollection(collectionId, id);
      if (anyMissing && !inCol) onToggleInCollection(collectionId, id);
      if (!anyMissing && inCol) onToggleInCollection(collectionId, id);
    });
  };

  // For the popover's isInCollection check, show checked if ALL selected are in the collection
  const bulkIsInCollection = (collectionId: string, _charId: string) =>
    selectedIds.length > 0 && selectedIds.every(id => isInCollection(collectionId, id));

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-sm"
      style={{
        transform: 'translateX(-50%)',
        background: 'oklch(0.16 0.01 264)',
        border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
        boxShadow: '0 0 0 1px oklch(0.769 0.188 70.08 / 0.1), 0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Selection count */}
      <span
        className="text-xs font-bold tracking-wider uppercase"
        style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}
      >
        {selectedCount} selected
      </span>

      <div className="w-px h-4" style={{ background: 'oklch(1 0 0 / 0.12)' }} />

      {/* Add to Collection */}
      <div className="relative" ref={popoverRef}>
        <button
          onClick={() => setShowCollectionPopover(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all hover:brightness-110"
          style={{
            fontFamily: 'Rajdhani, sans-serif',
            background: showCollectionPopover ? 'oklch(0.22 0.01 264)' : 'oklch(0.769 0.188 70.08 / 0.1)',
            border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
            color: 'oklch(0.769 0.188 70.08)',
          }}
        >
          <FolderPlus size={13} strokeWidth={2.5} />
          Add to Collection
        </button>

        {showCollectionPopover && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8 }}>
            <AddToCollectionPopover
              characterId="__bulk__"
              collections={collections}
              isInCollection={bulkIsInCollection}
              onToggle={handleCollectionToggle}
              onCreate={(name) => { onCreateCollection(name); }}
              onClose={() => setShowCollectionPopover(false)}
            />
          </div>
        )}
      </div>

      {/* Favorite / Unfavorite */}
      <button
        onClick={() => onBulkFavorite(selectedIds)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all hover:brightness-110"
        style={{
          fontFamily: 'Rajdhani, sans-serif',
          background: everySaved ? 'oklch(0.65 0.22 25 / 0.15)' : 'oklch(0.769 0.188 70.08 / 0.1)',
          border: everySaved ? '1px solid oklch(0.65 0.22 25 / 0.4)' : '1px solid oklch(0.769 0.188 70.08 / 0.3)',
          color: everySaved ? 'oklch(0.75 0.18 25)' : 'oklch(0.769 0.188 70.08)',
        }}
      >
        <Heart size={13} strokeWidth={2} fill={everySaved ? 'currentColor' : 'none'} />
        {everySaved ? 'Unfavorite' : 'Favorite'}
      </button>

      <div className="w-px h-4" style={{ background: 'oklch(1 0 0 / 0.12)' }} />

      {/* Clear */}
      <button
        onClick={onClear}
        className="flex items-center gap-1 px-2 py-1.5 rounded-sm transition-all hover:opacity-80"
        style={{ color: 'oklch(0.5 0.01 264)' }}
        title="Clear selection"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
