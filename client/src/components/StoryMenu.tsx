// StoryMenu.tsx
// Slide-down story menu overlay for the StoryReader.
// Triggered by tapping the white pill at the top center of the panel.
// Sections: world info header, page slider, action buttons, bookmarks, chapters, tags, related worlds.

import { ApiWorld } from '@/components/WorldCard';
import { Bookmark, Heart, MessageCircle, Share2, RotateCcw, RefreshCw, Pencil, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

type BookmarkEntry = {
  panel_external_id: string;
  depth: number;
  image_url: string;
  type: 'bookmark' | 'progress';
};

type Tag = {
  id: number;
  name: string;
  is_fandom: boolean;
  emoji: string | null;
};

type RelatedWorld = {
  external_id: string;
  name: string;
  logline: string;
  cover_image_url: string | null;
  owner: { username: string; is_verified: boolean; avatar_url: string | null };
  interaction_count: number;
  tag_name: string;
  tag_is_fandom: boolean;
};

interface StoryMenuProps {
  isOpen: boolean;
  onClose: () => void;
  world: ApiWorld;
  currentDepth: number;
  /** Total panels known so far (from depth of latest panel) */
  totalDepth?: number;
  progressPanel: BookmarkEntry | null;
  bookmarks: BookmarkEntry[];
  tags: Tag[];
  relatedWorlds: RelatedWorld[];
  onNavigateToPanel: (panelId: string) => void;
  onRemoveBookmark: (panelId: string) => void;
}

const LORA = 'Lora, Georgia, serif';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export default function StoryMenu({
  isOpen,
  onClose,
  world,
  currentDepth,
  totalDepth,
  progressPanel,
  bookmarks,
  tags,
  relatedWorlds,
  onNavigateToPanel,
  onRemoveBookmark,
}: StoryMenuProps) {
  const allBookmarkEntries: BookmarkEntry[] = [
    ...(progressPanel ? [progressPanel] : []),
    ...bookmarks,
  ];

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="absolute inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={onClose}
        />
      )}

      {/* Slide-down panel */}
      <div
        className="absolute top-0 left-0 right-0 z-50 overflow-y-auto"
        style={{
          maxHeight: isOpen ? '90%' : '0',
          overflow: isOpen ? 'auto' : 'hidden',
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          background: 'rgba(12, 12, 18, 0.97)',
          backdropFilter: 'blur(20px)',
          borderBottomLeftRadius: '16px',
          borderBottomRightRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div className="px-5 pt-4 pb-6">

          {/* Close pill */}
          <div className="flex justify-center mb-4">
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-full transition-all hover:bg-white/10"
              style={{ width: '32px', height: '32px', color: 'rgba(255,255,255,0.5)' }}
            >
              <ChevronDown size={20} strokeWidth={2} />
            </button>
          </div>

          {/* World header */}
          <div className="text-center mb-4">
            <h2 style={{ fontFamily: LORA, fontSize: '22px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
              {world.name}
            </h2>
            <p style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
              by {world.owner.username}
            </p>
          </div>

          {/* Action icon row */}
          <div className="flex items-center justify-center gap-4 mb-5">
            {[
              { icon: <Heart size={18} strokeWidth={2} />, label: 'Like' },
              { icon: <MessageCircle size={18} strokeWidth={2} />, label: 'Comment' },
              { icon: <Bookmark size={18} strokeWidth={2} />, label: 'Save' },
              { icon: <Share2 size={18} strokeWidth={2} />, label: 'Share' },
            ].map(({ icon, label }) => (
              <button
                key={label}
                onClick={() => toast(`${label} — coming soon`)}
                className="flex flex-col items-center gap-1 transition-all hover:brightness-125"
                style={{ color: 'rgba(255,255,255,0.65)' }}
              >
                {icon}
                <span style={{ fontFamily: LORA, fontSize: '10px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* Page slider */}
          <div
            className="rounded-xl px-4 py-3 mb-4"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontFamily: LORA, fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                Page
              </span>
              <span style={{ fontFamily: LORA, fontSize: '18px', fontWeight: 700, color: '#fff' }}>
                {currentDepth}
                {totalDepth ? <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}> of {totalDepth}</span> : null}
              </span>
            </div>
            {/* Slider track — display only until we have a jump-to-page endpoint */}
            <div
              className="relative w-full rounded-full"
              style={{ height: '4px', background: 'rgba(255,255,255,0.12)' }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: totalDepth ? `${Math.min(100, (currentDepth / totalDepth) * 100)}%` : '50%',
                  background: 'rgba(255,255,255,0.6)',
                  transition: 'width 0.3s ease',
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
                style={{
                  left: totalDepth ? `calc(${Math.min(100, (currentDepth / totalDepth) * 100)}% - 6px)` : 'calc(50% - 6px)',
                  background: '#fff',
                  boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                }}
              />
            </div>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center justify-center gap-3 mb-5 flex-wrap">
            {[
              { icon: <RotateCcw size={14} strokeWidth={2} />, label: 'Restart' },
              { icon: <RefreshCw size={14} strokeWidth={2} />, label: 'Regenerate' },
              { icon: <Pencil size={14} strokeWidth={2} />, label: 'Edit' },
            ].map(({ icon, label }) => (
              <button
                key={label}
                onClick={() => toast(`${label} — coming soon`)}
                className="flex items-center gap-2 rounded-full transition-all hover:brightness-125"
                style={{
                  fontFamily: LORA,
                  fontSize: '14px',
                  fontStyle: 'italic',
                  color: 'rgba(255,255,255,0.75)',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  padding: '10px 20px',
                  whiteSpace: 'nowrap',
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {/* Bookmarks section */}
          {allBookmarkEntries.length > 0 && (
            <div className="mb-5">
              <p
                className="mb-3 uppercase tracking-widest"
                style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}
              >
                Bookmarks
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                {allBookmarkEntries.map((entry) => (
                  <div
                    key={entry.panel_external_id}
                    className="relative flex-shrink-0 cursor-pointer rounded-lg overflow-hidden transition-all hover:brightness-110"
                    style={{ width: '80px' }}
                    onClick={() => {
                      onNavigateToPanel(entry.panel_external_id);
                      onClose();
                    }}
                  >
                    {/* Thumbnail */}
                    <div
                      className="w-full rounded-lg overflow-hidden"
                      style={{ aspectRatio: '9/16', background: 'rgba(255,255,255,0.05)' }}
                    >
                      {entry.image_url && (
                        <img
                          src={entry.image_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>

                    {/* Remove bookmark X (only for bookmarks, not progress) */}
                    {entry.type === 'bookmark' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveBookmark(entry.panel_external_id);
                        }}
                        className="absolute top-1 right-1 flex items-center justify-center rounded-full transition-all hover:bg-black/60"
                        style={{ width: '18px', height: '18px', background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)' }}
                      >
                        <X size={10} strokeWidth={2.5} />
                      </button>
                    )}

                    {/* Label */}
                    <div className="mt-1.5 px-0.5">
                      <p style={{ fontFamily: LORA, fontSize: '11px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                        Page {entry.depth}
                      </p>
                      <p style={{ fontFamily: LORA, fontSize: '9px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {entry.type === 'progress' ? 'Progress' : 'Bookmark'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chapters section */}
          <div className="mb-5">
            <p
              className="mb-2 uppercase tracking-widest"
              style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}
            >
              Chapters
            </p>
            <p style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '12px 0' }}>
              Chapters will appear here as the story progresses.
            </p>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-3 py-1 rounded-full text-xs"
                  style={{
                    fontFamily: LORA,
                    fontStyle: 'italic',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Related worlds */}
          {relatedWorlds.length > 0 && (
            <div>
              <p
                className="mb-3 uppercase tracking-widest"
                style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}
              >
                You May Also Like
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                {relatedWorlds.slice(0, 8).map((rw) => (
                  <a
                    key={rw.external_id}
                    href={`https://getfreeroam.com/world/${rw.external_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 rounded-lg overflow-hidden transition-all hover:brightness-110"
                    style={{ width: '120px', textDecoration: 'none' }}
                  >
                    <div
                      className="w-full rounded-lg overflow-hidden"
                      style={{ aspectRatio: '3/4', background: 'rgba(255,255,255,0.05)' }}
                    >
                      {rw.cover_image_url && (
                        <img
                          src={rw.cover_image_url}
                          alt={rw.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="mt-1.5 px-0.5">
                      <p
                        className="line-clamp-2"
                        style={{ fontFamily: LORA, fontSize: '11px', fontWeight: 700, color: '#fff', lineHeight: 1.3 }}
                      >
                        {rw.name}
                      </p>
                      <p style={{ fontFamily: LORA, fontSize: '10px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                        {formatCount(rw.interaction_count)} reads
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
