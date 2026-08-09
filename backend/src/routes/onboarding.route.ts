/**
 * @file routes/onboarding.route.ts
 * @description Phase 1 onboarding API routes.
 *   All routes require JWT authentication (jwtVerify) — Phase 1 is post-signup.
 *   Discovery jobs are async: POST starts the job, GET polls for status.
 *   The approval boundary step enforces founderAcknowledged = true server-side.
 * @security All routes verify founder_id from JWT. No platform tokens created here.
 *   Phase 1 cannot trigger ad spend or publish to external platforms (spec §28).
 * @dependencies fastify, onboardingService, types/onboarding
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createOrResumeSession, getSession, getSessionWithContext, saveWorkspace,
  startDiscovery, getDiscoveryJob, retryDiscovery, selectMatch,
  acknowledgeReport, getClaims, reviewClaim, completeBeliefReview, regenerateClaims,
  saveAudience, saveContextDelta, saveGoal, saveCompetitors,
  saveBoundaries, prepareDirection, runDirectionGeneration, getDirection, completePhase1,
} from '../services/onboardingService';
import {
  SaveWorkspaceBodySchema, StartDiscoveryBodySchema, SelectMatchBodySchema,
  AcknowledgeReportBodySchema, ReviewClaimBodySchema, SaveAudienceBodySchema,
  SaveContextDeltaBodySchema, SaveGoalBodySchema, SaveCompetitorsBodySchema,
  SaveBoundariesBodySchema, CompletePhase1BodySchema,
  STATE_TO_ROUTE,
} from '../types/onboarding';
import { ok, fail } from '../lib/response';

function getFounderId(request: FastifyRequest): string {
  const payload = request.user as { sub?: string };
  if (!payload?.sub) throw new Error('Invalid JWT: missing sub claim');
  return payload.sub;
}

async function onboardingPlugin(server: FastifyInstance) {
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ── GET /onboarding/session ─────────────────────────────────────────────
  // Returns current session or creates one. Used by frontend to determine step.
  server.get('/onboarding/session', async (request, reply) => {
    const founderId = getFounderId(request);
    try {
      const session = await createOrResumeSession(founderId);
      const nextRoute = STATE_TO_ROUTE[session.current_state];
      return reply.send(ok({ session, nextRoute }));
    } catch (err) {
      return reply.status(500).send(fail('SESSION_ERROR', (err as Error).message));
    }
  });

  // ── GET /onboarding/sessions/:sessionId ─────────────────────────────────
  server.get<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const session = await getSessionWithContext(request.params.sessionId, founderId);
        const nextRoute = STATE_TO_ROUTE[session.current_state];
        return reply.send(ok({ session, nextRoute }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('SESSION_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/workspace ──────────────────────
  server.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/workspace',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SaveWorkspaceBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        const session = await saveWorkspace(request.params.sessionId, founderId, body.data.workspaceName);
        return reply.status(200).send(ok({ session, nextRoute: STATE_TO_ROUTE[session.current_state] }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('WORKSPACE_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/discovery ──────────────────────
  server.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/discovery',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = StartDiscoveryBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        const job = await startDiscovery(
          request.params.sessionId,
          founderId,
          body.data.urls,
          body.data.privateDescription,
        );
        return reply.status(201).send(ok({ job }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('DISCOVERY_ERROR', e.message));
      }
    },
  );

  // ── GET /onboarding/sessions/:sessionId/discovery ───────────────────────
  server.get<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/discovery',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const job = await getDiscoveryJob(request.params.sessionId, founderId);
        if (!job) return reply.status(404).send(fail('NOT_FOUND', 'No discovery job found'));
        const session = await getSession(request.params.sessionId, founderId);
        return reply.send(ok({ job, sessionState: session.current_state }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('DISCOVERY_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/discovery/retry ────────────────
  server.post<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/discovery/retry',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const job = await retryDiscovery(request.params.sessionId, founderId);
        return reply.send(ok({ job }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('RETRY_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/discovery/select ───────────────
  server.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/discovery/select',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SelectMatchBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        const job = await selectMatch(request.params.sessionId, founderId, body.data.matchId);
        return reply.send(ok({ job }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('SELECT_ERROR', e.message));
      }
    },
  );

  // ── GET /onboarding/sessions/:sessionId/report ──────────────────────────
  server.get<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/report',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const job = await getDiscoveryJob(request.params.sessionId, founderId);
        if (!job) return reply.status(404).send(fail('NOT_FOUND', 'No report found'));
        return reply.send(ok({ report: job.report_data, acknowledged: job.report_acknowledged }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('REPORT_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/report/acknowledge ─────────────
  server.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/report/acknowledge',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = AcknowledgeReportBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        await acknowledgeReport(request.params.sessionId, founderId);
        return reply.send(ok({ acknowledged: true }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('ACK_ERROR', e.message));
      }
    },
  );

  // ── GET /onboarding/sessions/:sessionId/claims ──────────────────────────
  server.get<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/claims',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const claims = await getClaims(request.params.sessionId, founderId);
        return reply.send(ok({ claims }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('CLAIMS_ERROR', e.message));
      }
    },
  );

  // ── PATCH /onboarding/sessions/:sessionId/claims/:claimId ───────────────
  server.patch<{ Params: { sessionId: string; claimId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/claims/:claimId',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = ReviewClaimBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        const claim = await reviewClaim(
          request.params.sessionId,
          founderId,
          request.params.claimId,
          body.data.status,
          body.data.correctedValue,
          body.data.founderNote,
        );
        return reply.send(ok({ claim }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('CLAIM_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/claims/complete ────────────────
  server.post<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/claims/complete',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        await completeBeliefReview(request.params.sessionId, founderId);
        return reply.send(ok({ nextState: 'ALIGNMENT_AUDIENCE' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('COMPLETE_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/claims/regenerate ──────────────
  server.post<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/claims/regenerate',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const count = await regenerateClaims(request.params.sessionId, founderId);
        return reply.send(ok({ regenerated: count }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('REGEN_ERROR', e.message));
      }
    },
  );

  // ── PUT /onboarding/sessions/:sessionId/audience ─────────────────────────
  server.put<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/audience',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SaveAudienceBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        await saveAudience(request.params.sessionId, founderId, body.data);
        return reply.send(ok({ saved: true, nextState: 'ALIGNMENT_CONTEXT' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('SAVE_ERROR', e.message));
      }
    },
  );

  // ── PUT /onboarding/sessions/:sessionId/context-delta ───────────────────
  server.put<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/context-delta',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SaveContextDeltaBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        await saveContextDelta(request.params.sessionId, founderId, body.data);
        return reply.send(ok({ saved: true, nextState: 'ALIGNMENT_GOAL' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('SAVE_ERROR', e.message));
      }
    },
  );

  // ── PUT /onboarding/sessions/:sessionId/goal ─────────────────────────────
  server.put<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/goal',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SaveGoalBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        await saveGoal(request.params.sessionId, founderId, body.data);
        return reply.send(ok({ saved: true, nextState: 'ALIGNMENT_COMPETITORS' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('SAVE_ERROR', e.message));
      }
    },
  );

  // ── PUT /onboarding/sessions/:sessionId/competitors ──────────────────────
  server.put<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/competitors',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SaveCompetitorsBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        await saveCompetitors(request.params.sessionId, founderId, body.data.competitors as Array<Record<string, unknown>>);
        return reply.send(ok({ saved: true, nextState: 'BOUNDARIES_SETUP' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('SAVE_ERROR', e.message));
      }
    },
  );

  // ── PUT /onboarding/sessions/:sessionId/boundaries ───────────────────────
  // APPROVAL BOUNDARY GATE: founderAcknowledged must be literal true.
  // Button is disabled in UI until checkbox is checked. Server enforces independently.
  server.put<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/boundaries',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = SaveBoundariesBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      // Server-side enforcement: founderAcknowledged is required by Zod schema (literal true)
      // If it's false or missing, Zod validation above catches it before we reach here.
      try {
        await saveBoundaries(request.params.sessionId, founderId, body.data);
        return reply.send(ok({ saved: true, nextState: 'FINAL_REVIEW' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('BOUNDARIES_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/direction ───────────────────────
  // Returns 202 immediately after creating the placeholder row and transitioning
  // state to DIRECTION_GENERATING. The actual Claude call runs in the background.
  // The frontend polls GET /direction until status='ready'.
  server.post<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/direction',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const { dirId } = await prepareDirection(request.params.sessionId, founderId);
        // Fire the Claude generation after the response is sent
        setImmediate(() => {
          runDirectionGeneration(request.params.sessionId, founderId, dirId).catch(
            (err: Error) => request.log.error({ err }, 'Direction generation failed in background'),
          );
        });
        return reply.status(202).send(ok({ status: 'generating' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('DIRECTION_ERROR', e.message));
      }
    },
  );

  // ── GET /onboarding/sessions/:sessionId/direction ───────────────────────
  server.get<{ Params: { sessionId: string } }>(
    '/onboarding/sessions/:sessionId/direction',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const direction = await getDirection(request.params.sessionId, founderId);
        return reply.send(ok({ direction }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('DIRECTION_ERROR', e.message));
      }
    },
  );

  // ── POST /onboarding/sessions/:sessionId/complete ────────────────────────
  server.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/onboarding/sessions/:sessionId/complete',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = CompletePhase1BodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send(fail('VALIDATION_ERROR', body.error.message));

      try {
        const session = await completePhase1(request.params.sessionId, founderId, body.data.directionId);
        return reply.send(ok({ session, nextRoute: '/dashboard/brief' }));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send(fail('COMPLETE_ERROR', e.message));
      }
    },
  );
}

// Not wrapped with fp() — keeps the plugin scoped so its preHandler hook
// does NOT propagate to the root scope and interfere with public routes
// (e.g. /channels/whatsapp/webhook) that skip JWT intentionally.
export const onboardingRoutes = onboardingPlugin;
