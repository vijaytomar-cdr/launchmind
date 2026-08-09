/**
 * @file analytics.route.ts
 * @description M11 Analytics routes — KPI summary, trends, attribution, funnel, ROI, optimize.
 *   Supplements /results (M07) with deeper drill-down per product.
 *   Does NOT duplicate existing campaign_metrics endpoints.
 * @security JWT required. request.jwtVerify() called on every handler.
 * @dependencies analyticsService, optimizationEngineService
 */

import { FastifyInstance } from 'fastify';
import fp                  from 'fastify-plugin';
import { z }               from 'zod';
import { ok, fail, ErrorCodes } from '../lib/response';
import {
  getAnalyticsSummary,
  getKPITrend,
  getAttribution,
  getFunnel,
  getROI,
}                          from '../services/analyticsService';
import { generateInsights, listInsights, updateInsightStatus } from '../services/optimizationEngineService';

const ProductIdQuerySchema = z.object({
  productId: z.string().uuid(),
});

const WeeksQuerySchema = z.object({
  productId: z.string().uuid(),
  weeks:     z.coerce.number().int().min(1).max(52).optional(),
});

const OptimizeBodySchema = z.object({
  productId: z.string().uuid(),
});

const InsightStatusBodySchema = z.object({
  status:      z.enum(['applied', 'dismissed']),
  actionTaken: z.string().optional(),
});

async function analyticsRoutes(server: FastifyInstance): Promise<void> {

  /**
   * GET /analytics/summary
   * Cross-product KPI summary for a founder.
   */
  server.get('/analytics/summary', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    try {
      const summary = await getAnalyticsSummary(founderId);
      return reply.send(ok(summary));
    } catch (e) {
      req.log.error(e, 'analytics:summary');
      return reply.code(500).send(fail('Failed to compute analytics summary', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * GET /analytics/kpi?productId=&weeks=
   * Weekly KPI time-series for a single product.
   */
  server.get('/analytics/kpi', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = WeeksQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('productId required', ErrorCodes.VALIDATION_ERROR));

    const { productId, weeks } = parsed.data;
    try {
      const trend = await getKPITrend(productId, founderId, weeks ?? 12);
      return reply.send(ok({ productId, weeks: trend }));
    } catch (e) {
      req.log.error(e, 'analytics:kpi');
      return reply.code(500).send(fail('Failed to compute KPI trend', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * GET /analytics/attribution?productId=
   * Last-touch channel attribution for a product.
   */
  server.get('/analytics/attribution', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = ProductIdQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('productId required', ErrorCodes.VALIDATION_ERROR));

    try {
      const attribution = await getAttribution(parsed.data.productId, founderId);
      return reply.send(ok(attribution));
    } catch (e) {
      req.log.error(e, 'analytics:attribution');
      return reply.code(500).send(fail('Failed to compute attribution', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * GET /analytics/funnel?productId=
   * Install funnel: impressions → clicks → installs per channel.
   */
  server.get('/analytics/funnel', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = ProductIdQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('productId required', ErrorCodes.VALIDATION_ERROR));

    try {
      const funnel = await getFunnel(parsed.data.productId, founderId);
      return reply.send(ok(funnel));
    } catch (e) {
      req.log.error(e, 'analytics:funnel');
      return reply.code(500).send(fail('Failed to compute funnel', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * GET /analytics/roi?productId=
   * ROI estimation per channel.
   */
  server.get('/analytics/roi', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = ProductIdQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('productId required', ErrorCodes.VALIDATION_ERROR));

    try {
      const roi = await getROI(parsed.data.productId, founderId);
      return reply.send(ok(roi));
    } catch (e) {
      req.log.error(e, 'analytics:roi');
      return reply.code(500).send(fail('Failed to compute ROI', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * POST /analytics/optimize
   * Triggers AI optimization insight generation for a product.
   */
  server.post('/analytics/optimize', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = OptimizeBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('productId required', ErrorCodes.VALIDATION_ERROR));

    try {
      const result = await generateInsights(founderId, parsed.data.productId);
      return reply.code(201).send(ok(result));
    } catch (e) {
      req.log.error(e, 'analytics:optimize');
      return reply.code(500).send(fail('Failed to generate optimization insights', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * GET /analytics/insights?productId=
   * Lists active optimization insights for a product.
   */
  server.get('/analytics/insights', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = ProductIdQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('productId required', ErrorCodes.VALIDATION_ERROR));

    try {
      const insights = await listInsights(founderId, parsed.data.productId);
      return reply.send(ok({ insights }));
    } catch (e) {
      req.log.error(e, 'analytics:insights');
      return reply.code(500).send(fail('Failed to fetch insights', ErrorCodes.INTERNAL_ERROR));
    }
  });

  /**
   * PATCH /analytics/insights/:id
   * Marks an insight as applied or dismissed.
   */
  server.patch('/analytics/insights/:id', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const { id } = req.params as { id: string };
    const parsed = InsightStatusBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('status (applied|dismissed) required', ErrorCodes.VALIDATION_ERROR));

    try {
      await updateInsightStatus(id, founderId, parsed.data.status, parsed.data.actionTaken);
      return reply.send(ok({ updated: true }));
    } catch (e) {
      req.log.error(e, 'analytics:insights:update');
      return reply.code(500).send(fail('Failed to update insight', ErrorCodes.INTERNAL_ERROR));
    }
  });
}

export default fp(analyticsRoutes);
