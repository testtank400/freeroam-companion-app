// EditCollectionModal.tsx
// Modal for creating or editing a collection's name and cover image.
// Cover image: paste a URL or upload a file (same pattern as character creation).

import { Collection } from '@/hooks/useCollections';
import { trpc } from '@/lib/trpc';
import { ImagePlus, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface EditCollectionModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, editing an existing collection; otherwise creating new */
  collection?: Collection | null;
  onSave: (name: string, coverImage?: string, description?: string) => void;
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

export default function EditCollectionModal({ open, onClose, collection, onSave }: EditCollectionModalProps) {
  const isEditing = !!collection;
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [description, setDescription] = useState('');
  const [coverMode, setCoverMode] = useState<'url' | 'upload'>('url');
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadedCoverUrl, setUploadedCoverUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCoverMutation = trpc.collections.uploadCoverImage.useMutation();

  useEffect(() => {
    if (open) {
      setName(collection?.name ?? '');
      setDescription(collection?.description ?? '');
      setCoverUrl(collection?.coverImage ?? '');
      setCoverMode('url');
      setUploadPreview(null);
      setUploadedCoverUrl(null);
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

      // Upload to Manus S3 storage — extract base64 portion after the comma
      const base64 = dataUrl.split(',')[1];
      const result = await uploadCoverMutation.mutateAsync({
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
      });
      setUploadedCoverUrl(result.url);
    } catch {
      toast.error('Failed to upload image');
      setUploadPreview(null);
      setUploadedCoverUrl(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Collection name is required'); return; }
    // Use the S3 URL for uploaded files, or the pasted URL for URL mode
    const finalCover = coverMode === 'url' ? coverUrl.trim() || undefined : (uploadedCoverUrl ?? undefined);
    onSave(name.trim(), finalCover, description.trim() || undefined);
    handleClose();
  };

  if (!open) return null;

  const previewImage = coverMode === 'url' ? coverUrl : (uploadPreview ?? '');

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
          <div className="p-6 space-y-5">
            {/* Name */}
            <div>
              <label style={LABEL_STYLE}>Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blacklight Division"
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

            {/* Cover Image */}
            <div>
              <label style={LABEL_STYLE}>Cover Image</label>

              {/* Mode toggle */}
              <div className="flex gap-1 mb-3">
                {(['url', 'upload'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCoverMode(mode)}
                    className="px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                    style={{
                      fontFamily: 'Rajdhani, sans-serif',
                      background: coverMode === mode ? 'oklch(0.769 0.188 70.08 / 0.15)' : 'oklch(0.15 0.01 264)',
                      border: coverMode === mode ? '1px solid oklch(0.769 0.188 70.08 / 0.4)' : '1px solid oklch(1 0 0 / 0.08)',
                      color: coverMode === mode ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.45 0.01 264)',
                    }}
                  >
                    {mode === 'url' ? 'Paste URL' : 'Upload File'}
                  </button>
                ))}
              </div>

              <div className="flex gap-3 items-start">
                {/* Preview */}
                <div
                  className="flex-shrink-0 w-20 h-24 rounded-sm overflow-hidden flex items-center justify-center"
                  style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.1)' }}
                >
                  {previewImage ? (
                    <img
                      src={previewImage}
                      alt="Cover preview"
                      className="w-full h-full object-cover object-top"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <ImagePlus size={20} style={{ color: 'oklch(0.3 0.01 264)' }} />
                  )}
                </div>

                <div className="flex-1">
                  {coverMode === 'url' ? (
                    <input
                      type="url"
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="https://images.example.com/cover.webp"
                      style={{ ...FIELD_STYLE }}
                      onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
                      onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
                    />
                  ) : (
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
                        {isUploading ? 'Uploading...' : uploadedCoverUrl ? 'Change Image' : 'Choose Image'}
                      </button>
                      {uploadPreview && !isUploading && (
                        <p className="mt-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: uploadedCoverUrl ? 'oklch(0.65 0.15 145)' : 'oklch(0.65 0.15 25)' }}>
                          {uploadedCoverUrl ? '✓ Image uploaded' : '⏳ Uploading...'}
                        </p>
                      )}
                    </div>
                  )}
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
              disabled={!name.trim()}
              className="px-5 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50 hover:brightness-110"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.769 0.188 70.08 / 0.15)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.5)',
                color: 'oklch(0.769 0.188 70.08)',
              }}
            >
              {isEditing ? 'Save Changes' : 'Create Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
