/**
 * @file reports.route.ts
 * @description M11 Reports routes — list, generate, view, export, feedback.
 *   Reports cache AI-generated narrative content in the `reports` table.
 *   Weekly reports trigger ingestLearningEvent to feed Marketing Memory.
 * @security JWT required. request.jwtVerify() on every handler. RLS at DB level.
 * @dependencies reportingService, supabaseAdmin
 */

import { FastifyInstance } from 'fastify';
import fp                  from 'fastify-plugin';
import { z }               from 'zod';
import { ok, fail }        from '../lib/response';
import { generateReport }  from '../services/reportingService';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

const ListQuerySchema = z.object({
  productId:  z.string().uuid().optional(),
  reportType: z.enum(['weekly', 'monthly', 'executive', 'campaign', 'experiment']).optional(),
  limit:      z.coerce.number().int().min(1).max(50).optional(),
});

const GenerateBodySchema = z.object({
  productId:   z.string().uuid(),
  reportType:  z.enum(['weekly', 'monthly', 'executive', 'campaign', 'experiment']),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  force:       z.boolean().optional(),
  contextData: z.record(z.unknown()).optional(),
});

const FeedbackBodySchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

async function reportsRoutes(server: FastifyInstance): Promise<void> {

  /**
   * GET /reports?productId=&reportType=&limit=
   * Lists reports for the authenticated founder.
   */
  server.get('/reports', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = ListQuerySchema.safeParse(req.query);
    const { productId, reportType, limit } = parsed.success ? parsed.data : { productId: undefined, reportType: undefined, limit: 20 };
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('reports')
      .select('id, product_id, report_type, period_start, period_end, title, summary, status, ai_tokens_consumed, export_count, created_at, updated_at')
      .eq('founder_id', founderId)
      .order('period_start', { ascending: false });

    if (productId)  query = query.eq('product_id', productId);
    if (reportType) query = query.eq('report_type', reportType);

    const { data, error } = await query.limit(limit ?? 20);
    if (error) return reply.code(500).send(fail('Failed to fetch reports'));

    return reply.send(ok({ reports: data ?? [] }));
  });

  /**
   * POST /reports/generate
   * Generates (or returns cached) a report for the specified period + type.
   */
  server.post('/reports/generate', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const parsed = GenerateBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail(parsed.error.issues[0]?.message ?? 'Invalid body'));

    try {
      const result = await generateReport({ founderId, ...parsed.data });
      return reply.code(result.created ? 201 : 200).send(ok(result));
    } catch (e: unknown) {
      req.log.error(e, 'reports:generate');
      const msg = e instanceof Error ? e.message : 'Generation failed';
      return reply.code(500).send(fail(msg));
    }
  });

  /**
   * GET /reports/:id
   * Fetches a report by ID (owner-scoped).
   */
  server.get('/reports/:id', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const { id } = req.params as { id: string };
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single();

    if (error || !data) return reply.code(404).send(fail('Report not found'));
    return reply.send(ok(data));
  });

  /**
   * GET /reports/:id/export
   * Returns the report content as structured JSON. Increments export_count.
   */
  server.get('/reports/:id/export', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const { id } = req.params as { id: string };
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single();

    if (error || !data) return reply.code(404).send(fail('Report not found'));

    await supabase
      .from('reports')
      .update({ export_count: ((data as { export_count: number }).export_count ?? 0) + 1, status: 'exported' })
      .eq('id', id);

    const report = data as {
      id: string; product_id: string; report_type: string;
      period_start: string; period_end: string;
      title: string; summary: string; content: unknown;
      metrics_snapshot: unknown; created_at: string;
    };

    return reply.send(ok({
      exportedAt:      new Date().toISOString(),
      reportId:        report.id,
      productId:       report.product_id,
      reportType:      report.report_type,
      period:          { start: report.period_start, end: report.period_end },
      title:           report.title,
      summary:         report.summary,
      content:         report.content,
      metricsSnapshot: report.metrics_snapshot,
      generatedAt:     report.created_at,
    }));
  });

  /**
   * POST /reports/:id/feedback
   * Stores founder rating (1–5) in audit_logs.
   */
  server.post('/reports/:id/feedback', async (req, reply) => {
    await req.jwtVerify();
    const founderId = (req.user as { sub: string }).sub;

    const { id } = req.params as { id: string };
    const parsed = FeedbackBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('rating (1–5) required'));

    const supabase = getSupabaseAdmin();

    const { data: report } = await supabase
      .from('reports')
      .select('id, product_id, report_type')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single();

    if (!report) return reply.code(404).send(fail('Report not found'));

    const r = report as { id: string; product_id: string; report_type: string };

    await supabase.from('audit_logs').insert({
      founder_id:    founderId,
      action:        'report_feedback',
      resource_type: 'report',
      resource_id:   id,
      metadata: {
        product_id:  r.product_id,
        report_type: r.report_type,
        rating:      parsed.data.rating,
        comment:     parsed.data.comment ?? null,
      },
    });

    return reply.code(201).send(ok({ recorded: true }));
  });
}

export default fp(reportsRoutes);
