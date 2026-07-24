// JourneyCard.tsx
// Continue-playing card for profile journeys (may be worlds the user does not own).
// Layout mirrors freeroam Journeys: full-bleed panel art, single PAGE pill, title below.

import React from 'react';

export interface ApiJourney {
  world_id: number;
  world_external_id: string;
  world_name: string;
  panel_id: number;
  panel_external_id: string;
  panel_image: string | null;
  panel_depth: number;
  updated_at: string;
}

interface JourneyCardProps {
  journey: ApiJourney;
  onResume: (journey: ApiJourney) => void;
  searchQuery?: string;
}

const FALLBACK_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iIzBhMGEwZiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiMzMzMzNDQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5OTyBQRU5FTDwvdGV4dD48L3N2Zz4=';

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

export default function JourneyCard({ journey, onResume, searchQuery = '' }: JourneyCardProps) {
  const imageUrl = journey.panel_image || FALLBACK_IMAGE;

  return (
    <div
      className="group relative flex flex-col cursor-pointer"
      onClick={() => onResume(journey)}
      title="Continue journey"
    >
      {/* Portrait panel — freeroam-style tall cover */}
      <div
        className="relative w-full overflow-hidden rounded-md transition-[transform,box-shadow] duration-200 group-hover:brightness-110"
        style={{
          paddingBottom: '140%',
          background: 'oklch(0.1 0.01 264)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        }}
      >
        <img
          src={imageUrl}
          alt={journey.world_name}
          className="absolute inset-0 w-full h-full object-cover object-center"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
          }}
        />

        {/* Soft scrim only under the PAGE pill so art stays clean */}
        <div
          className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{
            height: '35%',
            background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)',
          }}
        />

        {/* PAGE pill — freeroam purple, bottom-left on image */}
        <span
          className="absolute bottom-3 left-3 z-10 inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold tracking-wider uppercase"
          style={{
            fontFamily: 'Rajdhani, sans-serif',
            borderRadius: 9999,
            background: 'rgba(139, 92, 246, 0.92)',
            color: '#fff',
            letterSpacing: '0.06em',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          PAGE {journey.panel_depth}
        </span>
      </div>

      {/* Title below image — same stack as My Worlds */}
      <h3
        className="mt-2.5 px-0.5 text-base font-bold leading-tight tracking-wide line-clamp-2"
        style={{
          fontFamily: 'Rajdhani, sans-serif',
          color: 'oklch(0.95 0.005 65)',
        }}
      >
        <HighlightedText text={journey.world_name} query={searchQuery} />
      </h3>
    </div>
  );
}
