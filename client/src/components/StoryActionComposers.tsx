/**
 * Isolated text composers for StoryReader.
 * Own their input state so typing does NOT re-render the full ~3k-line StoryReader
 * (ambient blur, panel art, dialogue, badges, etc.).
 */
import { ChevronRight, Loader2 } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

export const IMAGE_ACTION_PREFIX = 'Change the image to ';
export const DIRECT_ACTION_PREFIX = 'Change the story so that ';

type ActionMode = 'act' | 'direct' | 'image';

interface ActionBarComposerProps {
  mode: ActionMode;
  isSending: boolean;
  onSubmit: (text: string, type: 'take-action' | 'steer-story' | 'image') => void;
  onEscape: () => void;
}

export const ActionBarComposer = memo(function ActionBarComposer({
  mode,
  isSending,
  onSubmit,
  onEscape,
}: ActionBarComposerProps) {
  // Separate buffers per mode — switching modes preserves each draft
  const [act, setAct] = useState('');
  const [direct, setDirect] = useState(DIRECT_ACTION_PREFIX);
  const [image, setImage] = useState(IMAGE_ACTION_PREFIX);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = mode === 'act' ? act : mode === 'direct' ? direct : image;
  const setText = (val: string) => {
    if (mode === 'act') setAct(val);
    else if (mode === 'direct') setDirect(val);
    else setImage(val);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const len = el.value.length;
    requestAnimationFrame(() => {
      el.setSelectionRange(len, len);
      el.focus();
    });
  }, [mode]);

  const actionType: 'take-action' | 'steer-story' | 'image' =
    mode === 'act' ? 'take-action' : mode === 'direct' ? 'steer-story' : 'image';

  const submit = () => {
    if (!text.trim() || isSending) return;
    onSubmit(text, actionType);
    // Reset the buffer that was submitted
    if (mode === 'act') setAct('');
    else if (mode === 'direct') setDirect(DIRECT_ACTION_PREFIX);
    else setImage(IMAGE_ACTION_PREFIX);
  };

  return (
    <div
      className="flex items-start gap-2 px-3 py-2"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={text}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="on"
        spellCheck={true}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onEscape();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          mode === 'act'
            ? 'What do you do?'
            : mode === 'direct'
              ? 'Change the story so that…'
              : 'Change the image to…'
        }
        className="flex-1 outline-none resize-none"
        style={{
          fontFamily: 'Outfit-Regular, Outfit, sans-serif',
          fontSize: '14px',
          color: 'rgba(255,255,255,0.85)',
          background: 'transparent',
          border: 'none',
          minWidth: 0,
          lineHeight: 1.5,
          overflow: 'hidden',
          maxHeight: '120px',
          overflowY: 'auto',
        }}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || isSending}
        className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:brightness-125 disabled:opacity-40 mt-0.5"
        style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.15)', color: '#fff' }}
      >
        {isSending ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={18} strokeWidth={2.5} />}
      </button>
    </div>
  );
});

interface ChoiceComposerProps {
  isSending: boolean;
  onSubmit: (text: string) => void;
}

export const ChoiceComposer = memo(function ChoiceComposer({
  isSending,
  onSubmit,
}: ChoiceComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim() || isSending) return;
    onSubmit(text);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div
      className="flex items-start gap-2 px-4 py-2"
      style={{
        background: 'rgba(30,30,30,0.65)',
        border: '1px solid rgba(255,255,255,0.22)',
        borderRadius: '20px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="on"
        spellCheck={true}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Or type your own response..."
        className="flex-1 outline-none resize-none"
        style={{
          fontFamily: 'Outfit, sans-serif',
          fontSize: '14px',
          color: 'rgba(255,255,255,0.75)',
          background: 'transparent',
          border: 'none',
          minWidth: 0,
          lineHeight: 1.5,
          overflow: 'hidden',
          maxHeight: '120px',
          overflowY: 'auto',
        }}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || isSending}
        className="flex items-center justify-center rounded-full flex-shrink-0 transition-all hover:brightness-125 disabled:opacity-40 mt-0.5"
        style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', color: '#fff' }}
      >
        {isSending ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={16} strokeWidth={2.5} />}
      </button>
    </div>
  );
});
