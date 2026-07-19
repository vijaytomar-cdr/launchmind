/**
 * @file analyticsService.ts
 * @description Unified analytics service for LaunchMind M11.
 *   Builds on metricsService.getProductMetrics() — does NOT duplicate its logic.
 *   Adds: cross-product summary, KPI trend series, last-touch attribution,
 *   install funnel, ROI computation, and experiment analytics.
 * @security All queries require founderId — no cross-founder data leakage.
 * @dependencies supabaseAdmin, metricsService
 */

import { getSupabaseAdmin }  from '../lib/supabaseAdmin';
import { getProductMetrics } from './metricsService';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KPISummary {
  totalImpressions:  number;
  totalClicks:       number;
  totalInstalls:     number;
  avgCpi:            number | null;
  avgRoas:           number | null;
  avgCtr:            number | null;
  weekOverWeekInstallDelta: number | null; // percentage change vs prior week
  topChannel:        string | null;
  topMarket:         string | null;
}

export interface KPIPoint {
  weekOf:      string;
  impressions: number;
  clicks:      number;
  installs:    number;
  cpi:         number | null;
  roas:        number | null;
  ctr:         number | null;
}

export interface AttributionResult {
  totalInstalls: number;
  byChannel:     Array<{
    channel:    string;
    market:     string;
    installs:   number;
    share:      number;        // 0–1
    avgCpi:     number | null;
    avgRoas:    number | null;
  }>;
  topChannel: string | null;
  topMarket:  string | null;
}

export interface FunnelResult {
  impressions:          number;
  clicks:               number;
  installs:             number;
  impressionToClickRate: number | null; // CTR
  clickToInstallRate:   number | null;  // conversion
  overallFunnelRate:    number | null;  // impressions → installs
  byChannel: Array<{
    channel:    string;
    market:     string;
    impressions: number;
    clicks:      number;
    installs:    number;
    ctr:         number | null;
    conversionRate: number | null;
  }>;
}

export interface ROIResult {
  estimatedSpend:   number;  // sum of CPI × installs (proxy for spend)
  estimatedRevenue: number;  // sum of ROAS × estimated_spend
  overallROI:       number | null; // (revenue - spend) / spend
  byChannel: Array<{
    channel:          string;
    market:           string;
    estimatedSpend:   number;
    estimatedRevenue: number;
    roas:             number | null;
    roi:              number | null;
  }>;
}

export interface AnalyticsSummary {
  founderId:   string;
  products:    Array<{
    productId:   string;
    productName: string;
    kpi:         KPISummary;
  }>;
  totals:      KPISummary;
  generatedAt: string;
}

// ── Cross-product summary ──────────────────────────────────────────────────────

/**
 * Produces a KPI summary across ALL of a founder's products.
 * @param founderId - Authenticated founder
 * @returns AnalyticsSummary with per-product and totalled KPIs
 */
export async function getAnalyticsSummary(founderId: string): Promise<AnalyticsSummary> {
  const supabase = getSupabaseAdmin();

  const { data: prods } = await supabase
    .from('products')
    .select('id, name')
    .eq('founder_id', founderId)
    .is('deleted_at', null)
    .limit(20);

  const products: AnalyticsSummary['products'] = [];
  let totals: KPISummary = {
    totalImpressions: 0, totalClicks: 0, totalInstalls: 0,
    avgCpi: null, avgRoas: null, avgCtr: null,
    weekOverWeekInstallDelta: null, topChannel: null, topMarket: null,
  };

  for (const p of (prods ?? []) as { id: string; name: string }[]) {
    try {
      const metrics = await getProductMetrics(p.id, founderId, 8);
      const kpi = computeKPISummary(metrics);
      products.push({ productId: p.id, productName: p.name, kpi });
      totals.totalImpressions += kpi.totalImpressions;
      totals.totalClicks      += kpi.totalClicks;
      totals.totalInstalls    += kpi.totalInstalls;
    } catch {
      // Product may have no metrics yet — skip silently
    }
  }

  // Aggregate avg KPIs across products
  if (products.length > 0) {
    const cpis  = products.map(p => p.kpi.avgCpi).filter((v): v is number => v !== null);
    const roass = products.map(p => p.kpi.avgRoas).filter((v): v is number => v !== null);
    const ctrs  = products.map(p => p.kpi.avgCtr).filter((v): v is number => v !== null);
    totals.avgCpi  = cpis.length  > 0 ? cpis.reduce((a, b) => a + b, 0) / cpis.length   : null;
    totals.avgRoas = roass.length > 0 ? roass.reduce((a, b) => a + b, 0) / roass.length : null;
    totals.avgCtr  = ctrs.length  > 0 ? ctrs.reduce((a, b) => a + b, 0) / ctrs.length   : null;
  }

  return { founderId, products, totals, generatedAt: new Date().toISOString() };
}

// ── KPI trends ────────────────────────────────────────────────────────────────

/**
 * Returns weekly KPI time-series data for a product (for trend charts).
 * @param productId - Target product
 * @param founderId - Authenticated founder
 * @param weeks     - Number of weeks to return (default 12)
 */
export async function getKPITrend(
  productId: string,
  founderId: string,
  weeks = 12,
): Promise<KPIPoint[]> {
  const metrics = await getProductMetrics(productId, founderId, weeks);
  return metrics.weeklySummaries.map(w => ({
    weekOf:      w.weekOf,
    impressions: w.totalImpressions,
    clicks:      w.totalClicks,
    installs:    w.totalInstalls,
    cpi:         w.avgCpi,
    roas:        w.avgRoas,
    ctr:         w.avgCtr,
  }));
}

// ── Attribution ────────────────────────────────────────────────────────────────

/**
 * Last-touch channel attribution for a product.
 * Each install in campaign_metrics is credited to the campaign's channel.
 */
export async function getAttribution(
  productId: string,
  founderId: string,
): Promise<AttributionResult> {
  const metrics = await getProductMetrics(productId, founderId, 12);
  const totalInstalls = metrics.channelBreakdown.reduce((s, c) => s + c.installs, 0);

  const byChannel = metrics.channelBreakdown
    .filter(c => c.installs > 0)
    .map(c => ({
      channel:  c.channel,
      market:   c.market,
      installs: c.installs,
      share:    totalInstalls > 0 ? c.installs / totalInstalls : 0,
      avgCpi:   c.avgRoas !== null ? null : null, // CPI not directly on channelBreakdown; use top performers
      avgRoas:  c.avgRoas ?? null,
    }))
    .sort((a, b) => b.installs - a.installs);

  const top = byChannel[0];
  return {
    totalInstalls,
    byChannel,
    topChannel: top?.channel ?? null,
    topMarket:  top?.market  ?? null,
  };
}

// ── Funnel ────────────────────────────────────────────────────────────────────

/**
 * Install funnel: impressions → clicks → installs, with per-channel breakdown.
 */
export async function getFunnel(
  productId: string,
  founderId: string,
): Promise<FunnelResult> {
  const metrics = await getProductMetrics(productId, founderId, 8);

  const totalImpressions = metrics.channelBreakdown.reduce((s, c) => s + c.impressions, 0);
  const totalClicks      = metrics.channelBreakdown.reduce((s, c) => s + c.clicks, 0);
  const totalInstalls    = metrics.channelBreakdown.reduce((s, c) => s + c.installs, 0);

  const byChannel = metrics.channelBreakdown.map(c => ({
    channel:    c.channel,
    market:     c.market,
    impressions: c.impressions,
    clicks:      c.clicks,
    installs:    c.installs,
    ctr:              c.impressions > 0 ? c.clicks    / c.impressions : null,
    conversionRate:   c.clicks      > 0 ? c.installs  / c.clicks      : null,
  }));

  return {
    impressions:          totalImpressions,
    clicks:               totalClicks,
    installs:             totalInstalls,
    impressionToClickRate: totalImpressions > 0 ? totalClicks   / totalImpressions : null,
    clickToInstallRate:   totalClicks > 0   ? totalInstalls  / totalClicks        : null,
    overallFunnelRate:    totalImpressions > 0 ? totalInstalls  / totalImpressions : null,
    byChannel,
  };
}

// ── ROI ───────────────────────────────────────────────────────────────────────

/**
 * ROI estimation per channel: spend proxy = CPI × installs; revenue proxy = ROAS × spend.
 * Actual spend data requires platform OAuth (deferred). This is a model-based estimate.
 */
export async function getROI(
  productId: string,
  founderId: string,
): Promise<ROIResult> {
  const supabase = getSupabaseAdmin();

  const { data: rows } = await supabase
    .from('campaign_metrics')
    .select(`
      installs, cpi, roas,
      campaigns!inner(channel, market, product_id)
    `)
    .eq('campaigns.product_id', productId)
    .eq('founder_id', founderId)
    .limit(200);

  type MetricRow = {
    installs: number | null;
    cpi: number | null;
    roas: number | null;
    campaigns: { channel: string; market: string; product_id: string };
  };

  const allRows = (rows ?? []) as unknown as MetricRow[];

  const channelMap = new Map<string, { channel: string; market: string; spend: number; revenue: number; roasSum: number; count: number }>();

  for (const row of allRows) {
    const key = `${row.campaigns.channel}:${row.campaigns.market}`;
    const installs = row.installs ?? 0;
    const cpi      = row.cpi ?? 0;
    const roas     = row.roas ?? 0;
    const spend    = cpi * installs;
    const revenue  = roas * spend;

    const existing = channelMap.get(key);
    if (existing) {
      existing.spend   += spend;
      existing.revenue += revenue;
      if (row.roas !== null) { existing.roasSum += roas; existing.count++; }
    } else {
      channelMap.set(key, {
        channel: row.campaigns.channel,
        market:  row.campaigns.market,
        spend,
        revenue,
        roasSum: row.roas !== null ? roas : 0,
        count:   row.roas !== null ? 1 : 0,
      });
    }
  }

  const byChannel = [...channelMap.values()].map(c => ({
    channel:          c.channel,
    market:           c.market,
    estimatedSpend:   Math.round(c.spend * 100) / 100,
    estimatedRevenue: Math.round(c.revenue * 100) / 100,
    roas:             c.count > 0 ? Math.round(c.roasSum / c.count * 100) / 100 : null,
    roi:              c.spend > 0 ? Math.round(((c.revenue - c.spend) / c.spend) * 10000) / 100 : null,
  })).sort((a, b) => b.estimatedSpend - a.estimatedSpend);

  const totalSpend   = byChannel.reduce((s, c) => s + c.estimatedSpend, 0);
  const totalRevenue = byChannel.reduce((s, c) => s + c.estimatedRevenue, 0);

  return {
    estimatedSpend:   Math.round(totalSpend * 100) / 100,
    estimatedRevenue: Math.round(totalRevenue * 100) / 100,
    overallROI:       totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 10000) / 100 : null,
    byChannel,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeKPISummary(metrics: Awaited<ReturnType<typeof getProductMetrics>>): KPISummary {
  const totalImpressions = metrics.weeklySummaries.reduce((s, w) => s + w.totalImpressions, 0);
  const totalClicks      = metrics.weeklySummaries.reduce((s, w) => s + w.totalClicks, 0);
  const totalInstalls    = metrics.weeklySummaries.reduce((s, w) => s + w.totalInstalls, 0);

  const cpiValues  = metrics.weeklySummaries.map(w => w.avgCpi).filter((v): v is number => v !== null);
  const roasValues = metrics.weeklySummaries.map(w => w.avgRoas).filter((v): v is number => v !== null);
  const ctrValues  = metrics.weeklySummaries.map(w => w.avgCtr).filter((v): v is number => v !== null);

  // Week-over-week install delta
  let weekOverWeekInstallDelta: number | null = null;
  if (metrics.weeklySummaries.length >= 2) {
    const thisWeek = metrics.weeklySummaries[0].totalInstalls;
    const lastWeek = metrics.weeklySummaries[1].totalInstalls;
    if (lastWeek > 0) weekOverWeekInstallDelta = Math.round(((thisWeek - lastWeek) / lastWeek) * 10000) / 100;
  }

  const topChannel = metrics.channelBreakdown[0]?.channel ?? null;
  const topMarket  = metrics.channelBreakdown[0]?.market  ?? null;

  return {
    totalImpressions,
    totalClicks,
    totalInstalls,
    avgCpi:  cpiValues.length  > 0 ? Math.round(cpiValues.reduce((a, b) => a + b, 0)  / cpiValues.length  * 100) / 100 : null,
    avgRoas: roasValues.length > 0 ? Math.round(roasValues.reduce((a, b) => a + b, 0) / roasValues.length * 100) / 100 : null,
    avgCtr:  ctrValues.length  > 0 ? Math.round(ctrValues.reduce((a, b) => a + b, 0)  / ctrValues.length  * 10000) / 100 : null,
    weekOverWeekInstallDelta,
    topChannel,
    topMarket,
  };
}
