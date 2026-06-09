// EditWorldCollectionModal.tsx
// Modal for creating or editing a Freeroam world collection.
// Supports name, description, privacy status, and cover image upload.

import { trpc } from '@/lib/trpc';
import { ApiWorldCollection } from '@/components/WorldCollectionCard';
import { Globe, Link, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface EditWorldCollectionModalProps {
  open: boolean;
  onClose: () => void;
  /** If provided, we're editing; otherwise creating */
  collection?: ApiWorldCollection | null;
  onSaved: () => void;
}

export default function EditWorldCollectionModal({ open, onClose, collection, onSaved }: EditWorldCollectionModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'public' | 'unlisted'>('public');
  const [isSaving, setIsSaving] = useState(false);

  const createMutation = trpc.worldCollections.create.useMutation();
  const updateMutation = trpc.worldCollections.update.useMutation();

  // Seed form when editing
  useEffect(() => {
    if (open && collection) {
      setName(collection.name);
      setDescription(collection.description ?? '');
      setPrivacyStatus(collection.privacy_status);
    } else if (open && !collection) {
      setName('');
      setDescription('');
      setPrivacyStatus('public');
    }
  }, [open, collection]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Collection name is required.');
      return;
    }
    setIsSaving(true);
    try {
      if (collection) {
        // Edit
        await updateMutation.mutateAsync({
          collectionId: collection.external_id,
          name: name.trim(),
          description: description.trim() || null,
          privacy_status: privacyStatus,
        });
        toast.success('Collection updated');
      } else {
        // Create
        await createMutation.mutateAsync({ name: name.trim() });
        toast.success('Collection created');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save collection');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  const isEditing = !!collection;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0.05 0.01 264 / 0.85)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-sm overflow-hidden"
        style={{
          background: 'oklch(0.13 0.01 264)',
          border: '1px solid oklch(1 0 0 / 0.1)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <h3
            className="text-sm font-bold tracking-widest uppercase"
            style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}
          >
            {isEditing ? 'Edit Collection' : 'New Collection'}
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors hover:brightness-125"
            style={{ background: 'oklch(0.18 0.01 264)', border: '1px solid oklch(1 0 0 / 0.1)', color: 'oklch(0.6 0.01 264)' }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          {/* Name */}
          <div>
            <label
              className="text-[10px] uppercase tracking-widest block mb-1.5"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.5 0.01 264)', fontWeight: 600 }}
            >
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name..."
              className="w-full px-3 py-2 rounded-sm text-xs"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.15 0.01 264)',
                border: '1px solid oklch(1 0 0 / 0.1)',
                color: 'oklch(0.88 0.005 65)',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
              onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label
              className="text-[10px] uppercase tracking-widest block mb-1.5"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.5 0.01 264)', fontWeight: 600 }}
            >
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this collection..."
              rows={3}
              className="w-full px-3 py-2 rounded-sm text-xs resize-none"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.15 0.01 264)',
                border: '1px solid oklch(1 0 0 / 0.1)',
                color: 'oklch(0.88 0.005 65)',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
              onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
            />
          </div>

          {/* Privacy status — only for edit mode */}
          {isEditing && (
            <div>
              <label
                className="text-[10px] uppercase tracking-widest block mb-1.5"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.5 0.01 264)', fontWeight: 600 }}
              >
                Privacy
              </label>
              <div className="flex gap-2">
                {([
                  { value: 'public' as const, label: 'Public', icon: <Globe size={11} strokeWidth={2} /> },
                  { value: 'unlisted' as const, label: 'Unlisted', icon: <Link size={11} strokeWidth={2} /> },
                  { value: 'private' as const, label: 'Private', icon: <Lock size={11} strokeWidth={2} /> },
                ]).map(opt => {
                  const isActive = privacyStatus === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setPrivacyStatus(opt.value)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                      style={{
                        fontFamily: 'Rajdhani, sans-serif',
                        background: isActive ? 'oklch(0.769 0.188 70.08 / 0.15)' : 'oklch(0.15 0.01 264)',
                        border: isActive ? '1px solid oklch(0.769 0.188 70.08 / 0.4)' : '1px solid oklch(1 0 0 / 0.08)',
                        color: isActive ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.45 0.01 264)',
                      }}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <button
            onClick={onClose}
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
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="px-4 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'oklch(0.769 0.188 70.08 / 0.15)',
              border: '1px solid oklch(0.769 0.188 70.08 / 0.4)',
              color: 'oklch(0.769 0.188 70.08)',
            }}
          >
            {isSaving ? 'Saving...' : isEditing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
