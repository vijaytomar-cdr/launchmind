/**
 * @file memoryHealth.test.ts
 * @description Health-state proof for the memory subsystem — Phase 3.1G §9.
 *
 *   `getEmbeddingHealth()` had NO test coverage before this file, which is a
 *   poor place to have none: it is the surface an operator reads when something
 *   is wrong, and a health endpoint that reports the wrong state is worse than
 *   no health endpoint, because it sends people to fix the wrong thing.
 *
 *   THE ORDERING IS THE POINT. The states are not independent — a pipeline that
 *   nobody switched on ALSO has an old queue and ALSO has no completions. If
 *   `queue_backlog` were evaluated first, every unprovisioned environment would
 *   report a backlog and an operator would go hunting for a stuck worker that
 *   never existed. Each test below pins one state while the conditions for the
 *   others are simultaneously true.
 *
 *   Together with the four retrieval modes proved in `retrievalService.test.ts`
 *   (HYBRID · LEXICAL_ONLY · STRUCTURED_ONLY · FAILED) these four pipeline states
 *   are the eight observable states of the memory subsystem.
 *
 * @security Asserts that no health payload carries memory text, a vector, or a
 *   credential — the surface is counts and status only.
 * @dependencies embeddingBackfill (getEmbeddingHealth), helpers/memoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => db.asClient() }));

import {
  getEmbeddingHealth, QUEUE_BACKLOG_SECONDS, DEGRADED_FAILED_JOBS,
} from '../src/services/memory/embeddingBackfill';

/** Builds a stats row; anything unset is zero. */
function stats(over: Partial<Record<string, number>> = {}): Record<string, number> {
  return {
    pending_jobs: 0, processing_jobs: 0, failed_jobs: 0, cancelled_jobs: 0,
    completed_jobs: 0, stale_embeddings: 0, current_embeddings: 0, queue_age_seconds: 0,
    ...over,
  };
}

function seed(statsRow: Record<string, number>, contract: Record<string, unknown> | null): void {
  db = new MemoryDb({
    embedding_pipeline_stats: [statsRow],
    embedding_contract: contract ? [{ id: 1, ...contract }] : [],
  });
}

const LIVE = { provider: 'voyage', model: 'voyage-4', dimensions: 1024, generation_enabled: true };

beforeEach(() => { vi.clearAllMocks(); });

describe('§9 pipeline health states', () => {
  it('HEALTHY — configured, generating, queue moving', async () => {
    seed(stats({ completed_jobs: 120, current_embeddings: 120, pending_jobs: 2, queue_age_seconds: 30 }), LIVE);
    const h = await getEmbeddingHealth();
    expect(h.status).toBe('healthy');
    expect(h.currentEmbeddings).toBe(120);
    expect(h.generationEnabled).toBe(true);
  });

  it('UNCONFIGURED — nobody switched generation on', async () => {
    seed(stats({ pending_jobs: 40 }), { ...LIVE, generation_enabled: false });
    const h = await getEmbeddingHealth();
    expect(h.status).toBe('unconfigured');
  });

  it('UNCONFIGURED — no contract row at all', async () => {
    seed(stats(), null);
    const h = await getEmbeddingHealth();
    expect(h.status).toBe('unconfigured');
    expect(h.provider).toBe('unconfigured');
    expect(h.dimensions).toBeNull();
  });

  it('UNCONFIGURED wins over a backlog — an unprovisioned pipeline is not a stuck one', async () => {
    // Both conditions hold at once. Reporting the backlog would send an operator
    // to look for a dead worker when the real answer is "no key was ever set".
    seed(stats({ pending_jobs: 500, queue_age_seconds: QUEUE_BACKLOG_SECONDS * 10 }),
         { ...LIVE, generation_enabled: false });
    const h = await getEmbeddingHealth();
    expect(h.status).toBe('unconfigured');
  });

  it('QUEUE_BACKLOG — the oldest waiting job is past the threshold', async () => {
    seed(stats({ pending_jobs: 12, queue_age_seconds: QUEUE_BACKLOG_SECONDS + 1 }), LIVE);
    const h = await getEmbeddingHealth();
    expect(h.status).toBe('queue_backlog');
    expect(h.queueAgeSeconds).toBeGreaterThan(QUEUE_BACKLOG_SECONDS);
  });

  it('QUEUE_BACKLOG is not triggered exactly AT the threshold', async () => {
    // Boundary pinned deliberately: an off-by-one here flaps the status every
    // poll for any pipeline sitting near the limit.
    seed(stats({ queue_age_seconds: QUEUE_BACKLOG_SECONDS }), LIVE);
    expect((await getEmbeddingHealth()).status).toBe('healthy');
  });

  it('DEGRADED — failed jobs have accumulated past the threshold', async () => {
    seed(stats({ failed_jobs: DEGRADED_FAILED_JOBS, completed_jobs: 900 }), LIVE);
    const h = await getEmbeddingHealth();
    expect(h.status).toBe('degraded');
    expect(h.failedJobs).toBe(DEGRADED_FAILED_JOBS);
  });

  it('DEGRADED does not fire one job below the threshold', async () => {
    seed(stats({ failed_jobs: DEGRADED_FAILED_JOBS - 1 }), LIVE);
    expect((await getEmbeddingHealth()).status).toBe('healthy');
  });

  it('a backlog outranks degradation — a stopped queue is the more urgent fact', async () => {
    seed(stats({ failed_jobs: DEGRADED_FAILED_JOBS + 50, queue_age_seconds: QUEUE_BACKLOG_SECONDS + 1 }), LIVE);
    expect((await getEmbeddingHealth()).status).toBe('queue_backlog');
  });

  it('reports every count an operator needs, not just a status word', async () => {
    seed(stats({
      pending_jobs: 3, processing_jobs: 2, failed_jobs: 1, cancelled_jobs: 4,
      completed_jobs: 55, stale_embeddings: 6, current_embeddings: 49, queue_age_seconds: 12,
    }), LIVE);
    const h = await getEmbeddingHealth();
    expect(h).toMatchObject({
      pendingJobs: 3, processingJobs: 2, failedJobs: 1, cancelledJobs: 4,
      completedJobs: 55, staleEmbeddings: 6, currentEmbeddings: 49, queueAgeSeconds: 12,
    });
  });

  it('a missing stats row degrades to zeros rather than throwing', async () => {
    // Health must answer during an incident, which is exactly when a query is
    // most likely to come back empty.
    db = new MemoryDb({ embedding_pipeline_stats: [], embedding_contract: [{ id: 1, ...LIVE }] });
    const h = await getEmbeddingHealth();
    expect(h.pendingJobs).toBe(0);
    expect(h.status).toBe('healthy');
  });
});

// ── Transitions (3.1G remediation §13) ───────────────────────────────────────
describe('§13 health TRANSITIONS, not just static states', () => {
  /**
   * The states above are each pinned in isolation. What an operator actually
   * experiences is a sequence, and the property that matters is that health
   * follows the world both ways — degrading when something breaks and, crucially,
   * RECOVERING when it is fixed. A status that latches after an incident is worse
   * than no status, because it trains people to ignore it.
   */
  const seen: string[] = [];
  async function step(label: string, statsRow: Record<string, number>, contract: Record<string, unknown> | null) {
    seed(statsRow, contract);
    const h = await getEmbeddingHealth();
    seen.push(`${label} → ${h.status}`);
    return h;
  }

  it('A→B→C→D→E: healthy → backlog → semantic degraded → stale coverage → healthy again', async () => {
    // A. Provider healthy, queue moving.
    const a = await step('A healthy', stats({ completed_jobs: 33, current_embeddings: 33 }), LIVE);
    expect(a.status).toBe('healthy');

    // B. Worker stopped. Work accumulates and ages — the state that was actually
    //    live on hosted, caused by startEmbeddingWorker() never being called.
    const b = await step('B worker stopped',
      stats({ pending_jobs: 33, queue_age_seconds: QUEUE_BACKLOG_SECONDS + 500, current_embeddings: 33 }), LIVE);
    expect(b.status).toBe('queue_backlog');
    expect(b.pendingJobs).toBe(33);

    // C. Provider unavailable: jobs fail. Health reports degraded, and the
    //    LEXICAL arm is untouched — retrieval still answers (proved separately in
    //    retrievalService.test.ts); health must not imply total outage.
    const c = await step('C provider down',
      stats({ failed_jobs: DEGRADED_FAILED_JOBS + 5, completed_jobs: 33, current_embeddings: 33 }), LIVE);
    expect(c.status).toBe('degraded');
    expect(c.currentEmbeddings).toBe(33);   // existing semantic coverage survives

    // D. Vectors staled by a corpus update and not yet rebuilt. Reduced semantic
    //    coverage must be visible in the numbers even though nothing has failed.
    const d = await step('D stale coverage',
      stats({ pending_jobs: 33, stale_embeddings: 33, current_embeddings: 0,
              queue_age_seconds: QUEUE_BACKLOG_SECONDS + 900 }), LIVE);
    expect(d.staleEmbeddings).toBe(33);
    expect(d.currentEmbeddings).toBe(0);
    expect(d.status).toBe('queue_backlog');

    // E. Recovery: the queue drains and coverage is rebuilt.
    const e = await step('E recovered', stats({ completed_jobs: 66, current_embeddings: 33 }), LIVE);
    expect(e.status).toBe('healthy');
    expect(e.staleEmbeddings).toBe(0);

    process.stdout.write('\n  HEALTH TRANSITIONS\n' + seen.map(s => `    ${s}`).join('\n') + '\n\n');
  });

  it('zero current coverage is visible even when the status word is not "degraded"', async () => {
    // The hosted failure was exactly this shape: status said `queue_backlog`,
    // which sounds like a delay, while semantic retrieval was in fact returning
    // nothing at all. The counts are what carry that, so they must be read.
    seed(stats({ pending_jobs: 33, stale_embeddings: 33, current_embeddings: 0,
                 queue_age_seconds: 6_600 }), LIVE);
    const h = await getEmbeddingHealth();
    expect(h.currentEmbeddings).toBe(0);
    expect(h.staleEmbeddings).toBeGreaterThan(0);
    // A caller can therefore compute "semantic coverage = 0" without guessing.
    expect(h.currentEmbeddings / Math.max(h.currentEmbeddings + h.staleEmbeddings, 1)).toBe(0);
  });
});

describe('§9 health surfaces leak nothing', () => {
  it('carries no memory text, vector, hash or credential', async () => {
    seed(stats({ current_embeddings: 10 }), LIVE);
    const h = await getEmbeddingHealth();
    const serialized = JSON.stringify(h);

    for (const forbidden of ['api_key', 'apiKey', 'secret', 'token', 'credential',
                             'embedding_vector', 'content_hash', 'claim', 'title']) {
      expect(serialized, `health must not expose ${forbidden}`).not.toContain(forbidden);
    }
    // The model NAME is intentionally present — an operator cannot diagnose a
    // migration without it — but nothing that could authenticate as us is.
    expect(h.model).toBe('voyage-4');
    expect(serialized).not.toMatch(/pa-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/);
  });

  it('every value is a count, a boolean, or a short identifier', async () => {
    seed(stats({ pending_jobs: 1 }), LIVE);
    const h = await getEmbeddingHealth() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(h)) {
      const ok = typeof v === 'number' || typeof v === 'boolean' || v === null ||
                 (typeof v === 'string' && v.length < 64);
      expect(ok, `${k} must not be able to carry free text`).toBe(true);
    }
  });
});
