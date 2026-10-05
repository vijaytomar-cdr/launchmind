/**
 * @file app/(dashboard)/dashboard/intelligence/content/page.tsx
 * @description Content Intelligence — the AI CMO decision surface (Phase 3.5B5).
 *
 *   NOT a content editor. This page answers one question in about ten seconds:
 *   "is there something worth marketing, and why that?" Content Studio is where
 *   the owner works ON content; this is where they decide WHAT and WHY.
 *
 *   Everything rendered here comes from the owner-safe read model at
 *   GET /studio/governed/intelligence. No evidence handle, authority tier,
 *   policy version, classifier name or prompt reaches the browser — the server
 *   translates them before they leave it.
 *
 * @security Workspace and product scope are derived server-side from the JWT.
 *   The page passes a product id as CONTEXT only; it cannot widen scope.
 * @dependencies lib/api (contentIntelligence), PageShell, Button, LoadingState,
 *   EmptyState, ErrorState — existing LaunchMind components and tokens only.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError, type ContentIntelligenceView } from '@/lib/api';
import { PageShell } from '@/components/launchmind/PageShell';
import { Button } from '@/components/launchmind/Button';
import { PageLoading } from '@/components/launchmind/LoadingState';
import { EmptyState } from '@/components/launchmind/EmptyState';
import { ErrorState } from '@/components/launchmind/ErrorState';
import { AdjustDirectionPanel } from '@/components/launchmind/AdjustDirectionPanel';
import { ReadinessCard, type ReadinessItem } from '@/components/launchmind/ReadinessCard';
import { ProductMediaReview } from '@/components/launchmind/ProductMediaReview';
import { BrandReview } from '@/components/launchmind/BrandReview';
import { DestinationReview } from '@/components/launchmind/DestinationReview';
import { hasPreviousWork } from '@/lib/groundedConceptPlanning';
import { CurrentGroundedOpportunity, PreviousWork } from '@/components/launchmind/CurrentGroundedOpportunity';
import { DemandComparison } from '@/components/launchmind/DemandComparison';
import { ServiceCatalogConfirmation } from '@/components/launchmind/ServiceCatalogConfirmation';
import * as T from '@/lib/design-system/typography';

/** Owner-facing readiness words. The backend enum never reaches the browser. */
const READINESS: Record<string, { label: string; tone: 'ready' | 'attention' }> = {
  READY_TO_GENERATE:            { label: 'Ready',        tone: 'ready' },
  BLOCKED_ON_OWNER_CONFIRMATION:{ label: 'Needs you',    tone: 'attention' },
  BLOCKED_ON_ASSET:             { label: 'Needs asset',  tone: 'attention' },
  BLOCKED_ON_PROOF:             { label: 'Needs proof',  tone: 'attention' },
  UNSUPPORTED_CHANNEL:          { label: 'Not available',tone: 'attention' },
};

/**
 * Is this brand value a picture rather than words?
 *
 * The brand summary was printing "https://allignx.com/allignx_new.png" as the
 * owner-facing value of their logo. Nobody can evaluate their visual identity as
 * a URL string, and an owner-safe surface should not be showing storage paths at
 * all — the address is machinery, the mark is the thing.
 */
function isImageValue(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^https?:\/\//.test(v) && /\.(png|jpe?g|svg|webp|gif)(\?|$)/i.test(v);
}

/**
 * Which review panel an owner action opens — §7.
 *
 * PROOF and NONE map to nothing on purpose: there is no screen on which an
 * owner can supply evidence LaunchMind does not hold, and offering a button
 * that leads nowhere is worse than offering none.
 */
/** What the badge says, per requirement. Specific beats generic — §29. */
const PILL_LABEL: Record<string, string> = {
  DESTINATION: 'Destination needed',
  BRAND: 'Brand tone needed',
  MEDIA: 'Product image review',
  VIDEO_APPROACH: 'Presenter choice needed',
  PROOF: 'Proof not available',
  NONE: 'Not available yet',
};

const ACTION_REVIEW: Record<string, 'media' | 'brand' | 'destination' | null> = {
  DESTINATION: 'destination', BRAND: 'brand', MEDIA: 'media',
  VIDEO_APPROACH: null, PROOF: null, NONE: null,
};

const CHANNEL_LABEL: Record<string, string> = {
  GOOGLE_RSA: 'Google Ads', META_AD: 'Meta Ads', LANDING_PAGE: 'Landing page',
  LINKEDIN_POST: 'LinkedIn', SHORT_FORM_VIDEO_SCRIPT: 'Short video',
};

const CREATIVE_ROLES = [
  { key: 'A', name: 'Problem recognition', hook: 'Immediate recognition of the audience’s problem', journey: 'Problem → tension → product reveal', product: 'Secondary reveal' },
  { key: 'B', name: 'Product demonstration', hook: 'Show the verified product clearly', journey: 'Product → capability → context', product: 'Dominant' },
  { key: 'C', name: 'Relief', hook: 'Show the calmer direction without promising an outcome', journey: 'Relief → means → product', product: 'Supporting' },
] as const;

const TONE_OPTIONS = [
  'Professional & reassuring', 'Friendly & neighborly', 'Bold & energetic',
  'Premium & polished',
] as const;

function recommendedRole(objective: string | undefined) {
  return /lead|install|booking|traffic|conversion/i.test(objective ?? '')
    ? CREATIVE_ROLES[1] : CREATIVE_ROLES[0];
}

/** Shared card. Every owner surface uses the same one — see typography.ts. */
const card: React.CSSProperties = T.card;
const eyebrow: React.CSSProperties = T.eyebrow;
const label: React.CSSProperties = { ...eyebrow, marginBottom: 6 };

/** One labelled fact. Status is never communicated by colour alone. */
function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={label}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function Pill({ text, tone }: { text: string; tone: 'ready' | 'attention' | 'neutral' }) {
  const style = tone === 'ready'
    ? { background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)' }
    : tone === 'attention'
      ? { background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: 'var(--amber)' }
      : { background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink2)' };
  return (
    <span style={{ ...style, borderRadius: 999, padding: '3px 10px', fontSize: 11,
      fontWeight: 700, whiteSpace: 'nowrap' }}>
      {/* A symbol accompanies the colour so status is legible without it. */}
      {tone === 'ready' ? '✓ ' : tone === 'attention' ? '! ' : ''}{text}
    </span>
  );
}

export default function ContentIntelligencePage() {
  const router = useRouter();
  const [view, setView] = useState<ContentIntelligenceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjusted, setAdjusted] = useState<{ applied: Array<{ field: string; before: string;
    after: string }>; lineage: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // One review open at a time. Content Intelligence stays a decision surface;
  // administration happens in a focused view the owner chose to enter.
  const [review, setReview] = useState<null | 'media' | 'brand' | 'destination'>(null);
  const [readiness, setReadiness] = useState<{ assetsTotal: number; assetsAllowed: number;
    assetsRenderable: number; assetsNote: string | null;
    brandTotal: number; brandConfirmed: number; destination: string | null } | null>(null);
  const [creating, setCreating] = useState(false);
  /** Creation failures live here, beside the action — never on the page. */
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBlockerOpen, setCreateBlockerOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const [toneBusy, setToneBusy] = useState(false);
  const [toneNotice, setToneNotice] = useState<string | null>(null);
  const [customTone, setCustomTone] = useState('');
  const [creationStartedAt, setCreationStartedAt] = useState<number | null>(null);
  const [creationElapsed, setCreationElapsed] = useState(0);
  const [created, setCreated] = useState<{ made: number; total: number;
    items: Array<{ channel: string; variant: string | null;
      status: 'CREATED' | 'NEEDS_YOU' | 'NOT_STARTED'; note: string }>;
    skipped: Array<{ channel: string; reason: string }> } | null>(null);

  /** Counts only — the detail lives inside each review. */
  const loadReadiness = useCallback(async (tok: string, productId: string) => {
    try {
      const [assets, brand, dest] = await Promise.all([
        api.contentIntelligence.productAssets(tok, productId),
        api.contentIntelligence.brand(tok, productId),
        api.contentIntelligence.destinations(tok, productId),
      ]);
      const usable = (assets.assets ?? []).filter(a => a.canAllow);
      const observed = (brand.fields ?? []).filter(f => f.observed);
      setReadiness({
        assetsTotal: usable.length,
        assetsAllowed: usable.filter(a => a.allowed).length,
        assetsRenderable: assets.renderableCount ?? 0,
        assetsNote: assets.readinessNote ?? null,
        brandTotal: observed.length,
        brandConfirmed: observed.filter(f => f.confirmed).length,
        destination: dest.confirmed ?? null,
      });
    } catch { setReadiness(null); }
  }, []);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login?next=/dashboard/intelligence/content'); return; }
      setToken(session.access_token);
      const got = await api.contentIntelligence.get(session.access_token);
      setView(got);
      if (got.product) void loadReadiness(session.access_token, got.product.id);
      return true;
    } catch {
      // Never a raw error. The owner learns what happened, not how it broke.
      setError("I couldn't finish this content recommendation. Your existing content was not changed.");
      return false;
    } finally { if (showLoading) setLoading(false); }
  }, [loadReadiness, router]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Create what is ready.
   *
   * Blocked items are NOT failures — they are decisions waiting on the owner,
   * so the result is reported as "N created · M need your input" rather than
   * as errors. The server decides what is ready; this only asks.
   */
  const createRecommended = useCallback(async () => {
    const c = view?.campaign; const p = view?.product;
    if (!c?.strategyId || !p) return;
    setCreating(true); setCreateError(null); setCreateBlockerOpen(false);
    const started = Date.now(); setCreationStartedAt(started); setCreationElapsed(0);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await api.contentIntelligence.createRecommended({
        productId: p.id, campaignId: c.id, strategyId: c.strategyId, briefIds: c.briefIds,
      }, session.access_token);
      // §10 — ITEM BY ITEM. "N created · M need your input" is a summary of a
      // list the owner never sees, and one blocked item used to be
      // indistinguishable from one that failed. A blocked item is a decision
      // waiting on them; a failed item is LaunchMind's problem; a created item
      // is finished work. Those want three different responses, so they are
      // three different rows.
      setCreated({
        made: res.generated.length,
        total: res.generated.length + res.skipped.length,
        items: [
          ...res.generated.map(g => ({
            channel: g.channel, variant: g.variant ?? null,
            status: 'CREATED' as const,
            // `needsAttention` is the honest middle case: the artifact EXISTS
            // and is saved, but its wording did not clear governance. Reporting
            // that as a plain success would be a fake green result.
            note: (g.needsAttention ?? []).length === 0
              ? 'created and ready to review'
              : 'created — the wording still needs work',
          })),
          ...res.skipped.map(k => ({
            channel: k.channel, variant: null,
            status: 'NEEDS_YOU' as const, note: k.reason,
          })),
        ],
        skipped: res.skipped.map(s2 => ({ channel: s2.channel, reason: s2.reason })),
      });
      await load();
    } catch (cause) {
      // INLINE, not page-level. `setError` renders the page ErrorState, which
      // replaced the entire Content Intelligence surface — the recommendation,
      // the readiness card, everything — with "Couldn't load this". Creation is
      // an operation INSIDE this page, not the page itself, and a failed
      // operation must not take the surface down with it. Page-level ErrorState
      // is now reserved for the read model itself failing to load.
      setCreated(null);
      setCreationElapsed(Date.now() - started);
      const unavailable = cause instanceof ApiError
        ? cause.code === 'CREATIVE_GENERATION_UNAVAILABLE'
        : cause instanceof Error
          && /temporarily unavailable|writing model|generation unavailable/i.test(cause.message);
      setCreateError(unavailable
        ? 'Creative generation is temporarily unavailable. Your strategy and existing content are saved.'
        : "I couldn't finish this creative package. Your strategy and existing work are safe.");
    } finally { setCreating(false); setCreationStartedAt(null); }
  }, [view, load]);

  useEffect(() => {
    if (!creating || creationStartedAt == null) return;
    const timer = window.setInterval(() => setCreationElapsed(Date.now() - creationStartedAt), 500);
    return () => window.clearInterval(timer);
  }, [creating, creationStartedAt]);

  const confirmTone = useCallback(async (value: string) => {
    if (!token || !view?.product || !value.trim()) return;
    setToneBusy(true); setToneNotice(null);
    try {
      await api.contentIntelligence.confirmBrandField({
        productId: view.product.id, fieldKey: 'tone', value: value.trim(),
      }, token);
      setToneOpen(false); setCustomTone('');
      await load(false);
      setToneNotice('Brand tone saved.');
    } catch {
      setToneNotice("I couldn't save that tone. Nothing was changed.");
    } finally { setToneBusy(false); }
  }, [load, token, view]);

  if (loading) {
    return (
      <PageShell title="Content Intelligence"
        description="What LaunchMind thinks is worth marketing, and why.">
        <PageLoading message="LaunchMind is reviewing what changed and what is worth marketing." />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Content Intelligence"
        description="What LaunchMind thinks is worth marketing, and why.">
        <ErrorState message={error} onRetry={() => void load()} />
      </PageShell>
    );
  }

  const v = view!;
  const needs = v.needsFromYou ?? [];
  const confirmedTone = v.brand?.fields.find(f => f.name === 'tone' && f.confirmed)?.value ?? null;

  return (
    <PageShell
      title="Content Intelligence"
      description={v.product
        ? `What should we create for ${v.product.name}, why, and what do I need from you?`
        : 'What should we create, why, and what do I need from you?'}
    >
      <div style={{ display: 'grid', gap: 16 }}>

        {v.groundedRecommendation?.selected && <CurrentGroundedOpportunity key={v.groundedRecommendation.selected.id} recommendation={v.groundedRecommendation} planningWork={v.planningWork} token={token??undefined} />}

        {v.groundedRecommendation?.foundation && v.product && token && (
          <section style={card} aria-label="Service catalog and opportunity readiness">
            <ServiceCatalogConfirmation foundation={v.groundedRecommendation.foundation} productId={v.product.id} productName={v.product.name.split(/[・·]/)[0]} token={token} onConfirmed={()=>load(false)} />
            {v.groundedRecommendation.foundation.catalog.confirmed.every(e=>e.geographyStatus==='CONFIRMED')&&v.groundedRecommendation.foundation.catalog.confirmed.length>0&&<p style={{marginTop:14}}>Service area confirmed: {v.groundedRecommendation.foundation.catalog.confirmed[0].serviceArea?.displayLabel}. {v.groundedRecommendation.foundation.catalog.confirmed[0].serviceArea?.scopeDisclosure}</p>}
            {!v.groundedRecommendation.selected && v.groundedRecommendation.foundation.catalog.confirmed.length>0 && <div style={{marginTop:22}}>
              <p><strong>Market demand:</strong> {v.groundedRecommendation.foundation.demandTournament?.status==='COMPLETE'?'Current Arizona comparison is available; no opportunity was selected from it yet.':v.groundedRecommendation.alternatives?.some(c=>c.dimensions.some(d=>d.name==='Demand'&&d.points!==null))?'Available; no clear priority yet':'Not available yet'}</p>
              {(!v.groundedRecommendation.foundation.demandReadiness?.configured || v.groundedRecommendation.foundation.demandReadiness?.mode!=='ACTIVE') && <p style={{fontSize:13,marginTop:6}}>Search-demand source: administrator setup required</p>}
              <p style={{marginTop:10}}><strong>Performance:</strong> Not yet attributable by service</p>
              <p style={{marginTop:10}}><strong>Learning:</strong> No performance history yet</p>

            </div>}
            <DemandComparison foundation={v.groundedRecommendation.foundation} selectedServiceId={v.groundedRecommendation.selected?.serviceId} />
            <details style={{fontSize:12,marginTop:18,color:'var(--text-secondary)'}}><summary>Why LaunchMind knows this</summary>
              <ul style={{marginTop:10}}><li>{v.groundedRecommendation.foundation.catalog.confirmed.length} services confirmed by you</li><li>Services originally discovered from your website</li><li>Service area: {v.groundedRecommendation.foundation.catalog.confirmed.some(e=>e.geographyStatus!=='CONFIRMED')?'needs confirmation':'confirmed by you'}</li><li>Search demand: {v.groundedRecommendation.foundation.demandUnavailable?'not connected or unavailable':'current Google Trends evidence for Arizona'}</li><li>Campaign performance: not yet attributable to services</li><li>Performance learning: not available yet</li></ul>
            </details>
          </section>
        )}

        <PreviousWork active={!!v.groundedRecommendation?.selected} hasHistory={hasPreviousWork(v)}>
        {/* ── The decision ───────────────────────────────────────────────── */}
        {v.state === 'HAS_OPPORTUNITY' && v.opportunity && (
          <section style={{ ...card, borderColor: 'var(--sage-b)' }} aria-labelledby="ci-headline">
            <div style={{ ...eyebrow, color: 'var(--sage)' }}>{v.groundedRecommendation?.selected ? 'Previous content direction' : v.groundedRecommendation ? 'Existing content direction' : 'Recommended content opportunity'}</div>
            {/* First run. Framed as a first test, not as a market event — there
                is no urgency here and manufacturing some would be a lie. */}
            {v.opportunity.isFirstStory && !v.opportunity.whyNow && (
              <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '8px 0 0' }}>
                Based on what I learned about your application, here&rsquo;s the first
                story I would test.
              </p>
            )}
            <h2 id="ci-headline" style={{ ...T.sectionTitle, fontSize: 24, margin: '8px 0 14px' }}>
              {v.opportunity.title}
            </h2>

            <div style={{ display: 'grid', gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <Fact title="Why now">
                {v.opportunity.whyNow || v.opportunity.whyNowKind}
              </Fact>
              <Fact title="For">{v.opportunity.who || 'Not confirmed yet'}</Fact>
              <Fact title="Best format">
                {v.campaign?.package?.map(p => CHANNEL_LABEL[p.channel] ?? p.channel).slice(0, 2).join(' · ')
                  || 'Recommended format'}
              </Fact>
              <Fact title="Creative direction">
                {v.creativeDirection?.recommends?.join(' · ')
                  || v.campaign?.thesis || v.opportunity.message}
              </Fact>
            </div>

            {v.opportunity.isShareabilityPlay && (
              <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 14 }}>
                {/* Never a promise of virality — a hypothesis about attention. */}
                Designed to increase the chance people stop, understand and share.
              </p>
            )}
            {(needs.length > 0 || confirmedTone) && <div style={{ ...T.innerBlock, marginTop: 14 }}>
              <div style={label}>{confirmedTone ? 'Brand tone'
                : /brand tone/i.test(needs[0]) ? 'Improves this creative' : 'Needs you'}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12,
                alignItems: 'center', flexWrap: 'wrap' }}>
                <p style={{ ...T.bodyStrong, margin: 0 }}>
                  {confirmedTone ? `Brand tone · ${confirmedTone} ✓` : needs[0]}
                </p>
                {confirmedTone ? (
                  <Button variant="ghost" onClick={() => setToneOpen(o => !o)}>Edit tone →</Button>
                ) : /brand tone/i.test(needs[0]) && (
                  <Button variant="ghost" onClick={() => setToneOpen(o => !o)}>Review tone →</Button>
                )}
              </div>
              {toneNotice && <p role="status" style={{ ...T.meta, margin: '8px 0 0' }}>{toneNotice}</p>}
              {toneOpen && (
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }} aria-label="Choose brand tone">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {TONE_OPTIONS.map(tone => (
                      <Button key={tone} variant="ghost" onClick={() => void confirmTone(tone)}
                        disabled={toneBusy}>{tone}</Button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input aria-label="Custom brand tone" value={customTone}
                      onChange={e => setCustomTone(e.target.value)} placeholder="Custom tone"
                      style={{ flex: 1, minWidth: 190, border: '1px solid var(--border2)',
                        borderRadius: 9, padding: '8px 10px', font: 'inherit' }} />
                    <Button variant="ghost" onClick={() => void confirmTone(customTone)}
                      disabled={toneBusy || !customTone.trim()}>Confirm custom tone</Button>
                  </div>
                  <p style={{ ...T.meta, margin: 0 }}>
                    Tone improves creative quality. It is not required to create content.
                  </p>
                </div>
              )}
            </div>}
          </section>
        )}

        {v.campaign && !v.created && reviewOpen && (
          <section style={card} aria-labelledby="ci-creative-package">
            <div style={label}>Recommended creative package</div>
            <h2 id="ci-creative-package" style={{ ...T.sectionTitle, margin: '6px 0' }}>
              Three different hypotheses for one objective
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 14px' }}>
              Each changes the hook, message order, product role and viewer journey—not just the layout.
            </p>
            <div style={{ display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {CREATIVE_ROLES.map(role => (
                <article key={role.key} style={T.innerBlock}>
                  <div style={{ ...eyebrow, color: 'var(--sage)' }}>Concept {role.key}</div>
                  <h3 style={{ ...T.cardTitle, margin: '6px 0 10px' }}>{role.name}</h3>
                  <Fact title="Hook strategy">{role.hook}</Fact>
                  <div style={{ height: 10 }} />
                  <Fact title="Viewer journey">{role.journey}</Fact>
                  <div style={{ height: 10 }} />
                  <Fact title="Product role">{role.product}</Fact>
                </article>
              ))}
            </div>
            <div style={{ ...T.innerBlock, marginTop: 12 }}>
              <div style={label}>What LaunchMind is using</div>
              <p style={{ fontSize: 13, color: 'var(--ink2)', margin: 0 }}>
                Confirmed product truth, the current objective, authorized assets and channel requirements
                {v.creativeDirection.recommends.length > 0
                  ? `, informed by ${v.creativeDirection.recommends.join(', ')}` : ''}.
              </p>
            </div>
          </section>
        )}

        {/* Insufficient context. Asks for the SMALLEST useful thing rather than
            inventing an opportunity to keep the page busy. */}
        {v.state === 'NEEDS_CONTEXT' && (
          <EmptyState
            heading="I need a little more before I can recommend content"
            description={needs.length > 0
              ? `Start with: ${needs[0]}.`
              : 'Confirm your audience and brand tone, and I can build a first story.'}
            action={{ label: 'Create something else', variant: 'ghost',
              onClick: () => router.push('/dashboard/intelligence/content/create') }}
          />
        )}
        {v.state === 'NO_OPPORTUNITY' && (
          <EmptyState
            heading="Nothing new needs your attention right now"
            description="I will bring you something when there is a reason to. You can also tell me what to work on."
            action={{ label: 'Create something else',
              onClick: () => router.push('/dashboard/intelligence/content/create') }}
          />
        )}
        {v.state === 'NO_PRODUCT' && (
          <EmptyState
            heading="No product yet"
            description="Add your product so LaunchMind can learn what it is marketing."
          />
        )}

        {/* ── Proof: what can and cannot be said ───────────────────────────
            BEHIND REVIEW — §6. This is the right answer to "why can't it say
            that?", and the wrong answer to "what should we make?". Rendering
            two lists of claim classes above the fold turned a decision surface
            into a governance report; the owner asked to be told what to create,
            not to audit the evidence ledger first. Nothing is deleted. */}
        {v.campaign && reviewOpen && (
          <section style={card} aria-label="Proof">
            <div style={{ display: 'grid', gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <div>
                <div style={label}>Available proof</div>
                {v.campaign.proofAvailable.length === 0
                  ? <p style={{ fontSize: 13, color: 'var(--ink3)' }}>
                      You don&apos;t have proof on file for this message yet.
                    </p>
                  : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
                      {v.campaign.proofAvailable.map(p => <li key={p}>{p}</li>)}
                    </ul>}
              </div>
              <div>
                <div style={label}>Do not claim yet</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                  {v.campaign.proofUnavailable.slice(0, 6).map(p => <li key={p}>{p}</li>)}
                </ul>
                <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8 }}>
                  LaunchMind leaves these out rather than saying something it cannot verify.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── §14 What this direction has ALREADY produced ─────────────────
            Rendered BEFORE the package, and the package's heading changes
            below. The page used to offer "What I would create" indefinitely,
            with no way to tell from here whether the button had ever worked. */}
        {v.created && v.created.total > 0 && (
          <section style={{ ...card, borderColor: 'var(--sage-b)' }}
            aria-labelledby="ci-created">
            <div id="ci-created" style={{ ...label, color: 'var(--sage)' }}>
              {v.groundedRecommendation?.selected ? 'Previously generated concepts' : 'Created from this direction'}
            </div>
            <p style={{ fontSize: 15, color: 'var(--ink)', margin: '8px 0 0', fontWeight: 650 }}>
              {v.created.total} concept{v.created.total === 1 ? '' : 's'}
              {v.created.needsAttention > 0
                ? ` · ${v.created.ready} ready to review · ${v.created.needsAttention} need${v.created.needsAttention === 1 ? 's' : ''} attention`
                : v.created.ready > 0 ? ` · ${v.created.ready} ready to review` : ''}
              {v.created.launchMindRepairing > 0
                ? ` · ${v.created.launchMindRepairing} being refined by LaunchMind` : ''}
            </p>
            {v.created.ready > 0 && (() => {
              const pick = recommendedRole(v.opportunity?.objective);
              return (
                <div style={{ ...T.innerBlock, marginTop: 12 }}>
                  <div style={{ ...label, color: 'var(--semantic-intelligence)' }}>
                    {v.groundedRecommendation?.selected ? 'Previously suggested' : 'LaunchMind recommends testing'} Concept {pick.key} {v.groundedRecommendation?.selected ? '' : 'first'}
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)', margin: 0 }}>
                    {pick.name} · {v.groundedRecommendation?.selected ? 'prior hypothesis' : 'strongest current hypothesis'}
                  </p>
                  <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink2)', margin: '5px 0 0' }}>
                    {v.groundedRecommendation?.selected ? 'Suggested from the earlier objective and product context.' : 'Best fit with the current objective and available product truth.'}
                    No first-party performance exists for this hook yet.
                  </p>
                </div>
              );
            })()}
            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none',
              display: 'grid', gap: 5 }}>
              {v.created.concepts.map((cn, i) => (
                <li key={`${cn.name}-${i}`} style={{ display: 'flex', gap: 9,
                  alignItems: 'baseline', fontSize: 13, color: 'var(--ink2)' }}>
                  {/* A symbol AND a word — status is never colour alone. */}
                  <span aria-hidden style={{ width: 12,
                    color: cn.status === 'READY' ? 'var(--sage)' : 'var(--amber)' }}>
                    {cn.status === 'READY' ? '✓' : cn.status === 'NEEDS_ATTENTION' ? '!' : '↻'}
                  </span>
                  <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{cn.name}</span>
                  <span>{cn.status === 'READY' ? 'ready to review'
                    : cn.status === 'NEEDS_ATTENTION' ? 'needs your confirmation'
                      : 'LaunchMind is refining this'}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <Button onClick={() => {
                const pick = recommendedRole(v.opportunity?.objective);
                const recommended = v.created!.concepts.find(c =>
                  c.name.toLowerCase().includes(pick.name.toLowerCase()));
                const query = new URLSearchParams({ campaign: v.created!.campaignId! });
                if (recommended) query.set('artifact', recommended.artifactId);
                router.push(`/dashboard/content?${query.toString()}`);
              }}>
                {v.groundedRecommendation?.selected ? 'Review previous work →' : 'Review recommendation →'}
              </Button>
              {v.created.total > 1 && (
                <Button variant="ghost" onClick={() => router.push(
                  `/dashboard/content?campaign=${v.created!.campaignId}&view=compare`)}>
                  Compare concepts
                </Button>
              )}
            </div>
          </section>
        )}

        {/* ── What I would create ───────────────────────────────────────── */}
        {v.campaign && v.campaign.package.length > 0 && reviewOpen && (
          <section style={card} aria-label="Recommended content package">
            <div style={label}>
              {v.created && v.created.total > 0 ? 'What this direction covers' : 'What I would create'}
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {v.campaign.package.map(item => {
                const r = READINESS[item.state] ?? { label: item.state, tone: 'attention' as const };
                return (
                  <div key={item.channel} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
                    padding: '10px 12px', background: 'var(--raised)',
                    border: '1px solid var(--border)', borderRadius: 10,
                  }}>
                    <div style={{ minWidth: 130, fontSize: 14, fontWeight: 650, color: 'var(--ink)' }}>
                      {CHANNEL_LABEL[item.channel] ?? item.channel}
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      {/* §7 — the ACTION, not the lifecycle. A row that needs a
                          destination says so and offers the button; a row that
                          needs nothing says nothing further. */}
                      <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
                        {item.ownerAction?.detail ?? item.reason}
                      </div>
                      {item.variants?.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>
                          {item.variants.map(x => x.label).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--ink3)',
                        fontFamily: 'var(--font-dm-mono)' }}>×{item.quantity}</span>
                      {/* §29 — the pill names the REQUIREMENT, not the fact
                          that one exists. "! Needs you" beside another "! Needs
                          you" told an owner two different things were wanted
                          and which neither of them was. The row's action
                          already says what to do; the badge now agrees. */}
                      <Pill text={PILL_LABEL[item.ownerAction?.target ?? ''] ?? r.label}
                        tone={r.tone} />
                      {item.ownerAction?.label && ACTION_REVIEW[item.ownerAction.target] && (
                        <Button variant="ghost"
                          onClick={() => setReview(ACTION_REVIEW[item.ownerAction!.target]!)}>
                          {item.ownerAction.label} →
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Why LaunchMind picked this ─────────────────────────────────── */}
        {(v.whyThis?.length > 0 || needs.length > 0) && reviewOpen && (
          <section style={card} aria-label="Why this">
            {v.whyThis?.length > 0 && (
              <>
                <div style={label}>Why LaunchMind picked this</div>
                <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                  {v.whyThis.map(w => <li key={w}>{w}</li>)}
                </ul>
              </>
            )}
            {needs.length > 0 && (
              <>
                <div style={label}>What I need from you</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
                  {needs.map(n => <li key={n}>{n}</li>)}
                </ul>
              </>
            )}
          </section>
        )}

        {/* COMPACT readiness, not an administration console. The previous
            version put ten authorization cards and a brand editor inline here,
            and the owner's response was "I don't know what to do" — a decision
            surface had become a settings page. Each item opens its own review. */}
        {reviewOpen && token && v.product && review === null && readiness && (
          <ReadinessCard
            items={([
              { key: 'product', label: 'What it does',
                detail: 'I understand what your application does', satisfied: true },
              { key: 'audience', label: 'Audience',
                detail: v.opportunity?.who ? 'I know who this is for' : 'Not confirmed yet',
                satisfied: !!v.opportunity?.who },
              { key: 'brand', label: 'Brand',
                detail: readiness.brandConfirmed > 0
                  ? `${readiness.brandConfirmed} of ${readiness.brandTotal} confirmed`
                  : `${readiness.brandTotal} thing${readiness.brandTotal === 1 ? '' : 's'} to confirm`,
                satisfied: readiness.brandTotal > 0 && readiness.brandConfirmed === readiness.brandTotal,
                // Revisable for the same reason as media: a brand decision is
                // not a one-way door.
                onReview: () => setReview('brand'), reviewLabel: 'Review brand',
                alwaysOfferReview: true },
              { key: 'media', label: 'Product media',
                // §9 — "4 of 11 allowed" beside "no authorised imagery" was two
                // true statements that contradicted each other. Allowed and
                // RENDERABLE are different gates, so the row says which one fails.
                detail: readiness.assetsNote
                  ?? (readiness.assetsRenderable > 0
                    ? `${readiness.assetsRenderable} of ${readiness.assetsTotal} images ready to use`
                    : 'Choose which images I may use'),
                satisfied: readiness.assetsRenderable > 0,
                // Offered even when satisfied: an owner must be able to change
                // their mind about which of their images LaunchMind may use.
                onReview: () => setReview('media'), reviewLabel: 'Review images',
                alwaysOfferReview: true },
              { key: 'destination', label: 'Destination',
                detail: readiness.destination
                  ? (readiness.destination === 'NONE'
                      ? 'No link — awareness only' : readiness.destination)
                  : 'Confirm where people should go',
                satisfied: !!readiness.destination,
                onReview: () => setReview('destination'), reviewLabel: 'Choose destination',
                alwaysOfferReview: true },
            ] as ReadinessItem[]).filter(i => i.key !== 'brand' || readiness.brandTotal > 0)}
            onFinishSetup={() => setReview(
              readiness.assetsRenderable === 0 ? 'media'
                : !readiness.destination ? 'destination' : 'brand')}
          />
        )}

        {token && v.product && review === 'media' && (
          <ProductMediaReview token={token} productId={v.product.id}
            onClose={() => setReview(null)} onChanged={() => void loadReadiness(token, v.product!.id)} />
        )}
        {token && v.product && review === 'brand' && (
          <BrandReview token={token} productId={v.product.id}
            onClose={() => setReview(null)} onChanged={() => void loadReadiness(token, v.product!.id)} />
        )}
        {token && v.product && review === 'destination' && (
          <DestinationReview token={token} productId={v.product.id}
            onClose={() => setReview(null)} onChanged={() => void loadReadiness(token, v.product!.id)} />
        )}

        {/* ── Brand, with honest provenance ──────────────────────────────── */}
        {v.brand && reviewOpen && (v.brand.fields.length > 0 || v.brand.missing.length > 0) && (
          <section style={card} aria-label="Brand">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12,
              alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div style={label}>Brand &amp; destination ✓</div>
              <button type="button" onClick={() => setReview('brand')} style={{
                border: 0, background: 'none', color: 'var(--sage)', cursor: 'pointer',
                font: 'inherit', fontSize: 12, fontWeight: 650, padding: 0,
              }}>Review →</button>
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 13, color: 'var(--ink2)', cursor: 'pointer' }}>
                View confirmed brand details
              </summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {v.brand.fields.map(f => (
                <div key={f.name} style={{ display: 'flex', gap: 12, alignItems: 'center',
                  flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ minWidth: 120, color: 'var(--ink3)',
                    textTransform: 'capitalize' }}>{f.name}</span>
                  {/* A URL IS NOT A VALUE AN OWNER CAN JUDGE. An image field
                      shows the image; the address is machinery. Text fields
                      still read as text — a tagline IS its words. */}
                  {isImageValue(f.value) ? (
                    <span style={{ flex: 1, minWidth: 140, display: 'flex',
                      alignItems: 'center', gap: 9 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.value!} alt={`Your ${f.name}`}
                        style={{ width: 30, height: 30, objectFit: 'contain',
                          borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--surface)', padding: 2 }} />
                      <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
                        {f.confirmed ? 'On file' : 'Observed'}
                      </span>
                    </span>
                  ) : (
                    <span style={{ flex: 1, minWidth: 140, color: 'var(--ink)' }}>
                      {f.value ?? '—'}
                    </span>
                  )}
                  {/* Displaying an observed value never makes it confirmed. */}
                  <Pill text={f.confirmed ? 'Confirmed' : f.note} tone={f.confirmed ? 'ready' : 'neutral'} />
                </div>
              ))}
              {v.brand.missing.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>
                  Not on file: {v.brand.missing.join(', ')}
                </p>
              )}
            </div>
            </details>
          </section>
        )}

        {/* ── Campaign Review — the bridge to Content Studio ─────────────── */}
        {v.campaign && reviewOpen && (
          <section style={card} aria-labelledby="ci-campaign-review">
            <div style={{ ...eyebrow, color: 'var(--sage)' }}>Review direction</div>
            <h2 id="ci-campaign-review" style={{ ...T.sectionTitle, margin: '8px 0 4px' }}>
              {v.campaign.name}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '0 0 16px' }}>
              Content only — nothing here schedules, launches or spends.
            </p>

            <div style={{ display: 'grid', gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              <Fact title="Why">{v.campaign.thesis}</Fact>
              <Fact title="For">{v.campaign.audience}</Fact>
              <Fact title="Format">Core marketing message</Fact>
              <Fact title="First channel adaptation">Meta</Fact>
            </div>

            <details style={{ ...T.innerBlock, marginTop: 16 }}>
              <summary style={{ ...T.bodyStrong, cursor: 'pointer' }}>Review full strategy</summary>
              <div style={{ display: 'grid', gap: 14, marginTop: 14,
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                {v.campaign.coreProblem && <Fact title="Core problem">{v.campaign.coreProblem}</Fact>}
                <Fact title="Message angle">{v.campaign.messageAngle}</Fact>
                {v.campaign.productRole && <Fact title="Product role">{v.campaign.productRole}</Fact>}
                {v.campaign.primaryBenefit && <Fact title="Primary benefit">{v.campaign.primaryBenefit}</Fact>}
                {v.campaign.ctaIntent && <Fact title="CTA intent">{v.campaign.ctaIntent}</Fact>}
                <Fact title="Brand direction">{v.campaign.brandDirection}</Fact>
                {v.campaign.objections.length > 0 && (
                  <Fact title="Objections">{v.campaign.objections.join(' · ')}</Fact>
                )}
              </div>
            </details>

            {needs.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={label}>What needs you</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
                  {needs.map(n => <li key={n}>{n}</li>)}
                </ul>
              </div>
            )}

            {/* Applying a direction APPENDS a strategy. The notice says what is
                untouched, because owners assume a redirect destroys their work. */}
            {adjusted && (
              <div role="status" style={{
                marginTop: 16, padding: 13, borderRadius: 10,
                background: 'var(--sage-d)', border: '1px solid var(--sage-b)',
              }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, fontWeight: 650 }}>
                  Direction updated.
                </p>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                  {adjusted.applied.map(a => (
                    <li key={a.field}>{a.field}: {a.after}</li>
                  ))}
                </ul>
                {adjusted.lineage && (
                  <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '8px 0 0' }}>
                    {adjusted.lineage}
                  </p>
                )}
              </div>
            )}

            {adjustOpen && token && (
              <AdjustDirectionPanel
                campaignId={v.campaign.id}
                productId={v.product!.id}
                token={token}
                current={{
                  audience: v.campaign.audience, message: v.campaign.messageAngle,
                  ctaIntent: v.campaign.ctaIntent, channels: v.campaign.package.map(x => x.channel),
                  brandDirection: v.campaign.brandDirection,
                }}
                onApplied={s => { setAdjusted(s); setAdjustOpen(false); void load(); }}
                onCancel={() => setAdjustOpen(false)}
              />
            )}
          </section>
        )}

        {/* Creation state, INSIDE the page. The surface stays mounted throughout. */}
        {creating && (
          <div role="status" aria-live="polite" style={card}>
            <div style={label}>Building your creative package</div>
            <p style={{ fontSize: 14, color: 'var(--ink)', margin: '6px 0 0', fontWeight: 650 }}>
              Creating three governed concepts…
            </p>
            <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '4px 0 0' }}>
              ✓ Business context loaded — complete<br />
              ✓ Product truth verified — complete<br />
              ✓ Relevant creative patterns selected — complete<br />
              ● Developing and reviewing concepts — active<br />
              ○ Visuals can be created from each concept in Content Studio
            </p>
            <p style={{ ...T.meta, margin: '8px 0 0' }}>
              {Math.max(1, Math.round(creationElapsed / 1000))}s elapsed · this request is bounded
            </p>
          </div>
        )}

        {createError && !creating && (
          <div role="alert" style={{ ...card, background: 'var(--amber2)',
            borderColor: '#f2d29f' }}>
            <p style={{ fontSize: 14, color: '#7d4306', margin: 0, fontWeight: 650 }}>
              {createError}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <Button onClick={() => void createRecommended()} disabled={creating}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => setCreateBlockerOpen(o => !o)}>
                What blocked it? →
              </Button>
            </div>
            {createBlockerOpen && (
              <p style={{ ...T.meta, color: '#7d4306', margin: '10px 0 0' }}>
                Business context, product truth, and creative direction loaded successfully.
                New concepts could not be completed, so visual creation was skipped.
                Existing strategy and content were not changed.
              </p>
            )}
          </div>
        )}

        {created && (
          <div role="status" style={{ ...card, borderColor: 'var(--sage-b)' }}>
            <div style={label}>Content creation</div>
            <p style={{ fontSize: 14, color: 'var(--ink)', margin: '6px 0 10px', fontWeight: 650 }}>
              {created.made} created · {created.skipped.length} need your input
            </p>
            {/* ITEM BY ITEM. A success and a blocked decision are different
                things and must not be summarised into one another. Status is
                carried by a symbol AND a word, never by colour. */}
            <ul style={{ margin: 0, padding: 0, listStyle: 'none',
              display: 'grid', gap: 6 }}>
              {created.items.map((it, i) => (
                <li key={`${it.channel}-${it.variant ?? i}`} style={{
                  display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
                  fontSize: 13, color: 'var(--ink2)',
                }}>
                  <span aria-hidden style={{ width: 14,
                    color: it.status === 'CREATED' ? 'var(--sage)' : 'var(--amber)' }}>
                    {it.status === 'CREATED' ? '✓' : '!'}
                  </span>
                  <span style={{ color: 'var(--ink)', fontWeight: 600, minWidth: 120 }}>
                    {CHANNEL_LABEL[it.channel] ?? it.channel}
                    {it.variant ? ` — ${it.variant}` : ''}
                  </span>
                  <span>{it.note}</span>
                </li>
              ))}
            </ul>
            {/* §18 — the owner should not have to go hunting for the output. */}
            {created.made > 0 && v.campaign && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                {created.made > 1 && (
                  <Button onClick={() =>
                    router.push(`/dashboard/content?campaign=${v.campaign!.id}&view=compare`)}>
                    Compare concepts
                  </Button>
                )}
                <Button variant={created.made > 1 ? 'ghost' : 'primary'} onClick={() =>
                  router.push(`/dashboard/content?campaign=${v.campaign!.id}`)}>
                  Review in Content Studio →
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {v.campaign && !v.created && !reviewOpen && (
            <Button onClick={() => void createRecommended()} disabled={creating}>
              {creating ? 'Creating recommended content…' : 'Create recommended content →'}
            </Button>
          )}
          {v.campaign && reviewOpen && (
            <>
              <Button onClick={() => void createRecommended()} disabled={creating}>
                {creating ? 'Creating what is ready…' : 'Create recommended content'}
              </Button>
              <Button variant="ghost" onClick={() => setAdjustOpen(o => !o)} disabled={creating}>
                {adjustOpen ? 'Keep this direction' : 'Adjust direction'}
              </Button>
              <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={creating}>Close review</Button>
            </>
          )}
          {v.campaign && !reviewOpen && (
            <Button variant="ghost" onClick={() => setReviewOpen(true)}>
              {v.groundedRecommendation?.selected ? 'Review previous direction and its evidence →' : 'Why this recommendation & what LaunchMind used →'}
            </Button>
          )}
          {/* §26 — ONE Studio action, not two. "Open in Content Studio" and
              "Open Content Studio" sat side by side and differed only in
              whether they carried the campaign. Two labels for what an owner
              reads as one destination is a coin toss, not a choice. The
              campaign-scoped route is kept because it is the useful one; the
              created-state card above offers it as a primary action once
              content exists, so this stays secondary. */}
          {!v.campaign && (
            <Button variant="ghost" onClick={() => router.push('/dashboard/content')}>
              Open Content Studio
            </Button>
          )}
          {!v.campaign && <Button variant="ghost"
            onClick={() => router.push('/dashboard/intelligence/content/create')}>
            Create something else
          </Button>}
        </div>

        {/* ── §20 Creative direction ─────────────────────────────────────
            Three words and a sentence. NOT a competitor gallery: showing an
            owner the adverts LaunchMind looked at is one click from being
            asked to copy one. Rendered only when there is something real —
            the limitation sentence is shown INSTEAD, never alongside. */}
        {reviewOpen && v.creativeDirection && (v.creativeDirection.recommends.length > 0
            || v.creativeDirection.limitation) && (
          <section style={card} aria-labelledby="ci-creative-direction">
            <div style={label} id="ci-creative-direction">Creative direction</div>
            {v.creativeDirection.recommends.length > 0 ? (
              <>
                <p style={{ fontSize: 15, color: 'var(--ink)', margin: '8px 0 0',
                  fontWeight: 650 }}>
                  {v.creativeDirection.recommends.join(' · ')}
                </p>
                {v.creativeDirection.why && (
                  <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '8px 0 0' }}>
                    {v.creativeDirection.why}
                  </p>
                )}
                {v.creativeDirection.notImitated.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ fontSize: 12, color: 'var(--ink2)', cursor: 'pointer' }}>
                      See creative reasoning
                    </summary>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12,
                      color: 'var(--ink2)' }}>
                      {v.creativeDirection.notImitated.map(n => <li key={n}>{n}</li>)}
                    </ul>
                    <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8 }}>
                      LaunchMind learns the shape of what works in your category. It
                      never copies another company&rsquo;s advert, images or wording.
                    </p>
                  </details>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '8px 0 0' }}>
                {v.creativeDirection.limitation}
              </p>
            )}
          </section>
        )}
        </PreviousWork>
      </div>
    </PageShell>
  );
}
