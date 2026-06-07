// SettingsModal.tsx
// Settings panel for per-user Freeroam cookie configuration and bulk export.
// On save, calls verifySession to validate the cookie and get the user's accountId.
// The cookie value is NEVER read back or displayed — only a status indicator is shown.

import { useFreeroamCookie } from '@/hooks/useFreeroamCookie';
import { trpc } from '@/lib/trpc';
import { CheckCircle, Download, Loader2, Settings, User, X, XCircle } from 'lucide-react';
// Note: bulk export uses direct fetch to /api/export/bulk (not tRPC) to handle large responses
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface ExportCharacter {
  external_id: string;
  name: string;
  backstory: string | null;
  description: string | null;
  headshot_url: string | null;
  display_headshot_url: string | null;
  privacy_status: string;
  created_at?: string;
  creator_username?: string;
  is_yours?: boolean;
  is_saved?: boolean;
  tags?: Array<{ name: string; is_fandom: boolean; emoji: string }>;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** All characters currently loaded in the roster (for bulk export) */
  characters?: ExportCharacter[];
  /** Total character count for display */
  characterCount?: number;
}

export default function SettingsModal({ open, onClose, characters = [], characterCount = 0 }: SettingsModalProps) {
  const { hasCookie, identity, saveIdentity, clearCookie } = useFreeroamCookie();
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error' | 'expired'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Export state
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [exportProgress, setExportProgress] = useState('');
  const [exportDownloadUrl, setExportDownloadUrl] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Poll for job status
  const startPolling = (jobId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/export/status/${jobId}`);
        if (!resp.ok) return;
        const data = await resp.json();

        if (data.status === 'done') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setExportStatus('done');
          setExportDownloadUrl(data.downloadUrl);
          setExportProgress(`Exported ${data.exportedCount} characters${data.failedCount > 0 ? ` (${data.failedCount} failed)` : ''}`);
          toast.success(`Export ready — ${data.exportedCount} characters`);
          localStorage.removeItem('export_job_id');
        } else if (data.status === 'error') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setExportStatus('error');
          setExportProgress(`Export failed: ${data.errorMessage || 'Unknown error'}`);
          localStorage.removeItem('export_job_id');
        }
        // else still processing — keep polling
      } catch {
        // Network error — keep polling
      }
    }, 5000);
  };

  // On mount: check localStorage for a running job, OR check server for a completed export
  useEffect(() => {
    const savedJobId = localStorage.getItem('export_job_id');

    if (savedJobId) {
      // We have a job ID — check its status directly
      setExportJobId(savedJobId);
      setExportStatus('exporting');
      setExportProgress('Checking export status...');

      fetch(`/api/export/status/${savedJobId}`)
        .then(r => r.json())
        .then(data => {
          if (data.status === 'done') {
            setExportStatus('done');
            setExportDownloadUrl(data.downloadUrl);
            setExportProgress(`Exported ${data.exportedCount} characters${data.failedCount > 0 ? ` (${data.failedCount} failed)` : ''}`);
            localStorage.removeItem('export_job_id');
          } else if (data.status === 'error') {
            setExportStatus('error');
            setExportProgress(`Export failed: ${data.errorMessage || 'Unknown error'}`);
            localStorage.removeItem('export_job_id');
          } else if (data.error === 'Job not found') {
            localStorage.removeItem('export_job_id');
            setExportStatus('idle');
            setExportProgress('');
          } else {
            setExportProgress('Export in progress...');
            startPolling(savedJobId);
          }
        })
        .catch(() => {
          setExportProgress('Export in progress...');
          startPolling(savedJobId);
        });
    } else {
      // No saved job — check server for any recent completed export
      const accountId = localStorage.getItem('freeroam_account_id');
      if (accountId) {
        fetch('/api/export/latest', {
          headers: { 'x-freeroam-account-id': accountId },
        })
          .then(r => r.json())
          .then(data => {
            if (data.hasExport) {
              setExportStatus('done');
              setExportDownloadUrl(data.downloadUrl);
              setExportProgress(`Exported ${data.exportedCount} characters${data.failedCount > 0 ? ` (${data.failedCount} failed)` : ''}`);
            } else if (data.runningJobId) {
              // There's a running job we didn't know about
              setExportJobId(data.runningJobId);
              localStorage.setItem('export_job_id', data.runningJobId);
              setExportStatus('exporting');
              setExportProgress('Export in progress...');
              startPolling(data.runningJobId);
            }
          })
          .catch(() => { /* ignore */ });
      }
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleCancelExport = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    localStorage.removeItem('export_job_id');
    setExportStatus('idle');
    setExportProgress('');
    setExportDownloadUrl(null);
    setExportJobId(null);
  };

  const handleBulkExport = async () => {
    if (characters.length === 0) {
      toast.error('No characters loaded to export');
      return;
    }
    setExportStatus('exporting');
    setExportProgress(`Starting export of ${characters.length} characters...`);
    setExportDownloadUrl(null);

    try {
      const response = await fetch('/api/export/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-freeroam-account-id': localStorage.getItem('freeroam_account_id') || '',
        },
        body: JSON.stringify({ characters }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const jobId = data.jobId;
      setExportJobId(jobId);
      localStorage.setItem('export_job_id', jobId);
      setExportProgress('Export in progress... You can close this modal or refresh the page.');

      // Start polling
      startPolling(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setExportStatus('error');
      setExportProgress(`Export failed: ${message}`);
      toast.error(`Export failed: ${message}`);
    }
  };

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
      setInput('');
      setStatus('idle');
      setErrorMsg('');
      // Don't reset export state on open — preserve polling/done state across modal open/close
      if (exportStatus !== 'exporting' && exportStatus !== 'done') {
        setExportStatus('idle');
        setExportProgress('');
        setExportDownloadUrl(null);
      }
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
        className="relative w-full max-w-md rounded-sm flex flex-col"
        style={{
          background: 'oklch(0.11 0.009 264)',
          border: '1px solid oklch(0.769 0.188 70.08 / 0.2)',
          maxHeight: '92dvh',
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

        {/* Body — scrollable so footer buttons are always reachable on mobile */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

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

            <div className="mb-3 space-y-1.5">
              <p className="text-[11px] font-semibold" style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.65 0.01 264)' }}>How to get your cookie:</p>
              <ol className="space-y-1" style={{ paddingLeft: '1rem', listStyleType: 'decimal' }}>
                {[
                  'Go to getfreeroam.com and log in',
                  'Open DevTools (F12) → Network tab',
                  'Refresh the page',
                  'Click any request to getfreeroam.com',
                  'Under Request Headers, find the Cookie row',
                  'Double-click the Cookie value to select it, then copy (Ctrl+C / Cmd+C)',
                ].map((step, i) => (
                  <li key={i} className="text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            <p className="text-[10px] mb-3 px-2 py-1.5 rounded-sm" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.5 0.15 220)', background: 'oklch(0.55 0.15 220 / 0.08)', border: '1px solid oklch(0.55 0.15 220 / 0.2)' }}>
              On mobile? Get your cookie on a desktop browser first, then paste it here.
            </p>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste your Freeroam cookie here..."
              rows={3}
              disabled={status === 'verifying'}
              className="w-full rounded-sm px-3 py-2 resize-none outline-none transition-colors disabled:opacity-50"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '16px', // 16px prevents iOS auto-zoom on focus
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

          {/* Section: Export All Characters */}
          {hasCookie && (
            <div style={{ borderTop: '1px solid oklch(1 0 0 / 0.07)', paddingTop: '1.25rem' }}>
              <p
                className="text-[11px] uppercase tracking-widest mb-1"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', fontWeight: 600 }}
              >
                Export All Characters
              </p>
              <p
                className="text-[11px] mb-3"
                style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.5 0.01 264)' }}
              >
                Download a ZIP containing all your characters with their markdown files, headshots, Freeroam data, and Companion data.
              </p>

              {/* Export / Download button */}
              {exportStatus === 'done' && exportDownloadUrl ? (
                <a
                  href={exportDownloadUrl}
                  download
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all hover:brightness-110"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: 'oklch(0.55 0.15 145 / 0.15)',
                    border: '1px solid oklch(0.55 0.15 145 / 0.5)',
                    color: 'oklch(0.65 0.15 145)',
                    textDecoration: 'none',
                  }}
                >
                  <Download size={13} strokeWidth={2.5} />
                  Download Export
                </a>
              ) : (
                <button
                  onClick={handleBulkExport}
                  disabled={exportStatus === 'exporting' || characters.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-40 hover:brightness-110"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: exportStatus === 'exporting' ? 'oklch(0.15 0.01 264)' : 'oklch(0.769 0.188 70.08 / 0.12)',
                    border: exportStatus === 'exporting' ? '1px solid oklch(1 0 0 / 0.1)' : '1px solid oklch(0.769 0.188 70.08 / 0.4)',
                    color: exportStatus === 'exporting' ? 'oklch(0.5 0.01 264)' : 'oklch(0.769 0.188 70.08)',
                  }}
                >
                  {exportStatus === 'exporting' ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download size={13} strokeWidth={2.5} />
                      {characterCount > 0 ? `Export All (${characterCount})` : 'Export All'}
                    </>
                  )}
                </button>
              )}

              {/* Progress / status */}
              {exportProgress && (
                <div className="flex items-center gap-1.5 mt-2">
                  {exportStatus === 'exporting' && (
                    <Loader2 size={11} className="animate-spin" style={{ color: 'oklch(0.769 0.188 70.08)' }} />
                  )}
                  {exportStatus === 'done' && (
                    <CheckCircle size={11} style={{ color: 'oklch(0.65 0.15 145)' }} />
                  )}
                  {exportStatus === 'error' && (
                    <XCircle size={11} style={{ color: 'oklch(0.65 0.22 25)' }} />
                  )}
                  <p
                    className="text-[11px] flex-1"
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      color: exportStatus === 'done' ? 'oklch(0.65 0.15 145)'
                        : exportStatus === 'error' ? 'oklch(0.65 0.22 25)'
                        : 'oklch(0.769 0.188 70.08)',
                    }}
                  >
                    {exportProgress}
                  </p>
                  {(exportStatus === 'exporting' || exportStatus === 'error') && (
                    <button
                      onClick={handleCancelExport}
                      className="text-[10px] px-2 py-0.5 rounded-sm hover:bg-white/10 transition-colors flex-shrink-0"
                      style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.5 0.01 264)', border: '1px solid oklch(1 0 0 / 0.1)' }}
                    >
                      {exportStatus === 'error' ? 'Retry' : 'Cancel'}
                    </button>
                  )}
                </div>
              )}

              {characters.length === 0 && exportStatus !== 'exporting' && (
                <p className="mt-2 text-[10px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.45 0.01 264)' }}>
                  Load your characters first by closing this modal and waiting for the roster to load.
                </p>
              )}
            </div>
          )}
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
