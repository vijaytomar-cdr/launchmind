'use client';
/**
 * @file tabs/VoiceCloneTab.tsx
 * @description Settings → Voice clone tab.
 *   Upload a 60-second audio sample to generate WhatsApp voice notes in your voice.
 * @security API token fetched fresh on mount. Audio not stored by LaunchMind.
 * @dependencies api.settings.uploadVoiceClone, api.settings.deleteVoiceClone
 */

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

export function VoiceCloneTab() {
  const supabase = createClient();

  const [voiceCloneId, setVoiceCloneId] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const voiceFileRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef('');

  useEffect(() => {
    async function load() {
      const { data: { user, session } } = await supabase.auth.getUser().then(async u => {
        const s = await supabase.auth.getSession();
        return { data: { user: u.data.user, session: s.data.session } };
      });
      if (!user || !session) return;
      tokenRef.current = session.access_token;

      const { data: founderRow } = await supabase
        .from('founders')
        .select('voice_clone_id')
        .eq('id', user.id)
        .single();
      setVoiceCloneId(founderRow?.voice_clone_id ?? null);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVoiceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !tokenRef.current) return;
    if (file.size > 10 * 1024 * 1024) {
      setVoiceMsg({ ok: false, text: 'File too large. Max 10 MB.' });
      return;
    }
    setVoiceBusy(true);
    setVoiceMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const audioBase64 = btoa(binary);
      await api.settings.uploadVoiceClone(audioBase64, tokenRef.current);
      setVoiceCloneId('set');
      setVoiceMsg({ ok: true, text: 'Voice sample uploaded successfully.' });
    } catch (err) {
      setVoiceMsg({ ok: false, text: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setVoiceBusy(false);
      if (voiceFileRef.current) voiceFileRef.current.value = '';
    }
  }

  async function handleDeleteVoice() {
    if (!tokenRef.current) return;
    setVoiceBusy(true);
    try {
      await api.settings.deleteVoiceClone(tokenRef.current);
      setVoiceCloneId(null);
      setVoiceMsg({ ok: true, text: 'Voice clone removed.' });
    } catch { /* silent */ }
    finally { setVoiceBusy(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Voice clone</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
          Upload a sample to generate WhatsApp voice notes in your own voice.
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <span className="font-display font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>ElevenLabs voice clone</span>
          <span style={{ fontSize: 10, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', borderRadius: 4, padding: '1px 6px' }}>Beta</span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 16 }}>
          Upload a 60-second audio sample to generate WhatsApp voice notes in your voice.
          Default is a natural AI voice (Indian English / Hindi / Hinglish).
        </p>

        {voiceCloneId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 6, padding: '10px 14px' }}>
            <span style={{ fontSize: 13, color: 'var(--sage)', fontWeight: 500 }}>Voice trained ✓</span>
            <button
              onClick={handleDeleteVoice}
              disabled={voiceBusy}
              style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: voiceBusy ? 'not-allowed' : 'pointer', padding: 0, opacity: voiceBusy ? 0.6 : 1 }}
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <input
              ref={voiceFileRef}
              type="file"
              accept=".mp3,.wav,.m4a,.ogg"
              onChange={handleVoiceUpload}
              style={{ display: 'none' }}
              id="voice-clone-input"
              data-testid="voice-clone-input"
            />
            <label
              htmlFor="voice-clone-input"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                cursor: voiceBusy ? 'not-allowed' : 'pointer',
                background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)',
                borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 500,
                opacity: voiceBusy ? 0.6 : 1,
              }}
            >
              {voiceBusy ? 'Uploading…' : 'Upload sample (MP3 / WAV · max 10 MB)'}
            </label>
          </>
        )}

        {voiceMsg && (
          <p style={{ fontSize: 12, color: voiceMsg.ok ? 'var(--sage)' : 'var(--red)', marginTop: 8 }}>
            {voiceMsg.text}
          </p>
        )}
        <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 12 }}>
          Processed by ElevenLabs. Audio is used only to train the voice model and is not stored by LaunchMind.
        </p>
      </div>
    </div>
  );
}
