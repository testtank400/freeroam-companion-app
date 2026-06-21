// StoryReader.tsx
// Full-screen story panel reader — custom design inspired by Freeroam but elevated.
// Layout:
//   - Ambient blurred backdrop (panel image fills the sides, dark scrim over it)
//   - Center portrait panel filling full viewport height
//   - Navigation halos on left/right edges
//   - Spoken dialogue: large bold white Lora text at bottom, character name in accent color above with a colored underline
//   - Narration: italic Lora text at bottom, slightly smaller
//   - No speech bubble — all text rendered as bottom overlay
//   - Choice options: frosted glass pills below the panel

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

// Deterministic accent color per character name
const ACCENT_COLORS = [
  '#7ec8e3', // sky blue
  '#c4a7e7', // soft purple
  '#7fd1b9', // mint teal
  '#f4c97a', // warm amber
  '#f4a0b5', // rose pink
  '#9dd49a', // sage green
  '#f4a261', // peach
  '#a8dadc', // seafoam
];
function getAccentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
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

  // Poll when forward_state is "ready" but next_panel_id is null (AI generating)
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

  // Text rendering logic
  const isSpoken = speechBubble?.style === 'spoken';
  const speakerName = isSpoken ? speechBubble?.character ?? null : null;
  const dialogueText = speechBubble?.text ?? null;
  const hasText = !!(narration || dialogueText);
  const accentColor = speakerName ? getAccentColor(speakerName) : null;

  return (
    <div
      className="fixed inset-0 z-[100]"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease' }}
    >
      {/* Ambient blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(28px) brightness(0.3) saturate(1.5)',
          transform: 'scale(1.12)',
        }}
      />
      {/* Dark scrim */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} />

      {/* Left navigation halo */}
      <button
        onClick={() => handleNavigate('prev')}
        disabled={!canGoBack || isNavigating}
        className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-start pl-2 sm:pl-4 disabled:opacity-0 transition-opacity"
        style={{ width: 'clamp(44px, 15vw, 100px)', cursor: canGoBack ? 'pointer' : 'default' }}
        aria-label="Previous panel"
      >
        <div
          className="flex items-center justify-center rounded-full transition-all hover:bg-white/20"
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}
        >
          <ChevronLeft size={22} strokeWidth={2} />
        </div>
      </button>

      {/* Right navigation halo */}
      <button
        onClick={() => handleNavigate('next')}
        disabled={(!canGoForward && !isPolling) || isNavigating}
        className="absolute right-0 top-0 bottom-0 z-20 flex items-center justify-end pr-2 sm:pr-4 disabled:opacity-0 transition-opacity"
        style={{ width: 'clamp(44px, 15vw, 100px)', cursor: canGoForward ? 'pointer' : 'default' }}
        aria-label="Next panel"
      >
        <div
          className="flex items-center justify-center rounded-full transition-all hover:bg-white/20"
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}
        >
          {isPolling ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={22} strokeWidth={2} />}
        </div>
      </button>

      {/* Center panel */}
      <div className="absolute inset-0 flex items-start justify-center">
        <div
          className="relative"
          style={{
            height: '100dvh',
            aspectRatio: '9/16',
            maxWidth: '100vw',
            overflow: 'hidden',
            background: '#080808',
          }}
        >
          {/* Top bar */}
          <div
            className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-3 pb-2"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)' }}
          >
            <span style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '16px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>
              freeroam
            </span>
            <div className="flex items-center gap-3">
              {panel && (
                <span style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>
                  Page {panel.depth}
                </span>
              )}
              <button
                onClick={onClose}
                className="flex items-center justify-center rounded-full transition-all hover:bg-white/20"
                style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}
                title="Close"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Loading overlay */}
          {(isLoading || isNavigating) && (
            <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <Loader2 size={36} className="animate-spin" style={{ color: 'rgba(255,255,255,0.6)' }} />
            </div>
          )}

          {/* Panel image */}
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full"
              style={{ objectFit: 'contain', objectPosition: 'center top', opacity: isNavigating ? 0.35 : 1, transition: 'opacity 0.15s ease' }}
            />
          )}

          {/* Bottom text overlay */}
          {hasText && !isLoading && !isNavigating && (
            <>
              {/* Gradient for readability */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, transparent 38%, rgba(0,0,0,0.35) 58%, rgba(0,0,0,0.72) 78%, rgba(0,0,0,0.88) 100%)' }}
              />

              <div className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-7">
                {/* Character name label (spoken dialogue only) */}
                {speakerName && accentColor && (
                  <div className="mb-2">
                    <p
                      style={{
                        fontFamily: 'Lora, Georgia, serif',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: accentColor,
                        letterSpacing: '0.03em',
                        marginBottom: '4px',
                      }}
                    >
                      {speakerName}
                    </p>
                    {/* Accent underline */}
                    <div style={{ width: '32px', height: '2px', background: accentColor, borderRadius: '1px', opacity: 0.8 }} />
                  </div>
                )}

                {/* Dialogue text */}
                {dialogueText && (
                  <p
                    style={{
                      fontFamily: 'Lora, Georgia, serif',
                      fontSize: 'clamp(18px, 4.5vw, 26px)',
                      fontWeight: 700,
                      color: '#ffffff',
                      lineHeight: 1.3,
                      textShadow: '0 2px 12px rgba(0,0,0,0.9)',
                      margin: 0,
                    }}
                  >
                    {dialogueText}
                  </p>
                )}

                {/* Narration text */}
                {narration && (
                  <p
                    style={{
                      fontFamily: 'Lora, Georgia, serif',
                      fontSize: 'clamp(16px, 4vw, 22px)',
                      fontWeight: 400,
                      fontStyle: 'italic',
                      color: 'rgba(255,255,255,0.92)',
                      lineHeight: 1.4,
                      textShadow: '0 2px 12px rgba(0,0,0,0.9)',
                      margin: 0,
                      textAlign: 'center',
                    }}
                  >
                    {narration}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Polling indicator */}
          {isPolling && !isNavigating && (
            <div
              className="absolute bottom-5 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
            >
              <Loader2 size={12} className="animate-spin" style={{ color: 'rgba(255,255,255,0.6)' }} />
              <span style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '11px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }}>
                Generating...
              </span>
            </div>
          )}

          {/* Choice options */}
          {isAwaitingChoice && choice && !isLoading && !isNavigating && (
            <div
              className="absolute bottom-0 left-0 right-0 z-20 flex flex-col gap-2 px-4 pb-5 pt-8"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88) 60%, transparent)' }}
            >
              {choice.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handleChoice(opt.action_panel_external_id)}
                  className="w-full px-4 py-3 rounded-xl transition-all hover:brightness-110 active:scale-95"
                  style={{
                    fontFamily: 'Lora, Georgia, serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.95)',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    backdropFilter: 'blur(8px)',
                    textAlign: 'left',
                  }}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
