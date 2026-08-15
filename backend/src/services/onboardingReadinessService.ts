/**
 * @file onboardingReadinessService.ts
 * @description What LaunchMind can truthfully say it knows when onboarding ends.
 *
 *   REPLACES A FABRICATED NUMBER. The completion screen showed "18% → 96%" as
 *   two string literals. Every founder saw the same jump — a pre-launch product
 *   with no public presence scored identically to a live app with a store
 *   listing, a website and seven competitors. The six "✓" cards beneath it were
 *   a hardcoded array, so a pre-launch business was told "Public facts and
 *   evidence recorded" when none existed and "Founder corrections saved" when it
 *   had zero claims to correct.
 *
 *   TWO DIMENSIONS, NEVER BLENDED. "The founder told us what they want" and
 *   "we have observed evidence about this business" are different claims, and
 *   averaging them is what produced a confident-sounding number for a product
 *   nobody has seen:
 *
 *     founderContext    what the owner taught us — complete after onboarding
 *     observedEvidence  what we actually looked at — often nothing yet
 *
 *   getGrowthBrainCoverage().overallScore is deliberately NOT reused: its
 *   "Product & positioning" dimension mixes public evidence with owner-confirmed
 *   positioning, so collapsing it back to one figure would recreate exactly the
 *   conflation this exists to remove.
 *
 *   NO PERCENTAGE IS RETURNED. Anything shaped like a score gets read as a
 *   measurement, and neither dimension is measured — they are inventories.
 *
 * @security Reads one session's own workspace/product. No founder-wide reads.
 * @dependencies onboarding_sessions, products, founder_context, product_claims,
 *   business_goals, strategy_directions, approval_boundary_policies,
 *   competitor_relationships, workspace_connections, intelligence_signals
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

function db() { return getSupabaseAdmin(); }

/** How much of the business the OWNER has taught us. */
export type FounderContextStatus = 'complete' | 'partial' | 'minimal';

/**
 * What we have actually observed. Ordered, and designed to extend without a
 * rewrite when provider certification lands:
 *   none → public → connected → (later) learning from outcomes
 */
export type EvidenceLevel = 'none' | 'public' | 'connected';

export interface ReadinessCard {
  key: string;
  title: string;
  /** Truthful for THIS business. Never a generic claim. */
  detail: string;
  /** False when the underlying state does not exist — the card then says so. */
  present: boolean;
}

export interface OnboardingReadiness {
  founderContext: {
    status: FounderContextStatus;
    label: string;
    captured: string[];
    missing: string[];
  };
  observedEvidence: {
    level: EvidenceLevel;
    label: string;
    /** Owner-facing source names actually read, e.g. ['Website']. */
    sources: string[];
    connectedProviders: number;
  };
  /** One honest sentence for this specific business. */
  summary: string;
  cards: ReadinessCard[];
  direction: { headline: string | null };
}

/** The founder-context items onboarding sets out to capture. */
const CONTEXT_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'audience',    label: 'Audience' },
  { key: 'positioning', label: 'Positioning' },
  { key: 'value',       label: 'Value proposition' },
  { key: 'problem',     label: 'Customer problem' },
  { key: 'markets',     label: 'Markets' },
  { key: 'goal',        label: 'Goal' },
  { key: 'delta',       label: "What's changing next" },
  { key: 'boundaries',  label: 'Boundaries' },
];

function filled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Derives what LaunchMind can honestly claim about one completed session.
 *
 * @param sessionId - the onboarding session that just completed
 * @param founderId - authenticated owner; the session must be theirs
 * @throws {Error} 404 when the session is not the caller's
 * @security Everything is read through the session's OWN workspace and product.
 */
export async function getOnboardingReadiness(
  sessionId: string,
  founderId: string,
): Promise<OnboardingReadiness> {
  const { data: session } = await db()
    .from('onboarding_sessions')
    .select('id, workspace_id, product_id, product_maturity')
    .eq('id', sessionId).eq('founder_id', founderId).maybeSingle();
  if (!session) throw Object.assign(new Error('Session not found'), { statusCode: 404 });

  const s = session as { workspace_id: string | null; product_id: string | null; product_maturity: string | null };
  const workspaceId = s.workspace_id;
  const productId   = s.product_id;

  const [productRes, ctxRes, claimsRes, goalRes, dirRes, boundRes, connRes, sigRes] =
    await Promise.all([
      productId ? db().from('products').select('name, maturity, scraped_meta').eq('id', productId).maybeSingle()
                : Promise.resolve({ data: null }),
      db().from('founder_context')
        .select('audience_confirmed, positioning, value_proposition, primary_customer_problem, markets, context_delta, current_channels, confirmed_fields')
        .eq('session_id', sessionId).maybeSingle(),
      db().from('product_claims').select('status').eq('session_id', sessionId),
      productId ? db().from('business_goals')
        .select('goal_type, target_value, baseline_value, time_horizon_days, target_unknown')
        .eq('product_id', productId).maybeSingle()
                : Promise.resolve({ data: null }),
      productId ? db().from('strategy_directions').select('headline, week_1')
        .eq('product_id', productId).order('created_at', { ascending: false }).limit(1).maybeSingle()
                : Promise.resolve({ data: null }),
      db().from('approval_boundary_policies')
        .select('working_style, explicit_capabilities').eq('session_id', sessionId).maybeSingle(),
      workspaceId ? db().from('workspace_connections').select('id, status').eq('workspace_id', workspaceId)
                  : Promise.resolve({ data: [] }),
      workspaceId ? db().from('intelligence_signals').select('id').eq('workspace_id', workspaceId).limit(1)
                  : Promise.resolve({ data: [] }),
    ]);

  const product = (productRes as { data?: Record<string, unknown> | null }).data ?? null;
  const ctx     = (ctxRes as { data?: Record<string, unknown> | null }).data ?? null;
  const claims  = ((claimsRes as { data?: Array<{ status: string }> }).data ?? []);
  const goal    = (goalRes as { data?: Record<string, unknown> | null }).data ?? null;
  const dir     = (dirRes as { data?: Record<string, unknown> | null }).data ?? null;
  const bound   = (boundRes as { data?: Record<string, unknown> | null }).data ?? null;
  const conns   = ((connRes as { data?: Array<{ status: string }> }).data ?? []);
  const signals = ((sigRes as { data?: Array<unknown> }).data ?? []);

  // ── A · founder context ───────────────────────────────────────────────────
  const has: Record<string, boolean> = {
    audience:    filled(ctx?.audience_confirmed),
    positioning: filled(ctx?.positioning),
    value:       filled(ctx?.value_proposition),
    problem:     filled(ctx?.primary_customer_problem),
    markets:     filled(ctx?.markets),
    goal:        Boolean(goal),
    delta:       filled(ctx?.context_delta),
    boundaries:  Boolean(bound),
  };
  const captured = CONTEXT_ITEMS.filter(i => has[i.key]).map(i => i.label);
  const missing  = CONTEXT_ITEMS.filter(i => !has[i.key]).map(i => i.label);
  const status: FounderContextStatus =
    missing.length === 0 ? 'complete' : captured.length >= 5 ? 'partial' : 'minimal';

  // ── B · observed evidence ─────────────────────────────────────────────────
  const meta = (product?.scraped_meta as Record<string, unknown>) ?? {};
  const stores = Array.isArray(meta.stores) ? (meta.stores as Array<Record<string, unknown>>) : [];
  const website = (meta.websiteMeta as Record<string, unknown>) ?? {};
  const reviews = Array.isArray(meta.reviews) ? meta.reviews : [];

  const sources: string[] = [];
  for (const st of stores) {
    sources.push(st.platform === 'play_store' ? 'Google Play' : 'App Store');
  }
  // Legacy products predate stores[]; a flat platform scalar still means a real
  // listing was read.
  if (stores.length === 0 && typeof meta.platform === 'string' && filled(meta.name)) {
    sources.push(meta.platform === 'play_store' ? 'Google Play' : 'App Store');
  }
  if (Object.keys(website).length > 0) sources.push('Website');
  if (reviews.length > 0) sources.push('Public reviews');

  const healthyConnections = conns.filter(c => c.status === 'HEALTHY' || c.status === 'PARTIAL').length;
  // A connection only counts as observed evidence once it has actually produced
  // a signal — the Phase 2 rule, kept rather than re-derived.
  const level: EvidenceLevel =
    healthyConnections > 0 && signals.length > 0 ? 'connected'
      : sources.length > 0 ? 'public'
        : 'none';

  const evidenceLabel =
    level === 'connected' ? 'Performance sources connected'
      : level === 'public' ? 'Public sources available'
        : 'No observed sources yet';

  // ── Summary — derived from state, never from the product's name ───────────
  const summary =
    level === 'connected'
      ? 'LaunchMind understands the context you provided and is observing real performance data from your connected sources.'
      : level === 'public'
        ? 'LaunchMind understands your founder-confirmed context and has public product evidence from the sources discovered during onboarding.'
        : 'LaunchMind understands the direction, goals, positioning and boundaries you provided. It has not yet observed public or private performance data.';

  // ── Cards — each one asserts only what exists ─────────────────────────────
  const reviewed = claims.filter(c => c.status !== 'UNREVIEWED');
  const corrected = claims.filter(c => c.status === 'CORRECTED');
  const isPreLaunch = meta.preLaunch === true || s.product_maturity === 'pre_launch'
    || product?.maturity === 'pre_launch';

  const goalMeasurable = Boolean(goal)
    && goal?.target_unknown !== true
    && filled(goal?.time_horizon_days);

  const cards: ReadinessCard[] = [
    {
      key: 'product', title: 'Product context captured',
      detail: sources.length > 0
        ? `Public sources reviewed: ${sources.join(', ')}.`
        : isPreLaunch
          ? 'Learned from your description — no public sources yet.'
          : 'Recorded from what you provided.',
      present: true,
    },
    {
      key: 'assumptions',
      title: reviewed.length > 0 ? 'Assumptions reviewed' : 'Your context recorded',
      detail: corrected.length > 0
        ? `You corrected ${corrected.length} of LaunchMind's ${claims.length} assumptions.`
        : reviewed.length > 0
          ? `You reviewed ${reviewed.length} of LaunchMind's assumptions.`
          // Zero claims is the pre-launch case: there was nothing inferred to
          // correct, so claiming corrections were saved would be false.
          : 'Founder-provided context recorded — there were no public assumptions to review.',
      present: true,
    },
    {
      key: 'future', title: has.delta ? 'Future context learned' : 'Future context not set',
      detail: has.delta
        ? 'What you told us is changing next has been incorporated.'
        : 'You can add what is changing next at any time.',
      present: has.delta,
    },
    {
      key: 'success', title: goalMeasurable ? 'Success made measurable' : 'Goal recorded',
      detail: goalMeasurable
        ? `Baseline, target and a ${goal?.time_horizon_days}-day timeframe are set.`
        : goal
          ? 'Target still to be confirmed.'
          : 'No goal set yet.',
      present: goalMeasurable,
    },
    {
      key: 'boundaries', title: bound ? 'Boundaries confirmed' : 'Boundaries not set',
      detail: bound
        ? 'No execution or account access granted.'
        : 'LaunchMind will ask before acting.',
      present: Boolean(bound),
    },
    {
      key: 'direction', title: dir ? 'First direction delivered' : 'Direction pending',
      // The ACTUAL headline, never a hardcoded "30-day supply-first sequence".
      detail: dir?.headline
        ? String(dir.headline)
        : 'Your first direction will be generated shortly.',
      present: Boolean(dir),
    },
  ];

  return {
    founderContext: {
      status,
      label: status === 'complete' ? 'Complete'
        : status === 'partial' ? 'Mostly complete' : 'Just started',
      captured, missing,
    },
    observedEvidence: {
      level, label: evidenceLabel, sources,
      connectedProviders: healthyConnections,
    },
    summary,
    cards,
    direction: { headline: (dir?.headline as string) ?? null },
  };
}

/**
 * Exposed for tests. Competitor count is deliberately NOT part of readiness:
 * competitors are inferred, so counting them would let an inference inflate a
 * statement about observed evidence.
 */
export const __readinessInternals = { CONTEXT_ITEMS, filled };
