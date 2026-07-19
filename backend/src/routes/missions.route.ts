/**
 * @file missions.route.ts
 * @description Mission Orchestrator API routes.
 *   POST   /missions                   — create + queue a mission
 *   GET    /missions                   — list missions (paginated, filterable)
 *   GET    /missions/approvals         — pending approvals for the founder
 *   GET    /missions/:id               — get mission + steps
 *   GET    /missions/:id/timeline      — mission steps + logs interleaved
 *   GET    /missions/:id/logs          — mission logs
 *   POST   /missions/:id/cancel        — cancel a running/queued mission
 *   POST   /missions/:id/retry         — retry a failed mission
 *   POST   /missions/:id/approvals/:stepId — respond to an approval gate
 * @security JWT verified before every handler body. founderId isolated at service layer.
 * @dependencies missionService, missionWorker, jwtPlugin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';

import {
  createMission,
  queueMission,
  cancelMission,
  retryMission,
  getMission,
  listMissions,
  getMissionSteps,
  getMissionLogs,
  respondToApproval,
  getPendingApprovals,
  MISSION_PRIORITY,
} from '../services/missionService';
import { enqueueMission } from '../workers/missionWorker';
import {
  CreateMissionSchema,
  RespondToApprovalSchema,
} from '../types/mission';

const ListMissionsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  status:    z.string().optional(),
  type:      z.string().optional(),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
  offset:    z.coerce.number().int().min(0).default(0),
});

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

async function missionsRoutes(server: FastifyInstance): Promise<void> {

  // POST /missions — create and queue a mission
  server.post('/missions', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const body      = CreateMissionSchema.parse(request.body);

      const mission  = await createMission(founderId, body);
      const payload  = await queueMission(mission.id, founderId);
      const priority = MISSION_PRIORITY[body.type];
      await enqueueMission(payload, priority);

      reply.status(201).send({ mission });
    } catch (err) {
      Sentry.captureException(err);
      if ((err as { name?: string }).name === 'ZodError') return reply.status(400).send({ error: 'Invalid request', details: (err as z.ZodError).errors });
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /missions — list missions
  server.get('/missions', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const query     = ListMissionsQuerySchema.parse(request.query);
      const result    = await listMissions(founderId, query);
      reply.send(result);
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /missions/approvals — pending approval gates
  server.get('/missions/approvals', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const approvals = await getPendingApprovals(founderId);
      reply.send({ approvals });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /missions/:id — mission detail with steps
  server.get('/missions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;

      const mission = await getMission(id, founderId);
      if (!mission) return reply.status(404).send({ error: 'Mission not found' });

      const steps = await getMissionSteps(id, founderId);
      reply.send({ mission, steps });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /missions/:id/timeline — steps + logs interleaved
  server.get('/missions/:id/timeline', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;

      const mission = await getMission(id, founderId);
      if (!mission) return reply.status(404).send({ error: 'Mission not found' });

      const [steps, logs] = await Promise.all([
        getMissionSteps(id, founderId),
        getMissionLogs(id, founderId),
      ]);

      const timeline = [
        ...steps.map(s => ({ ...s, _kind: 'step' as const })),
        ...logs.map(l => ({ ...l,  _kind: 'log'  as const })),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      reply.send({ mission, timeline });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /missions/:id/logs
  server.get('/missions/:id/logs', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;
      const logs      = await getMissionLogs(id, founderId);
      reply.send({ logs });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /missions/:id/cancel
  server.post('/missions/:id/cancel', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;
      await cancelMission(id, founderId);
      reply.send({ success: true });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(400).send({ error: (err as Error).message });
    }
  });

  // POST /missions/:id/retry
  server.post('/missions/:id/retry', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const founderId = getFounderId(request);
      const { id }    = request.params;

      const payload  = await retryMission(id, founderId);
      const mission  = await getMission(id, founderId);
      const priority = mission ? MISSION_PRIORITY[mission.type] : 25;
      await enqueueMission(payload, priority);

      reply.send({ success: true });
    } catch (err) {
      Sentry.captureException(err);
      reply.status(400).send({ error: (err as Error).message });
    }
  });

  // POST /missions/:id/approvals/:stepId — founder responds to approval gate
  server.post(
    '/missions/:id/approvals/:stepId',
    async (request: FastifyRequest<{ Params: { id: string; stepId: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      try {
        const founderId      = getFounderId(request);
        const { id, stepId } = request.params;
        const body           = RespondToApprovalSchema.parse(request.body);

        await respondToApproval(id, stepId, founderId, body.response, body.responseNote);

        if (body.response === 'approved') {
          const mission  = await getMission(id, founderId);
          const priority = mission ? MISSION_PRIORITY[mission.type] : 25;
          await enqueueMission({ missionId: id, founderId, productId: mission?.product_id ?? null }, priority);
        }

        reply.send({ success: true, response: body.response });
      } catch (err) {
        Sentry.captureException(err);
        if ((err as { name?: string }).name === 'ZodError') return reply.status(400).send({ error: 'Invalid request' });
        reply.status(500).send({ error: (err as Error).message });
      }
    },
  );
}

export const missionRoutes = fp(missionsRoutes);
