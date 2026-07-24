// ProfileWorldCard.tsx
// Freeroam-style discovery card for Liked / Saved worlds (often not owned).
// Landscape cover, tag + play-count pills, title + creator on image, logline below.

import React from 'react';

/** Shared shape from /api/profile/liked-worlds and /api/profile/saved-worlds */
export interface ApiProfileWorld {
  external_id: string;
  name: string;
  cover_image_url: string | null;
  avg_color: { r: number; g: number; b: number } | null;
  logline: string;
  interaction_count: number;
  owner_username: string;
  owner_display_name: string | null;
  owner_is_verified: boolean;
  tag_name: string | null;
  tag_is_fandom: boolean;
  is_phone_experiment_world?: boolean;
}

/** @deprecated alias — same as ApiProfileWorld */
export type ApiLikedWorld = ApiProfileWorld;

interface ProfileWorldCardProps {
  world: ApiProfileWorld;
  onOpen: (world: ApiProfileWorld) => void;
  searchQuery?: string;
}

const FALLBACK_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzEyMTIxOCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiM0NDQ0NTUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5OTyBDT1ZFUjwvdGV4dD48L3N2Zz4=';

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

function formatCount(count: number): string {
  if (count >= 1_000_000) {
    const v = count / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const v = count / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return count.toString();
}

/** Stable soft avatar color from a string */
function avatarHue(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 45% 42%)`;
}

export default function ProfileWorldCard({ world, onOpen, searchQuery = '' }: ProfileWorldCardProps) {
  const imageUrl = world.cover_image_url || FALLBACK_IMAGE;
  const ownerLabel = world.owner_display_name || world.owner_username || 'Unknown';
  const initial = (ownerLabel.trim().charAt(0) || '?').toUpperCase();
  const tag = world.tag_name?.trim() || null;

  return (
    <div
      className="group flex flex-col overflow-hidden cursor-pointer transition-[transform,box-shadow] duration-200 hover:brightness-[1.04]"
      style={{
        borderRadius: 12,
        background: 'oklch(0.16 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.06)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
      }}
      onClick={() => onOpen(world)}
      title={world.name}
    >
      {/* Landscape cover */}
      <div className="relative w-full overflow-hidden" style={{ paddingBottom: '56%' }}>
        <img
          src={imageUrl}
          alt={world.name}
          className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
          }}
        />

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.15) 100%)',
          }}
        />

        {/* Tag — top left */}
        {tag && (
          <span
            className="absolute top-3 left-3 z-10 max-w-[55%] truncate px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              borderRadius: 9999,
              background: 'rgba(40,40,48,0.72)',
              color: 'oklch(0.92 0.005 65)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {tag}
          </span>
        )}

        {/* Play / interactions — top right */}
        <span
          className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold tabular-nums"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            borderRadius: 9999,
            background: 'rgba(40,40,48,0.72)',
            color: 'oklch(0.88 0.005 65)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
            <path d="M2.2 1.2v7.6L8.6 5 2.2 1.2z" />
          </svg>
          {formatCount(world.interaction_count)}
        </span>

        {/* Title + creator on image */}
        <div className="absolute bottom-0 left-0 right-0 z-10 px-3.5 pb-3 pt-8">
          <h3
            className="text-lg font-bold leading-tight tracking-wide line-clamp-2"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              color: 'oklch(0.95 0.005 65)',
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            <HighlightedText text={world.name} query={searchQuery} />
          </h3>
          <div className="mt-1.5 flex items-center gap-2 min-w-0">
            <span
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: avatarHue(ownerLabel),
              }}
            >
              {initial}
            </span>
            <span
              className="truncate text-xs"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                color: 'oklch(0.7 0.005 65)',
              }}
            >
              by {ownerLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Logline body */}
      {(world.logline ?? '').trim() && (
        <div className="px-3.5 py-3" style={{ borderTop: '1px solid oklch(1 0 0 / 0.06)' }}>
          <p
            className="line-clamp-3"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: 'oklch(0.55 0.01 264)',
              fontSize: '11px',
              lineHeight: '1.6',
            }}
          >
            <HighlightedText text={world.logline} query={searchQuery} />
          </p>
        </div>
      )}
    </div>
  );
}
