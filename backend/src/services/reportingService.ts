/**
 * @file reportingService.ts
 * @description Report generation engine for LaunchMind M11.
 *   Generates weekly, monthly, executive, campaign, and experiment reports.
 *   Caches generated content in the reports table — only regenerates when forced.
 *   Weekly reports trigger ingestLearningEvent to feed Marketing Memory.
 * @security Reports are founder-scoped. RLS + route-level owner check on every query.
 * @dependencies supabaseAdmin, aiPlatform, analyticsService, learningPipelineService
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin }    from '../lib/supabaseAdmin';
import { callSonnet, callHaiku } from '../lib/aiPlatform';
import { getProductMetrics }   from './metricsService';
import { ingestLearningEvent } from './learningPipelineService';
import { consumeTokens }       from '../lib/tokens';

export type ReportType = 'weekly' | 'monthly' | 'executive' | 'campaign' | 'experiment';

export interface GenerateReportParams {
  founderId:   string;
  productId:   string;
  reportType:  ReportType;
  periodStart: string;  // YYYY-MM-DD
  periodEnd:   string;  // YYYY-MM-DD
  force?:      boolean; // skip cache
  contextData?: Record<string, unknown>; // campaign/experiment id for targeted reports
}

export interface ReportContent {
  headline:     string;
  summary:      string;
  whatWorked:   string[];
  whatToFix:    string[];
  keyInsights:  string[];
  nextActions:  string[];
  riskFlags?:   string[];
  metricsTable?: Array<{ label: string; value: string | number | null; delta?: string }>;
}

/**
 * Generates (or returns cached) a report for the specified period and type.
 * @returns The report row ID and whether it was newly generated.
 */
export async function generateReport(params: GenerateReportParams): Promise<{
  reportId: string;
  created: boolean;
  content: ReportContent;
  tokensConsumed: number;
}> {
  const supabase  = getSupabaseAdmin();
  const { founderId, productId, reportType, periodStart, periodEnd, force, contextData } = params;

  // ── Cache check ────────────────────────────────────────────────────────────
  if (!force) {
    const { data: existing } = await supabase
      .from('reports')
      .select('id, content')
      .eq('founder_id', founderId)
      .eq('product_id', productId)
      .eq('report_type', reportType)
      .eq('period_start', periodStart)
      .eq('status', 'ready')
      .single();

    if (existing) {
      return {
        reportId: (existing as { id: string; content: ReportContent }).id,
        created: false,
        content: (existing as { id: string; content: ReportContent }).content,
        tokensConsumed: 0,
      };
    }
  }

  // ── Build context ─────────────────────────────────────────────────────────
  let metrics;
  try {
    const weekCount = reportType === 'monthly' ? 4 : reportType === 'executive' ? 12 : 2;
    metrics = await getProductMetrics(productId, founderId, weekCount);
  } catch {
    metrics = null;
  }

  const { data: product } = await supabase
    .from('products')
    .select('name, category, markets, confirmed_icp, brand_voice_profile')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .single();

  if (!product) throw new Error('Product not found');

  const { data: briefs } = await supabase
    .from('weekly_briefs')
    .select('week_of, what_worked, what_to_kill, next_actions, status')
    .eq('product_id', productId)
    .eq('founder_id', founderId)
    .gte('week_of', periodStart)
    .lte('week_of', periodEnd)
    .order('week_of', { ascending: false })
    .limit(8);

  const { data: experiments } = await supabase
    .from('experiments')
    .select('title, hypothesis, status, winner, learning_summary, metric')
    .eq('product_id', productId)
    .eq('founder_id', founderId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd + 'T23:59:59Z')
    .limit(10);

  const p = product as {
    name: string; category: string | null; markets: string[] | null;
    confirmed_icp: Record<string, unknown> | null; brand_voice_profile: unknown;
  };

  // ── Build prompt ─────────────────────────────────────────────────────────
  const contextSummary = [
    `App: ${p.name} (${p.category ?? 'Unknown category'}) | Markets: ${(p.markets ?? ['usa']).join(', ')}`,
    `Report period: ${periodStart} to ${periodEnd}`,
    metrics ? `Total installs (period): ${metrics.weeklySummaries.reduce((s, w) => s + w.totalInstalls, 0)}` : '',
    metrics ? `Avg ROAS: ${metrics.weeklySummaries.find(w => w.avgRoas !== null)?.avgRoas ?? 'N/A'}` : '',
    metrics ? `Top channel: ${metrics.channelBreakdown[0]?.channel ?? 'N/A'} (${metrics.channelBreakdown[0]?.installs ?? 0} installs)` : '',
    (briefs ?? []).length > 0 ? `Weekly briefs: ${(briefs ?? []).map(b => `[${b.week_of}] worked: ${String(b.what_worked).slice(0, 80)}`).join(' | ')}` : '',
    (experiments ?? []).length > 0 ? `Experiments: ${(experiments ?? []).map(e => `${e.title} → ${e.status}${e.winner ? ' winner: ' + e.winner : ''}`).join('; ')}` : '',
    contextData ? `Additional context: ${JSON.stringify(contextData)}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are LaunchMind's Reporting Engine. Your reports explain business outcomes to app founders in plain language.
Rules:
- Use specific numbers from the data when available
- "What worked" means channels/creatives that delivered CPI < benchmark or ROAS > 1.2
- "What to fix" means channels with high spend but low installs or declining CTR
- "Key insights" are non-obvious patterns (e.g., "India WhatsApp outperforms USA Meta by 3×")
- "Next actions" are concrete (e.g., "Double Meta budget for India", not "improve performance")
- Risk flags are optional — only include if there's a real risk (budget burning, declining ROAS trend)
Return ONLY valid JSON matching the schema.`;

  const schemaHint = `{
  "headline": "string (1 bold sentence, outcome-focused, e.g. 'India installs grew 34% this week')",
  "summary": "string (2-3 sentences, owner-language, e.g. 'Your ${reportType} numbers tell a clear story...')",
  "whatWorked": ["string", ...] (2-4 bullets, specific),
  "whatToFix": ["string", ...] (1-3 bullets, actionable),
  "keyInsights": ["string", ...] (2-3 non-obvious observations),
  "nextActions": ["string", ...] (2-4 concrete next steps),
  "riskFlags": ["string", ...] (optional, only real risks)
}`;

  const userPrompt = `Generate a ${reportType} report for this app:\n\n${contextSummary}\n\nReturn JSON matching:\n${schemaHint}`;

  // ── Generate with AI ──────────────────────────────────────────────────────
  const isShortReport = reportType === 'executive' || reportType === 'experiment';
  await consumeTokens(founderId, `report_${reportType}`, isShortReport ? 20 : 30);

  let content: ReportContent;
  let tokensConsumed = 0;

  try {
    const auditCtx = {
      founderId,
      promptId: `report_${reportType}`,
      action:   `report_${reportType}`,
    };

    const raw = isShortReport
      ? await callHaiku(`${systemPrompt}\n\n${userPrompt}`, 1024, auditCtx)
      : await callSonnet(systemPrompt, userPrompt, 2048, auditCtx);

    tokensConsumed = isShortReport ? 20 : 30;
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    content = JSON.parse(cleaned) as ReportContent;
  } catch {
    // AI failed — construct a structured fallback from raw data
    content = {
      headline:    `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report for ${p.name}`,
      summary:     metrics
        ? `This ${reportType} covers ${periodStart} to ${periodEnd}. Total installs: ${metrics.weeklySummaries.reduce((s, w) => s + w.totalInstalls, 0)}.`
        : `Report data for ${periodStart} to ${periodEnd}. No campaign metrics available yet.`,
      whatWorked:   [],
      whatToFix:    [],
      keyInsights:  [],
      nextActions:  ['Review your campaign metrics for details.'],
    };
  }

  // ── Store report ──────────────────────────────────────────────────────────
  const title = `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report — ${periodStart}`;
  const metricsSnapshot = metrics ? {
    weeklySummaries:  metrics.weeklySummaries.slice(0, 4),
    channelBreakdown: metrics.channelBreakdown,
    weekCount:        metrics.weekCount,
  } : null;

  const { data: saved, error } = await supabase
    .from('reports')
    .upsert({
      founder_id:        founderId,
      product_id:        productId,
      report_type:       reportType,
      period_start:      periodStart,
      period_end:        periodEnd,
      title,
      summary:           content.summary,
      content,
      metrics_snapshot:  metricsSnapshot,
      ai_tokens_consumed: tokensConsumed,
      status:            'ready',
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'founder_id,product_id,report_type,period_start' })
    .select('id')
    .single();

  if (error) {
    Sentry.captureException(error, { tags: { service: 'reportingService', reportType } });
    throw new Error('Failed to save report');
  }

  const reportId = (saved as { id: string }).id;

  // ── Feed learnings back into Marketing Memory ────────────────────────────
  if (reportType === 'weekly' && content.whatWorked.length > 0) {
    try {
      await ingestLearningEvent(founderId, productId, 'founder_feedback', {
        source:     'weekly_report',
        reportId,
        whatWorked: content.whatWorked,
        whatToFix:  content.whatToFix,
        insights:   content.keyInsights,
      });
    } catch (e) {
      Sentry.captureException(e, { tags: { service: 'reportingService', event: 'ingest_learning' } });
    }
  }

  return { reportId, created: true, content, tokensConsumed };
}
