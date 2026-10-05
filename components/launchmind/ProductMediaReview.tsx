/**
 * @file ProductMediaReview.tsx
 * @description Choosing which of your own images LaunchMind may use — §9–§11.
 *
 *   THREE THINGS THE OWNER REPORTED, all addressed here:
 *
 *   1. "The images are not clickable." They now are. Every thumbnail is a real
 *      button that opens a large preview, with keyboard activation, Escape to
 *      close, arrow keys between images and focus returned to the thumbnail
 *      that was opened. A picture you are asked to make a rights decision about
 *      and cannot actually look at is not a decision you can make.
 *
 *   2. Ten large authorization cards sat inline on the decision surface. They
 *      live here instead, entered deliberately from a compact readiness item.
 *
 *   3. State was hard to read. Every image says which of four states it is in,
 *      in owner language, with a symbol as well as a colour.
 *
 *   "ALLOW ALL" DOES NOT WEAKEN GOVERNANCE. It applies the same per-asset
 *   authorization the individual button does, one call each, and it is scoped to
 *   a single source — "all App Store screenshots" — because a blanket "allow
 *   everything" would sweep in whatever a future intake happens to observe.
 *
 * @security The browser sends an asset id. Workspace, product, subject relation,
 *   source and rights basis are server-derived. Assets LaunchMind may never use
 *   are shown disabled WITH the reason rather than hidden — a missing option
 *   looks like a bug; a stated refusal is an answer.
 * @dependencies lib/api (contentIntelligence.productAssets/allowProductAsset)
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OwnerProductAsset } from '@/lib/api';
import * as T from '@/lib/design-system/typography';
import { Button } from '@/components/launchmind/Button';

/** The four states, in owner language. Never an enum. */
function stateOf(a: OwnerProductAsset): { label: string; symbol: string; tone: 'ok' | 'warn' | 'off' } {
  if (!a.canAllow) return { label: a.blockedReason ?? 'LaunchMind cannot use this', symbol: '✕', tone: 'off' };
  if (a.allowed) return { label: 'Allowed for marketing', symbol: '✓', tone: 'ok' };
  if (a.needsSafetyConfirmation) {
    return { label: 'Needs your confirmation before LaunchMind can use it', symbol: '!', tone: 'warn' };
  }
  return { label: 'Not selected for marketing', symbol: '○', tone: 'off' };
}

export function ProductMediaReview({ token, productId, onClose, onChanged }: {
  token: string; productId?: string; onClose: () => void; onChanged?: () => void;
}) {
  const [assets, setAssets] = useState<OwnerProductAsset[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.contentIntelligence.productAssets(token, productId);
      setAssets(r.assets ?? []);
      setNote(r.note ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your images.');
    }
  }, [token, productId]);

  useEffect(() => { void load(); }, [load]);

  // Escape closes the preview, then the panel. Arrows move between images.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openIndex !== null) {
          const i = openIndex;
          setOpenIndex(null);
          // Focus returns to the exact thumbnail that was opened.
          requestAnimationFrame(() => thumbRefs.current[i]?.focus());
        } else onClose();
        return;
      }
      if (openIndex === null) return;
      if (e.key === 'ArrowRight') setOpenIndex(i => (i === null ? null : Math.min(i + 1, assets.length - 1)));
      if (e.key === 'ArrowLeft') setOpenIndex(i => (i === null ? null : Math.max(i - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, assets.length, onClose]);

  useEffect(() => { closeRef.current?.focus(); }, []);

  async function allow(a: OwnerProductAsset) {
    setBusy(a.assetId); setError(null);
    try {
      await api.contentIntelligence.allowProductAsset(a.assetId, token, true);
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this image.');
    } finally { setBusy(null); }
  }

  async function allowAllScreenshots() {
    const batch = assets.filter(a => a.canAllow && !a.allowed && /screenshot/i.test(a.kind));
    setBusy('all'); setError(null);
    try {
      // Same per-asset authorization, one call each. No bulk shortcut exists,
      // so this cannot weaken the governance the single button applies.
      for (const a of batch) {
        await api.contentIntelligence.allowProductAsset(a.assetId, token, true);
      }
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update every image.');
    } finally { setBusy(null); }
  }

  const usable = assets.filter(a => a.canAllow);
  const refused = assets.filter(a => !a.canAllow);
  const allowedCount = usable.filter(a => a.allowed).length;
  const screenshots = usable.filter(a => /screenshot/i.test(a.kind));
  const open = openIndex !== null ? assets[openIndex] : null;

  return (
    <section style={T.card} aria-labelledby="pm-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12,
        alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={T.eyebrow}>Product media</div>
          <h2 id="pm-title" style={T.sectionTitle}>Which images may LaunchMind use?</h2>
          <p style={{ ...T.body, margin: '6px 0 0', maxWidth: 620 }}>
            LaunchMind found these from your own product sources. Choose which ones it may
            use when creating ads, social posts, landing pages and videos.
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 650, color: 'var(--sage)' }}>
          ← Back
        </button>
      </div>

      {/* Count, so the owner always knows where they are. */}
      <p style={{ ...T.meta, margin: '14px 0 0' }}>
        {allowedCount} of {usable.length} images allowed
        {screenshots.length > 0 && ` · ${screenshots.filter(a => a.allowed).length} of ${screenshots.length} product screenshots`}
      </p>

      {error && (
        <p role="alert" style={{ ...T.body, color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>
      )}

      <div style={{ display: 'grid', gap: 12, marginTop: 14,
        gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
        {usable.map((a, i) => {
          const st = stateOf(a);
          return (
            <div key={a.assetId} style={{
              border: `1px solid ${a.allowed ? 'var(--sage-b)' : 'var(--border)'}`,
              borderRadius: 10, overflow: 'hidden',
              background: a.allowed ? 'var(--sage-d)' : 'var(--raised)',
            }}>
              {/* CLICKABLE. A real button, keyboard-activatable, opens a preview. */}
              <button ref={el => { thumbRefs.current[assets.indexOf(a)] = el; }}
                type="button" onClick={() => setOpenIndex(assets.indexOf(a))}
                aria-label={`View ${a.kind} from ${a.sourceLabel} larger`}
                style={{ display: 'block', width: '100%', padding: 0, border: 'none',
                  background: 'none', cursor: 'zoom-in' }}>
                {a.previewUrl
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={a.previewUrl} alt={`${a.kind} from ${a.sourceLabel}`}
                      style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
                  : <span aria-hidden style={{ display: 'block', height: 150, background: 'var(--border)' }} />}
              </button>
              <div style={{ padding: '9px 11px' }}>
                <div style={T.bodyStrong}>{a.kind}</div>
                <div style={{ ...T.meta, marginTop: 2 }}>Observed from your {a.sourceLabel}</div>
                <div style={{ ...T.meta, marginTop: 6,
                  color: st.tone === 'ok' ? 'var(--sage)' : st.tone === 'warn' ? 'var(--amber)' : 'var(--ink3)' }}>
                  <span aria-hidden>{st.symbol}</span> {st.label}
                </div>
                {!a.allowed && (
                  <button type="button" onClick={() => void allow(a)} disabled={busy !== null}
                    style={{
                      marginTop: 8, width: '100%', padding: '6px 8px', borderRadius: 8,
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 650,
                      border: '1px solid var(--sage-b)', background: 'var(--surface)', color: 'var(--sage)',
                    }}>
                    {busy === a.assetId ? 'Saving…' : 'Allow in marketing'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {screenshots.some(a => !a.allowed) && (
        <div style={{ marginTop: 14 }}>
          <Button variant="ghost" onClick={() => void allowAllScreenshots()} disabled={busy !== null}>
            {busy === 'all' ? 'Allowing…' : 'Allow all App Store screenshots'}
          </Button>
          <p style={{ ...T.meta, margin: '8px 0 0' }}>
            Allowing an image confirms it is yours and shows no customer details.
            LaunchMind may then use it in content it creates. It publishes nothing.
          </p>
        </div>
      )}

      {refused.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={T.eyebrow}>LaunchMind will not use these</div>
          <ul style={{ margin: 0, paddingLeft: 18, ...T.meta }}>
            {refused.map(a => <li key={a.assetId}>{a.kind} — {a.blockedReason}</li>)}
          </ul>
        </div>
      )}
      {note && <p style={{ ...T.meta, margin: '14px 0 0' }}>{note}</p>}

      {/* ── large preview ────────────────────────────────────────────────── */}
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`${open.kind} preview`}
          onClick={() => { const i = openIndex; setOpenIndex(null);
            requestAnimationFrame(() => { if (i !== null) thumbRefs.current[i]?.focus(); }); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(10,20,17,.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 14, padding: 16,
              maxWidth: 'min(90vw, 720px)', maxHeight: '90vh', overflow: 'auto' }}>
            {open.previewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={open.previewUrl} alt={`${open.kind} from ${open.sourceLabel}`}
                style={{ width: '100%', height: 'auto', borderRadius: 10, display: 'block' }} />
            )}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center',
              justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 12 }}>
              <div>
                <div style={T.bodyStrong}>{open.kind}</div>
                <div style={T.meta}>Observed from your {open.sourceLabel} · {stateOf(open).label}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost"
                  onClick={() => setOpenIndex(i => (i === null ? null : Math.max(i - 1, 0)))}>
                  ← Previous
                </Button>
                <Button variant="ghost"
                  onClick={() => setOpenIndex(i => (i === null ? null : Math.min(i + 1, assets.length - 1)))}>
                  Next →
                </Button>
                {!open.allowed && open.canAllow && (
                  <Button onClick={() => void allow(open)} disabled={busy !== null}>
                    Allow in marketing
                  </Button>
                )}
              </div>
            </div>
            <p style={{ ...T.meta, margin: '10px 0 0' }}>Press Escape to close.</p>
          </div>
        </div>
      )}
    </section>
  );
}
