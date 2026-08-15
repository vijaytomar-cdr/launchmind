/**
 * @file recommendationEngineService.ts
 * @description Recommendation Engine — generates scored, typed recommendations
 *   from unified signals: Growth Brain, Marketing Memory, Knowledge Graph,
 *   campaign metrics, experiment results, and Intelligence Network benchmarks.
 *   Stores results in saved_opportunities (extended by migration 059).
 * @security
 *   - All recommendations are founder-scoped (founderId checked on every write).
 *   - No cross-tenant data access.
 *   - Deduplication prevents flooding the backlog.
 * @dependencies supabaseAdmin, aiPlatform (callHaiku), intelligenceNetworkService
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { callHaiku } from '../lib/aiPlatform';
import { getBenchmarks } from './intelligenceNetworkService';
import { retrieveMemories } from './memory/retrievalService';
import { resolveMemoryWorkspace } from './memory/workspaceResolver';
import { consumeTokens } from '../lib/tokens';

export type RecommendationType =
  | 'opportunity' | 'warning' | 'optimization' | 'budget'
  | 'expansion' | 'competitive_response' | 'content_recommendation' | 'campaign_recommendation';

export interface SourceSignal {
  type: 'campaign_metric' | 'experiment' | 'marketing_memory' | 'benchmark' | 'review' | 'knowledge_graph';
  id: string;
  label: string;
}

export interface ScoredRecommendation {
  title:                string;
  description:          string;
  recommendationType:   RecommendationType;
  effort:               'low' | 'medium' | 'high';
  risk:                 'low' | 'medium' | 'high';
  expectedImpact:       string;
  confidence:           number;
  score:                number;
  priority:             number;
  whyNow:               string;
  source:               string;
  evidence:             string[];
  sourceSignals:        SourceSignal[];
  expiresAt:            string | null;
}

const IMPACT_WEIGHT: Record<RecommendationType, number> = {
  expansion:              1.0,
  opportunity:            1.0,
  competitive_response:   0.9,
  warning:                0.8,
  budget:                 0.7,
  optimization:           0.6,
  campaign_recommendation: 0.5,
  content_recommendation: 0.4,
};

/**
 * Scores a recommendation using the formula from ADR-051.
 * score = (impact_weight × 0.4) + (confidence × 0.3) + (urgency × 0.2) + (source_quality × 0.1)
 */
function scoreRecommendation(
  type: RecommendationType,
  confidence: number,
  urgency: number,
  sourceQuality: number,
): number {
  const impactWeight = IMPACT_WEIGHT[type] ?? 0.5;
  return Math.min(1, (impactWeight * 0.4) + (confidence * 0.3) + (urgency * 0.2) + (sourceQuality * 0.1));
}

/**
 * Deduplicates: returns true if an active recommendation with the same title already exists.
 */
async function isDuplicate(founderId: string, productId: string, title: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { count } = await supabase
    .from('saved_opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('founder_id', founderId)
    .eq('product_id', productId)
    .eq('title', title)
    .eq('state', 'active');
  return (count ?? 0) > 0;
}

/**
 * Generates and stores recommendations for a product using unified signals.
 * Returns the number of new recommendations created.
 */
export async function generateRecommendations(
  founderId: string,
  productId: string,
): Promise<{ created: number; skipped: number }> {
  const supabase = getSupabaseAdmin();
  let created = 0;
  let skipped = 0;

  try {
    // ── 1. Fetch context in parallel ─────────────────────────────────────────
    const [productRes, metricsRes, experimentsRes] = await Promise.all([
      supabase.from('products')
        .select('id, name, category, markets, confirmed_icp, competitor_set, scraped_meta, price_tier')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single(),

      supabase.from('campaign_metrics')
        .select('campaign_id, week_start, impressions, clicks, installs, cpi, ctr, roas')
        .eq('founder_id', founderId)
        .order('week_start', { ascending: false })
        .limit(10),

      supabase.from('experiments')
        .select('id, title, hypothesis, metric, status, winner, learning_summary')
        .eq('founder_id', founderId)
        .eq('product_id', productId)
        .in('status', ['completed', 'running'])
        .limit(5),
    ]);

    const product = productRes.data as {
      id: string; name: string; category: string | null; markets: string[] | null;
      confirmed_icp: Record<string, unknown> | null; competitor_set: unknown;
      scraped_meta: Record<string, unknown> | null; price_tier: string | null;
    } | null;

    if (!product) return { created, skipped };

    // ADR-067 C16 / 3.2A §25. This previously selected a `key` column that has
    // never existed: PostgREST returned 42703, `data` was null, and `?? []`
    // turned the error into "no memory". The Recommendation Engine has therefore
    // never used Marketing Memory at all.
    //
    // Routed through RetrievalService rather than repaired in place, so this is
    // not a fourth direct read path. Retrieval reports its own degradation, so
    // the three cases stay distinguishable:
    //   success        → memories present
    //   legitimate 0   → memoriesUnavailable === false, empty list
    //   retrieval fail → memoriesUnavailable === true, and it is NOT silent
    let memories: Array<{ memory_type: string; content: unknown; confidence: number; title: string }> = [];
    let memoriesUnavailable = false;
    try {
      const workspaceId = await resolveMemoryWorkspace(founderId, productId);
      if (workspaceId) {
        const retrieved = await retrieveMemories({
          workspaceId,
          productId,
          query: `${product?.name ?? ''} marketing strategy positioning channel audience`.trim(),
          limit: 20,
        });
        memories = retrieved.results.map(r => ({
          memory_type: r.memoryType, content: r.content,
          confidence: r.confidence, title: r.title,
        }));
        // `degraded` means an arm failed. An empty result from a healthy
        // retriever is a real answer; an empty result from a degraded one is not.
        if (retrieved.degraded && memories.length === 0) memoriesUnavailable = true;
      }
    } catch (err) {
      memoriesUnavailable = true;
      Sentry.captureException(err, { tags: { stage: 'recommendation.memoryRetrieval' } });
    }
    if (memoriesUnavailable) {
      Sentry.captureMessage('recommendation generated without Marketing Memory', {
        level: 'warning', tags: { productId },
      });
    }
    const metrics   = metricsRes.data  ?? [];
    const experiments = experimentsRes.data ?? [];

    // ── 2. Fetch intelligence benchmarks ─────────────────────────────────────
    const benchmarks = product.category
      ? await getBenchmarks(product.category, (product.markets ?? ['usa'])[0] ?? 'usa')
      : null;

    // ── 3. Build a concise context summary for AI scoring ────────────────────
    const contextSummary = [
      `App: ${product.name} (${product.category ?? 'Unknown category'})`,
      `Markets: ${(product.markets ?? ['usa']).join(', ')}`,
      `Price tier: ${product.price_tier ?? 'unknown'}`,
      metrics.length ? `Recent metrics: ${JSON.stringify(metrics.slice(0, 3))}` : '',
      experiments.length ? `Experiments: ${experiments.map(e => `${e.title} (${e.status}${e.winner ? ', winner:' + e.winner : ''})`).join('; ')}` : '',
      memories.length ? `Key learnings: ${memories.slice(0, 5).map(m => `[${m.memory_type}] ${m.title}: ${JSON.stringify(m.content).slice(0, 100)}`).join(' | ')}` : '',
      benchmarks ? `Category benchmark: avg install delta ${benchmarks.avgInstallDeltaPct}%, top channel: ${benchmarks.topChannel}` : '',
    ].filter(Boolean).join('\n');

    // ── 4. Ask AI to suggest 3 recommendations ────────────────────────────────
    await consumeTokens(founderId, 'recommendation_generation', 10);

    const aiPrompt = `You are LaunchMind's Recommendation Engine. Based on this product context, suggest exactly 3 high-value recommendations.

${contextSummary}

Return a JSON array of exactly 3 objects:
[{
  "title": "string (max 60 chars, action-oriented)",
  "description": "string (2-3 sentences explaining the recommendation)",
  "recommendationType": "opportunity|warning|optimization|budget|expansion|competitive_response|content_recommendation|campaign_recommendation",
  "effort": "low|medium|high",
  "risk": "low|medium|high",
  "expectedImpact": "string (quantified if possible, e.g. ~+15% installs)",
  "confidence": 0.0-1.0,
  "whyNow": "string (1 sentence urgency reason)",
  "evidence": ["string", ...] (max 3 supporting facts from the context)
}]

Rules:
- Each recommendation must be different in type or focus area
- Prioritise actions with the highest impact × lowest effort
- If metrics show underperformance, include a warning type
- If markets array doesn't include 'india' and benchmarks look positive, suggest expansion
- Return ONLY the JSON array, no markdown`;

    let recs: ScoredRecommendation[] = [];
    try {
      const rawAI = await callHaiku(aiPrompt, 1024, {
        founderId,
        promptId: 'recommendation_generation',
        action: 'recommendation_generation',
      });

      const cleaned = rawAI.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned) as Array<{
        title: string; description: string; recommendationType: string;
        effort: string; risk: string; expectedImpact: string;
        confidence: number; whyNow: string; evidence: string[];
      }>;

      recs = parsed.slice(0, 5).map((r, i) => {
        const type = (r.recommendationType ?? 'opportunity') as RecommendationType;
        const confidence = Math.max(0, Math.min(1, r.confidence ?? 0.7));
        const urgency = i === 0 ? 0.9 : i === 1 ? 0.6 : 0.3; // first = most urgent
        const sourceQuality = metrics.length > 0 ? 0.9 : benchmarks ? 0.6 : 0.4;
        const score = scoreRecommendation(type, confidence, urgency, sourceQuality);

        return {
          title:              r.title,
          description:        r.description,
          recommendationType: type,
          effort:             (r.effort ?? 'medium') as 'low' | 'medium' | 'high',
          risk:               (r.risk   ?? 'low')    as 'low' | 'medium' | 'high',
          expectedImpact:     r.expectedImpact ?? '',
          confidence,
          score,
          priority:           Math.round(score * 100),
          whyNow:             r.whyNow ?? '',
          source:             'recommendation_engine',
          evidence:           Array.isArray(r.evidence) ? r.evidence.slice(0, 3) : [],
          sourceSignals:      [
            ...(metrics.length ? [{ type: 'campaign_metric' as const, id: productId, label: 'Recent campaign metrics' }] : []),
            ...(experiments.length ? [{ type: 'experiment' as const, id: productId, label: 'Experiment results' }] : []),
            ...(memories.length ? [{ type: 'marketing_memory' as const, id: productId, label: 'Marketing memory' }] : []),
            ...(benchmarks ? [{ type: 'benchmark' as const, id: `${product.category}:${(product.markets ?? ['usa'])[0]}`, label: 'Category benchmarks' }] : []),
          ],
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
        };
      });
    } catch {
      // AI generation failed — fall back to a single rule-based recommendation
      recs = [{
        title:              'Review your campaign performance',
        description:        'Your campaign data is ready for review. Understanding your current metrics will help prioritise next steps.',
        recommendationType: 'optimization',
        effort:             'low',
        risk:               'low',
        expectedImpact:     'Better data-driven decisions',
        confidence:         0.5,
        score:              0.4,
        priority:           40,
        whyNow:             'Weekly review keeps campaigns on track',
        source:             'recommendation_engine_fallback',
        evidence:           [],
        sourceSignals:      [],
        expiresAt:          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }];
    }

    // ── 5. Store non-duplicate recommendations ────────────────────────────────
    for (const rec of recs) {
      if (await isDuplicate(founderId, productId, rec.title)) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from('saved_opportunities').insert({
        founder_id:          founderId,
        product_id:          productId,
        type:                rec.recommendationType,
        recommendation_type: rec.recommendationType,
        title:               rec.title,
        description:         rec.description,
        expected_impact:     rec.expectedImpact,
        confidence:          rec.confidence,
        effort:              rec.effort,
        risk:                rec.risk,
        why_now:             rec.whyNow,
        source:              rec.source,
        evidence:            rec.evidence,
        score:               rec.score,
        priority:            rec.priority,
        source_signals:      rec.sourceSignals,
        expires_at:          rec.expiresAt,
        state:               'active',
      });

      if (!error) created++;
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'recommendationEngine', founderId, productId } });
  }

  return { created, skipped };
}

/**
 * Expires stale recommendations (past expires_at) for a founder.
 * Called by the weekly brief cron to keep the backlog fresh.
 */
export async function expireStaleRecommendations(founderId: string): Promise<number> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('saved_opportunities')
    .update({ state: 'dismissed' })
    .eq('founder_id', founderId)
    .eq('state', 'active')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) return 0;
  return (data ?? []).length;
}
