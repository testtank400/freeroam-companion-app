// CharacterProfile.tsx
// Design: Tactical Dark Ops — full-screen modal overlay
// Two tabs: About and Appearance
// Slide-up animation, backdrop blur, amber accent tabs

import { Character, PrivacyStatus } from '@/lib/characters';
import { Globe, Link, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CharacterProfileProps {
  character: Character | null;
  onClose: () => void;
}

type Tab = 'about' | 'appearance';

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
        style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.82 0.005 65)' }}
      >
        {value}
      </span>
    </div>
  );
}

export default function CharacterProfile({ character, onClose }: CharacterProfileProps) {
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (character) {
      setActiveTab('about');
      // Trigger animation after mount
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [character]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleClose();
  };

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!character) return null;

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
        {/* Header: image + name + close */}
        <div className="relative flex-shrink-0">
          {/* Background image strip */}
          <div className="relative h-48 sm:h-64 overflow-hidden">
            <img
              src={character.image}
              alt={character.name}
              className="w-full h-full object-cover object-top"
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

          {/* Name + creator + badge — overlaid on image bottom */}
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
                  by {character.creator}
                </p>
              </div>
              <div className="flex-shrink-0 mb-1">
                <PrivacyBadgeLarge status={character.privacy} />
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
            <div className="p-6 grid sm:grid-cols-2 gap-x-10 gap-y-0">
              <div>
                <InfoRow label="Full Name" value={character.about.fullName} />
                <InfoRow label="Designation" value={character.about.designation} />
                <InfoRow label="Affiliation" value={character.about.affiliation} />
                <InfoRow label="Rank" value={character.about.rank} />
                <InfoRow label="Origin" value={character.about.origin} />
              </div>
              <div>
                <div className="py-3">
                  <span
                    className="text-[10px] uppercase tracking-widest block mb-2"
                    style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
                  >
                    Biography
                  </span>
                  <p
                    className="text-sm leading-loose"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                  >
                    {character.about.bio}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="p-6 grid sm:grid-cols-2 gap-x-10 gap-y-0">
              <div>
                <InfoRow label="Height" value={character.appearance.height} />
                <InfoRow label="Build" value={character.appearance.build} />
                <InfoRow label="Hair" value={character.appearance.hair} />
                <InfoRow label="Eyes" value={character.appearance.eyes} />
                <InfoRow label="Distinguishing Features" value={character.appearance.distinguishingFeatures} />
                <InfoRow label="Equipment" value={character.appearance.equipment} />
              </div>
              <div>
                <div className="py-3">
                  <span
                    className="text-[10px] uppercase tracking-widest block mb-2"
                    style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
                  >
                    Description
                  </span>
                  <p
                    className="text-sm leading-loose"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.72 0.008 264)', fontSize: '12px' }}
                  >
                    {character.appearance.description}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
