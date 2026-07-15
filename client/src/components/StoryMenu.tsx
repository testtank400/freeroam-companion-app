// StoryMenu.tsx
// Slide-down story menu overlay for the StoryReader.
// Top-level tabs: Story | Journal
// Journal sub-tabs: Summary | State | Threads | Preferences (placeholder)

import { ApiWorld } from '@/components/WorldCard';
import { trpc } from '@/lib/trpc';
import { getFreeroamAuthHeaders } from '@/lib/freeroamHeaders';
import { Heart, MessageCircle, Bookmark, Share2, RotateCcw, RefreshCw, Pencil, ChevronDown, Check, X as XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

type BookmarkEntry = {
  panel_external_id: string;
  depth: number;
  image_url: string;
  type: 'bookmark' | 'progress';
};

type Tag = {
  id: number;
  name: string;
  is_fandom: boolean;
  emoji: string | null;
};

type RelatedWorld = {
  external_id: string;
  name: string;
  logline: string;
  cover_image_url: string | null;
  owner: { username: string; is_verified: boolean; avatar_url: string | null };
  interaction_count: number;
  tag_name: string;
  tag_is_fandom: boolean;
};

type Chapter = {
  chapter_number: number;
  panel_external_id: string;
  image_url: string;
};

type CompressedSummary = {
  type: string;
  level: number;
  chapter_numbers: number[];
  content: string;
};

type EntityCharacter = {
  name: string;
  state: string;
  appearance: string;
  display_headshot_url: string;
  headshot_url: string;
};

type EntityLocation = {
  name: string;
  description: string;
  position: string;
};

type EntityMisc = {
  name: string;
  description: string;
  state: string;
};

type NarrativeThread = {
  id: string;
  title: string;
  importance: string;
  status: string;
  notes: string[];
};

interface StoryMenuProps {
  isOpen: boolean;
  onClose: () => void;
  world: ApiWorld;
  currentDepth: number;
  totalDepth?: number;
  progressPanel: BookmarkEntry | null;
  bookmarks: BookmarkEntry[];
  chapters: Chapter[];
  tags: Tag[];
  relatedWorlds: RelatedWorld[];
  // Journal data
  journalSummary?: string | null;
  compressedSummaries?: CompressedSummary[];
  canEditSummary?: boolean;
  entityCharacters?: EntityCharacter[];
  entityLocations?: EntityLocation[];
  entityMisc?: EntityMisc[];
  narrativeThreads?: NarrativeThread[];
  currentPanelId?: string;
  onNavigateToPanel: (panelId: string) => void;
  onNavigateToDepth?: (depth: number) => void;
  onRemoveBookmark: (panelId: string) => void;
  // Like state
  isLiked?: boolean;
  likeCount?: number;
  onToggleLike?: () => void;
  onRestart?: () => void;
  /** Freeroam: rebuild starting scene / story branch (not the panel image) */
  onRegenerate?: () => void;
}

const LORA = 'Outfit-Medium, Outfit, sans-serif';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function ThumbnailCard({ imageUrl, label, sublabel, onRemove, onClick }: {
  imageUrl: string; label: string; sublabel: string; onRemove?: () => void; onClick: () => void;
}) {
  return (
    <div className="relative flex-shrink-0 cursor-pointer transition-all hover:brightness-110" style={{ width: '100px' }} onClick={onClick}>
      <div className="w-full rounded-lg overflow-hidden" style={{ aspectRatio: '9/16', background: 'rgba(255,255,255,0.05)' }}>
        {imageUrl && <img src={imageUrl} alt="" className="w-full h-full object-cover" />}
      </div>
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute top-1.5 right-1.5 flex items-center justify-center rounded-full" style={{ width: '20px', height: '20px', background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.85)' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
      )}
      <div className="mt-2 px-0.5">
        <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{label}</p>
        <p style={{ fontFamily: LORA, fontSize: '10px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{sublabel}</p>
      </div>
    </div>
  );
}

// ─── Journal sub-views ────────────────────────────────────────────────────────

function JournalSummary({
  compressedSummaries,
  canEdit,
  worldId,
}: {
  compressedSummaries: CompressedSummary[];
  canEdit?: boolean;
  worldId: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const editSummaryMutation = trpc.worlds.editSummary.useMutation();

  const enterEdit = () => {
    setDrafts(compressedSummaries.map(s => s.content));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDrafts([]);
    setIsEditing(false);
  };

  const saveEdit = async () => {
    setIsSaving(true);
    try {
      const dirtyBlocks = compressedSummaries
        .map((s, i) => ({ index: i, original: s.content, draft: drafts[i] }))
        .filter(b => b.draft !== b.original);
      if (dirtyBlocks.length === 0) { setIsEditing(false); return; }
      await Promise.all(
        dirtyBlocks.map(b => editSummaryMutation.mutateAsync({ worldId, summary: b.draft, blockIndex: b.index }))
      );
      // Update local content with saved values
      dirtyBlocks.forEach(b => { compressedSummaries[b.index].content = b.draft; });
      toast.success('Summary saved.');
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save summary');
    } finally {
      setIsSaving(false);
    }
  };

  if (!compressedSummaries || compressedSummaries.length === 0) {
    return <p style={{ fontFamily: LORA, fontSize: '14px', fontStyle: 'italic', color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '24px 0' }}>No summary yet.</p>;
  }

  return (
    <div>
      {canEdit && !isEditing && (
        <div className="flex justify-center mb-4">
          <button onClick={enterEdit} className="flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:brightness-125" style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)' }}>
            <Pencil size={13} strokeWidth={2} /> Edit
          </button>
        </div>
      )}
      <div className="space-y-5">
        {compressedSummaries.map((s, i) => {
          const min = Math.min(...s.chapter_numbers);
          const max = Math.max(...s.chapter_numbers);
          const label = min === max ? `Chapter ${min}` : `Chapters ${min}–${max}`;
          return (
            <div key={i}>
              <p style={{ fontFamily: LORA, fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{label}</p>
              {isEditing ? (
                <textarea
                  value={drafts[i] ?? s.content}
                  onChange={(e) => { const next = [...drafts]; next[i] = e.target.value; setDrafts(next); }}
                  rows={6}
                  style={{ width: '100%', fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '12px', lineHeight: 1.6, resize: 'vertical', outline: 'none' }}
                />
              ) : (
                <p style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>{s.content}</p>
              )}
            </div>
          );
        })}
      </div>
      {isEditing && (
        <div className="flex items-center gap-3 mt-5">
          <button onClick={cancelEdit} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:brightness-125 disabled:opacity-50" style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.65)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <XIcon size={13} strokeWidth={2} /> Cancel
          </button>
          <button onClick={saveEdit} disabled={isSaving} className="flex items-center gap-2 px-5 py-2 rounded-full transition-all hover:brightness-125 disabled:opacity-50" style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: '#fff', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}>
            <Check size={13} strokeWidth={2.5} /> {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

function JournalPreferences() {
  const [prefs, setPrefs] = useState<{
    language: string;
    image_content_setting: string;
    writing_content_setting: string;
    story_preferences: string;
    show_choice_ideas_by_default: boolean | null;
  } | null>(null);
  const [draft, setDraft] = useState<typeof prefs>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const updateMutation = trpc.preferences.update.useMutation();
  const setSettingMutation = trpc.voice.setSetting.useMutation();
  const { data: unrestrictedImagesData, refetch: refetchUnrestrictedImages } = trpc.voice.getSetting.useQuery({ key: 'unrestricted_images' });
  const unrestrictedImages = unrestrictedImagesData === 'true';

  // Load preferences on mount
  useState(() => {
        const params = encodeURIComponent(JSON.stringify({ '0': { json: {} } }));
    fetch(`/api/trpc/preferences.get?batch=1&input=${params}`, {
      credentials: 'include',
      headers: {
          ...getFreeroamAuthHeaders(),
        },
    })
      .then(r => r.json())
      .then(json => {
        const data = json?.[0]?.result?.data?.json;
        if (data) { setPrefs(data); setDraft(data); }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  });

  const handleChange = (field: string, value: string | boolean | null) => {
    setDraft(prev => prev ? { ...prev, [field]: value } : prev);
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync(draft);
      setPrefs(draft);
      setIsDirty(false);
      toast.success('Preferences saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const CONTENT_OPTIONS = [{ value: 'standard', label: 'Standard' }, { value: 'permissive', label: 'Permissive' }];
  const LANGUAGE_OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'it', label: 'Italiano' },
    { value: 'pt', label: 'Português' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'zh', label: '中文' },
  ];
  const STORY_PREFS_LIMIT = 2000;
  const storyPrefsLen = draft?.story_preferences?.length ?? 0;
  const storyPrefsPct = storyPrefsLen / STORY_PREFS_LIMIT;
  const storyPrefsColor = storyPrefsPct >= 1 ? 'oklch(0.65 0.22 25)' : storyPrefsPct >= 0.9 ? 'oklch(0.769 0.188 70.08)' : 'rgba(255,255,255,0.35)';

  if (isLoading) {
    return <p style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '24px 0' }}>Loading preferences...</p>;
  }
  if (!draft) {
    return <p style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '24px 0' }}>Could not load preferences.</p>;
  }

  return (
    <div className="space-y-5">
      <p style={{ fontFamily: LORA, fontSize: '11px', fontStyle: 'italic', color: 'rgba(255,255,255,0.3)', marginBottom: '4px' }}>
        These are global preferences that apply to all your stories on Freeroam.
      </p>

      {/* Language dropdown */}
      <div>
        <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Language</p>
        <select
          value={draft.language}
          onChange={(e) => handleChange('language', e.target.value)}
          style={{ width: '100%', fontFamily: LORA, fontSize: '14px', color: '#fff', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '10px 14px', outline: 'none', cursor: 'pointer' }}
        >
          {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value} style={{ background: '#1a1a2e' }}>{l.label}</option>)}
        </select>
      </div>

      {/* Image content setting */}
      <div>
        <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Images</p>
        <div className="flex gap-2 flex-wrap">
          {CONTENT_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => handleChange('image_content_setting', opt.value)}
              className="px-4 py-2 rounded-full transition-all"
              style={{ fontFamily: LORA, fontSize: '13px', color: draft.image_content_setting === opt.value ? '#fff' : 'rgba(255,255,255,0.45)', background: draft.image_content_setting === opt.value ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)', border: `1px solid ${draft.image_content_setting === opt.value ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'}` }}>
              {opt.label}
            </button>
          ))}
          {/* Unrestricted — local setting that enables Seedream NSFW image generation */}
          <button
            onClick={() => { setSettingMutation.mutateAsync({ key: 'unrestricted_images', value: (!unrestrictedImages).toString() }).then(() => refetchUnrestrictedImages()); }}
            className="px-4 py-2 rounded-full transition-all"
            style={{ fontFamily: LORA, fontSize: '13px', color: unrestrictedImages ? '#fff' : 'rgba(255,255,255,0.45)', background: unrestrictedImages ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.06)', border: `1px solid ${unrestrictedImages ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.1)'}` }}>
            Unrestricted
          </button>
        </div>
      </div>

      {/* Writing content setting */}
      <div>
        <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Writing</p>
        <div className="flex gap-2 flex-wrap">
          {CONTENT_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => handleChange('writing_content_setting', opt.value)}
              className="px-4 py-2 rounded-full transition-all"
              style={{ fontFamily: LORA, fontSize: '13px', color: draft.writing_content_setting === opt.value ? '#fff' : 'rgba(255,255,255,0.45)', background: draft.writing_content_setting === opt.value ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)', border: `1px solid ${draft.writing_content_setting === opt.value ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'}` }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Show choice ideas toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Show choice ideas by default</p>
          <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', marginTop: '3px' }}>When on, the in-story "Ideas" panel starts expanded.</p>
        </div>
        <button
          onClick={() => handleChange('show_choice_ideas_by_default', draft.show_choice_ideas_by_default === true ? false : true)}
          className="relative flex-shrink-0 rounded-full transition-all"
          style={{ width: '44px', height: '24px', background: draft.show_choice_ideas_by_default ? '#5eead4' : 'rgba(255,255,255,0.18)', border: 'none', transition: 'background 0.2s ease' }}
        >
          <div style={{ position: 'absolute', top: '3px', left: draft.show_choice_ideas_by_default ? '22px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s ease' }} />
        </button>
      </div>

      {/* Content settings disclaimer */}
      <p style={{ fontFamily: LORA, fontSize: '12px', fontStyle: 'italic', color: 'rgba(255,255,255,0.3)' }}>
        These settings guide generation, but aren’t perfect. Content may occasionally vary.
      </p>

      {/* Story preferences textarea */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Story Preferences</p>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: storyPrefsColor, fontWeight: storyPrefsPct >= 0.9 ? 700 : 400 }}>
            {storyPrefsLen.toLocaleString()} / {STORY_PREFS_LIMIT.toLocaleString()}
            {storyPrefsLen > STORY_PREFS_LIMIT && <span style={{ marginLeft: 4, color: 'oklch(0.65 0.22 25)' }}>⚠ over limit</span>}
          </span>
        </div>
        <textarea
          value={draft.story_preferences}
          onChange={(e) => handleChange('story_preferences', e.target.value)}
          rows={10}
          style={{ width: '100%', fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.06)', border: `1px solid ${storyPrefsLen > STORY_PREFS_LIMIT ? 'oklch(0.65 0.22 25 / 0.5)' : 'rgba(255,255,255,0.15)'}`, borderRadius: '10px', padding: '12px', lineHeight: 1.6, resize: 'vertical', outline: 'none' }}
        />
      </div>

      {/* Save button */}
      {isDirty && (
        <div className="flex items-center gap-3">
          <button onClick={() => { setDraft(prefs); setIsDirty(false); }} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:brightness-125 disabled:opacity-50" style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.65)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <XIcon size={13} strokeWidth={2} /> Cancel
          </button>
          <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-5 py-2 rounded-full transition-all hover:brightness-125 disabled:opacity-50" style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: '#fff', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}>
            <Check size={13} strokeWidth={2.5} /> {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Voice Settings — stored in app_settings DB */}
      <VoiceSettings />
    </div>
  );
}

function VoiceSettings() {
  const { data: voiceEnabledData, refetch: refetchVoiceEnabled } = trpc.voice.getSetting.useQuery({ key: 'voice_enabled' });
  const { data: autoPlayData, refetch: refetchAutoPlay } = trpc.voice.getSetting.useQuery({ key: 'auto_play_enabled' });
  const { data: autoAdvanceData, refetch: refetchAutoAdvance } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_enabled' });
  const { data: readingSpeedData, refetch: refetchReadingSpeed } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_reading_speed' });
  const { data: minDelayData, refetch: refetchMinDelay } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_min_delay' });
  const { data: staticDelayData, refetch: refetchStaticDelay } = trpc.voice.getSetting.useQuery({ key: 'auto_advance_static_delay' });
  const { data: narratorVoiceData, refetch: refetchNarratorVoice } = trpc.voice.getSetting.useQuery({ key: 'narrator_voice_id' });
  const { data: debugModeData, refetch: refetchDebugMode } = trpc.voice.getSetting.useQuery({ key: 'debug_mode' });
  const { data: unrestrictedImagesData, refetch: refetchUnrestrictedImages } = trpc.voice.getSetting.useQuery({ key: 'unrestricted_images' });
  const { data: narratorVoiceNameData, refetch: refetchNarratorVoiceName } = trpc.voice.getSetting.useQuery({ key: 'narrator_voice_name' });
  const { data: voices } = trpc.voice.listVoices.useQuery();
  const setSettingMutation = trpc.voice.setSetting.useMutation();
  const clearCacheMutation = trpc.voice.clearVoiceCache.useMutation();
  const clearImageCacheMutation = trpc.voice.clearImageCache.useMutation();
  const [showNarratorPicker, setShowNarratorPicker] = useState(false);
  const [narratorSearch, setNarratorSearch] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isClearingImages, setIsClearingImages] = useState(false);
  const [confirmClearImages, setConfirmClearImages] = useState(false);

  const voiceEnabled = voiceEnabledData !== 'false';
  const autoPlayEnabled = autoPlayData !== 'false';
  const autoAdvanceEnabled = autoAdvanceData === 'true';
  const readingSpeed = parseFloat(readingSpeedData ?? '1.0');
  const minDelay = parseFloat(minDelayData ?? '2');
  const staticDelay = parseFloat(staticDelayData ?? '3');
  const narratorVoiceId = narratorVoiceData ?? null;
  const narratorVoiceName = narratorVoiceNameData ?? null;
  const debugMode = debugModeData === 'true';
  const unrestrictedImages = unrestrictedImagesData === 'true';

  const toggle = async (key: string, currentValue: boolean, refetch: () => void) => {
    await setSettingMutation.mutateAsync({ key, value: (!currentValue).toString() });
    refetch();
  };

  const filteredVoices = (voices ?? []).filter(v =>
    v.name.toLowerCase().includes(narratorSearch.toLowerCase())
  );

  const handleClearCache = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setIsClearing(true);
    try {
      await clearCacheMutation.mutateAsync({});
      toast.success('Voice cache cleared.');
    } catch {
      toast.error('Failed to clear cache.');
    } finally {
      setIsClearing(false);
      setConfirmClear(false);
    }
  };

  const handleClearImageCache = async () => {
    if (!confirmClearImages) { setConfirmClearImages(true); return; }
    setIsClearingImages(true);
    try {
      await clearImageCacheMutation.mutateAsync();
      toast.success('Image cache cleared.');
    } catch {
      toast.error('Failed to clear image cache.');
    } finally {
      setIsClearingImages(false);
      setConfirmClearImages(false);
    }
  };

  return (
    <div className="space-y-4">
      <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Voice Settings</p>

      {/* Voice enabled toggle */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Voice Generation</p>
          <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Generate and play character voices in the reader</p>
        </div>
        <button onClick={() => toggle('voice_enabled', voiceEnabled, refetchVoiceEnabled)} className="flex-shrink-0 rounded-full transition-all" style={{ width: '44px', height: '24px', background: voiceEnabled ? '#5eead4' : 'rgba(255,255,255,0.15)', position: 'relative', border: 'none', cursor: 'pointer' }}>
          <span style={{ position: 'absolute', top: '2px', left: voiceEnabled ? '22px' : '2px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease' }} />
        </button>
      </div>

      {/* Auto-play toggle */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Auto-play Voice</p>
          <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Automatically play voice when a panel loads</p>
        </div>
        <button onClick={() => toggle('auto_play_enabled', autoPlayEnabled, refetchAutoPlay)} className="flex-shrink-0 rounded-full transition-all" style={{ width: '44px', height: '24px', background: autoPlayEnabled ? '#5eead4' : 'rgba(255,255,255,0.15)', position: 'relative', border: 'none', cursor: 'pointer', opacity: voiceEnabled ? 1 : 0.4 }} disabled={!voiceEnabled}>
          <span style={{ position: 'absolute', top: '2px', left: autoPlayEnabled ? '22px' : '2px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease' }} />
        </button>
      </div>

      {/* Narrator voice */}
      <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Narrator Voice</p>
            <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Voice used for narration panels</p>
          </div>
          <button
            onClick={() => setShowNarratorPicker(v => !v)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all hover:brightness-125"
            style={{ fontFamily: LORA, fontSize: '12px', color: narratorVoiceId ? '#a78bfa' : 'rgba(255,255,255,0.5)', background: narratorVoiceId ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.08)', border: `1px solid ${narratorVoiceId ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.12)'}`, cursor: 'pointer' }}
          >
            {narratorVoiceName ?? 'Not set'}
          </button>
        </div>
        {showNarratorPicker && (
          <div>
            <input
              type="text"
              value={narratorSearch}
              onChange={e => setNarratorSearch(e.target.value)}
              placeholder="Search voices..."
              className="w-full outline-none rounded-lg px-3 py-2 mb-2"
              style={{ fontFamily: LORA, fontSize: '13px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
              {narratorVoiceId && (
                <button
                  onClick={async () => {
                    await setSettingMutation.mutateAsync({ key: 'narrator_voice_id', value: null });
                    await setSettingMutation.mutateAsync({ key: 'narrator_voice_name', value: null });
                    refetchNarratorVoice(); refetchNarratorVoiceName();
                    setShowNarratorPicker(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 mb-1 transition-all hover:brightness-125"
                  style={{ fontFamily: LORA, fontSize: '13px', color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)', cursor: 'pointer' }}
                >
                  Remove narrator voice
                </button>
              )}
              {filteredVoices.slice(0, 30).map(v => (
                <button
                  key={v.voice_id}
                  onClick={async () => {
                    await setSettingMutation.mutateAsync({ key: 'narrator_voice_id', value: v.voice_id });
                    await setSettingMutation.mutateAsync({ key: 'narrator_voice_name', value: v.name });
                    refetchNarratorVoice(); refetchNarratorVoiceName();
                    setShowNarratorPicker(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 mb-1 transition-all hover:brightness-125"
                  style={{ fontFamily: LORA, fontSize: '13px', color: v.voice_id === narratorVoiceId ? '#a78bfa' : 'rgba(255,255,255,0.8)', background: v.voice_id === narratorVoiceId ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${v.voice_id === narratorVoiceId ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}
                >
                  {v.name} <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>{v.category}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Auto-Advance section */}
      <div className="rounded-xl px-4 py-3 space-y-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Auto-advance toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Auto-Advance Panels</p>
            <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Automatically go to the next panel after voice or timer</p>
          </div>
          <button onClick={() => toggle('auto_advance_enabled', autoAdvanceEnabled, refetchAutoAdvance)} className="flex-shrink-0 rounded-full transition-all" style={{ width: '44px', height: '24px', background: autoAdvanceEnabled ? '#5eead4' : 'rgba(255,255,255,0.15)', position: 'relative', border: 'none', cursor: 'pointer' }}>
            <span style={{ position: 'absolute', top: '2px', left: autoAdvanceEnabled ? '22px' : '2px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease' }} />
          </button>
        </div>

        {autoAdvanceEnabled && (
          <div className="space-y-3" style={{ opacity: 1 }}>
            {/* Reading speed */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>Reading Speed</p>
                <p style={{ fontFamily: LORA, fontSize: '12px', color: '#a78bfa' }}>{readingSpeed === 0.5 ? 'Slow' : readingSpeed === 1.0 ? 'Normal' : readingSpeed === 1.5 ? 'Fast' : readingSpeed === 2.0 ? 'Very Fast' : `${readingSpeed}x`}</p>
              </div>
              <input type="range" min="0.5" max="2.0" step="0.5" value={readingSpeed}
                onChange={async (e) => { await setSettingMutation.mutateAsync({ key: 'auto_advance_reading_speed', value: e.target.value }); refetchReadingSpeed(); }}
                className="w-full" style={{ accentColor: '#a78bfa' }}
              />
              <p style={{ fontFamily: LORA, fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>Used when no voice clip is available</p>
            </div>

            {/* Minimum delay */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>Minimum Delay</p>
                <p style={{ fontFamily: LORA, fontSize: '12px', color: '#a78bfa' }}>{minDelay}s</p>
              </div>
              <input type="range" min="0" max="10" step="0.5" value={minDelay}
                onChange={async (e) => { await setSettingMutation.mutateAsync({ key: 'auto_advance_min_delay', value: e.target.value }); refetchMinDelay(); }}
                className="w-full" style={{ accentColor: '#a78bfa' }}
              />
              <p style={{ fontFamily: LORA, fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>Minimum wait before advancing (even after voice ends)</p>
            </div>

            {/* Static delay for image-only panels */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>Image-Only Panels</p>
                <p style={{ fontFamily: LORA, fontSize: '12px', color: '#a78bfa' }}>{staticDelay}s</p>
              </div>
              <input type="range" min="1" max="15" step="0.5" value={staticDelay}
                onChange={async (e) => { await setSettingMutation.mutateAsync({ key: 'auto_advance_static_delay', value: e.target.value }); refetchStaticDelay(); }}
                className="w-full" style={{ accentColor: '#a78bfa' }}
              />
              <p style={{ fontFamily: LORA, fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>Wait time for panels with no text or voice</p>
            </div>
          </div>
        )}
      </div>

      {/* Other settings header */}
      <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Other</p>

      {/* Debug mode toggle */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Debug Mode</p>
          <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Show panel state overlay in the reader (forward_state, polling, etc.)</p>
        </div>
        <button onClick={() => toggle('debug_mode', debugMode, refetchDebugMode)} className="flex-shrink-0 rounded-full transition-all" style={{ width: '44px', height: '24px', background: debugMode ? '#f59e0b' : 'rgba(255,255,255,0.15)', position: 'relative', border: 'none', cursor: 'pointer' }}>
          <span style={{ position: 'absolute', top: '2px', left: debugMode ? '22px' : '2px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
      </div>

      {/* Clear voice cache */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Clear Voice Cache</p>
          <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Delete all cached audio — useful after changing voices</p>
        </div>
        <button
          onClick={handleClearCache}
          disabled={isClearing}
          className="flex-shrink-0 rounded-full px-3 py-1.5 transition-all hover:brightness-125 disabled:opacity-50"
          style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 600, color: confirmClear ? '#fff' : '#f87171', background: confirmClear ? '#ef4444' : 'rgba(248,113,113,0.1)', border: `1px solid ${confirmClear ? '#ef4444' : 'rgba(248,113,113,0.2)'}`, cursor: 'pointer' }}
        >
          {isClearing ? 'Clearing...' : confirmClear ? 'Confirm Clear' : 'Clear Cache'}
        </button>
      </div>

      {/* Clear image cache */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <p style={{ fontFamily: LORA, fontSize: '14px', color: '#fff', marginBottom: '2px' }}>Clear Image Cache</p>
          <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Delete all generated NSFW images — useful after prompt changes</p>
        </div>
        <button
          onClick={handleClearImageCache}
          disabled={isClearingImages}
          className="flex-shrink-0 rounded-full px-3 py-1.5 transition-all hover:brightness-125 disabled:opacity-50"
          style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 600, color: confirmClearImages ? '#fff' : '#f87171', background: confirmClearImages ? '#ef4444' : 'rgba(248,113,113,0.1)', border: `1px solid ${confirmClearImages ? '#ef4444' : 'rgba(248,113,113,0.2)'}`, cursor: 'pointer' }}
        >
          {isClearingImages ? 'Clearing...' : confirmClearImages ? 'Confirm Clear' : 'Clear Cache'}
        </button>
      </div>
    </div>
  );
}

function JournalState({ characters, locations, misc }: { characters: EntityCharacter[]; locations: EntityLocation[]; misc: EntityMisc[] }) {
  return (
    <div className="space-y-6">
      {characters.length > 0 && (
        <div>
          <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>Characters</p>
          <div className="space-y-3">
            {characters.map((c) => (
              <div key={c.name} className="flex gap-3 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {c.display_headshot_url && (
                  <img src={c.display_headshot_url} alt={c.name} className="flex-shrink-0 rounded-full object-cover" style={{ width: '44px', height: '44px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <div className="flex-1 min-w-0">
                  <p style={{ fontFamily: LORA, fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>{c.name}</p>
                  <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{c.state}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {locations.length > 0 && (
        <div>
          <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>Locations</p>
          <div className="space-y-3">
            {locations.map((l) => (
              <div key={l.name} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p style={{ fontFamily: LORA, fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>{l.name}</p>
                <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{l.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {misc.length > 0 && (
        <div>
          <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>Other</p>
          <div className="space-y-3">
            {misc.map((m) => (
              <div key={m.name} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p style={{ fontFamily: LORA, fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>{m.name}</p>
                <p style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JournalThreads({ threads }: { threads: NarrativeThread[] }) {
  if (!threads || threads.length === 0) {
    return <p style={{ fontFamily: LORA, fontSize: '14px', fontStyle: 'italic', color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '24px 0' }}>No threads yet.</p>;
  }
  const major = threads.filter(t => t.importance === 'major');
  const minor = threads.filter(t => t.importance !== 'major');
  const renderGroup = (group: NarrativeThread[], label: string) => (
    <div className="space-y-5">
      {group.map((t) => (
        <div key={t.id}>
          <p style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 700, color: t.importance === 'major' ? 'rgba(251,191,36,0.8)' : 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '4px' }}>{label}</p>
          <p style={{ fontFamily: LORA, fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>{t.title}</p>
          <ul className="space-y-1.5 pl-3" style={{ borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
            {t.notes.map((note, i) => (
              <li key={i} style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>{note}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-8">
      {major.length > 0 && renderGroup(major, 'Major')}
      {minor.length > 0 && renderGroup(minor, 'Minor')}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StoryMenu({
  isOpen, onClose, world, currentDepth, totalDepth,
  progressPanel, bookmarks, chapters, tags, relatedWorlds,
  journalSummary, compressedSummaries = [], canEditSummary, entityCharacters = [], entityLocations = [], entityMisc = [], narrativeThreads = [],
  currentPanelId, onNavigateToPanel, onNavigateToDepth, onRemoveBookmark,
  isLiked = false, likeCount, onToggleLike,
  onRestart,
  onRegenerate,
}: StoryMenuProps) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const allBookmarkEntries: BookmarkEntry[] = [
    ...(progressPanel ? [progressPanel] : []),
    ...bookmarks,
  ];

  // Page slider state — sync with currentDepth when menu opens or depth changes
  const maxDepth = totalDepth ?? progressPanel?.depth ?? currentDepth;
  const [sliderInput, setSliderInput] = useState<number>(currentDepth > 0 ? currentDepth : 1);
  const [isNavigatingToDepth, setIsNavigatingToDepth] = useState(false);
  const isDraggingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);

  // Sync slider input when menu opens or current depth changes
  const prevIsOpen = useRef(false);
  if (isOpen && !prevIsOpen.current && currentDepth > 0) {
    setSliderInput(currentDepth);
  }
  prevIsOpen.current = isOpen;

  const inputChanged = sliderInput !== currentDepth;

  const handleGoToDepth = async () => {
    if (!onNavigateToDepth || isNavigatingToDepth || !inputChanged) return;
    setIsNavigatingToDepth(true);
    try {
      await onNavigateToDepth(sliderInput);
    } finally {
      setIsNavigatingToDepth(false);
    }
  };

  const getDepthFromEvent = (clientX: number): number => {
    if (!trackRef.current) return sliderInput;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.max(1, Math.round(pct * maxDepth));
  };

  const handleTrackMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    setSliderInput(getDepthFromEvent(e.clientX));
    const onMove = (me: MouseEvent) => {
      if (isDraggingRef.current) setSliderInput(getDepthFromEvent(me.clientX));
    };
    const onUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleTrackTouchStart = (e: React.TouchEvent) => {
    e.preventDefault(); // Prevent text/image selection in the background while dragging
    isDraggingRef.current = true;
    setSliderInput(getDepthFromEvent(e.touches[0].clientX));
    const onMove = (te: TouchEvent) => {
      te.preventDefault(); // Prevent scroll/selection during drag
      if (isDraggingRef.current) setSliderInput(getDepthFromEvent(te.touches[0].clientX));
    };
    const onEnd = () => {
      isDraggingRef.current = false;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: false }); // passive:false so preventDefault works
    window.addEventListener('touchend', onEnd);
  };

  const [topTab, setTopTab] = useState<'story' | 'journal'>('story');
  const [journalTab, setJournalTab] = useState<'summary' | 'state' | 'threads' | 'preferences'>('summary');

  // Portal to document.body so the menu spans the full viewport (like Freeroam),
  // not the 9:16 story-reader-panel it is rendered under.
  //
  // Glass uses a fixed full-viewport layer (no transform). Slide is content-only
  // so backdrop-filter can actually sample the story underneath.
  const menu = (
    <>
      {/* Frosted glass backdrop — full viewport, only when open */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 209,
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: 'none',
          // Lighter scrim so blur of the story art is actually visible
          background: 'rgba(12, 12, 20, 0.38)',
          backdropFilter: 'blur(40px) saturate(1.35)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.35)',
        }}
      />
      {/* Menu content sheet — slides; intentionally no backdrop-filter here */}
      <div
        className="fixed left-0 right-0 z-[210] overflow-y-auto"
        style={{
          top: isOpen ? 0 : '-100%',
          width: '100vw',
          maxWidth: '100vw',
          maxHeight: '100dvh',
          transition: 'top 0.25s ease',
          background: 'transparent',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        <div className="mx-auto px-5 pt-4 pb-8" style={{ width: '100%', maxWidth: '960px' }}>

          {/* Close pill */}
          <div className="flex justify-center mb-3">
            <button onClick={onClose} className="flex items-center justify-center rounded-full transition-all hover:bg-white/10" style={{ width: '36px', height: '36px', color: 'rgba(255,255,255,0.45)' }}>
              <ChevronDown size={22} strokeWidth={2} />
            </button>
          </div>

          {/* Top-level tabs: Story | Journal */}
          <div className="flex items-center justify-center gap-8 mb-5">
            {(['story', 'journal'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setTopTab(tab)}
                style={{
                  fontFamily: LORA,
                  fontSize: '16px',
                  fontWeight: topTab === tab ? 700 : 400,
                  color: topTab === tab ? '#fff' : 'rgba(255,255,255,0.45)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  paddingBottom: '6px',
                  borderBottom: topTab === tab ? '2px solid #fff' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── STORY TAB ─────────────────────────────────────────────────── */}
          {topTab === 'story' && (
            <>
              {/* World header */}
              <div className="text-center mb-5">
                <h2 style={{ fontFamily: LORA, fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>{world.name}</h2>
                <p style={{ fontFamily: LORA, fontSize: '14px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>by {world.owner.username}</p>
              </div>

              {/* Action icon row */}
              <div className="flex items-center justify-center gap-8 mb-6">
                {/* Like button — wired */}
                <button
                  onClick={onToggleLike ?? (() => toast('Like — coming soon'))}
                  className="flex flex-col items-center gap-1.5 transition-all hover:brightness-125"
                  style={{ color: isLiked ? '#f87171' : 'rgba(255,255,255,0.65)' }}
                >
                  <Heart size={20} strokeWidth={2} fill={isLiked ? '#f87171' : 'none'} />
                  <span style={{ fontFamily: LORA, fontSize: '11px', fontStyle: 'italic', color: isLiked ? '#f87171' : 'rgba(255,255,255,0.4)' }}>
                    {likeCount !== undefined ? likeCount.toLocaleString() : 'Like'}
                  </span>
                </button>
                {[
                  { icon: <MessageCircle size={20} strokeWidth={2} />, label: 'Comment' },
                  { icon: <Bookmark size={20} strokeWidth={2} />, label: 'Save' },
                  { icon: <Share2 size={20} strokeWidth={2} />, label: 'Share' },
                ].map(({ icon, label }) => (
                  <button key={label} onClick={() => toast(`${label} — coming soon`)} className="flex flex-col items-center gap-1.5 transition-all hover:brightness-125" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    {icon}
                    <span style={{ fontFamily: LORA, fontSize: '11px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                  </button>
                ))}
              </div>

              {/* Page slider */}
              <div className="rounded-2xl px-5 py-4 mb-5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', userSelect: 'none', WebkitUserSelect: 'none' }}>
                {/* Number input row */}
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', flexShrink: 0 }}>Page</span>
                  <input
                    type="number"
                    min={1}
                    max={maxDepth}
                    value={sliderInput}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) setSliderInput(Math.max(1, Math.min(maxDepth, v)));
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleGoToDepth(); }}
                    style={{
                      width: '80px',
                      fontFamily: LORA,
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#fff',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                  <span style={{ fontFamily: LORA, fontSize: '14px', color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>of {maxDepth}</span>
                  {inputChanged && (
                    <button
                      onClick={handleGoToDepth}
                      disabled={isNavigatingToDepth}
                      className="flex items-center justify-center px-3 py-1 rounded-full transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ fontFamily: LORA, fontSize: '13px', fontWeight: 700, color: '#fff', background: '#7c3aed', border: 'none', minWidth: '44px' }}
                    >
                      {isNavigatingToDepth ? '...' : 'Go'}
                    </button>
                  )}
                </div>
                {/* Scrubber track — draggable */}
                <div
                  ref={trackRef}
                  className="relative w-full rounded-full cursor-pointer select-none"
                  style={{ height: '20px', display: 'flex', alignItems: 'center' }}
                  onMouseDown={handleTrackMouseDown}
                  onTouchStart={handleTrackTouchStart}
                >
                  {/* Track background */}
                  <div className="absolute inset-0 rounded-full" style={{ top: '7px', bottom: '7px', height: '6px', background: 'rgba(255,255,255,0.12)' }} />
                  {/* Filled portion */}
                  <div
                    className="absolute rounded-full"
                    style={{ top: '7px', bottom: '7px', height: '6px', left: 0, width: `${Math.min(100, maxDepth > 0 ? (sliderInput / maxDepth) * 100 : 0)}%`, background: inputChanged ? '#7c3aed' : 'rgba(255,255,255,0.65)' }}
                  />
                  {/* Thumb */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full"
                    style={{ left: `calc(${Math.min(100, maxDepth > 0 ? (sliderInput / maxDepth) * 100 : 0)}% - 10px)`, background: inputChanged ? '#7c3aed' : '#fff', boxShadow: '0 0 8px rgba(255,255,255,0.5)', cursor: 'grab' }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
                {/* Restart — wired with confirmation */}
                {!confirmRestart ? (
                  <button
                    onClick={() => setConfirmRestart(true)}
                    className="flex items-center gap-2 rounded-full transition-all hover:brightness-125"
                    style={{ fontFamily: LORA, fontSize: '14px', fontStyle: 'italic', color: 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', padding: '10px 22px', whiteSpace: 'nowrap' }}
                  >
                    <RotateCcw size={15} strokeWidth={2} /> Restart
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }}>Reset to page 1?</span>
                    <button
                      onClick={() => setConfirmRestart(false)}
                      className="px-3 py-1.5 rounded-full transition-all hover:brightness-125"
                      style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { setConfirmRestart(false); onRestart?.(); onClose(); }}
                      className="px-3 py-1.5 rounded-full transition-all hover:brightness-125"
                      style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: '#fff', background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.4)' }}
                    >
                      Restart
                    </button>
                  </div>
                )}
                {/* Regenerate — Freeroam starting scene only (unrestricted panel art is top-bar only) */}
                {!confirmRegenerate ? (
                  <button
                    onClick={() => setConfirmRegenerate(true)}
                    className="flex items-center gap-2 rounded-full transition-all hover:brightness-125"
                    style={{ fontFamily: LORA, fontSize: '14px', fontStyle: 'italic', color: 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', padding: '10px 22px', whiteSpace: 'nowrap' }}
                  >
                    <RefreshCw size={15} strokeWidth={2} /> Regenerate
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }}>Regenerate starting scene?</span>
                    <button
                      onClick={() => setConfirmRegenerate(false)}
                      className="px-3 py-1.5 rounded-full transition-all hover:brightness-125"
                      style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { setConfirmRegenerate(false); onRegenerate?.(); onClose(); }}
                      className="px-3 py-1.5 rounded-full transition-all hover:brightness-125"
                      style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: '#fff', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.4)' }}
                    >
                      Regenerate
                    </button>
                  </div>
                )}
                {/* Edit — placeholder */}
                <button onClick={() => toast('Edit — coming soon')} className="flex items-center gap-2 rounded-full transition-all hover:brightness-125" style={{ fontFamily: LORA, fontSize: '14px', fontStyle: 'italic', color: 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', padding: '10px 22px', whiteSpace: 'nowrap' }}>
                  <Pencil size={15} strokeWidth={2} /> Edit
                </button>
              </div>

              {/* Bookmarks */}
              {allBookmarkEntries.length > 0 && (
                <div className="mb-6">
                  <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>Bookmarks</p>
                  <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {allBookmarkEntries.map((entry) => (
                      <ThumbnailCard key={`${entry.type}-${entry.panel_external_id}`} imageUrl={entry.image_url} label={`Page ${entry.depth}`} sublabel={entry.type === 'progress' ? 'Progress' : 'Bookmark'} onRemove={entry.type === 'bookmark' ? () => onRemoveBookmark(entry.panel_external_id) : undefined} onClick={() => { onNavigateToPanel(entry.panel_external_id); onClose(); }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Chapters */}
              <div className="mb-6">
                <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>Chapters</p>
                {chapters.length === 0 ? (
                  <p style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '12px 0' }}>Chapters will appear here as the story progresses.</p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {[...chapters].sort((a, b) => b.chapter_number - a.chapter_number).map((ch) => (
                      <ThumbnailCard key={ch.chapter_number} imageUrl={ch.image_url} label={`Chapter ${ch.chapter_number}`} sublabel="Chapter" onClick={() => { onNavigateToPanel(ch.panel_external_id); onClose(); }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {tags.map((tag) => (
                    <span key={tag.id} className="px-3 py-1.5 rounded-full text-xs" style={{ fontFamily: LORA, fontStyle: 'italic', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}>
                      {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Related worlds */}
              {relatedWorlds.length > 0 && (
                <div>
                  <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>You May Also Like</p>
                  <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {relatedWorlds.slice(0, 10).map((rw) => (
                      <a key={rw.external_id} href={`https://getfreeroam.com/world/${rw.external_id}`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 rounded-lg overflow-hidden transition-all hover:brightness-110" style={{ width: '120px', textDecoration: 'none' }}>
                        <div className="w-full rounded-lg overflow-hidden" style={{ aspectRatio: '3/4', background: 'rgba(255,255,255,0.05)' }}>
                          {rw.cover_image_url && <img src={rw.cover_image_url} alt={rw.name} className="w-full h-full object-cover" />}
                        </div>
                        <div className="mt-1.5 px-0.5">
                          <p className="line-clamp-2" style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{rw.name}</p>
                          <p style={{ fontFamily: LORA, fontSize: '11px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{formatCount(rw.interaction_count)} reads</p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── JOURNAL TAB ───────────────────────────────────────────────── */}
          {topTab === 'journal' && (
            <>
              {/* Journal sub-tabs */}
              <div className="flex rounded-xl overflow-hidden mb-5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {(['summary', 'state', 'threads', 'preferences'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setJournalTab(tab)}
                    className="flex-1 py-2.5 transition-all"
                    style={{
                      fontFamily: LORA,
                      fontSize: '13px',
                      fontWeight: journalTab === tab ? 700 : 400,
                      color: journalTab === tab ? '#fff' : 'rgba(255,255,255,0.45)',
                      background: journalTab === tab ? 'rgba(255,255,255,0.12)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Journal content */}
              {journalTab === 'summary' && <JournalSummary compressedSummaries={compressedSummaries} canEdit={canEditSummary} worldId={world.external_id} />}
              {journalTab === 'state' && <JournalState characters={entityCharacters} locations={entityLocations} misc={entityMisc} />}
              {journalTab === 'threads' && <JournalThreads threads={narrativeThreads} />}
              {journalTab === 'preferences' && <JournalPreferences />}
            </>
          )}

        </div>
      </div>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(menu, document.body);
}
