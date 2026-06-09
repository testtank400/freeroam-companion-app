// WorldCollectionCard.tsx
// Portrait card for a Freeroam world collection — same visual language as CollectionCard.
// Shows cover image (or a placeholder grid of world covers),
// collection name, world count, and privacy status.

import { Globe, Link, Lock, FolderOpen } from 'lucide-react';

export interface ApiWorldCollection {
  external_id: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  privacy_status: 'private' | 'public' | 'unlisted';
  owner: { username: string; avatar_url: string | null; is_verified: boolean };
  world_count: number;
  is_owner: boolean;
}

interface WorldCollectionCardProps {
  collection: ApiWorldCollection;
  /** Preview world covers to show in the placeholder grid */
  previewCovers?: (string | null)[];
  onClick: (collection: ApiWorldCollection) => void;
  onEdit?: (collection: ApiWorldCollection) => void;
  onDelete?: (collection: ApiWorldCollection) => void;
}

const FALLBACK = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWEyNCIvPjwvc3ZnPg==';

/** 2×2 grid of world cover images used when no collection cover is set */
function CoverGrid({ covers }: { covers: (string | null)[] }) {
  const slots = [0, 1, 2, 3].map(i => covers[i] ?? null);
  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
      {slots.map((src, i) => (
        <div key={i} className="overflow-hidden" style={{ background: 'oklch(0.16 0.01 264)' }}>
          {src && (
            <img
              src={src}
              alt=""
              className="w-full h-full object-cover object-center"
              onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PrivacyDot({ status }: { status: 'private' | 'public' | 'unlisted' }) {
  const config = {
    private: { icon: <Lock size={14} strokeWidth={2.5} />, className: 'badge-private' },
    public:  { icon: <Globe size={14} strokeWidth={2.5} />, className: 'badge-public' },
    unlisted: { icon: <Link size={14} strokeWidth={2.5} />, className: 'badge-linked' },
  };
  const { icon, className } = config[status];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm ${className}`}
      style={{ width: '32px', height: '32px', minWidth: '32px' }}
    >
      {icon}
    </span>
  );
}

export default function WorldCollectionCard({ collection, previewCovers = [], onClick, onEdit, onDelete }: WorldCollectionCardProps) {
  const hasCover = !!collection.cover_image_url;

  return (
    <div
      className="group char-card relative flex flex-col rounded-sm overflow-hidden cursor-pointer"
      style={{
        background: 'oklch(0.13 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.07)',
      }}
      onClick={() => onClick(collection)}
    >
      {/* Image area */}
      <div className="relative w-full" style={{ paddingBottom: '115%' }}>
        {hasCover ? (
          <img
            src={collection.cover_image_url!}
            alt={collection.name}
            className="absolute inset-0 w-full h-full object-cover object-center"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : previewCovers.some(Boolean) ? (
          <CoverGrid covers={previewCovers} />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2"
            style={{ background: 'oklch(0.15 0.01 264)' }}
          >
            <FolderOpen size={32} style={{ color: 'oklch(0.3 0.01 264)' }} />
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.35 0.01 264)' }}
            >
              Empty
            </span>
          </div>
        )}

        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, oklch(0.13 0.01 264 / 0.85) 70%, oklch(0.13 0.01 264) 100%)',
          }}
        />

        {/* Top-left: privacy dot */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <PrivacyDot status={collection.privacy_status} />
        </div>

        {/* Top-right: Edit + Delete (always visible on mobile, hover on desktop, owner only) */}
        {(onEdit || onDelete) && (
          <div className="absolute top-2.5 right-2.5 z-10 flex gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(collection); }}
                className="flex items-center justify-center rounded-sm transition-colors hover:text-amber-400"
                style={{
                  background: 'oklch(0.18 0.01 264 / 0.85)',
                  border: '1px solid oklch(1 0 0 / 0.12)',
                  color: 'oklch(0.7 0.005 65)',
                  backdropFilter: 'blur(4px)',
                  width: '32px',
                  height: '32px',
                  minWidth: '32px',
                }}
                title="Edit collection"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(collection); }}
                className="flex items-center justify-center rounded-sm transition-colors hover:text-red-400"
                style={{
                  background: 'oklch(0.18 0.01 264 / 0.85)',
                  border: '1px solid oklch(1 0 0 / 0.12)',
                  color: 'oklch(0.7 0.005 65)',
                  backdropFilter: 'blur(4px)',
                  width: '32px',
                  height: '32px',
                  minWidth: '32px',
                }}
                title="Delete collection"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            )}
          </div>
        )}

        {/* Collection name + world count overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 z-10">
          <h3
            className="text-xl font-bold leading-tight tracking-wide"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              color: 'oklch(0.95 0.005 65)',
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            {collection.name}
          </h3>
          <p
            className="text-xs mt-0.5"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: 'oklch(0.55 0.01 264)',
            }}
          >
            {collection.world_count} world{collection.world_count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
