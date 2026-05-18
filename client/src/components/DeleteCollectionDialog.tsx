// DeleteCollectionDialog.tsx
// Confirmation modal before deleting a collection — same visual language as DeleteConfirmDialog

import { Collection } from '@/hooks/useCollections';
import { AlertTriangle, FolderOpen, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DeleteCollectionDialogProps {
  collection: Collection | null;
  onConfirm: (collection: Collection) => void;
  onCancel: () => void;
  isDeleting?: boolean;
}

export default function DeleteCollectionDialog({
  collection,
  onConfirm,
  onCancel,
  isDeleting = false,
}: DeleteCollectionDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (collection) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [collection]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && collection) onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [collection]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  if (!collection) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: `rgba(0,0,0,${visible ? '0.75' : '0'})`,
        backdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 0.2s ease, backdrop-filter 0.2s ease',
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-sm rounded-sm overflow-hidden"
        style={{
          background: 'oklch(0.11 0.009 264)',
          border: '1px solid oklch(0.65 0.22 25 / 0.3)',
          transform: visible ? 'scale(1)' : 'scale(0.95)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.2s ease, opacity 0.2s ease',
          boxShadow: '0 0 0 1px oklch(0.65 0.22 25 / 0.15), 0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} strokeWidth={2} style={{ color: 'oklch(0.65 0.22 25)' }} />
            <span
              className="text-sm font-bold tracking-widest uppercase"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.65 0.22 25)' }}
            >
              Delete Collection
            </span>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-white/10 transition-colors"
            style={{ color: 'oklch(0.5 0.01 264)' }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {/* Collection preview row */}
          <div
            className="flex items-center gap-3 mb-4 p-3 rounded-sm"
            style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.07)' }}
          >
            {collection.coverImage ? (
              <img
                src={collection.coverImage}
                alt={collection.name}
                className="w-10 h-12 object-cover object-top rounded-sm flex-shrink-0"
              />
            ) : (
              <div
                className="w-10 h-12 rounded-sm flex-shrink-0 flex items-center justify-center"
                style={{ background: 'oklch(0.18 0.01 264)' }}
              >
                <FolderOpen size={18} style={{ color: 'oklch(0.35 0.01 264)' }} />
              </div>
            )}
            <div className="min-w-0">
              <p
                className="font-bold truncate"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)', fontSize: '15px' }}
              >
                {collection.name}
              </p>
              <p
                className="text-[11px] truncate"
                style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
              >
                {collection.characterIds.length} character{collection.characterIds.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <p
            className="text-sm leading-relaxed"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.6 0.01 264)', fontSize: '12px' }}
          >
            This action is <span style={{ color: 'oklch(0.75 0.18 25)', fontWeight: 600 }}>permanent</span> and cannot be undone. The collection will be removed. Your characters will not be affected.
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-5 py-4"
          style={{ borderTop: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'transparent',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.5 0.01 264)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(collection)}
            disabled={isDeleting}
            className="flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50 hover:brightness-110"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'oklch(0.65 0.22 25 / 0.15)',
              border: '1px solid oklch(0.65 0.22 25 / 0.5)',
              color: 'oklch(0.75 0.18 25)',
            }}
          >
            <Trash2 size={12} strokeWidth={2.5} />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
