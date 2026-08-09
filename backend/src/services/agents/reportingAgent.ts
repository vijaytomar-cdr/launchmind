/**
 * @file agents/reportingAgent.ts
 * @description Reporting agent — aggregates weekly metrics and generates brief summaries.
 *   Runs in 'reporting' missions (weekly cron) and as a final step in content/campaign missions.
 * @security No direct DB access. Admin client used for metric aggregation.
 * @dependencies aiPlatform (callSonnet), supabaseAdmin
 */

import { callSonnet } from '../../lib/aiPlatform';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { AgentFn } from '../../types/mission';

const BRIEF_SYSTEM = `You are a marketing performance analyst. Given weekly metrics,
generate a concise performance brief with: whatWorked (2-3 bullets), whatToKill (1-2 bullets),
nextActions (3 items with priority), keyMetric (string), trend (up|down|flat).
Return a JSON object with these keys.`;

/**
 * Reporting agent — aggregates campaign metrics and generates a weekly performance brief.
 * @param input  May include explicit productId, weekStart date
 * @returns Brief content with whatWorked, whatToKill, nextActions
 */
export const reportingAgent: AgentFn = async (input, context) => {
  const { founderId, contextPkg } = context;

  await context.log('Reporting agent starting', 'info', { founderId });

  const supabase  = getSupabaseAdmin();
  const productId = (input.productId as string) ?? contextPkg.productId;

  // Compute week start (last Monday)
  const now       = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysBack  = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
    .toISOString()
    .split('T')[0];

  // Fetch metrics for this week
  let metricsData: Record<string, unknown>[] = [];
  if (productId) {
    const { data } = await supabase
      .from('campaign_metrics')
      .select('impressions, clicks, installs, cpi, ctr, roas, top_performing_asset, week_start')
      .eq('founder_id', founderId)
      .gte('week_start', weekStart)
      .order('week_start', { ascending: false })
      .limit(20);
    metricsData = (data ?? []) as Record<string, unknown>[];
  }

  // Aggregate totals
  const totals = metricsData.reduce<{ impressions: number; clicks: number; installs: number }>(
    (acc, m) => ({
      impressions: acc.impressions + ((m.impressions as number) ?? 0),
      clicks:      acc.clicks      + ((m.clicks as number)      ?? 0),
      installs:    acc.installs    + ((m.installs as number)     ?? 0),
    }),
    { impressions: 0, clicks: 0, installs: 0 },
  );

  await context.log('Generating performance brief', 'debug', { metricsCount: metricsData.length });

  const prompt = `Weekly metrics for ${contextPkg.product?.name ?? 'product'}:
Total impressions: ${totals.impressions}
Total clicks: ${totals.clicks}
Total installs: ${totals.installs}
Week of: ${weekStart}

Detailed metrics: ${JSON.stringify(metricsData.slice(0, 10), null, 2)}

Generate a performance brief.`;

  let briefContent: Record<string, unknown> = {
    whatWorked:  ['Insufficient data to generate brief'],
    whatToKill:  [],
    nextActions: [],
    keyMetric:   `${totals.installs} installs`,
    trend:       'flat',
  };

  if (metricsData.length > 0) {
    try {
      const result = await callSonnet(BRIEF_SYSTEM, prompt, 1024, { founderId, productId: productId ?? null, promptId: 'agent_reporting_brief', action: 'agent_reporting_brief' });
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) briefContent = JSON.parse(jsonMatch[0]);
    } catch (err) {
      await context.log(`Brief generation failed: ${(err as Error).message}`, 'warn');
    }
  }

  await context.log('Reporting agent complete', 'info');

  return {
    weekStart,
    totals,
    brief:       briefContent,
    generatedAt: new Date().toISOString(),
  };
};
