import { useState, useRef, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Search, Play, Pause, Volume2, VolumeX, Mic, X, Check } from 'lucide-react';

interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string | null;
}

interface VoicePickerProps {
  characterId: string;
  characterName: string;
  onClose: () => void;
}

export default function VoicePicker({ characterId, characterName, onClose }: VoicePickerProps) {
  const [search, setSearch] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [stability, setStability] = useState('0.5');
  const [similarityBoost, setSimilarityBoost] = useState('0.75');
  const [style, setStyle] = useState('0');
  const [isSaving, setIsSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: voices, isLoading: voicesLoading } = trpc.voice.listVoices.useQuery();
  const { data: currentAssignment } = trpc.voice.getVoiceAssignment.useQuery({ characterId });
  const assignVoiceMutation = trpc.voice.assignVoice.useMutation();
  const removeVoiceMutation = trpc.voice.removeVoice.useMutation();
  const utils = trpc.useUtils();

  // Seed from existing assignment
  useEffect(() => {
    if (currentAssignment) {
      setSelectedVoiceId(currentAssignment.voiceId);
      setSelectedVoiceName(currentAssignment.voiceName);
      setStability(currentAssignment.stability ?? '0.5');
      setSimilarityBoost(currentAssignment.similarityBoost ?? '0.75');
      setStyle(currentAssignment.style ?? '0');
    }
  }, [currentAssignment]);

  const filteredVoices = (voices ?? []).filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.category.toLowerCase().includes(search.toLowerCase()) ||
    Object.values(v.labels).some(l => l.toLowerCase().includes(search.toLowerCase()))
  );

  const handlePreview = (voice: Voice) => {
    if (!voice.preview_url) return;
    if (playingVoiceId === voice.voice_id) {
      // Stop
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    // Stop current
    audioRef.current?.pause();
    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    audio.play();
    setPlayingVoiceId(voice.voice_id);
    audio.onended = () => setPlayingVoiceId(null);
  };

  const handleSave = async () => {
    if (!selectedVoiceId || !selectedVoiceName) return;
    setIsSaving(true);
    try {
      await assignVoiceMutation.mutateAsync({
        characterId,
        voiceId: selectedVoiceId,
        voiceName: selectedVoiceName,
        stability,
        similarityBoost,
        style,
      });
      utils.voice.getVoiceAssignment.invalidate({ characterId });
      onClose();
    } catch {
      // Error handled by toast
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    setIsSaving(true);
    try {
      await removeVoiceMutation.mutateAsync({ characterId });
      utils.voice.getVoiceAssignment.invalidate({ characterId });
      onClose();
    } catch {
      // Error handled by toast
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: 'min(520px, 95vw)',
          maxHeight: '90vh',
          background: '#1a1a24',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', margin: 0 }}>Voice for {characterName}</h2>
            {currentAssignment && (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '2px 0 0' }}>
                Current: {currentAssignment.voiceName}
              </p>
            )}
          </div>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <Search size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search voices..."
              className="flex-1 outline-none bg-transparent"
              style={{ fontSize: '13px', color: '#fff' }}
              autoFocus
            />
          </div>
        </div>

        {/* Voice list */}
        <div className="flex-1 overflow-y-auto px-3 py-2" style={{ minHeight: 0 }}>
          {voicesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full" style={{ width: '24px', height: '24px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
            </div>
          ) : filteredVoices.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '13px', padding: '32px 0' }}>No voices found</p>
          ) : (
            filteredVoices.map(voice => {
              const isSelected = selectedVoiceId === voice.voice_id;
              const isPlaying = playingVoiceId === voice.voice_id;
              return (
                <div
                  key={voice.voice_id}
                  onClick={() => { setSelectedVoiceId(voice.voice_id); setSelectedVoiceName(voice.name); }}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all mb-1"
                  style={{
                    background: isSelected ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isSelected ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  {/* Select indicator */}
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-full"
                    style={{ width: '20px', height: '20px', background: isSelected ? '#8b5cf6' : 'rgba(255,255,255,0.08)', border: `1px solid ${isSelected ? '#8b5cf6' : 'rgba(255,255,255,0.15)'}` }}
                  >
                    {isSelected && <Check size={11} style={{ color: '#fff' }} />}
                  </div>

                  {/* Voice info */}
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.name}</p>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: '1px 0 0' }}>
                      {voice.category}
                      {voice.labels?.gender ? ` · ${voice.labels.gender}` : ''}
                      {voice.labels?.age ? ` · ${voice.labels.age}` : ''}
                    </p>
                  </div>

                  {/* Preview button */}
                  {voice.preview_url && (
                    <button
                      onClick={e => { e.stopPropagation(); handlePreview(voice); }}
                      className="flex-shrink-0 flex items-center justify-center rounded-full transition-all hover:brightness-125"
                      style={{ width: '28px', height: '28px', background: isPlaying ? '#8b5cf6' : 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Voice settings (shown when a voice is selected) */}
        {selectedVoiceId && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
            <p style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Voice Settings</p>
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              {[
                { label: 'Stability', key: 'stability', value: stability, setter: setStability },
                { label: 'Similarity', key: 'similarityBoost', value: similarityBoost, setter: setSimilarityBoost },
                { label: 'Style', key: 'style', value: style, setter: setStyle },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{label}</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>{parseFloat(value).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={value}
                    onChange={e => setter(e.target.value)}
                    className="w-full"
                    style={{ accentColor: '#8b5cf6', height: '4px' }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {currentAssignment && (
            <button
              onClick={handleRemove}
              disabled={isSaving}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all hover:brightness-125 disabled:opacity-50"
              style={{ fontSize: '13px', fontWeight: 500, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer' }}
            >
              <VolumeX size={13} />
              Remove
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 transition-all hover:brightness-125"
            style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedVoiceId || isSaving}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all hover:brightness-125 disabled:opacity-50"
            style={{ fontSize: '13px', fontWeight: 600, color: '#fff', background: '#8b5cf6', border: 'none', cursor: 'pointer' }}
          >
            <Mic size={13} />
            {isSaving ? 'Saving...' : 'Assign Voice'}
          </button>
        </div>
      </div>
    </div>
  );
}
