// WorldCard.tsx
// Design: Tactical Dark Ops — landscape card for worlds
// Click → opens Freeroam world page in new tab
// Info button (top-right) → opens WorldProfile modal
// Larger image area to prevent badge crowding

import { Globe, Link, Lock, Eye, FileEdit, BookOpen } from 'lucide-react';
import React from 'react';

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
  /** Called when the info button is clicked — opens the WorldProfile modal */
  onOpenModal: (world: ApiWorld) => void;
  /** Called when the card body is clicked — opens the story reader */
  onOpenReader?: (world: ApiWorld) => void;
  /** Called for Ctrl/Cmd click — bulk select toggle */
  onSelect: (world: ApiWorld, e: React.MouseEvent) => void;
  /** Active search query — matching portion of the name is highlighted in amber */
  searchQuery?: string;
  isSelected?: boolean;
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
    private: { label: 'Private', icon: <Lock size={11} strokeWidth={2.5} />, className: 'badge-private' },
    public:  { label: 'Public',  icon: <Globe size={11} strokeWidth={2.5} />, className: 'badge-public' },
    unlisted:{ label: 'Unlisted',icon: <Link size={11} strokeWidth={2.5} />, className: 'badge-linked' },
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

export default function WorldCard({ world, onOpenModal, onOpenReader, onSelect, searchQuery = '', isSelected = false }: WorldCardProps) {
  const imageUrl = world.cover_image_url || FALLBACK_IMAGE;

  const handleCardClick = (e: React.MouseEvent) => {
    // Ctrl/Cmd click → bulk select
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      onSelect(world, e);
      return;
    }
    // Normal click → open story reader
    if (onOpenReader) {
      onOpenReader(world);
    }
  };

  return (
    <div
      className="char-card relative flex flex-col rounded-sm overflow-hidden cursor-pointer"
      style={{
        background: 'oklch(0.13 0.01 264)',
        border: isSelected ? '1px solid oklch(0.769 0.188 70.08 / 0.8)' : '1px solid oklch(1 0 0 / 0.07)',
        boxShadow: isSelected ? '0 0 0 2px oklch(0.769 0.188 70.08 / 0.25)' : undefined,
      }}
      onClick={handleCardClick}
    >
      {/* Selection overlay */}
      {isSelected && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{ background: 'oklch(0.769 0.188 70.08 / 0.08)' }}
        />
      )}
      {/* Selection checkbox */}
      {isSelected && (
        <div
          className="absolute top-2 right-2 z-30 w-5 h-5 rounded-sm flex items-center justify-center"
          style={{
            background: 'oklch(0.769 0.188 70.08)',
            border: '1px solid oklch(0.769 0.188 70.08)',
          }}
        >
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="oklch(0.11 0.009 264)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}

      {/* Image area — taller to give badges room */}
      <div className="relative w-full" style={{ paddingBottom: '90%' }}>
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

        {/* Top-left: Privacy (row 1), Interactions (row 2), Draft (row 3) */}
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
          <PrivacyBadge status={world.privacy_status} />
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
            <BookOpen size={11} strokeWidth={2} style={{ color: 'oklch(0.769 0.188 70.08)' }} />
            {formatCount(world.interaction_count)}
          </span>
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

        {/* Top-right: View details button only */}
        {!isSelected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenModal(world);
            }}
            className="absolute top-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded-sm transition-all hover:brightness-125"
            style={{
              background: 'oklch(0.12 0.01 264 / 0.85)',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.65 0.01 264)',
              backdropFilter: 'blur(4px)',
            }}
            title="View details"
          >
            <Eye size={13} strokeWidth={2} />
          </button>
        )}

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
