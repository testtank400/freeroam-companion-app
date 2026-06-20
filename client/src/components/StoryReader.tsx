// StoryReader.tsx
// Full-screen story panel reader for Freeroam worlds.
// Displays panel image with overlaid text (narration or speech bubble).
// Navigation: left/right arrows + keyboard arrow keys.
// Polling: when forward_state === "ready" and next_panel_id is null, polls next-ready every 1s.
// Choice: when forward_state === "awaiting_choice", shows choice options.

import { trpc } from '@/lib/trpc';
import { ApiWorld } from '@/components/WorldCard';
import { ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface StoryReaderProps {
  world: ApiWorld;
  initialPanelId: string;
  onClose: () => void;
}

type PanelData = {
  panel_id: string;
  world_id: string;
  next_panel_id: string | null;
  prev_panel_id: string | null;
  is_action: boolean;
  requires_action: boolean;
  depth: number;
  forward_state: string;
  panel_content: {
    type: string;
    narration: string | null;
    images: Array<{
      url: string;
      prompt: string;
      generation_type: string | null;
      visible_characters: Record<string, { name: string; external_id: string }>;
      shot: string | null;
      is_nsfw: boolean | null;
    }>;
    speech_bubbles: Array<{
      text: string;
      character: string;
      style: string;
      isRequiresActionChat: boolean;
    }>;
    choice: {
      question: string;
      options: Array<{ text: string; action_panel_external_id: string }>;
      selected_choice: string | null;
      is_chat: boolean;
    } | null;
    chapter_header: string | null;
    chapter_start: unknown;
    chapter_end: unknown;
    depth: number;
    is_chat: boolean;
  };
  next_panel: unknown;
  show_jump_to_latest: boolean;
  jump_to_latest_panel_id: string | null;
  is_owner: boolean;
};

// Character name → color mapping for speech bubble labels
const CHARACTER_COLORS = [
  'oklch(0.75 0.18 200)',  // teal
  'oklch(0.75 0.18 300)',  // purple
  'oklch(0.75 0.18 130)',  // green
  'oklch(0.75 0.18 50)',   // amber
  'oklch(0.75 0.18 350)',  // pink
  'oklch(0.75 0.18 240)',  // blue
];

function getCharacterColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return CHARACTER_COLORS[Math.abs(hash) % CHARACTER_COLORS.length];
}

export default function StoryReader({ world, initialPanelId, onClose }: StoryReaderProps) {
  const utils = trpc.useUtils();
  const [currentPanel, setCurrentPanel] = useState<PanelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [visible, setVisible] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setPanelMutation = trpc.worlds.setPanel.useMutation();

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const loadPanel = useCallback(async (panelId: string, worldId: string) => {
    stopPolling();
    setIsNavigating(true);
    try {
      const data = await utils.worlds.getPanel.fetch({ worldId, panelId });
      setCurrentPanel(data as PanelData);
      // Save position
      setPanelMutation.mutate({ worldId, panelId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load panel');
    } finally {
      setIsNavigating(false);
      setIsLoading(false);
    }
  }, [utils, setPanelMutation, stopPolling]);

  // Initial load
  useEffect(() => {
    loadPanel(initialPanelId, world.external_id);
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Start polling when forward_state is "ready" but next_panel_id is null
  useEffect(() => {
    if (!currentPanel) return;
    const { forward_state, next_panel_id } = currentPanel;
    if (forward_state === 'ready' && !next_panel_id) {
      setIsPolling(true);
      pollingRef.current = setInterval(async () => {
        try {
          const result = await utils.worlds.nextReady.fetch({ panelId: currentPanel.panel_id });
          if (result.ready) {
            stopPolling();
            await loadPanel(result.panel_id, world.external_id);
          }
        } catch {
          // Non-fatal — keep polling
        }
      }, 1000);
    }
    return () => stopPolling();
  }, [currentPanel?.panel_id, currentPanel?.forward_state, currentPanel?.next_panel_id]);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleNavigate = useCallback(async (direction: 'prev' | 'next') => {
    if (!currentPanel || isNavigating || isPolling) return;
    const targetId = direction === 'prev' ? currentPanel.prev_panel_id : currentPanel.next_panel_id;
    if (!targetId) return;
    await loadPanel(targetId, world.external_id);
  }, [currentPanel, isNavigating, isPolling, loadPanel, world.external_id]);

  const handleChoice = useCallback(async (actionPanelId: string) => {
    if (isNavigating) return;
    await loadPanel(actionPanelId, world.external_id);
  }, [isNavigating, loadPanel, world.external_id]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handleNavigate('prev');
      if (e.key === 'ArrowRight') handleNavigate('next');
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNavigate, onClose]);

  const panel = currentPanel;
  const content = panel?.panel_content;
  const image = content?.images?.[0];
  const speechBubble = content?.speech_bubbles?.[0] ?? null;
  const narration = content?.narration ?? null;
  const choice = content?.choice ?? null;
  const isAwaitingChoice = panel?.forward_state === 'awaiting_choice';
  const canGoBack = !!panel?.prev_panel_id;
  const canGoForward = !isAwaitingChoice && !!panel?.next_panel_id;

  // Determine text to display
  const displayText = narration ?? speechBubble?.text ?? null;
  const isSpoken = !narration && speechBubble?.style === 'spoken';
  const speakerName = isSpoken ? speechBubble?.character : null;
  const speakerColor = speakerName ? getCharacterColor(speakerName) : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: `rgba(0,0,0,${visible ? '0.92' : '0'})`,
        transition: 'background 0.25s ease',
      }}
    >
      {/* Left arrow */}
      <button
        onClick={() => handleNavigate('prev')}
        disabled={!canGoBack || isNavigating}
        className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-full transition-all disabled:opacity-20 hover:scale-110"
        style={{
          width: '44px',
          height: '44px',
          background: 'oklch(0.15 0.01 264 / 0.7)',
          border: '1px solid oklch(1 0 0 / 0.15)',
          color: 'oklch(0.85 0.005 65)',
          backdropFilter: 'blur(4px)',
        }}
        title="Previous panel"
      >
        <ChevronLeft size={22} strokeWidth={2} />
      </button>

      {/* Right arrow */}
      <button
        onClick={() => handleNavigate('next')}
        disabled={!canGoForward || isNavigating || isPolling}
        className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-full transition-all disabled:opacity-20 hover:scale-110"
        style={{
          width: '44px',
          height: '44px',
          background: 'oklch(0.15 0.01 264 / 0.7)',
          border: '1px solid oklch(1 0 0 / 0.15)',
          color: 'oklch(0.85 0.005 65)',
          backdropFilter: 'blur(4px)',
        }}
        title="Next panel"
      >
        <ChevronRight size={22} strokeWidth={2} />
      </button>

      {/* Center panel — portrait format matching Freeroam */}
      <div
        className="relative flex flex-col"
        style={{
          width: 'min(380px, calc(100vw - 80px))',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.97)',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between mb-2 px-1">
          <a
            href="https://getfreeroam.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold tracking-wider"
            style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.85 0.005 65)' }}
          >
            freeroam
          </a>
          <div className="flex items-center gap-3">
            {panel && (
              <span
                className="text-xs font-semibold tracking-wider"
                style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.55 0.01 264)' }}
              >
                Page {panel.depth}
              </span>
            )}
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-full hover:brightness-125 transition-colors"
              style={{
                width: '28px',
                height: '28px',
                background: 'oklch(0.18 0.01 264)',
                border: '1px solid oklch(1 0 0 / 0.12)',
                color: 'oklch(0.65 0.01 264)',
              }}
              title="Close reader"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Panel image area */}
        <div
          className="relative rounded-sm overflow-hidden"
          style={{
            aspectRatio: '9/16',
            background: 'oklch(0.1 0.01 264)',
          }}
        >
          {/* Loading state */}
          {(isLoading || isNavigating) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'oklch(0.1 0.01 264)' }}>
              <Loader2 size={32} className="animate-spin" style={{ color: 'oklch(0.769 0.188 70.08)' }} />
            </div>
          )}

          {/* Panel image */}
          {image && (
            <img
              src={image.url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: isNavigating ? 0.3 : 1, transition: 'opacity 0.2s ease' }}
            />
          )}

          {/* Gradient overlay for text legibility */}
          {displayText && (
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.75) 100%)',
              }}
            />
          )}

          {/* Text overlay */}
          {displayText && !isLoading && !isNavigating && (
            <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 z-10">
              {speakerName && speakerColor && (
                <p
                  className="text-sm font-bold mb-1"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    color: speakerColor,
                    letterSpacing: '0.05em',
                  }}
                >
                  {speakerName}
                </p>
              )}
              <p
                className="text-center font-bold leading-snug"
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: 'clamp(14px, 3.5vw, 18px)',
                  color: 'oklch(0.97 0.005 65)',
                  textShadow: '0 1px 8px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.6)',
                }}
              >
                {displayText}
              </p>
            </div>
          )}

          {/* Polling spinner overlay */}
          {isPolling && !isNavigating && (
            <div
              className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: 'oklch(0.12 0.01 264 / 0.85)',
                border: '1px solid oklch(1 0 0 / 0.12)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <Loader2 size={12} className="animate-spin" style={{ color: 'oklch(0.769 0.188 70.08)' }} />
              <span
                className="text-[10px] font-semibold tracking-wider uppercase"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.65 0.01 264)' }}
              >
                Generating...
              </span>
            </div>
          )}
        </div>

        {/* Choice options — shown below the panel when awaiting_choice */}
        {isAwaitingChoice && choice && !isLoading && !isNavigating && (
          <div className="mt-3 flex flex-col gap-2">
            <p
              className="text-xs text-center mb-1"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.55 0.01 264)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}
            >
              {choice.question}
            </p>
            {choice.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleChoice(opt.action_panel_external_id)}
                className="w-full px-4 py-2.5 rounded-sm text-sm font-semibold tracking-wide transition-all hover:brightness-110 active:scale-95"
                style={{
                  fontFamily: 'Rajdhani, sans-serif',
                  background: 'oklch(0.769 0.188 70.08 / 0.12)',
                  border: '1px solid oklch(0.769 0.188 70.08 / 0.35)',
                  color: 'oklch(0.769 0.188 70.08)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {opt.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
