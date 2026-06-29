import { trpc } from '@/lib/trpc';
import { Search, Play, Pause, Mic, X, Check, Upload, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

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

const DEFAULT_TEST_PHRASES = [
  "The battlefield falls silent. Only the wind remains.",
  "I've been waiting for you. Longer than you know.",
  "This world was never meant for people like us.",
];

export default function VoicePicker({ characterId, characterName, onClose }: VoicePickerProps) {
  const [activeTab, setActiveTab] = useState<'select' | 'clone'>('select');
  const [search, setSearch] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [stability, setStability] = useState('0.5');
  const [similarityBoost, setSimilarityBoost] = useState('0.75');
  const [style, setStyle] = useState('0');
  const [languageCode, setLanguageCode] = useState<string>('');  // '' = no override
  const [isSaving, setIsSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [testPhrasePreset, setTestPhrasePreset] = useState<string>(DEFAULT_TEST_PHRASES[0]);
  const [customPhrase, setCustomPhrase] = useState('');
  const testPhrase = testPhrasePreset === '__custom__' ? customPhrase : testPhrasePreset;
  const [isTesting, setIsTesting] = useState(false);
  const [testPlayingVoiceId, setTestPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clone voice state
  const [cloneName, setCloneName] = useState(characterName);
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [removeNoise, setRemoveNoise] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const cloneFileRef = useRef<HTMLInputElement>(null);

  const { data: voices, isLoading: voicesLoading, refetch: refetchVoices } = trpc.voice.listVoices.useQuery();
  const { data: currentAssignment } = trpc.voice.getVoiceAssignment.useQuery({ characterId });
  const assignVoiceMutation = trpc.voice.assignVoice.useMutation();
  const removeVoiceMutation = trpc.voice.removeVoice.useMutation();
  const cloneVoiceMutation = trpc.voice.cloneVoice.useMutation();
  const testVoiceMutation = trpc.voice.testVoice.useMutation();
  const utils = trpc.useUtils();

  // Seed from existing assignment
  const [seeded, setSeeded] = useState(false);
  if (currentAssignment && !seeded) {
    setSelectedVoiceId(currentAssignment.voiceId);
    setSelectedVoiceName(currentAssignment.voiceName);
    setStability(currentAssignment.stability ?? '0.5');
    setSimilarityBoost(currentAssignment.similarityBoost ?? '0.75');
    setStyle(currentAssignment.style ?? '0');
    setLanguageCode(currentAssignment.languageCode ?? '');
    setSeeded(true);
  }

  const filteredVoices = (voices ?? []).filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.category.toLowerCase().includes(search.toLowerCase()) ||
    Object.values(v.labels).some(l => l.toLowerCase().includes(search.toLowerCase()))
  );

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingVoiceId(null);
    setTestPlayingVoiceId(null);
  };

  const handleClose = () => {
    stopAudio();
    onClose();
  };

  const playAudio = (url: string, onEnd?: () => void) => {
    stopAudio();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play();
    audio.onended = () => {
      setPlayingVoiceId(null);
      setTestPlayingVoiceId(null);
      onEnd?.();
    };
  };

  const handlePreview = (voice: Voice) => {
    if (!voice.preview_url) return;
    if (playingVoiceId === voice.voice_id) {
      stopAudio();
      return;
    }
    playAudio(voice.preview_url);
    setPlayingVoiceId(voice.voice_id);
  };

  const handleTestVoice = async () => {
    if (!selectedVoiceId || !testPhrase.trim()) return;
    if (testPlayingVoiceId === selectedVoiceId) {
      stopAudio();
      return;
    }
    setIsTesting(true);
    try {
      const { audioUrl } = await testVoiceMutation.mutateAsync({
        voiceId: selectedVoiceId,
        text: testPhrase.trim(),
        stability,
        similarityBoost,
        style,
        languageCode: languageCode || null,
      });
      playAudio(audioUrl);
      setTestPlayingVoiceId(selectedVoiceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedVoiceId || !selectedVoiceName) return;
    stopAudio();
    setIsSaving(true);
    try {
      await assignVoiceMutation.mutateAsync({
        characterId,
        voiceId: selectedVoiceId,
        voiceName: selectedVoiceName,
        stability,
        similarityBoost,
        style,
        languageCode: languageCode || null,
      });
      utils.voice.getVoiceAssignment.invalidate({ characterId });
      utils.voice.listVoicedCharacters.invalidate();
      toast.success('Voice assigned.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign voice');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    stopAudio();
    setIsSaving(true);
    try {
      await removeVoiceMutation.mutateAsync({ characterId });
      utils.voice.getVoiceAssignment.invalidate({ characterId });
      utils.voice.listVoicedCharacters.invalidate();
      toast.success('Voice removed.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove voice');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClone = async () => {
    if (!cloneFile || !cloneName.trim()) return;
    setIsCloning(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(cloneFile);
      });

      const result = await cloneVoiceMutation.mutateAsync({
        name: cloneName.trim(),
        description: cloneDescription.trim() || undefined,
        removeBackgroundNoise: removeNoise,
        audioBase64: base64,
        audioMimeType: cloneFile.type || 'audio/mpeg',
        audioFileName: cloneFile.name,
      });

      toast.success(`Voice "${cloneName}" cloned successfully!`);
      await refetchVoices();
      setSelectedVoiceId(result.voice_id);
      setSelectedVoiceName(cloneName.trim());
      setActiveTab('select');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Voice cloning failed');
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="flex flex-col rounded-2xl"
        style={{
          width: 'min(520px, 95vw)',
          height: 'min(600px, 92vh)',
          background: '#1a1a24',
          border: '1px solid rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', margin: 0 }}>Voice for {characterName}</h2>
            {currentAssignment && (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '2px 0 0' }}>
                Current: {currentAssignment.voiceName}
              </p>
            )}
          </div>
          <button onClick={handleClose} style={{ color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          {(['select', 'clone'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-2.5 text-sm font-medium transition-all"
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #8b5cf6' : '2px solid transparent',
                color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {tab === 'select' ? 'Select Voice' : 'Clone Voice'}
            </button>
          ))}
        </div>

        {activeTab === 'select' ? (
          <div className="flex flex-col" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
            {/* Search */}
            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
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
            <div className="overflow-y-auto px-3 py-2" style={{ minHeight: 0, flex: '1 1 0' }}>
              {voicesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
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
                      <div
                        className="flex-shrink-0 flex items-center justify-center rounded-full"
                        style={{ width: '20px', height: '20px', background: isSelected ? '#8b5cf6' : 'rgba(255,255,255,0.08)', border: `1px solid ${isSelected ? '#8b5cf6' : 'rgba(255,255,255,0.15)'}` }}
                      >
                        {isSelected && <Check size={11} style={{ color: '#fff' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.name}</p>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: '1px 0 0' }}>
                          {voice.category}
                          {voice.labels?.gender ? ` · ${voice.labels.gender}` : ''}
                          {voice.labels?.age ? ` · ${voice.labels.age}` : ''}
                        </p>
                      </div>
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

            {/* Voice settings — collapsible */}
            {selectedVoiceId && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
                {/* Settings header — click to toggle */}
                <button
                  onClick={() => setSettingsOpen(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 transition-all hover:brightness-125"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Voice Settings
                  </span>
                  {settingsOpen
                    ? <ChevronUp size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />
                    : <ChevronDown size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  }
                </button>

                {settingsOpen && (
                  <div className="px-4 pb-3">
                    {/* Sliders */}
                    <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                      {[
                        { label: 'Stability', value: stability, setter: setStability },
                        { label: 'Similarity', value: similarityBoost, setter: setSimilarityBoost },
                        { label: 'Style', value: style, setter: setStyle },
                      ].map(({ label, value, setter }) => (
                        <div key={label}>
                          <div className="flex items-center justify-between mb-1">
                            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{label}</span>
                            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>{parseFloat(value).toFixed(2)}</span>
                          </div>
                          <input type="range" min="0" max="1" step="0.01" value={value} onChange={e => setter(e.target.value)} className="w-full" style={{ accentColor: '#8b5cf6', height: '4px' }} />
                        </div>
                      ))}
                    </div>

                    {/* Language code dropdown */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Accent / Language</span>
                        {languageCode && (
                          <button onClick={() => setLanguageCode('')} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
                        )}
                      </div>
                      <select
                        value={languageCode}
                        onChange={e => setLanguageCode(e.target.value)}
                        className="w-full rounded-lg px-2 py-1.5 outline-none"
                        style={{ fontSize: '12px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                      >
                        <option value="" style={{ background: '#1a1a24' }}>No override (auto-detect)</option>
                        <option value="en" style={{ background: '#1a1a24' }}>English</option>
                        <option value="en-US" style={{ background: '#1a1a24' }}>English (US)</option>
                        <option value="en-GB" style={{ background: '#1a1a24' }}>English (UK)</option>
                        <option value="en-AU" style={{ background: '#1a1a24' }}>English (Australian)</option>
                        <option value="it" style={{ background: '#1a1a24' }}>Italian</option>
                        <option value="fr" style={{ background: '#1a1a24' }}>French</option>
                        <option value="de" style={{ background: '#1a1a24' }}>German</option>
                        <option value="es" style={{ background: '#1a1a24' }}>Spanish</option>
                        <option value="pt" style={{ background: '#1a1a24' }}>Portuguese</option>
                        <option value="ja" style={{ background: '#1a1a24' }}>Japanese</option>
                        <option value="ko" style={{ background: '#1a1a24' }}>Korean</option>
                        <option value="zh" style={{ background: '#1a1a24' }}>Chinese</option>
                        <option value="ru" style={{ background: '#1a1a24' }}>Russian</option>
                        <option value="ar" style={{ background: '#1a1a24' }}>Arabic</option>
                        <option value="hi" style={{ background: '#1a1a24' }}>Hindi</option>
                        <option value="pl" style={{ background: '#1a1a24' }}>Polish</option>
                        <option value="nl" style={{ background: '#1a1a24' }}>Dutch</option>
                        <option value="sv" style={{ background: '#1a1a24' }}>Swedish</option>
                        <option value="tr" style={{ background: '#1a1a24' }}>Turkish</option>
                      </select>
                    </div>

                    {/* Test phrase row */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={testPhrasePreset}
                          onChange={e => setTestPhrasePreset(e.target.value)}
                          className="flex-1 rounded-lg px-2 py-1.5 outline-none"
                          style={{ fontSize: '12px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                        >
                          {DEFAULT_TEST_PHRASES.map(p => (
                            <option key={p} value={p} style={{ background: '#1a1a24' }}>{p}</option>
                          ))}
                          <option value="__custom__" style={{ background: '#1a1a24' }}>Custom…</option>
                        </select>
                        <button
                          onClick={handleTestVoice}
                          disabled={isTesting || !testPhrase.trim()}
                          className="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all hover:brightness-125 disabled:opacity-50"
                          style={{ fontSize: '12px', fontWeight: 500, color: '#fff', background: testPlayingVoiceId === selectedVoiceId ? '#8b5cf6' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          {isTesting
                            ? <><Loader2 size={12} className="animate-spin" /> Testing…</>
                            : testPlayingVoiceId === selectedVoiceId
                              ? <><Pause size={12} /> Stop</>
                              : <><Play size={12} /> Test</>
                          }
                        </button>
                      </div>
                      {testPhrasePreset === '__custom__' && (
                        <input
                          type="text"
                          value={customPhrase}
                          onChange={e => setCustomPhrase(e.target.value)}
                          placeholder="Type your own test phrase…"
                          className="w-full outline-none rounded-lg px-2 py-1.5"
                          style={{ fontSize: '12px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                          autoFocus
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
              {currentAssignment && (
                <button onClick={handleRemove} disabled={isSaving} className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all hover:brightness-125 disabled:opacity-50" style={{ fontSize: '13px', fontWeight: 500, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer' }}>
                  Remove
                </button>
              )}
              <div className="flex-1" />
              <button onClick={handleClose} className="rounded-xl px-4 py-2 transition-all hover:brightness-125" style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={!selectedVoiceId || isSaving} className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all hover:brightness-125 disabled:opacity-50" style={{ fontSize: '13px', fontWeight: 600, color: '#fff', background: '#8b5cf6', border: 'none', cursor: 'pointer' }}>
                <Mic size={13} />
                {isSaving ? 'Saving...' : 'Assign Voice'}
              </button>
            </div>
          </div>
        ) : (
          /* Clone Voice Tab */
          <div className="flex flex-col flex-1 overflow-y-auto px-4 py-4 gap-4" style={{ minHeight: 0 }}>
            <div>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginBottom: '16px' }}>
                Upload an audio sample to clone a new voice. For best results, use a clear recording with minimal background noise (1–5 minutes of speech).
              </p>

              {/* Voice name */}
              <div className="mb-3">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Voice Name</label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={e => setCloneName(e.target.value)}
                  placeholder="e.g. Aria's Voice"
                  className="w-full outline-none rounded-xl px-3 py-2"
                  style={{ fontSize: '13px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                />
              </div>

              {/* Description */}
              <div className="mb-3">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description (optional)</label>
                <input
                  type="text"
                  value={cloneDescription}
                  onChange={e => setCloneDescription(e.target.value)}
                  placeholder="e.g. Soft female voice, British accent"
                  className="w-full outline-none rounded-xl px-3 py-2"
                  style={{ fontSize: '13px', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                />
              </div>

              {/* Audio file upload */}
              <div className="mb-3">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Audio Sample</label>
                <input
                  ref={cloneFileRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/m4a,audio/ogg,audio/flac,audio/*"
                  onChange={e => setCloneFile(e.target.files?.[0] ?? null)}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => cloneFileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-6 transition-all hover:brightness-125"
                  style={{ background: 'rgba(255,255,255,0.04)', border: `2px dashed ${cloneFile ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.15)'}`, color: cloneFile ? '#a78bfa' : 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
                >
                  <Upload size={16} />
                  <span style={{ fontSize: '13px' }}>
                    {cloneFile ? cloneFile.name : 'Click to upload audio (MP3, WAV, M4A, OGG, FLAC)'}
                  </span>
                </button>
                {cloneFile && (
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '4px' }}>
                    {(cloneFile.size / 1024 / 1024).toFixed(2)} MB · {cloneFile.type}
                  </p>
                )}
              </div>

              {/* Remove background noise toggle */}
              <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#fff', margin: 0 }}>Remove Background Noise</p>
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>May reduce quality if sample is already clean</p>
                </div>
                <button
                  onClick={() => setRemoveNoise(v => !v)}
                  className="flex-shrink-0 rounded-full transition-all"
                  style={{ width: '40px', height: '22px', background: removeNoise ? '#8b5cf6' : 'rgba(255,255,255,0.15)', position: 'relative', border: 'none', cursor: 'pointer' }}
                >
                  <span style={{ position: 'absolute', top: '2px', left: removeNoise ? '20px' : '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease' }} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <div className="flex-1" />
              <button onClick={handleClose} className="rounded-xl px-4 py-2 transition-all hover:brightness-125" style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleClone}
                disabled={!cloneFile || !cloneName.trim() || isCloning}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all hover:brightness-125 disabled:opacity-50"
                style={{ fontSize: '13px', fontWeight: 600, color: '#fff', background: '#8b5cf6', border: 'none', cursor: 'pointer' }}
              >
                {isCloning ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
                {isCloning ? 'Cloning...' : 'Clone Voice'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
