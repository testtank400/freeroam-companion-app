// CharacterCard.tsx
// Design: Tactical Dark Ops — tall portrait card, gradient image overlay,
// amber glow on hover, privacy badge top-left, action buttons top-right

import { Character, PrivacyStatus } from '@/lib/characters';
import { Globe, Link, Lock, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface CharacterCardProps {
  character: Character;
  onClick: (character: Character) => void;
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

export default function CharacterCard({ character, onClick }: CharacterCardProps) {
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast.info('Edit feature coming soon');
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast.info('Delete feature coming soon');
  };

  return (
    <div
      className="char-card relative flex flex-col rounded-sm overflow-hidden cursor-pointer"
      style={{
        background: 'oklch(0.13 0.01 264)',
        border: '1px solid oklch(1 0 0 / 0.07)',
      }}
      onClick={() => onClick(character)}
    >
      {/* Image area — takes ~58% of card height */}
      <div className="relative w-full" style={{ paddingBottom: '115%' }}>
        <img
          src={character.image}
          alt={character.name}
          className="absolute inset-0 w-full h-full object-cover object-top"
          loading="lazy"
        />
        {/* Gradient overlay — transparent top to dark bottom */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, oklch(0.13 0.01 264 / 0.85) 70%, oklch(0.13 0.01 264) 100%)',
          }}
        />

        {/* Top-left: Privacy badge */}
        <div className="absolute top-3 left-3 z-10">
          <PrivacyBadge status={character.privacy} />
        </div>

        {/* Top-right: Action buttons */}
        <div className="absolute top-2.5 right-2.5 z-10 flex gap-1.5">
          <button
            onClick={handleEdit}
            className="w-7 h-7 flex items-center justify-center rounded-sm transition-colors"
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
            by {character.creator}
          </p>
        </div>
      </div>

      {/* Backstory text area */}
      <div
        className="px-3 pt-2 pb-3 flex-1"
        style={{ borderTop: '1px solid oklch(1 0 0 / 0.06)' }}
      >
        <p
          className="text-xs leading-relaxed line-clamp-4"
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            color: 'oklch(0.55 0.01 264)',
            fontSize: '11px',
          }}
        >
          {character.backstory}
        </p>
      </div>
    </div>
  );
}
