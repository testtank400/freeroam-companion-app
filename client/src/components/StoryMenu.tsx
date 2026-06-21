// StoryMenu.tsx
// Slide-down story menu overlay for the StoryReader.
// Expands to full viewport width (not constrained to panel).
// Triggered by tapping the pill or swiping down. Swipe-up or chevron to close.

import { ApiWorld } from '@/components/WorldCard';
import { Heart, MessageCircle, Bookmark, Share2, RotateCcw, RefreshCw, Pencil, ChevronDown } from 'lucide-react';
import { useRef } from 'react';
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

type Chapter = {
  chapter_number: number;
  panel_external_id: string;
  image_url: string;
};

interface StoryMenuProps {
  isOpen: boolean;
  onClose: () => void;
  world: ApiWorld;
  currentDepth: number;
  totalDepth?: number;
  progressPanel: BookmarkEntry | null;
  bookmarks: BookmarkEntry[];
  chapters: Chapter[];
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

function ThumbnailCard({
  imageUrl,
  label,
  sublabel,
  onRemove,
  onClick,
}: {
  imageUrl: string;
  label: string;
  sublabel: string;
  onRemove?: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className="relative flex-shrink-0 cursor-pointer transition-all hover:brightness-110"
      style={{ width: '100px' }}
      onClick={onClick}
    >
      <div
        className="w-full rounded-lg overflow-hidden"
        style={{ aspectRatio: '9/16', background: 'rgba(255,255,255,0.05)' }}
      >
        {imageUrl && (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        )}
      </div>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1.5 right-1.5 flex items-center justify-center rounded-full"
          style={{ width: '20px', height: '20px', background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.85)' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      )}
      <div className="mt-2 px-0.5">
        <p style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
          {label}
        </p>
        <p style={{ fontFamily: LORA, fontSize: '10px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
          {sublabel}
        </p>
      </div>
    </div>
  );
}

export default function StoryMenu({
  isOpen,
  onClose,
  world,
  currentDepth,
  totalDepth,
  progressPanel,
  bookmarks,
  chapters,
  tags,
  relatedWorlds,
  onNavigateToPanel,
  onRemoveBookmark,
}: StoryMenuProps) {
  const allBookmarkEntries: BookmarkEntry[] = [
    ...(progressPanel ? [progressPanel] : []),
    ...bookmarks,
  ];

  // Swipe-up to close
  const swipeTouchStartY = useRef<number | null>(null);

  return (
    <>
      {/* Full-screen backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[200]"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={onClose}
        />
      )}

      {/* Slide-down panel — fixed, full viewport width */}
      <div
        className="fixed top-0 left-0 right-0 z-[210] overflow-y-auto"
        style={{
          maxHeight: isOpen ? '90dvh' : '0',
          overflow: isOpen ? 'auto' : 'hidden',
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          background: 'rgba(10, 10, 16, 0.97)',
          backdropFilter: 'blur(24px)',
          borderBottomLeftRadius: '20px',
          borderBottomRightRadius: '20px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
        }}
        onTouchStart={(e) => { swipeTouchStartY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => {
          if (swipeTouchStartY.current === null) return;
          const dy = e.changedTouches[0].clientY - swipeTouchStartY.current;
          if (dy < -50) onClose(); // swipe up ≥ 50px
          swipeTouchStartY.current = null;
        }}
      >
        {/* Content — centered column, max width for readability */}
        <div className="mx-auto px-5 pt-4 pb-8" style={{ maxWidth: '680px' }}>

          {/* Close pill */}
          <div className="flex justify-center mb-4">
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-full transition-all hover:bg-white/10"
              style={{ width: '36px', height: '36px', color: 'rgba(255,255,255,0.45)' }}
            >
              <ChevronDown size={22} strokeWidth={2} />
            </button>
          </div>

          {/* World header */}
          <div className="text-center mb-5">
            <h2 style={{ fontFamily: LORA, fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
              {world.name}
            </h2>
            <p style={{ fontFamily: LORA, fontSize: '14px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
              by {world.owner.username}
            </p>
          </div>

          {/* Action icon row */}
          <div className="flex items-center justify-center gap-8 mb-6">
            {[
              { icon: <Heart size={20} strokeWidth={2} />, label: 'Like' },
              { icon: <MessageCircle size={20} strokeWidth={2} />, label: 'Comment' },
              { icon: <Bookmark size={20} strokeWidth={2} />, label: 'Save' },
              { icon: <Share2 size={20} strokeWidth={2} />, label: 'Share' },
            ].map(({ icon, label }) => (
              <button
                key={label}
                onClick={() => toast(`${label} — coming soon`)}
                className="flex flex-col items-center gap-1.5 transition-all hover:brightness-125"
                style={{ color: 'rgba(255,255,255,0.65)' }}
              >
                {icon}
                <span style={{ fontFamily: LORA, fontSize: '11px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* Page slider */}
          <div
            className="rounded-2xl px-5 py-4 mb-5"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontFamily: LORA, fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                Page
              </span>
              <span style={{ fontFamily: LORA, fontSize: '20px', fontWeight: 700, color: '#fff' }}>
                {currentDepth}
                {totalDepth ? <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}> of {totalDepth}</span> : null}
              </span>
            </div>
            <div className="relative w-full rounded-full" style={{ height: '4px', background: 'rgba(255,255,255,0.12)' }}>
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: totalDepth ? `${Math.min(100, (currentDepth / totalDepth) * 100)}%` : '50%',
                  background: 'rgba(255,255,255,0.65)',
                  transition: 'width 0.3s ease',
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full"
                style={{
                  left: totalDepth ? `calc(${Math.min(100, (currentDepth / totalDepth) * 100)}% - 7px)` : 'calc(50% - 7px)',
                  background: '#fff',
                  boxShadow: '0 0 8px rgba(255,255,255,0.6)',
                }}
              />
            </div>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
            {[
              { icon: <RotateCcw size={15} strokeWidth={2} />, label: 'Restart' },
              { icon: <RefreshCw size={15} strokeWidth={2} />, label: 'Regenerate' },
              { icon: <Pencil size={15} strokeWidth={2} />, label: 'Edit' },
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
                  padding: '10px 22px',
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
            <div className="mb-6">
              <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>
                Bookmarks
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                {allBookmarkEntries.map((entry) => (
                  <ThumbnailCard
                    key={entry.panel_external_id}
                    imageUrl={entry.image_url}
                    label={`Page ${entry.depth}`}
                    sublabel={entry.type === 'progress' ? 'Progress' : 'Bookmark'}
                    onRemove={entry.type === 'bookmark' ? () => onRemoveBookmark(entry.panel_external_id) : undefined}
                    onClick={() => { onNavigateToPanel(entry.panel_external_id); onClose(); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Chapters section */}
          <div className="mb-6">
            <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>
              Chapters
            </p>
            {chapters.length === 0 ? (
              <p style={{ fontFamily: LORA, fontSize: '13px', fontStyle: 'italic', color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '12px 0' }}>
                Chapters will appear here as the story progresses.
              </p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                {[...chapters].sort((a, b) => b.chapter_number - a.chapter_number).map((ch) => (
                  <ThumbnailCard
                    key={ch.chapter_number}
                    imageUrl={ch.image_url}
                    label={`Chapter ${ch.chapter_number}`}
                    sublabel="Chapter"
                    onClick={() => { onNavigateToPanel(ch.panel_external_id); onClose(); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-3 py-1.5 rounded-full text-xs"
                  style={{
                    fontFamily: LORA,
                    fontStyle: 'italic',
                    background: 'rgba(255,255,255,0.07)',
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
              <p className="mb-3 uppercase tracking-widest" style={{ fontFamily: LORA, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>
                You May Also Like
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                {relatedWorlds.slice(0, 10).map((rw) => (
                  <a
                    key={rw.external_id}
                    href={`https://getfreeroam.com/world/${rw.external_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 rounded-lg overflow-hidden transition-all hover:brightness-110"
                    style={{ width: '120px', textDecoration: 'none' }}
                  >
                    <div className="w-full rounded-lg overflow-hidden" style={{ aspectRatio: '3/4', background: 'rgba(255,255,255,0.05)' }}>
                      {rw.cover_image_url && (
                        <img src={rw.cover_image_url} alt={rw.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="mt-1.5 px-0.5">
                      <p className="line-clamp-2" style={{ fontFamily: LORA, fontSize: '12px', fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
                        {rw.name}
                      </p>
                      <p style={{ fontFamily: LORA, fontSize: '11px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
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
