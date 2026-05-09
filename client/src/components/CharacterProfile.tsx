// CharacterProfile.tsx
// Design: Tactical Dark Ops — full-screen modal overlay
// Shows backstory and description from the live API
// Two tabs: About and Appearance (description)

import { ApiCharacter } from '@/pages/Home';
import { Globe, Link, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CharacterProfileProps {
  character: ApiCharacter | null;
  onClose: () => void;
}

type Tab = 'about' | 'appearance';
type PrivacyStatus = 'private' | 'public' | 'linked';

function PrivacyBadgeLarge({ status }: { status: PrivacyStatus }) {
  const config = {
    private: {
      label: 'Private',
      icon: <Lock size={13} strokeWidth={2.5} />,
      className: 'badge-private',
    },
    public: {
      label: 'Public',
      icon: <Globe size={13} strokeWidth={2.5} />,
      className: 'badge-public',
    },
    linked: {
      label: 'Linked',
      icon: <Link size={13} strokeWidth={2.5} />,
      className: 'badge-linked',
    },
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
        className="text-sm leading-relaxed"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.82 0.005 65)', fontSize: '12px' }}
      >
        {value}
      </span>
    </div>
  );
}

const FALLBACK_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWEyNCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMzMzMzQ0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';

export default function CharacterProfile({ character, onClose }: CharacterProfileProps) {
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (character) {
      setActiveTab('about');
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [character]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!character) return null;

  const imageUrl = character.display_headshot_url || character.headshot_url || FALLBACK_IMAGE;
  const hasDescription = character.description && character.description.trim().length > 0;

  return (
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
              alt={character.name}
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

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:bg-white/10"
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

          {/* Name + creator + badge */}
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2
                  className="text-3xl sm:text-4xl font-bold tracking-wide leading-none"
                  style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.97 0.005 65)' }}
                >
                  {character.name}
                </h2>
                <p
                  className="text-xs mt-1"
                  style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.5 0.01 264)' }}
                >
                  by {character.owner.display_name}
                </p>
              </div>
              <div className="flex-shrink-0 mb-1">
                <PrivacyBadgeLarge status={character.privacy_status} />
              </div>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div
          className="flex-shrink-0 flex"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)' }}
        >
          {(['about', 'appearance'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative px-6 py-3 text-sm font-semibold tracking-widest uppercase transition-colors"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                color: activeTab === tab ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.5 0.01 264)',
                background: 'transparent',
                borderBottom: activeTab === tab ? '2px solid oklch(0.769 0.188 70.08)' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'about' && (
            <div className="p-6">
              <InfoRow label="Name" value={character.name} />
              <InfoRow label="Owner" value={character.owner.display_name} />
              <InfoRow label="Visibility" value={character.privacy_status.charAt(0).toUpperCase() + character.privacy_status.slice(1)} />
              <InfoRow label="Type" value={character.is_persona ? 'Persona' : 'Character'} />
              <div className="py-4">
                <SectionLabel label="Backstory" />
                <p
                  className="leading-loose whitespace-pre-wrap"
                  style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                >
                  {character.backstory || 'No backstory provided.'}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="p-6">
              {hasDescription ? (
                <div className="py-2">
                  <SectionLabel label="Appearance Description" />
                  <p
                    className="leading-loose whitespace-pre-wrap"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                  >
                    {character.description}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <p
                    style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '16px', fontWeight: 700, color: 'oklch(0.35 0.01 264)' }}
                  >
                    NO APPEARANCE DATA
                  </p>
                  <p
                    style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'oklch(0.3 0.01 264)' }}
                  >
                    This character has no appearance description on file.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
