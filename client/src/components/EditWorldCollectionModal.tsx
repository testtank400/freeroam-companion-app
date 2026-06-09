// EditWorldCollectionModal.tsx
// Modal for creating or editing a Freeroam world collection.
// Based on EditCollectionModal — supports name, description, privacy, and cover image upload.

import { ApiWorldCollection } from '@/components/WorldCollectionCard';
import { trpc } from '@/lib/trpc';
import { Globe, ImagePlus, Lock, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface EditWorldCollectionModalProps {
  open: boolean;
  onClose: () => void;
  /** If provided, we're editing; otherwise creating */
  collection?: ApiWorldCollection | null;
  onSaved: () => void;
}

const FIELD_STYLE = {
  background: 'oklch(0.15 0.01 264)',
  border: '1px solid oklch(1 0 0 / 0.1)',
  color: 'oklch(0.88 0.005 65)',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '12px',
  outline: 'none',
  borderRadius: '2px',
  padding: '8px 10px',
  width: '100%',
};

const LABEL_STYLE = {
  fontFamily: 'Rajdhani, sans-serif',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.15em',
  textTransform: 'uppercase' as const,
  color: 'oklch(0.769 0.188 70.08)',
  display: 'block',
  marginBottom: '6px',
};

export default function EditWorldCollectionModal({ open, onClose, collection, onSaved }: EditWorldCollectionModalProps) {
  const isEditing = !!collection;
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'public'>('public');
  const [coverUrl, setCoverUrl] = useState('');
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = trpc.worldCollections.create.useMutation();
  const updateMutation = trpc.worldCollections.update.useMutation();
  const uploadCoverMutation = trpc.worldCollections.uploadCover.useMutation();

  useEffect(() => {
    if (open) {
      setName(collection?.name ?? '');
      setDescription(collection?.description ?? '');
      setPrivacyStatus((collection?.privacy_status === 'private' ? 'private' : 'public') as 'private' | 'public');
      setCoverUrl(collection?.cover_image_url ?? '');
      setUploadPreview(null);
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open, collection]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Image must be under 10MB'); return; }

    setIsUploading(true);
    try {
      // Show local preview immediately
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setUploadPreview(dataUrl);

      // If editing, upload directly to Freeroam
      if (isEditing && collection) {
        const base64 = dataUrl.split(',')[1];
        const result = await uploadCoverMutation.mutateAsync({
          collectionId: collection.external_id,
          fileBase64: base64,
          mimeType: file.type,
        });
        setCoverUrl(result.cover_image_url ?? '');
        setUploadPreview(result.cover_image_url ?? dataUrl);
        toast.success('Cover image uploaded');
      } else {
        // For new collections, store the base64 for upload after creation
        setCoverUrl(dataUrl);
      }
    } catch {
      toast.error('Failed to upload image');
      setUploadPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Collection name is required'); return; }

    setIsSaving(true);
    try {
      if (isEditing && collection) {
        // Update existing collection
        await updateMutation.mutateAsync({
          collectionId: collection.external_id,
          name: name.trim(),
          description: description.trim() || null,
          privacy_status: privacyStatus,
        });
        toast.success('Collection updated');
      } else {
        // Create new collection
        const result = await createMutation.mutateAsync({ name: name.trim() });

        // If we have a cover image to upload and the collection was created successfully
        if (result.collection && coverUrl && coverUrl.startsWith('data:')) {
          try {
            const base64 = coverUrl.split(',')[1];
            const mimeMatch = coverUrl.match(/data:([^;]+);/);
            const mimeType = mimeMatch?.[1] ?? 'image/png';
            await uploadCoverMutation.mutateAsync({
              collectionId: result.collection.external_id,
              fileBase64: base64,
              mimeType,
            });
          } catch {
            toast.error('Collection created but cover upload failed');
          }
        }

        // If description or privacy needs to be set (create only returns basic fields)
        if (result.collection && (description.trim() || privacyStatus !== 'public')) {
          try {
            await updateMutation.mutateAsync({
              collectionId: result.collection.external_id,
              description: description.trim() || null,
              privacy_status: privacyStatus,
            });
          } catch {
            // Non-fatal
          }
        }

        toast.success('Collection created');
      }
      onSaved();
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save collection');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  const previewImage = coverMode === 'url' ? coverUrl : (uploadPreview ?? coverUrl ?? '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: `rgba(0,0,0,${visible ? '0.75' : '0'})`,
        backdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 0.25s ease, backdrop-filter 0.25s ease',
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-md rounded-sm overflow-hidden flex flex-col"
        style={{
          background: 'oklch(0.11 0.009 264)',
          border: '1px solid oklch(1 0 0 / 0.1)',
          transform: visible ? 'scale(1)' : 'scale(0.97)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.25s ease, opacity 0.25s ease',
          boxShadow: '0 0 0 1px oklch(0.769 0.188 70.08 / 0.15), 0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)' }}
        >
          <h2
            className="text-xl font-bold tracking-widest uppercase"
            style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)' }}
          >
            {isEditing ? 'Edit Collection' : 'New Collection'}
          </h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-sm hover:bg-white/10 transition-colors"
            style={{ color: 'oklch(0.55 0.01 264)', border: '1px solid oklch(1 0 0 / 0.1)' }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Name */}
            <div>
              <label style={LABEL_STYLE}>Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Monster Girl Quest"
                required
                autoFocus
                style={{ ...FIELD_STYLE }}
                onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
                onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
              />
            </div>

            {/* Description */}
            <div>
              <label style={LABEL_STYLE}>Description <span style={{ opacity: 0.5, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this collection about?"
                rows={2}
                style={{ ...FIELD_STYLE, resize: 'vertical' as const }}
                onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
                onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
              />
            </div>

            {/* Privacy */}
            <div>
              <label style={LABEL_STYLE}>Privacy</label>
              <div className="flex gap-1">
                {([
                  { value: 'public' as const, label: 'Public', icon: <Globe size={11} strokeWidth={2} /> },
                  { value: 'private' as const, label: 'Private', icon: <Lock size={11} strokeWidth={2} /> },
                ]).map(opt => {
                  const isActive = privacyStatus === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPrivacyStatus(opt.value)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
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

            {/* Cover Image */}
            <div>
              <label style={LABEL_STYLE}>Cover Image</label>

              <div className="flex gap-3 items-start">
                {/* Preview */}
                <div
                  className="flex-shrink-0 w-20 h-24 rounded-sm overflow-hidden flex items-center justify-center"
                  style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.1)' }}
                >
                  {previewImage && !previewImage.startsWith('data:') ? (
                    <img
                      src={previewImage}
                      alt="Cover preview"
                      className="w-full h-full object-cover object-center"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : uploadPreview ? (
                    <img
                      src={uploadPreview}
                      alt="Cover preview"
                      className="w-full h-full object-cover object-center"
                    />
                  ) : (
                    <ImagePlus size={20} style={{ color: 'oklch(0.3 0.01 264)' }} />
                  )}
                </div>

                <div className="flex-1">
                  <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
                        style={{
                          fontFamily: 'Rajdhani, sans-serif',
                          background: 'oklch(0.769 0.188 70.08 / 0.1)',
                          border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
                          color: 'oklch(0.769 0.188 70.08)',
                        }}
                      >
                        <Upload size={13} strokeWidth={2} />
                        {isUploading ? 'Uploading...' : uploadPreview ? 'Change Image' : 'Choose Image'}
                      </button>
                      {uploadPreview && !isUploading && (
                        <p className="mt-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.15 145)' }}>
                          {isEditing ? '✓ Image uploaded' : '✓ Image ready (will upload on save)'}
                        </p>
                      )}
                    </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-3 px-6 py-4"
            style={{ borderTop: '1px solid oklch(1 0 0 / 0.08)' }}
          >
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase"
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
              type="submit"
              disabled={!name.trim() || isUploading || isSaving}
              className="px-5 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50 hover:brightness-110"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.769 0.188 70.08 / 0.15)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.5)',
                color: 'oklch(0.769 0.188 70.08)',
              }}
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
