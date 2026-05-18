/**
 * @file metricsService.ts
 * @description Campaign performance metrics aggregation for the LaunchMind dashboard.
 *   Reads from campaign_metrics + campaigns tables to produce weekly summaries,
 *   channel/market breakdowns, and trend data for a product.
 * @security Requires founderId on every query — never returns cross-founder data.
 * @dependencies supabaseAdmin
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export interface WeeklySummary {
  weekOf: string;
  totalImpressions: number;
  totalClicks: number;
  totalInstalls: number;
  avgCpi: number | null;
  avgRoas: number | null;
  avgCtr: number | null;
}

export interface ChannelBreakdown {
  channel: string;
  market: string;
  impressions: number;
  clicks: number;
  installs: number;
  avgRoas: number | null;
  campaignCount: number;
}

export interface TopPerformer {
  campaignId: string;
  channel: string;
  market: string;
  hookType: string | null;
  weekOf: string;
  installs: number;
  roas: number | null;
  ctr: number | null;
}

export interface ProductMetrics {
  productId: string;
  weeklySummaries: WeeklySummary[];
  channelBreakdown: ChannelBreakdown[];
  topPerformers: TopPerformer[];
  weekCount: number;
}

/**
 * Aggregates campaign metrics for a product over the last N weeks.
 * @param productId  - UUID of the product
 * @param founderId  - UUID of the authenticated founder (ownership check)
 * @param weekCount  - Number of weeks to include (default: 8)
 * @returns          Aggregated metrics: weekly summaries, channel breakdown, top performers
 * @throws           {Error} If product not found or DB error
 * @security         founderId filters ensure no cross-founder data leakage.
 */
export async function getProductMetrics(
  productId: string,
  founderId: string,
  weekCount = 8
): Promise<ProductMetrics> {
  const supabase = getSupabaseAdmin();

  // Verify product ownership
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .single();

  if (productError || !product) {
    throw new Error(`Product not found or access denied: ${productId}`);
  }

  // Fetch campaign_metrics joined with campaigns for this product
  const { data: rows, error: metricsError } = await supabase
    .from('campaign_metrics')
    .select(`
      week_start,
      impressions,
      clicks,
      installs,
      cpi,
      ctr,
      roas,
      campaign_id,
      campaigns!inner (
        id,
        channel,
        market,
        hook_type,
        product_id
      )
    `)
    .eq('campaigns.product_id', productId)
    .eq('founder_id', founderId)
    .order('week_start', { ascending: false })
    .limit(weekCount * 20); // up to 20 campaigns per week

  if (metricsError) throw new Error(`Failed to fetch metrics: ${metricsError.message}`);

  const allRows = (rows ?? []) as unknown as Array<{
    week_start: string;
    impressions: number;
    clicks: number;
    installs: number;
    cpi: number | null;
    ctr: number | null;
    roas: number | null;
    campaign_id: string;
    campaigns: {
      id: string;
      channel: string;
      market: string;
      hook_type: string | null;
      product_id: string;
    };
  }>;

  // Get unique weeks (sorted desc) and limit to weekCount
  const allWeeks = [...new Set(allRows.map((r) => r.week_start))].sort().reverse().slice(0, weekCount);

  // Weekly summaries
  const weeklySummaries: WeeklySummary[] = allWeeks.map((weekOf) => {
    const weekRows = allRows.filter((r) => r.week_start === weekOf);
    const totalImpressions = weekRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    const totalClicks = weekRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    const totalInstalls = weekRows.reduce((s, r) => s + (r.installs ?? 0), 0);
    const roasRows = weekRows.filter((r) => r.roas !== null && r.roas !== undefined);
    const cpiRows = weekRows.filter((r) => r.cpi !== null && r.cpi !== undefined);
    const ctrRows = weekRows.filter((r) => r.ctr !== null && r.ctr !== undefined);
    return {
      weekOf,
      totalImpressions,
      totalClicks,
      totalInstalls,
      avgRoas: roasRows.length > 0 ? roasRows.reduce((s, r) => s + r.roas!, 0) / roasRows.length : null,
      avgCpi: cpiRows.length > 0 ? cpiRows.reduce((s, r) => s + r.cpi!, 0) / cpiRows.length : null,
      avgCtr: ctrRows.length > 0 ? ctrRows.reduce((s, r) => s + r.ctr!, 0) / ctrRows.length : null,
    };
  });

  // Channel × market breakdown (across all weeks)
  const channelMap = new Map<string, ChannelBreakdown>();
  for (const row of allRows) {
    const key = `${row.campaigns.channel}:${row.campaigns.market}`;
    const existing = channelMap.get(key);
    if (existing) {
      existing.impressions += row.impressions ?? 0;
      existing.clicks += row.clicks ?? 0;
      existing.installs += row.installs ?? 0;
      existing.campaignCount += 1;
      if (row.roas !== null) {
        existing.avgRoas = existing.avgRoas === null
          ? row.roas
          : (existing.avgRoas * (existing.campaignCount - 1) + row.roas) / existing.campaignCount;
      }
    } else {
      channelMap.set(key, {
        channel: row.campaigns.channel,
        market: row.campaigns.market,
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        installs: row.installs ?? 0,
        avgRoas: row.roas ?? null,
        campaignCount: 1,
      });
    }
  }
  const channelBreakdown = [...channelMap.values()].sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));

  // Top performers: campaigns with installs > 0 or roas > 1, sorted by roas desc
  const topPerformers: TopPerformer[] = allRows
    .filter((r) => (r.installs ?? 0) > 0 || (r.roas ?? 0) > 1)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, 10)
    .map((r) => ({
      campaignId: r.campaign_id,
      channel: r.campaigns.channel,
      market: r.campaigns.market,
      hookType: r.campaigns.hook_type,
      weekOf: r.week_start,
      installs: r.installs ?? 0,
      roas: r.roas ?? null,
      ctr: r.ctr ?? null,
    }));

  return {
    productId,
    weeklySummaries,
    channelBreakdown,
    topPerformers,
    weekCount: allWeeks.length,
  };
}
