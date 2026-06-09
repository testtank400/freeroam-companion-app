// WorldProfile.tsx
// Design: Tactical Dark Ops — full-screen modal overlay for world details
// Fetches full world data (characters, tags, related worlds) via tRPC on open
// Tabs: Overview, Characters, Related Worlds
// Action bar: Add to Collection popover

import { trpc } from '@/lib/trpc';
import { ApiWorld } from '@/components/WorldCard';
import { ApiWorldCollection } from '@/components/WorldCollectionCard';
import AddToWorldCollectionPopover from '@/components/AddToWorldCollectionPopover';
import { Eye, FolderPlus, Globe, Link, Lock, X, Users, BookOpen, Compass } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface WorldProfileProps {
  world: ApiWorld | null;
  onClose: () => void;
  /** World collections for the Add to Collection popover */
  worldCollections?: ApiWorldCollection[];
  onCollectionsRefresh?: () => void;
}

type Tab = 'overview' | 'characters' | 'related';
type PrivacyStatus = 'private' | 'public' | 'unlisted';

function PrivacyBadgeLarge({ status }: { status: PrivacyStatus }) {
  const config = {
    private: { label: 'Private', icon: <Lock size={13} strokeWidth={2.5} />, className: 'badge-private' },
    public: { label: 'Public', icon: <Globe size={13} strokeWidth={2.5} />, className: 'badge-public' },
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

/** Format interaction count */
function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

export default function WorldProfile({ world, onClose, worldCollections = [], onCollectionsRefresh }: WorldProfileProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isVisible, setIsVisible] = useState(false);
  const [showCollectionPopover, setShowCollectionPopover] = useState(false);
  const [membershipSet, setMembershipSet] = useState<Set<string>>(new Set());
  const collectionBtnRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const createCollectionMutation = trpc.worldCollections.create.useMutation();

  // Fetch full world details when opened
  const { data: worldDetail, isLoading: isLoadingDetail } = trpc.worlds.get.useQuery(
    { worldId: world?.external_id ?? '' },
    { enabled: !!world }
  );

  // Fetch which collections this world belongs to
  const { data: memberships } = trpc.worldCollections.getWorldMemberships.useQuery(
    { worldExternalId: world?.external_id ?? '' },
    { enabled: !!world }
  );

  useEffect(() => {
    if (memberships) {
      setMembershipSet(new Set(memberships));
    }
  }, [memberships]);

  // Animate in
  useEffect(() => {
    if (world) {
      requestAnimationFrame(() => setIsVisible(true));
      setActiveTab('overview');
      setShowCollectionPopover(false);
    } else {
      setIsVisible(false);
    }
  }, [world]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCollectionPopover) {
          setShowCollectionPopover(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, showCollectionPopover]);

  // Scroll to top on tab change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  if (!world) return null;

  const detail = worldDetail;
  const coverUrl = world.cover_image_url || detail?.world.cover_image_url;
  const ownerName = detail?.world.owner.display_name || detail?.world.owner.username || world.owner.username;
  const tags = detail?.tags ?? [];
  const characters = detail?.characters ?? [];
  const relatedWorlds = detail?.related_worlds ?? [];

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <BookOpen size={13} strokeWidth={2} /> },
    { id: 'characters', label: 'Characters', icon: <Users size={13} strokeWidth={2} />, count: characters.length },
    { id: 'related', label: 'Related', icon: <Compass size={13} strokeWidth={2} />, count: relatedWorlds.length },
  ];

  const handleToggleMembership = (collectionId: string, added: boolean) => {
    setMembershipSet(prev => {
      const next = new Set(prev);
      if (added) next.add(collectionId);
      else next.delete(collectionId);
      return next;
    });
    // Refresh collections list to update world counts
    onCollectionsRefresh?.();
  };

  const handleCreateCollection = async (name: string) => {
    try {
      await createCollectionMutation.mutateAsync({ name });
      onCollectionsRefresh?.();
      // Re-fetch collections after creation
      await utils.worldCollections.list.invalidate();
    } catch {
      // Error handled inside popover
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ opacity: isVisible ? 1 : 0, transition: 'opacity 0.2s ease' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.05 0.01 264 / 0.85)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        ref={scrollRef}
        className="relative w-full max-w-2xl overflow-y-auto"
        style={{
          background: 'oklch(0.11 0.008 264)',
          borderLeft: '1px solid oklch(1 0 0 / 0.08)',
          transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease',
        }}
      >
        {/* Cover image header */}
        <div className="relative w-full" style={{ height: '280px' }}>
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={world.name}
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0" style={{ background: 'oklch(0.15 0.01 264)' }} />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to bottom, transparent 30%, oklch(0.11 0.008 264 / 0.9) 80%, oklch(0.11 0.008 264) 100%)',
            }}
          />

          {/* Top-right: action buttons + close */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            {/* Collect button */}
            <div ref={collectionBtnRef} className="relative">
              <button
                onClick={() => setShowCollectionPopover(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all hover:brightness-110"
                style={{
                  background: membershipSet.size > 0
                    ? 'oklch(0.769 0.188 70.08 / 0.2)'
                    : showCollectionPopover ? 'oklch(0.22 0.01 264 / 0.9)' : 'oklch(0.15 0.01 264 / 0.85)',
                  border: membershipSet.size > 0
                    ? '1px solid oklch(0.769 0.188 70.08 / 0.5)'
                    : '1px solid oklch(1 0 0 / 0.15)',
                  color: membershipSet.size > 0
                    ? 'oklch(0.769 0.188 70.08)'
                    : 'oklch(0.65 0.01 264)',
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
                {membershipSet.size > 0 ? `${membershipSet.size} Collection${membershipSet.size !== 1 ? 's' : ''}` : 'Collect'}
              </button>

              {/* Popover */}
              {showCollectionPopover && (
                <AddToWorldCollectionPopover
                  worldExternalId={world.external_id}
                  collections={worldCollections}
                  membershipSet={membershipSet}
                  onToggle={handleToggleMembership}
                  onCreate={handleCreateCollection}
                  onClose={() => setShowCollectionPopover(false)}
                />
              )}
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-sm transition-colors hover:brightness-125"
              style={{
                background: 'oklch(0.15 0.01 264 / 0.85)',
                border: '1px solid oklch(1 0 0 / 0.15)',
                color: 'oklch(0.7 0.005 65)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {/* Privacy + interaction count */}
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
            <PrivacyBadgeLarge status={world.privacy_status} />
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-semibold"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.12 0.01 264 / 0.85)',
                border: '1px solid oklch(1 0 0 / 0.12)',
                color: 'oklch(0.7 0.005 65)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <Eye size={12} strokeWidth={2} style={{ color: 'oklch(0.769 0.188 70.08)' }} />
              {formatCount(world.interaction_count)}
            </span>
          </div>

          {/* Title overlay */}
          <div className="absolute bottom-4 left-4 right-4 z-20">
            <h2
              className="text-2xl font-bold tracking-wide leading-tight"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                color: 'oklch(0.95 0.005 65)',
                textShadow: '0 2px 12px rgba(0,0,0,0.8)',
              }}
            >
              {world.name}
            </h2>
            <p
              className="text-sm mt-1"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.55 0.01 264)' }}
            >
              by {ownerName}
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div
          className="sticky top-0 z-30 flex items-center gap-1 px-4 py-2"
          style={{
            background: 'oklch(0.11 0.008 264 / 0.95)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid oklch(1 0 0 / 0.07)',
          }}
        >
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all"
                style={{
                  fontFamily: 'Rajdhani, sans-serif',
                  background: isActive ? 'oklch(0.769 0.188 70.08 / 0.15)' : 'transparent',
                  border: isActive ? '1px solid oklch(0.769 0.188 70.08 / 0.4)' : '1px solid transparent',
                  color: isActive ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.5 0.01 264)',
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className="inline-flex items-center justify-center rounded-sm px-1 min-w-[16px] h-[14px] text-[9px] font-bold"
                    style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.1)', color: 'inherit' }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="px-4 py-6">
          {/* Loading state */}
          {isLoadingDetail && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-t-transparent rounded-full" style={{ borderColor: 'oklch(0.769 0.188 70.08)', borderTopColor: 'transparent' }} />
            </div>
          )}

          {/* Overview tab */}
          {activeTab === 'overview' && !isLoadingDetail && (
            <div className="space-y-6">
              {/* Logline */}
              <div>
                <SectionLabel label="Logline" />
                <p
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'oklch(0.82 0.005 65)',
                    fontSize: '13px',
                    lineHeight: '1.7',
                  }}
                >
                  {detail?.world.logline || world.logline || 'No description available.'}
                </p>
              </div>

              {/* Author note */}
              {detail?.world.author_note && (
                <div>
                  <SectionLabel label="Author Note" />
                  <p
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'oklch(0.7 0.005 65)',
                      fontSize: '12px',
                      lineHeight: '1.6',
                      fontStyle: 'italic',
                    }}
                  >
                    {detail.world.author_note}
                  </p>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <SectionLabel label="Tags" />
                  <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-medium"
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          background: tag.is_fandom ? 'oklch(0.25 0.08 280 / 0.4)' : 'oklch(0.18 0.01 264)',
                          border: tag.is_fandom ? '1px solid oklch(0.55 0.12 280 / 0.5)' : '1px solid oklch(1 0 0 / 0.1)',
                          color: tag.is_fandom ? 'oklch(0.75 0.12 280)' : 'oklch(0.65 0.01 264)',
                        }}
                      >
                        {tag.emoji && <span>{tag.emoji}</span>}
                        {tag.name}
                        {tag.is_fandom && (
                          <span className="text-[9px] uppercase tracking-wider ml-1" style={{ color: 'oklch(0.6 0.1 280)' }}>fandom</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div>
                <SectionLabel label="Stats" />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div
                    className="px-3 py-2.5 rounded-sm"
                    style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.08)' }}
                  >
                    <p className="text-[10px] uppercase tracking-widest" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.45 0.01 264)', fontWeight: 600 }}>Interactions</p>
                    <p className="text-lg font-bold mt-0.5" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}>
                      {formatCount(world.interaction_count)}
                    </p>
                  </div>
                  <div
                    className="px-3 py-2.5 rounded-sm"
                    style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.08)' }}
                  >
                    <p className="text-[10px] uppercase tracking-widest" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.45 0.01 264)', fontWeight: 600 }}>Characters</p>
                    <p className="text-lg font-bold mt-0.5" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}>
                      {characters.length}
                    </p>
                  </div>
                  {detail?.like_count !== undefined && (
                    <div
                      className="px-3 py-2.5 rounded-sm"
                      style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.08)' }}
                    >
                      <p className="text-[10px] uppercase tracking-widest" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.45 0.01 264)', fontWeight: 600 }}>Likes</p>
                      <p className="text-lg font-bold mt-0.5" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}>
                        {detail.like_count}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Characters tab */}
          {activeTab === 'characters' && !isLoadingDetail && (
            <div className="space-y-4">
              {characters.length === 0 ? (
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.4 0.01 264)' }}>
                  No characters in this world.
                </p>
              ) : (
                <>
                  {characters.filter(c => c.is_main).map(char => (
                    <div
                      key={char.external_id}
                      className="flex gap-3 p-3 rounded-sm"
                      style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(0.769 0.188 70.08 / 0.3)' }}
                    >
                      {char.display_headshot_url || char.headshot_url ? (
                        <img src={char.display_headshot_url || char.headshot_url || ''} alt={char.name} className="w-16 h-16 rounded-sm object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-sm flex-shrink-0 flex items-center justify-center" style={{ background: 'oklch(0.18 0.01 264)' }}>
                          <Users size={20} style={{ color: 'oklch(0.3 0.01 264)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold tracking-wide" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)' }}>{char.name}</h4>
                          <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm" style={{ fontFamily: 'Rajdhani, sans-serif', background: 'oklch(0.769 0.188 70.08 / 0.15)', border: '1px solid oklch(0.769 0.188 70.08 / 0.3)', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}>Main</span>
                        </div>
                        <p className="text-[11px] mt-1 line-clamp-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.55 0.01 264)', lineHeight: '1.5' }}>{char.backstory}</p>
                      </div>
                    </div>
                  ))}
                  {characters.filter(c => !c.is_main).map(char => (
                    <div
                      key={char.external_id}
                      className="flex gap-3 p-3 rounded-sm"
                      style={{ background: 'oklch(0.14 0.008 264)', border: '1px solid oklch(1 0 0 / 0.07)' }}
                    >
                      {char.display_headshot_url || char.headshot_url ? (
                        <img src={char.display_headshot_url || char.headshot_url || ''} alt={char.name} className="w-14 h-14 rounded-sm object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-sm flex-shrink-0 flex items-center justify-center" style={{ background: 'oklch(0.18 0.01 264)' }}>
                          <Users size={18} style={{ color: 'oklch(0.3 0.01 264)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold tracking-wide" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.88 0.005 65)' }}>{char.name}</h4>
                        <p className="text-[11px] mt-1 line-clamp-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.5 0.01 264)', lineHeight: '1.5' }}>{char.backstory}</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Related Worlds tab */}
          {activeTab === 'related' && !isLoadingDetail && (
            <div className="space-y-3">
              {relatedWorlds.length === 0 ? (
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'oklch(0.4 0.01 264)' }}>
                  No related worlds found.
                </p>
              ) : (
                relatedWorlds.map(rw => (
                  <div key={rw.external_id} className="flex gap-3 p-3 rounded-sm" style={{ background: 'oklch(0.14 0.008 264)', border: '1px solid oklch(1 0 0 / 0.07)' }}>
                    {rw.cover_image_url ? (
                      <img src={rw.cover_image_url} alt={rw.name} className="w-20 h-14 rounded-sm object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-20 h-14 rounded-sm flex-shrink-0 flex items-center justify-center" style={{ background: 'oklch(0.18 0.01 264)' }}>
                        <Compass size={18} style={{ color: 'oklch(0.3 0.01 264)' }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold tracking-wide truncate" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.88 0.005 65)' }}>{rw.name}</h4>
                        {rw.tag_name && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-sm flex-shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace', background: rw.tag_is_fandom ? 'oklch(0.25 0.08 280 / 0.3)' : 'oklch(0.18 0.01 264)', border: rw.tag_is_fandom ? '1px solid oklch(0.5 0.1 280 / 0.4)' : '1px solid oklch(1 0 0 / 0.08)', color: rw.tag_is_fandom ? 'oklch(0.7 0.1 280)' : 'oklch(0.5 0.01 264)' }}>{rw.tag_name}</span>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>by {rw.owner.username} · {formatCount(rw.interaction_count)} plays</p>
                      <p className="text-[11px] mt-1 line-clamp-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.5 0.01 264)', lineHeight: '1.4' }}>{rw.logline}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
