/**
 * @file CreativePanel.tsx
 * @description The CREATIVE section of the artifact workbench — B6A §31, §34.
 *
 *   Content Studio now shows two different things about one artifact: the words
 *   (CONTENT) and the picture (CREATIVE). They are deliberately not merged,
 *   because approving one is not approving the other and a single combined tick
 *   would erase that distinction at exactly the moment it matters.
 *
 *   This is a REVIEW surface, not a design tool. There is no canvas, no layer
 *   list, no colour picker and no pixel editing. LaunchMind is an AI CMO: it
 *   decides what the visual should say and renders it; the owner judges whether
 *   it represents them. Someone who wants to move a rectangle should open a
 *   design tool, and saying so is more honest than a bad one built in here.
 *
 *   No execution control exists on this panel. Publish, launch, schedule and
 *   spend are absent because a rendered image is not a running advertisement,
 *   and putting the button here would suggest otherwise.
 *
 * @security Everything rendered comes from the owner-safe read model. Provider
 *   ids, model references, prompts and seeds are not sent by the server, so
 *   there is nothing here to leak.
 * @dependencies lib/api (contentIntelligence.generateVisual/visuals/approveVisual)
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type CreativeRender } from '@/lib/api';
import { Button } from '@/components/launchmind/Button';
import { VideoPanel } from '@/components/launchmind/VideoPanel';
import * as T from '@/lib/design-system/typography';

const eyebrow: React.CSSProperties = T.eyebrow;

/** Readiness in words. Status is never communicated by colour alone. */
function readiness(renders: CreativeRender[], busy: boolean): string {
  if (busy) return 'Creating the visual…';
  if (renders.length === 0) return 'Not created yet';
  const current = renders.find(r => r.isCurrent);
  if (!current) {
    return renders[0]?.status === 'FAILED' ? 'LaunchMind could not finish this creative within its repair limit' : 'Not created yet';
  }
  return current.approved ? 'Approved'
    : current.qualityOutcome === 'READY_FOR_OWNER_REVIEW' ? 'Ready for your review'
      : 'Creative review is not complete';
}

export interface CreativePanelProps {
  assetId: string;
  workflowBusy?: boolean;
  token: string;
  /** Owner-facing channel label, for the empty state. */
  channelLabel: string;
  /** Route into the image review, so a generic visual has a way out. */
  onReviewMedia?: () => void;
  /** Creative approval becomes the next primary decision only after copy approval. */
  contentApproved?: boolean;
}

export function CreativePanel({ assetId, token, channelLabel, onReviewMedia,
  contentApproved = false, workflowBusy = false }: CreativePanelProps) {
  const [renders, setRenders] = useState<CreativeRender[]>([]);
  const [canRender, setCanRender] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Whether the governed resolver currently has a renderable product image.
  // Read from the server on every load, never inferred from an old render.
  const [canUseProductImages, setCanUseProductImages] = useState(false);

  const load = useCallback(async (preferredId?: string, showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.contentIntelligence.visuals(assetId, token);
      setRenders(res.renders ?? []);
      try {
        const media = await api.contentIntelligence.productAssets(token);
        setCanUseProductImages((media.renderableCount ?? 0) > 0);
      } catch { setCanUseProductImages(false); }
      setCanRender(!!res.canRender);
      setSelected(preferredId
        ?? (res.renders ?? []).find(r => r.isCurrent)?.renderJobId
        ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the visual.');
    } finally { if (showLoading) setLoading(false); }
  }, [assetId, token]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    const previous = shown;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await api.contentIntelligence.generateVisual(assetId, token,
        { useProductImages: canUseProductImages });
      if (res.ownerState && res.ownerState !== 'READY_FOR_OWNER_REVIEW') {
        setNotice(res.message ?? 'LaunchMind could not finish this creative within its internal repair limit.');
        await load(undefined, false);
        return;
      }
      const refreshed = await api.contentIntelligence.visuals(assetId, token);
      setRenders(refreshed.renders ?? []);
      setCanRender(!!refreshed.canRender);
      const current = (refreshed.renders ?? []).find(r => r.isCurrent)
        ?? (refreshed.renders ?? []).find(r => r.renderJobId === res.renderJobId);
      setSelected(current?.renderJobId ?? res.renderJobId);
      if (!current || current.status !== 'SUCCEEDED') {
        throw new Error("I couldn't create a new visual. Your current visual is unchanged.");
      }
      if (previous?.imageUrl && current.imageUrl === previous.imageUrl) {
        setNotice('The renderer returned the same visual, so your current visual was kept.');
      } else {
        setNotice('Visual updated.');
      }
    } catch (e) {
      setError("I couldn't create a new visual. Your current visual is unchanged.");
    } finally { setBusy(false); }
  }

  async function approve(renderJobId: string) {
    setBusy(true); setError(null);
    try {
      await api.contentIntelligence.approveVisual(renderJobId, token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve this visual.');
    } finally { setBusy(false); }
  }

  // A short video script has no still visual. The two production surfaces are
  // separate because approving a picture and approving a video are separate acts.
  const isVideoArtifact = /short video|video script/i.test(channelLabel);
  const succeeded = renders.filter(r => r.status === 'SUCCEEDED' && r.creativeKind !== 'SHORT_FORM_VIDEO');
  const shown = succeeded.find(r => r.renderJobId === selected) ?? succeeded.find(r => r.isCurrent) ?? null;
  const approvedElsewhere = succeeded.find(r => r.approved && !r.isCurrent) ?? null;
  const shownUsesProductImages = shown?.provenance.some(p =>
    /built from your own product images|approved screenshot/i.test(p)) ?? false;
  const hasSourceAssetWarning = shown?.notes.some(n => /cropp|low resolution|source image/i.test(n)) ?? false;
  const serverQuality = shown?.qualityOutcome ?? 'NOT_ASSESSED';
  const visualQuality = !shown ? null
    : serverQuality !== 'READY_FOR_OWNER_REVIEW' || hasSourceAssetWarning
      ? {
          state: busy ? 'LaunchMind is refining this' : 'Creative review is not complete', tone: 'attention' as const,
          strong: ['Governed copy and brand assets remain separate from provider rendering'],
          watch: [shown?.qualitySummary ?? (hasSourceAssetWarning
            ? 'A source image quality issue needs owner judgment.'
            : serverQuality === 'NOT_ASSESSED'
              ? 'This earlier visual was not assessed by the current creative-quality gate.'
              : 'The product is not represented with authentic product imagery.')],
        }
      : {
          state: 'Ready for your review', tone: 'ready' as const,
          strong: [shownUsesProductImages ? 'Authentic product imagery is preserved'
            : 'Governed wording and confirmed brand assets are preserved', 'Copy and visual approvals remain separate'],
          watch: ['Creative quality still requires owner judgment', 'No first-party performance exists for this concept yet'],
        };
  const correctiveVisualLabel = serverQuality === 'ASSET_PROBLEM'
    ? 'Create with my product images'
    : serverQuality === 'CONCEPT_DID_NOT_SURVIVE_RENDER'
      ? 'Create a new visual'
      : 'Try another visual';

  if (workflowBusy) return <section aria-label="Creative" aria-busy="true"><p role="status">LaunchMind is refining this. Copy and its visual will be reviewed together.</p></section>;

  if (isVideoArtifact) {
    return <VideoPanel assetId={assetId} token={token} renders={renders} onChanged={() => void load()} />;
  }

  return (
    <section aria-labelledby="wb-creative" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 id="wb-creative" style={{ ...eyebrow, marginBottom: 0 }}>Creative</h3>
        <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{readiness(renders, busy)}</span>
      </div>

      {loading && (
        <p style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 10 }}>Loading…</p>
      )}

      {!loading && !canRender && renders.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 10 }}>
          LaunchMind does not create a visual for {channelLabel} yet.
        </p>
      )}

      {error && (
        <p role="alert" style={{
          fontSize: 13, marginTop: 12, padding: 12, borderRadius: 10,
          background: 'var(--amber2)', border: '1px solid #f2d29f', color: '#7d4306',
        }}>{error}</p>
      )}

      {notice && (
        <p role="status" style={{ fontSize: 13, marginTop: 12, color: 'var(--sage)' }}>
          {notice}
        </p>
      )}

      {shown && (
        <div style={{ marginTop: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.imageUrl ?? ''} alt={
            `Visual for ${shown.creativeKind.toLowerCase().replace(/_/g, ' ')}${
              shown.conceptLabel ? `, ${shown.conceptLabel}` : ''}`}
            style={{ width: '100%', maxWidth: 520, height: 'auto', display: 'block',
              borderRadius: 10, border: '1px solid var(--border)' }} />

          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '8px 0 0' }}>
            Copy version {shown.contentVersionNumber} · Brand version {shown.brandKitVersion}
            {shown.variantLabel ? ` · ${shown.variantLabel}` : ''}
            {shown.approved ? ' · Approved' : ''}
          </p>

          {visualQuality && (
            <div style={{ ...T.innerBlock, marginTop: 12,
              borderColor: visualQuality.tone === 'ready' ? 'var(--sage-b)' : 'var(--amber-b)' }}>
              <div style={{ ...eyebrow,
                color: visualQuality.tone === 'ready' ? 'var(--sage)' : 'var(--amber)' }}>
                LaunchMind assessment · {visualQuality.state}
              </div>
              <p style={{ ...T.body, margin: '6px 0 0' }}>
                {visualQuality.tone === 'ready'
                  ? 'Authentic product imagery is preserved. The composition is valid, but creative quality still requires your judgment.'
                  : visualQuality.watch[0]}
              </p>
            </div>
          )}

          {shown.brandMovedOn && (
            <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6 }}>
              Your brand has changed since this was made. Creating a new visual will use the current brand.
            </p>
          )}

          {/* WHY IT LOOKS GENERIC. "Product imagery: none used" is accurate but
              an owner reads a stock scene and reasonably concludes LaunchMind
              thinks that represents their product. It did not have a choice. */}
          {shown.provenance.some(p => /Product imagery: none used/i.test(p)) && (
            <div style={{ ...T.attentionBlock, marginTop: 12 }}>
              <p style={{ ...T.bodyStrong, color: '#7d4306', margin: 0 }}>
                Created before any of your product images were approved.
              </p>
              <p style={{ ...T.body, color: '#7d4306', margin: '4px 0 0' }}>
                No AllignX product imagery was available to LaunchMind when this was made,
                so it used a brand-led concept rather than showing your app.
                {canUseProductImages
                  ? ' Current approved product images will be used for the next visual.'
                  : ''}
              </p>
              {onReviewMedia && !canUseProductImages && (
                <button type="button" onClick={onReviewMedia}
                  style={{ background: 'none', border: 'none', padding: 0, marginTop: 8,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                    fontWeight: 650, color: '#7d4306' }}>
                  Choose which images LaunchMind may use →
                </button>
              )}
            </div>
          )}

          {(shown.provenance.length > 0 || shown.notes.length > 0) && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ ...T.bodyStrong, cursor: 'pointer' }}>How this was made</summary>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                {shown.provenance.map(p => <li key={p}>{p}</li>)}
                {shown.notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* The owner approved a visual, and what they are looking at is newer. */}
      {approvedElsewhere && shown && !shown.approved && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 10,
          background: 'var(--amber2)', border: '1px solid #f2d29f', color: '#7d4306',
        }}>
          <p style={{ fontSize: 13, margin: 0, fontWeight: 650 }}>
            An earlier visual is approved — this newer one is not.
          </p>
          <p style={{ fontSize: 13, margin: '4px 0 0' }}>
            Approving a visual never carries over to a later one.
          </p>
        </div>
      )}

      {succeeded.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" aria-expanded={openHistory}
            onClick={() => setOpenHistory(o => !o)}
            style={{ ...eyebrow, marginBottom: 0, background: 'none', border: 'none',
              padding: 0, cursor: 'pointer', color: 'var(--ink2)' }}>
            {openHistory ? '▾' : '▸'} Visual history ({succeeded.length})
          </button>
          {openHistory && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {succeeded.map(r => (
                <button key={r.renderJobId} type="button"
                  onClick={() => setSelected(r.renderJobId)}
                  aria-pressed={r.renderJobId === shown?.renderJobId}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left',
                    fontSize: 13, cursor: 'pointer', padding: '6px 9px', borderRadius: 10,
                    background: r.renderJobId === shown?.renderJobId ? 'var(--raised)' : 'transparent',
                    border: '1px solid ' + (r.renderJobId === shown?.renderJobId ? 'var(--border2)' : 'transparent'),
                    color: 'var(--ink2)', fontFamily: 'inherit',
                  }}>
                  <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--ink)' }}>
                    v{r.contentVersionNumber}
                  </span>
                  <span>{r.conceptLabel ?? r.creativeKind.toLowerCase().replace(/_/g, ' ')}</span>
                  {r.isCurrent && <span style={{ color: 'var(--ink3)' }}>● current</span>}
                  {r.approved && <span style={{ color: 'var(--sage)' }}>✓ approved</span>}
                </button>
              ))}
              <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
                Read-only — opening one does not make it current or approve it.
              </p>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        {shown && !shown.approved && visualQuality?.tone === 'ready' && (
          <Button variant={contentApproved ? 'primary' : 'ghost'}
            onClick={() => void approve(shown.renderJobId)} disabled={busy}>
            Approve visual
          </Button>
        )}
        {canRender && (
          <Button variant={visualQuality?.tone === 'attention' ? 'primary' : 'ghost'}
            onClick={() => void generate()} disabled={busy}>
            {busy ? 'Creating…'
              : visualQuality?.tone === 'attention' ? correctiveVisualLabel
                : succeeded.length > 0
                  ? canUseProductImages ? 'Try another visual using my product images' : 'Try another visual'
                  : canUseProductImages ? 'Create visual using my product images' : 'Create visual'}
          </Button>
        )}
      </div>

      {/* The next intended action, shown so the owner can approve the WORKFLOW
          before any provider call is spent. Deliberately inert this pass. */}
      {/* Offered whenever product images are usable — not only when the current
          creative happens to be a generic one. */}
      {canUseProductImages && !shownUsesProductImages && serverQuality !== 'ASSET_PROBLEM' && !canRender && (
        <div style={{ ...T.innerBlock, marginTop: 12 }}>
          <div style={eyebrow}>What happens next</div>
          <p style={{ ...T.body, margin: '4px 0 0' }}>
            Current product images are available. LaunchMind will use your approved
            imagery according to this concept&rsquo;s scene plan.
          </p>
          {/* Enabled only when the resolver says an image is actually renderable
              — allowed is not the same gate as renderable. The render resolves
              the CURRENT authorised set at request time; it never reuses the
              asset list from an older render. */}
          <Button variant={shown ? 'secondary' : 'primary'}
            onClick={() => void generate()} disabled={busy || !canUseProductImages}>
            {busy ? 'Creating…' : 'Create visual using my product images'}
          </Button>
          {!canUseProductImages && (
            <p style={{ ...T.meta, margin: '6px 0 0' }}>
              Not available yet — allow at least one product image first.
            </p>
          )}
        </div>
      )}

      {/* Shown in BOTH states. An owner looking at an already-approved visual
          still needs to know what that approval did and did not do — arguably
          more than one who has not clicked yet. */}
      {shown && (
        <p style={{ ...T.meta, marginTop: 8 }}>
          {shown.approved
            ? 'This approves this visual only. Nothing has been published, launched, scheduled or spent, and it does not make the copy above safe to use.'
            : 'Approving this approves this visual only. Nothing will be published, launched, scheduled or spent — and it does not make the copy above safe to use.'}
        </p>
      )}
    </section>
  );
}
