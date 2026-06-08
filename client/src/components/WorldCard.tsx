// WorldCard.tsx
// Design: Tactical Dark Ops — landscape/portrait card for worlds,
// cover image with gradient overlay, amber glow on hover,
// privacy badge top-left, interaction count top-right, draft badge
// Uses ApiWorld shape from the worlds router

import { Globe, Link, Lock, Eye, FileEdit } from 'lucide-react';

export type PrivacyStatus = 'private' | 'public' | 'unlisted';

export interface ApiWorld {
  external_id: string;
  name: string;
  cover_image_url: string | null;
  avg_color: { r: number; g: number; b: number } | null;
  logline: string;
  description: string;
  interaction_count: number;
  owner: { username: string; is_verified: boolean };
  privacy_status: PrivacyStatus;
  is_draft: boolean;
}

interface WorldCardProps {
  world: ApiWorld;
  onClick: (world: ApiWorld) => void;
  /** Active search query — matching portion of the name is highlighted in amber */
  searchQuery?: string;
}

/** Splits text into segments and wraps the matching part in an amber span */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase().trim());
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.trim().length);
  const after = text.slice(idx + query.trim().length);
  return (
    <>
      {before}
      <span style={{ color: 'oklch(0.769 0.188 70.08)', fontWeight: 800 }}>{match}</span>
      {after}
    </>
  );
}

function PrivacyBadge({ status }: { status: PrivacyStatus }) {
  const config = {
    private: {
      label: 'Private',
      icon: <Lock size={11} strokeWidth={2.5} />,
      className: 'badge-private',
    },
    public: {
      label: 'Public',
      icon: <Globe size={11} strokeWidth={2.5} />,
      className: 'badge-public',
    },
    unlisted: {
      label: 'Unlisted',
      icon: <Link size={11} strokeWidth={2.5} />,
      className: 'badge-linked',
    },
  };

  const { label, icon, className } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium tracking-wider uppercase ${className}`}
      style={{ fontFamily: 'Rajdhani, sans-serif' }}
    >
      {icon}
      {label}
    </span>
  );
}

/** Format interaction count (e.g. 12500 -> "12.5k") */
function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

// Fallback placeholder image for worlds without a cover
const FALLBACK_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iIzFhMWEyNCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMzMzMzQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+';

export default function WorldCard({ world, onClick, searchQuery = '' }: WorldCardProps) {
  const imageUrl = world.cover_image_url || FALLBACK_IMAGE;

  return (
    <div
      className="char-card relative flex flex-col rounded-sm overflow-hidden cursor-pointer"
      style={{
        background: 'oklch(0.13 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.07)',
      }}
      onClick={() => onClick(world)}
    >
      {/* Image area — landscape aspect ratio for worlds */}
      <div className="relative w-full" style={{ paddingBottom: '75%' }}>
        <img
          src={imageUrl}
          alt={world.name}
          className="absolute inset-0 w-full h-full object-cover object-center"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
          }}
        />
        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 20%, oklch(0.13 0.01 264 / 0.7) 60%, oklch(0.13 0.01 264) 100%)',
          }}
        />

        {/* Top-left: Privacy badge */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          <PrivacyBadge status={world.privacy_status} />
          {world.is_draft && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium tracking-wider uppercase"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.65 0.15 50 / 0.2)',
                border: '1px solid oklch(0.65 0.15 50 / 0.4)',
                color: 'oklch(0.75 0.15 50)',
              }}
            >
              <FileEdit size={10} strokeWidth={2.5} />
              Draft
            </span>
          )}
        </div>

        {/* Top-right: Interaction count */}
        <div className="absolute top-3 right-3 z-10">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-semibold"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: 'oklch(0.12 0.01 264 / 0.85)',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.7 0.005 65)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <Eye size={11} strokeWidth={2} style={{ color: 'oklch(0.769 0.188 70.08)' }} />
            {formatCount(world.interaction_count)}
          </span>
        </div>

        {/* World name overlay at bottom of image */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 z-10">
          <h3
            className="text-lg font-bold leading-tight tracking-wide"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              color: 'oklch(0.95 0.005 65)',
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            <HighlightedText text={world.name} query={searchQuery} />
          </h3>
          <p
            className="text-xs mt-0.5"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: 'oklch(0.55 0.01 264)',
            }}
          >
            by {world.owner.username}
          </p>
        </div>
      </div>

      {/* Logline text area */}
      <div
        className="px-3 pt-2 pb-3 flex-1"
        style={{ borderTop: '1px solid oklch(1 0 0 / 0.06)' }}
      >
        <p
          className="line-clamp-3"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: 'oklch(0.55 0.01 264)',
            fontSize: '11px',
            lineHeight: '1.6',
          }}
        >
          {world.logline || world.description || 'No description provided.'}
        </p>
      </div>
    </div>
  );
}
