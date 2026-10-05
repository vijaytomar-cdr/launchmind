/**
 * @file AdjustDirectionPanel.tsx
 * @description "Adjust direction" — how an owner redirects a content campaign.
 *
 *   An AI CMO you cannot argue with is a generator. This is the argument: the
 *   owner says what to change in marketing language, sees exactly how LaunchMind
 *   will change it, and only then applies it.
 *
 *   TWO PROPERTIES THIS SURFACE MUST HOLD, both visible rather than implied:
 *
 *   1. Direction is not proof. If the owner's words contain a figure, a
 *      superlative or a certification, the preview says plainly that LaunchMind
 *      will treat it as emphasis and that any resulting statement still needs
 *      evidence. Saying so before the owner commits is the whole point — a
 *      surprise at approval time reads as LaunchMind changing its mind.
 *
 *   2. Nothing already made is rewritten. Owners assume a redirect destroys
 *      their work, so the panel states what is untouched next to what changes.
 *
 *   NOT a configuration form and NOT a prompt box: the fields are marketing
 *   decisions (who, what to emphasise, how it sounds, what to ask for, what to
 *   make), with one free field for refinement.
 *
 * @security Preview writes nothing. Apply goes through the governed route,
 *   which re-derives the strategy server-side; the browser sends direction, not
 *   authority, and cannot supply evidence, scope or approval.
 * @dependencies lib/api (contentIntelligence.adjustDirection), Button
 */

'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/launchmind/Button';
import * as T from '@/lib/design-system/typography';

const CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'GOOGLE_RSA', label: 'Google search ad' },
  { id: 'META_AD', label: 'Meta ad' },
  { id: 'LANDING_PAGE', label: 'Landing page' },
  { id: 'LINKEDIN_POST', label: 'LinkedIn post' },
  { id: 'SHORT_FORM_VIDEO_SCRIPT', label: 'Short video script' },
];

const eyebrow: React.CSSProperties = T.eyebrow;
const input: React.CSSProperties = {
  width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '8px 11px', fontSize: 13, color: 'var(--ink)',
  fontFamily: 'inherit',
};

interface Change { field: string; before: string; after: string }
interface Preview {
  changes: Change[]; willRebuild: string[]; willNotChange: string[]; cannotProve: string[];
}

export interface AdjustDirectionPanelProps {
  campaignId: string;
  productId: string;
  token: string;
  current: {
    audience: string; message: string; ctaIntent: string | null;
    channels: string[]; brandDirection: string;
  };
  /** Called after a direction is applied, so the caller can reload lineage. */
  onApplied: (summary: { applied: Change[]; lineage: string }) => void;
  onCancel: () => void;
}

export function AdjustDirectionPanel(props: AdjustDirectionPanelProps) {
  const { campaignId, productId, token, current } = props;

  const [audience, setAudience] = useState(current.audience);
  const [message, setMessage] = useState(current.message);
  const [tone, setTone] = useState('');
  const [ctaIntent, setCtaIntent] = useState(current.ctaIntent ?? '');
  const [channels, setChannels] = useState<string[]>(current.channels);
  const [note, setNote] = useState('');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'apply'>(null);
  const [error, setError] = useState<string | null>(null);

  const body = () => ({
    productId,
    direction: {
      audience: audience.trim() || null,
      messageEmphasis: message.trim() || null,
      tone: tone.trim() || null,
      ctaIntent: ctaIntent.trim() || null,
      channels: channels.length > 0 ? channels : null,
      note: note.trim() || null,
    },
  });

  async function runPreview() {
    setBusy('preview'); setError(null);
    try {
      const res = await api.contentIntelligence.adjustDirection(
        campaignId, { ...body(), mode: 'preview' }, token);
      if (!res.preview || res.preview.changes.length === 0) {
        setPreview(null);
        setError('Nothing is different yet. Change something above first.');
        return;
      }
      setPreview(res.preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not work that out.');
    } finally { setBusy(null); }
  }

  async function apply() {
    setBusy('apply'); setError(null);
    try {
      const res = await api.contentIntelligence.adjustDirection(
        campaignId, { ...body(), mode: 'apply' }, token);
      props.onApplied({ applied: res.applied ?? [], lineage: res.lineage ?? '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that.');
      setBusy(null);
    }
  }

  function toggleChannel(id: string) {
    setPreview(null);
    setChannels(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  }
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setPreview(null); set(e.target.value);
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 20, marginTop: 16,
    }}>
      <div style={{ ...eyebrow, color: 'var(--sage)' }}>Adjust campaign direction</div>
      <h3 style={{ fontFamily: 'var(--font-syne)', fontSize: 18, fontWeight: 700,
        color: 'var(--ink)', margin: '8px 0 4px' }}>
        What would you like LaunchMind to change?
      </h3>
      <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 16px' }}>
        Tell me the marketing decision. I will work out the rest.
      </p>

      <div style={{ display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div>
          <label htmlFor="ad-audience" style={{ ...eyebrow, display: 'block' }}>Audience</label>
          <input id="ad-audience" style={input} value={audience} onChange={edit(setAudience)} />
        </div>
        <div>
          <label htmlFor="ad-message" style={{ ...eyebrow, display: 'block' }}>Message emphasis</label>
          <input id="ad-message" style={input} value={message} onChange={edit(setMessage)} />
        </div>
        <div>
          <label htmlFor="ad-tone" style={{ ...eyebrow, display: 'block' }}>Tone</label>
          <input id="ad-tone" style={input} value={tone} onChange={edit(setTone)}
            placeholder={current.brandDirection} />
        </div>
        <div>
          <label htmlFor="ad-cta" style={{ ...eyebrow, display: 'block' }}>
            What you want people to do
          </label>
          <input id="ad-cta" style={input} value={ctaIntent} onChange={edit(setCtaIntent)} />
        </div>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: '16px 0 0' }}>
        <legend style={{ ...eyebrow, padding: 0 }}>What to create</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {CHANNELS.map(c => {
            const on = channels.includes(c.id);
            return (
              <label key={c.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                padding: '7px 11px', borderRadius: 999, fontSize: 13,
                border: `1px solid ${on ? 'var(--sage-b)' : 'var(--border)'}`,
                background: on ? 'var(--sage-d)' : 'var(--surface)',
                color: on ? 'var(--sage)' : 'var(--ink2)', fontWeight: on ? 650 : 500,
              }}>
                <input type="checkbox" checked={on} onChange={() => toggleChannel(c.id)}
                  style={{ accentColor: 'var(--sage)' }} />
                {c.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div style={{ marginTop: 16 }}>
        <label htmlFor="ad-note" style={{ ...eyebrow, display: 'block' }}>
          Anything else you want changed
        </label>
        <textarea id="ad-note" rows={2} style={{ ...input, resize: 'vertical' }}
          value={note} onChange={edit(setNote)}
          placeholder="Focus more on trust than convenience." />
        <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '6px 0 0' }}>
          This tells me what to emphasise. It does not tell me what is true.
        </p>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '14px 0 0' }}>
          {error}
        </p>
      )}

      {preview && (
        <div style={{
          marginTop: 18, padding: 16, borderRadius: 10,
          background: 'var(--raised)', border: '1px solid var(--border)',
        }}>
          <div style={eyebrow}>Here&rsquo;s how I&rsquo;ll adjust it</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {preview.changes.map(c => (
              <div key={c.field} style={{ fontSize: 13 }}>
                <div style={{ color: 'var(--ink3)', fontSize: 12 }}>{c.field}</div>
                <div style={{ color: 'var(--ink2)', textDecoration: 'line-through' }}>{c.before}</div>
                <div style={{ color: 'var(--ink)', fontWeight: 650 }}>{c.after}</div>
              </div>
            ))}
          </div>

          {preview.cannotProve.length > 0 && (
            <div style={{
              marginTop: 14, padding: 12, borderRadius: 10,
              background: 'var(--amber2)', border: '1px solid #f2d29f', color: '#7d4306',
            }}>
              {preview.cannotProve.map(c => (
                <p key={c} style={{ fontSize: 13, margin: '0 0 4px' }}>{c}</p>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gap: 14, marginTop: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <div style={eyebrow}>I will rebuild</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                {preview.willRebuild.map(w => <li key={w}>{w}</li>)}
              </ul>
            </div>
            <div>
              <div style={eyebrow}>I will not change</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                {preview.willNotChange.map(w => <li key={w}>{w}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
        {!preview && (
          <Button onClick={() => void runPreview()} disabled={busy !== null}>
            {busy === 'preview' ? 'Working it out…' : 'Show me how you would change it'}
          </Button>
        )}
        {preview && (
          <Button onClick={() => void apply()} disabled={busy !== null}>
            {busy === 'apply' ? 'Applying…' : 'Apply direction'}
          </Button>
        )}
        <Button variant="ghost" onClick={props.onCancel} disabled={busy !== null}>Cancel</Button>
      </div>
    </div>
  );
}
