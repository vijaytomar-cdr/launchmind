/**
 * @file intelligenceNetworkService.ts
 * @description Intelligence Network — privacy-preserving signal aggregation.
 *   Ingests anonymous campaign outcomes, computes category-level benchmarks,
 *   and maintains trend snapshots in intelligence_trends.
 * @security
 *   - NEVER stores founder_id, product_id, or any PII in signals or trends.
 *   - Minimum cohort: 3 products required before publishing a benchmark.
 *   - Only service_role may write to playbook_signals and intelligence_trends.
 * @dependencies supabaseAdmin
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export interface AnonymousSignal {
  category: string;
  market: 'usa' | 'india';
  channel: string;
  hookType?: string;
  priceTier?: string;
  installDeltaPct?: number;
  conversionRate?: number;
  retentionD7?: number;
  weekNumber?: number;
}

export interface BenchmarkResult {
  category: string;
  market: string;
  channel: string | null;
  avgInstallDeltaPct: number;
  medianInstallDeltaPct: number;
  avgConversionRate: number;
  avgRetentionD7: number;
  topChannel: string | null;
  signalCount: number;
  period: string;
}

export interface TrendSummary {
  category: string;
  market: string;
  channel: string | null;
  trendType: string;
  direction: 'up' | 'down' | 'flat' | 'volatile';
  magnitude: number;
  periodDays: number;
  summary: string;
  computedAt: string;
}

/**
 * Ingests an anonymous campaign outcome into playbook_signals.
 * Called after campaign completion — strips all identifying data before storage.
 * Skipped if the category cohort is below the minimum (privacy guard).
 */
export async function ingestCampaignOutcome(signal: AnonymousSignal): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    // Privacy guard: check cohort size before inserting
    const { count } = await supabase
      .from('playbook_signals')
      .select('id', { count: 'exact', head: true })
      .eq('category', signal.category)
      .eq('market', signal.market);

    // Minimum 3 signals in category before we add more (bootstrap exception: allow first 3)
    // After 3, always allow — the cohort is already established
    if ((count ?? 0) > 0 && (count ?? 0) < 3) {
      // Below minimum cohort — skip to prevent re-identification
      return;
    }

    await supabase.from('playbook_signals').insert({
      category:          signal.category,
      market:            signal.market,
      channel:           signal.channel,
      hook_type:         signal.hookType ?? null,
      price_tier:        signal.priceTier ?? null,
      install_delta_pct: signal.installDeltaPct ?? null,
      conversion_rate:   signal.conversionRate ?? null,
      retention_d7:      signal.retentionD7 ?? null,
      week_number:       signal.weekNumber ?? null,
    });
  } catch (err) {
    // Non-fatal — intelligence ingestion should never fail a campaign completion
    Sentry.captureException(err, { tags: { service: 'intelligenceNetwork', fn: 'ingestCampaignOutcome' } });
  }
}

/**
 * Returns benchmark aggregates for a category+market combination.
 * Reads from playbook_signals (no PII). Any authenticated founder can call this.
 */
export async function getBenchmarks(
  category: string,
  market: string,
  channel?: string,
): Promise<BenchmarkResult | null> {
  try {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('playbook_signals')
      .select('channel, install_delta_pct, conversion_rate, retention_d7')
      .eq('category', category)
      .eq('market', market);

    if (channel) query = query.eq('channel', channel);

    const { data: signals, error } = await query;

    if (error || !signals || signals.length < 3) return null;

    type SignalRow = { channel: string | null; install_delta_pct: number | null; conversion_rate: number | null; retention_d7: number | null };
    const rows = signals as SignalRow[];

    const installDeltas = rows.map(s => s.install_delta_pct ?? 0).filter(v => v !== 0).sort((a, b) => a - b);
    const conversions   = rows.map(s => s.conversion_rate  ?? 0).filter(v => v !== 0);
    const retentions    = rows.map(s => s.retention_d7     ?? 0).filter(v => v !== 0);

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    };

    // Top channel by signal count
    const channelCounts: Record<string, number> = {};
    rows.forEach(s => { if (s.channel) channelCounts[s.channel] = (channelCounts[s.channel] ?? 0) + 1; });
    const topChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      category,
      market,
      channel: channel ?? null,
      avgInstallDeltaPct:    Math.round(avg(installDeltas) * 10) / 10,
      medianInstallDeltaPct: Math.round(median(installDeltas) * 10) / 10,
      avgConversionRate:     Math.round(avg(conversions) * 10000) / 10000,
      avgRetentionD7:        Math.round(avg(retentions) * 10000) / 10000,
      topChannel,
      signalCount: rows.length,
      period: 'all_time',
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'intelligenceNetwork', fn: 'getBenchmarks' } });
    return null;
  }
}

/**
 * Returns pre-computed trend summaries for a category+market.
 * Reads from intelligence_trends (computed by weekly cron).
 */
export async function getTrends(
  category: string,
  market: string,
  periodDays: 30 | 90 = 30,
): Promise<TrendSummary[]> {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('intelligence_trends')
      .select('category, market, channel, trend_type, direction, magnitude, period_days, summary, computed_at')
      .eq('category', category)
      .eq('market', market)
      .eq('period_days', periodDays)
      .order('computed_at', { ascending: false });

    if (error || !data) return [];

    return (data as {
      category: string; market: string; channel: string | null;
      trend_type: string; direction: string; magnitude: number | null;
      period_days: number; summary: string | null; computed_at: string;
    }[]).map(t => ({
      category:   t.category,
      market:     t.market,
      channel:    t.channel,
      trendType:  t.trend_type,
      direction:  t.direction as 'up' | 'down' | 'flat' | 'volatile',
      magnitude:  t.magnitude ?? 0,
      periodDays: t.period_days,
      summary:    t.summary ?? '',
      computedAt: t.computed_at,
    }));
  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'intelligenceNetwork', fn: 'getTrends' } });
    return [];
  }
}

/**
 * Weekly cron job: compute trend snapshots from playbook_signals.
 * Called by BullMQ scheduler. Upserts intelligence_trends rows.
 * Non-fatal — errors logged to Sentry but do not interrupt other cron jobs.
 */
export async function computeTrends(): Promise<{ computed: number; skipped: number }> {
  const supabase = getSupabaseAdmin();
  let computed = 0;
  let skipped = 0;

  try {
    // Fetch all distinct category+market combinations
    const { data: combos } = await supabase
      .from('playbook_signals')
      .select('category, market')
      .order('category');

    if (!combos || combos.length === 0) return { computed, skipped };

    // Deduplicate
    const seen = new Set<string>();
    const unique: { category: string; market: string }[] = [];
    for (const c of combos as { category: string; market: string }[]) {
      const key = `${c.category}:${c.market}`;
      if (!seen.has(key)) { seen.add(key); unique.push(c); }
    }

    for (const { category, market } of unique) {
      const { data: signals } = await supabase
        .from('playbook_signals')
        .select('channel, install_delta_pct, conversion_rate, retention_d7, week_number, created_at')
        .eq('category', category)
        .eq('market', market)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!signals || signals.length < 3) { skipped++; continue; }

      type SRow = { channel: string | null; install_delta_pct: number | null; conversion_rate: number | null; retention_d7: number | null; created_at: string };
      const rows = signals as SRow[];

      // Recent 30d vs older — compare averages to determine direction
      const now = Date.now();
      const recent = rows.filter(r => (now - new Date(r.created_at).getTime()) < 30 * 86400000);
      const older  = rows.filter(r => (now - new Date(r.created_at).getTime()) >= 30 * 86400000);

      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const recentInstall = avg(recent.map(r => r.install_delta_pct ?? 0).filter(Boolean));
      const olderInstall  = avg(older.map(r => r.install_delta_pct ?? 0).filter(Boolean));

      let direction: 'up' | 'down' | 'flat' | 'volatile' = 'flat';
      let magnitude = 0;

      if (olderInstall !== 0) {
        magnitude = ((recentInstall - olderInstall) / Math.abs(olderInstall)) * 100;
        if (Math.abs(magnitude) < 5) direction = 'flat';
        else if (magnitude > 0) direction = 'up';
        else direction = 'down';
      }

      const summary = direction === 'flat'
        ? `Install rates in ${category} apps (${market.toUpperCase()}) are stable`
        : `Install rates in ${category} apps (${market.toUpperCase()}) are trending ${direction} by ${Math.abs(Math.round(magnitude))}%`;

      await supabase.from('intelligence_trends').upsert({
        category,
        market,
        channel:       null,
        trend_type:    'install_growth',
        direction,
        magnitude:     Math.round(magnitude * 100) / 100,
        period_days:   30,
        signal_count:  rows.length,
        summary,
        benchmark_data: {
          avg:    Math.round(recentInstall * 10) / 10,
          recent: recent.length,
          older:  older.length,
        },
      }, { onConflict: 'category,market,trend_type,period_days,channel' });

      computed++;
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'intelligenceNetwork', fn: 'computeTrends' } });
  }

  return { computed, skipped };
}
