/**
 * CharacterPanel — 3-view overlay for managing story characters
 *
 * View 1: Current story characters (main panel)
 * View 2: Character library browser (add character)
 * View 3: Character detail (from library)
 */

import { trpc } from '@/lib/trpc';
import { X, Plus, ArrowLeft, Search, Loader2, Save } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

type StoryCharacter = {
  id: number;
  external_id: string;
  name: string;
  backstory: string;
  appearance: string;
  headshot_url: string;
  display_headshot_url: string | null;
  removable: boolean;
  is_main_character: boolean;
  is_saved: boolean;
  is_yours: boolean;
  creator_name: string;
};

type LibraryCharacter = {
  external_id: string;
  name: string;
  headshot_url: string | null;
  backstory: string;
  appearance: string;
  is_saved?: boolean;
  is_yours?: boolean;
};

type CharacterPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  worldId: string;
  panelId: string;
  onSaveChanges: (addIds: string[], removeIds: string[]) => Promise<void>;
  onPlayAs: (newMainId: string, oldMainId: string, newMainName: string) => Promise<void>;
  onEditCharacter: (
    charId: string,
    charName: string,
    oldBackstory: string,
    newBackstory: string,
    oldAppearance: string,
    newAppearance: string,
    photoChanged?: boolean,
    newHeadshotUrl?: string
  ) => Promise<void>;
};

type PendingChange = {
  type: 'add' | 'remove';
  character: StoryCharacter;
};

export default function CharacterPanel({
  isOpen,
  onClose,
  worldId,
  panelId,
  onSaveChanges,
  onPlayAs,
  onEditCharacter,
}: CharacterPanelProps) {
  const [isPlayingAs, setIsPlayingAs] = useState(false);
  const [pendingPlayAs, setPendingPlayAs] = useState<string | null>(null); // external_id of char to play as
  const [view, setView] = useState<'main' | 'library' | 'detail' | 'story-detail'>('main');
  const [storyChars, setStoryChars] = useState<StoryCharacter[]>([]);
  const [pendingChanges, setPendingChanges] = useState<Map<string, 'add' | 'remove'>>(new Map());
  const [isLoadingChars, setIsLoadingChars] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Library state
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'yours' | 'saved'>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryChars, setLibraryChars] = useState<LibraryCharacter[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);

  // Detail state (library character)
  const [detailChar, setDetailChar] = useState<LibraryCharacter | null>(null);
  // Story character detail state
  const [storyDetailChar, setStoryDetailChar] = useState<StoryCharacter | null>(null);

  const utils = trpc.useUtils();

  // Load story characters when panel opens
  const loadStoryChars = useCallback(async () => {
    if (!panelId) return;
    setIsLoadingChars(true);
    try {
      const data = await utils.worlds.getWorldCharacters.fetch({ worldId, panelId });
      setStoryChars([...data.story_characters, ...data.world_characters]);
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingChars(false);
    }
  }, [worldId, panelId, utils]);

  useEffect(() => {
    if (isOpen) {
      setView('main');
      setPendingChanges(new Map());
      setPendingPlayAs(null);
      loadStoryChars();
    }
  }, [isOpen, loadStoryChars]);

  // Load library characters
  const loadLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const cookie = localStorage.getItem('freeroam_cookie') ?? '';
      const accountId = localStorage.getItem('freeroam_account_id') ?? '';
      const params = encodeURIComponent(JSON.stringify({ '0': { json: {} } }));
      const res = await fetch(`/api/trpc/characters.library?batch=1&input=${params}`, {
        credentials: 'include',
        headers: {
          ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
          ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
        },
      });
      if (!res.ok) return;
      const json = await res.json();
      // characters.library returns an array of character objects directly
      const chars = json?.[0]?.result?.data?.json ?? [];
      // Map to LibraryCharacter shape
      setLibraryChars(chars.map((c: { external_id: string; name: string; headshot_url: string | null; backstory: string | null; is_yours?: boolean; is_saved?: boolean }) => ({
        external_id: c.external_id,
        name: c.name,
        headshot_url: c.headshot_url,
        backstory: c.backstory ?? '',
        appearance: '',
        is_yours: c.is_yours,
        is_saved: c.is_saved,
      })));
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  const handleOpenLibrary = () => {
    setView('library');
    if (libraryChars.length === 0) loadLibrary();
  };

  const handleOpenDetail = (char: LibraryCharacter) => {
    setDetailChar(char);
    setView('detail');
  };

  const handleAddFromLibrary = (char: LibraryCharacter) => {
    // Check if already in story
    const alreadyInStory = storyChars.some(sc => sc.external_id === char.external_id);
    if (alreadyInStory) {
      toast.info('Character is already in the story');
      setView('main');
      return;
    }
    // Add to pending
    const newPending = new Map(pendingChanges);
    newPending.set(char.external_id, 'add');
    setPendingChanges(newPending);
    // Add to storyChars display (as pending)
    const newChar: StoryCharacter = {
      id: 0,
      external_id: char.external_id,
      name: char.name,
      backstory: char.backstory,
      appearance: char.appearance,
      headshot_url: char.headshot_url ?? '',
      display_headshot_url: null,
      removable: true,
      is_main_character: false,
      is_saved: char.is_saved ?? false,
      is_yours: char.is_yours ?? false,
      creator_name: '',
    };
    setStoryChars(prev => [...prev, newChar]);
    setView('main');
    toast.success(`${char.name} added — click Save Changes to confirm`);
  };

  const handleToggleRemove = (char: StoryCharacter) => {
    const newPending = new Map(pendingChanges);
    const current = newPending.get(char.external_id);
    if (current === 'add') {
      // Cancel the add
      newPending.delete(char.external_id);
      setStoryChars(prev => prev.filter(sc => sc.external_id !== char.external_id));
    } else if (current === 'remove') {
      // Cancel the remove
      newPending.delete(char.external_id);
    } else {
      // Mark for removal
      newPending.set(char.external_id, 'remove');
    }
    setPendingChanges(newPending);
  };

  const handleSave = async () => {
    const addIds: string[] = [];
    const removeIds: string[] = [];
    pendingChanges.forEach((type, id) => {
      if (type === 'add') addIds.push(id);
      else if (type === 'remove') removeIds.push(id);
    });
    // Handle play-as change
    if (pendingPlayAs) {
      const mainChar = storyChars.find(sc => sc.is_main_character);
      const newMainChar = storyChars.find(sc => sc.external_id === pendingPlayAs);
      if (mainChar && newMainChar) {
        setIsSaving(true);
        try {
          await onPlayAs(pendingPlayAs, mainChar.external_id, newMainChar.name.replace(/-/g, ' '));
          onClose();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to change main character');
        } finally {
          setIsSaving(false);
        }
        return;
      }
    }
    if (addIds.length === 0 && removeIds.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      await onSaveChanges(addIds, removeIds);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const hasPendingChanges = pendingChanges.size > 0 || !!pendingPlayAs;

  // Filter library characters
  const filteredLibrary = libraryChars.filter(char => {
    const matchesSearch = !librarySearch || char.name.toLowerCase().includes(librarySearch.toLowerCase());
    const matchesFilter =
      libraryFilter === 'all' ||
      (libraryFilter === 'yours' && char.is_yours) ||
      (libraryFilter === 'saved' && char.is_saved);
    return matchesSearch && matchesFilter;
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col"
        style={{
          width: 'min(92vw, 780px)',
          maxHeight: '85dvh',
          background: 'rgba(18,18,26,0.97)',
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex items-center justify-center rounded-full transition-all hover:bg-white/10"
          style={{ width: '32px', height: '32px', color: 'rgba(255,255,255,0.5)' }}
        >
          <X size={16} strokeWidth={2} />
        </button>

        {/* ── VIEW 1: MAIN ── */}
        {view === 'main' && (
          <>
            <div className="px-6 pt-6 pb-4 text-center flex-shrink-0">
              <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                Characters
              </h2>
              <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
                Upload yourself, use your OC, or customize any character
              </p>
            </div>

            {/* Add Character button */}
            <div className="px-6 pb-4 flex-shrink-0">
              <button
                onClick={handleOpenLibrary}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.85)',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                <Plus size={16} strokeWidth={2.5} />
                Add Character
              </button>
            </div>

            {/* Character cards grid */}
            <div className="flex-1 overflow-y-auto px-6 pb-4">
              {isLoadingChars ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {storyChars.map((char) => {
                    const pending = pendingChanges.get(char.external_id);
                    const isRemoving = pending === 'remove';
                    const isAdding = pending === 'add';
                    const imgUrl = char.display_headshot_url || char.headshot_url;

                    return (
                      <div
                        key={char.external_id}
                        className="relative flex-shrink-0 cursor-pointer"
                        onClick={() => { setStoryDetailChar(char); setView('story-detail'); }}
                        style={{
                          width: '140px',
                          height: '200px',
                          borderRadius: '14px',
                          overflow: 'hidden',
                          border: isRemoving
                            ? '2px solid rgba(239,68,68,0.8)'
                            : isAdding
                            ? '2px solid rgba(34,197,94,0.8)'
                            : char.is_main_character
                            ? '2px solid rgba(234,179,8,0.8)'
                            : '2px solid rgba(255,255,255,0.08)',
                          background: '#1a1a2e',
                          opacity: isRemoving ? 0.55 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Headshot */}
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={char.name}
                            className="w-full h-full"
                            style={{ objectFit: 'cover', objectPosition: 'center top' }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '32px', color: 'rgba(255,255,255,0.2)' }}>
                              {char.name[0]}
                            </span>
                          </div>
                        )}

                        {/* Gradient overlay */}
                        <div
                          className="absolute inset-0"
                          style={{ background: 'linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.85) 100%)' }}
                        />

                        {/* Top-left badge — 'You' for main, clickable 'Play as' for others */}
                        {char.is_main_character ? (
                          <div
                            className="absolute top-2 left-2 px-2.5 py-1 rounded-full"
                            style={{
                              fontFamily: 'Outfit, sans-serif',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#fff',
                              background: 'rgba(0,0,0,0.55)',
                              backdropFilter: 'blur(6px)',
                            }}
                          >
                            You
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingPlayAs(prev => prev === char.external_id ? null : char.external_id);
                            }}
                            className="absolute top-2 left-2 px-2.5 py-1 rounded-full transition-all hover:brightness-125"
                            style={{
                              fontFamily: 'Outfit, sans-serif',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#fff',
                              background: pendingPlayAs === char.external_id
                                ? 'rgba(34,197,94,0.75)'
                                : 'rgba(0,0,0,0.55)',
                              backdropFilter: 'blur(6px)',
                              border: 'none',
                            }}
                          >
                            {pendingPlayAs === char.external_id ? '✓ Play as' : 'Play as'}
                          </button>
                        )}

                        {/* Minus / restore button */}
                        {char.removable && (
                          <button
                            onClick={() => handleToggleRemove(char)}
                            className="absolute top-2 right-2 flex items-center justify-center rounded-full transition-all hover:brightness-125"
                            style={{
                              width: '24px',
                              height: '24px',
                              background: isRemoving ? 'rgba(34,197,94,0.8)' : 'rgba(0,0,0,0.6)',
                              color: '#fff',
                              backdropFilter: 'blur(4px)',
                            }}
                          >
                            {isRemoving ? (
                              <Plus size={12} strokeWidth={2.5} />
                            ) : (
                              <span style={{ fontSize: '16px', lineHeight: 1, marginTop: '-1px' }}>−</span>
                            )}
                          </button>
                        )}

                        {/* Name + label at bottom */}
                        <div className="absolute bottom-0 left-0 right-0 px-2 pb-2">
                          <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                            {char.name.replace(/-/g, ' ')}
                          </p>
                          {char.is_main_character && (
                            <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '2px' }}>
                              Main Character
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Empty slot */}
                  <button
                    onClick={handleOpenLibrary}
                    className="flex-shrink-0 flex flex-col items-center justify-center gap-2 transition-all hover:brightness-125"
                    style={{
                      width: '140px',
                      height: '200px',
                      borderRadius: '14px',
                      border: '2px dashed rgba(255,255,255,0.18)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.35)',
                    }}
                  >
                    <Plus size={24} strokeWidth={1.5} />
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '12px' }}>Add Character</span>
                  </button>
                </div>
              )}
            </div>

            {/* Save Changes button */}
            <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125 disabled:opacity-50"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: hasPendingChanges ? '#fff' : 'rgba(255,255,255,0.5)',
                  background: hasPendingChanges ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${hasPendingChanges ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {isSaving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} strokeWidth={2} />
                )}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}

        {/* ── VIEW 2: LIBRARY ── */}
        {view === 'library' && (
          <>
            <div className="px-6 pt-6 pb-4 flex-shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => setView('main')}
                  className="flex items-center gap-1 transition-all hover:brightness-125"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                  Back
                </button>
                <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
                  Add Character
                </h2>
              </div>

              {/* Create New Character */}
              <a
                href="https://getfreeroam.com/characters/new"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125 mb-4"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.85)',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  display: 'flex',
                }}
              >
                <Plus size={16} strokeWidth={2.5} />
                Create New Character
              </a>

              {/* Search */}
              <div className="relative mb-3">
                <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search characters..."
                  className="w-full outline-none"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '14px',
                    color: 'rgba(255,255,255,0.8)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '10px 12px 10px 36px',
                  }}
                />
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2">
                {(['all', 'yours', 'saved'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setLibraryFilter(f)}
                    className="px-4 py-1.5 rounded-full transition-all"
                    style={{
                      fontFamily: 'Outfit, sans-serif',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: libraryFilter === f ? '#fff' : 'rgba(255,255,255,0.45)',
                      background: libraryFilter === f ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${libraryFilter === f ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
                      textTransform: 'capitalize',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Library grid */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {isLoadingLibrary ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                </div>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  {filteredLibrary.map((char) => (
                    <button
                      key={char.external_id}
                      onClick={() => handleOpenDetail(char)}
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all hover:brightness-125 text-left"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {char.headshot_url ? (
                        <img
                          src={char.headshot_url}
                          alt={char.name}
                          className="rounded-full"
                          style={{ width: '72px', height: '72px', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          className="rounded-full flex items-center justify-center"
                          style={{ width: '72px', height: '72px', background: 'rgba(255,255,255,0.08)', fontSize: '28px', color: 'rgba(255,255,255,0.3)' }}
                        >
                          {char.name[0]}
                        </div>
                      )}
                      <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff', textAlign: 'center', lineHeight: 1.3 }}>
                        {char.name.replace(/-/g, ' ')}
                      </p>
                      <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '11px', color: 'rgba(139,92,246,0.8)' }}>
                        {char.is_yours ? 'yours' : 'private'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── VIEW 3: DETAIL ── */}
        {view === 'detail' && detailChar && (
          <>
            <div className="px-6 pt-6 pb-4 flex-shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => setView('library')}
                  className="flex items-center gap-1 transition-all hover:brightness-125"
                  style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                  Back
                </button>
                <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
                  {detailChar.name.replace(/-/g, ' ')}
                </h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4">
              <div className="flex gap-5">
                {/* Portrait */}
                <div className="flex-shrink-0">
                  {detailChar.headshot_url ? (
                    <img
                      src={detailChar.headshot_url}
                      alt={detailChar.name}
                      style={{ width: '120px', height: '160px', objectFit: 'cover', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center"
                      style={{ width: '120px', height: '160px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '48px', color: 'rgba(255,255,255,0.2)' }}
                    >
                      {detailChar.name[0]}
                    </div>
                  )}
                </div>

                {/* Fields */}
                <div className="flex-1 flex flex-col gap-4">
                  <div>
                    <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>
                      Name
                    </label>
                    <div
                      className="px-3 py-2 rounded-xl"
                      style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      {detailChar.name.replace(/-/g, ' ')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Personality */}
              <div className="mt-4">
                <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>
                  Personality
                </label>
                <div
                  className="px-3 py-3 rounded-xl"
                  style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '13px',
                    color: 'rgba(255,255,255,0.75)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    lineHeight: 1.6,
                    maxHeight: '180px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {detailChar.backstory || 'No personality description available.'}
                </div>
              </div>
            </div>

            {/* Add to Story button */}
            <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => handleAddFromLibrary(detailChar)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125"
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#fff',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
              >
                <Plus size={16} strokeWidth={2.5} />
                Add to Story
              </button>
            </div>
          </>
        )}

        {/* ── VIEW 4: STORY CHARACTER DETAIL (editable) ── */}
        {view === 'story-detail' && storyDetailChar && (
          <StoryDetailEditView
            char={storyDetailChar}
            onBack={() => setView('main')}
            onEditCharacter={onEditCharacter}
          />
        )}
      </div>
    </div>
  );
}

// ── Separate component to manage edit state cleanly ──
function StoryDetailEditView({
  char,
  onBack,
  onEditCharacter,
}: {
  char: {
    external_id: string;
    name: string;
    backstory: string;
    appearance: string;
    headshot_url: string;
    display_headshot_url: string | null;
    is_main_character: boolean;
    creator_name: string;
  };
  onBack: () => void;
  onEditCharacter: (charId: string, charName: string, oldBackstory: string, newBackstory: string, oldAppearance: string, newAppearance: string, photoChanged?: boolean, newHeadshotUrl?: string) => Promise<void>;
}) {
  const [editBackstory, setEditBackstory] = useState(char.backstory);
  const [editAppearance, setEditAppearance] = useState(char.appearance);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [newHeadshotUrl, setNewHeadshotUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backstoryChanged = editBackstory.trim() !== char.backstory.trim();
  const appearanceChanged = editAppearance.trim() !== char.appearance.trim();
  const photoChanged = !!newHeadshotUrl;
  const hasChanges = backstoryChanged || appearanceChanged || photoChanged;

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    try {
      // Convert file to base64 for the tRPC uploadHeadshot procedure
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the data URL prefix (e.g. 'data:image/png;base64,')
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const cookie = localStorage.getItem('freeroam_cookie') ?? '';
      const accountId = localStorage.getItem('freeroam_account_id') ?? '';
      const res = await fetch('/api/trpc/characters.uploadHeadshot?batch=1', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { 'x-freeroam-cookie': cookie } : {}),
          ...(accountId ? { 'x-freeroam-account-id': accountId } : {}),
        },
        body: JSON.stringify({
          '0': { json: { fileBase64: base64, mimeType: file.type, fileName: file.name } },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const url = json?.[0]?.result?.data?.json?.headshot_url;
        setNewHeadshotUrl(url || URL.createObjectURL(file));
      } else {
        setNewHeadshotUrl(URL.createObjectURL(file));
      }
    } catch {
      if (file) setNewHeadshotUrl(URL.createObjectURL(file));
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 transition-all hover:brightness-125"
            style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>
          <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
            {char.name.replace(/-/g, ' ')}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="flex gap-5">
          {/* Portrait — tappable to change photo */}
          <div className="flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPhoto}
              className="relative block transition-all hover:brightness-110"
              style={{ width: '120px', height: '160px', borderRadius: '12px', overflow: 'hidden', border: `1px solid ${photoChanged ? 'rgba(34,197,94,0.6)' : char.is_main_character ? 'rgba(234,179,8,0.5)' : 'rgba(255,255,255,0.1)'}` }}
            >
              {(newHeadshotUrl || char.display_headshot_url || char.headshot_url) ? (
                <img
                  src={newHeadshotUrl || char.display_headshot_url || char.headshot_url}
                  alt={char.name}
                  className="w-full h-full"
                  style={{ objectFit: 'cover', objectPosition: 'center top' }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '48px', color: 'rgba(255,255,255,0.2)' }}>
                  {char.name[0]}
                </div>
              )}
              {/* Change Photo overlay */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                style={{ background: isUploadingPhoto ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)', backdropFilter: 'blur(1px)' }}
              >
                {isUploadingPhoto ? (
                  <Loader2 size={20} className="animate-spin" style={{ color: '#fff' }} />
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '10px', fontWeight: 600, color: '#fff' }}>Change Photo</span>
                  </>
                )}
              </div>
            </button>
            {char.is_main_character && (
              <div className="mt-2 text-center" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '11px', fontWeight: 700, color: 'rgba(234,179,8,0.9)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Main Character
              </div>
            )}
          </div>

          {/* Name + Creator */}
          <div className="flex-1 flex flex-col gap-4">
            <div>
              <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Name</label>
              <div className="px-3 py-2 rounded-xl" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {char.name.replace(/-/g, ' ')}
              </div>
            </div>
            <div>
              <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Creator</label>
              <div className="px-3 py-2 rounded-xl" style={{ fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {char.creator_name || 'Unknown'}
              </div>
            </div>
          </div>
        </div>

        {/* Personality — editable textarea */}
        <div className="mt-4">
          <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Personality</label>
          <textarea
            value={editBackstory}
            onChange={(e) => setEditBackstory(e.target.value)}
            rows={6}
            className="w-full outline-none resize-none"
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '13px',
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${backstoryChanged ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '12px',
              padding: '12px',
              lineHeight: 1.6,
            }}
          />
        </div>

        {/* Appearance — editable textarea */}
        <div className="mt-4">
          <label style={{ fontFamily: 'Outfit, sans-serif', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px' }}>Appearance</label>
          <textarea
            value={editAppearance}
            onChange={(e) => setEditAppearance(e.target.value)}
            rows={6}
            className="w-full outline-none resize-none"
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '13px',
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${appearanceChanged ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '12px',
              padding: '12px',
              lineHeight: 1.6,
            }}
          />
        </div>
      </div>

      {/* Save Changes button */}
      <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={async () => {
            if (!hasChanges || isSaving) return;
            setIsSaving(true);
            try {
              await onEditCharacter(char.external_id, char.name.replace(/-/g, ' '), char.backstory, editBackstory, char.appearance, editAppearance, photoChanged, newHeadshotUrl ?? undefined);
            } catch (err) {
              // Error handled upstream
            } finally {
              setIsSaving(false);
            }
          }}
          disabled={!hasChanges || isSaving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl transition-all hover:brightness-125 disabled:opacity-40"
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: '15px',
            fontWeight: 600,
            color: hasChanges ? '#fff' : 'rgba(255,255,255,0.5)',
            background: hasChanges ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${hasChanges ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} strokeWidth={2} />}
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </>
  );
}
