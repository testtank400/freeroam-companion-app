// AddToCollectionPopover.tsx
// Popover shown inside the character profile modal.
// Lists all collections with checkboxes; clicking toggles membership.
// Also allows creating a new collection inline.

import { Collection } from '@/hooks/useCollections';
import { Check, FolderOpen, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface AddToCollectionPopoverProps {
  characterId: string;
  collections: Collection[];
  isInCollection: (collectionId: number, characterId: string) => boolean;
  onToggle: (collectionId: number, characterId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export default function AddToCollectionPopover({
  characterId,
  collections,
  isInCollection,
  onToggle,
  onCreate,
  onClose,
}: AddToCollectionPopoverProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCreating) newInputRef.current?.focus();
  }, [isCreating]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleCreate = () => {
    if (!newName.trim()) { setIsCreating(false); return; }
    onCreate(newName.trim());
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div
      ref={containerRef}
      className="rounded-sm overflow-hidden"
      style={{
        width: '100%',
        background: 'oklch(0.16 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.12)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)' }}
      >
        <span
          className="text-[10px] uppercase tracking-widest font-semibold"
          style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}
        >
          Add to Collection
        </span>
        <button onClick={onClose} style={{ color: 'oklch(0.45 0.01 264)' }}>
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>

      {/* Search bar */}
      {collections.length > 5 && (
        <div
          className="px-3 py-2"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)' }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search collections..."
            className="w-full bg-transparent outline-none text-[11px]"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.88 0.005 65)' }}
          />
        </div>
      )}

      {/* Collection list */}
      <div className="overflow-y-auto" style={{ maxHeight: 'min(300px, 50vh)' }}>
        {collections.length === 0 && !isCreating && (
          <div className="px-3 py-4 text-center">
            <FolderOpen size={18} className="mx-auto mb-1.5" style={{ color: 'oklch(0.35 0.01 264)' }} />
            <p className="text-[10px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.4 0.01 264)' }}>
              No collections yet
            </p>
          </div>
        )}
        {[...collections]
          .filter(col => !searchQuery.trim() || col.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name)).map(col => {
          const active = isInCollection(col.id as number, characterId);
          return (
            <button
              key={col.id}
              onClick={() => onToggle(col.id as number, characterId)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5"
              style={{ borderBottom: '1px solid oklch(1 0 0 / 0.05)' }}
            >
              {/* Checkbox */}
              <div
                className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  background: active ? 'oklch(0.769 0.188 70.08)' : 'transparent',
                  border: active ? '1px solid oklch(0.769 0.188 70.08)' : '1px solid oklch(1 0 0 / 0.2)',
                }}
              >
                {active && <Check size={10} strokeWidth={3} style={{ color: 'oklch(0.11 0.009 264)' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[11px] font-semibold truncate"
                  style={{ fontFamily: 'Rajdhani, sans-serif', color: active ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.75 0.005 65)' }}
                >
                  {col.name}
                </p>
                <p
                  className="text-[9px]"
                  style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.4 0.01 264)' }}
                >
                  {col.characterIds.length} character{col.characterIds.length !== 1 ? 's' : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* New collection input or button */}
      <div style={{ borderTop: '1px solid oklch(1 0 0 / 0.08)' }}>
        {isCreating ? (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              ref={newInputRef}
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setIsCreating(false); setNewName(''); } }}
              placeholder="Collection name..."
              className="flex-1 bg-transparent outline-none text-[11px]"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.88 0.005 65)' }}
            />
            <button onClick={handleCreate} className="hover:opacity-80" style={{ color: 'oklch(0.769 0.188 70.08)' }}>
              <Check size={12} strokeWidth={2.5} />
            </button>
            <button onClick={() => { setIsCreating(false); setNewName(''); }} className="hover:opacity-80" style={{ color: 'oklch(0.5 0.01 264)' }}>
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
            style={{ color: 'oklch(0.769 0.188 70.08)' }}
          >
            <Plus size={12} strokeWidth={2.5} />
            <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
              New Collection
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
