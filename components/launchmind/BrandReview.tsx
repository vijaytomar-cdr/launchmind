/**
 * @file BrandReview.tsx
 * @description Confirming brand, one field at a time — §12.
 *
 *   MOVED, NOT REMOVED. This was inline on Content Intelligence, where it turned
 *   a decision surface into a settings page. It is now entered deliberately from
 *   a readiness item, so the owner arrives having chosen to work on brand.
 *
 *   ONE FIELD PER ACTION, ALWAYS. A single "confirm my brand" button would turn
 *   every scraped guess into owner-asserted truth in one click — which is exactly
 *   the laundering the provenance model exists to prevent. Each field shows where
 *   LaunchMind's belief came from and is confirmed on its own.
 *
 *   SKIP IS A REAL ANSWER. An owner who does not want to decide about a tagline
 *   should be able to leave it alone without the screen implying failure — so
 *   nothing here is styled as an error, and unconfirmed is the resting state.
 *
 * @security Brand is REPRESENTATION, never evidence. Confirming a tagline makes
 *   no claim provable; the panel says so, because an owner who thinks otherwise
 *   will expect content to be able to assert it.
 * @dependencies lib/api (contentIntelligence.brand/confirmBrandField)
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OwnerBrandField } from '@/lib/api';
import * as T from '@/lib/design-system/typography';

export function BrandReview({ token, productId, onClose, onChanged }: {
  token: string; productId?: string; onClose: () => void; onChanged?: () => void;
}) {
  const [fields, setFields] = useState<OwnerBrandField[]>([]);
  const [resolvedProductId, setResolvedProductId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api.contentIntelligence.brand(token, productId);
      setFields(b.fields ?? []);
      setResolvedProductId(b.product?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your brand.');
    }
  }, [token, productId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the preview first, then the panel.
      if (preview) { setPreview(null); return; }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, preview]);

  async function confirm(f: OwnerBrandField, value: string) {
    if (!resolvedProductId || !value.trim()) return;
    setBusy(f.fieldKey); setError(null);
    try {
      await api.contentIntelligence.confirmBrandField(
        { productId: resolvedProductId, fieldKey: f.fieldKey, value: value.trim() }, token);
      setEditing(null);
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm this.');
    } finally { setBusy(null); }
  }

  const observed = fields.filter(f => f.observed);
  const confirmedCount = observed.filter(f => f.confirmed).length;

  return (
    <section style={T.card} aria-labelledby="br-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12,
        alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={T.eyebrow}>Brand</div>
          <h2 id="br-title" style={T.sectionTitle}>How your marketing should look and sound</h2>
          <p style={{ ...T.body, margin: '6px 0 0', maxWidth: 620 }}>
            Here is what LaunchMind currently observes. Confirming a field tells it to use
            that value. Brand is how your marketing looks and sounds — it is not proof of anything.
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 650, color: 'var(--sage)' }}>
          ← Back
        </button>
      </div>

      {/* "0 of 2 confirmed" implies the brand HAS two properties. It has as many
          as LaunchMind has managed to observe so far, which is a different claim. */}
      <p style={{ ...T.meta, margin: '14px 0 0' }}>
        {observed.length} brand detail{observed.length === 1 ? '' : 's'} available to review
        {confirmedCount > 0 && ` · ${confirmedCount} confirmed`}
      </p>

      {error && (
        <p role="alert" style={{ ...T.body, color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>
      )}

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {observed.map(f => {
          const isSkipped = skipped.has(f.fieldKey);
          return (
            <div key={f.fieldKey} style={{
              ...T.innerBlock,
              borderColor: f.confirmed ? 'var(--sage-b)' : 'var(--border)',
              background: f.confirmed ? 'var(--sage-d)' : 'var(--raised)',
              opacity: isSkipped ? 0.55 : 1,
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span aria-hidden style={{ width: 14, textAlign: 'center',
                  color: f.confirmed ? 'var(--sage)' : 'var(--ink3)' }}>
                  {f.confirmed ? '✓' : '○'}
                </span>
                <span style={{ ...T.bodyStrong, minWidth: 92 }}>{f.label}</span>

                {/* A LOGO IS AN IMAGE. Showing "https://allignx.com/allignx_new.png"
                    asks the owner to confirm a string they cannot evaluate —
                    they are being asked about their visual identity, so show it. */}
                {f.fieldKey === 'logo' && f.value && editing !== f.fieldKey && (
                  <button type="button" onClick={() => setPreview(f.value)}
                    aria-label="View your logo larger"
                    style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8,
                      background: 'var(--surface)', cursor: 'zoom-in', lineHeight: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.value} alt="Your logo, observed from your website"
                      style={{ width: 44, height: 44, objectFit: 'contain', display: 'block', padding: 4 }} />
                  </button>
                )}

                {editing === f.fieldKey ? (
                  <>
                    <input value={draft} onChange={e => setDraft(e.target.value)}
                      aria-label={`${f.label} value`}
                      style={{ flex: 1, minWidth: 180, background: 'var(--surface)',
                        border: '1px solid var(--border2)', borderRadius: 8,
                        padding: '6px 9px', fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)' }} />
                    <button type="button" onClick={() => void confirm(f, draft)} disabled={busy !== null}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 12, fontWeight: 650, color: 'var(--sage)' }}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 12, color: 'var(--ink3)' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{
                      ...(f.fieldKey === 'tagline' ? T.bodyStrong : T.body),
                      flex: 1, minWidth: 150,
                      // The tagline IS the thing being judged, so it wraps and
                      // reads at full length. A logo URL is machinery: one line,
                      // muted, secondary to the image beside it.
                      ...(f.fieldKey === 'logo'
                        ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                            color: 'var(--ink3)', fontSize: 12 }
                        : { lineHeight: 1.5 }),
                    }}>
                      {f.value ?? '—'}
                    </span>
                    {/* Provenance is a sentence. Showing a value never confirms it. */}
                    <span style={{ ...T.meta, minWidth: 168 }}>
                      {f.confirmed ? 'You confirmed this' : (f.provenanceLabel ?? 'Observed')}
                    </span>
                    {!f.confirmed && !isSkipped && (
                      <>
                        <button type="button" onClick={() => void confirm(f, f.value ?? '')}
                          disabled={busy !== null || !f.value}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 12, fontWeight: 650, color: 'var(--sage)' }}>
                          {busy === f.fieldKey ? 'Saving…' : 'Confirm'}
                        </button>
                        <button type="button"
                          onClick={() => { setEditing(f.fieldKey); setDraft(f.value ?? ''); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 12, color: 'var(--ink2)' }}>Change</button>
                        <button type="button"
                          onClick={() => setSkipped(prev => new Set(prev).add(f.fieldKey))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 12, color: 'var(--ink3)' }}>Skip</button>
                      </>
                    )}
                    {isSkipped && <span style={T.meta}>Skipped for now</span>}
                  </>
                )}
              </div>
              {f.sourceLabel && !f.confirmed && (
                <p style={{ ...T.meta, margin: '6px 0 0', paddingLeft: 26 }}>{f.sourceLabel}</p>
              )}
            </div>
          );
        })}
      </div>

      {observed.length === 0 && (
        <p style={{ ...T.body, margin: '12px 0 0' }}>
          LaunchMind has not observed any brand details for this application yet.
        </p>
      )}

      {/* Said plainly: confirming what is here does not finish the brand. */}
      <p style={{ ...T.meta, margin: '14px 0 0' }}>
        LaunchMind will add colours, tone and visual style here as it observes them.
        Confirming these does not mean your brand is fully set up.
      </p>

      {preview && (
        <div role="dialog" aria-modal="true" aria-label="Logo preview"
          onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(10,20,17,.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 14, padding: 20,
              maxWidth: 'min(90vw, 520px)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your logo, observed from your website"
              style={{ width: '100%', height: 'auto', maxHeight: '60vh',
                objectFit: 'contain', display: 'block' }} />
            <p style={{ ...T.meta, margin: '12px 0 0' }}>
              Observed from your website. Press Escape to close.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
