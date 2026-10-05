/**
 * @file app/(dashboard)/dashboard/brief/BriefClientView.tsx
 * @description Morning Brief UI. Implements stale-while-revalidate using sessionStorage:
 *   - First visit: fetches /owner/brief, shows spinner, caches result.
 *   - Subsequent visits (< 5 min): renders from cache instantly, refreshes silently in background.
 *   - After 5 min: shows spinner once, caches fresh result.
 * @dependencies api.owner.brief, api.owner.ask
 */

'use client';

import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type BriefResponse, type ContentIntelligenceView } from '@/lib/api';
import { trackIntelligence } from '@/lib/analytics';
import { useBusinessScope, businessCacheKey } from '@/lib/business/scope';
import {
  createMorningBriefViewModel,
  type MorningBriefMetric,
  type MorningBriefViewModel,
} from '@/lib/morning-brief/viewModel';

const API_URL      = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const CACHE_BASE   = 'lm_brief_data';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — show cached, revalidate silently after

// PARTITIONED BY COMPANY. This was one global key, so switching company remounted
// the view and it promptly re-read the PREVIOUS company's brief out of
// sessionStorage and rendered it under the new company's header — measured at
// ~5s of visible mixed-business state. The `<main key>` remount cannot prevent
// that, because the component reloads the data itself after being rebuilt.
function readCache(key: string | null): BriefResponse | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, payload } = JSON.parse(raw) as { ts: number; payload: BriefResponse };
    if (Date.now() - ts < CACHE_TTL_MS) return payload;
    return null;
  } catch { return null; }
}

// No company, no cache. Writing under an unattributed key is what created the leak.
function writeCache(key: string | null, data: BriefResponse) {
  if (!key) return;
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), payload: data })); } catch {}
}

// States where onboarding is incomplete
const INCOMPLETE_STATES = new Set([
  'BELIEF_REVIEW', 'ALIGNMENT_AUDIENCE', 'ALIGNMENT_CONTEXT', 'ALIGNMENT_GOAL',
  'ALIGNMENT_COMPETITORS', 'BOUNDARIES_SETUP', 'FINAL_REVIEW',
  'DIRECTION_GENERATING', 'DIRECTION_COMPLETE',
]);
const STATE_LABELS: Record<string, { step: string; confidence: number }> = {
  BELIEF_REVIEW:        { step: 'Confirm and align',     confidence: 64 },
  ALIGNMENT_AUDIENCE:   { step: 'Define your audience',  confidence: 68 },
  ALIGNMENT_CONTEXT:    { step: "What's changing",       confidence: 72 },
  ALIGNMENT_GOAL:       { step: 'Define success metric', confidence: 76 },
  ALIGNMENT_COMPETITORS:{ step: 'Confirm competitors',   confidence: 80 },
  BOUNDARIES_SETUP:     { step: 'Set boundaries',        confidence: 84 },
  FINAL_REVIEW:         { step: 'Final review',          confidence: 88 },
  DIRECTION_GENERATING: { step: 'Generating direction',  confidence: 92 },
  DIRECTION_COMPLETE:   { step: 'Review your direction', confidence: 96 },
};

import {
  IconCheck,
  IconArrowRight,
} from '@tabler/icons-react';

// ── Recommendation card ───────────────────────────────────────────────────────

function goalStatement(data: BriefResponse): string | null {
  const goal = data.phase1?.primaryGoal;
  if (!goal) return null;
  const horizon = goal.horizonDays ? ` over ${goal.horizonDays} days` : '';
  return `Your stated goal is ${goal.target.toLocaleString()} ${goal.unit}${horizon}.`;
}

function RecommendationCard({ data, viewModel }: { data: BriefResponse; viewModel: MorningBriefViewModel }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const rec = data.recommendation;
  if (!rec) return null;
  const known = goalStatement(data)
    ?? (data.phase1?.contextDelta ? `You identified this priority: ${data.phase1.contextDelta}` : null)
    ?? (data.product ? `This recommendation is grounded in your ${displayName(data.product.name)} product context.` : null);
  const missingPerformance = viewModel.performanceSource === 'UNAVAILABLE';
  const isAvailabilityMove = /availab/i.test(rec.title);
  const boundedInference = isAvailabilityMove
    ? 'Capturing availability could reduce coordination after a request.'
    : 'This could reduce friction against the stated goal.';
  const compactBasis = viewModel.performanceSource === 'DEMO'
    ? 'Founder goal + seeded funnel snapshot'
    : viewModel.performanceSource === 'REAL'
      ? 'Founder goal + observed funnel performance'
      : goalStatement(data) ? 'Founder goal + product context' : 'Product context';
  const compactUnknown = /booking/i.test(data.phase1?.primaryGoal?.unit ?? '')
    ? 'Effect on booking conversion'
    : 'Effect on the goal';
  // Model-authored action labels can imply execution (for example "Ship" or
  // "Launch") even though this route only opens a planning mission. The title
  // carries the specific move; the control names the authority actually granted.
  const actionLabel = rec.missionType ? 'Scope this move' : 'Review this move';
  const displayTitle = isAvailabilityMove
    ? 'Test Preferred Availability in the Request Flow'
    : rec.title;
  const whyToday = viewModel.performanceSource === 'DEMO'
    ? 'Requests increased 14.8%, while request-to-booking conversion fell 3.8 points. Test request-flow friction before increasing acquisition.'
    : 'This is the clearest test tied to your current goal. Its performance impact is still unknown.';
  return (
    <div style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--sage3)', borderRadius: 14, padding: '18px 18px 18px 22px', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,var(--sage),var(--sage-l))' }} />
      <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 23, fontWeight: 700, letterSpacing: '-.018em', lineHeight: 1.2, color: 'var(--ink)', margin: 0 }}>{displayTitle}</h2>
      <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.55, margin: '7px 0 14px' }}>
        <strong style={{ color: 'var(--ink)' }}>Why today:</strong> {whyToday}
      </p>

      {viewModel.lastExperiment?.connectionToPriority && (
        <div style={{ margin: '0 0 11px', fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
          <strong style={{ display: 'block', fontSize: 9.5, color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>Builds on the last result</strong>
          {viewModel.lastExperiment.connectionToPriority}
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '9px 11px', borderRadius: 10, background: 'var(--raised)' }} aria-label="Recommendation basis summary">
        {[
          ['Basis', compactBasis],
          ['Inference', isAvailabilityMove ? 'Availability may reduce coordination after a request' : boundedInference],
          ['Unknown', compactUnknown],
        ].map(([label, value]) => (
          <div key={label} style={{ flex: '1 1 170px', minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 9.5, fontWeight: 750, color: label === 'Basis' ? 'var(--semantic-observed)' : label === 'Inference' ? 'var(--semantic-intelligence)' : 'var(--semantic-context)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink)', lineHeight: 1.4, marginTop: 2 }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Your decision</span>
        <Link
          href={rec.missionType ? `/dashboard/missions?create=${rec.missionType}` : '/dashboard/missions'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors"
        >
          {actionLabel} <IconArrowRight size={12} />
        </Link>
        <button
          type="button"
          aria-expanded={reasoningOpen}
          aria-controls="priority-reasoning"
          onClick={() => setReasoningOpen(open => !open)}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2"
          style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '4px 2px', fontSize: 12, fontWeight: 650, color: 'var(--ink2)' }}
        >
          Why this? <span aria-hidden="true">{reasoningOpen ? '▾' : '▸'}</span>
        </button>
        <Link href="/dashboard/intelligence/growth-brain" style={{ fontSize: 12, color: 'var(--ink3)', textDecoration: 'none' }}>Change direction</Link>
      </div>

      {viewModel.priorityLoop && (
        <div aria-label="Recommendation measurement plan" className="grid grid-cols-1 sm:grid-cols-3" style={{ marginTop: 12, padding: '9px 11px', borderRadius: 10, background: 'var(--semantic-context-bg)', border: '1px solid var(--border)', gap: 10 }}>
          {[
            ['Watching outcome', viewModel.priorityLoop.watchingOutcome],
            ['Next review', viewModel.priorityLoop.nextReview],
            ["We'll learn", viewModel.priorityLoop.learningQuestion],
          ].map(([label, value]) => (
            <div key={label}>
              <span style={{ display: 'block', fontSize: 9, fontWeight: 800, letterSpacing: '.075em', textTransform: 'uppercase', color: label === "We'll learn" ? 'var(--semantic-intelligence)' : 'var(--semantic-context)' }}>{label}</span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 10.75, lineHeight: 1.4, color: 'var(--ink2)' }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {reasoningOpen && (
          <div id="priority-reasoning" role="region" aria-label="Why LaunchMind chose this priority" style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--border)', display: 'grid', gap: 9 }}>
            {[
              ['Founder-provided', known ?? 'Your product and current direction.'],
              ['LaunchMind infers', boundedInference],
              ['Still unknown', missingPerformance ? `${compactUnknown}. Performance is not measured.` : `The outcome until this is tested.`],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 9.5, fontWeight: 750, color: label === 'LaunchMind infers' ? 'var(--semantic-intelligence)' : label === 'Founder-provided' ? 'var(--semantic-observed)' : 'var(--semantic-context)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink2)', marginTop: 1 }}>{value}</div>
              </div>
            ))}
          </div>
      )}
    </div>
  );
}

// ── Intelligence gap banner (conditional on connection state) ─────────────────

function IntelligenceGapBanner({ token }: { token: string }) {
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  // No default source name: until coverage loads, LaunchMind has not decided which
  // source matters most, and naming one would present a guess as a decision.
  const [recName, setRecName] = useState<string | null>(null);
  const [recAvailable, setRecAvailable] = useState(false);
  const [sourceNames, setSourceNames] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    api.intelligence.coverage(token)
      .then(cov => {
        const count = cov.connections.connectedCount ?? 0;
        setConnectedCount(count);
        if (cov.recommendedSource) {
          setRecName(cov.recommendedSource.name);
          setRecAvailable(cov.recommendedSource.available);
        }
        // The Morning Brief is genuinely showing source-derived content at this
        // point, which is what the event is meant to measure — not that the page
        // loaded.
        if (count > 0) {
          trackIntelligence('morning_brief_updated_from_source', {
            signalCount: count,
            insightCount: cov.liveInsights?.length ?? 0,
          });
        }

        // Collect names of connected sources for the "briefNewIntel" card
        if (count > 0) {
          const names: string[] = [];
          const c = cov.connections;
          if (c.app_store_connect?.connected)  names.push('App Store Connect');
          if (c.revenue_cat?.connected)        names.push('RevenueCat');
          if (c.google_analytics?.connected)   names.push('Google Analytics');
          if (c.google_ads?.connected)         names.push('Google Ads');
          if (c.meta_ads?.connected)           names.push('Meta Ads');
          setSourceNames(names);
        }
      })
      .catch(() => {/* show nothing on error */});
  }, [token]);

  // While loading: render nothing
  if (connectedCount === null) return null;

  // Connected state: show green "briefNewIntel" card
  if (connectedCount > 0) {
    const displayNames = sourceNames.length > 0
      ? sourceNames.slice(0, 3).join(', ') + (sourceNames.length > 3 ? ` +${sourceNames.length - 3} more` : '')
      : `${connectedCount} source${connectedCount > 1 ? 's' : ''}`;
    return (
      <div style={{ background: '#f4fbf8', border: '1px solid var(--sage3)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--sage)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <IconCheck size={16} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>
            Growth Brain is now learning from live data
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>
            Connected: <strong style={{ color: 'var(--ink)' }}>{displayNames}</strong>. Recommendations now reflect observed performance, not estimates.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <Link href="/dashboard/intelligence/growth-brain" style={{ height: 34, padding: '0 13px', borderRadius: 10, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 12, fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            View in Growth Brain <IconArrowRight size={11} />
          </Link>
          <Link href="/dashboard/channels" style={{ height: 34, padding: '0 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Manage sources
          </Link>
        </div>
      </div>
    );
  }

  // Coverage loaded but no source is recommended yet — say nothing rather than
  // inventing a recommendation.
  if (!recName) return null;

  // No connections: show gap banner
  // ── §5 — COMPACT SECONDARY ROW, NOT A SECOND HERO ────────────────────────
  //
  // This was a full-width two-column gradient panel with an eyebrow, a Syne
  // heading, a paragraph, four benefit chips, a "why this matters now" rail and
  // its own primary green button — visually the equal of TODAY'S HIGHEST-IMPACT
  // MOVE, and placed directly beside it. A brief with two things that both look
  // like the most important thing has no most important thing.
  //
  // Every capability is preserved: same destination, same honesty about
  // availability, same explanation. It is one row instead of a panel, and its
  // action is a link rather than a filled button, so the hierarchy reads.
  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      padding: '4px 2px 12px', marginBottom: 16,
      display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.1em',
          textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 4px' }}>
          What would make this stronger
        </p>
        <p style={{ margin: 0, color: 'var(--ink)', lineHeight: 1.5, fontSize: 13 }}>
          {recAvailable
            ? `Connect ${recName} so LaunchMind can distinguish observed performance from assumptions.`
            : `${recName} would add observed performance, but it is not available to connect yet.`}
        </p>
      </div>
      <Link href="/dashboard/channels" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 34,
        padding: '0 12px', borderRadius: 10, border: '1px solid var(--border2)',
        background: 'var(--surface)', color: 'var(--ink)', fontSize: 12,
        fontWeight: 650, textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
        Preview what {recName} unlocks <IconArrowRight size={12} />
      </Link>
    </div>
  );
}

// ── Content Opportunity (Phase 3.5B5) ─────────────────────────────────────────
//
// ADDITIVE. This sits between today's recommendation and Growth opportunities;
// it replaces neither, and it replaces Awaiting your approval even less.
//
// It renders ONLY when LaunchMind actually has a content opportunity. There is
// no placeholder and no manufactured urgency: a newly onboarded product with
// nothing to say shows nothing here, which is the honest answer and keeps the
// dashboard free of permanent noise.

function ContentOpportunityCard({ ci, onFeatured }: {
  ci: ContentIntelligenceView | null;
  /** Reports which opportunity is featured, so the list below can exclude it. */
  onFeatured?: (id: string | null) => void;
}) {
  // Report the featured opportunity by id so the list below can exclude it.
  useEffect(() => {
    onFeatured?.(ci?.state === 'HAS_OPPORTUNITY' ? (ci.opportunity?.id ?? null) : null);
  }, [ci, onFeatured]);

  if (!ci || ci.state !== 'HAS_OPPORTUNITY' || !ci.opportunity) return null;
  const o = ci.opportunity;
  const pkg = ci.campaign?.package ?? [];
  const ready = pkg.filter(i => i.state === 'READY_TO_GENERATE').length;
  /** Has this recommendation already produced content? Measured, not assumed. */
  const made = (ci.created?.total ?? 0) > 0;
  const firstAttention = ci.created?.concepts.find(c => c.status === 'NEEDS_ATTENTION') ?? null;
  const packageAction = pkg.find(i => i.ownerAction)?.ownerAction ?? null;
  const rawNeedsYou = firstAttention?.attentionReason ?? packageAction?.label ?? null;
  const needsYou = rawNeedsYou?.toLowerCase().includes('claim')
    ? 'LaunchMind found wording it cannot verify from your current product evidence.'
    : rawNeedsYou;
  const reviewLabel = firstAttention?.attentionReason?.toLowerCase().includes('claim')
    ? 'Review wording'
    : packageAction?.label ?? (ci.created?.ready ? 'Review concepts' : 'Review creative');
  const compactCreativeTitle = o.title.includes(':')
    ? o.title.split(':').slice(1).join(':').trim().replace(/^The\s+/i, '')
    : o.title;

  return (
    <section aria-labelledby="brief-content-opp">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium">
          {/* §15 — STATE-AWARE, not a redesign. The brief kept saying "content
              opportunity" and "review content opportunity" after the content
              existed, so an owner who had already created three concepts was
              invited to consider creating them. Same card, same place, same
              size; only the words follow reality. */}
          {made
            ? ci.created!.needsAttention > 0 ? `Needs you · ${ci.created!.needsAttention}`
              : ci.created!.ready > 0 ? 'Ready for your review'
              : 'Creative status'
            : 'Content opportunity'}
        </p>
        <Link href={made && ci?.created?.campaignId
            ? `/dashboard/content?campaign=${ci.created.campaignId}`
            : '/dashboard/intelligence/content'}
          className="text-[12px] text-sage hover:underline flex items-center gap-1">
          {made
            ? reviewLabel
            : 'Review content opportunity'}
          <IconArrowRight size={11} />
        </Link>
      </div>

      <div style={{
        background: made ? 'var(--raised)' : 'var(--surface)',
        border: `1px solid ${made && ci.created!.needsAttention > 0 ? '#e6b86e' : made ? 'var(--border)' : 'var(--sage-b)'}`,
        boxShadow: made && ci.created!.needsAttention > 0 ? 'inset 3px 0 0 #d99a35' : 'none',
        borderRadius: made ? 10 : 14, padding: made ? '11px 13px 11px 16px' : 16,
      }}>
        {!made && <p style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--sage)', margin: 0 }}>
          {o.origin}
        </p>}
        <h2 id="brief-content-opp" style={{ fontFamily: 'var(--font-syne)', fontSize: 17,
          fontWeight: 700, lineHeight: 1.3, margin: made ? '0 0 9px' : '6px 0 10px', color: 'var(--ink)' }}>
          {made ? compactCreativeTitle : o.title}
        </h2>

        {/* ONE narrative line, then compact metadata. Three dense columns of
            Why-now / Who / Message made the brief carry the whole campaign
            architecture; that detail belongs in Content Intelligence, which is
            one click away. The brief only has to make the owner want to click. */}
        {!made && <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.55, margin: '0 0 12px' }}>
          {o.message}
        </p>}

        {/* TWO FACTS. "Who" and "Why" were true, useful, and already the first
            thing Content Intelligence shows — repeating them here made the
            brief a smaller copy of that page rather than a pointer to it. What
            the brief uniquely has to answer is "is this worth my attention",
            and for that the owner needs to know what would be made and whether
            it is waiting on them. */}
        {made ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {ci.created!.needsAttention === 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink2)' }}>{ci.created!.ready} concept{ci.created!.ready === 1 ? '' : 's'} ready for review</div>
            )}
            {ci.created!.needsAttention > 0 && needsYou && (
              <div style={{ minWidth: 180, flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>{needsYou}</div>
              </div>
            )}
            {ci.created!.needsAttention > 0 && (
              <div style={{ flexBasis: '100%', paddingTop: 7, borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--ink3)' }}>
                Nothing publishes without your approval.
              </div>
            )}
          </div>
        ) : (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {([['Create', pkg.length > 0
               ? pkg.map(i => {
                   const name = CHANNEL_LABEL_BRIEF[i.channel] ?? i.channel;
                   return `${i.quantity} ${i.quantity === 1 ? name : `${name}s`}`;
                 }).join(', ')
               : null],
             ['Needs you', pkg.length > ready
               ? `${pkg.length - ready} item${pkg.length - ready === 1 ? '' : 's'}` : null],
            ] as const)
            .filter(([, val]) => !!val)
            .map(([k, val]) => (
              <div key={k} style={{ minWidth: 96 }}>
                <div style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.08em',
                  textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.45 }}>{val}</div>
              </div>
            ))}
        </div>
        )}
      </div>
    </section>
  );
}


/** Owner-facing channel names. The backend enum never reaches the screen. */
const CHANNEL_LABEL_BRIEF: Record<string, string> = {
  GOOGLE_RSA: 'Google Ads', META_AD: 'Meta', LANDING_PAGE: 'Landing page',
  LINKEDIN_POST: 'LinkedIn', SHORT_FORM_VIDEO_SCRIPT: 'Short video',
};

// ── Since your last visit ─────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000), hours = Math.floor(diff / 3_600_000), days = Math.floor(diff / 86_400_000);
  if (mins < 2) return 'just now';
  if (hours < 1) return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}
const LAST_VISIT_KEY = 'lm_last_brief_visit';

function SinceCard({ data, ci, viewModel }: {
  data: BriefResponse; ci: ContentIntelligenceView | null; viewModel: MorningBriefViewModel;
}) {
  const [sinceLabel, setSinceLabel] = useState('');
  const [previousVisit, setPreviousVisit] = useState<number | null>(null);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const sinceCardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = localStorage.getItem(LAST_VISIT_KEY);
    setPreviousVisit(prev ? Number(prev) : null);
    setSinceLabel(prev ? timeAgo(Number(prev)) : 'first visit');
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  }, []);
  const recentActivity = previousVisit
    ? data.recentTimeline.filter(e => new Date(e.time).getTime() > previousVisit).length
    : data.recentTimeline.length;
  const marketSignals = data.marketIntelligence?.observations.filter(o =>
    !previousVisit || (o.observedAt != null && new Date(o.observedAt).getTime() > previousVisit)).length ?? 0;
  const changedCreative = ci?.created?.concepts.filter(c =>
    !previousVisit || (c.updatedAt != null && new Date(c.updatedAt).getTime() > previousVisit)).length ?? 0;
  const demoActivity = viewModel.performanceSource === 'DEMO' ? viewModel.activity : null;
  const creativeHref = ci?.created?.campaignId ? `/dashboard/content?campaign=${ci.created.campaignId}` : '/dashboard/content';
  const needsCount = demoActivity?.decisionsWaiting
    ?? ((ci?.created?.needsAttention ?? 0) > 0 ? ci!.created!.needsAttention : data.pendingApprovals.total);
  const needsHref = (ci?.created?.needsAttention ?? 0) > 0 || demoActivity?.decisionsWaiting
    ? creativeHref
    : data.pendingApprovals.total > 0 ? '/dashboard/approvals' : null;
  const updateItems = demoActivity
    ? [
        { label: `${demoActivity.marketSignals} market signal detected`, href: '/dashboard/intelligence/market' },
        { label: `${demoActivity.creativesPrepared} creatives prepared`, href: creativeHref },
        { label: `${demoActivity.decisionsWaiting} owner decision waiting`, href: needsHref },
      ]
    : [
        ...(marketSignals > 0 ? [{ label: `${marketSignals} market signal${marketSignals === 1 ? '' : 's'} detected`, href: '/dashboard/intelligence/market' }] : []),
        ...(changedCreative > 0 ? [{ label: `${changedCreative} creative${changedCreative === 1 ? '' : 's'} prepared`, href: creativeHref }] : []),
        ...(recentActivity > 0 ? [{ label: `${recentActivity} meaningful activity update${recentActivity === 1 ? '' : 's'}`, href: null }] : []),
      ];
  const meaningfulUpdates = demoActivity
    ? demoActivity.marketSignals + demoActivity.creativesPrepared + demoActivity.decisionsWaiting
    : marketSignals + changedCreative + recentActivity;
  const interactionClass = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2 hover:text-sage';
  const activityHref = (category: MorningBriefViewModel['activityTimeline'][number]['category']): string | null => {
    if (category === 'PERFORMANCE') return '#growth-pulse-heading';
    if (category === 'MARKET') return '/dashboard/intelligence/market';
    if (category === 'DIRECTION') return '/dashboard/intelligence/growth-brain';
    if (category === 'CREATIVE') return creativeHref;
    if (category === 'OWNER') return needsHref;
    return null;
  };
  const activityColor = (category: MorningBriefViewModel['activityTimeline'][number]['category']): string => {
    if (category === 'OWNER') return 'var(--semantic-attention)';
    if (category === 'MARKET' || category === 'DIRECTION') return 'var(--semantic-intelligence)';
    if (category === 'PERFORMANCE' || category === 'CREATIVE') return 'var(--semantic-observed)';
    return 'var(--semantic-context)';
  };
  const toggleUpdates = (event: ReactMouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    setUpdatesOpen(open => !open);
  };
  useEffect(() => {
    if (!updatesOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!sinceCardRef.current?.contains(event.target as Node)) setUpdatesOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setUpdatesOpen(false);
      returnFocusRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [updatesOpen]);
  return (
    <div ref={sinceCardRef} className="relative w-full lg:w-auto lg:min-w-[290px]" style={{ flexShrink: 0 }}>
      <div style={{ padding: '9px 13px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(19,45,37,.03)' }}>
        <b style={{ display: 'block', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 800, color: 'var(--ink3)' }}>Since your last visit</b>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {meaningfulUpdates > 0 ? (
            <button type="button" aria-expanded={updatesOpen} aria-controls="since-last-visit-updates" onClick={toggleUpdates} className={interactionClass} style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 750, color: 'var(--ink)' }}>{meaningfulUpdates} meaningful updates</button>
          ) : <strong style={{ fontSize: 12, color: 'var(--ink2)' }}>No material changes</strong>}
          {needsCount > 0 && needsHref && <Link href={needsHref} className={interactionClass} style={{ fontSize: 11, fontWeight: 750, color: 'var(--semantic-attention)', textDecoration: 'none' }}>{needsCount} needs you</Link>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--ink3)' }}>Reviewed {sinceLabel || 'just now'}</span>
          {updateItems.length > 0 && <button type="button" aria-expanded={updatesOpen} aria-controls="since-last-visit-updates" onClick={toggleUpdates} className={interactionClass} style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer', fontSize: 10.5, color: 'var(--sage)', fontWeight: 650 }}>See updates {updatesOpen ? '↑' : '→'}</button>}
        </div>
      </div>
      {updatesOpen && updateItems.length > 0 && (
        <div id="since-last-visit-updates" role="region" aria-label="Updates since your last visit" className="absolute left-0 right-0 z-30 mt-2 lg:left-auto lg:right-0 lg:w-[430px]" style={{ display: 'grid', gap: 8, maxWidth: 'calc(100vw - 32px)', padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border2)', boxShadow: '0 16px 36px rgba(19,45,37,.16)' }}>
          {viewModel.activityTimeline.length > 0 ? (
            <>
              <div>
                <span style={{ display: 'block', fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--semantic-intelligence)' }}>While you were away</span>
                {viewModel.performanceSource === 'DEMO' && <span style={{ display: 'block', marginTop: 2, fontSize: 9.5, color: 'var(--semantic-context)' }}>Seeded development activity</span>}
              </div>
              {viewModel.activityTimeline.map((event, index) => {
                const href = activityHref(event.category);
                const content = <><span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 4, width: 8, height: 8, borderRadius: 999, background: activityColor(event.category), boxShadow: '0 0 0 3px var(--surface)' }} />{index < viewModel.activityTimeline.length - 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 3, top: 15, bottom: -12, width: 1, background: 'var(--border2)' }} />}<time style={{ display: 'block', fontSize: 9, fontWeight: 650, textTransform: 'uppercase', color: 'var(--semantic-context)' }}>{event.timeLabel}</time><span style={{ display: 'block', marginTop: 1, fontSize: 11, fontWeight: 600, lineHeight: 1.4, color: 'var(--ink)' }}>{event.summary}{href ? ' →' : ''}</span></>;
                return href
                  ? <Link key={event.id} href={href} className={interactionClass} style={{ position: 'relative', display: 'block', marginLeft: 3, paddingLeft: 18, textDecoration: 'none' }}>{content}</Link>
                  : <div key={event.id} style={{ position: 'relative', marginLeft: 3, paddingLeft: 18 }}>{content}</div>;
              })}
            </>
          ) : updateItems.map(item => item.href
            ? <Link key={item.label} href={item.href} className={interactionClass} style={{ fontSize: 10.5, color: 'var(--ink2)', textDecoration: 'none' }}>{item.label} →</Link>
            : <span key={item.label} style={{ fontSize: 10.5, color: 'var(--ink2)' }}>{item.label}</span>)}
        </div>
      )}
    </div>
  );
}

function TodayWorkload({ data, ci, viewModel }: {
  data: BriefResponse; ci: ContentIntelligenceView | null; viewModel: MorningBriefViewModel;
}) {
  const items: Array<{ label: string; href: string }> = [];
  const demoActivity = viewModel.performanceSource === 'DEMO' ? viewModel.activity : null;
  const creativeHref = ci?.created?.campaignId ? `/dashboard/content?campaign=${ci.created.campaignId}` : '/dashboard/content';
  if (demoActivity) {
    if (demoActivity.decisionsWaiting > 0) items.push({ label: `${demoActivity.decisionsWaiting} decision`, href: '#todays-priority' });
    if (demoActivity.creativesNeedingReview > 0) items.push({ label: `${demoActivity.creativesNeedingReview} creative needs review`, href: creativeHref });
    if (demoActivity.additionalOpportunities > 0) items.push({ label: `${demoActivity.additionalOpportunities} opportunities on radar`, href: '/dashboard/opportunities' });
  } else if (data.recommendation) items.push({ label: '1 decision', href: '#todays-priority' });
  if (!demoActivity && data.pendingApprovals.total > 0) {
    items.push({ label: `${data.pendingApprovals.total} approval${data.pendingApprovals.total === 1 ? '' : 's'} waiting`, href: '/dashboard/approvals' });
  }
  if (!demoActivity && (ci?.created?.needsAttention ?? 0) > 0) {
    const count = ci!.created!.needsAttention;
    items.push({ label: `${count} creative${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} review`, href: creativeHref });
  } else if (!demoActivity && (ci?.created?.ready ?? 0) > 0) {
    const count = ci!.created!.ready;
    items.push({ label: `${count} creative${count === 1 ? '' : 's'} ready`, href: creativeHref });
  }
  const linkClass = 'rounded-sm text-ink hover:text-sage focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '5px 9px', borderRadius: 8, background: 'var(--raised)', border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--sage)' }}>Today</span>
      {items.length > 0 ? items.map((item, index) => (
        <span key={`${item.label}-${item.href}`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
          {index > 0 && <span aria-hidden="true" style={{ color: 'var(--ink3)' }}>·</span>}
          <Link href={item.href} className={linkClass} style={{ fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>{item.label}</Link>
        </span>
      )) : <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 700 }}>Nothing needs your attention</span>}
    </div>
  );
}

function metricValue(metric: MorningBriefMetric): string {
  if (metric.unit === 'currency') return `$${metric.value.toLocaleString()}`;
  if (metric.unit === 'percent') return `${metric.value.toLocaleString()}%`;
  return metric.value.toLocaleString();
}

function metricDelta(metric: MorningBriefMetric): string | null {
  if (metric.previousValue == null || metric.deltaKind == null) return null;
  const raw = metric.value - metric.previousValue;
  const direction = raw >= 0 ? '↑' : '↓';
  if (metric.deltaKind === 'point-change') return `${direction} ${Math.abs(raw).toFixed(1)} pts`;
  if (metric.deltaKind === 'absolute-change') return `${direction} $${Math.abs(raw).toLocaleString()}`;
  const percent = metric.previousValue === 0 ? null : raw / metric.previousValue * 100;
  return percent == null ? null : `${direction} ${Math.abs(percent).toFixed(1)}%`;
}

function PerformanceCoverage({ token, source }: { token: string; source: MorningBriefViewModel['performanceSource'] }) {
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  useEffect(() => {
    if (!token || source !== 'REAL') return;
    let alive = true;
    api.intelligence.coverage(token)
      .then(coverage => { if (alive) setConnectedCount(coverage.connections.connectedCount); })
      .catch(() => { if (alive) setConnectedCount(null); });
    return () => { alive = false; };
  }, [token, source]);

  if (source === 'DEMO') {
    return <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>Coverage: development fixture · live sources not represented</span>;
  }
  if (source !== 'REAL' || connectedCount == null) return null;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--ink3)' }}>Performance coverage: {connectedCount} source{connectedCount === 1 ? '' : 's'} connected <Link href="/dashboard/channels" className="text-sage hover:underline">Review data sources →</Link></span>;
}

function GrowthPulse({ viewModel, token }: { viewModel: MorningBriefViewModel; token: string }) {
  const { goal, performanceSource, metrics, interpretation, freshness } = viewModel;
  const hasPerformance = performanceSource !== 'UNAVAILABLE';

  return (
    <section aria-labelledby="growth-pulse-heading" style={{ padding: '17px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(19,45,37,.035)' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 id="growth-pulse-heading" style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 6px' }}>Monthly booking goal</h2>
          {goal?.actual != null && goal.progress != null ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <strong style={{ fontFamily: 'Syne,sans-serif', fontSize: 29, lineHeight: 1, letterSpacing: '-.025em', color: 'var(--ink)' }}>{goal.actual} / {goal.target}</strong>
                <strong style={{ fontSize: 16, color: 'var(--sage)' }}>{goal.progress.toFixed(0)}%</strong>
              </div>
              <div role="progressbar" aria-label="Monthly booking goal progress" aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={goal.actual}
                style={{ width: 'min(360px,100%)', height: 7, borderRadius: 999, background: 'var(--raised)', overflow: 'hidden', marginTop: 9 }}>
                <div style={{ width: `${Math.min(100, goal.progress)}%`, height: '100%', borderRadius: 999, background: 'var(--sage)' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{goal.remaining} remaining{goal.daysRemaining != null ? ` · ${goal.daysRemaining} days left` : ''}</span>
                {goal.pace && <strong style={{ display: 'inline-flex', padding: '3px 7px', borderRadius: 999, background: goal.pace.status === 'BEHIND' ? '#fff4df' : 'var(--sage2)', border: `1px solid ${goal.pace.status === 'BEHIND' ? '#efd4a8' : 'var(--sage3)'}`, fontSize: 10, letterSpacing: '.065em', textTransform: 'uppercase', color: goal.pace.status === 'BEHIND' ? '#8a4f08' : 'var(--sage)' }}>{goal.pace.status === 'ON_PACE' ? 'On pace' : `${goal.pace.status === 'AHEAD' ? 'Ahead of pace' : 'Behind pace'}${goal.pace.delta != null ? ` by ${goal.pace.delta} booking${goal.pace.delta === 1 ? '' : 's'}` : ''}`}</strong>}
              </div>
            </div>
          ) : (
            <div>
              <strong style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, color: 'var(--ink)' }}>{goal ? `${goal.target.toLocaleString()} ${goal.metric}` : 'Goal not set'}</strong>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>Performance not measured</span>
            </div>
          )}
        </div>
        <Link href={performanceSource === 'REAL' ? '/dashboard/results' : '/dashboard/channels'} className="text-[12px] text-sage hover:underline">
          {performanceSource === 'REAL' ? 'View results' : performanceSource === 'DEMO' ? 'Review data sources' : 'Connect performance data'} →
        </Link>
      </div>
      {metrics.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 6px' }}>Business pulse</p>
          <div className="grid grid-cols-2 lg:grid-cols-4" style={{ border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', background: 'var(--raised)' }}>
          {metrics.map((metric, index) => {
            const delta = metricDelta(metric);
            const worse = (metric.key === 'conversion' && (metric.value - (metric.previousValue ?? metric.value)) < 0)
              || (metric.key === 'cost-per-booking' && (metric.value - (metric.previousValue ?? metric.value)) > 0);
            return (
              <div key={metric.key} style={{ padding: '11px 12px', background: 'transparent', borderLeft: index % 2 === 1 ? '1px solid var(--border)' : 0, borderTop: index > 1 ? '1px solid var(--border)' : 0 }} className="lg:!border-t-0 lg:[&:not(:first-child)]:!border-l">
                <strong style={{ display: 'block', fontFamily: 'Syne,sans-serif', fontSize: 20, lineHeight: 1.1, letterSpacing: '-.02em', color: 'var(--ink)' }}>{metricValue(metric)}</strong>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink3)', marginTop: 1 }}>{metric.label}</span>
                {delta && <span aria-label={`${metric.label} changed ${delta.replace('↑', 'up').replace('↓', 'down')}`} style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: worse ? '#9a5a0a' : 'var(--sage)', marginTop: 3 }}>{delta}</span>}
              </div>
            );
          })}
          </div>
        </div>
      )}
      <div style={{ marginTop: 13, padding: '11px 12px 12px', borderLeft: '3px solid var(--violet)', background: '#f8f7ff', borderRadius: '0 9px 9px 0' }}>
        <p style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--violet)', margin: 0 }}>LaunchMind sees</p>
        <p style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5, margin: '4px 0 0' }}>{interpretation.summary}</p>
        {interpretation.judgment && <p style={{ fontFamily: 'Syne,sans-serif', fontSize: 17, fontWeight: 750, color: 'var(--ink)', lineHeight: 1.3, letterSpacing: '-.01em', margin: '6px 0 0' }}>{interpretation.judgment}</p>}
        {metrics.length === 4 && <span style={{ display: 'block', fontSize: 9.5, color: 'var(--ink3)', marginTop: 5 }}>Based on 4 current performance signals</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 9 }}>
        {freshness && <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>{freshness}</span>}
        {performanceSource === 'DEMO' && <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: 999, border: '1px solid var(--border2)', color: 'var(--ink3)', fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Demo performance data</span>}
        <PerformanceCoverage token={token} source={performanceSource} />
      </div>
    </section>
  );
}

function LastExperiment({ viewModel }: { viewModel: MorningBriefViewModel }) {
  const experiment = viewModel.lastExperiment;
  if (!experiment) return null;
  return (
    <section aria-labelledby="last-experiment-heading" style={{ padding: '11px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <h2 id="last-experiment-heading" style={{ margin: 0, fontSize: 10, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Last experiment</h2>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 5 }}>
        <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{experiment.name}</strong>
        <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{experiment.metric} <strong style={{ fontFamily: 'Syne,sans-serif', fontSize: 14, color: 'var(--sage)' }}>+{experiment.delta}%</strong></span>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--ink2)' }}>{experiment.summary}</p>
      {experiment.learned && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span style={{ display: 'block', fontSize: 10, fontWeight: 850, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--violet)' }}>LaunchMind learned</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45, marginTop: 2 }}>{experiment.learned}</span>
        </div>
      )}
      <Link href="/dashboard/experiments" style={{ display: 'inline-flex', marginTop: 6, fontSize: 11.5, color: 'var(--sage)', textDecoration: 'none' }}>Review result →</Link>
    </section>
  );
}

function AskAiCmo({ data, viewModel, token }: {
  data: BriefResponse; viewModel: MorningBriefViewModel; token: string;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [askState, setAskState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const prompts = [
    'Why this priority?',
    ...(viewModel.metrics.some(metric => metric.key === 'conversion') ? ['Why is conversion down?'] : []),
    ...(viewModel.goal?.pace?.status === 'BEHIND'
      ? ['How do I get back on pace?']
      : viewModel.goal ? [`How do I reach ${viewModel.goal.target} ${viewModel.goal.metric}?`] : ['What should I understand next?']),
  ];

  const ask = async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || !token || askState === 'loading') return;
    setQuestion(trimmed);
    setAnswer(null);
    setAskState('loading');
    try {
      // owner.ask builds the governed owner/product context package server-side.
      // Passing the active product keeps this Morning Brief conversation scoped;
      // the owner never has to restate their product or briefing context.
      const response = await api.owner.ask(trimmed, token, data.product?.id);
      setAnswer(response.answer.summary);
      setAskState('idle');
    } catch {
      setAskState('failed');
    }
  };

  return (
    <section aria-labelledby="rail-ask" style={{ padding: '10px', marginTop: 6, borderRadius: 10, background: '#f8f7ff', border: '1px solid #e8e3ff' }}>
      <h3 id="rail-ask" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--violet)', margin: 0 }}>Ask your AI CMO</h3>
      <p style={{ fontSize: 11, fontWeight: 650, color: 'var(--ink2)', lineHeight: 1.4, margin: '4px 0 2px' }}>What do you want to understand?</p>
      <p style={{ fontSize: 10, color: 'var(--ink3)', lineHeight: 1.3, margin: '0 0 6px' }}>Ask why something changed or challenge today&apos;s recommendation. Your governed brief context is included.</p>
      <form onSubmit={event => { event.preventDefault(); void ask(question); }} style={{ display: 'flex', gap: 6 }}>
        <label htmlFor="brief-ai-cmo-question" className="sr-only">Ask about today&apos;s brief</label>
        <input
          id="brief-ai-cmo-question"
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder="Ask anything about today's brief..."
          style={{ minWidth: 0, flex: 1, height: 34, padding: '0 9px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 11.5 }}
        />
        <button type="submit" disabled={!question.trim() || askState === 'loading' || !token} className="px-3 bg-sage text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-40 hover:bg-[#047857] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage">
          {askState === 'loading' ? 'Asking…' : 'Ask'}
        </button>
      </form>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }} aria-label="Suggested questions">
        {prompts.map(prompt => (
          <button key={prompt} type="button" onClick={() => void ask(prompt)} className="text-[10px] text-ink2 bg-raised border border-[var(--border)] rounded-full px-2 py-1 hover:text-sage hover:border-[var(--sage-b)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage">
            {prompt}
          </button>
        ))}
      </div>
      {answer && <p aria-live="polite" style={{ margin: '8px 0 0', padding: 8, borderRadius: 8, background: 'var(--raised)', color: 'var(--ink2)', fontSize: 11, lineHeight: 1.45 }}>{answer}</p>}
      {askState === 'failed' && <p role="status" style={{ margin: '7px 0 0', color: '#9a5a0a', fontSize: 10.5 }}>LaunchMind can&apos;t answer right now. Your brief is still available.</p>}
    </section>
  );
}

function AiCmoRail({ data, viewModel, featuredOpportunityId, contentIntelligence, token }: {
  data: BriefResponse;
  viewModel: MorningBriefViewModel;
  featuredOpportunityId: string | null;
  contentIntelligence: ContentIntelligenceView | null;
  token: string;
}) {
  const watched = data.opportunities.filter(o => o.id !== featuredOpportunityId).slice(0, 2);
  // The current persisted rows use the broad `general` enum, but these specific
  // objects are content concepts (reels/challenges/short-form ideas), not
  // strategic growth opportunities. Classify from their owner-facing substance
  // until the backend gains a narrower content-opportunity type.
  const contentOpportunities = watched.length > 0 && watched.every(o =>
    /content|creative|reel|short[ -]form|relatable moment|challenge/i
      .test(`${o.title} ${o.description ?? ''}`));
  const signalCount = viewModel.activity?.marketSignals
    ?? data.marketIntelligence?.observations.length
    ?? 0;
  const direction = data.phase1?.direction?.headline
    ?? (data.growthBrain.hasStrategy ? 'Your current direction is active.' : null);
  const creativeNeedingAttention = contentIntelligence?.created?.concepts.find(concept => concept.status === 'NEEDS_ATTENTION') ?? null;
  const creativeOwnerTitle = contentIntelligence?.opportunity?.title.includes(':')
    ? contentIntelligence.opportunity.title.split(':').slice(1).join(':').trim().replace(/^The\s+/i, '')
    : contentIntelligence?.opportunity?.title ?? creativeNeedingAttention?.name ?? 'creative';
  const creativeReviewHref = contentIntelligence?.created?.campaignId
    ? `/dashboard/content?campaign=${contentIntelligence.created.campaignId}`
    : '/dashboard/content';
  const ownerNeedCount = creativeNeedingAttention ? 1 : data.pendingApprovals.total;
  const workingItems = viewModel.activity
    ? [
        `${viewModel.activity.creativesPrepared} creatives prepared`,
        `${viewModel.activity.additionalOpportunities} opportunities being evaluated`,
      ]
    : [
        ...(contentIntelligence?.created?.total ? [`${contentIntelligence.created.total} creative${contentIntelligence.created.total === 1 ? '' : 's'} prepared`] : []),
        ...(watched.length ? [`${watched.length} opportunit${watched.length === 1 ? 'y' : 'ies'} being evaluated`] : []),
      ];
  const watchMetrics = viewModel.metrics
    .filter(metric => metric.previousValue != null && ['conversion', 'cost-per-booking'].includes(metric.key))
    .slice(0, 2);
  const activityLabel = viewModel.performanceSource === 'DEMO'
    ? 'Seeded development snapshot'
    : viewModel.freshness
      ? viewModel.freshness
      : 'Brief reviewed · Performance not measured';
  const isActive = viewModel.performanceSource === 'DEMO' || Boolean(viewModel.freshness);
  const railDirection = viewModel.performanceSource === 'DEMO' && viewModel.interpretation.judgment
    ? viewModel.interpretation.judgment
    : direction;
  const opportunityPresentation = (title: string) => {
    if (/why is no one available/i.test(title)) return { title: 'Availability frustration', detail: 'Relatable short-form concept' };
    if (/one app vs\. five phone calls/i.test(title)) return { title: 'One app vs. phone calls', detail: 'Product comparison concept' };
    return { title: title.split(':')[0].replace(/^The\s+/i, ''), detail: 'Content concept' };
  };

  const moduleStyle = { padding: '9px 7px', borderBottom: '1px solid var(--border)' } as const;
  const eyebrowStyle = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: 'var(--ink3)', margin: 0 };
  const linkClass = 'text-[11.5px] text-sage hover:underline';

  return (
    <aside aria-labelledby="ai-cmo-rail-heading" className="xl:h-full" style={{ padding: '0 4px' }}>
      <div data-ai-cmo-sticky className="xl:sticky xl:top-4 xl:z-[1]" style={{ background: 'var(--page)', paddingBottom: 6 }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
      <div className="sm:col-span-2" style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', borderRadius: 9, background: 'var(--raised)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2 id="ai-cmo-rail-heading" style={{ ...eyebrowStyle, fontSize: 10.5, color: 'var(--ink)' }}>Your AI CMO</h2>
          {isActive && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 750, color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.06em' }}><span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} /> Active</span>}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--ink3)', margin: '5px 0 0' }}>{activityLabel}</p>
      </div>

      {ownerNeedCount > 0 ? (
        <section aria-labelledby="rail-needs-owner" className="sm:col-span-2" style={{ ...moduleStyle, padding: '12px 10px', border: '1px solid #efd4a8', background: '#fffaf2', borderRadius: 9, marginTop: 7 }}>
          <h3 id="rail-needs-owner" style={{ ...eyebrowStyle, fontSize: 10.5, color: '#8a4f08' }}>I need from you · {ownerNeedCount}</h3>
          {creativeNeedingAttention ? (
            <>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--semantic-attention)', marginTop: 5 }}>Creative wording review</span>
              <strong style={{ display: 'block', fontSize: 11.5, color: 'var(--ink)', marginTop: 2 }}>{creativeOwnerTitle}</strong>
              <Link href={creativeReviewHref} className={linkClass} style={{ display: 'inline-flex', marginTop: 5 }}>Review →</Link>
            </>
          ) : (
            <>
              <strong style={{ display: 'block', fontSize: 11.5, color: 'var(--ink)', marginTop: 6 }}>{data.pendingApprovals.items[0]?.title ?? 'Review pending approvals'}</strong>
              <Link href="/dashboard/approvals" className={linkClass} style={{ display: 'inline-flex', marginTop: 6 }}>Review →</Link>
            </>
          )}
        </section>
      ) : (
        <section aria-labelledby="rail-needs-owner" className="sm:col-span-2" style={moduleStyle}>
          <h3 id="rail-needs-owner" style={eyebrowStyle}>I need from you</h3>
          <p style={{ fontSize: 11.5, color: 'var(--ink2)', margin: '5px 0 0' }}>Nothing needs your decision right now.</p>
        </section>
      )}

      {watchMetrics.length > 0 && (
        <section aria-labelledby="rail-monitoring" className="sm:col-span-2" style={moduleStyle}>
          <h3 id="rail-monitoring" style={{ ...eyebrowStyle, fontSize: 10, color: 'var(--ink2)' }}>I&apos;m watching</h3>
          <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>
            {watchMetrics.map(metric => (
              <div key={metric.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, fontSize: 11.5 }}>
                <span style={{ color: 'var(--ink2)' }}>{metric.label}</span>
                <span style={{ textAlign: 'right' }}>
                  <strong style={{ display: 'block', fontFamily: 'Syne,sans-serif', fontSize: 12.5, color: 'var(--ink)' }}>{metricValue(metric)} <span style={{ color: '#9a5a0a' }}>{metricDelta(metric)}</span></strong>
                  {metric.watchStatus && <small style={{ display: 'block', color: '#9a5a0a', fontSize: 9.5, marginTop: 1 }}>{metric.watchStatus}</small>}
                </span>
              </div>
            ))}
            {signalCount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5 }}><span style={{ color: 'var(--ink2)' }}>Market signals</span><strong style={{ color: 'var(--ink)' }}>{signalCount} new</strong></div>}
          </div>
          {viewModel.lastExperiment?.connectionToPriority && (
            <details style={{ marginTop: 7 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--sage)', fontSize: 10.5, fontWeight: 650 }}>Why this matters →</summary>
              <p style={{ color: 'var(--semantic-context)', fontSize: 10.5, lineHeight: 1.4, margin: '5px 0 0' }}>Conversion and cost are the two current signals most relevant to today&apos;s priority.</p>
            </details>
          )}
        </section>
      )}

      {railDirection && (
        <section aria-labelledby="rail-direction" className="sm:col-span-2" style={moduleStyle}>
          <h3 id="rail-direction" style={{ ...eyebrowStyle, fontSize: 10, color: 'var(--ink2)' }}>Current direction</h3>
          <p style={{ fontFamily: 'Syne,sans-serif', fontSize: 13, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.35, margin: '5px 0 4px' }}>{railDirection}</p>
          {viewModel.performanceSource === 'DEMO' && (
            <p style={{ fontSize: 10.5, color: 'var(--ink3)', lineHeight: 1.4, margin: '0 0 6px' }}>Seeded review of {viewModel.metrics.length} fixture signals. Today&apos;s market signal did not override current performance evidence.</p>
          )}
          {viewModel.performanceSource === 'REAL' && viewModel.freshness && viewModel.metrics.length > 0 && (
            <p style={{ fontSize: 9.5, color: 'var(--semantic-context)', lineHeight: 1.35, margin: '0 0 6px' }}>{viewModel.freshness} · {viewModel.metrics.length} current signals</p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/dashboard/intelligence/growth-brain" className={linkClass}>View Growth Brain →</Link>
            {signalCount > 0 && <Link href="/dashboard/intelligence/market" className={linkClass}>View signal →</Link>}
          </div>
        </section>
      )}

      </div>
      {token && <AskAiCmo data={data} viewModel={viewModel} token={token} />}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">

      {workingItems.length > 0 && (
        <section aria-labelledby="rail-working" style={moduleStyle}>
          <h3 id="rail-working" style={eyebrowStyle}>I&apos;m working on</h3>
          {workingItems.map(item => <p key={item} style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4, margin: '5px 0 0' }}>{item}</p>)}
        </section>
      )}

      {viewModel.noActionNeeded && (
        <section aria-labelledby="rail-no-action" style={moduleStyle}>
          <h3 id="rail-no-action" style={{ ...eyebrowStyle, color: 'var(--sage)' }}>No action needed</h3>
          <strong style={{ display: 'block', fontSize: 12, color: 'var(--ink)', marginTop: 5 }}>{viewModel.noActionNeeded.area}</strong>
          <p style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45, margin: '3px 0 0' }}>{viewModel.noActionNeeded.summary}</p>
        </section>
      )}

      <section aria-labelledby="rail-memory" style={moduleStyle}>
        <h3 id="rail-memory" style={eyebrowStyle}>Memory</h3>
        <p style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45, margin: '5px 0 6px' }}>{data.memories.length > 0 ? `${data.memories.length} relevant learning${data.memories.length === 1 ? '' : 's'} available.` : 'No durable learning has been added yet.'}</p>
        <Link href="/dashboard/intelligence/memory" className={linkClass}>View memory →</Link>
      </section>

      {watched.length > 0 && (
        <section aria-labelledby="rail-content-opportunities" className="sm:col-span-2" style={{ ...moduleStyle, borderBottom: 0 }}>
          <h3 id="rail-content-opportunities" style={eyebrowStyle}>{contentOpportunities ? 'Content opportunities' : 'Watching'} · {watched.length}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            {watched.map(item => {
              const presentation = opportunityPresentation(item.title);
              return (
                <div key={item.id} title={item.title} style={{ marginTop: 6 }}>
                  <strong style={{ display: 'block', fontSize: 11.5, color: 'var(--ink)', lineHeight: 1.35 }}>{presentation.title}</strong>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink3)', lineHeight: 1.35, marginTop: 1 }}>{presentation.detail}</span>
                </div>
              );
            })}
          </div>
          <Link href="/dashboard/opportunities" className={linkClass} style={{ display: 'inline-flex', marginTop: 7 }}>View opportunities →</Link>
        </section>
      )}
      </div>
    </aside>
  );
}

// ── Onboarding resume banner ──────────────────────────────────────────────────

function OnboardingResumeBanner({ token }: { token: string }) {
  const [state, setState] = useState<{ step: string; confidence: number } | null>(null);
  const [dismissed, setDismiss] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('ob_resume_dismissed')) { setDismiss(true); return; }
    fetch(`${API_URL}/onboarding/session`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const s = json?.data?.session?.current_state as string | undefined;
        if (s && INCOMPLETE_STATES.has(s)) setState(STATE_LABELS[s] ?? { step: 'Continue setup', confidence: 60 });
      })
      .catch(() => {});
  }, [token]);
  if (!state || dismissed) return null;
  const minutesLeft = Math.max(2, Math.round((100 - state.confidence) / 10) + 2);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 14, marginBottom: 16, background: 'linear-gradient(135deg,#f7fffb,#f8f7ff)', border: '1px solid var(--sage3)', position: 'relative' }}>
      <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
        <svg width="44" height="44" viewBox="0 0 44 44" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--raised)" strokeWidth="4" />
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--sage)" strokeWidth="4" strokeDasharray="113" strokeDashoffset={113 * (1 - state.confidence / 100)} strokeLinecap="round" />
        </svg>
        {/* WAS {state.confidence}% from a hardcoded per-state map — the same
            fabricated "Growth Brain confidence" removed from the onboarding
            rail and the completion screen. It read 96% for anyone who finished
            setup, regardless of what LaunchMind had observed. The ring still
            shows PROGRESS through the flow; the number claimed knowledge. */}
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700, color: 'var(--ink3)' }}>✓</div>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        {/* WAS "Your Growth Brain is {state.confidence}% confident" — a number
            from a hardcoded per-state map, not a measurement. It asserted
            confidence LaunchMind had never computed. */}
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Finish setting up your Growth Brain</p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink2)' }}>You paused at <strong>{state.step}</strong>. About {minutesLeft} more minutes finishes setup.</p>
      </div>
      <Link href="/onboarding" style={{ height: 34, borderRadius: 10, background: 'var(--sage)', color: '#fff', padding: '0 14px', fontWeight: 650, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', flexShrink: 0 }}>
        Continue setup <IconArrowRight size={13} />
      </Link>
      <button onClick={() => { sessionStorage.setItem('ob_resume_dismissed','1'); setDismiss(true); }} style={{ position: 'absolute', top: 8, right: 10, border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 18, lineHeight: 1, padding: 2 }} aria-label="Dismiss">×</button>
    </div>
  );
}

// ── Unavailable state ─────────────────────────────────────────────────────────

/**
 * The product name, without the store-listing tail.
 *
 * The greeting read "Here's where AllignX・Home Services App - App Store stands
 * today." The suffix belongs to the App Store page, not to the product, and
 * reading it back to the owner every morning is how a scraper's output becomes
 * the product's name.
 */
function displayName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\s*[-\u2013\u2014|]\s*(App Store|Apps on Google Play|Google Play)\s*$/i, '')
    .replace(/\s+on the App Store\s*$/i, '')
    .replace(/\s*[-\u2013\u2014|]\s*$/, '')
    .trim();
}

function RecommendationUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
      <p className="text-[14px] font-semibold text-ink">Today&apos;s recommendation isn&apos;t ready</p>
      <p className="text-[13px] text-ink2 mt-1">Your data below is up to date. LaunchMind couldn&apos;t generate a recommendation this time.</p>
      <button onClick={onRetry} className="mt-3 px-3 py-1.5 bg-sage text-white text-[12px] font-medium rounded-[var(--r2)] hover:bg-[#047857] transition-colors">Try again</button>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function BriefClientView({ demoPerformanceRequested = false }: { demoPerformanceRequested?: boolean }) {
  /**
   * Which opportunity is currently promoted into the featured slot.
   *
   * Held by ID, never by title: two opportunities can legitimately share a
   * headline, and matching on strings would hide the wrong one.
   */
  const [featuredOpportunityId, setFeaturedOpportunityId] = useState<string | null>(null);
  // The company this view belongs to. Every cache read/write is partitioned by it,
  // so a remount after a switch can never resurrect the previous company's brief.
  const businessId = useBusinessScope();
  const cacheKey   = businessCacheKey(CACHE_BASE, businessId);
  const [data,    setData]    = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState('');
  const [contentIntelligence, setContentIntelligence] = useState<ContentIntelligenceView | null>(null);
  const [recState, setRecState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const fetchedRef = useRef(false); // prevent double-fetch in StrictMode

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // 1. Show cached data immediately if fresh enough
    const cached = readCache(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setRecState(cached.recommendation ? 'ready' : 'failed');
    }

    // 2. Always fetch fresh data — silently if we already have cache, spinner if not
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      setToken(session.access_token);

      api.owner.brief(session.access_token)
        .then((fresh) => {
          writeCache(cacheKey, fresh);
          setData(fresh);
          setLoading(false);
          setRecState(fresh.recommendation ? 'ready' : 'failed');
        })
        .catch(() => {
          // If we already showed cached data, keep it — don't blank the screen
          if (!cached) { setLoading(false); setRecState('failed'); }
        });
    });
  }, [cacheKey]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.contentIntelligence.get(token)
      .then(v => { if (alive) setContentIntelligence(v); })
      .catch(() => { if (alive) setContentIntelligence(null); });
    return () => { alive = false; };
  }, [token]);

  const refetch = useCallback(() => {
    if (!token) return;
    setRecState('loading');
    api.owner.brief(token)
      .then(fresh => { writeCache(cacheKey, fresh); setData(fresh); setRecState(fresh.recommendation ? 'ready' : 'failed'); })
      .catch(() => setRecState('failed'));
  }, [token, cacheKey]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ height: 36, width: '38%', background: 'var(--border)', borderRadius: 8, marginBottom: 10 }} />
            <div style={{ height: 16, width: '55%', background: 'var(--border)', borderRadius: 6 }} />
          </div>
          <div style={{ width: 280, height: 54, background: 'var(--border)', borderRadius: 12, flexShrink: 0 }} />
        </div>

        {/* Capability banner */}
        <div style={{ height: 112, background: 'var(--border)', borderRadius: 14, marginBottom: 16 }} />

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ height: 72, background: 'var(--border)', borderRadius: 14 }} />
          ))}
        </div>

        {/* Main 2-col grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.75fr) minmax(300px,0.75fr)', gap: 16 }}>
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 20, width: '45%', background: 'var(--border)', borderRadius: 6 }} />
            <div style={{ height: 148, background: 'var(--border)', borderRadius: 14 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ height: 110, background: 'var(--border)', borderRadius: 14 }} />
              <div style={{ height: 110, background: 'var(--border)', borderRadius: 14 }} />
            </div>
            <div style={{ height: 76, background: 'var(--border)', borderRadius: 14 }} />
          </div>
          {/* Right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 220, background: 'var(--border)', borderRadius: 14 }} />
            <div style={{ height: 108, background: 'var(--border)', borderRadius: 14 }} />
            <div style={{ height: 96, background: 'var(--border)', borderRadius: 14 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <RecommendationUnavailable onRetry={() => { setLoading(true); fetchedRef.current = false; }} />
      </div>
    );
  }

  const briefViewModel = createMorningBriefViewModel(data, {
    demoRequested: demoPerformanceRequested,
    runtime: process.env.NODE_ENV,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Page head */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4" style={{ marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: 'Syne,sans-serif', fontSize: 30, fontWeight: 700, color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
            {greeting}{data.founder.name ? `, ${data.founder.name.split(' ')[0]}` : ''}.
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink2)', marginTop: 7, lineHeight: 1.5 }}>
            {data.recommendation
              ? <>LaunchMind reviewed <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{(displayName(data.product?.name) || 'your app').split('・')[0].trim()}</span>. Here is what matters today.</>
              : <>Here&apos;s where <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{displayName(data.product?.name) || 'your app'}</span> stands today.</>}
          </p>
          <div style={{ marginTop: 9 }}><TodayWorkload data={data} ci={contentIntelligence} viewModel={briefViewModel} /></div>
        </div>
        <SinceCard data={data} ci={contentIntelligence} viewModel={briefViewModel} />
      </div>

      {token && <OnboardingResumeBanner token={token} />}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.2fr)_minmax(290px,0.8fr)] gap-6">

        {/* ── Left column ── */}
        <div className="space-y-4">

          <GrowthPulse viewModel={briefViewModel} token={token} />

          <section id="todays-priority" className="scroll-mt-4">
            <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2">Today&apos;s priority</p>
            {recState === 'loading' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }} className="animate-pulse">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-raised shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-raised rounded w-3/4" />
                    <div className="h-3 bg-raised rounded w-full" />
                    <div className="h-3 bg-raised rounded w-2/3" />
                  </div>
                </div>
              </div>
            )}
            {recState === 'failed'  && <RecommendationUnavailable onRetry={refetch} />}
            {recState === 'ready'   && data.recommendation && <RecommendationCard data={data} viewModel={briefViewModel} />}
          </section>

          {/* MOVED BELOW the recommendation. This nudge sat above "Today's
              highest-impact move" and read as a second primary decision, so two
              cards competed for the same slot. It is context for the
              recommendation, not a rival to it. */}
          {token && briefViewModel.performanceSource !== 'DEMO' && <IntelligenceGapBanner token={token} />}

          {/* ADDITIVE — renders only when a real content opportunity exists. */}
          {token && <ContentOpportunityCard ci={contentIntelligence} onFeatured={setFeaturedOpportunityId} />}

          <LastExperiment viewModel={briefViewModel} />

        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">
          <AiCmoRail data={data} viewModel={briefViewModel} featuredOpportunityId={featuredOpportunityId} contentIntelligence={contentIntelligence} token={token} />
        </div>
      </div>
    </div>
  );
}
