// NotificationsDropdown.tsx
// Header bell + freeroam notification feed (cursor-paginated).

import { trpc } from '@/lib/trpc';
import { ApiWorld } from '@/components/WorldCard';
import { Bell, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type ApiNotificationActor = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
};

export type ApiNotification = {
  external_id: string;
  type: string;
  created_at: string;
  updated_at: string;
  seen_at: string | null;
  read_at: string | null;
  actor_count: number;
  primary_actor: ApiNotificationActor | null;
  recent_actors: ApiNotificationActor[];
  world: {
    external_id: string;
    name: string;
    cover_image_url: string | null;
  } | null;
  comment: unknown;
  payload: {
    image_url?: string;
    world_name?: string;
    world_logline?: string;
    actor_username?: string;
    world_external_id?: string;
    actor_display_name?: string;
    [key: string]: unknown;
  } | null;
};

interface NotificationsDropdownProps {
  enabled: boolean;
  onOpenWorld: (world: ApiWorld) => void;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function actorName(n: ApiNotification): string {
  const a = n.primary_actor;
  if (!a) {
    return (n.payload?.actor_display_name as string) || (n.payload?.actor_username as string) || 'Someone';
  }
  return a.display_name || a.username || 'Someone';
}

function notificationTitle(n: ApiNotification): string {
  const name = actorName(n);
  const others = Math.max(0, (n.actor_count || 1) - 1);
  const who = others > 0 ? `${name} and ${others} other${others === 1 ? '' : 's'}` : name;

  switch (n.type) {
    case 'creator_published':
      return `${who} published a world`;
    case 'world_liked':
    case 'like':
      return `${who} liked a world`;
    case 'comment':
    case 'world_comment':
      return `${who} commented`;
    case 'follow':
      return `${who} followed you`;
    default:
      return `${who} · ${n.type.replace(/_/g, ' ')}`;
  }
}

function notificationWorldName(n: ApiNotification): string | null {
  return n.world?.name || (n.payload?.world_name as string) || null;
}

function notificationImage(n: ApiNotification): string | null {
  return (
    n.world?.cover_image_url ||
    (n.payload?.image_url as string) ||
    n.primary_actor?.avatar_url ||
    null
  );
}

function toApiWorld(n: ApiNotification): ApiWorld | null {
  const externalId = n.world?.external_id || (n.payload?.world_external_id as string) || null;
  if (!externalId) return null;
  const name = n.world?.name || (n.payload?.world_name as string) || 'World';
  return {
    external_id: externalId,
    name,
    cover_image_url: n.world?.cover_image_url || (n.payload?.image_url as string) || null,
    avg_color: null,
    logline: (n.payload?.world_logline as string) || '',
    description: (n.payload?.world_logline as string) || '',
    interaction_count: 0,
    owner: {
      username: actorName(n),
      is_verified: n.primary_actor?.is_verified ?? false,
    },
    privacy_status: 'public',
    is_draft: false,
  };
}

export default function NotificationsDropdown({ enabled, onOpenWorld }: NotificationsDropdownProps) {
  const utils = trpc.useUtils();
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  /** Server unread badge: GET /api/notifications/unread-count */
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!enabled) {
      setServerUnreadCount(0);
      return;
    }
    try {
      const result = await utils.notifications.unreadCount.fetch();
      setServerUnreadCount(typeof result.count === 'number' ? result.count : 0);
    } catch {
      // Non-fatal for badge
    }
  }, [utils, enabled]);

  const fetchNotifications = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      const append = opts?.append ?? false;
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      try {
        const result = await utils.notifications.list.fetch({
          limit: 25,
          cursor: opts?.cursor || undefined,
        });
        const page = (result.items ?? []) as ApiNotification[];
        setItems((prev) => {
          if (!append) return page;
          const seen = new Set(prev.map((n) => n.external_id));
          const merged = [...prev];
          for (const n of page) {
            if (!seen.has(n.external_id)) {
              seen.add(n.external_id);
              merged.push(n);
            }
          }
          return merged;
        });
        setNextCursor(result.next_cursor ?? null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('SESSION_EXPIRED') || msg.includes('401')) {
          toast.error('Your Freeroam session has expired. Update your cookie in Settings.');
        } else {
          toast.error('Failed to load notifications.');
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [utils]
  );

  const markAllRead = useCallback(async () => {
    if (!enabled || markAllReadMutation.isPending) return;
    try {
      await markAllReadMutation.mutateAsync();
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          read_at: item.read_at ?? now,
          seen_at: item.seen_at ?? now,
        }))
      );
      setServerUnreadCount(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('SESSION_EXPIRED') || msg.includes('401')) {
        toast.error('Your Freeroam session has expired. Update your cookie in Settings.');
      } else {
        toast.error('Failed to mark notifications as read.');
      }
    }
  }, [enabled, markAllReadMutation]);

  // Badge: poll unread-count when cookie is available
  useEffect(() => {
    if (!enabled) {
      setServerUnreadCount(0);
      return;
    }
    void fetchUnreadCount();
    const id = window.setInterval(() => void fetchUnreadCount(), 60_000);
    return () => window.clearInterval(id);
  }, [enabled, fetchUnreadCount]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && enabled) {
      void fetchNotifications();
      void fetchUnreadCount();
    }
  };

  const handleItemClick = (n: ApiNotification) => {
    const world = toApiWorld(n);
    if (!world) {
      toast.message('No world linked to this notification.');
      return;
    }
    setOpen(false);
    // Optimistically mark this row read; full clear uses mark-all-read
    setItems((prev) =>
      prev.map((item) =>
        item.external_id === n.external_id
          ? { ...item, read_at: item.read_at ?? new Date().toISOString(), seen_at: item.seen_at ?? new Date().toISOString() }
          : item
      )
    );
    if (!n.read_at && serverUnreadCount > 0) {
      setServerUnreadCount((c) => Math.max(0, c - 1));
    }
    onOpenWorld(world);
  };

  const badgeCount = serverUnreadCount;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!enabled}
        className="relative w-8 h-8 flex items-center justify-center rounded-sm transition-colors hover:brightness-110 disabled:opacity-40"
        style={{
          background: open ? 'oklch(0.769 0.188 70.08 / 0.12)' : 'oklch(0.18 0.01 264)',
          border: open ? '1px solid oklch(0.769 0.188 70.08 / 0.4)' : '1px solid oklch(1 0 0 / 0.1)',
          color: open ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.55 0.01 264)',
        }}
        title={enabled ? 'Notifications' : 'Connect Freeroam session for notifications'}
      >
        <Bell size={13} strokeWidth={2} />
        {badgeCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full text-[9px] font-bold"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              background: 'oklch(0.55 0.2 25)',
              color: '#fff',
              border: '1px solid oklch(0.65 0.18 25)',
            }}
          >
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 w-[min(100vw-1.5rem,22rem)] max-h-[min(70vh,28rem)] flex flex-col overflow-hidden rounded-sm"
          style={{
            background: 'oklch(0.13 0.01 264)',
            border: '1px solid oklch(1 0 0 / 0.12)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
            zIndex: 60,
          }}
        >
          <div
            className="flex items-center justify-between gap-2 px-3 py-2.5 flex-shrink-0"
            style={{ borderBottom: '1px solid oklch(1 0 0 / 0.08)' }}
          >
            <span
              className="text-[11px] font-semibold tracking-widest uppercase"
              style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)' }}
            >
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {badgeCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={markAllReadMutation.isPending}
                  className="text-[10px] font-semibold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', background: 'none', border: 'none' }}
                >
                  {markAllReadMutation.isPending ? 'Marking…' : 'Mark all read'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void fetchNotifications();
                  void fetchUnreadCount();
                }}
                disabled={isLoading}
                className="text-[10px] font-semibold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.55 0.01 264)', background: 'none', border: 'none' }}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 min-h-0">
            {isLoading && items.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10" style={{ color: 'oklch(0.45 0.01 264)' }}>
                <Loader2 size={14} className="animate-spin" />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>Loading…</span>
              </div>
            )}

            {!isLoading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 14, fontWeight: 700, color: 'oklch(0.4 0.01 264)' }}>
                  ALL QUIET
                </p>
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'oklch(0.35 0.01 264)', marginTop: 6 }}>
                  No notifications yet.
                </p>
              </div>
            )}

            {items.map((n) => {
              const unread = !n.read_at;
              const img = notificationImage(n);
              const worldName = notificationWorldName(n);
              const title = notificationTitle(n);
              const rel = formatRelativeTime(n.created_at);
              return (
                <button
                  key={n.external_id}
                  type="button"
                  onClick={() => handleItemClick(n)}
                  className="w-full flex gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                  style={{
                    borderBottom: '1px solid oklch(1 0 0 / 0.05)',
                    background: unread ? 'oklch(0.769 0.188 70.08 / 0.06)' : 'transparent',
                  }}
                >
                  <div
                    className="flex-shrink-0 w-11 h-11 rounded-sm overflow-hidden"
                    style={{ background: 'oklch(0.18 0.01 264)', border: '1px solid oklch(1 0 0 / 0.08)' }}
                  >
                    {img ? (
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Bell size={14} style={{ color: 'oklch(0.35 0.01 264)' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[12px] font-semibold leading-snug"
                      style={{
                        fontFamily: 'Rajdhani, sans-serif',
                        color: unread ? 'oklch(0.92 0.005 65)' : 'oklch(0.75 0.005 65)',
                      }}
                    >
                      {title}
                    </p>
                    {worldName && (
                      <p
                        className="text-[11px] mt-0.5 truncate"
                        style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.769 0.188 70.08 / 0.9)' }}
                      >
                        {worldName}
                      </p>
                    )}
                    <p
                      className="text-[10px] mt-1"
                      style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.4 0.01 264)' }}
                    >
                      {rel}
                      {unread ? ' · unread' : ''}
                    </p>
                  </div>
                  {unread && (
                    <span
                      className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2"
                      style={{ background: 'oklch(0.769 0.188 70.08)' }}
                    />
                  )}
                </button>
              );
            })}

            {nextCursor && (
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => void fetchNotifications({ append: true, cursor: nextCursor })}
                  disabled={isLoadingMore}
                  className="w-full py-2 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all hover:brightness-110 disabled:opacity-50"
                  style={{
                    fontFamily: 'Rajdhani, sans-serif',
                    background: 'oklch(0.18 0.01 264)',
                    border: '1px solid oklch(1 0 0 / 0.1)',
                    color: 'oklch(0.65 0.01 264)',
                  }}
                >
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
