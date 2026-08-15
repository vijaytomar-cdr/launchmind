/**
 * @file experiments.route.ts
 * @description Experiment lifecycle routes — A/B tests for content, copy, channel, and creative.
 *   Full CRUD + lifecycle: create, start, end, mark winner, record learning, archive.
 *   Winner selection triggers learning pipeline (Marketing Memory + Growth Brain update).
 * @security JWT required. Founder ownership enforced on every handler.
 * @dependencies aiPlatform (callHaiku for learning summary), learningPipelineService, supabaseAdmin
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { callHaiku } from '../lib/aiPlatform';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateExperimentSchema = z.object({
  productId:       z.string().uuid(),
  campaignId:      z.string().uuid().optional(),
  missionId:       z.string().uuid().optional(),
  title:           z.string().min(1).max(200),
  hypothesis:      z.string().min(1).max(1000),
  experimentType:  z.enum(['copy', 'creative', 'channel', 'aso', 'audience']),
  goal:            z.string().min(1).max(500),
  metric:          z.string().min(1).max(100),
  market:          z.enum(['usa', 'india', 'both']).optional(),
  startDate:       z.string().optional(),
  endDate:         z.string().optional(),
  expectedOutcome: z.string().max(500).optional(),
  variantA: z.object({
    assetId:     z.string().uuid().optional(),
    label:       z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    config:      z.record(z.unknown()).optional(),
  }),
  variantB: z.object({
    assetId:     z.string().uuid().optional(),
    label:       z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    config:      z.record(z.unknown()).optional(),
  }),
});

const UpdateResultsSchema = z.object({
  variant:     z.enum(['a', 'b']),
  impressions: z.number().int().min(0).optional(),
  clicks:      z.number().int().min(0).optional(),
  conversions: z.number().int().min(0).optional(),
  metricValue: z.number().optional(),
});

const WinnerSchema = z.object({
  winner:           z.enum(['a', 'b', 'inconclusive']),
  winnerConfidence: z.number().min(0).max(1).optional(),
  learning:         z.string().min(1).max(2000),
});

const ListQuerySchema = z.object({
  status:  z.string().optional(),
  limit:   z.coerce.number().min(1).max(100).optional().default(20),
  offset:  z.coerce.number().min(0).optional().default(0),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

async function experimentsPlugin(server: FastifyInstance): Promise<void> {

  /**
   * POST /experiments
   * Create an experiment with both variants.
   */
  server.post('/experiments', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateExperimentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const { data: product } = await supabase
        .from('products')
        .select('id')
        .eq('id', parsed.data.productId)
        .eq('founder_id', founderId)
        .single();

      if (!product) return reply.status(404).send({ error: 'Product not found' });

      const { data: experiment, error: expErr } = await supabase
        .from('experiments')
        .insert({
          product_id:       parsed.data.productId,
          founder_id:       founderId,
          campaign_id:      parsed.data.campaignId ?? null,
          mission_id:       parsed.data.missionId ?? null,
          title:            parsed.data.title,
          hypothesis:       parsed.data.hypothesis,
          experiment_type:  parsed.data.experimentType,
          goal:             parsed.data.goal,
          metric:           parsed.data.metric,
          market:           parsed.data.market ?? null,
          start_date:       parsed.data.startDate ?? null,
          end_date:         parsed.data.endDate ?? null,
          expected_outcome: parsed.data.expectedOutcome ?? null,
          status:           'draft',
        })
        .select()
        .single();

      if (expErr) throw expErr;

      // Insert both variants
      await supabase.from('experiment_variants').insert([
        {
          experiment_id: experiment!.id,
          founder_id:    founderId,
          variant:       'a',
          asset_id:      parsed.data.variantA.assetId ?? null,
          label:         parsed.data.variantA.label ?? 'Variant A',
          description:   parsed.data.variantA.description ?? null,
          config:        parsed.data.variantA.config ?? null,
        },
        {
          experiment_id: experiment!.id,
          founder_id:    founderId,
          variant:       'b',
          asset_id:      parsed.data.variantB.assetId ?? null,
          label:         parsed.data.variantB.label ?? 'Variant B',
          description:   parsed.data.variantB.description ?? null,
          config:        parsed.data.variantB.config ?? null,
        },
      ]);

      return reply.status(201).send({ experiment });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to create experiment' });
    }
  });

  /**
   * GET /experiments
   * List experiments for the current founder.
   */
  server.get('/experiments', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = ListQuerySchema.safeParse(request.query);
      // BUSINESS SCOPE. Was founder-only, so one founder's second business saw
      // the first's rows. An unselected business yields an EMPTY list, never an
      // unfiltered one.
      const { activeProductId } = await import('../services/activeBusinessService');
      const scopedProductId = await activeProductId(founderId);
      if (!scopedProductId) return reply.send({ experiments: [], total: 0 });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query' });

    const supabase = getSupabaseAdmin();

    try {
      let query = supabase
        .from('experiments')
        .select('id, title, hypothesis, experiment_type, status, metric, market, start_date, end_date, winner, learning, created_at', { count: 'exact' })
        .eq('founder_id', founderId)
        .eq('product_id', scopedProductId)
        .is('archived_at', null);

      if (parsed.data.status) query = query.eq('status', parsed.data.status);

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

      if (error) throw error;

      return reply.send({ experiments: data ?? [], total: count ?? 0 });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to list experiments' });
    }
  });

  /**
   * GET /experiments/:id
   * Get a single experiment with both variants.
   */
  server.get('/experiments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const expId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data: experiment, error } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', expId)
        .eq('founder_id', founderId)
        .single();

      if (error || !experiment) return reply.status(404).send({ error: 'Experiment not found' });

      const { data: variants } = await supabase
        .from('experiment_variants')
        .select('*')
        .eq('experiment_id', expId)
        .order('variant');

      return reply.send({ experiment, variants: variants ?? [] });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to get experiment' });
    }
  });

  /**
   * POST /experiments/:id/start
   * Transition experiment from draft/ready → running.
   */
  server.post('/experiments/:id/start', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const expId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data: exp, error: fetchErr } = await supabase
        .from('experiments')
        .select('id, status')
        .eq('id', expId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !exp) return reply.status(404).send({ error: 'Experiment not found' });

      if (!['draft', 'ready'].includes(exp.status)) {
        return reply.status(409).send({ error: `Cannot start experiment with status: ${exp.status}` });
      }

      const { data: updated, error } = await supabase
        .from('experiments')
        .update({ status: 'running', start_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
        .eq('id', expId)
        .eq('founder_id', founderId)
        .select('id, status, start_date')
        .single();

      if (error) throw error;

      return reply.send({ experiment: updated });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to start experiment' });
    }
  });

  /**
   * POST /experiments/:id/results
   * Update metric results for a variant.
   */
  server.post('/experiments/:id/results', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const expId = (request.params as { id: string }).id;

    const parsed = UpdateResultsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const { data: exp } = await supabase
        .from('experiments')
        .select('id, status, founder_id')
        .eq('id', expId)
        .eq('founder_id', founderId)
        .single();

      if (!exp) return reply.status(404).send({ error: 'Experiment not found' });

      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.impressions !== undefined) updatePayload.impressions = parsed.data.impressions;
      if (parsed.data.clicks !== undefined)      updatePayload.clicks = parsed.data.clicks;
      if (parsed.data.conversions !== undefined) updatePayload.conversions = parsed.data.conversions;
      if (parsed.data.metricValue !== undefined) updatePayload.metric_value = parsed.data.metricValue;

      await supabase.from('experiment_variants')
        .update(updatePayload)
        .eq('experiment_id', expId)
        .eq('variant', parsed.data.variant)
        .eq('founder_id', founderId);

      // Auto-transition to waiting_for_data if running and both variants have data
      if (exp.status === 'running') {
        await supabase.from('experiments')
          .update({ status: 'waiting_for_data', updated_at: new Date().toISOString() })
          .eq('id', expId)
          .eq('founder_id', founderId);
      }

      return reply.send({ updated: true, variant: parsed.data.variant });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to update results' });
    }
  });

  /**
   * POST /experiments/:id/winner
   * Mark winner, generate AI learning summary, ingest learning event.
   */
  server.post('/experiments/:id/winner', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const expId = (request.params as { id: string }).id;

    const parsed = WinnerSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const { data: exp, error: fetchErr } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', expId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !exp) return reply.status(404).send({ error: 'Experiment not found' });

      if (!['running', 'waiting_for_data'].includes(exp.status)) {
        return reply.status(409).send({ error: `Cannot select winner for experiment with status: ${exp.status}` });
      }

      // AI-generate a learning summary
      let learningSummary = '';
      try {
        learningSummary = await callHaiku(
          `Experiment: "${exp.title}"\nHypothesis: ${exp.hypothesis}\nWinner: ${parsed.data.winner}\nLearning: ${parsed.data.learning}\n\nWrite a 1-2 sentence actionable insight in plain English that a founder can apply immediately.`,
          256,
          { founderId, promptId: 'experiment_learning_summary', action: 'experiment_learning_summary' },
        );
      } catch { /* non-fatal */ }

      const { data: updated, error } = await supabase
        .from('experiments')
        .update({
          winner:             parsed.data.winner,
          winner_confidence:  parsed.data.winnerConfidence ?? null,
          learning:           parsed.data.learning,
          learning_summary:   learningSummary || parsed.data.learning,
          status:             parsed.data.winner === 'inconclusive' ? 'inconclusive' : 'completed',
          end_date:           new Date().toISOString().slice(0, 10),
          updated_at:         new Date().toISOString(),
        })
        .eq('id', expId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error) throw error;

      // Ingest learning event (best-effort — failure doesn't fail the response)
      try {
        const { ingestLearningEvent } = await import('../services/learningPipelineService');
        await ingestLearningEvent(founderId, exp.product_id, 'experiment_result', {
          experimentId:     expId,
          hypothesis:       exp.hypothesis,
          winner:           parsed.data.winner,
          learning:         parsed.data.learning,
          learningSummary,
          metric:           exp.metric,
          experimentType:   exp.experiment_type,
        });
      } catch { /* non-fatal */ }

      return reply.send({ experiment: updated, learningSummary });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to record winner' });
    }
  });

  /**
   * POST /experiments/:id/archive
   * Archive an experiment (soft delete).
   */
  server.post('/experiments/:id/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const expId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data, error } = await supabase
        .from('experiments')
        .update({ archived_at: new Date().toISOString(), status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', expId)
        .eq('founder_id', founderId)
        .is('archived_at', null)
        .select('id, archived_at')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Experiment not found or already archived' });

      return reply.send({ id: data.id, archivedAt: data.archived_at });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to archive experiment' });
    }
  });
}

export const experimentRoutes = fp(experimentsPlugin);
