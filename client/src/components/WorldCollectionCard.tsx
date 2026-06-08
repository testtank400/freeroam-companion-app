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
    private: { icon: <Lock size={10} strokeWidth={2.5} />, className: 'badge-private' },
    public:  { icon: <Globe size={10} strokeWidth={2.5} />, className: 'badge-public' },
    unlisted: { icon: <Link size={10} strokeWidth={2.5} />, className: 'badge-linked' },
  };
  const { icon, className } = config[status];
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-sm ${className}`}>
      {icon}
    </span>
  );
}

export default function WorldCollectionCard({ collection, previewCovers = [], onClick }: WorldCollectionCardProps) {
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
