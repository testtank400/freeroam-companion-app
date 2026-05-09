// CollectionsStrip.tsx
// Horizontal row of collection chips above the filter chips.
// Each chip shows stacked character headshot previews + count badge.
// Clicking a chip filters the grid to that collection.
// "+ New" opens an inline name input.
// Long-pressing or right-clicking a chip opens rename/delete options.

import { Collection } from '@/hooks/useCollections';
import { ApiCharacter } from '@/pages/Home';
import { Check, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface CollectionsStripProps {
  collections: Collection[];
  allCharacters: ApiCharacter[];
  activeCollectionId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

const FALLBACK = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iIzFhMWEyNCIvPjwvc3ZnPg==';

function StackedAvatars({ characters }: { characters: ApiCharacter[] }) {
  const preview = characters.slice(0, 3);
  return (
    <div className="flex items-center" style={{ marginRight: preview.length > 0 ? '2px' : 0 }}>
      {preview.map((c, i) => (
        <div
          key={c.external_id}
          className="rounded-sm overflow-hidden flex-shrink-0"
          style={{
            width: 20,
            height: 24,
            marginLeft: i > 0 ? -6 : 0,
            border: '1px solid oklch(0.11 0.009 264)',
            zIndex: preview.length - i,
            position: 'relative',
          }}
        >
          <img
            src={c.display_headshot_url ?? c.headshot_url ?? FALLBACK}
            alt={c.name}
            className="w-full h-full object-cover object-top"
            onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }}
          />
        </div>
      ))}
    </div>
  );
}

export default function CollectionsStrip({
  collections,
  allCharacters,
  activeCollectionId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: CollectionsStripProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCreating) newInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCreate = () => {
    if (!newName.trim()) { setIsCreating(false); return; }
    onCreate(newName.trim());
    setNewName('');
    setIsCreating(false);
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    onRename(id, editName.trim());
    setEditingId(null);
    setMenuId(null);
  };

  const getCharsForCollection = (col: Collection) =>
    allCharacters.filter(c => col.characterIds.includes(c.external_id));

  if (collections.length === 0 && !isCreating) {
    return (
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.05)' }} />
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wider uppercase transition-all hover:brightness-110"
          style={{
            fontFamily: 'Rajdhani, sans-serif',
            background: 'oklch(0.15 0.01 264)',
            border: '1px solid oklch(1 0 0 / 0.08)',
            color: 'oklch(0.45 0.01 264)',
          }}
        >
          <FolderOpen size={12} strokeWidth={2} />
          New Collection
        </button>
        <div className="h-px flex-1" style={{ background: 'oklch(1 0 0 / 0.05)' }} />
      </div>
    );
  }

  return (
    <div className="mb-5">
      {/* Section header */}
      <div className="flex items-center justify-between mb-2.5">
        <span
          className="text-[10px] uppercase tracking-[0.2em]"
          style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.4 0.01 264)', fontWeight: 600 }}
        >
          Collections
        </span>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase transition-all hover:brightness-110"
          style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.769 0.188 70.08)', background: 'none', border: 'none' }}
        >
          <Plus size={11} strokeWidth={2.5} />
          New
        </button>
      </div>

      {/* Horizontal scrollable strip */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>

        {/* New collection input */}
        {isCreating && (
          <div
            className="flex items-center gap-1.5 flex-shrink-0 rounded-sm overflow-hidden"
            style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(0.769 0.188 70.08 / 0.4)' }}
          >
            <input
              ref={newInputRef}
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setIsCreating(false); setNewName(''); } }}
              placeholder="Collection name..."
              className="px-2 py-1.5 text-[11px] bg-transparent outline-none"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.88 0.005 65)', width: 140 }}
            />
            <button onClick={handleCreate} className="px-1.5 py-1.5 hover:opacity-80" style={{ color: 'oklch(0.769 0.188 70.08)' }}>
              <Check size={12} strokeWidth={2.5} />
            </button>
            <button onClick={() => { setIsCreating(false); setNewName(''); }} className="px-1.5 py-1.5 hover:opacity-80" style={{ color: 'oklch(0.5 0.01 264)' }}>
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* Collection chips */}
        {collections.map(col => {
          const chars = getCharsForCollection(col);
          const isActive = activeCollectionId === col.id;
          const isEditing = editingId === col.id;
          const showMenu = menuId === col.id;

          return (
            <div key={col.id} className="relative flex-shrink-0" ref={showMenu ? menuRef : undefined}>
              {isEditing ? (
                <div
                  className="flex items-center gap-1 rounded-sm overflow-hidden"
                  style={{ background: 'oklch(0.15 0.01 264)', border: '1px solid oklch(0.769 0.188 70.08 / 0.4)' }}
                >
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(col.id); if (e.key === 'Escape') setEditingId(null); }}
                    className="px-2 py-1.5 text-[11px] bg-transparent outline-none"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.88 0.005 65)', width: 130 }}
                  />
                  <button onClick={() => handleRename(col.id)} className="px-1.5 py-1.5 hover:opacity-80" style={{ color: 'oklch(0.769 0.188 70.08)' }}>
                    <Check size={12} strokeWidth={2.5} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="px-1.5 py-1.5 hover:opacity-80" style={{ color: 'oklch(0.5 0.01 264)' }}>
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onSelect(isActive ? null : col.id)}
                  onContextMenu={e => { e.preventDefault(); setMenuId(showMenu ? null : col.id); }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-sm transition-all hover:brightness-110"
                  style={{
                    background: isActive ? 'oklch(0.769 0.188 70.08 / 0.15)' : 'oklch(0.15 0.01 264)',
                    border: isActive ? '1px solid oklch(0.769 0.188 70.08 / 0.45)' : '1px solid oklch(1 0 0 / 0.08)',
                    color: isActive ? 'oklch(0.769 0.188 70.08)' : 'oklch(0.65 0.01 264)',
                  }}
                >
                  {chars.length > 0 && <StackedAvatars characters={chars} />}
                  <span
                    className="text-[11px] font-semibold tracking-wide uppercase"
                    style={{ fontFamily: 'Rajdhani, sans-serif', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {col.name}
                  </span>
                  <span
                    className="inline-flex items-center justify-center rounded-sm px-1 min-w-[16px] h-[14px] text-[9px] font-bold flex-shrink-0"
                    style={{ fontFamily: 'JetBrains Mono, monospace', background: 'oklch(1 0 0 / 0.1)', color: 'inherit' }}
                  >
                    {chars.length}
                  </span>
                </button>
              )}

              {/* Context menu (rename / delete) */}
              {showMenu && (
                <div
                  ref={menuRef}
                  className="absolute top-full left-0 mt-1 rounded-sm overflow-hidden z-50"
                  style={{
                    background: 'oklch(0.16 0.01 264)',
                    border: '1px solid oklch(1 0 0 / 0.12)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    minWidth: 140,
                  }}
                >
                  <button
                    onClick={() => { setEditName(col.name); setEditingId(col.id); setMenuId(null); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-white/5 transition-colors"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.75 0.005 65)' }}
                  >
                    <Pencil size={11} strokeWidth={2} />
                    Rename
                  </button>
                  <button
                    onClick={() => { onDelete(col.id); setMenuId(null); if (activeCollectionId === col.id) onSelect(null); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-white/5 transition-colors"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: 'oklch(0.7 0.18 25)' }}
                  >
                    <Trash2 size={11} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
