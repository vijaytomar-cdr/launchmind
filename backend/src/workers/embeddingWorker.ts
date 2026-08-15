/**
 * @file embeddingWorker.ts
 * @description BullMQ scheduler for the embedding pipeline.
 *
 *   Deliberately THIN. All the behaviour that matters — idempotency, staleness,
 *   tenancy re-verification, retry classification — lives in embeddingPipeline.ts
 *   so it can be tested without Redis. This file only answers "when does it run".
 *
 *   WHY A REPEATING SWEEP RATHER THAN JOB-PER-RECORD:
 *   the durable queue is the OUTBOX TABLE, not Redis (ADR-066 rule 25). Enqueuing
 *   one Redis job per canonical write would create a second, weaker queue that
 *   can disagree with the outbox — a flushed Redis would lose work that Postgres
 *   still believes is pending. A periodic sweep that claims from the outbox has
 *   one source of truth, survives a Redis wipe with zero loss, and makes the
 *   crash-recovery story trivial: nothing was ever only in Redis.
 *
 *   BullMQ is reused because it is already the queue architecture (ADR-030); no
 *   second job framework is introduced.
 *
 * @security Runs as service_role. Every job re-verifies workspace ownership
 *   against the canonical row before rendering (see embeddingPipeline).
 * @dependencies bullmq, ioredis, embeddingPipeline
 */

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import * as Sentry from '@sentry/node';
import { runBatch, type ProcessOutcome } from '../services/memory/embeddingPipeline';

export const EMBEDDING_QUEUE_NAME = 'embedding-generation';

/** How often the sweep runs when idle. */
const SWEEP_INTERVAL_MS = 30_000;
/** Jobs claimed per sweep. Bounded so one tenant's backfill cannot starve others. */
const BATCH_SIZE = 10;

let _connection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker | null = null;

function connection(): IORedis {
  if (_connection) return _connection;
  _connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return _connection;
}

export interface EmbeddingSweepResult {
  claimed: number;
  completed: number;
  skipped: number;
  cancelled: number;
  failed: number;
  dead: number;
}

function summarize(outcomes: ProcessOutcome[]): EmbeddingSweepResult {
  const count = (r: ProcessOutcome['result']) => outcomes.filter(o => o.result === r).length;
  return {
    claimed:   outcomes.length,
    completed: count('completed'),
    skipped:   count('skipped'),
    cancelled: count('cancelled'),
    failed:    count('failed'),
    dead:      count('dead'),
  };
}

/**
 * Starts the sweep.
 *
 * Idempotent: calling twice does not create a second worker. Callers are
 * Redis-gated in server.ts, matching the connection-sync worker.
 */
export function startEmbeddingWorker(): void {
  if (_worker) return;

  _queue = new Queue(EMBEDDING_QUEUE_NAME, { connection: connection() });

  // A single repeating job with a fixed id: restarts replace the schedule rather
  // than stacking a second sweep on top of the first.
  void _queue.add(
    'sweep',
    {},
    {
      repeat: { every: SWEEP_INTERVAL_MS },
      jobId: 'embedding-sweep',
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  ).catch((e) => Sentry.captureException(e, { tags: { worker: 'embedding', phase: 'schedule' } }));

  _worker = new Worker(
    EMBEDDING_QUEUE_NAME,
    async (job: Job): Promise<EmbeddingSweepResult> => {
      const outcomes = await runBatch(`worker:${job.id ?? 'sweep'}`, BATCH_SIZE);
      return summarize(outcomes);
    },
    {
      connection: connection(),
      // One sweep at a time. Claiming is SKIP LOCKED so parallelism would be
      // safe, but a single sweeper keeps provider rate limiting predictable —
      // and rate limits, not throughput, are the binding constraint here.
      concurrency: 1,
    },
  );

  _worker.on('failed', (job, err) => {
    // A sweep failure is infrastructural (Redis, Postgres). Individual job
    // failures never reach here; processOne closes them itself.
    Sentry.captureException(err, { tags: { worker: 'embedding', jobId: job?.id ?? 'unknown' } });
  });
}

export async function stopEmbeddingWorker(): Promise<void> {
  await _worker?.close();
  await _queue?.close();
  await _connection?.quit();
  _worker = null; _queue = null; _connection = null;
}

/**
 * Runs one sweep immediately, bypassing the schedule.
 *
 * For the backfill CLI and for tests. Needs no Redis, which is what lets the
 * whole pipeline be exercised in CI.
 */
export async function sweepOnce(limit = BATCH_SIZE): Promise<EmbeddingSweepResult> {
  return summarize(await runBatch('manual-sweep', limit));
}
