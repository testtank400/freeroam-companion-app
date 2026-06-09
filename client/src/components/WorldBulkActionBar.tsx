// WorldBulkActionBar.tsx
// Floating action bar that appears at the bottom of the screen when
// one or more worlds are selected via Ctrl/Cmd or Shift click.
// Actions: Add to Collection, Clear Selection.

import AddToWorldCollectionPopover from '@/components/AddToWorldCollectionPopover';
import { ApiWorldCollection } from '@/components/WorldCollectionCard';
import { FolderPlus, X } from 'lucide-react';
import React, { forwardRef, useEffect, useRef, useState } from 'react';

interface WorldBulkActionBarProps {
  selectedCount: number;
  selectedIds: string[]; // world external_ids
  onClear: () => void;
  worldCollections: ApiWorldCollection[];
  /** Set of collection external_ids that ALL selected worlds belong to */
  getMembershipSet: (selectedIds: string[]) => Set<string>;
  onToggleInCollection: (collectionId: string, added: boolean, worldExternalIds: string[]) => void;
  onCreateCollection: (name: string) => void;
}

const WorldBulkActionBar = forwardRef<HTMLDivElement, WorldBulkActionBarProps>(
  function WorldBulkActionBar(
    { selectedCount, selectedIds, onClear, worldCollections, getMembershipSet, onToggleInCollection, onCreateCollection },
    ref
  ) {
    const [showCollectionPopover, setShowCollectionPopover] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

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

    // For bulk: a collection is "active" only if ALL selected worlds are in it
    const bulkMembershipSet = getMembershipSet(selectedIds);

    const handleBulkToggle = (collectionId: string, added: boolean) => {
      onToggleInCollection(collectionId, added, selectedIds);
    };

    return (
      <div
        ref={ref}
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
            {worldCollections.length === 0 ? 'New Collection' : 'Add to Collection'}
          </button>

          {showCollectionPopover && (
            <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 60, width: 280 }}>
              <AddToWorldCollectionPopover
                worldExternalId="__bulk__"
                collections={worldCollections}
                membershipSet={bulkMembershipSet}
                onToggle={handleBulkToggle}
                onCreate={(name) => { onCreateCollection(name); }}
                onClose={() => setShowCollectionPopover(false)}
              />
            </div>
          )}
        </div>

        <div className="w-px h-4" style={{ background: 'oklch(1 0 0 / 0.12)' }} />

        {/* Clear */}
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1.5 rounded-sm transition-all hover:opacity-80"
          style={{ color: 'oklch(0.5 0.01 264)' }}
          title="Clear selection (Esc)"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  }
);

export default WorldBulkActionBar;
