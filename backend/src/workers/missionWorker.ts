/**
 * @file missionWorker.ts
 * @description BullMQ worker for the `mission-execution` queue.
 *   Dispatches each mission step to the appropriate agent via AGENT_REGISTRY.
 *   Handles approval gates, retries, and DLQ-via-DB on exhaustion.
 * @security
 *   founderId verified against mission.founder_id before any step runs.
 *   Publishing steps enforce campaigns.approved_at != null (inside publishingAgent).
 *   Spend caps verified inside campaignAgent before draft creation.
 * @dependencies BullMQ, missionService, AGENT_REGISTRY, contextEngine, Sentry
 */

import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as Sentry from '@sentry/node';

import { AGENT_REGISTRY } from '../services/agentRegistry';
import {
  startMission,
  getNextPendingStep,
  startStep,
  completeStep,
  failStep,
  requestApproval,
  completeMission,
  failMission,
  logMission,
  getMission,
} from '../services/missionService';
import { buildContextPackage }   from '../lib/contextEngine';
import type { MissionJobPayload } from '../types/mission';

export const MISSION_QUEUE_NAME = 'mission-execution';

let _queue:  Queue<MissionJobPayload>  | null = null;
let _worker: Worker<MissionJobPayload> | null = null;

function makeConnection(): IORedis {
  const conn = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue:   false,
    retryStrategy:        (times: number) => Math.min(times * 500, 30_000),
  });
  let warned = false;
  conn.on('error', (err: Error) => {
    if (!warned) {
      console.warn('[missionWorker] Redis unavailable:', err.message);
      warned = true;
    }
  });
  return conn;
}

/** Returns (creating if needed) the BullMQ queue for mission execution. */
export function getMissionQueue(): Queue<MissionJobPayload> {
  if (!_queue) {
    _queue = new Queue<MissionJobPayload>(MISSION_QUEUE_NAME, {
      connection: makeConnection(),
      defaultJobOptions: {
        attempts:    3,
        backoff:     { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail:     { count: 100 },
      },
    });
  }
  return _queue;
}

/** Enqueues a mission job. Called by missionService.queueMission(). */
export async function enqueueMission(
  payload:  MissionJobPayload,
  priority: number = 25,
): Promise<void> {
  const queue = getMissionQueue();
  await queue.add('mission', payload, {
    priority,
    jobId: payload.missionId, // idempotent: same mission → same job slot
  });
}

/**
 * Starts the singleton BullMQ mission worker.
 * Idempotent — calling twice returns early.
 */
export function startMissionWorker(): void {
  if (_worker) return;

  _worker = new Worker<MissionJobPayload>(
    MISSION_QUEUE_NAME,
    async (job: Job<MissionJobPayload>): Promise<void> => {
      const { missionId, founderId, productId } = job.data;

      // 1. Load the mission
      const mission = await getMission(missionId, founderId);
      if (!mission) {
        console.warn(`[missionWorker] Mission not found: ${missionId}`);
        return;
      }

      // Skip if already completed/cancelled
      if (mission.status === 'completed' || mission.status === 'cancelled') return;

      // 2. Transition to running
      if (mission.status === 'queued') {
        await startMission(missionId, founderId);
      }

      // 3. Build context package once per execution (all steps share it)
      let contextPkg;
      try {
        contextPkg = await buildContextPackage(founderId, productId ?? null);
      } catch (err) {
        const msg = `Context build failed: ${(err as Error).message}`;
        await failMission(missionId, founderId, msg);
        throw err;
      }

      // 4. Step loop — process all pending steps in order
      let step = await getNextPendingStep(missionId, founderId);

      while (step) {
        const { id: stepId, agent_type: agentType, requires_approval: requiresApproval, step_order } = step;

        await logMission(missionId, founderId, stepId, `Running step ${step_order}: ${agentType}`);
        await startStep(stepId, founderId);

        // Build AgentContext
        const agentCtx = {
          founderId,
          productId:  productId ?? null,
          missionId,
          stepId,
          contextPkg,
          log: (message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info', meta?: Record<string, unknown>) =>
            logMission(missionId, founderId, stepId, message, level, meta),
        };

        const agentFn = AGENT_REGISTRY[agentType];
        if (!agentFn) {
          await failStep(stepId, founderId, missionId, `No agent registered for type: ${agentType}`);
          await failMission(missionId, founderId, `Unknown agent type: ${agentType}`);
          return;
        }

        let output: Record<string, unknown>;
        try {
          output = await agentFn(step.input ?? {}, agentCtx);
        } catch (err) {
          const errMsg = (err as Error).message;
          Sentry.captureException(err, { extra: { missionId, stepId, agentType } });

          const canRetry = await failStep(stepId, founderId, missionId, errMsg);
          if (!canRetry) {
            await failMission(missionId, founderId, `Step ${step_order} (${agentType}) exhausted retries: ${errMsg}`);
            return;
          }
          // Re-throw so BullMQ's own retry logic kicks in for the job as a whole
          throw err;
        }

        // Step succeeded — check for approval gate
        if (requiresApproval) {
          const title       = (output.approvalTitle as string)  ?? `Approve: ${agentType} output`;
          const description = (output.approvalDesc as string)   ?? 'Please review and approve this step.';
          const previewData = (output.approvalPreview as Record<string, unknown>) ?? output;

          await requestApproval(stepId, missionId, founderId, title, description, previewData);
          // Mission is now waiting_approval — return so worker releases the job
          return;
        }

        await completeStep(stepId, founderId, output);

        // Get next step (loop)
        step = await getNextPendingStep(missionId, founderId);
      }

      // No more pending steps — mission complete
      await completeMission(missionId, founderId);
    },
    {
      connection:  makeConnection(),
      concurrency: 5,
    },
  );

  _worker.on('failed', (job, err) => {
    if (job) {
      console.error(`[missionWorker] Job ${job.id} failed:`, err.message);
      Sentry.captureException(err, { extra: { jobId: job.id, data: job.data } });
    }
  });

  _worker.on('error', (err) => {
    console.error('[missionWorker] Worker error:', err.message);
  });

  console.log('[missionWorker] Started mission-execution worker');
}

/** Graceful shutdown — drain and close. */
export async function stopMissionWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
