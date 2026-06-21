// StoryReader.tsx
// Full-screen story panel reader matching Freeroam's layout:
// - Ambient blurred backdrop (panel image fills the sides)
// - Dark scrim over the backdrop
// - Center portrait panel image filling full viewport height
// - Navigation halos on left/right edges
// - Speech bubble (white comic bubble, upper-left)
// - Narration text overlay (bottom of image)
// - Choice options below panel when awaiting_choice
// - Polling every 1s when forward_state === "ready" and next_panel_id is null

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

// Deterministic color per character name
const CHARACTER_COLORS = [
  '#4fc3f7', // light blue
  '#ce93d8', // light purple
  '#80cbc4', // teal
  '#ffcc80', // amber
  '#f48fb1', // pink
  '#a5d6a7', // green
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
  const imageUrl = image?.url ?? null;
  const speechBubble = content?.speech_bubbles?.[0] ?? null;
  const narration = content?.narration ?? null;
  const choice = content?.choice ?? null;
  const isAwaitingChoice = panel?.forward_state === 'awaiting_choice';
  const canGoBack = !!panel?.prev_panel_id;
  const canGoForward = !isAwaitingChoice && !!panel?.next_panel_id;

  const hasSpeechBubble = !!speechBubble?.text;
  const isSpoken = speechBubble?.style === 'spoken';
  const speakerName = isSpoken ? speechBubble?.character : null;
  const speakerColor = speakerName ? getCharacterColor(speakerName) : null;
  const hasNarration = !!narration;

  return (
    <div
      className="fixed inset-0 z-[100]"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* Ambient backdrop — blurred panel image fills the entire screen behind */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(24px) brightness(0.35) saturate(1.4)',
          transform: 'scale(1.1)', // prevent blur edge artifacts
        }}
      />
      {/* Dark scrim over ambient */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />

      {/* Left tap zone / navigation halo */}
      <button
        onClick={() => handleNavigate('prev')}
        disabled={!canGoBack || isNavigating}
        className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-start pl-3 sm:pl-5 disabled:opacity-0 transition-opacity"
        style={{ width: 'calc(50% - 180px)', minWidth: '44px', maxWidth: '120px', cursor: canGoBack ? 'pointer' : 'default' }}
        aria-label="Previous panel"
      >
        <div
          className="flex items-center justify-center rounded-full transition-all hover:scale-110"
          style={{
            width: '40px',
            height: '40px',
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(4px)',
            color: 'rgba(255,255,255,0.85)',
          }}
        >
          <ChevronLeft size={22} strokeWidth={2} />
        </div>
      </button>

      {/* Right tap zone / navigation halo */}
      <button
        onClick={() => handleNavigate('next')}
        disabled={(!canGoForward && !isPolling) || isNavigating}
        className="absolute right-0 top-0 bottom-0 z-20 flex items-center justify-end pr-3 sm:pr-5 disabled:opacity-0 transition-opacity"
        style={{ width: 'calc(50% - 180px)', minWidth: '44px', maxWidth: '120px', cursor: canGoForward ? 'pointer' : 'default' }}
        aria-label="Next panel"
      >
        <div
          className="flex items-center justify-center rounded-full transition-all hover:scale-110"
          style={{
            width: '40px',
            height: '40px',
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(4px)',
            color: 'rgba(255,255,255,0.85)',
          }}
        >
          {isPolling ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <ChevronRight size={22} strokeWidth={2} />
          )}
        </div>
      </button>

      {/* Center column — panel image at full viewport height */}
      <div className="absolute inset-0 flex flex-col items-center justify-start pointer-events-none">
        {/* Top bar */}
        <div
          className="w-full flex items-center justify-between px-4 py-2 pointer-events-auto"
          style={{
            maxWidth: '400px',
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
          }}
        >
          <span
            className="font-bold tracking-wide"
            style={{ fontFamily: 'serif', fontSize: '18px', color: 'rgba(255,255,255,0.9)' }}
          >
            freeroam
          </span>
          <div className="flex items-center gap-3">
            {panel && (
              <span
                className="text-xs font-semibold"
                style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}
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
                background: 'rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.8)',
              }}
              title="Close reader"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Panel image — fills full viewport height, portrait aspect */}
        <div
          className="relative pointer-events-auto"
          style={{
            height: '100dvh',
            aspectRatio: '9/16',
            maxWidth: '100vw',
            overflow: 'hidden',
            background: '#0a0a0a',
          }}
        >
          {/* Loading state */}
          {(isLoading || isNavigating) && (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.6)' }}
            >
              <Loader2 size={36} className="animate-spin" style={{ color: 'rgba(255,255,255,0.7)' }} />
            </div>
          )}

          {/* Panel image */}
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full"
              style={{
                objectFit: 'contain',
                objectPosition: 'center top',
                opacity: isNavigating ? 0.4 : 1,
                transition: 'opacity 0.15s ease',
              }}
            />
          )}

          {/* Speech bubble — upper-left, comic style */}
          {hasSpeechBubble && !isLoading && !isNavigating && (
            <div
              className="absolute z-10"
              style={{ top: '10%', left: '4%', maxWidth: '52%' }}
            >
              <div
                className="relative px-3 py-2"
                style={{
                  background: 'white',
                  borderRadius: '14px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                }}
              >
                {/* Bubble tail */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-9px',
                    left: '20px',
                    width: 0,
                    height: 0,
                    borderLeft: '7px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop: '9px solid white',
                  }}
                />
                {speakerName && speakerColor && (
                  <p
                    style={{
                      fontFamily: 'sans-serif',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: speakerColor,
                      marginBottom: '2px',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {speakerName}
                  </p>
                )}
                <p
                  style={{
                    fontFamily: 'sans-serif',
                    fontSize: 'clamp(11px, 2.2vw, 13px)',
                    fontWeight: 600,
                    color: '#111',
                    lineHeight: 1.35,
                    margin: 0,
                  }}
                >
                  {speechBubble!.text}
                </p>
              </div>
            </div>
          )}

          {/* Narration gradient + text overlay — bottom */}
          {hasNarration && !isLoading && !isNavigating && (
            <>
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.45) 68%, rgba(0,0,0,0.72) 100%)',
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-6"
              >
                <p
                  className="text-center font-bold leading-snug"
                  style={{
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    fontSize: 'clamp(15px, 3.8vw, 20px)',
                    color: '#ffffff',
                    textShadow: '0 1px 10px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.7)',
                    fontStyle: 'italic',
                  }}
                >
                  {narration}
                </p>
              </div>
            </>
          )}

          {/* Polling indicator */}
          {isPolling && !isNavigating && (
            <div
              className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <Loader2 size={12} className="animate-spin" style={{ color: 'rgba(255,255,255,0.7)' }} />
              <span style={{ fontFamily: 'sans-serif', fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Generating...
              </span>
            </div>
          )}
        </div>

        {/* Choice options — below the panel */}
        {isAwaitingChoice && choice && !isLoading && !isNavigating && (
          <div
            className="pointer-events-auto flex flex-col gap-2 px-4 py-3"
            style={{
              width: '100%',
              maxWidth: '400px',
              position: 'absolute',
              bottom: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 30,
              background: 'linear-gradient(to top, rgba(0,0,0,0.85) 60%, transparent)',
            }}
          >
            {choice.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleChoice(opt.action_panel_external_id)}
                className="w-full px-4 py-3 rounded-xl text-sm font-semibold tracking-wide transition-all hover:brightness-110 active:scale-95"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: 'rgba(255,255,255,0.95)',
                  backdropFilter: 'blur(8px)',
                  fontFamily: 'sans-serif',
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
