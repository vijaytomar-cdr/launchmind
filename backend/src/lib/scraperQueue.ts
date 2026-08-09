/**
 * @file scraperQueue.ts
 * @description BullMQ queue for async product intake scrape jobs.
 *   Jobs are enqueued by POST /products/scrape (multi-URL path) and processed by intakeWorker.
 *   Job results are readable via GET /products/scrape/:jobId for frontend polling.
 * @security
 *   - Queue is internal only — no public endpoint writes directly to the queue.
 *   - founderId and productId are carried in job data; logged only as prefix (not full UUID).
 * @dependencies bullmq, ioredis
 */

import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';

export const SCRAPE_QUEUE_NAME = 'product-scrape';

export interface ScrapeJobData {
  productId: string;
  founderId: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
  websiteUrl?: string;
}

export interface ScrapeJobResult {
  productId: string;
  scraped: unknown;
  icpBrief: unknown;
  competitors: unknown[];
  websiteMeta?: unknown;
}

let _scrapeQueue: Queue<ScrapeJobData, ScrapeJobResult> | null = null;
let _scrapeRedis: IORedis | null = null;

function getScrapeRedis(): IORedis {
  if (_scrapeRedis) return _scrapeRedis;
  _scrapeRedis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  return _scrapeRedis;
}

/**
 * Returns the singleton BullMQ queue for product-scrape jobs.
 * Lazy-initialised so tests can stub Redis before first call.
 */
export function getScrapeQueue(): Queue<ScrapeJobData, ScrapeJobResult> {
  if (_scrapeQueue) return _scrapeQueue;
  _scrapeQueue = new Queue<ScrapeJobData, ScrapeJobResult>(SCRAPE_QUEUE_NAME, {
    connection: getScrapeRedis(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  });
  return _scrapeQueue;
}

/**
 * Enqueues a scrape job for a newly created product.
 * Uses a deterministic jobId (`scrape-<productId>`) so duplicate calls are idempotent.
 * @param data - Product ID, founder ID, and one or more store URLs
 * @returns    BullMQ job ID string
 */
export async function enqueueScrapeJob(data: ScrapeJobData): Promise<string> {
  const queue = getScrapeQueue();
  const job = await queue.add('scrape-product', data, {
    jobId: `scrape-${data.productId}`,
  });
  return job.id ?? `scrape-${data.productId}`;
}

/**
 * Looks up a scrape job by ID for polling.
 * @param jobId - BullMQ job ID returned from enqueueScrapeJob
 * @returns     Job instance or null if not found
 */
export async function getScrapeJob(
  jobId: string
): Promise<Job<ScrapeJobData, ScrapeJobResult> | null> {
  const queue = getScrapeQueue();
  // BullMQ resolves to undefined for a missing job; this function's contract is
  // `| null`, and callers branch on null.
  return (await Job.fromId<ScrapeJobData, ScrapeJobResult>(queue, jobId)) ?? null;
}
