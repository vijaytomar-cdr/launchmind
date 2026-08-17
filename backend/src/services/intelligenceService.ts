/**
 * @file intelligenceService.ts
 * @description Computes Growth Brain intelligence-dimension coverage: what LaunchMind
 *   can actually observe versus what it is still estimating.
 *
 *   Coverage is deterministic — no AI calls — and is derived from CANONICAL connection
 *   state (workspace_connections.status) combined with the number of intelligence_signals
 *   genuinely imported. A stored credential alone never raises a score: a connection in
 *   NEEDS_REAUTH, SYNC_FAILED, or NO_HISTORY contributes no observed-data credit
 *   (spec §12; Step 1 requirement 12).
 *
 * @security JWT-authenticated route reads only; every query filtered by founder_id.
 * @dependencies connectionService (getCanonicalConnectionStates), business_goals,
 *   founder_context, products, onboarding_sessions, strategy_directions, learning_events
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import {
  getCanonicalConnectionStates,
  type CanonicalConnectionState,
} from './connectionService';
import type { WorkspaceContext } from './workspaceAuthService';
import type { Phase2Connections } from './integrationService';

export interface DimensionScore {
  label:       string;
  description: string;
  score:       number;   // 0–100
  missing:     boolean;  // true when score < 20 (needs a connection to improve)
  provider:    string | null; // which provider would improve this dimension
  /**
   * Owner-facing reason this dimension sits where it does — e.g. "Not connected",
   * "Connected · no history yet", "Needs reconnecting". Never invents a number.
   */
  statusLabel: string;
  /** True when the score reflects data genuinely imported from a provider. */
  observed:    boolean;
}

export interface GrowthBrainCoverage {
  overallScore:  number;
  overallCopy:   string;
  dimensions:    DimensionScore[];
  /** Back-compatible summary. Derived from canonical state, not token existence. */
  connections:   Phase2Connections;
  /** Canonical per-provider state — the source of truth for every surface. */
  connectionStates: Record<string, CanonicalConnectionState>;
  recommendedSource: {
    key:         string;
    name:        string;
    logoChar:    string;
    description: string;
    decisionImproved: string;
    /** Null: no measured basis exists for projecting a lift. */
    expectedGain: string | null;
    accessType:  string;
    /** False when no real integration exists yet — UI must not offer a live connect. */
    available:   boolean;
    connectionStatus: string;
  } | null;
  contextSummary: {
    /** Null when the underlying evidence does not exist. Absence, not a claim. */
    positioning:  string | null;
    audience:     string | null;
    topSignal:    string | null;
    nextInitiative: string;
    primaryGoal:  string;
    targetWindow: string;
  };
  lastLearning: {
    trigger:     string;
    actionTaken: string;
    /** "No measured change" when confidence was not measured on both sides. */
    confidenceLift: string;
    origin:      'automatic' | 'founder_confirmed';
  } | null;
  /**
   * Evidence-backed insights derived from connected sources. The same persisted rows
   * feed Growth Brain, the Morning Brief, and Improve Intelligence, so the three
   * surfaces cannot disagree.
   */
  liveInsights: Array<{
    id:         string;
    provider:   string;
    headline:   string;
    detail:     string;
    evidence:   unknown;
    confidence: number | null;
    createdAt:  string;
  }>;
}

/**
 * Scores one observed-data dimension from canonical connection state.
 *
 * Only HEALTHY/PARTIAL connections that actually imported signals earn data credit.
 * NO_HISTORY and in-flight states earn a small "connection established" credit but are
 * reported as not-yet-observed, so the owner is never shown a confidence number that
 * implies data LaunchMind does not have.
 *
 * @param states  - Canonical state map from getCanonicalConnectionStates
 * @param sources - Providers feeding this dimension, in priority order, with the
 *                  score each contributes when fully healthy and reporting data
 * @returns Score 0–100, an owner-facing status label, and whether it is observed
 */
function scoreObservedDimension(
  states: Record<string, CanonicalConnectionState>,
  sources: Array<{ provider: string; full: number }>,
): { score: number; statusLabel: string; observed: boolean } {
  let score = 0;
  let observed = false;
  const labels: string[] = [];

  for (const { provider, full } of sources) {
    const s = states[provider];
    if (!s) continue;

    if (s.healthy && s.signalCount > 0) {
      // PARTIAL means the provider authorized but some reports were unavailable.
      score += s.status === 'PARTIAL' ? Math.round(full * 0.6) : full;
      observed = true;
      labels.push(s.status === 'PARTIAL' ? `${provider}: partial data` : `${provider}: observed`);
    } else if (s.noHistory) {
      // Healthy connection, provider simply has no history yet (spec §14.5).
      score += 5;
      labels.push(`${provider}: connected, no history yet`);
    } else if (s.needsAttention) {
      labels.push(`${provider}: needs attention`);
    } else if (s.inFlight) {
      labels.push(`${provider}: syncing`);
    }
  }

  const statusLabel = labels.length > 0 ? labels.join(' · ') : 'Not connected';
  return { score: Math.min(100, score), statusLabel, observed };
}

/**
 * Computes Growth Brain coverage.
 *
 * Two scopes are deliberately mixed, matching the tenancy model:
 *   - Connections and imported intelligence are WORKSPACE-scoped (ctx.workspaceId).
 *   - Founder alignment context (goals, audience, direction) stays FOUNDER-scoped
 *     (ctx.actorId), because it describes the person, not the tenant.
 *
 * @param ctx - Verified workspace context
 * @returns Dimension scores, canonical connection states, recommended next source,
 *   context summary, and the latest learning event
 * @security The caller must have obtained ctx via resolveWorkspaceContext.
 */
export async function getGrowthBrainCoverage(ctx: WorkspaceContext): Promise<GrowthBrainCoverage> {
  const founderId = ctx.actorId;

  // Product ids belonging to THIS workspace, resolved first.
  // business_goals and competitor_relationships carry product_id but no
  // workspace_id, so this is the only way to scope them without mixing a
  // founder's other businesses. An empty workspace yields an impossible id
  // rather than an unfiltered query — `.in()` with [] matches nothing in
  // PostgREST, but relying on that is a silent correctness dependency.
  const { data: wsProducts } = await getSupabaseAdmin()
    .from('products').select('id').eq('workspace_id', ctx.workspaceId);
  const workspaceProductIds = ((wsProducts ?? []) as Array<{ id: string }>).map(p => p.id);
  const scopedProductIds = workspaceProductIds.length
    ? workspaceProductIds
    : ['00000000-0000-0000-0000-000000000000'];

  const [
    connectionsResult,
    founderContextResult,
    businessGoalResult,
    competitorResult,
    productResult,
    onboardingResult,
    directionResult,
    growthLearningResult,
    learningResult,
  ] = await Promise.allSettled([
    getCanonicalConnectionStates(ctx),
    // The delta editor (PATCH /products/:id/context-delta) writes next_initiative,
    // primary_goal, and target_window to the SESSION-LESS founder_context row, while
    // onboarding writes audience_confirmed/context_delta to a per-session row. Reading
    // only the newest row missed whichever of the two was written second, so a saved
    // delta could vanish from this page. Several rows are read and merged instead.
    //
    // The merge is now PRODUCT-LOCAL. Merging across rows of one business is
    // what fixes the vanishing delta; merging across two businesses would
    // blend AllignX's positioning with LaunchMind's into context belonging to
    // neither. Same query, one filter, opposite meaning.
    ctx.workspaceId ? getSupabaseAdmin()
      .from('founder_context')
      .select('audience_confirmed, context_delta, working_style, next_initiative, primary_goal, target_window, session_id')
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: false })
      .limit(5)
      : Promise.resolve({ data: [] }),
    ctx.workspaceId ? getSupabaseAdmin()
      .from('business_goals')
      .select('goal_type, target_value, unit, time_horizon_days')
      .eq('founder_id', founderId)
      .in('product_id', scopedProductIds)
      .order('created_at', { ascending: false })
      .limit(1)
      : Promise.resolve({ data: [] }),
    getSupabaseAdmin()
      .from('competitor_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('founder_id', founderId)
      .in('product_id', scopedProductIds),
    // Scoped through the SAME scopedProductIds the three neighbouring queries
    // already use. Reading "the founder's newest product across all workspaces"
    // meant a founder with two businesses saw the other one's positioning,
    // category and store metadata — and this row drives two dimension scores,
    // the context summary and the recommended-source decision.
    getSupabaseAdmin()
      .from('products')
      .select('confirmed_icp, scraped_meta, competitor_set, name, category')
      .in('id', scopedProductIds)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
    // product_id was SELECTED here and never used to filter, so completing
    // onboarding for one business marked the other's direction "confirmed".
    getSupabaseAdmin()
      .from('onboarding_sessions')
      .select('current_state, product_id')
      .eq('founder_id', founderId)
      .in('product_id', scopedProductIds)
      .order('created_at', { ascending: false })
      .limit(1),
    getSupabaseAdmin()
      .from('strategy_directions')
      .select('direction_data, headline, acknowledged_at')
      .eq('founder_id', founderId)
      .in('product_id', scopedProductIds)
      .order('created_at', { ascending: false })
      .limit(1),
    // The owner-facing learning log is the canonical source for "what changed
    // strategy". learning_events (Marketing Memory ingestion) is only a fallback for
    // workspaces that predate migration 085.
    getSupabaseAdmin()
      .from('growth_brain_learning_events')
      .select('trigger, new_state, prior_confidence, new_confidence, created_by_type, created_at')
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1),
    // Founder-wide, and reached ONLY when growth_brain_learning_events is
    // empty — which is precisely the state of a newly created second business.
    // So the fallback reliably rendered the OTHER business's learning event.
    getSupabaseAdmin()
      .from('learning_events')
      .select('event_type, payload, created_at')
      .eq('founder_id', founderId)
      .in('product_id', scopedProductIds)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  // Canonical connection state. On a read failure we degrade to "nothing connected"
  // rather than optimistically assuming a source is live.
  const connectionStates: Record<string, CanonicalConnectionState> =
    connectionsResult.status === 'fulfilled' ? connectionsResult.value : {};

  /**
   * Back-compatible summary for existing clients. `connected` now means
   * "authorized and holding observed data", not "a token row exists".
   */
  const asSummary = (provider: string) => {
    const s = connectionStates[provider];
    return {
      connected:   Boolean(s?.healthy && s.signalCount > 0),
      connectedAt: s?.lastSyncedAt ?? null,
      syncStatus: (s?.healthy
        ? 'synced'
        : s?.needsAttention
          ? 'error'
          : s?.inFlight || s?.noHistory
            ? 'pending'
            : null) as 'pending' | 'synced' | 'error' | null,
    };
  };

  const connections = {
    app_store_connect: asSummary('app_store_connect'),
    revenue_cat:       asSummary('revenue_cat'),
    google_analytics:  asSummary('ga4'),
    google_ads:        asSummary('google_ads'),
    meta_ads:          asSummary('meta_ads'),
    connectedCount: ['app_store_connect', 'revenue_cat', 'ga4', 'google_ads', 'meta_ads']
      .filter((p) => connectionStates[p]?.healthy && connectionStates[p].signalCount > 0).length,
  } as Phase2Connections;

  const founderCtxRows = (founderContextResult.status === 'fulfilled'
    ? (founderContextResult.value.data ?? [])
    : []) as Array<Record<string, unknown>>;
  const _founderCtxRow = founderCtxRows[0] ?? null;

  /** Newest non-empty value for a founder_context column, across the rows read. */
  const ctxField = (key: string): string | null => {
    for (const row of founderCtxRows) {
      const v = row[key];
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
    return null;
  };
  const goalRow       = businessGoalResult.status === 'fulfilled' ? (businessGoalResult.value.data?.[0] ?? null) : null;
  const competitorCount = competitorResult.status === 'fulfilled' ? (competitorResult.value.count ?? 0) : 0;
  const productRow    = productResult.status === 'fulfilled' ? (productResult.value.data?.[0] ?? null) : null;
  const sessionRow    = onboardingResult.status === 'fulfilled' ? (onboardingResult.value.data?.[0] ?? null) : null;
  const directionRow  = directionResult.status === 'fulfilled' ? (directionResult.value.data?.[0] ?? null) : null;
  const learningRow   = learningResult.status === 'fulfilled' ? (learningResult.value.data?.[0] ?? null) : null;
  const growthLearnRow = growthLearningResult.status === 'fulfilled'
    ? ((growthLearningResult.value.data?.[0] ?? null) as {
        trigger: string;
        new_state: string | null;
        prior_confidence: number | string | null;
        new_confidence: number | string | null;
        created_by_type: 'system' | 'founder';
      } | null)
    : null;

  // Internal state name from the onboarding state machine (not owner-facing copy).
  const understandingReady = sessionRow?.current_state === 'PHASE_1_COMPLETE';

  // ── INFERRED DIMENSIONS: earned / possible, with NO invented floor ────────
  //
  // These carried hardcoded bases (40 / 20 / 35) that no evidence supported, so
  // an entirely empty workspace rendered "18% grounded in evidence" with
  // nothing connected and nothing filled in. The per-term weights below are the
  // author's original relative weighting and are unchanged; only the invented
  // constant is gone. Scoring earned-over-possible keeps 100 reachable while
  // making 0 reachable too, which is what an empty workspace actually is.
  const ratio = (earned: number, possible: number) =>
    possible <= 0 ? 0 : Math.min(100, Math.round((earned / possible) * 100));

  // --- Dimension 1: Product & positioning (public data) ---
  const productScore = ratio(
    (productRow?.confirmed_icp ? 20 : 0)
    + (productRow?.scraped_meta ? 20 : 0)
    + (productRow?.competitor_set ? 12 : 0),
    52);

  // --- Dimension 2: Founder direction (confirmed alignment data) ---
  const founderScore = ratio(
    (ctxField('audience_confirmed') ? 22 : 0)
    + (ctxField('context_delta') ? 20 : 0)
    + (goalRow ? 18 : 0)
    + (understandingReady ? 10 : 0)
    + (directionRow?.acknowledged_at ? 10 : 0),
    80);

  // --- Dimension 3: Market intelligence (public signals + competitors) ---
  const marketScore = ratio(
    Math.min(20, competitorCount * 7)
    + (productRow?.category ? 10 : 0)
    + (productRow?.scraped_meta ? 9 : 0),
    39);

  // --- Observed dimensions: scored ONLY from canonical connection state + real signals ---
  // Search Console measures acquisition reach (impressions, clicks, position), so it
  // contributes to Performance alongside store and web analytics.
  const performance = scoreObservedDimension(connectionStates, [
    { provider: 'app_store_connect', full: 40 },
    { provider: 'ga4',               full: 25 },
    { provider: 'search_console',    full: 20 },
    // Owned-channel reach is acquisition performance too.
    { provider: 'mailchimp',         full: 15 },
  ]);
  // HubSpot answers "did the lead become a customer", which is the same question
  // revenue and retention answer from the money side.
  const revenue = scoreObservedDimension(connectionStates, [
    { provider: 'revenue_cat', full: 45 },
    { provider: 'stripe',      full: 35 },
    { provider: 'hubspot',     full: 20 },
  ]);
  const paid = scoreObservedDimension(connectionStates, [
    { provider: 'google_ads', full: 50 },
    { provider: 'meta_ads',   full: 50 },
  ]);

  const dimensions: DimensionScore[] = [
    {
      label:       'Product & positioning',
      description: 'Public product, reviews, pricing, messaging',
      score:       productScore,
      missing:     false,
      provider:    null,
      statusLabel: 'Public intelligence',
      observed:    true,
    },
    {
      label:       'Founder direction',
      description: 'Goals, roadmap, constraints, boundaries',
      score:       founderScore,
      missing:     false,
      provider:    null,
      statusLabel: understandingReady ? 'Founder direction confirmed' : 'Partly confirmed',
      observed:    true,
    },
    {
      label:       'Market intelligence',
      description: 'Competitors, demand signals, category context',
      score:       marketScore,
      missing:     false,
      provider:    null,
      statusLabel: 'Public intelligence',
      observed:    true,
    },
    {
      label:       'Performance',
      description: 'Installs, conversion, acquisition sources',
      score:       performance.score,
      missing:     !performance.observed,
      provider:    'app_store_connect',
      statusLabel: performance.statusLabel,
      observed:    performance.observed,
    },
    {
      label:       'Revenue & retention',
      description: 'Trials, paid conversion, churn, LTV',
      score:       revenue.score,
      missing:     !revenue.observed,
      provider:    'revenue_cat',
      statusLabel: revenue.statusLabel,
      observed:    revenue.observed,
    },
    {
      label:       'Paid acquisition',
      description: 'Spend, CAC, campaign performance',
      score:       paid.score,
      missing:     !paid.observed,
      provider:    'google_ads',
      statusLabel: paid.statusLabel,
      observed:    paid.observed,
    },
  ];

  // Overall score: weighted average (performance/revenue/paid weighted down when missing)
  const weights = [0.20, 0.20, 0.18, 0.18, 0.14, 0.10];
  const overallScore = Math.round(
    dimensions.reduce((acc, d, i) => acc + d.score * weights[i], 0)
  );

  const overallCopy = overallScore >= 80
    ? 'Strong across every dimension, including observed performance data.'
    : overallScore >= 60
      ? 'Strong product and founder context. Performance and revenue are still estimated, not observed.'
      : overallScore >= 40
        ? 'Product understood. Confirming your direction and adding an observed source would improve recommendations.'
        : 'Early understanding. Confirm your product and direction to increase confidence.';

  // Determine the best recommended source to connect next
  const SOURCES: Array<{
    key: string; name: string; logoChar: string;
    description: string; decisionImproved: string;
    accessType: string;
    provider: string;
  }> = [
    {
      key: 'app_store_connect',
      name: 'App Store Connect',
      logoChar: 'A',
      description: 'Replace estimated acquisition with actual impressions, downloads, conversion, sources, and territory performance.',
      decisionImproved: 'Where to invest before increasing demand',
      accessType: 'Read-only reporting',
      provider: 'app_store_connect',
    },
    {
      key: 'revenue_cat',
      name: 'RevenueCat',
      logoChar: 'R',
      description: 'Know which installs become paying, retained customers. Trials, churn, retention, and LTV observed instead of estimated.',
      decisionImproved: 'Whether to fix retention before pushing acquisition',
      accessType: 'Read-only reporting',
      provider: 'revenue_cat',
    },
    {
      key: 'ga4',
      name: 'Google Analytics',
      logoChar: 'G',
      description: 'See where website intent strengthens or disappears before users reach the store.',
      decisionImproved: 'Whether website landing pages are leaking qualified traffic',
      accessType: 'Read-only analytics',
      provider: 'ga4',
    },
  ];

  // Recommend the first source that is not already producing observed data.
  // `available` tells the UI whether a live connection can actually be made, so it
  // can show "not available yet" instead of a Connect button that cannot work.
  // ELIGIBILITY BEFORE ORDER. SOURCES is a fixed list headed by App Store
  // Connect, so the first unconnected entry was recommended regardless of
  // whether the product HAS an App Store listing. A pre-launch product with no
  // store was told to connect App Store Connect — advice it cannot act on, and
  // which reads as "we think you have an app".
  const srcMeta = (productRow?.scraped_meta as Record<string, unknown>) ?? {};
  const srcStores = Array.isArray(srcMeta.stores)
    ? (srcMeta.stores as Array<Record<string, unknown>>).map(x => String(x.platform))
    : (typeof srcMeta.platform === 'string' && srcMeta.name ? [srcMeta.platform] : []);
  const hasAppStore  = srcStores.includes('app_store');
  const hasPlayStore = srcStores.includes('play_store');

  /** A provider is only recommendable when its data source plausibly exists. */
  const providerEligible = (provider: string): boolean => {
    if (provider === 'app_store_connect') return hasAppStore;
    // RevenueCat reports on in-app purchases, which require a store listing.
    if (provider === 'revenue_cat')       return hasAppStore || hasPlayStore;
    // GA4, Search Console, Stripe, ads platforms are not store-dependent.
    return true;
  };

  const nextSource =
    SOURCES.find((s) => {
      if (!providerEligible(s.provider)) return false;
      const st = connectionStates[s.provider];
      return !(st?.healthy && st.signalCount > 0);
    }) ?? null;

  const recommendedSource = nextSource
    ? {
        key:              nextSource.key,
        name:             nextSource.name,
        logoChar:         nextSource.logoChar,
        description:      nextSource.description,
        decisionImproved: nextSource.decisionImproved,
        // MEASUREMENT HONESTY: this rendered `${score}% → ${score + N}%` where N
        // was a per-source literal (12 / 9 / 6) with nothing behind it — a
        // promised lift unrelated to the dimension weights that would actually
        // move. There is no measured basis for forecasting the gain before the
        // source is connected, so no number is offered.
        expectedGain:     null,
        accessType:       nextSource.accessType,
        available:        connectionStates[nextSource.provider]?.adapterAvailable ?? false,
        connectionStatus: connectionStates[nextSource.provider]?.status ?? 'NOT_CONNECTED',
      }
    : null;

  // Context summary (from Phase 1 / product data)
  const icpData       = productRow?.confirmed_icp as Record<string, unknown> | null;
  const scraped       = productRow?.scraped_meta as Record<string, unknown> | null;
  const dirData       = (directionRow?.direction_data as Record<string, unknown> | null);
  const founderDelta  = ctxField('context_delta');

  const contextSummary = {
    // OBSERVATION HONESTY: the fallbacks here asserted observations that had
    // not happened. 'Understood from App Store listing' rendered for a product
    // with no listing, and 'Demand from public product signals' claimed demand
    // evidence for a product whose store scrape returned 0 ratings and 0
    // reviews. Null is the honest value — the UI renders absence; it cannot
    // render a claim that was never made.
    positioning:    (icpData?.positioning as string) ?? (scraped?.description as string) ?? null,
    audience:       (icpData?.audience as string) ?? (icpData?.target_audience as string) ?? ctxField('audience_confirmed') ?? null,
    topSignal:      (icpData?.topSignal as string) ?? (scraped?.topSignal as string) ?? null,
    // A value the founder typed into the delta editor outranks anything inferred.
    nextInitiative: ctxField('next_initiative') ?? founderDelta ?? (dirData?.headline as string) ?? 'Not set',
    primaryGoal:    ctxField('primary_goal')
      ?? (goalRow ? `${goalRow.goal_type ?? 'active goal'}${goalRow.target_value ? ` to ${goalRow.target_value}` : ''}` : 'Not set'),
    targetWindow:   ctxField('target_window')
      ?? (goalRow?.time_horizon_days ? `Next ${goalRow.time_horizon_days} days` : 'Not set'),
  };

  // Latest learning event summary.
  let lastLearning: GrowthBrainCoverage['lastLearning'] = null;
  if (growthLearnRow) {
    const prior = growthLearnRow.prior_confidence == null ? null : Number(growthLearnRow.prior_confidence);
    const next  = growthLearnRow.new_confidence   == null ? null : Number(growthLearnRow.new_confidence);
    const moved = prior != null && next != null && Number.isFinite(prior) && Number.isFinite(next)
      ? Math.round((next - prior) * 10) / 10
      : null;

    lastLearning = {
      trigger:     growthLearnRow.trigger,
      actionTaken: growthLearnRow.new_state ?? 'Recorded — no recommendation changed',
      // Previously this defaulted to a hardcoded "+5 points" whenever the payload
      // lacked the field, which showed the owner a confidence gain nothing measured.
      confidenceLift: moved == null
        ? 'No measured change'
        : `${moved > 0 ? '+' : ''}${moved} points`,
      origin: growthLearnRow.created_by_type === 'founder' ? 'founder_confirmed' : 'automatic',
    };
  } else if (learningRow) {
    const payload = (learningRow.payload as Record<string, unknown>) ?? {};
    lastLearning = {
      trigger:        (payload.trigger as string) ?? `${learningRow.event_type} event received`,
      actionTaken:    (payload.action as string) ?? 'Recommendation updated',
      confidenceLift: typeof payload.confidenceLift === 'string' ? payload.confidenceLift : 'No measured change',
      origin:         'automatic',
    };
  }

  // Insights derived from real imported data. Read from the same persisted rows every
  // surface uses, so Growth Brain and the Morning Brief cannot drift apart.
  const { getLiveInsights } = await import('./connectionInsightService');
  const stored = await getLiveInsights(ctx.workspaceId, { limit: 5 }).catch(() => []);
  const liveInsights = stored.map(i => ({
    id:         i.id,
    provider:   i.provider,
    headline:   i.headline,
    detail:     i.detail,
    evidence:   i.evidence,
    confidence: i.confidence,
    createdAt:  i.created_at,
  }));

  return {
    overallScore,
    overallCopy,
    dimensions,
    connections,
    connectionStates,
    recommendedSource,
    contextSummary,
    lastLearning,
    liveInsights,
  };
}
