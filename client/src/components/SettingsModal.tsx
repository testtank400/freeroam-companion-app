// SettingsModal.tsx
// Settings panel for per-user Freeroam cookie configuration.
// The cookie is stored in localStorage and sent as a header with each API request.
// The cookie value is NEVER read back or displayed — only a status indicator is shown.

import { useFreeroamCookie } from '@/hooks/useFreeroamCookie';
import { CheckCircle, Settings, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { hasCookie, setCookie, clearCookie } = useFreeroamCookie();
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState('');
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
      setInput('');
      setSaved(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setVisible(false);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleSave = () => {
    if (!input.trim()) return;
    setCookie(input.trim());
    setInput('');
    setSaved(true);
    // Reload the page so the new cookie takes effect for all pending queries
    setTimeout(() => window.location.reload(), 800);
  };

  const handleClear = () => {
    clearCookie();
    setSaved(false);
    setInput('');
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: `rgba(0,0,0,${visible ? '0.75' : '0'})`,
        backdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 0.2s ease, backdrop-filter 0.2s ease',
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-md rounded-sm overflow-hidden"
        style={{
          background: 'oklch(0.11 0.009 264)',
          border: '1px solid oklch(0.769 0.188 70.08 / 0.2)',
          transform: visible ? 'scale(1)' : 'scale(0.95)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.2s ease, opacity 0.2s ease',
          boxShadow: '0 0 0 1px oklch(0.769 0.188 70.08 / 0.1), 0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <div className="flex items-center gap-2">
            <Settings size={16} strokeWidth={2} style={{ color: 'oklch(0.769 0.188 70.08)' }} />
            <span
              className="text-sm font-bold tracking-widest uppercase"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.005 65)' }}
            >
              Settings
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-white/10 transition-colors"
            style={{ color: 'oklch(0.5 0.01 264)' }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">

          {/* Section: Freeroam Cookie */}
          <div>
            <p
              className="text-[11px] uppercase tracking-widest mb-1"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
            >
              Freeroam Session Cookie
            </p>

            {/* Status indicator */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-sm mb-3"
              style={{
                background: hasCookie ? 'oklch(0.55 0.15 145 / 0.1)' : 'oklch(0.65 0.22 25 / 0.08)',
                border: hasCookie ? '1px solid oklch(0.55 0.15 145 / 0.3)' : '1px solid oklch(0.65 0.22 25 / 0.25)',
              }}
            >
              {hasCookie ? (
                <CheckCircle size={14} style={{ color: 'oklch(0.65 0.15 145)', flexShrink: 0 }} />
              ) : (
                <XCircle size={14} style={{ color: 'oklch(0.65 0.22 25)', flexShrink: 0 }} />
              )}
              <span
                className="text-[11px]"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  color: hasCookie ? 'oklch(0.65 0.15 145)' : 'oklch(0.65 0.22 25)',
                }}
              >
                {hasCookie
                  ? 'Cookie set — your Freeroam characters will load'
                  : 'No cookie set — using site default (owner\'s characters)'}
              </span>
            </div>

            <p
              className="text-[11px] leading-relaxed mb-3"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
            >
              Paste your Freeroam session cookie to load your own characters. Get it from your browser's DevTools → Application → Cookies → getfreeroam.com.
            </p>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste your Freeroam cookie here..."
              rows={3}
              className="w-full rounded-sm px-3 py-2 text-[11px] resize-none outline-none transition-colors"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.15 0.01 264)',
                border: '1px solid oklch(1 0 0 / 0.1)',
                color: 'oklch(0.82 0.005 65)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
              onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
            />

            {saved && (
              <p className="mt-1 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.15 145)' }}>
                ✓ Cookie saved — reloading...
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderTop: '1px solid oklch(1 0 0 / 0.07)' }}
        >
          <button
            onClick={handleClear}
            disabled={!hasCookie}
            className="px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-30"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'transparent',
              border: '1px solid oklch(0.65 0.22 25 / 0.4)',
              color: 'oklch(0.65 0.22 25)',
            }}
          >
            Clear Cookie
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'transparent',
                border: '1px solid oklch(1 0 0 / 0.12)',
                color: 'oklch(0.5 0.01 264)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!input.trim()}
              className="px-4 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-40 hover:brightness-110"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.769 0.188 70.08 / 0.15)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.5)',
                color: 'oklch(0.769 0.188 70.08)',
              }}
            >
              Save Cookie
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
