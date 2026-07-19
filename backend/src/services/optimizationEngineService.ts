/**
 * @file optimizationEngineService.ts
 * @description Optimization Engine for LaunchMind M11.
 *   Derives performance insights from campaign metrics, experiment results, and benchmarks.
 *   Inserts insights into optimization_insights table.
 *   Feeds validated learnings back into Marketing Memory and the Recommendation Engine.
 * @security Founder-scoped. Checks token balance before AI generation (§1.4).
 * @dependencies supabaseAdmin, aiPlatform, analyticsService, learningPipelineService
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin }                        from '../lib/supabaseAdmin';
import { callHaiku }                               from '../lib/aiPlatform';
import { getProductMetrics }                       from './metricsService';
import { getBenchmarks }                           from './intelligenceNetworkService';
import { ingestLearningEvent }                     from './learningPipelineService';
import { generateRecommendations }                 from './recommendationEngineService';
import { checkTokenBalance }                       from './decisionEngineService';
import { consumeTokens }                           from '../lib/tokens';

export type InsightType =
  | 'channel_optimization' | 'budget_reallocation' | 'creative_refresh'
  | 'audience_expansion'   | 'timing_optimization' | 'funnel_fix';

export interface OptimizationInsight {
  insightType:     InsightType;
  title:           string;
  description:     string;
  impactEstimate?: string;
  confidence:      number;
  sourceMetrics?:  Record<string, unknown>;
}

/**
 * Generates optimization insights for a product.
 * Feeds high-confidence insights into Marketing Memory and Recommendation Engine.
 * @returns Number of insights created and skipped (deduped)
 */
export async function generateInsights(
  founderId: string,
  productId: string,
): Promise<{ created: number; skipped: number }> {
  const supabase = getSupabaseAdmin();
  let created = 0;
  let skipped = 0;

  try {
    // §1.4: check token balance before AI call
    await checkTokenBalance(founderId, 10);

    // ── Gather context ─────────────────────────────────────────────────────
    const [metricsRes, productRes, experimentsRes] = await Promise.all([
      getProductMetrics(productId, founderId, 8).catch(() => null),
      supabase.from('products')
        .select('name, category, markets, price_tier')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single(),
      supabase.from('experiments')
        .select('title, hypothesis, status, winner, learning_summary, metric')
        .eq('product_id', productId)
        .eq('founder_id', founderId)
        .in('status', ['completed', 'running'])
        .limit(5),
    ]);

    const product = productRes.data as {
      name: string; category: string | null; markets: string[] | null; price_tier: string | null;
    } | null;

    if (!product) return { created, skipped };

    const benchmarks = product.category
      ? await getBenchmarks(product.category, (product.markets ?? ['usa'])[0] ?? 'usa').catch(() => null)
      : null;

    const experiments = (experimentsRes.data ?? []) as Array<{
      title: string; hypothesis: string; status: string; winner: string | null;
      learning_summary: string | null; metric: string;
    }>;

    // ── Build context string ───────────────────────────────────────────────
    const metricsContext = metricsRes ? [
      `Last 8 weeks: ${metricsRes.weeklySummaries.slice(0, 4).map(w =>
        `[${w.weekOf}] ${w.totalInstalls} installs, CTR ${w.avgCtr?.toFixed(2) ?? 'N/A'}%, CPI $${w.avgCpi?.toFixed(2) ?? 'N/A'}`
      ).join(' | ')}`,
      `Top channels: ${metricsRes.channelBreakdown.slice(0, 3).map(c =>
        `${c.channel}/${c.market}: ${c.installs} installs, ROAS ${c.avgRoas?.toFixed(2) ?? 'N/A'}`
      ).join(' | ')}`,
    ].join('\n') : 'No metrics yet.';

    const benchmarkContext = benchmarks
      ? `Category benchmark: avg install delta ${benchmarks.avgInstallDeltaPct}%, top channel: ${benchmarks.topChannel}, avg D7 retention: ${(benchmarks.avgRetentionD7 * 100).toFixed(1)}%`
      : 'No benchmarks available.';

    const experimentContext = experiments.length
      ? experiments.map(e => `${e.title} (${e.status}${e.winner ? ', winner: ' + e.winner : ''}): ${e.learning_summary ?? 'No summary'}`).join('\n')
      : 'No experiments.';

    // ── AI generation ──────────────────────────────────────────────────────
    await consumeTokens(founderId, 'optimization_insights', 10);

    const prompt = `You are LaunchMind's Optimization Engine. Analyze this app's performance and suggest 3 optimization insights.

App: ${product.name} (${product.category ?? 'Unknown'}) | Markets: ${(product.markets ?? ['usa']).join(', ')} | Price: ${product.price_tier ?? 'unknown'}
Metrics:
${metricsContext}
Benchmarks: ${benchmarkContext}
Experiments:
${experimentContext}

Return a JSON array of exactly 3 insights:
[{
  "insightType": "channel_optimization|budget_reallocation|creative_refresh|audience_expansion|timing_optimization|funnel_fix",
  "title": "string (max 60 chars, action-oriented)",
  "description": "string (2 sentences with specific evidence from the data)",
  "impactEstimate": "string (quantified, e.g. '+15% installs', '-20% CPI')",
  "confidence": 0.0-1.0
}]

Rules:
- Each insight must be different in type
- Prioritise insights with confidence ≥ 0.7
- If CTR is declining → funnel_fix
- If one channel has 2× the ROAS of others → budget_reallocation
- If benchmarks show category performs better → channel_optimization
- Return ONLY the JSON array`;

    const rawAI = await callHaiku(prompt, 1024, {
      founderId,
      promptId: 'optimization_insights',
      action:   'optimization_insights',
    });

    const cleaned = rawAI.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned) as OptimizationInsight[];

    // ── Store non-duplicate insights ───────────────────────────────────────
    for (const insight of parsed.slice(0, 5)) {
      // Dedup check
      const { count } = await supabase
        .from('optimization_insights')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', productId)
        .eq('insight_type', insight.insightType)
        .eq('title', insight.title)
        .eq('status', 'pending');

      if ((count ?? 0) > 0) { skipped++; continue; }

      const { error } = await supabase.from('optimization_insights').insert({
        founder_id:      founderId,
        product_id:      productId,
        insight_type:    insight.insightType,
        title:           insight.title,
        description:     insight.description,
        impact_estimate: insight.impactEstimate ?? null,
        confidence:      Math.max(0, Math.min(1, insight.confidence ?? 0.7)),
        source_metrics: {
          weekCount:  metricsRes?.weekCount,
          topChannel: metricsRes?.channelBreakdown[0]?.channel,
          benchmarkTopChannel: benchmarks?.topChannel,
        },
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      });

      if (!error) created++;
    }

    // ── Feed back into Marketing Memory ────────────────────────────────────
    if (created > 0) {
      try {
        await ingestLearningEvent(founderId, productId, 'analytics_synced', {
          source:          'optimization_engine',
          insightsCreated: created,
          topInsight:      parsed[0]?.title,
          topInsightType:  parsed[0]?.insightType,
        });
      } catch (e) {
        Sentry.captureException(e, { tags: { service: 'optimizationEngine', event: 'ingest' } });
      }

      // High-confidence insights → trigger Recommendation Engine update
      const highConfidence = parsed.filter(i => (i.confidence ?? 0) >= 0.8);
      if (highConfidence.length > 0) {
        try {
          await generateRecommendations(founderId, productId);
        } catch (e) {
          Sentry.captureException(e, { tags: { service: 'optimizationEngine', event: 'recs' } });
        }
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'optimizationEngine', founderId, productId } });
  }

  return { created, skipped };
}

/**
 * Lists active (pending) optimization insights for a product.
 */
export async function listInsights(
  founderId: string,
  productId: string,
): Promise<OptimizationInsight[]> {
  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from('optimization_insights')
    .select('id, insight_type, title, description, impact_estimate, confidence, source_metrics, status, created_at')
    .eq('founder_id', founderId)
    .eq('product_id', productId)
    .eq('status', 'pending')
    .order('confidence', { ascending: false })
    .limit(20);

  return (data ?? []) as unknown as OptimizationInsight[];
}

/**
 * Marks an insight as applied or dismissed.
 */
export async function updateInsightStatus(
  insightId: string,
  founderId: string,
  status: 'applied' | 'dismissed',
  actionTaken?: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  await supabase.from('optimization_insights')
    .update({
      status,
      action_taken: actionTaken ?? null,
      applied_at:   status === 'applied' ? new Date().toISOString() : null,
    })
    .eq('id', insightId)
    .eq('founder_id', founderId);
}
