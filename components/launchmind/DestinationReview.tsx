/**
 * @file DestinationReview.tsx
 * @description Where content should send people — §5, §8.
 *
 *   THE DEFECT. Content Intelligence said "Destination — Confirm where people
 *   should go" and offered no control. A readiness item that names a task and
 *   provides no way to do it is worse than not listing it: the owner is told
 *   they are blocking their own content and given nothing to act on.
 *
 *   Options come from the owner's OWN product context — the site observed at
 *   intake and their store listing — never from a list LaunchMind invented.
 *   One may be marked *Recommended*; none is pre-selected, because where a
 *   customer is sent is the owner's decision, not a default.
 *
 *   "No link — awareness only" is a real answer. A campaign built to be shared
 *   does not always want a click, and forcing a URL would produce a fake one.
 *
 * @security Destination is owner CONFIGURATION, not evidence — confirming it
 *   makes no claim provable and authorises no publishing. Custom URLs are
 *   validated server-side; this component never gates on its own check.
 * @dependencies lib/api (contentIntelligence.destinations/confirmBrandField)
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DestinationOption } from '@/lib/api';
import * as T from '@/lib/design-system/typography';
import { Button } from '@/components/launchmind/Button';

export function DestinationReview({ token, productId, onClose, onChanged }: {
  token: string; productId?: string; onClose: () => void; onChanged?: () => void;
}) {
  const [options, setOptions] = useState<DestinationOption[]>([]);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [resolvedProductId, setResolvedProductId] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.contentIntelligence.destinations(token, productId);
      setOptions(d.options ?? []);
      setConfirmed(d.confirmed ?? null);
      setResolvedProductId(d.product?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load destinations.');
    }
  }, [token, productId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function confirm() {
    if (!resolvedProductId || !choice) return;
    const opt = options.find(o => o.id === choice);
    const value = choice === 'custom' ? customUrl.trim()
      : choice === 'none' ? 'NONE'
      : (opt?.url ?? '');
    if (!value) { setError('Choose where people should go.'); return; }

    setBusy(true); setError(null);
    try {
      await api.contentIntelligence.confirmBrandField(
        { productId: resolvedProductId, fieldKey: 'cta_destination', value }, token);
      await load();
      // The caller recomputes readiness from the server, so the row flips from
      // "Confirm where people should go" without a page reload...
      onChanged?.();
      // ...and the editor CLOSES. Leaving it open after a successful save left
      // the owner staring at the same form wondering whether it worked.
      onClose();
    } catch (e) {
      // The server is the gate on URLs; its refusal is what the owner reads.
      setError(e instanceof Error ? e.message : 'Could not save that destination.');
    } finally { setBusy(false); }
  }

  return (
    <section style={T.card} aria-labelledby="dr-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12,
        alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={T.eyebrow}>Destination</div>
          <h2 id="dr-title" style={T.sectionTitle}>
            Where should people go when they respond to this content?
          </h2>
          <p style={{ ...T.body, margin: '6px 0 0', maxWidth: 620 }}>
            LaunchMind will send people here from ads, posts and landing pages.
            It does not publish anything.
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 650, color: 'var(--sage)' }}>
          ← Back
        </button>
      </div>

      {confirmed && (
        <p style={{ ...T.meta, margin: '14px 0 0' }}>
          Currently: {confirmed === 'NONE' ? 'no link — awareness only' : confirmed}
        </p>
      )}

      {error && (
        <p role="alert" style={{ ...T.body, color: 'var(--danger)', margin: '12px 0 0' }}>{error}</p>
      )}

      <div role="radiogroup" aria-label="Destination"
        style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {options.map(o => {
          const on = choice === o.id;
          return (
            <label key={o.id} style={{
              display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer',
              padding: '11px 13px', borderRadius: 10, fontSize: 13,
              border: `1px solid ${on ? 'var(--sage-b)' : 'var(--border)'}`,
              background: on ? 'var(--sage-d)' : 'var(--raised)',
            }}>
              <input type="radio" name="destination" checked={on}
                onChange={() => { setChoice(o.id); setError(null); }}
                style={{ accentColor: 'var(--sage)', marginTop: 3 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ ...T.bodyStrong, display: 'block' }}>
                  {o.label}
                  {/* A recommendation, not a selection. */}
                  {o.recommended && (
                    <span style={{ ...T.meta, color: 'var(--sage)', marginLeft: 8 }}>Recommended</span>
                  )}
                </span>
                <span style={{ ...T.meta, display: 'block' }}>
                  {o.url ? `${o.url} · ${o.detail}` : o.detail}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {choice === 'custom' && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor="dr-url" style={{ ...T.eyebrow, display: 'block' }}>Web address</label>
          <input id="dr-url" value={customUrl} onChange={e => setCustomUrl(e.target.value)}
            placeholder="https://"
            style={{ width: '100%', maxWidth: 420, background: 'var(--raised)',
              border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 11px',
              fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)' }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <Button onClick={() => void confirm()} disabled={busy || !choice}>
          {busy ? 'Saving…' : 'Confirm destination'}
        </Button>
      </div>
      <p style={{ ...T.meta, margin: '8px 0 0' }}>
        This tells LaunchMind where to point people. It is not proof of anything,
        and it publishes, schedules and spends nothing.
      </p>
    </section>
  );
}
