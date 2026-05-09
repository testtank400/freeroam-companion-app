// CharacterCard.tsx
// Design: Tactical Dark Ops — tall portrait card, gradient image overlay,
// amber glow on hover, privacy badge top-left, action buttons top-right
// Uses ApiCharacter shape from getfreeroam API

import { ApiCharacter } from '@/pages/Home';
import { Globe, Link, Lock, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type PrivacyStatus = 'private' | 'public' | 'linked';

interface CharacterCardProps {
  character: ApiCharacter;
  onClick: (character: ApiCharacter) => void;
  onEdit: (character: ApiCharacter) => void;
  onDelete: (character: ApiCharacter) => void;
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
    linked: {
      label: 'Linked',
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

// Fallback placeholder image for characters without a headshot
const FALLBACK_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWEyNCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMzMzMzQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';

export default function CharacterCard({ character, onClick, onEdit, onDelete }: CharacterCardProps) {
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(character);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(character);
  };

  const imageUrl = character.display_headshot_url || character.headshot_url || FALLBACK_IMAGE;

  return (
    <div
      className="char-card relative flex flex-col rounded-sm overflow-hidden cursor-pointer"
      style={{
        background: 'oklch(0.13 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.07)',
      }}
      onClick={() => onClick(character)}
    >
      {/* Image area */}
      <div className="relative w-full" style={{ paddingBottom: '115%' }}>
        <img
          src={imageUrl}
          alt={character.name}
          className="absolute inset-0 w-full h-full object-cover object-top"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
          }}
        />
        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, oklch(0.13 0.01 264 / 0.85) 70%, oklch(0.13 0.01 264) 100%)',
          }}
        />

        {/* Top-left: Privacy badge */}
        <div className="absolute top-3 left-3 z-10">
          <PrivacyBadge status={character.privacy_status} />
        </div>

        {/* Top-right: Action buttons */}
        <div className="absolute top-2.5 right-2.5 z-10 flex gap-1.5">
          <button
            onClick={handleEdit}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors hover:text-amber-400"
            style={{
              background: 'oklch(0.18 0.01 264 / 0.85)',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.7 0.005 65)',
              backdropFilter: 'blur(4px)',
            }}
            title="Edit character"
          >
            <Pencil size={13} strokeWidth={2} />
          </button>
          <button
            onClick={handleDelete}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors hover:text-red-400"
            style={{
              background: 'oklch(0.18 0.01 264 / 0.85)',
              border: '1px solid oklch(1 0 0 / 0.12)',
              color: 'oklch(0.7 0.005 65)',
              backdropFilter: 'blur(4px)',
            }}
            title="Delete character"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Character name overlay at bottom of image */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 z-10">
          <h3
            className="text-xl font-bold leading-tight tracking-wide"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              color: 'oklch(0.95 0.005 65)',
              textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            }}
          >
            {character.name}
          </h3>
          <p
            className="text-xs mt-0.5"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: 'oklch(0.55 0.01 264)',
            }}
          >
            by {character.owner.display_name}
          </p>
        </div>
      </div>

      {/* Backstory text area */}
      <div
        className="px-3 pt-2 pb-3 flex-1"
        style={{ borderTop: '1px solid oklch(1 0 0 / 0.06)' }}
      >
        <p
          className="line-clamp-4"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: 'oklch(0.55 0.01 264)',
            fontSize: '11px',
            lineHeight: '1.6',
          }}
        >
          {character.backstory || 'No backstory provided.'}
        </p>
      </div>
    </div>
  );
}
