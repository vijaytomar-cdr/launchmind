/**
 * @file connectionSyncWorker.ts
 * @description BullMQ worker for the `connection-sync` queue. This worker is the
 *   CANONICAL and only execution path for provider syncs — no HTTP route performs
 *   provider I/O on the request thread (spec §18).
 *
 *   Each job calls connectionService.executeSync(), which decrypts the credential,
 *   calls the registered ProviderAdapter, and persists only what the provider
 *   actually returned. When no adapter is registered the job fails with
 *   ADAPTER_UNAVAILABLE and the owner sees an explicit unavailable state.
 *
 *   Redis-gated, concurrency=3, exponential back-off, DLQ via
 *   connection_sync_runs.status='failed' once attempts are exhausted.
 *
 * @security founderId is carried in the job payload; executeSync re-verifies
 *   ownership via workspace_connections before inserting any intelligence_signals.
 *   Owner-facing error text comes from ProviderError.ownerMessage only — raw provider
 *   responses and stack traces are never persisted (spec §14.7).
 * @dependencies BullMQ, IORedis, connectionService, connectionStateMachine, traceId, Sentry
 */

import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as Sentry from '@sentry/node';
import { executeSync } from '../services/connectionService';
import { ProviderError } from '../services/providers/types';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { coerceTraceId } from '../lib/traceId';

export const CONNECTION_SYNC_QUEUE_NAME = 'connection-sync';

/**
 * Shape of each job payload on the connection-sync queue.
 *
 * `workspaceId` is carried so the job knows which tenant it was enqueued for, but
 * it is NOT trusted: executeSync re-verifies that the connection still belongs to
 * that workspace before writing anything. A job enqueued before an ownership or
 * membership change must not be able to write across the tenant boundary.
 */
export interface ConnectionSyncJobPayload {
  connectionId: string;
  syncRunId:    string;
  workspaceId:  string;
  /** Founder attribution for credential-decrypt auditing. */
  founderId:    string;
  provider:     string;
  /** Correlation id carried from the originating HTTP request. */
  traceId:      string;
}

let _queue:  Queue<ConnectionSyncJobPayload>  | null = null;
let _worker: Worker<ConnectionSyncJobPayload> | null = null;

function makeConnection(): IORedis {
  const conn = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue:   false,
    retryStrategy:        (times: number) => Math.min(times * 500, 30_000),
  });
  let warned = false;
  conn.on('error', (err: Error) => {
    if (!warned) {
      console.warn('[connectionSyncWorker] Redis unavailable:', err.message);
      warned = true;
    }
  });
  return conn;
}

/** Returns (creating if needed) the BullMQ queue for connection sync jobs. */
export function getConnectionSyncQueue(): Queue<ConnectionSyncJobPayload> {
  if (!_queue) {
    _queue = new Queue<ConnectionSyncJobPayload>(CONNECTION_SYNC_QUEUE_NAME, {
      connection: makeConnection(),
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 50 },
      },
    });
  }
  return _queue;
}

/**
 * Enqueues a connection sync job.
 * jobId is deterministic from connectionId+syncRunId — prevents duplicate jobs for the same run.
 * @param payload - { connectionId, syncRunId, founderId, provider }
 */
export async function enqueueConnectionSync(
  payload: ConnectionSyncJobPayload,
): Promise<void> {
  const queue = getConnectionSyncQueue();
  await queue.add('connection-sync', payload, {
    jobId: `${payload.connectionId}:${payload.syncRunId}`,
  });
}

/**
 * Starts the singleton BullMQ connection-sync worker.
 * Idempotent — calling a second time returns early without creating a duplicate worker.
 */
export function startConnectionSyncWorker(): void {
  if (_worker) return;

  _worker = new Worker<ConnectionSyncJobPayload>(
    CONNECTION_SYNC_QUEUE_NAME,
    async (job: Job<ConnectionSyncJobPayload>): Promise<void> => {
      const { connectionId, syncRunId, workspaceId, founderId, provider } = job.data;
      const traceId = coerceTraceId(job.data.traceId);

      try {
        // executeSync re-verifies the workspace binding, then owns all state
        // transitions and signal writes for the run.
        await executeSync(syncRunId, connectionId, workspaceId, founderId, traceId);
      } catch (err) {
        // executeSync already recorded the sync run + connection recovery state.
        // Do not retry conditions the owner must resolve — retrying cannot fix them
        // and would repeatedly hammer the provider.
        const terminal =
          err instanceof ProviderError &&
          ['ADAPTER_UNAVAILABLE', 'PERMISSION_DENIED', 'NEEDS_REAUTH', 'WRONG_ACCOUNT'].includes(err.kind);

        Sentry.captureException(err, {
          tags:  { worker: 'connection-sync', provider, terminal: String(terminal) },
          extra: { connectionId, syncRunId, traceId },
        });

        if (terminal) {
          // Swallow so BullMQ marks the job complete; the connection already carries
          // the recovery state and the owner-facing reason.
          console.warn(
            `[connectionSyncWorker] ${provider} sync halted (${(err as ProviderError).kind}) trace=${traceId}`,
          );
          return;
        }

        throw err; // transient — let BullMQ retry with back-off
      }
    },
    {
      connection:  makeConnection(),
      concurrency: 3,
    },
  );

  // DLQ: once BullMQ has exhausted every attempt, make sure the sync run is closed
  // out as failed so the UI never shows a run stuck in 'running'.
  _worker.on('failed', async (job, err) => {
    if (!job) return;
    console.error(`[connectionSyncWorker] Job ${job.id} failed:`, err.message);
    Sentry.captureException(err, { extra: { jobId: job.id, data: job.data } });

    const exhausted = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 1);
    if (!exhausted) return;

    try {
      await getSupabaseAdmin()
        .from('connection_sync_runs')
        .update({
          status:        'failed',
          error_message: 'The sync could not be completed after several attempts. Your existing intelligence is unchanged.',
          completed_at:  new Date().toISOString(),
        })
        .eq('id', job.data.syncRunId)
        .eq('workspace_id', job.data.workspaceId);
    } catch (updateErr) {
      Sentry.captureException(updateErr, { extra: { context: 'connectionSyncWorker.dlq' } });
    }
  });

  _worker.on('error', (err) => {
    console.error('[connectionSyncWorker] Worker error:', err.message);
  });

  console.log('[connectionSyncWorker] Started connection-sync worker');
}

/** Graceful shutdown — drains active jobs and closes the worker and queue. */
export async function stopConnectionSyncWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
