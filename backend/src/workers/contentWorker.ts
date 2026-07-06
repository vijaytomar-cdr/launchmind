/**
 * @file contentWorker.ts
 * @description BullMQ worker for the content generation pipeline.
 *   Processes jobs from the 'content-generation' queue.
 *   Survives backend restarts — jobs queued before a restart are picked up on restart.
 *   Concurrency capped at 2: each job runs one 30-token Sonnet call.
 *
 * @security founderId carried in job data, verified by generateContentAssets() → assembleContext().
 * @dependencies contentService, scheduler (queue name + job type), Sentry
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as Sentry from '@sentry/node';
import { CONTENT_QUEUE_NAME, ContentJobData } from '../lib/scheduler';
import { generateContentAssets } from '../services/contentService';

let _worker: Worker<ContentJobData> | null = null;

/**
 * Starts the BullMQ content generation worker.
 * Called once at server startup when Redis is confirmed reachable.
 * @security Job data (productId, founderId) is not logged beyond truncated IDs.
 */
export function startContentWorker(): void {
  if (_worker) return; // idempotent

  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => Math.min(times * 500, 30_000),
  });

  _worker = new Worker<ContentJobData>(
    CONTENT_QUEUE_NAME,
    async (job: Job<ContentJobData>) => {
      const { productId, founderId, briefId } = job.data;
      console.log(`[contentWorker] job ${job.id} — product ${productId.substring(0, 8)}…`);
      await generateContentAssets(productId, founderId, briefId);
      console.log(`[contentWorker] job ${job.id} completed`);
    },
    {
      connection,
      concurrency: 2,
    }
  );

  _worker.on('failed', (job, err) => {
    console.error(`[contentWorker] job ${job?.id} failed:`, err.message);
    Sentry.captureException(err, { tags: { worker: 'contentWorker', jobId: job?.id } });
  });

  console.log('[contentWorker] Worker started');
}
