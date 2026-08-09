/**
 * @file connectionInsightService.ts
 * @description Derives evidence-backed insights from imported provider signals.
 *
 *   Nothing here is hard-coded prose. Each rule inspects the actual numbers a sync
 *   imported and only fires when its precondition genuinely holds — so a connection
 *   whose data shows nothing notable produces NO insight rather than a filler one.
 *
 *   Every emitted insight carries:
 *     evidence          the numbers the conclusion rests on
 *     source_signal_ids the intelligence_signals rows used
 *     provenance        provider, report, sync run, period, method
 *   so "why does LaunchMind believe this?" is answerable from the database.
 *
 * @security Workspace-scoped throughout; writes use service_role because
 *   connection_insights is derived data that clients may read but never author.
 * @dependencies supabaseAdmin, connection_insights, intelligence_signals
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

/** One number backing a conclusion. */
export interface EvidenceItem {
  label: string;
  value: string | number;
  unit?: string;
}

/** A derived, explainable finding. */
export interface DerivedInsight {
  insightKey:       string;
  headline:         string;
  detail:           string;
  recommendedFocus: string | null;
  evidence:         EvidenceItem[];
  sourceSignalIds:  string[];
  confidence:       number;
  method:           string;
}

/** A signal row as read back after insertion. */
interface SignalRow {
  id:           string;
  signal_type:  string;
  signal_data:  Record<string, unknown>;
  period_start: string | null;
  period_end:   string | null;
}

/**
 * Apple's published median product-page conversion sits around 3–5% across
 * categories. 3.5% is used as the comparison point and is reported as the benchmark
 * in the evidence so the owner can see what the claim is measured against.
 */
const APP_STORE_CONVERSION_BENCHMARK = 0.035;

/** Below this many page views the sample is too small to draw a conclusion from. */
const MIN_PAGE_VIEWS_FOR_CONVERSION_CLAIM = 200;

/** A single source or territory above this share is a genuine concentration. */
const CONCENTRATION_THRESHOLD = 0.55;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Confidence from sample size: small samples yield low confidence, and it is capped
 * well below certainty because one reporting window is one observation.
 * @param sample - Number of underlying events (page views, downloads)
 */
function confidenceFromSample(sample: number): number {
  if (sample <= 0) return 0;
  const scaled = Math.log10(sample + 1) / Math.log10(10_000);
  return Math.min(0.92, Math.max(0.4, Number(scaled.toFixed(3))));
}

/**
 * Derives App Store Connect insights from real imported signals.
 *
 * Rules, in priority order. Each returns nothing when its precondition is not met.
 *   1. conversion vs benchmark — needs page views AND downloads, sample ≥ 200
 *   2. acquisition source concentration — needs a source breakdown with a clear leader
 *   3. territory concentration — needs a territory breakdown with a clear leader
 *   4. reach without conversion — impressions present but conversion unavailable
 *
 * @param signals - The rows this sync actually wrote
 * @returns Insights ordered most useful first; empty when the data says nothing
 */
export function deriveAppStoreInsights(signals: SignalRow[]): DerivedInsight[] {
  const byType = (t: string) => signals.filter(s => s.signal_type === t);

  const conversionSignal = byType('conversion')[0];
  const impressionSignal = byType('impressions')[0];
  const downloadSignal   = byType('downloads')[0];
  const dimensionSignals = byType('territory');

  const sourceSignal    = dimensionSignals.find(s => s.signal_data?.dimension === 'source_type');
  const territorySignal = dimensionSignals.find(s => s.signal_data?.dimension === 'territory');

  const out: DerivedInsight[] = [];

  // ── Rule 1: store conversion against the category benchmark ────────────────
  if (conversionSignal) {
    const rate       = num(conversionSignal.signal_data.value);
    const pageViews  = num(conversionSignal.signal_data.product_page_views);
    const downloads  = num(conversionSignal.signal_data.downloads);

    if (rate !== null && pageViews !== null && downloads !== null &&
        pageViews >= MIN_PAGE_VIEWS_FOR_CONVERSION_CLAIM) {
      const delta = rate - APP_STORE_CONVERSION_BENCHMARK;
      const below = delta < 0;
      const relative = Math.abs(delta) / APP_STORE_CONVERSION_BENCHMARK;

      // Only claim a difference when it is material (>15% relative).
      if (relative > 0.15) {
        out.push({
          insightKey: 'app_store.conversion_vs_benchmark',
          headline: below
            ? `Your App Store product page converts at ${pct(rate)} — below the typical ${pct(APP_STORE_CONVERSION_BENCHMARK)} for the store.`
            : `Your App Store product page converts at ${pct(rate)} — above the typical ${pct(APP_STORE_CONVERSION_BENCHMARK)} for the store.`,
          detail: below
            ? `Apple reported ${pageViews.toLocaleString()} product-page views and ${downloads.toLocaleString()} downloads in this period. People are reaching your page but not installing, so the constraint is the page itself rather than demand.`
            : `Apple reported ${pageViews.toLocaleString()} product-page views and ${downloads.toLocaleString()} downloads in this period. The page is converting well, so additional reach is more likely to pay off than further page changes.`,
          recommendedFocus: below
            ? 'Test the screenshots and subtitle before increasing acquisition spend.'
            : 'Reach is now the limiting factor rather than the product page.',
          evidence: [
            { label: 'Product page views', value: pageViews },
            { label: 'Downloads', value: downloads },
            { label: 'Observed conversion', value: pct(rate) },
            { label: 'Store benchmark', value: pct(APP_STORE_CONVERSION_BENCHMARK) },
            { label: 'Difference', value: `${delta >= 0 ? '+' : ''}${pct(delta)}` },
          ],
          sourceSignalIds: [conversionSignal.id],
          confidence: confidenceFromSample(pageViews),
          method: 'downloads ÷ product page views, compared with a 3.5% App Store median',
        });
      }
    }
  }

  // ── Rule 2: acquisition source concentration ───────────────────────────────
  if (sourceSignal) {
    const topShare = num(sourceSignal.signal_data.top_share);
    const top      = sourceSignal.signal_data.top;
    const total    = num(sourceSignal.signal_data.total);

    if (topShare !== null && typeof top === 'string' && total !== null && total > 0 &&
        topShare >= CONCENTRATION_THRESHOLD) {
      out.push({
        insightKey: 'app_store.source_concentration',
        headline: `${pct(topShare)} of your product-page views come from ${top}.`,
        detail: `Apple attributed ${Math.round(total * topShare).toLocaleString()} of ${Math.round(total).toLocaleString()} product-page views in this period to ${top}. Your discovery depends heavily on one source, so a change there moves the whole funnel.`,
        recommendedFocus: `Understand what is working in ${top} before diversifying, and treat any change to it as high risk.`,
        evidence: [
          { label: 'Top source', value: top },
          { label: 'Share of page views', value: pct(topShare) },
          { label: 'Total page views', value: Math.round(total) },
          ...(Array.isArray(sourceSignal.signal_data.breakdown)
            ? (sourceSignal.signal_data.breakdown as Array<{ key: string; value: number }>)
                .slice(0, 3)
                .map(b => ({ label: `Views from ${b.key}`, value: Math.round(b.value) }))
            : []),
        ],
        sourceSignalIds: [sourceSignal.id],
        confidence: confidenceFromSample(total),
        method: 'product-page views grouped by Apple Source Type',
      });
    }
  }

  // ── Rule 3: territory concentration ────────────────────────────────────────
  if (territorySignal) {
    const topShare = num(territorySignal.signal_data.top_share);
    const top      = territorySignal.signal_data.top;
    const total    = num(territorySignal.signal_data.total);

    if (topShare !== null && typeof top === 'string' && total !== null && total > 0 &&
        topShare >= CONCENTRATION_THRESHOLD) {
      out.push({
        insightKey: 'app_store.territory_concentration',
        headline: `${top} accounts for ${pct(topShare)} of your App Store activity.`,
        detail: `Apple attributed most of this period's activity to ${top}. Growth decisions made on blended numbers will really be decisions about ${top}.`,
        recommendedFocus: `Evaluate performance per territory rather than in aggregate.`,
        evidence: [
          { label: 'Top territory', value: top },
          { label: 'Share of activity', value: pct(topShare) },
          { label: 'Territories observed', value: Array.isArray(territorySignal.signal_data.breakdown)
            ? (territorySignal.signal_data.breakdown as unknown[]).length : 0 },
        ],
        sourceSignalIds: [territorySignal.id],
        confidence: confidenceFromSample(total),
        method: 'activity grouped by Apple Territory',
      });
    }
  }

  // ── Rule 4: reach observed, conversion not yet measurable ──────────────────
  if (out.length === 0 && impressionSignal && !conversionSignal) {
    const impressions = num(impressionSignal.signal_data.value);
    if (impressions !== null && impressions > 0) {
      out.push({
        insightKey: 'app_store.reach_without_conversion',
        headline: `LaunchMind can now see ${impressions.toLocaleString()} App Store impressions, but not yet how many convert.`,
        detail: 'Apple has produced the engagement report for your app but not the commerce report. Reach is observed; downloads and conversion are still estimated until Apple publishes that report.',
        recommendedFocus: 'No action needed — conversion data will arrive on Apple’s next report cycle.',
        evidence: [
          { label: 'Impressions', value: impressions },
          { label: 'Downloads', value: downloadSignal ? 'observed' : 'not available yet' },
        ],
        sourceSignalIds: [impressionSignal.id],
        confidence: confidenceFromSample(impressions),
        method: 'App Store engagement report present, commerce report absent',
      });
    }
  }

  return out;
}

// ── RevenueCat ────────────────────────────────────────────────────────────────

/**
 * Derives subscription and retention insights.
 *
 * Deliberately does NOT claim an LTV: RevenueCat's overview endpoint exposes no
 * churn rate, and LTV without one is a guess. Revenue per subscriber is exact and is
 * reported instead.
 */
export function deriveRevenueCatInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  // Trial pipeline weight — how much of the base is still unconverted.
  const retention = first('retention');
  if (retention) {
    const trials = num(retention.signal_data.active_trials);
    const subs   = num(retention.signal_data.active_subscriptions);
    const share  = num(retention.signal_data.trial_share);

    if (trials !== null && subs !== null && share !== null && trials + subs >= 20) {
      // A trial-heavy base means conversion is the constraint; a trial-light one
      // means top-of-funnel is.
      if (share >= 0.4) {
        out.push({
          insightKey: 'revenue_cat.trial_heavy_base',
          headline: `${pct(share)} of your subscriber base is still in trial.`,
          detail: `RevenueCat reports ${trials.toLocaleString()} active trials against ${subs.toLocaleString()} paid subscriptions. Most of your growth is sitting in the conversion step rather than in acquisition.`,
          recommendedFocus: 'Work the trial-to-paid moment before spending more on new installs.',
          evidence: [
            { label: 'Active trials', value: trials },
            { label: 'Active subscriptions', value: subs },
            { label: 'Trial share of base', value: pct(share) },
          ],
          sourceSignalIds: [retention.id],
          confidence: confidenceFromSample(trials + subs),
          method: 'active trials ÷ (active trials + active subscriptions), RevenueCat metrics overview',
        });
      } else if (share <= 0.1 && subs >= 50) {
        out.push({
          insightKey: 'revenue_cat.trial_pipeline_thin',
          headline: `Only ${pct(share)} of your base is in trial — the pipeline is thin.`,
          detail: `RevenueCat reports ${trials.toLocaleString()} active trials against ${subs.toLocaleString()} paid subscriptions. Retention is carrying the business; new trial starts are the limiting factor.`,
          recommendedFocus: 'Acquisition, not conversion, is where the next subscriber comes from.',
          evidence: [
            { label: 'Active trials', value: trials },
            { label: 'Active subscriptions', value: subs },
            { label: 'Trial share of base', value: pct(share) },
          ],
          sourceSignalIds: [retention.id],
          confidence: confidenceFromSample(trials + subs),
          method: 'active trials ÷ (active trials + active subscriptions), RevenueCat metrics overview',
        });
      }
    }
  }

  // Revenue per subscriber.
  const ltv = first('ltv');
  if (ltv) {
    const arpu = num(ltv.signal_data.arpu_usd);
    const subs = num(ltv.signal_data.active_subscriptions);
    const mrr  = num(ltv.signal_data.mrr_usd);

    if (arpu !== null && subs !== null && mrr !== null && subs >= 20) {
      out.push({
        insightKey: 'revenue_cat.revenue_per_subscriber',
        headline: `Each active subscriber is worth $${arpu.toFixed(2)} per month.`,
        detail: `RevenueCat reports $${mrr.toFixed(2)} MRR across ${subs.toLocaleString()} active subscriptions. This is the ceiling on what a new subscriber can be worth per month, and therefore on what acquiring one can justifiably cost.`,
        recommendedFocus: 'Use this as the payback anchor for any acquisition spend decision.',
        evidence: [
          { label: 'MRR', value: `$${mrr.toFixed(2)}` },
          { label: 'Active subscriptions', value: subs },
          { label: 'Revenue per subscriber', value: `$${arpu.toFixed(2)}`, unit: 'per month' },
        ],
        sourceSignalIds: [ltv.id],
        confidence: confidenceFromSample(subs),
        method: 'MRR ÷ active subscriptions, RevenueCat metrics overview',
      });
    }
  }

  return out;
}

// ── Google Analytics 4 ────────────────────────────────────────────────────────

/** Derives journey insights: where intent strengthens and where it disappears. */
export function deriveGa4Insights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  // A source that converts far better than the site average is a real finding.
  const quality = first('source_quality');
  const conversion = first('conversion');
  if (quality && conversion) {
    const best = quality.signal_data.best_converting as
      { source?: string; sessions?: number; conversion_rate?: number } | null | undefined;
    const overall = num(conversion.signal_data.value);
    const sessions = num(conversion.signal_data.sessions);

    if (best?.source && typeof best.conversion_rate === 'number' &&
        overall !== null && overall > 0 && sessions !== null && sessions >= 200) {
      const multiple = best.conversion_rate / overall;
      if (multiple >= 1.5) {
        out.push({
          insightKey: 'ga4.best_converting_source',
          headline: `${best.source} converts ${multiple.toFixed(1)}× better than your site average.`,
          detail: `Google Analytics recorded ${(best.sessions ?? 0).toLocaleString()} sessions from ${best.source} converting at ${pct(best.conversion_rate)}, against a site-wide ${pct(overall)}. Traffic quality differs sharply by source, so blended conversion is hiding the real picture.`,
          recommendedFocus: `Understand what makes ${best.source} traffic different before increasing spend on any other source.`,
          evidence: [
            { label: 'Best source', value: best.source },
            { label: 'Its conversion rate', value: pct(best.conversion_rate) },
            { label: 'Site-wide conversion', value: pct(overall) },
            { label: 'Sessions from source', value: best.sessions ?? 0 },
          ],
          sourceSignalIds: [quality.id, conversion.id],
          confidence: confidenceFromSample(sessions),
          method: 'per-source conversions ÷ sessions compared with site-wide conversion, GA4 Data API',
        });
      }
    }
  }

  // A high-traffic page bleeding visitors is a concrete place to act.
  const funnel = first('funnel');
  if (funnel) {
    const worst = funnel.signal_data.highest_bounce_page as
      { page?: string; bounce_rate?: number; sessions?: number } | null | undefined;
    const total = num(funnel.signal_data.total);

    if (worst?.page && typeof worst.bounce_rate === 'number' &&
        typeof worst.sessions === 'number' && worst.bounce_rate >= 0.7 && worst.sessions >= 100) {
      const share = total && total > 0 ? worst.sessions / total : null;
      out.push({
        insightKey: 'ga4.high_bounce_landing_page',
        headline: `${worst.page} loses ${pct(worst.bounce_rate)} of its visitors immediately.`,
        detail: `Google Analytics recorded ${worst.sessions.toLocaleString()} sessions landing on this page${share ? `, ${pct(share)} of all landing traffic` : ''}, and most left without engaging. Traffic is arriving; the page is not holding it.`,
        recommendedFocus: 'Fix the mismatch between what brings people to this page and what it shows them.',
        evidence: [
          { label: 'Page', value: worst.page },
          { label: 'Bounce rate', value: pct(worst.bounce_rate) },
          { label: 'Sessions', value: worst.sessions },
          ...(share ? [{ label: 'Share of landing traffic', value: pct(share) }] : []),
        ],
        sourceSignalIds: [funnel.id],
        confidence: confidenceFromSample(worst.sessions),
        method: 'landing page bounce rate among pages with ≥20 sessions, GA4 Data API',
      });
    }
  }

  // Engagement floor: people arrive but never engage at all.
  const sessions = first('sessions');
  if (out.length === 0 && sessions) {
    const rate = num(sessions.signal_data.engagement_rate);
    const total = num(sessions.signal_data.sessions);
    if (rate !== null && total !== null && total >= 200 && rate < 0.4) {
      out.push({
        insightKey: 'ga4.low_engagement_rate',
        headline: `Only ${pct(rate)} of sessions engage at all.`,
        detail: `Google Analytics recorded ${total.toLocaleString()} sessions in this window, most of which ended without meaningful interaction. The constraint is what happens after arrival, not how many arrive.`,
        recommendedFocus: 'Improve the first screen before buying more traffic.',
        evidence: [
          { label: 'Sessions', value: total },
          { label: 'Engagement rate', value: pct(rate) },
        ],
        sourceSignalIds: [sessions.id],
        confidence: confidenceFromSample(total),
        method: 'engagedSessions ÷ sessions, GA4 Data API',
      });
    }
  }

  return out;
}

// ── Stripe ────────────────────────────────────────────────────────────────────

/** Derives revenue and payment-reliability insights. */
export function deriveStripeInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  // Failed payments are revenue already earned and then lost — usually the cheapest
  // thing to fix, so it leads.
  const payments = first('conversion');
  if (payments) {
    const failureRate = num(payments.signal_data.failure_rate);
    const charges     = num(payments.signal_data.charges);
    const failed      = num(payments.signal_data.failed);
    const reasons     = payments.signal_data.top_failure_reasons as Array<{ key: string; value: number }> | undefined;

    if (failureRate !== null && charges !== null && failed !== null &&
        charges >= 25 && failureRate >= 0.08) {
      out.push({
        insightKey: 'stripe.payment_failure_rate',
        headline: `${pct(failureRate)} of payment attempts are failing.`,
        detail: `Stripe recorded ${failed.toLocaleString()} failed attempts out of ${charges.toLocaleString()} in the last 30 days${reasons?.length ? `, most commonly "${reasons[0].key}"` : ''}. This is revenue that was already won and then lost at the checkout step.`,
        recommendedFocus: 'Fix the failure path before spending anything more on acquisition.',
        evidence: [
          { label: 'Total charges', value: charges },
          { label: 'Failed', value: failed },
          { label: 'Failure rate', value: pct(failureRate) },
          ...(reasons?.slice(0, 2).map(r => ({ label: `Failures: ${r.key}`, value: r.value })) ?? []),
        ],
        sourceSignalIds: [payments.id],
        confidence: confidenceFromSample(charges),
        method: 'failed ÷ total charges over 30 days, Stripe API',
      });
    }

    // Refunds eating into realized revenue.
    const refundRate = num(payments.signal_data.refund_rate_of_revenue);
    if (refundRate !== null && charges !== null && charges >= 25 && refundRate >= 0.05) {
      out.push({
        insightKey: 'stripe.refund_pressure',
        headline: `Refunds are returning ${pct(refundRate)} of collected revenue.`,
        detail: `Stripe issued refunds worth ${pct(refundRate)} of what was collected in the last 30 days. At this level the product or the promise is mismatched for a meaningful share of buyers.`,
        recommendedFocus: 'Look at what those buyers expected before optimising acquisition further.',
        evidence: [
          { label: 'Refund share of revenue', value: pct(refundRate) },
          { label: 'Refunds', value: num(payments.signal_data.refund_count) ?? 0 },
          { label: 'Refunded', value: `$${(num(payments.signal_data.refunded_usd) ?? 0).toFixed(2)}` },
        ],
        sourceSignalIds: [payments.id],
        confidence: confidenceFromSample(charges),
        method: 'refunded amount ÷ succeeded charge amount over 30 days, Stripe API',
      });
    }
  }

  // Subscription health: how much of the base is not paying reliably.
  const plans = first('plan_movement');
  if (plans) {
    const total    = num(plans.signal_data.total_subscriptions);
    const pastDue  = num(plans.signal_data.past_due);
    const canceled = num(plans.signal_data.canceled);

    if (total !== null && pastDue !== null && total >= 20) {
      const atRisk = pastDue / total;
      if (atRisk >= 0.05) {
        out.push({
          insightKey: 'stripe.past_due_subscriptions',
          headline: `${pct(atRisk)} of subscriptions are past due.`,
          detail: `Stripe reports ${pastDue.toLocaleString()} past-due subscriptions out of ${total.toLocaleString()}${canceled !== null ? `, with ${canceled.toLocaleString()} already cancelled` : ''}. These are customers who chose to pay and are now failing to — recovering them is cheaper than replacing them.`,
          recommendedFocus: 'Set up dunning before treating this as a churn problem.',
          evidence: [
            { label: 'Total subscriptions', value: total },
            { label: 'Past due', value: pastDue },
            { label: 'Share past due', value: pct(atRisk) },
          ],
          sourceSignalIds: [plans.id],
          confidence: confidenceFromSample(total),
          method: 'past_due ÷ total subscriptions, Stripe API',
        });
      }
    }
  }

  // Revenue per subscriber, when nothing more urgent surfaced.
  const mrr = first('mrr');
  if (out.length === 0 && mrr) {
    const value = num(mrr.signal_data.value_usd);
    const arpu  = num(mrr.signal_data.arpu_usd);
    const subs  = num(mrr.signal_data.active_subscriptions);
    if (value !== null && arpu !== null && subs !== null && subs >= 10) {
      out.push({
        insightKey: 'stripe.revenue_per_subscriber',
        headline: `Your recurring revenue is $${value.toFixed(2)}/month across ${subs.toLocaleString()} subscriptions.`,
        detail: `That is $${arpu.toFixed(2)} per subscriber per month, computed from the live prices attached to active subscriptions. It sets the ceiling on defensible acquisition cost.`,
        recommendedFocus: 'Anchor payback expectations to this figure rather than to list price.',
        evidence: [
          { label: 'MRR', value: `$${value.toFixed(2)}` },
          { label: 'Active subscriptions', value: subs },
          { label: 'Revenue per subscriber', value: `$${arpu.toFixed(2)}`, unit: 'per month' },
        ],
        sourceSignalIds: [mrr.id],
        confidence: confidenceFromSample(subs),
        method: 'sum of active subscription prices normalized to monthly ÷ active subscriptions, Stripe API',
      });
    }
  }

  return out;
}

// ── Google Search Console ─────────────────────────────────────────────────────

/** Derives search-visibility insights. */
export function deriveSearchConsoleInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  // Already visible, under-clicked — the highest-leverage search finding.
  const opportunity = signals.find(
    s => s.signal_type === 'source_quality' && s.signal_data?.dimension === 'search_opportunity',
  );
  if (opportunity) {
    const potential = num(opportunity.signal_data.potential_additional_clicks);
    const median    = num(opportunity.signal_data.median_ctr);
    const list      = opportunity.signal_data.opportunities as
      Array<{ query: string; impressions: number; ctr: number; position: number; clicks_at_median_ctr: number }> | undefined;

    if (potential !== null && potential >= 20 && median !== null && list?.length) {
      const top = list[0];
      out.push({
        insightKey: 'search_console.underclicked_queries',
        headline: `"${top.query}" ranks at position ${top.position.toFixed(1)} but only ${pct(top.ctr)} of searchers click.`,
        detail: `Search Console shows ${top.impressions.toLocaleString()} impressions for this query with click-through well below your own median of ${pct(median)}. Across ${list.length} similar queries you are already visible for, matching your median would win roughly ${potential.toLocaleString()} more clicks — with no new content and no new spend.`,
        recommendedFocus: 'Rewrite the title and meta description for these pages before creating new ones.',
        evidence: [
          { label: 'Top under-clicked query', value: top.query },
          { label: 'Its impressions', value: top.impressions },
          { label: 'Its click-through', value: pct(top.ctr) },
          { label: 'Your median click-through', value: pct(median) },
          { label: 'Recoverable clicks', value: potential },
        ],
        sourceSignalIds: [opportunity.id],
        confidence: confidenceFromSample(top.impressions),
        method: 'queries with ≥50 impressions and position ≤20 whose CTR trails the set median, Search Console',
      });
    }
  }

  // Visibility without traffic.
  const ctr = first('ctr');
  const rankings = first('rankings');
  if (out.length === 0 && ctr && rankings) {
    const rate        = num(ctr.signal_data.value);
    const impressions = num(ctr.signal_data.impressions);
    const position    = num(rankings.signal_data.average_position);

    if (rate !== null && impressions !== null && position !== null && impressions >= 500) {
      // Ranking on page two or worse explains low CTR; ranking well does not.
      if (position > 20) {
        out.push({
          insightKey: 'search_console.visibility_without_ranking',
          headline: `You appear in ${impressions.toLocaleString()} searches but average position ${position.toFixed(1)}.`,
          detail: `Search Console shows real demand for what you offer, but you sit below where searchers look. Click-through is ${pct(rate)}, which is what that position produces — the constraint is ranking, not messaging.`,
          recommendedFocus: 'Depth on the pages already ranking beats publishing new ones.',
          evidence: [
            { label: 'Impressions', value: impressions },
            { label: 'Average position', value: position.toFixed(1) },
            { label: 'Click-through', value: pct(rate) },
            { label: 'Queries in top 10', value: num(rankings.signal_data.queries_in_top_10) ?? 0 },
          ],
          sourceSignalIds: [ctr.id, rankings.id],
          confidence: confidenceFromSample(impressions),
          method: 'impression-weighted mean position with overall CTR, Search Console',
        });
      } else if (rate < 0.02) {
        out.push({
          insightKey: 'search_console.strong_position_weak_ctr',
          headline: `You rank at position ${position.toFixed(1)} yet only ${pct(rate)} of searchers click.`,
          detail: `Search Console recorded ${impressions.toLocaleString()} impressions at a position where clicks normally follow. Searchers are seeing you and choosing something else, which points at the snippet rather than the ranking.`,
          recommendedFocus: 'Rewrite titles and descriptions before investing in more ranking work.',
          evidence: [
            { label: 'Impressions', value: impressions },
            { label: 'Average position', value: position.toFixed(1) },
            { label: 'Click-through', value: pct(rate) },
          ],
          sourceSignalIds: [ctr.id, rankings.id],
          confidence: confidenceFromSample(impressions),
          method: 'impression-weighted mean position with overall CTR, Search Console',
        });
      }
    }
  }

  return out;
}

// ── Google Ads ────────────────────────────────────────────────────────────────

/**
 * Derives paid-search insights.
 *
 * Every finding here is observation only. None of them is phrased as an instruction
 * LaunchMind will carry out: it can see the waste and say so, and a person decides
 * what to do. Recommending a pause is not the same as pausing.
 */
export function deriveGoogleAdsInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  const spend = first('spend');
  const terms = signals.find(s => s.signal_type === 'source_quality' && s.signal_data?.dimension === 'search_term');
  const campaigns = first('campaign_performance');
  const cac = first('cac');

  const totalSpend = num(spend?.signal_data.value_usd);

  // Money going to searches that never convert is the clearest paid-search waste.
  if (terms && totalSpend !== null && totalSpend > 0) {
    const wasted = num(terms.signal_data.zero_conversion_spend_usd);
    const list = terms.signal_data.zero_conversion_terms as Array<{ term: string; spend_usd: number; clicks: number }> | undefined;

    if (wasted !== null && wasted > 0 && list?.length) {
      const share = wasted / totalSpend;
      if (share >= 0.15) {
        out.push({
          insightKey: 'google_ads.zero_conversion_search_spend',
          headline: `${pct(share)} of your Google Ads spend went to searches that never converted.`,
          detail: `Google Ads attributed $${wasted.toFixed(2)} of $${totalSpend.toFixed(2)} to ${list.length} search terms with no conversions in the last 30 days. The largest was "${list[0].term}" at $${list[0].spend_usd.toFixed(2)}. LaunchMind can draft a negative-keyword list for your review — it cannot apply one.`,
          recommendedFocus: 'Review these terms and decide which to exclude. Nothing changes in Google Ads until you do it.',
          evidence: [
            { label: 'Total spend', value: `$${totalSpend.toFixed(2)}` },
            { label: 'Spend with no conversions', value: `$${wasted.toFixed(2)}` },
            { label: 'Share of spend', value: pct(share) },
            { label: 'Worst term', value: list[0].term },
            { label: 'Its spend', value: `$${list[0].spend_usd.toFixed(2)}` },
          ],
          sourceSignalIds: [terms.id, spend!.id],
          confidence: confidenceFromSample(num(terms.signal_data.terms_analyzed) ?? list.length),
          method: 'search terms with spend and zero attributed conversions ÷ total spend, Google Ads API',
        });
      }
    }
  }

  // Whole campaigns burning budget with nothing to show.
  if (campaigns && totalSpend !== null && totalSpend > 0) {
    const dead = num(campaigns.signal_data.zero_conversion_spend_usd);
    const list = campaigns.signal_data.campaigns as Array<{ name: string; spend_usd: number; conversions: number }> | undefined;

    if (dead !== null && dead > 0 && list?.length) {
      const share = dead / totalSpend;
      const offenders = list.filter(c => c.conversions === 0 && c.spend_usd > 0);
      if (share >= 0.2 && offenders.length > 0) {
        out.push({
          insightKey: 'google_ads.zero_conversion_campaigns',
          headline: `${offenders.length} campaign${offenders.length === 1 ? '' : 's'} spent $${dead.toFixed(2)} without a single conversion.`,
          detail: `That is ${pct(share)} of your Google Ads budget in the last 30 days. The largest is "${offenders[0].name}" at $${offenders[0].spend_usd.toFixed(2)}. LaunchMind is connected read-only and will not pause anything on your behalf.`,
          recommendedFocus: 'Decide whether these campaigns need fixing or stopping.',
          evidence: [
            { label: 'Campaigns with no conversions', value: offenders.length },
            { label: 'Their spend', value: `$${dead.toFixed(2)}` },
            { label: 'Share of budget', value: pct(share) },
            { label: 'Largest', value: offenders[0].name },
          ],
          sourceSignalIds: [campaigns.id, spend!.id],
          confidence: confidenceFromSample(num(campaigns.signal_data.total_spend_usd) ?? 0),
          method: 'campaign spend with zero attributed conversions ÷ total spend, Google Ads API',
        });
      }
    }
  }

  // Cost per conversion, when nothing more urgent surfaced.
  if (out.length === 0 && cac) {
    const cost = num(cac.signal_data.cost_per_conversion_usd);
    const conversions = num(cac.signal_data.conversions);
    const spendUsd = num(cac.signal_data.spend_usd);

    if (cost !== null && conversions !== null && spendUsd !== null && conversions >= 5) {
      out.push({
        insightKey: 'google_ads.cost_per_conversion',
        headline: `Google Ads is costing $${cost.toFixed(2)} per conversion.`,
        detail: `$${spendUsd.toFixed(2)} produced ${conversions.toLocaleString()} conversions in the last 30 days. Compare this with what a customer is worth to you before changing budget in either direction.`,
        recommendedFocus: 'Judge this against your revenue per customer, not against a benchmark.',
        evidence: [
          { label: 'Spend', value: `$${spendUsd.toFixed(2)}` },
          { label: 'Conversions', value: conversions },
          { label: 'Cost per conversion', value: `$${cost.toFixed(2)}` },
        ],
        sourceSignalIds: [cac.id],
        confidence: confidenceFromSample(conversions * 10),
        method: 'spend ÷ attributed conversions over 30 days, Google Ads API',
      });
    }
  }

  return out;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

/** Derives creative and audience insights. Observation only, like Google Ads. */
export function deriveMetaInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  const spend = first('spend');
  const creative = first('creative_performance');
  const audience = first('audience');
  const cac = first('cac');

  const totalSpend = num(spend?.signal_data.value_usd);

  // Creative fatigue is Meta's characteristic failure mode: the same people seeing
  // the same ad repeatedly and no longer responding.
  if (creative && totalSpend !== null && totalSpend > 0) {
    const fatigued = creative.signal_data.fatigued_creatives as
      Array<{ ad: string; frequency: number; spend_usd: number; ctr: number }> | undefined;
    const fatiguedSpend = num(creative.signal_data.fatigued_spend_usd);

    if (fatigued?.length && fatiguedSpend !== null && fatiguedSpend > 0) {
      const share = fatiguedSpend / totalSpend;
      if (share >= 0.15) {
        const worst = [...fatigued].sort((a, b) => b.spend_usd - a.spend_usd)[0];
        out.push({
          insightKey: 'meta.creative_fatigue',
          headline: `${fatigued.length} creative${fatigued.length === 1 ? ' is' : 's are'} showing fatigue and spent $${fatiguedSpend.toFixed(2)} without converting.`,
          detail: `"${worst.ad}" has been seen an average of ${worst.frequency.toFixed(1)} times per person and produced no attributed conversions on $${worst.spend_usd.toFixed(2)}. LaunchMind can draft replacement concepts for your review; it is connected read-only and will not publish or pause anything.`,
          recommendedFocus: 'Refresh or retire these creatives before adding budget.',
          evidence: [
            { label: 'Fatigued creatives', value: fatigued.length },
            { label: 'Their spend', value: `$${fatiguedSpend.toFixed(2)}` },
            { label: 'Share of spend', value: pct(share) },
            { label: 'Highest frequency', value: worst.frequency.toFixed(1) },
            { label: 'Rule', value: String(creative.signal_data.fatigue_rule ?? 'frequency ≥ 3, spend, no conversion') },
          ],
          sourceSignalIds: [creative.id, spend!.id],
          confidence: confidenceFromSample(num(creative.signal_data.creatives_analyzed) ?? fatigued.length),
          method: 'creatives with frequency ≥ 3, spend, and no attributed conversion, Meta insights',
        });
      }
    }
  }

  // Placement concentration: spend piling into one surface.
  if (out.length === 0 && audience) {
    const topShare = num(audience.signal_data.top_share);
    const top = audience.signal_data.top;
    const total = num(audience.signal_data.total);

    if (topShare !== null && typeof top === 'string' && total !== null && total > 0 && topShare >= 0.7) {
      out.push({
        insightKey: 'meta.placement_concentration',
        headline: `${pct(topShare)} of your Meta spend goes to ${top}.`,
        detail: `Meta placed $${(total * topShare).toFixed(2)} of $${total.toFixed(2)} on a single surface in the last 30 days. Performance you read as "Meta working" is really that one placement working.`,
        recommendedFocus: `Judge ${top} on its own numbers before treating Meta as a single channel.`,
        evidence: [
          { label: 'Top placement', value: top },
          { label: 'Share of spend', value: pct(topShare) },
          { label: 'Total spend', value: `$${total.toFixed(2)}` },
        ],
        sourceSignalIds: [audience.id],
        confidence: confidenceFromSample(total),
        method: 'spend grouped by publisher_platform, Meta insights',
      });
    }
  }

  if (out.length === 0 && cac) {
    const cost = num(cac.signal_data.cost_per_conversion_usd);
    const conversions = num(cac.signal_data.conversions);
    const spendUsd = num(cac.signal_data.spend_usd);

    if (cost !== null && conversions !== null && spendUsd !== null && conversions >= 5) {
      out.push({
        insightKey: 'meta.cost_per_conversion',
        headline: `Meta is costing $${cost.toFixed(2)} per conversion.`,
        detail: `$${spendUsd.toFixed(2)} produced ${conversions.toLocaleString()} attributed conversions in the last 30 days. Meta attributes generously, so treat this as an upper bound on efficiency rather than a settled number.`,
        recommendedFocus: 'Compare against your own revenue per customer before shifting budget.',
        evidence: [
          { label: 'Spend', value: `$${spendUsd.toFixed(2)}` },
          { label: 'Attributed conversions', value: conversions },
          { label: 'Cost per conversion', value: `$${cost.toFixed(2)}` },
        ],
        sourceSignalIds: [cac.id],
        confidence: confidenceFromSample(conversions * 10),
        method: 'spend ÷ attributed conversion actions over 30 days, Meta insights',
      });
    }
  }

  return out;
}

// ── HubSpot ───────────────────────────────────────────────────────────────────

/** Derives CRM lifecycle insights: where leads stall and which sources actually close. */
export function deriveHubspotInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  // The stage where the funnel narrows hardest is the constraint.
  const quality = first('lead_quality');
  if (quality) {
    const leads     = num(quality.signal_data.leads);
    const mql       = num(quality.signal_data.mql);
    const sql       = num(quality.signal_data.sql);
    const customers = num(quality.signal_data.customers);

    const steps: Array<{ label: string; from: number | null; to: number | null; rate: number | null }> = [
      { label: 'lead to marketing qualified', from: leads, to: mql,       rate: num(quality.signal_data.lead_to_mql) },
      { label: 'marketing to sales qualified', from: mql,   to: sql,       rate: num(quality.signal_data.mql_to_sql) },
      { label: 'sales qualified to customer',  from: sql,   to: customers, rate: num(quality.signal_data.sql_to_customer) },
    ];

    // Only steps with a real denominator and enough volume to mean anything.
    const measurable = steps.filter(s => s.rate !== null && (s.from ?? 0) >= 25);
    if (measurable.length > 0) {
      const worst = measurable.reduce((a, b) => ((a.rate ?? 1) <= (b.rate ?? 1) ? a : b));
      if ((worst.rate ?? 1) < 0.25) {
        out.push({
          insightKey: 'hubspot.weakest_stage_conversion',
          headline: `Only ${pct(worst.rate as number)} of contacts move from ${worst.label.replace(' to ', ' to ')}.`,
          detail: `HubSpot shows ${(worst.from ?? 0).toLocaleString()} contacts at that stage and ${(worst.to ?? 0).toLocaleString()} beyond it. This is the narrowest point in your funnel, so work here compounds further than work anywhere upstream of it.`,
          recommendedFocus: 'Fix this handoff before spending more on filling the top of the funnel.',
          evidence: [
            { label: 'Stage', value: worst.label },
            { label: 'Contacts at stage', value: worst.from ?? 0 },
            { label: 'Contacts past it', value: worst.to ?? 0 },
            { label: 'Conversion', value: pct(worst.rate as number) },
          ],
          sourceSignalIds: [quality.id],
          confidence: confidenceFromSample(worst.from ?? 0),
          method: 'ratios between adjacent HubSpot lifecycle stage counts, steps with ≥25 contacts',
        });
      }
    }
  }

  // Volume and quality diverging by source is the classic CRM finding.
  const source = first('source_quality');
  if (out.length === 0 && source) {
    const perSource = source.signal_data.per_source as
      Array<{ source: string; contacts: number; customers: number; customer_rate: number }> | undefined;

    if (perSource && perSource.length >= 2) {
      const meaningful = perSource.filter(s => s.contacts >= 25);
      if (meaningful.length >= 2) {
        const byVolume  = [...meaningful].sort((a, b) => b.contacts - a.contacts)[0];
        const byQuality = [...meaningful].sort((a, b) => b.customer_rate - a.customer_rate)[0];

        // Worth saying only when the biggest source is not the best one.
        if (byQuality.source !== byVolume.source && byQuality.customer_rate > byVolume.customer_rate * 1.5) {
          out.push({
            insightKey: 'hubspot.volume_quality_mismatch',
            headline: `${byQuality.source} converts ${(byQuality.customer_rate / Math.max(byVolume.customer_rate, 0.0001)).toFixed(1)}× better than ${byVolume.source}, your largest source.`,
            detail: `HubSpot attributes ${byVolume.contacts.toLocaleString()} contacts to ${byVolume.source} converting at ${pct(byVolume.customer_rate)}, against ${byQuality.contacts.toLocaleString()} from ${byQuality.source} at ${pct(byQuality.customer_rate)}. Your biggest source is not your best one, so blended lead counts are hiding the difference.`,
            recommendedFocus: `Judge sources on customers, not contacts.`,
            evidence: [
              { label: 'Largest source', value: byVolume.source },
              { label: 'Its customer rate', value: pct(byVolume.customer_rate) },
              { label: 'Best-converting source', value: byQuality.source },
              { label: 'Its customer rate', value: pct(byQuality.customer_rate) },
            ],
            sourceSignalIds: [source.id],
            confidence: confidenceFromSample(byVolume.contacts + byQuality.contacts),
            method: 'customers ÷ contacts per hs_analytics_source, sources with ≥25 contacts',
          });
        }
      }
    }
  }

  // Deals piling up in one stage.
  const funnel = first('funnel');
  if (out.length === 0 && funnel) {
    const share = num(funnel.signal_data.largest_stage_share);
    const largest = funnel.signal_data.largest_stage as { stage: string; deals: number } | null | undefined;
    const total = num(funnel.signal_data.total_deals);

    if (share !== null && largest && total !== null && total >= 20 && share >= 0.5) {
      out.push({
        insightKey: 'hubspot.deal_stage_pileup',
        headline: `${pct(share)} of your open deals are sitting in one stage.`,
        detail: `HubSpot shows ${largest.deals.toLocaleString()} of ${total.toLocaleString()} deals at "${largest.stage}". A pipeline that bunches in one place is usually a process problem rather than a demand problem.`,
        recommendedFocus: 'Look at what that stage requires before adding more deals to the pipeline.',
        evidence: [
          { label: 'Stage', value: largest.stage },
          { label: 'Deals there', value: largest.deals },
          { label: 'Total deals', value: total },
          { label: 'Share', value: pct(share) },
        ],
        sourceSignalIds: [funnel.id],
        confidence: confidenceFromSample(total),
        method: 'deals grouped by dealstage, largest bucket ÷ total',
      });
    }
  }

  return out;
}

// ── Mailchimp ─────────────────────────────────────────────────────────────────

/** Derives owned-channel insights: whether email earns attention and what it costs. */
export function deriveMailchimpInsights(signals: SignalRow[]): DerivedInsight[] {
  const first = (t: string) => signals.find(s => s.signal_type === t);
  const out: DerivedInsight[] = [];

  const engagement = first('email_engagement');
  const campaigns  = first('campaign_performance');

  // Unsubscribes are the price of sending. When it is high, more sending makes the
  // list smaller — the opposite of what the owner intends.
  if (engagement) {
    const unsubRate = num(engagement.signal_data.unsubscribe_rate);
    const sent      = num(engagement.signal_data.emails_sent);
    const unsubs    = num(engagement.signal_data.unsubscribes);

    if (unsubRate !== null && sent !== null && unsubs !== null && sent >= 500 && unsubRate >= 0.005) {
      out.push({
        insightKey: 'mailchimp.unsubscribe_pressure',
        headline: `Every campaign costs you subscribers — ${pct(unsubRate)} unsubscribe per send.`,
        detail: `Mailchimp recorded ${unsubs.toLocaleString()} unsubscribes across ${sent.toLocaleString()} emails in this window. At this rate, sending more shrinks the audience faster than it grows, so frequency is working against you.`,
        recommendedFocus: 'Send less often to a more relevant segment before increasing volume.',
        evidence: [
          { label: 'Emails sent', value: sent },
          { label: 'Unsubscribes', value: unsubs },
          { label: 'Unsubscribe rate', value: pct(unsubRate) },
        ],
        sourceSignalIds: [engagement.id],
        confidence: confidenceFromSample(sent),
        method: 'unsubscribes ÷ emails sent across campaigns in the window',
      });
    }

    // Click-to-open separates "the subject line worked" from "the email worked".
    const cto  = num(engagement.signal_data.click_to_open_rate);
    const open = num(engagement.signal_data.open_rate);
    if (out.length === 0 && cto !== null && open !== null && sent !== null && sent >= 500) {
      if (open >= 0.2 && cto < 0.08) {
        out.push({
          insightKey: 'mailchimp.opens_without_clicks',
          headline: `${pct(open)} of your emails get opened, but only ${pct(cto)} of those readers click.`,
          detail: `Mailchimp shows people are willing to open what you send and then not act on it. The subject lines are doing their job; the content inside is not carrying them any further.`,
          recommendedFocus: 'Rework what the email asks for, not how it is titled.',
          evidence: [
            { label: 'Open rate', value: pct(open) },
            { label: 'Click-to-open rate', value: pct(cto) },
            { label: 'Emails sent', value: sent },
          ],
          sourceSignalIds: [engagement.id],
          confidence: confidenceFromSample(sent),
          method: 'unique clicks ÷ unique opens, compared with open rate',
        });
      }
    }
  }

  // A wide spread between best and worst campaign is a repeatable pattern to copy.
  if (out.length === 0 && campaigns) {
    const best  = campaigns.signal_data.best  as { campaign: string; click_rate: number; sent: number } | undefined;
    const worst = campaigns.signal_data.worst as { campaign: string; click_rate: number; sent: number } | undefined;
    const analyzed = num(campaigns.signal_data.campaigns_analyzed);

    if (best && worst && analyzed !== null && analyzed >= 3 &&
        best.click_rate > 0 && worst.click_rate >= 0 &&
        best.click_rate >= Math.max(worst.click_rate, 0.001) * 3) {
      out.push({
        insightKey: 'mailchimp.campaign_spread',
        headline: `"${best.campaign}" earned ${pct(best.click_rate)} clicks — your weakest campaign managed ${pct(worst.click_rate)}.`,
        detail: `Across ${analyzed} campaigns Mailchimp shows a wide spread in what your audience responds to. That gap is a pattern worth copying rather than an average worth reporting.`,
        recommendedFocus: `Work out what "${best.campaign}" did differently and repeat it.`,
        evidence: [
          { label: 'Best campaign', value: best.campaign },
          { label: 'Its click rate', value: pct(best.click_rate) },
          { label: 'Weakest campaign', value: worst.campaign },
          { label: 'Its click rate', value: pct(worst.click_rate) },
          { label: 'Campaigns compared', value: analyzed },
        ],
        sourceSignalIds: [campaigns.id],
        confidence: confidenceFromSample(best.sent + worst.sent),
        method: 'per-campaign click rates ranked, best against worst',
      });
    }
  }

  return out;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Per-provider derivation. Adding a provider means adding one entry here; the sync
 * pipeline needs no change.
 */
const DERIVERS: Record<string, (signals: SignalRow[]) => DerivedInsight[]> = {
  app_store_connect: deriveAppStoreInsights,
  revenue_cat:       deriveRevenueCatInsights,
  ga4:               deriveGa4Insights,
  stripe:            deriveStripeInsights,
  search_console:    deriveSearchConsoleInsights,
  google_ads:        deriveGoogleAdsInsights,
  meta_ads:          deriveMetaInsights,
  hubspot:           deriveHubspotInsights,
  mailchimp:         deriveMailchimpInsights,
};

/**
 * Derives insights for whichever provider produced these signals.
 * @returns Insights, or [] when the provider has no rules yet or the data says nothing
 */
export function deriveInsightsForProvider(provider: string, signals: SignalRow[]): DerivedInsight[] {
  const derive = DERIVERS[provider];
  return derive ? derive(signals) : [];
}

/**
 * Persists derived insights, superseding any previous version of the same rule.
 *
 * @param args.signals - Rows this sync wrote, used for provenance
 * @returns The insights that were stored
 * @security workspace_id is written on every row; supersede is scoped by connection.
 */
export async function persistInsights(args: {
  workspaceId:  string;
  connectionId: string;
  productId:    string | null;
  provider:     string;
  syncRunId:    string;
  traceId:      string;
  reportName:   string | null;
  periodStart:  string | null;
  periodEnd:    string | null;
  insights:     DerivedInsight[];
}): Promise<DerivedInsight[]> {
  if (args.insights.length === 0) return [];

  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Supersede the previous live version of each rule so history accumulates without
  // violating the one-live-insight-per-rule index.
  for (const insight of args.insights) {
    await db
      .from('connection_insights')
      .update({ superseded_at: now })
      .eq('connection_id', args.connectionId)
      .eq('workspace_id', args.workspaceId)
      .eq('insight_key', insight.insightKey)
      .is('superseded_at', null);
  }

  const { error } = await db.from('connection_insights').insert(
    args.insights.map((i, rank) => ({
      workspace_id:      args.workspaceId,
      connection_id:     args.connectionId,
      product_id:        args.productId,
      provider:          args.provider,
      insight_key:       i.insightKey,
      headline:          i.headline,
      detail:            i.detail,
      recommended_focus: i.recommendedFocus,
      evidence:          i.evidence,
      source_signal_ids: i.sourceSignalIds,
      provenance: {
        provider:     args.provider,
        report_name:  args.reportName,
        sync_run_id:  args.syncRunId,
        period_start: args.periodStart,
        period_end:   args.periodEnd,
        computed_at:  now,
        method:       i.method,
      },
      confidence:   i.confidence,
      // The deriver's own ordering. Kept because every row in this batch shares
      // created_at, so without it "the latest insight" is an arbitrary pick.
      display_rank: rank,
      period_start: args.periodStart,
      period_end:   args.periodEnd,
      sync_run_id:  args.syncRunId,
      trace_id:     args.traceId,
    })),
  );

  if (error) {
    // An insight is downstream of the sync. Losing it must not discard imported data.
    console.error(`[connectionInsightService] insight persist failed trace=${args.traceId}: ${error.message}`);
    return [];
  }

  return args.insights;
}

/** A stored insight as returned to a surface. */
export interface StoredInsight {
  id:                string;
  connection_id:     string;
  provider:          string;
  insight_key:       string;
  headline:          string;
  detail:            string;
  recommended_focus: string | null;
  evidence:          EvidenceItem[];
  provenance:        Record<string, unknown>;
  confidence:        number | null;
  period_start:      string | null;
  period_end:        string | null;
  created_at:        string;
}

/**
 * Returns current (non-superseded) insights for a workspace, newest first.
 * Shared by Growth Brain, Morning Brief, and Improve Intelligence so all three read
 * the same persisted state.
 */
export async function getLiveInsights(
  workspaceId: string,
  opts: { connectionId?: string; provider?: string; limit?: number } = {},
): Promise<StoredInsight[]> {
  let q = getSupabaseAdmin()
    .from('connection_insights')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('superseded_at', null)
    // Newest batch first, then the deriver's own ordering within that batch.
    // Both clauses are needed: rows from one sync share created_at exactly, so
    // without display_rank the "latest insight" differed between surfaces.
    .order('created_at',   { ascending: false })
    .order('display_rank', { ascending: true })
    .limit(opts.limit ?? 10);

  if (opts.connectionId) q = q.eq('connection_id', opts.connectionId);
  if (opts.provider)     q = q.eq('provider', opts.provider);

  const { data } = await q;
  return (data ?? []) as unknown as StoredInsight[];
}

/**
 * Reads back the signals a sync just wrote, so insights are derived from what is
 * actually persisted rather than from in-memory values.
 */
export async function readSyncedSignals(
  workspaceId: string,
  provider: string,
  traceId: string,
): Promise<SignalRow[]> {
  const { data } = await getSupabaseAdmin()
    .from('intelligence_signals')
    .select('id, signal_type, signal_data, period_start, period_end')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('trace_id', traceId);

  return (data ?? []) as unknown as SignalRow[];
}
