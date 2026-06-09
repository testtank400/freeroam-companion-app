// DeleteWorldCollectionDialog.tsx
// Confirmation dialog before deleting a world collection.

import { ApiWorldCollection } from '@/components/WorldCollectionCard';
import { trpc } from '@/lib/trpc';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface DeleteWorldCollectionDialogProps {
  collection: ApiWorldCollection | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteWorldCollectionDialog({ collection, onConfirm, onCancel }: DeleteWorldCollectionDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteMutation = trpc.worldCollections.delete.useMutation();

  if (!collection) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMutation.mutateAsync({ collectionId: collection.external_id });
      toast.success(`"${collection.name}" deleted`);
      onConfirm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete collection');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0.05 0.01 264 / 0.85)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-sm overflow-hidden"
        style={{
          background: 'oklch(0.13 0.01 264)',
          border: '1px solid oklch(0.65 0.22 25 / 0.3)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}>
          <div
            className="w-8 h-8 flex items-center justify-center rounded-sm"
            style={{ background: 'oklch(0.65 0.22 25 / 0.15)', border: '1px solid oklch(0.65 0.22 25 / 0.3)' }}
          >
            <AlertTriangle size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
          </div>
          <h3
            className="text-sm font-bold tracking-widest uppercase"
            style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.65 0.22 25)' }}
          >
            Delete Collection
          </h3>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <p
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.7 0.005 65)', lineHeight: '1.6' }}
          >
            Are you sure you want to delete <strong style={{ color: 'oklch(0.9 0.005 65)' }}>{collection.name}</strong>?
            This will remove the collection from Freeroam. Worlds inside it will not be deleted.
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'oklch(0.18 0.01 264)',
              border: '1px solid oklch(1 0 0 / 0.1)',
              color: 'oklch(0.55 0.01 264)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-4 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'oklch(0.65 0.22 25 / 0.15)',
              border: '1px solid oklch(0.65 0.22 25 / 0.4)',
              color: 'oklch(0.65 0.22 25)',
            }}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
