// BulkWorldCollectionPopover.tsx
// Popover for adding/removing multiple worlds from world collections.
// Handles bulk operations by calling add/remove mutations for each selected world.

import { ApiWorldCollection } from '@/components/WorldCollectionCard';
import { trpc } from '@/lib/trpc';
import { FolderPlus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface BulkWorldCollectionPopoverProps {
  selectedWorldIds: string[]; // array of world external_ids
  collections: ApiWorldCollection[];
  /** Set of collection IDs that ALL selected worlds belong to */
  membershipSet: Set<string>;
  onToggle: (collectionId: string, added: boolean) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export default function BulkWorldCollectionPopover({
  selectedWorldIds,
  collections,
  membershipSet,
  onToggle,
  onCreate,
  onClose,
}: BulkWorldCollectionPopoverProps) {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const addMutation = trpc.worldCollections.addWorld.useMutation();
  const removeMutation = trpc.worldCollections.removeWorld.useMutation();

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filtered = collections.filter(c =>
    !search.trim() || c.name.toLowerCase().includes(search.toLowerCase().trim())
  );

  const handleToggle = async (collectionId: string) => {
    const isIn = membershipSet.has(collectionId);
    setTogglingIds(prev => new Set(prev).add(collectionId));
    try {
      // For bulk operations, call add/remove for each selected world
      if (isIn) {
        // Remove all selected worlds from this collection
        await Promise.all(
          selectedWorldIds.map(worldId =>
            removeMutation.mutateAsync({ collectionId, worldExternalId: worldId })
          )
        );
      } else {
        // Add all selected worlds to this collection
        await Promise.all(
          selectedWorldIds.map(worldId =>
            addMutation.mutateAsync({ collectionId, worldExternalId: worldId })
          )
        );
      }
      onToggle(collectionId, !isIn);
      toast.success(`${selectedWorldIds.length} world${selectedWorldIds.length !== 1 ? 's' : ''} updated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update collection');
    } finally {
      setTogglingIds(prev => { const n = new Set(prev); n.delete(collectionId); return n; });
    }
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    onCreate(newName.trim());
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div
      ref={ref}
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
          Add to Collection ({selectedWorldIds.length})
        </span>
        <button onClick={onClose} style={{ color: 'oklch(0.45 0.01 264)' }}>
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
      {/* Search */}
      {collections.length > 4 && (
        <div className="px-2.5 pt-2.5 pb-1">
          <div className="relative flex items-center">
            <Search size={11} strokeWidth={2} className="absolute left-2 pointer-events-none" style={{ color: 'oklch(0.4 0.01 264)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search collections..."
              className="w-full pl-7 pr-6 py-1.5 rounded-sm text-[11px]"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.15 0.01 264)',
                border: '1px solid oklch(1 0 0 / 0.08)',
                color: 'oklch(0.82 0.005 65)',
                outline: 'none',
              }}
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2" style={{ color: 'oklch(0.4 0.01 264)' }}>
                <X size={10} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Collection list */}
      <div className="overflow-y-auto py-1" style={{ maxHeight: 'min(300px, 50vh)' }}>
        {filtered.length === 0 && (
          <p className="px-3 py-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.4 0.01 264)' }}>
            No collections found.
          </p>
        )}
        {filtered.map(col => {
          const isIn = membershipSet.has(col.external_id);
          const isToggling = togglingIds.has(col.external_id);
          return (
            <button
              key={col.external_id}
              onClick={() => handleToggle(col.external_id)}
              disabled={isToggling}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              {/* Checkbox indicator */}
              <div
                className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0"
                style={{
                  background: isIn ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.18 0.01 264)',
                  border: isIn ? '1px solid oklch(0.769 0.188 70.08)' : '1px solid oklch(1 0 0 / 0.15)',
                }}
              >
                {isIn && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path d="M1 3L3 5L7 1" stroke="oklch(0.11 0.009 264)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold truncate" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.85 0.005 65)' }}>
                  {col.name}
                </p>
                <p className="text-[9px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.4 0.01 264)' }}>
                  {col.world_count} world{col.world_count !== 1 ? 's' : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Create new collection inline */}
      <div className="px-2.5 pb-2.5 pt-1" style={{ borderTop: '1px solid oklch(1 0 0 / 0.06)' }}>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Jujutsu Kaisen Collection"
            className="flex-1 px-2 py-1.5 rounded-sm text-[11px]"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: 'oklch(0.15 0.01 264)',
              border: '1px solid oklch(1 0 0 / 0.08)',
              color: 'oklch(0.82 0.005 65)',
              outline: 'none',
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || isCreating}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors disabled:opacity-40"
            style={{
              background: 'oklch(0.769 0.188 70.08 / 0.12)',
              border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
              color: 'oklch(0.769 0.188 70.08)',
            }}
          >
            <FolderPlus size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
