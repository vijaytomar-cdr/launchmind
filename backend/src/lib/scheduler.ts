/**
 * @file scheduler.ts
 * @description BullMQ queue and scheduler for the LaunchMind weekly brief pipeline.
 *   Weekly job: every Sunday at 17:00 UTC — fires for every active product.
 *   One-off job: triggerBriefNow() — admin endpoint or manual trigger.
 *   Retries: 3 attempts with exponential backoff (2s → 4s → 8s base).
 *   videoQueue: separate queue for Creatomate video rendering jobs.
 * @security
 *   - Queue is internal only — no public endpoint writes directly to the queue.
 *   - Admin trigger endpoint verifies ADMIN_SECRET header before enqueuing.
 *   - founderId and productId carried in job data are not logged in full.
 * @dependencies bullmq, ioredis
 */

import { Queue, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export const BRIEF_QUEUE_NAME = 'weekly-brief';
export const VIDEO_QUEUE_NAME = 'video-render';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

// ── Weekly brief cron expression: Sunday 17:00 UTC ────────────────────────────
export const WEEKLY_BRIEF_CRON = '0 17 * * 0';
export const WEEKLY_BRIEF_JOB_NAME = 'weekly-brief-all-products';

export interface BriefJobData {
  productId: string;
  founderId: string;
  weekOf: string; // ISO date string YYYY-MM-DD
  triggeredBy: 'cron' | 'admin';
}

export interface VideoJobData {
  assetId: string;
  productId: string;
  founderId: string;
  renderId: string;
}

let _queue: Queue<BriefJobData> | null = null;
let _videoQueue: Queue<VideoJobData> | null = null;
let _connection: IORedis | null = null;

function getRedisConnection(): IORedis {
  if (_connection) return _connection;
  _connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    // Back off to 30s max — prevents retry storms when Redis is unavailable locally
    retryStrategy: (times: number) => Math.min(times * 500, 30_000),
  });
  _connection.on('error', (err: Error) => {
    if (process.env.NODE_ENV !== 'production') {
      // Suppress per-retry noise in dev; server stays healthy without Redis
      if (!_redisWarnedOnce) {
        console.warn('[scheduler] Redis unavailable — BullMQ queues disabled:', err.message);
        _redisWarnedOnce = true;
      }
    }
  });
  return _connection;
}

let _redisWarnedOnce = false;

/**
 * Returns the singleton BullMQ queue for weekly briefs.
 * Lazy-initialised so tests can stub Redis before first call.
 */
export function getBriefQueue(): Queue<BriefJobData> {
  if (_queue) return _queue;
  _queue = new Queue<BriefJobData>(BRIEF_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return _queue;
}

/**
 * Returns the singleton BullMQ queue for video rendering jobs.
 * Lazy-initialised so tests can stub Redis before first call.
 */
export function getVideoQueue(): Queue<VideoJobData> {
  if (_videoQueue) return _videoQueue;
  _videoQueue = new Queue<VideoJobData>(VIDEO_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return _videoQueue;
}

/** Singleton accessor used by contentService for fire-and-forget video render jobs. */
export const videoQueue = {
  add: (name: string, data: VideoJobData) => getVideoQueue().add(name, data),
};

/**
 * Schedules the weekly repeating brief job for all active products.
 * Idempotent — removes any existing repeatable job with the same key before adding.
 * Called once at server startup (after DB is confirmed reachable).
 * @throws {Error} If Redis is not reachable
 */
export async function scheduleWeeklyBrief(): Promise<void> {
  const queue = getBriefQueue();

  // Remove stale repeatable job (idempotent restart safety)
  const existingRepeatables = await queue.getRepeatableJobs();
  for (const job of existingRepeatables) {
    if (job.name === WEEKLY_BRIEF_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  await queue.add(
    WEEKLY_BRIEF_JOB_NAME,
    {
      productId: 'ALL',
      founderId: 'ALL',
      weekOf: '', // populated by worker at run time
      triggeredBy: 'cron',
    },
    {
      repeat: { pattern: WEEKLY_BRIEF_CRON, tz: 'UTC' },
      ...DEFAULT_JOB_OPTIONS,
    }
  );

  console.log(`[scheduler] Weekly brief cron scheduled: ${WEEKLY_BRIEF_CRON} UTC`);
}

/**
 * Enqueues a one-off brief generation job for a specific product.
 * Used by the admin trigger endpoint and integration tests.
 * @param productId - UUID of the product to generate a brief for
 * @param founderId - UUID of the product's founder
 * @param weekOf    - ISO date (YYYY-MM-DD) for the week_of field (defaults to current Mon)
 * @returns         { jobId: string }
 */
export async function triggerBriefNow(
  productId: string,
  founderId: string,
  weekOf?: string
): Promise<{ jobId: string }> {
  const queue = getBriefQueue();
  const week = weekOf ?? getCurrentWeekStart();

  const job = await queue.add(
    'brief-manual',
    { productId, founderId, weekOf: week, triggeredBy: 'admin' },
    DEFAULT_JOB_OPTIONS
  );

  console.log(`[scheduler] Manual brief queued jobId=${job.id} product=${productId.substring(0, 8)}…`);
  return { jobId: job.id ?? 'unknown' };
}

/**
 * Returns the ISO date string for the most recent Monday (start of current week).
 */
export function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setUTCDate(diff);
  return monday.toISOString().split('T')[0];
}
