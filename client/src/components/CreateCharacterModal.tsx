// CreateCharacterModal.tsx
// Shared modal for both creating and editing characters.
// In "edit" mode, fields are pre-populated from the existing character.
// Design: Tactical Dark Ops — slide-up modal with amber accents

import { trpc } from '@/lib/trpc';
import { ApiCharacter } from '@/pages/Home';
import { Globe, ImagePlus, Link, Lock, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type PrivacyStatus = 'private' | 'public' | 'linked';

interface CreateCharacterModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save. Receives the updated/created character from the API response. */
  onSaved: (character: ApiCharacter, mode: 'create' | 'edit') => void;
  /** When provided, the modal operates in edit mode pre-filled with this character's data */
  editCharacter?: ApiCharacter | null;
}

const PRIVACY_OPTIONS: { value: PrivacyStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'private', label: 'Private', icon: <Lock size={13} strokeWidth={2.5} /> },
  { value: 'public',  label: 'Public',  icon: <Globe size={13} strokeWidth={2.5} /> },
  { value: 'linked',  label: 'Linked',  icon: <Link size={13} strokeWidth={2.5} /> },
];

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
  resize: 'vertical' as const,
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

export default function CreateCharacterModal({
  open,
  onClose,
  onSaved,
  editCharacter,
}: CreateCharacterModalProps) {
  const isEditMode = !!editCharacter;
  const [visible, setVisible] = useState(false);

  // Fetch full character data (with appearance) when in edit mode
  const { data: fullEditData } = trpc.characters.get.useQuery(
    { characterId: editCharacter?.external_id ?? '' },
    { enabled: isEditMode && !!editCharacter?.external_id, staleTime: 5 * 60_000 }
  );

  // Form state — seeded from editCharacter when available
  const [name, setName] = useState('');
  const [backstory, setBackstory] = useState('');
  const [appearance, setAppearance] = useState('');
  const [privacy, setPrivacy] = useState<PrivacyStatus>('private');
  const [headshotUrl, setHeadshotUrl] = useState('');
  const [headshotMode, setHeadshotMode] = useState<'url' | 'upload'>('url');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedHeadshotUrl, setUploadedHeadshotUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadHeadshotMutation = trpc.characters.uploadHeadshot.useMutation();
  const createMutation = trpc.characters.create.useMutation();
  const updateMutation = trpc.characters.update.useMutation();

  const isSubmitting = createMutation.isPending || updateMutation.isPending || isUploading;

  // Seed form when opening in edit mode (wait for full data if available)
  useEffect(() => {
    if (open && isEditMode) {
      const src = fullEditData ?? editCharacter;
      setName(src?.name ?? '');
      setBackstory((fullEditData?.backstory ?? editCharacter?.backstory) ?? '');
      setAppearance(fullEditData?.appearance ?? '');
      setPrivacy((src?.privacy_status as PrivacyStatus) ?? 'private');
      const existingUrl = src?.display_headshot_url ?? src?.headshot_url ?? '';
      setHeadshotUrl(existingUrl);
      setHeadshotMode('url');
      setUploadedFile(null);
      setUploadPreview(null);
      setUploadedHeadshotUrl(null);
    }
  }, [open, isEditMode, editCharacter, fullEditData]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  const resetForm = () => {
    setName('');
    setBackstory('');
    setAppearance('');
    setPrivacy('private');
    setHeadshotUrl('');
    setHeadshotMode('url');
    setUploadedFile(null);
    setUploadPreview(null);
    setUploadedHeadshotUrl(null);
    setIsUploading(false);
  };

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => {
      if (!isEditMode) resetForm();
      onClose();
    }, 250);
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

    setUploadedFile(file);
    setUploadedHeadshotUrl(null);

    const reader = new FileReader();
    reader.onload = (ev) => setUploadPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setIsUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await uploadHeadshotMutation.mutateAsync({
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
      });
      setUploadedHeadshotUrl(result.headshot_url);
      toast.success('Headshot uploaded successfully');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
      setUploadedFile(null);
      setUploadPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Character name is required'); return; }

    const finalHeadshotUrl =
      headshotMode === 'upload'
        ? (uploadedHeadshotUrl ?? (editCharacter?.display_headshot_url ?? editCharacter?.headshot_url ?? undefined))
        : headshotUrl.trim() || undefined;

    try {
      if (isEditMode && editCharacter) {
        const updated = await updateMutation.mutateAsync({
          characterId: editCharacter.external_id,
          name: name.trim(),
          backstory: backstory.trim() || undefined,
          appearance: appearance.trim() || undefined,
          headshot_url: finalHeadshotUrl,
          privacy_status: privacy,
        });
        toast.success(`${name} updated successfully!`);
        handleClose();
        // Convert SingleCharacter response back to ApiCharacter shape for the list
        const updatedAsApiChar: ApiCharacter = {
          external_id: updated.external_id,
          name: updated.name,
          backstory: updated.backstory,
          description: updated.description,
          headshot_url: updated.headshot_url,
          display_headshot_url: updated.display_headshot_url,
          is_persona: editCharacter.is_persona,
          owner: {
            username: updated.owner.username,
            display_name: updated.owner.display_name ?? updated.owner.username,
          },
          privacy_status: updated.privacy_status,
        };
        onSaved(updatedAsApiChar, 'edit');
      } else {
        const created = await createMutation.mutateAsync({
          name: name.trim(),
          backstory: backstory.trim() || undefined,
          appearance: appearance.trim() || undefined,
          headshot_url: finalHeadshotUrl,
          privacy_status: privacy,
        });
        toast.success(`${name} created successfully!`);
        handleClose();
        const createdAsApiChar: ApiCharacter = {
          external_id: created.external_id,
          name: created.name,
          backstory: created.backstory,
          description: created.description,
          headshot_url: created.headshot_url,
          display_headshot_url: created.display_headshot_url,
          is_persona: false,
          owner: {
            username: created.owner.username,
            display_name: created.owner.display_name ?? created.owner.username,
          },
          privacy_status: created.privacy_status,
        };
        onSaved(createdAsApiChar, 'create');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Failed to ${isEditMode ? 'update' : 'create'} character`);
    }
  };

  if (!open) return null;

  const previewImage = headshotMode === 'url' ? headshotUrl : (uploadPreview ?? '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{
        background: `rgba(0,0,0,${visible ? '0.75' : '0'})`,
        backdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 0.25s ease, backdrop-filter 0.25s ease',
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full sm:max-w-2xl sm:rounded-sm overflow-hidden flex flex-col"
        style={{
          background: 'oklch(0.11 0.009 264)',
          border: '1px solid oklch(1 0 0 / 0.1)',
          maxHeight: '92vh',
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.97)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.25s ease, opacity 0.25s ease',
          boxShadow: '0 0 0 1px oklch(0.769 0.188 70.08 / 0.15), 0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)' }}
        >
          <div>
            <h2
              className="text-xl font-bold tracking-widest uppercase"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)' }}
            >
              {isEditMode ? 'Edit Character' : 'New Character'}
            </h2>
            {isEditMode && (
              <p className="text-[11px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>
                {editCharacter?.name}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-sm hover:bg-white/10 transition-colors"
            style={{ color: 'oklch(0.55 0.01 264)', border: '1px solid oklch(1 0 0 / 0.1)' }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">

            {/* Name */}
            <div>
              <label style={LABEL_STYLE}>Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Trooper-Kane"
                required
                style={{ ...FIELD_STYLE, resize: undefined }}
                onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
                onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
              />
            </div>

            {/* Privacy Status */}
            <div>
              <label style={LABEL_STYLE}>Visibility</label>
              <div className="flex gap-2">
                {PRIVACY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPrivacy(opt.value)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all"
                    style={{
                      fontFamily: 'Rajdhani, sans-serif',
                      background: privacy === opt.value
                        ? opt.value === 'private' ? 'oklch(0.25 0.01 264)' : opt.value === 'public' ? 'oklch(0.25 0.08 145 / 0.4)' : 'oklch(0.25 0.08 220 / 0.4)'
                        : 'oklch(0.15 0.01 264)',
                      border: privacy === opt.value
                        ? opt.value === 'private' ? '1px solid oklch(1 0 0 / 0.2)' : opt.value === 'public' ? '1px solid oklch(0.55 0.15 145 / 0.6)' : '1px solid oklch(0.55 0.15 220 / 0.6)'
                        : '1px solid oklch(1 0 0 / 0.08)',
                      color: privacy === opt.value
                        ? opt.value === 'private' ? 'oklch(0.85 0.005 65)' : opt.value === 'public' ? 'oklch(0.75 0.15 145)' : 'oklch(0.75 0.15 220)'
                        : 'oklch(0.45 0.01 264)',
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Headshot */}
            <div>
              <label style={LABEL_STYLE}>Headshot</label>
              <div className="flex gap-1 mb-3">
                {(['url', 'upload'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setHeadshotMode(mode)}
                    className="px-3 py-1 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                    style={{
                      fontFamily: 'Rajdhani, sans-serif',
                      background: headshotMode === mode ? 'oklch(0.769 0.188 70.08 / 0.15)' : 'oklch(0.15 0.01 264)',
                      border: headshotMode === mode ? '1px solid oklch(0.769 0.188 70.08 / 0.4)' : '1px solid oklch(1 0 0 / 0.08)',
                      color: headshotMode === mode ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.45 0.01 264)',
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
                      alt="Headshot preview"
                      className="w-full h-full object-cover object-top"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <ImagePlus size={20} style={{ color: 'oklch(0.3 0.01 264)' }} />
                  )}
                </div>

                <div className="flex-1">
                  {headshotMode === 'url' ? (
                    <input
                      type="url"
                      value={headshotUrl}
                      onChange={(e) => setHeadshotUrl(e.target.value)}
                      placeholder="https://images.example.com/headshot.webp"
                      style={{ ...FIELD_STYLE, resize: undefined }}
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
                        {isUploading ? 'Uploading...' : uploadedFile ? 'Change File' : 'Choose Image'}
                      </button>
                      {uploadedFile && !isUploading && (
                        <p className="mt-2 text-[11px]" style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          color: uploadedHeadshotUrl ? 'oklch(0.65 0.15 145)' : 'oklch(0.55 0.01 264)',
                        }}>
                          {uploadedHeadshotUrl ? '✓ Uploaded: ' : ''}{uploadedFile.name}
                        </p>
                      )}
                      {isUploading && (
                        <p className="mt-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.769 0.188 70.08)' }}>
                          Uploading image...
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Backstory */}
            <div>
              <label style={LABEL_STYLE}>Backstory</label>
              <textarea
                value={backstory}
                onChange={(e) => setBackstory(e.target.value)}
                placeholder="Character backstory, personality, and motivations..."
                rows={5}
                style={FIELD_STYLE}
                onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
                onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
              />
            </div>

            {/* Appearance */}
            <div>
              <label style={LABEL_STYLE}>Appearance</label>
              <textarea
                value={appearance}
                onChange={(e) => setAppearance(e.target.value)}
                placeholder="Physical description, clothing, distinguishing features..."
                rows={4}
                style={FIELD_STYLE}
                onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
                onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
              />
            </div>

          </div>

          {/* Footer */}
          <div
            className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4"
            style={{ borderTop: '1px solid oklch(1 0 0 / 0.08)' }}
          >
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all"
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
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50 hover:brightness-110"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.769 0.188 70.08 / 0.15)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.5)',
                color: 'oklch(0.769 0.188 70.08)',
              }}
            >
              {isSubmitting
                ? (isEditMode ? 'Saving...' : 'Creating...')
                : (isEditMode ? 'Save Changes' : 'Create Character')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (!base64) reject(new Error('Failed to encode file'));
      else resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
