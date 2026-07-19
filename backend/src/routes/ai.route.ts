/**
 * @file ai.route.ts
 * @description AI Platform routes — context assembly, prompt registry, and audit log.
 *   GET  /ai/context/:productId    — Build ContextPackage for a product (read-only)
 *   GET  /ai/prompts               — List all active prompts
 *   GET  /ai/prompts/:promptId/versions — List all versions of a specific prompt
 *   POST /ai/prompts               — Register a new prompt version (Studio plan only)
 *   GET  /ai/audit                 — Paginated AI request history for the authenticated founder
 *   GET  /ai/audit/stats           — Aggregated token + cost summary by model / promptId
 * @security All routes call request.jwtVerify(). founderId always sourced from JWT, never body.
 * @dependencies contextEngine, promptRegistry, supabaseAdmin
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildContextPackage } from '../lib/contextEngine';
import { listPrompts, listPromptVersions, registerPrompt, type CreatePromptInput } from '../lib/promptRegistry';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { ok, fail, ErrorCodes } from '../lib/response';

// ── Schemas ───────────────────────────────────────────────────────────────────

const RegisterPromptBody = z.object({
  promptId:       z.string().min(1).max(100),
  purpose:        z.string().min(1),
  owner:          z.string().optional(),
  model:          z.enum(['sonnet', 'haiku']),
  systemTemplate: z.string().optional(),
  userTemplate:   z.string().min(1),
  tokenCost:      z.number().int().min(0).optional(),
  status:         z.enum(['draft', 'active']).optional(),
});

const AuditQuerySchema = z.object({
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
  promptId: z.string().optional(),
  status:   z.enum(['success', 'failed', 'retried', 'timeout']).optional(),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

async function aiPlugin(server: FastifyInstance): Promise<void> {

  // ── GET /ai/context/:productId ──────────────────────────────────────────────
  server.get<{ Params: { productId: string } }>(
    '/ai/context/:productId',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;
      const { productId } = request.params;

      try {
        const ctx = await buildContextPackage(founderId, productId, {
          includeMemories:       true,
          includeKnowledgeGraph: true,
          includeCampaigns:      true,
          includeAnalytics:      true,
        });
        return reply.status(200).send(ok(ctx));
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send(fail(ErrorCodes.INTERNAL_ERROR, 'Failed to build context'));
      }
    }
  );

  // ── GET /ai/prompts ─────────────────────────────────────────────────────────
  server.get(
    '/ai/prompts',
    async (request, reply) => {
      await request.jwtVerify();
      const prompts = await listPrompts();
      return reply.status(200).send(ok(prompts));
    }
  );

  // ── GET /ai/prompts/:promptId/versions ─────────────────────────────────────
  server.get<{ Params: { promptId: string } }>(
    '/ai/prompts/:promptId/versions',
    async (request, reply) => {
      await request.jwtVerify();
      const versions = await listPromptVersions(request.params.promptId);
      if (!versions.length) {
        return reply.status(404).send(fail(ErrorCodes.NOT_FOUND, 'Prompt not found'));
      }
      return reply.status(200).send(ok(versions));
    }
  );

  // ── POST /ai/prompts ────────────────────────────────────────────────────────
  server.post(
    '/ai/prompts',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      // Studio tier only
      const supabase = getSupabaseAdmin();
      const { data: founder } = await supabase
        .from('founders')
        .select('plan')
        .eq('id', founderId)
        .single();

      if (!founder || founder.plan !== 'studio') {
        return reply.status(403).send(fail(ErrorCodes.FORBIDDEN, 'Studio plan required to manage prompts'));
      }

      const parsed = RegisterPromptBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(ErrorCodes.VALIDATION_ERROR, 'Invalid prompt data'));
      }

      try {
        const prompt = await registerPrompt(parsed.data as CreatePromptInput);
        return reply.status(201).send(ok(prompt));
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send(fail(ErrorCodes.INTERNAL_ERROR, 'Failed to register prompt'));
      }
    }
  );

  // ── GET /ai/audit ───────────────────────────────────────────────────────────
  server.get(
    '/ai/audit',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;
      const query = AuditQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send(fail(ErrorCodes.VALIDATION_ERROR, 'Invalid query params'));
      }

      const { limit, offset, promptId, status } = query.data;
      const supabase = getSupabaseAdmin();

      let q = supabase
        .from('ai_requests')
        .select('id, prompt_id, prompt_version, model, action, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, retries, status, error, context_sources, created_at', { count: 'exact' })
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (promptId) q = q.eq('prompt_id', promptId);
      if (status)   q = q.eq('status', status);

      const { data, error, count } = await q;
      if (error) {
        return reply.status(500).send(fail(ErrorCodes.INTERNAL_ERROR, 'Failed to fetch audit log'));
      }

      return reply.status(200).send(ok({ requests: data ?? [], total: count ?? 0, limit, offset }));
    }
  );

  // ── GET /ai/audit/stats ─────────────────────────────────────────────────────
  server.get(
    '/ai/audit/stats',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;
      const supabase = getSupabaseAdmin();

      const { data, error } = await supabase
        .from('ai_requests')
        .select('model, prompt_id, total_tokens, cost_usd, latency_ms, status')
        .eq('founder_id', founderId);

      if (error) {
        return reply.status(500).send(fail(ErrorCodes.INTERNAL_ERROR, 'Failed to fetch stats'));
      }

      const rows = data ?? [];

      const byModel: Record<string, { requests: number; totalTokens: number; totalCostUsd: number; avgLatencyMs: number }> = {};
      const byPrompt: Record<string, { requests: number; failures: number }> = {};

      let totalCostUsd = 0;
      let totalTokens = 0;
      let totalRequests = 0;
      let failures = 0;

      for (const row of rows) {
        const model = (row.model as string) ?? 'unknown';
        if (!byModel[model]) byModel[model] = { requests: 0, totalTokens: 0, totalCostUsd: 0, avgLatencyMs: 0 };

        const bm = byModel[model];
        bm.requests += 1;
        bm.totalTokens += (row.total_tokens as number) ?? 0;
        bm.totalCostUsd += (row.cost_usd as number) ?? 0;
        bm.avgLatencyMs += (row.latency_ms as number) ?? 0;

        const pid = (row.prompt_id as string) ?? 'unknown';
        if (!byPrompt[pid]) byPrompt[pid] = { requests: 0, failures: 0 };
        byPrompt[pid].requests += 1;
        if (row.status === 'failed' || row.status === 'timeout') byPrompt[pid].failures += 1;

        totalCostUsd  += (row.cost_usd as number) ?? 0;
        totalTokens   += (row.total_tokens as number) ?? 0;
        totalRequests += 1;
        if (row.status === 'failed' || row.status === 'timeout') failures += 1;
      }

      for (const bm of Object.values(byModel)) {
        bm.avgLatencyMs = bm.requests > 0 ? Math.round(bm.avgLatencyMs / bm.requests) : 0;
      }

      return reply.status(200).send(ok({
        totals: { requests: totalRequests, totalTokens, totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000, failures },
        byModel,
        byPrompt,
      }));
    }
  );
}

export const aiRoutes = fp(aiPlugin);
