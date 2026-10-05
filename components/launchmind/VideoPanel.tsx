/**
 * @file VideoPanel.tsx
 * @description The VIDEO PRODUCTION section of the artifact workbench — B6B §42, §43.
 *
 *   A short video is the one creative where LaunchMind must ask before it acts.
 *   Choosing a presenter means putting a face on the owner's marketing, and
 *   choosing a voice means putting words in a mouth. Neither is a default, and
 *   neither is a setting LaunchMind may pick to be helpful — so this panel has
 *   no "recommended presenter", no auto-selection and no way to render an avatar
 *   video without an explicit choice.
 *
 *   WHAT THE OWNER SEES IS MARKETING LANGUAGE. Production style, presenter,
 *   voice. Never a model slug, an API provider, a prediction version, a seed or
 *   inference steps — an AI CMO's owner does not have an opinion about those and
 *   should not be asked to develop one.
 *
 *   THE DISCLOSURE IS NOT OPTIONAL. Wherever a presenter appears, so does the
 *   sentence saying they are generated and not a customer or employee. An owner
 *   who does not realise the person on screen is synthetic cannot make an
 *   informed decision about using them.
 *
 *   No execution control exists here. Publish, post, launch, schedule, boost and
 *   spend are absent because a rendered video is not a running campaign.
 *
 * @security Everything rendered comes from the owner-safe read model. Provider
 *   ids appear only as opaque selection values; keys, prompts and model
 *   references are never sent by the server.
 * @dependencies lib/api (contentIntelligence.presenters/voices/generateVideo)
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api, type CreativeRender, type ProviderPresenter, type ProviderVoiceChoice, type VideoMode,
} from '@/lib/api';
import { Button } from '@/components/launchmind/Button';
import * as T from '@/lib/design-system/typography';

const eyebrow: React.CSSProperties = T.eyebrow;

/** Owner language. The internal mode name never reaches the browser as a label. */
const MODES: Array<{ id: VideoMode; label: string; description: string }> = [
  { id: 'PRODUCT_MOTION', label: 'Product motion',
    description: 'Visual storytelling with no person on screen.' },
  { id: 'AVATAR_SPOKESPERSON', label: 'AI presenter',
    description: 'A generated presenter delivers your script to camera.' },
  { id: 'VOICEOVER_CREATIVE', label: 'Voiceover',
    description: 'Motion with a spoken voice reading your script.' },
];

/**
 * Presentation-style filters, derived from the provider's own naming.
 *
 * Framing is a PRODUCTION decision — how much of the shot the presenter fills,
 * and what they are doing. Deliberately not gender, age or ethnicity: those are
 * not held, not offered, and not a legitimate way to choose a spokesperson.
 */
const FRAMINGS: Array<{ id: string; label: string; match: RegExp | null }> = [
  { id: 'all', label: 'All', match: null },
  { id: 'closeup', label: 'Close up', match: /close ?up|front|portrait/i },
  { id: 'upper', label: 'Upper body', match: /upper body|half/i },
  { id: 'full', label: 'Full body', match: /full body|standing/i },
  { id: 'seated', label: 'Seated', match: /sitting|sofa|desk|seated/i },
  { id: 'office', label: 'Office', match: /office|studio|business/i },
];

export interface VideoPanelProps {
  assetId: string;
  token: string;
  /** Every render for this artifact, so video history reuses one read model. */
  renders: CreativeRender[];
  onChanged: () => void;
}

export function VideoPanel(props: VideoPanelProps) {
  // The production path is intentionally unavailable in this environment.
  // Do not offer an owner action that the runtime cannot complete.
  if (process.env.NEXT_PUBLIC_VIDEO_PRODUCTION_OPERATIONAL !== 'true') {
    return (
      <section aria-labelledby="wb-video" style={{ marginTop: 20 }}>
        <h3 id="wb-video" style={{ ...eyebrow, marginBottom: 0 }}>Video production</h3>
        <p style={{ ...T.body, color: 'var(--ink2)', margin: '8px 0 0' }}>
          Video production is not available in this development environment yet.
        </p>
      </section>
    );
  }
  return <OperationalVideoPanel {...props} />;
}

function OperationalVideoPanel({ assetId, token, renders, onChanged }: VideoPanelProps) {
  const [mode, setMode] = useState<VideoMode>('PRODUCT_MOTION');
  const [presenters, setPresenters] = useState<ProviderPresenter[]>([]);
  const [voices, setVoices] = useState<ProviderVoiceChoice[]>([]);
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [presenterNote, setPresenterNote] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<ProviderPresenter | null>(null);
  const [presenterQuery, setPresenterQuery] = useState('');
  const [framing, setFraming] = useState<string>('all');
  const [voice, setVoice] = useState<ProviderVoiceChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const activeFraming = FRAMINGS.find(f => f.id === framing) ?? FRAMINGS[0];
  const visiblePresenters = presenters.filter(p => {
    if (activeFraming.match && !activeFraming.match.test(p.displayName)) return false;
    if (presenterQuery.trim() &&
        !p.displayName.toLowerCase().includes(presenterQuery.trim().toLowerCase())) return false;
    return true;
  });

  const videos = renders.filter(r => r.creativeKind === 'SHORT_FORM_VIDEO');
  const succeeded = videos.filter(r => r.status === 'SUCCEEDED');
  const shown = succeeded.find(r => r.renderJobId === selected)
    ?? succeeded.find(r => r.isCurrent) ?? null;
  const lastFailed = videos.find(r => r.status === 'FAILED') ?? null;

  const loadChoices = useCallback(async () => {
    try {
      const p = await api.contentIntelligence.presenters(token);
      setPresenters(p.presenters ?? []);
      setDisclosure(p.disclosure ?? null);
      setPresenterNote(p.available ? null : (p.note ?? null));
    } catch { setPresenterNote('LaunchMind could not load the list of presenters.'); }
    try {
      const v = await api.contentIntelligence.voices(token);
      setVoices(v.voices ?? []);
      setVoiceNote(v.available ? null : (v.note ?? null));
    } catch { setVoiceNote('LaunchMind could not load the list of voices.'); }
  }, [token]);

  useEffect(() => {
    if (mode === 'PRODUCT_MOTION') return;
    void loadChoices();
  }, [mode, loadChoices]);

  async function generate() {
    setBusy(true); setError(null);
    try {
      const res = await api.contentIntelligence.generateVideo(assetId, token, {
        mode,
        avatar: avatar ? {
          providerAvatarId: avatar.providerAvatarId,
          displayName: avatar.displayName, previewUrl: avatar.previewUrl,
        } : undefined,
        voice: voice ? {
          providerVoiceId: voice.providerVoiceId,
          displayName: voice.displayName, language: voice.language,
        } : undefined,
      });
      setSelected(res.renderJobId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message
        : 'LaunchMind could not create the video. Your script was not changed.');
    } finally { setBusy(false); }
  }

  async function approve(renderJobId: string) {
    setBusy(true); setError(null);
    try {
      await api.contentIntelligence.approveVisual(renderJobId, token);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve this video.');
    } finally { setBusy(false); }
  }

  // Avatar mode needs BOTH selections: the presenter service requires a voice
  // and will not choose one, so neither does LaunchMind.
  const needsPresenter = mode === 'AVATAR_SPOKESPERSON' && !avatar;
  const needsVoice = (mode === 'AVATAR_SPOKESPERSON' || mode === 'VOICEOVER_CREATIVE') && !voice;
  const canGenerate = !needsPresenter && !needsVoice;

  const readiness = busy ? 'Creating the video…'
    : succeeded.length === 0
      ? (lastFailed ? 'Needs attention' : 'Not created yet')
      : (shown?.approved ? 'Approved' : 'Ready for your review');

  return (
    <section aria-labelledby="wb-video" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 id="wb-video" style={{ ...eyebrow, marginBottom: 0 }}>Video production</h3>
        <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{readiness}</span>
      </div>

      {/* ── production style ─────────────────────────────────────────────── */}
      <fieldset style={{ border: 'none', padding: 0, margin: '12px 0 0' }}>
        <legend style={{ ...eyebrow, padding: 0 }}>Production style</legend>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {MODES.map(m => (
            <label key={m.id} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
              padding: '10px 12px', borderRadius: 10, fontSize: 13,
              border: `1px solid ${mode === m.id ? 'var(--sage-b)' : 'var(--border)'}`,
              background: mode === m.id ? 'var(--sage-d)' : 'var(--surface)',
            }}>
              <input type="radio" name="video-mode" checked={mode === m.id}
                onChange={() => { setMode(m.id); setAvatar(null); setVoice(null); }}
                style={{ accentColor: 'var(--sage)', marginTop: 2 }} />
              <span>
                <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{m.label}</span>
                <span style={{ display: 'block', color: 'var(--ink2)' }}>{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── presenter ────────────────────────────────────────────────────── */}
      {mode === 'AVATAR_SPOKESPERSON' && (
        <div style={{ marginTop: 16 }}>
          <div style={eyebrow}>Presenter</div>
          {presenterNote ? (
            <p style={{ fontSize: 13, color: 'var(--ink3)' }}>{presenterNote}</p>
          ) : (
            <>
              {/*
                Browsing, not a wall. The inventory runs to thousands, so the
                owner filters by how the shot is FRAMED — a production decision.
                Never by gender, age or ethnicity: LaunchMind does not hold that
                data and must not offer it as a way to pick a person.
              */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 10px' }}>
                {FRAMINGS.map(f => (
                  <button key={f.id} type="button" onClick={() => setFraming(f.id)}
                    aria-pressed={framing === f.id}
                    style={{
                      padding: '6px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                      fontFamily: 'inherit',
                      border: `1px solid ${framing === f.id ? 'var(--sage-b)' : 'var(--border)'}`,
                      background: framing === f.id ? 'var(--sage-d)' : 'var(--surface)',
                      color: framing === f.id ? 'var(--sage)' : 'var(--ink2)',
                      fontWeight: framing === f.id ? 650 : 500,
                    }}>{f.label}</button>
                ))}
              </div>

              <label htmlFor="vp-presenter-search" style={{ ...eyebrow, display: 'block' }}>
                Search presenters
              </label>
              <input id="vp-presenter-search" value={presenterQuery}
                onChange={e => setPresenterQuery(e.target.value)}
                placeholder="Search by name"
                style={{
                  width: '100%', maxWidth: 380, background: 'var(--raised)',
                  border: '1px solid var(--border2)', borderRadius: 9,
                  padding: '8px 11px', fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
                }} />

              <div role="radiogroup" aria-label="Presenter"
                style={{
                  display: 'grid', gap: 8, marginTop: 10, maxHeight: 260, overflowY: 'auto',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                }}>
                {visiblePresenters.map(p => {
                  const on = avatar?.providerAvatarId === p.providerAvatarId;
                  return (
                    <button key={p.providerAvatarId} type="button" role="radio" aria-checked={on}
                      onClick={() => setAvatar(p)}
                      style={{
                        display: 'flex', gap: 9, alignItems: 'center', textAlign: 'left',
                        padding: 8, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                        border: `1px solid ${on ? 'var(--sage-b)' : 'var(--border)'}`,
                        background: on ? 'var(--sage-d)' : 'var(--surface)',
                      }}>
                      {p.previewUrl
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={p.previewUrl} alt="" width={36} height={36}
                            style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                        : <span aria-hidden style={{ width: 36, height: 36, borderRadius: 8,
                            background: 'var(--raised)', flexShrink: 0 }} />}
                      <span style={{ fontSize: 12, color: 'var(--ink)', minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.displayName}
                        {on && <span style={{ color: 'var(--sage)' }}> ✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '8px 0 0' }}>
                {visiblePresenters.length} of {presenters.length} presenters
                {avatar ? ` · you chose ${avatar.displayName}` : ' · none chosen yet'}
              </p>
            </>
          )}
          {disclosure && (
            <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '8px 0 0' }}>{disclosure}</p>
          )}
        </div>
      )}

      {/* ── voice ────────────────────────────────────────────────────────── */}
      {(mode === 'AVATAR_SPOKESPERSON' || mode === 'VOICEOVER_CREATIVE') && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="vp-voice" style={{ ...eyebrow, display: 'block' }}>Voice</label>
          {voiceNote ? (
            <p style={{ fontSize: 13, color: 'var(--ink3)' }}>{voiceNote}</p>
          ) : (
            <select id="vp-voice" value={voice?.providerVoiceId ?? ''}
              onChange={e => setVoice(voices.find(
                v => v.providerVoiceId === e.target.value) ?? null)}
              style={{
                width: '100%', maxWidth: 380, background: 'var(--raised)',
                border: '1px solid var(--border2)', borderRadius: 9,
                padding: '8px 11px', fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
              }}>
              <option value="">Choose a voice…</option>
              {voices.map(v => (
                <option key={v.providerVoiceId} value={v.providerVoiceId}>
                  {v.displayName}{v.language ? ` — ${v.language}` : ''}
                </option>
              ))}
            </select>
          )}
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '8px 0 0' }}>
            These are stock voices. LaunchMind cannot use a real person&rsquo;s voice
            without their recorded permission.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" style={{
          fontSize: 13, marginTop: 14, padding: 12, borderRadius: 10,
          background: 'var(--amber2)', border: '1px solid #f2d29f', color: '#7d4306',
        }}>{error}</p>
      )}

      {!error && lastFailed?.failureMessage && succeeded.length === 0 && (
        <p role="status" style={{
          fontSize: 13, marginTop: 14, padding: 12, borderRadius: 10,
          background: 'var(--amber2)', border: '1px solid #f2d29f', color: '#7d4306',
        }}>{lastFailed.failureMessage} Your script was not changed.</p>
      )}

      {/* ── the video ────────────────────────────────────────────────────── */}
      {shown && shown.imageUrl && (
        <div style={{ marginTop: 16 }}>
          <video src={shown.imageUrl} controls playsInline
            style={{ width: '100%', maxWidth: 300, borderRadius: 10,
              border: '1px solid var(--border)', display: 'block' }} />
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '8px 0 0' }}>
            Content version {shown.contentVersionNumber} · Brand version {shown.brandKitVersion}
            {shown.approved ? ' · Approved' : ''}
          </p>
          {shown.brandMovedOn && (
            <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6 }}>
              Your brand has changed since this video was made. Creating a new one will use the current brand.
            </p>
          )}
          {shown.provenance.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={eyebrow}>How this was made</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                {shown.provenance.map(p => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}
          {shown.notes.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--ink3)' }}>
              {shown.notes.map(n => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {succeeded.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div style={eyebrow}>Video history ({succeeded.length})</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {succeeded.map(r => (
              <button key={r.renderJobId} type="button"
                onClick={() => setSelected(r.renderJobId)}
                aria-pressed={r.renderJobId === shown?.renderJobId}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left',
                  fontSize: 13, cursor: 'pointer', padding: '6px 9px', borderRadius: 10,
                  background: r.renderJobId === shown?.renderJobId ? 'var(--raised)' : 'transparent',
                  border: '1px solid ' + (r.renderJobId === shown?.renderJobId
                    ? 'var(--border2)' : 'transparent'),
                  color: 'var(--ink2)', fontFamily: 'inherit',
                }}>
                <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--ink)' }}>
                  v{r.contentVersionNumber}
                </span>
                {r.isCurrent && <span style={{ color: 'var(--ink3)' }}>● current</span>}
                {r.approved && <span style={{ color: 'var(--sage)' }}>✓ approved</span>}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '6px 0 0' }}>
            Changing the presenter or voice makes a new video. Approving one never carries over.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <Button onClick={() => void generate()} disabled={busy || !canGenerate}>
          {busy ? 'Creating…' : succeeded.length > 0 ? 'Create another video' : 'Generate video'}
        </Button>
        {shown && !shown.approved && (
          <Button variant="ghost" onClick={() => void approve(shown.renderJobId)} disabled={busy}>
            Approve creative
          </Button>
        )}
      </div>

      {!canGenerate && (
        <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 8 }}>
          {needsPresenter ? 'Choose a presenter' : 'Choose a voice'} before creating this video.
        </p>
      )}
      {shown && !shown.approved && (
        <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8 }}>
          Approving a video says it represents you. It does not publish, post, schedule or spend.
        </p>
      )}
    </section>
  );
}
