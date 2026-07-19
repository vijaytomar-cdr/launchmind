/**
 * @file memory.route.ts
 * @description Marketing Memory routes.
 *   GET    /memory                    — list memories (paginated)
 *   GET    /memory/search             — full-text search
 *   GET    /memory/events             — list learning events
 *   GET    /memory/:id                — get memory + version history
 *   POST   /memory                    — create memory manually
 *   POST   /memory/events             — ingest learning event
 *   POST   /memory/:id/merge/:targetId — merge two memories
 *   PATCH  /memory/:id                — update memory (creates version)
 *   DELETE /memory/:id                — archive memory
 * @security JWT required for all routes. Founder isolation enforced at service layer.
 * @dependencies marketingMemoryService, learningPipelineService, jwtPlugin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import {
  createMemory,
  getMemory,
  listMemories,
  updateMemory,
  archiveMemory,
  searchMemories,
  mergeMemories,
} from '../services/marketingMemoryService';
import { ingestLearningEvent } from '../services/learningPipelineService';
import {
  CreateMemoryBodySchema,
  UpdateMemoryBodySchema,
  ListMemoriesQuerySchema,
  SearchMemoriesQuerySchema,
  IngestEventBodySchema,
} from '../types/memory';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export async function memoryRoutes(server: FastifyInstance): Promise<void> {

  // ── GET /memory ─────────────────────────────────────────────────────────────
  server.get('/memory', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = ListMemoriesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', detail: parsed.error.message });

    try {
      const result = await listMemories(founderId, {
        productId:  parsed.data.product_id,
        memoryType: parsed.data.memory_type,
        status:     parsed.data.status,
        limit:      parsed.data.limit,
        offset:     parsed.data.offset,
      });
      return reply.send(result);
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /memory' } });
      return reply.status(500).send({ error: 'Failed to list memories' });
    }
  });

  // ── GET /memory/search ──────────────────────────────────────────────────────
  server.get('/memory/search', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = SearchMemoriesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', detail: parsed.error.message });

    try {
      const memories = await searchMemories(founderId, parsed.data.q, {
        productId:  parsed.data.product_id,
        memoryType: parsed.data.memory_type,
        limit:      parsed.data.limit,
      });
      return reply.send({ memories });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /memory/search' } });
      return reply.status(500).send({ error: 'Search failed' });
    }
  });

  // ── GET /memory/events ──────────────────────────────────────────────────────
  server.get('/memory/events', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const query = request.query as { product_id?: string; limit?: string; offset?: string };

    try {
      let q = getSupabaseAdmin()
        .from('learning_events')
        .select('*', { count: 'exact' })
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false })
        .limit(parseInt(query.limit ?? '30', 10));

      if (query.product_id) q = q.eq('product_id', query.product_id);
      if (query.offset)      q = q.range(parseInt(query.offset, 10), parseInt(query.offset, 10) + parseInt(query.limit ?? '30', 10) - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return reply.send({ events: data ?? [], total: count ?? 0 });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /memory/events' } });
      return reply.status(500).send({ error: 'Failed to list events' });
    }
  });

  // ── GET /memory/:id ─────────────────────────────────────────────────────────
  server.get<{ Params: { id: string } }>('/memory/:id', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    try {
      const memory = await getMemory(request.params.id, founderId);
      return reply.send({ memory });
    } catch {
      return reply.status(404).send({ error: 'Memory not found' });
    }
  });

  // ── POST /memory ────────────────────────────────────────────────────────────
  server.post('/memory', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateMemoryBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });

    try {
      const memory = await createMemory(
        founderId,
        parsed.data.product_id ?? null,
        parsed.data.memory_type,
        parsed.data.title,
        parsed.data.content,
        parsed.data.source,
        parsed.data.confidence,
      );
      return reply.status(201).send({ memory });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /memory' } });
      return reply.status(500).send({ error: 'Failed to create memory' });
    }
  });

  // ── POST /memory/events ─────────────────────────────────────────────────────
  server.post('/memory/events', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = IngestEventBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });

    try {
      const result = await ingestLearningEvent(
        founderId,
        parsed.data.product_id ?? null,
        parsed.data.event_type,
        parsed.data.payload,
      );
      return reply.status(201).send({ result });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /memory/events' } });
      return reply.status(500).send({ error: 'Learning event processing failed' });
    }
  });

  // ── POST /memory/:id/merge/:targetId ────────────────────────────────────────
  server.post<{ Params: { id: string; targetId: string } }>(
    '/memory/:id/merge/:targetId',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      try {
        const memory = await mergeMemories(founderId, request.params.id, request.params.targetId);
        return reply.send({ memory });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        Sentry.captureException(err, { tags: { route: 'POST /memory/:id/merge/:targetId' } });
        return reply.status(500).send({ error: 'Merge failed' });
      }
    },
  );

  // ── PATCH /memory/:id ───────────────────────────────────────────────────────
  server.patch<{ Params: { id: string } }>('/memory/:id', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = UpdateMemoryBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });

    try {
      const memory = await updateMemory(request.params.id, founderId, {
        title:       parsed.data.title,
        content:     parsed.data.content,
        confidence:  parsed.data.confidence,
        change_note: parsed.data.change_note,
        changed_by:  parsed.data.changed_by,
      });
      return reply.send({ memory });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      Sentry.captureException(err, { tags: { route: 'PATCH /memory/:id' } });
      return reply.status(500).send({ error: 'Update failed' });
    }
  });

  // ── DELETE /memory/:id ──────────────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>('/memory/:id', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    try {
      await archiveMemory(request.params.id, founderId);
      return reply.status(204).send();
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'DELETE /memory/:id' } });
      return reply.status(500).send({ error: 'Archive failed' });
    }
  });
}
