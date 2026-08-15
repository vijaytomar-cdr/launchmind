/**
 * @file recommendations.route.ts
 * @description Recommendation Engine API.
 *   Extends saved_opportunities with typed recommendations, scoring, feedback,
 *   mission conversion, and history. Replaces the basic owner/opportunities seeding.
 * @security JWT required. Founder-scoped — only own recommendations returned.
 *   Mission conversion verified via missionService (founder ownership re-checked).
 * @dependencies supabaseAdmin, recommendationEngineService, decisionEngineService
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { generateRecommendations, expireStaleRecommendations } from '../services/recommendationEngineService';
import { checkPlanFeature } from '../services/decisionEngineService';

const GenerateBodySchema = z.object({ productId: z.string().uuid() });

const ConvertBodySchema = z.object({
  title:     z.string().min(3).max(120).optional(),
  objective: z.string().min(5).max(500).optional(),
});

const FeedbackBodySchema = z.object({
  feedbackType: z.enum(['helpful', 'not_helpful', 'wrong', 'too_early', 'already_doing']),
  note:         z.string().max(500).optional(),
});

async function recommendationsPlugin(server: FastifyInstance): Promise<void> {

  /**
   * GET /recommendations
   * Returns active recommendations for the authenticated founder.
   * Optional: ?productId=, ?type=, ?limit=
   */
  server.get('/recommendations', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { productId, type, limit: limitStr } = request.query as {
      productId?: string; type?: string; limit?: string;
    };
    const limit = Math.min(parseInt(limitStr ?? '20', 10), 50);
    const supabase = getSupabaseAdmin();

    // The active business decides. A client hint that names another business is
    // ignored, not honoured — same founder does not imply same business.
    const { activeProductId } = await import('../services/activeBusinessService');
    const scopedProductId = await activeProductId(founderId);
    if (!scopedProductId || (productId && productId !== scopedProductId)) {
      return reply.send({ recommendations: [], total: 0 });
    }

    let query = supabase
      .from('saved_opportunities')
      .select('id, product_id, type, recommendation_type, title, description, expected_impact, confidence, effort, risk, why_now, source, evidence, score, priority, source_signals, expires_at, state, mission_id, created_at, updated_at')
      .eq('founder_id', founderId)
      .eq('state', 'active')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    // Was optional: omitting productId returned every recommendation the
    // founder owned. The active business decides; a mismatched client hint is
    // ignored rather than trusted.
    query = query.eq('product_id', scopedProductId);
    if (type)      query = query.eq('recommendation_type', type);

    const { data, error } = await query.limit(limit);
    if (error) {
      Sentry.captureException(error, { tags: { route: 'GET /recommendations' } });
      return reply.status(500).send({ error: 'Failed to fetch recommendations' });
    }

    return reply.send({ recommendations: data ?? [], total: (data ?? []).length });
  });

  /**
   * POST /recommendations/generate
   * Triggers recommendation generation for a product.
   * Builder/Studio only — Free/Solo get seeded recommendations only.
   * @body { productId: string }
   */
  server.post('/recommendations/generate', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;

    const parsed = GenerateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }
    const { productId } = parsed.data;
    const supabase = getSupabaseAdmin();

    // Plan gate: Builder+ for on-demand generation
    try {
      await checkPlanFeature(founderId, 'on-demand recommendations', 'builder');
    } catch {
      // Free/Solo: seed 3 generic recommendations and return
      await generateRecommendations(founderId, productId);
      return reply.status(202).send({ message: 'Recommendations queued', productId });
    }

    // Verify product ownership
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('founder_id', founderId)
      .single();

    if (!product) return reply.status(404).send({ error: 'Product not found' });

    // Expire stale recommendations first
    await expireStaleRecommendations(founderId);

    const result = await generateRecommendations(founderId, productId);

    return reply.status(201).send({ ...result, productId });
  });

  /**
   * PATCH /recommendations/:id/dismiss
   * Marks a recommendation as dismissed.
   */
  server.patch('/recommendations/:id/dismiss', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('saved_opportunities')
      .update({ state: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('founder_id', founderId)
      .eq('state', 'active')
      .select('id, state')
      .single();

    if (error || !data) return reply.status(404).send({ error: 'Recommendation not found or already actioned' });
    return reply.send({ recommendation: data });
  });

  /**
   * PATCH /recommendations/:id/save
   * Moves a recommendation to the saved state (bookmarked).
   */
  server.patch('/recommendations/:id/save', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('saved_opportunities')
      .update({ state: 'saved', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('founder_id', founderId)
      .select('id, state')
      .single();

    if (error || !data) return reply.status(404).send({ error: 'Recommendation not found' });
    return reply.send({ recommendation: data });
  });

  /**
   * POST /recommendations/:id/convert
   * Converts a recommendation into a mission.
   * @body { title?: string, objective?: string }
   */
  server.post('/recommendations/:id/convert', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };

    const parsed = ConvertBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }
    const { title, objective } = parsed.data;
    const supabase = getSupabaseAdmin();

    // Fetch the recommendation
    const { data: rec, error: recErr } = await supabase
      .from('saved_opportunities')
      .select('*')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single();

    if (recErr || !rec) return reply.status(404).send({ error: 'Recommendation not found' });

    const r = rec as {
      product_id: string; title: string; description: string;
      recommendation_type: string; state: string;
    };

    if (r.state === 'converted') {
      return reply.status(409).send({ error: 'Recommendation already converted to a mission' });
    }

    // Create mission
    const missionTitle     = title     ?? r.title;
    const missionObjective = objective ?? r.description;

    const { data: mission, error: missionErr } = await supabase
      .from('missions')
      .insert({
        product_id:     r.product_id,
        founder_id:     founderId,
        title:          missionTitle,
        objective:      missionObjective,
        objective_type: 'other',
        status:         'draft',
        agent_plan:     { source: 'recommendation', recommendationId: id, type: r.recommendation_type },
      })
      .select('id, title, status')
      .single();

    if (missionErr || !mission) {
      Sentry.captureException(missionErr, { tags: { route: 'POST /recommendations/:id/convert' } });
      return reply.status(500).send({ error: 'Failed to create mission' });
    }

    const m = mission as { id: string; title: string; status: string };

    // Update recommendation state
    await supabase
      .from('saved_opportunities')
      .update({ state: 'converted', mission_id: m.id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('founder_id', founderId);

    return reply.status(201).send({ mission: m, recommendationId: id });
  });

  /**
   * GET /recommendations/history
   * Returns all recommendations including dismissed, saved, and converted.
   * Optional: ?productId=, ?state=, ?limit=
   */
  server.get('/recommendations/history', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { productId, state, limit: limitStr } = request.query as {
      productId?: string; state?: string; limit?: string;
    };
    const limit = Math.min(parseInt(limitStr ?? '50', 10), 100);
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('saved_opportunities')
      .select('id, product_id, type, recommendation_type, title, description, expected_impact, confidence, effort, risk, score, priority, state, mission_id, created_at, updated_at')
      .eq('founder_id', founderId)
      .order('created_at', { ascending: false });

    if (productId) query = query.eq('product_id', productId);
    if (state)     query = query.eq('state', state);

    const { data, error } = await query.limit(limit);
    if (error) {
      return reply.status(500).send({ error: 'Failed to fetch history' });
    }

    return reply.send({ recommendations: data ?? [], total: (data ?? []).length });
  });

  /**
   * POST /recommendations/:id/feedback
   * Submits founder feedback on a recommendation.
   * @body { feedbackType: string, note?: string }
   */
  server.post('/recommendations/:id/feedback', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { id } = request.params as { id: string };

    const parsed = FeedbackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid feedbackType', details: parsed.error.errors });
    }
    const { feedbackType, note } = parsed.data;
    const supabase = getSupabaseAdmin();

    // Verify recommendation belongs to founder
    const { data: rec } = await supabase
      .from('saved_opportunities')
      .select('id')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single();

    if (!rec) return reply.status(404).send({ error: 'Recommendation not found' });

    const { error } = await supabase.from('recommendation_feedback').insert({
      recommendation_id: id,
      founder_id:        founderId,
      feedback_type:     feedbackType,
      note:              note ?? null,
    });

    if (error) {
      Sentry.captureException(error, { tags: { route: 'POST /recommendations/:id/feedback' } });
      return reply.status(500).send({ error: 'Failed to save feedback' });
    }

    // Update feedback_summary on the recommendation
    const helpfulTypes = ['helpful'];
    const delta = helpfulTypes.includes(feedbackType) ? 1 : -1;

    const { data: existing } = await supabase
      .from('saved_opportunities')
      .select('feedback_summary')
      .eq('id', id)
      .single();

    const prev = (existing as { feedback_summary: Record<string, number> | null } | null)?.feedback_summary ?? {};
    await supabase.from('saved_opportunities').update({
      feedback_summary: {
        helpful:     (prev.helpful     ?? 0) + (feedbackType === 'helpful'      ? 1 : 0),
        not_helpful: (prev.not_helpful ?? 0) + (feedbackType === 'not_helpful'  ? 1 : 0),
        other:       (prev.other       ?? 0) + (delta < 0 && feedbackType !== 'not_helpful' ? 1 : 0),
        last_feedback: feedbackType,
      },
    }).eq('id', id).eq('founder_id', founderId);

    return reply.status(201).send({ feedback: { recommendationId: id, feedbackType } });
  });
}

export const recommendationsRoutes = fp(recommendationsPlugin);
