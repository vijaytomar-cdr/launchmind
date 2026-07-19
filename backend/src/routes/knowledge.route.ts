/**
 * @file knowledge.route.ts
 * @description Knowledge Graph routes.
 *   GET    /knowledge/graph          — full graph for product
 *   GET    /knowledge/nodes/:id      — node + edges
 *   POST   /knowledge/nodes          — create node
 *   POST   /knowledge/edges          — create edge
 *   POST   /knowledge/nodes/:id/merge/:targetId — merge nodes
 *   DELETE /knowledge/nodes/:id      — delete node (cascades edges)
 *   DELETE /knowledge/edges/:id      — delete edge
 * @security JWT required. Founder ownership verified at service layer for every mutation.
 * @dependencies knowledgeGraphService, jwtPlugin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import {
  getGraph,
  getNode,
  createNode,
  createEdge,
  deleteNode,
  deleteEdge,
  mergeNodes,
} from '../services/knowledgeGraphService';
import {
  CreateNodeBodySchema,
  CreateEdgeBodySchema,
  GetGraphQuerySchema,
} from '../types/memory';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export async function knowledgeRoutes(server: FastifyInstance): Promise<void> {

  // ── GET /knowledge/graph ────────────────────────────────────────────────────
  server.get('/knowledge/graph', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = GetGraphQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', detail: parsed.error.message });

    try {
      const graph = await getGraph(founderId, parsed.data.product_id);
      return reply.send({ graph });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /knowledge/graph' } });
      return reply.status(500).send({ error: 'Failed to load graph' });
    }
  });

  // ── GET /knowledge/nodes/:id ────────────────────────────────────────────────
  server.get<{ Params: { id: string } }>('/knowledge/nodes/:id', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    try {
      const node = await getNode(request.params.id, founderId);
      return reply.send({ node });
    } catch {
      return reply.status(404).send({ error: 'Node not found' });
    }
  });

  // ── POST /knowledge/nodes ───────────────────────────────────────────────────
  server.post('/knowledge/nodes', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateNodeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });

    try {
      const node = await createNode(
        founderId,
        parsed.data.product_id ?? null,
        parsed.data.node_type,
        parsed.data.label,
        parsed.data.properties,
        parsed.data.source_id,
        parsed.data.source_type,
        parsed.data.confidence,
      );
      return reply.status(201).send({ node });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /knowledge/nodes' } });
      return reply.status(500).send({ error: 'Failed to create node' });
    }
  });

  // ── POST /knowledge/edges ───────────────────────────────────────────────────
  server.post('/knowledge/edges', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateEdgeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });

    try {
      const edge = await createEdge(
        founderId,
        parsed.data.source_id,
        parsed.data.target_id,
        parsed.data.relationship,
        parsed.data.weight,
        parsed.data.properties,
      );
      return reply.status(201).send({ edge });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      Sentry.captureException(err, { tags: { route: 'POST /knowledge/edges' } });
      return reply.status(500).send({ error: 'Failed to create edge' });
    }
  });

  // ── POST /knowledge/nodes/:id/merge/:targetId ───────────────────────────────
  server.post<{ Params: { id: string; targetId: string } }>(
    '/knowledge/nodes/:id/merge/:targetId',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      try {
        const node = await mergeNodes(founderId, request.params.id, request.params.targetId);
        return reply.send({ node });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        Sentry.captureException(err, { tags: { route: 'POST /knowledge/nodes/:id/merge/:targetId' } });
        return reply.status(500).send({ error: 'Merge failed' });
      }
    },
  );

  // ── DELETE /knowledge/nodes/:id ─────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>('/knowledge/nodes/:id', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    try {
      await deleteNode(request.params.id, founderId);
      return reply.status(204).send();
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'DELETE /knowledge/nodes/:id' } });
      return reply.status(500).send({ error: 'Delete failed' });
    }
  });

  // ── DELETE /knowledge/edges/:id ─────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>('/knowledge/edges/:id', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    try {
      await deleteEdge(request.params.id, founderId);
      return reply.status(204).send();
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'DELETE /knowledge/edges/:id' } });
      return reply.status(500).send({ error: 'Delete failed' });
    }
  });
}
