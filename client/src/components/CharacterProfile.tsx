// CharacterProfile.tsx
// Design: Tactical Dark Ops — full-screen modal overlay
// Fetches full character data (including `appearance`) via tRPC on open
// Two tabs: About (backstory) and Appearance
// Edit button in header opens CreateCharacterModal inline; on save the profile updates in place

import AddToCollectionPopover from '@/components/AddToCollectionPopover';
import CreateCharacterModal from '@/components/CreateCharacterModal';
import { Collection } from '@/hooks/useCollections';
import { trpc } from '@/lib/trpc';
import { ApiCharacter } from '@/pages/Home';
import { Copy, EyeOff, FolderPlus, Globe, Heart, Link, Lock, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CharacterProfileProps {
  character: ApiCharacter | null;
  onClose: () => void;
  /** Called when the character is updated from inside the profile, so the card grid also updates */
  onUpdated?: (updated: ApiCharacter) => void;
  // Collections
  collections?: Collection[];
  isInCollection?: (collectionId: number, characterId: string) => boolean;
  onToggleInCollection?: (collectionId: number, characterId: string) => void;
  onCreateCollection?: (name: string) => void;
  // Favorites
  isSaved?: boolean;
  onToggleSave?: () => void;
  // NSFW
  onNsfwToggle?: (characterId: string, isNsfw: boolean) => void;
}

type Tab = 'about' | 'appearance' | 'full-backstory' | 'full-appearance';
type PrivacyStatus = 'private' | 'public' | 'unlisted';

function PrivacyBadgeLarge({ status }: { status: PrivacyStatus }) {
  const config = {
    private: { label: 'Private', icon: <Lock size={13} strokeWidth={2.5} />, className: 'badge-private' },
    public:  { label: 'Public',  icon: <Globe size={13} strokeWidth={2.5} />, className: 'badge-public' },
    unlisted: { label: 'Unlisted', icon: <Link size={13} strokeWidth={2.5} />, className: 'badge-linked' },
  };
  const { label, icon, className } = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-semibold tracking-widest uppercase ${className}`}
      style={{ fontFamily: 'Rajdhani, sans-serif' }}
    >
      {icon}
      {label}
    </span>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <span
      className="text-[10px] uppercase tracking-widest block mb-2"
      style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
    >
      {label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3" style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}>
      <span
        className="text-[10px] uppercase tracking-widest"
        style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
      >
        {label}
      </span>
      <span
        style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.82 0.005 65)', fontSize: '12px', lineHeight: '1.6' }}
      >
        {value}
      </span>
    </div>
  );
}

const FALLBACK_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWEyNCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMzMzMzQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';

export default function CharacterProfile({ character, onClose, onUpdated, collections = [], isInCollection, onToggleInCollection, onCreateCollection, isSaved = false, onToggleSave, onNsfwToggle }: CharacterProfileProps) {
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [visible, setVisible] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  // Pre-filled character for the duplicate form
  const [duplicateSource, setDuplicateSource] = useState<ApiCharacter | null>(null);
  const [showCollectionPopover, setShowCollectionPopover] = useState(false);

  // Local override so profile reflects edits immediately without closing
  const [localCharacter, setLocalCharacter] = useState<ApiCharacter | null>(null);

  // The character we actually display — prefer local override
  const displayCharacter = localCharacter ?? character;

  // NSFW flag — fetched from our DB via POST mutation to avoid 414 URL-too-large
  const [isNsfw, setIsNsfw] = useState(false);
  const nsfwGetMutation = trpc.nsfw.getBatch.useMutation({
    onSuccess: (data) => {
      if (displayCharacter?.external_id) {
        setIsNsfw(data[displayCharacter.external_id] ?? false);
      }
    },
  });
  // Fetch NSFW status when a character opens
  useEffect(() => {
    if (displayCharacter?.external_id) {
      nsfwGetMutation.mutate({ characterIds: [displayCharacter.external_id] });
    } else {
      setIsNsfw(false);
    }
  }, [displayCharacter?.external_id]);
  const nsfwToggleMutation = trpc.nsfw.toggle.useMutation({
    onSuccess: (data) => {
      setIsNsfw(data.isNsfw);
      onNsfwToggle?.(data.characterId, data.isNsfw);
    },
  });

  // Fetch full character data (with appearance) when a character is selected
  const { data: fullCharacter, isLoading: isLoadingFull, refetch: refetchFull } = trpc.characters.get.useQuery(
    { characterId: displayCharacter?.external_id ?? '' },
    { enabled: !!displayCharacter?.external_id, staleTime: 5 * 60_000 }
  );

  // Fetch extended (unlimited) content from our DB — overrides Freeroam's truncated copy
  const { data: extendedCharacter } = trpc.characters.getExtended.useQuery(
    { characterId: displayCharacter?.external_id ?? '' },
    { enabled: !!displayCharacter?.external_id, staleTime: 5 * 60_000 }
  );

  useEffect(() => {
    if (character) {
      setActiveTab('about');
      setLocalCharacter(null); // reset override when a new character opens
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [character]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => {
      setLocalCharacter(null);
      onClose();
    }, 250);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !showEditModal) handleClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showEditModal) handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showEditModal]);

  // Called when the edit modal saves successfully
  const handleEditSaved = (updated: ApiCharacter, mode: 'create' | 'edit') => {
    if (mode !== 'edit') return;
    setLocalCharacter(updated);
    refetchFull();
    onUpdated?.(updated);
  };

  // Open the duplicate form pre-filled with current character data
  const handleDuplicate = () => {
    if (!displayCharacter) return;
    // Build a synthetic ApiCharacter with "Copy of" prefix and the full data we have.
    // Prefer extended DB content (full, unlimited) over Freeroam's truncated copy.
    const source: ApiCharacter = {
      ...displayCharacter,
      name: `Copy of ${displayCharacter.name}`,
      display_headshot_url: fullCharacter?.display_headshot_url ?? displayCharacter.display_headshot_url,
      headshot_url: fullCharacter?.headshot_url ?? displayCharacter.headshot_url,
      backstory: extendedCharacter?.backstoryFull ?? fullCharacter?.backstory ?? displayCharacter.backstory,
      // description field carries appearance data in the ApiCharacter shape
      description: extendedCharacter?.appearanceFull ?? fullCharacter?.appearance ?? fullCharacter?.description ?? displayCharacter.description,
    };
    setDuplicateSource(source);
    setShowDuplicateModal(true);
  };

  if (!displayCharacter) return null;

  // Derive display values — prefer local override, then full fetch, then list data
  const displayName = fullCharacter?.name ?? displayCharacter.name;
  const displayOwner = fullCharacter?.owner?.display_name ?? fullCharacter?.owner?.username ?? displayCharacter.owner.display_name;
  const displayPrivacy = fullCharacter?.privacy_status ?? displayCharacter.privacy_status;
  const imageUrl = fullCharacter?.display_headshot_url ?? fullCharacter?.headshot_url
    ?? displayCharacter.display_headshot_url ?? displayCharacter.headshot_url ?? FALLBACK_IMAGE;
  // Prefer extended DB content (full, unlimited) over Freeroam's potentially truncated copy
  const backstory = extendedCharacter?.backstoryFull ?? fullCharacter?.backstory ?? displayCharacter.backstory;
  // description from library endpoint = appearance; fall back to full character fetch
  const appearance = extendedCharacter?.appearanceFull ?? (displayCharacter.description) ?? fullCharacter?.appearance ?? null;
  // Freeroam's actual copy (used for limit checks — NOT the extended version)
  const freeroamBackstory = fullCharacter?.backstory ?? displayCharacter.backstory;
  const freeroamAppearance = (displayCharacter.description) ?? fullCharacter?.appearance ?? null;

  return (
    <>
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
          className="relative w-full sm:max-w-4xl sm:rounded-sm overflow-hidden flex flex-col"
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
          {/* Header image strip */}
          <div className="relative flex-shrink-0">
            <div className="relative h-48 sm:h-64 overflow-hidden">
              <img
                src={imageUrl}
                alt={displayName}
                className="w-full h-full object-cover object-top"
                onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(to bottom, oklch(0.11 0.009 264 / 0.3) 0%, oklch(0.11 0.009 264 / 0.7) 60%, oklch(0.11 0.009 264) 100%)',
                }}
              />
            </div>

            {/* Top-right action buttons: Duplicate + Edit + Close */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              {/* Favorite button */}
              {onToggleSave && (
                <button
                  onClick={onToggleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110"
                  style={{
                    background: isSaved ? 'oklch(0.65 0.22 25 / 0.2)' : 'oklch(0.18 0.01 264 / 0.85)',
                    border: isSaved ? '1px solid oklch(0.65 0.22 25 / 0.5)' : '1px solid oklch(1 0 0 / 0.15)',
                    color: isSaved ? 'oklch(0.75 0.18 25)' : 'oklch(0.65 0.01 264)',
                    backdropFilter: 'blur(4px)',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                  title={isSaved ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart size={12} strokeWidth={2} fill={isSaved ? 'currentColor' : 'none'} />
                  {isSaved ? 'Favorited' : 'Favorite'}
                </button>
              )}

              {/* Add to Collection button */}
              {onToggleInCollection && (
                <div className="relative">
                  <button
                    onClick={() => setShowCollectionPopover(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110"
                    style={{
                      background: showCollectionPopover ? 'oklch(0.22 0.01 264)' : 'oklch(0.18 0.01 264 / 0.85)',
                      border: '1px solid oklch(1 0 0 / 0.15)',
                      color: 'oklch(0.65 0.01 264)',
                      backdropFilter: 'blur(4px)',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                    title="Add to collection"
                  >
                    <FolderPlus size={12} strokeWidth={2.5} />
                    Collect
                  </button>
                  {showCollectionPopover && displayCharacter && (
                    <AddToCollectionPopover
                      characterId={displayCharacter.external_id}
                      collections={collections}
                      isInCollection={isInCollection ?? (() => false)}
                      onToggle={(colId, charId) => onToggleInCollection(colId, charId)}
                      onCreate={(name) => { onCreateCollection?.(name); }}
                      onClose={() => setShowCollectionPopover(false)}
                    />
                  )}
                </div>
              )}

              {/* NSFW toggle button */}
              <button
                onClick={() => displayCharacter && nsfwToggleMutation.mutate({ characterId: displayCharacter.external_id })}
                disabled={nsfwToggleMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110 disabled:opacity-50"
                style={{
                  background: isNsfw ? 'oklch(0.55 0.15 300 / 0.2)' : 'oklch(0.18 0.01 264 / 0.85)',
                  border: isNsfw ? '1px solid oklch(0.55 0.15 300 / 0.5)' : '1px solid oklch(1 0 0 / 0.15)',
                  color: isNsfw ? 'oklch(0.75 0.15 300)' : 'oklch(0.65 0.01 264)',
                  backdropFilter: 'blur(4px)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
                title={isNsfw ? 'Mark as SFW' : 'Mark as NSFW'}
              >
                <EyeOff size={12} strokeWidth={2} />
                {isNsfw ? 'NSFW' : 'SFW'}
              </button>

              {/* Duplicate button */}
              <button
                onClick={handleDuplicate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110"
                style={{
                  background: 'oklch(0.18 0.01 264 / 0.85)',
                  border: '1px solid oklch(1 0 0 / 0.15)',
                  color: 'oklch(0.65 0.01 264)',
                  backdropFilter: 'blur(4px)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
                title="Duplicate character"
              >
                <Copy size={12} strokeWidth={2.5} />
                Duplicate
              </button>

              {/* Edit button */}
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110"
                style={{
                  background: 'oklch(0.769 0.188 70.08 / 0.15)',
                  border: '1px solid oklch(0.769 0.188 70.08 / 0.4)',
                  color: 'oklch(0.769 0.188 70.08)',
                  backdropFilter: 'blur(4px)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
                title="Edit character"
              >
                <Pencil size={12} strokeWidth={2.5} />
                Edit
              </button>

              {/* Close button */}
              <button
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:bg-white/10"
                style={{
                  background: 'oklch(0.13 0.01 264 / 0.8)',
                  border: '1px solid oklch(1 0 0 / 0.12)',
                  color: 'oklch(0.7 0.005 65)',
                  backdropFilter: 'blur(4px)',
                }}
                title="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Name + creator + badge */}
            <div className="absolute bottom-0 left-0 right-0 px-6 pb-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2
                    className="text-3xl sm:text-4xl font-bold tracking-wide leading-none"
                    style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.97 0.005 65)' }}
                  >
                    {displayName}
                  </h2>
                  <p
                    className="text-xs mt-1"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.5 0.01 264)' }}
                  >
                    by {displayOwner}
                  </p>
                </div>
                <div className="flex-shrink-0 mb-1">
                  <PrivacyBadgeLarge status={displayPrivacy} />
                </div>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          {(() => {
            const BACKSTORY_LIMIT = 2000;
            const APPEARANCE_LIMIT = 1000;
            const backstoryExceeds = (freeroamBackstory?.length ?? 0) > BACKSTORY_LIMIT;
            const appearanceExceeds = (freeroamAppearance?.length ?? 0) > APPEARANCE_LIMIT;
            const tabs: { id: Tab; label: string; badge?: string; badgeRed?: boolean }[] = [
              { id: 'about', label: 'About', ...(backstoryExceeds ? { badge: `${(backstory?.length ?? 0).toLocaleString()} chars`, badgeRed: true } : {}) },
              { id: 'appearance', label: 'Appearance', ...(appearanceExceeds ? { badge: `${(appearance?.length ?? 0).toLocaleString()} chars`, badgeRed: true } : {}) },
              ...(backstoryExceeds ? [{ id: 'full-backstory' as Tab, label: 'Full Backstory', badge: `${(backstory?.length ?? 0).toLocaleString()} chars` }] : []),
              ...(appearanceExceeds ? [{ id: 'full-appearance' as Tab, label: 'Full Appearance', badge: `${(appearance?.length ?? 0).toLocaleString()} chars` }] : []),
            ];
            return (
              <div className="flex-shrink-0 flex overflow-x-auto" style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)', scrollbarWidth: 'none' }}>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="relative flex-shrink-0 flex items-center gap-1.5 px-5 py-3 text-sm font-semibold tracking-widest uppercase transition-colors"
                    style={{
                      fontFamily: 'Rajdhani, sans-serif',
                      color: activeTab === tab.id ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.5 0.01 264)',
                      background: 'transparent',
                      borderBottom: activeTab === tab.id ? '2px solid oklch(0.769 0.188 70.08)' : '2px solid transparent',
                      marginBottom: '-1px',
                    }}
                  >
                    {tab.label}
                    {tab.badge && (
                      <span
                        className="text-[9px] px-1 py-0.5 rounded"
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          background: tab.badgeRed ? 'oklch(0.65 0.22 25 / 0.2)' : 'oklch(0.55 0.15 300 / 0.2)',
                          color: tab.badgeRed ? 'oklch(0.75 0.22 25)' : 'oklch(0.75 0.15 300)',
                          border: tab.badgeRed ? '1px solid oklch(0.65 0.22 25 / 0.5)' : '1px solid oklch(0.55 0.15 300 / 0.3)',
                        }}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Tab content — scrollable */}
          <div className="flex-1 overflow-y-auto">

            {/* Loading shimmer while fetching full data */}
            {isLoadingFull && (
              <div className="p-6 space-y-3 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="py-3" style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}>
                    <div className="h-2 rounded mb-2" style={{ background: 'oklch(0.769 0.188 70.08 / 0.2)', width: '25%' }} />
                    <div className="h-3 rounded" style={{ background: 'oklch(0.18 0.01 264)', width: `${50 + i * 10}%` }} />
                  </div>
                ))}
              </div>
            )}

            {/* About tab */}
            {!isLoadingFull && activeTab === 'about' && (
              <div className="p-6">
                <InfoRow label="Name" value={displayName} />
                <InfoRow label="Owner" value={displayOwner} />
                <InfoRow
                  label="Visibility"
                  value={displayPrivacy.charAt(0).toUpperCase() + displayPrivacy.slice(1)}
                />
                <InfoRow label="Type" value={displayCharacter.is_persona ? 'Persona' : 'Character'} />

                {/* Tags */}
                {displayCharacter.tags && displayCharacter.tags.length > 0 && (
                  <div className="py-3" style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}>
                    <span
                      className="text-[10px] uppercase tracking-widest block mb-2"
                      style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
                    >
                      Tags
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {displayCharacter.tags.map((tag, i) => (
                        <span
                          key={`${tag.name}-${i}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-medium tracking-wide"
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            background: tag.is_fandom ? 'oklch(0.25 0.08 220 / 0.3)' : 'oklch(0.769 0.188 70.08 / 0.1)',
                            border: tag.is_fandom ? '1px solid oklch(0.55 0.15 220 / 0.4)' : '1px solid oklch(0.769 0.188 70.08 / 0.25)',
                            color: tag.is_fandom ? 'oklch(0.75 0.15 220)' : 'oklch(0.769 0.188 70.08 / 0.85)',
                          }}
                        >
                          <span>{tag.emoji}</span>
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="py-4">
                  <SectionLabel label="Backstory" />
                  <p
                    className="leading-loose whitespace-pre-wrap"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                  >
                    {backstory || 'No backstory provided.'}
                  </p>
                </div>
              </div>
            )}

            {/* Full Backstory tab — shown when backstory exceeds Freeroam's 2000-char limit */}
            {!isLoadingFull && activeTab === 'full-backstory' && (
              <div className="p-6">
                <div className="mb-4 px-3 py-2 rounded-sm" style={{ background: 'oklch(0.55 0.15 300 / 0.08)', border: '1px solid oklch(0.55 0.15 300 / 0.25)' }}>
                  <p className="text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.12 300)' }}>
                    This is the full backstory stored locally. Freeroam only received the first 2,000 characters.
                  </p>
                </div>
                <div className="py-2">
                  <SectionLabel label="Full Backstory" />
                  <p
                    className="leading-loose whitespace-pre-wrap"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                  >
                    {backstory}
                  </p>
                </div>
              </div>
            )}

            {/* Full Appearance tab — shown when appearance exceeds Freeroam's 1000-char limit */}
            {!isLoadingFull && activeTab === 'full-appearance' && (
              <div className="p-6">
                <div className="mb-4 px-3 py-2 rounded-sm" style={{ background: 'oklch(0.55 0.15 300 / 0.08)', border: '1px solid oklch(0.55 0.15 300 / 0.25)' }}>
                  <p className="text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.12 300)' }}>
                    This is the full appearance stored locally. Freeroam only received the first 1,000 characters.
                  </p>
                </div>
                <div className="py-2">
                  <SectionLabel label="Full Appearance" />
                  <p
                    className="leading-loose whitespace-pre-wrap"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                  >
                    {appearance}
                  </p>
                </div>
              </div>
            )}

            {/* Appearance tab */}
            {!isLoadingFull && activeTab === 'appearance' && (
              <div className="p-6">
                {appearance ? (
                  <div className="py-2">
                    <SectionLabel label="Appearance" />
                    <p
                      className="leading-loose whitespace-pre-wrap"
                      style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                    >
                      {appearance}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '16px', fontWeight: 700, color: 'oklch(0.35 0.01 264)' }}>
                      NO APPEARANCE DATA
                    </p>
                    <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'oklch(0.3 0.01 264)' }}>
                      This character has no appearance description on file.
                    </p>
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110 text-xs font-semibold tracking-wider uppercase"
                      style={{
                        fontFamily: 'Rajdhani, sans-serif',
                        background: 'oklch(0.769 0.188 70.08 / 0.1)',
                        border: '1px solid oklch(0.769 0.188 70.08 / 0.3)',
                        color: 'oklch(0.769 0.188 70.08)',
                      }}
                    >
                      <Pencil size={12} strokeWidth={2.5} />
                      Add Appearance
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Edit modal — rendered at z-60 so it sits above the profile modal */}
      {showEditModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <CreateCharacterModal
            open={showEditModal}
            onClose={() => setShowEditModal(false)}
            onSaved={handleEditSaved}
            editCharacter={displayCharacter}
          />
        </div>
      )}

      {/* Duplicate modal — create mode pre-filled with source character data */}
      {showDuplicateModal && duplicateSource && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <CreateCharacterModal
            open={showDuplicateModal}
            onClose={() => { setShowDuplicateModal(false); setDuplicateSource(null); }}
            onSaved={(created, mode) => {
              if (mode === 'create') {
                // Bubble the new character up to the grid
                onUpdated?.(created);
              }
              setShowDuplicateModal(false);
              setDuplicateSource(null);
            }}
            duplicateSource={duplicateSource}
          />
        </div>
      )}
    </>
  );
}
