// SettingsModal.tsx
// Settings panel for per-user Freeroam cookie configuration.
// On save, calls verifySession to validate the cookie and get the user's accountId.
// The cookie value is NEVER read back or displayed — only a status indicator is shown.

import { useFreeroamCookie } from '@/hooks/useFreeroamCookie';
import { trpc } from '@/lib/trpc';
import { CheckCircle, Loader2, Settings, User, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { hasCookie, identity, saveIdentity, clearCookie } = useFreeroamCookie();
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error' | 'expired'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const verifyMutation = trpc.freeroam.verifySession.useMutation({
    onSuccess: (data) => {
      saveIdentity(input.trim(), data.accountId, data.username);
      setStatus('success');
      setInput('');
      // Reload so the new cookie + accountId take effect for all queries
      setTimeout(() => window.location.reload(), 1000);
    },
    onError: (err) => {
      if (err.message.includes('SESSION_EXPIRED')) {
        setStatus('expired');
      } else {
        setStatus('error');
        setErrorMsg(err.message);
      }
    },
  });

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
      setInput('');
      setStatus('idle');
      setErrorMsg('');
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
    setStatus('verifying');
    setErrorMsg('');
    verifyMutation.mutate({ cookie: input.trim() });
  };

  const handleClear = () => {
    clearCookie();
    setStatus('idle');
    setInput('');
    setTimeout(() => window.location.reload(), 300);
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
              Freeroam Session
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
                  ? 'Session active'
                  : 'No session — paste your cookie below to connect'}
              </span>
            </div>

            {/* Identity info */}
            {identity && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-sm mb-3"
                style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(1 0 0 / 0.08)' }}
              >
                <User size={13} style={{ color: 'oklch(0.769 0.188 70.08)', flexShrink: 0 }} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold truncate" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.88 0.005 65)' }}>
                    {identity.username}
                  </p>
                  <p className="text-[10px] truncate" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>
                    Account #{identity.accountId}
                  </p>
                </div>
              </div>
            )}

            <p
              className="text-[11px] leading-relaxed mb-3"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}
            >
              Paste your Freeroam session cookie to load your characters. Get it from DevTools → Application → Cookies → getfreeroam.com.
            </p>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste your Freeroam cookie here..."
              rows={3}
              disabled={status === 'verifying'}
              className="w-full rounded-sm px-3 py-2 text-[11px] resize-none outline-none transition-colors disabled:opacity-50"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'oklch(0.15 0.01 264)',
                border: '1px solid oklch(1 0 0 / 0.1)',
                color: 'oklch(0.82 0.005 65)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'oklch(0.769 0.188 70.08 / 0.5)')}
              onBlur={(e) => (e.target.style.borderColor = 'oklch(1 0 0 / 0.1)')}
            />

            {/* Status messages */}
            {status === 'verifying' && (
              <div className="flex items-center gap-1.5 mt-2">
                <Loader2 size={11} className="animate-spin" style={{ color: 'oklch(0.769 0.188 70.08)' }} />
                <p className="text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.769 0.188 70.08)' }}>
                  Verifying with Freeroam...
                </p>
              </div>
            )}
            {status === 'success' && (
              <p className="mt-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.15 145)' }}>
                ✓ Verified — reloading...
              </p>
            )}
            {status === 'expired' && (
              <p className="mt-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.22 25)' }}>
                ✗ Session expired — please get a fresh cookie from Freeroam.
              </p>
            )}
            {status === 'error' && (
              <p className="mt-2 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.65 0.22 25)' }}>
                ✗ {errorMsg || 'Verification failed — check your cookie and try again.'}
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
            disabled={!hasCookie || status === 'verifying'}
            className="px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-30"
            style={{
              fontFamily: 'Rajdhani, sans-serif',
              background: 'transparent',
              border: '1px solid oklch(0.65 0.22 25 / 0.4)',
              color: 'oklch(0.65 0.22 25)',
            }}
          >
            Disconnect
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={status === 'verifying'}
              className="px-4 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
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
              disabled={!input.trim() || status === 'verifying'}
              className="px-4 py-1.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-40 hover:brightness-110"
              style={{
                fontFamily: 'Rajdhani, sans-serif',
                background: 'oklch(0.769 0.188 70.08 / 0.15)',
                border: '1px solid oklch(0.769 0.188 70.08 / 0.5)',
                color: 'oklch(0.769 0.188 70.08)',
              }}
            >
              {status === 'verifying' ? 'Verifying...' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
