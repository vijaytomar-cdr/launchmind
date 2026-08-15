/**
 * @file embeddingPipeline.ts
 * @description The embedding pipeline: claim outbox work, render canonical text,
 *   call the provider, persist the vector, close the job.
 *
 *   Deliberately separate from the BullMQ worker so the LOGIC — idempotency,
 *   staleness, tenancy re-verification, retry classification — is testable
 *   without a queue, a Redis, or a timer. The worker is a thin scheduler over
 *   `processOne`.
 *
 *   VERSION-RETENTION MODEL (Step 3.1C §4), decided here and enforced by the
 *   unique index from migration 089:
 *
 *     WITHIN a family (source + field + model + embedding_version) there is
 *     exactly ONE row. Re-embedding REPLACES it. Keeping superseded vectors of
 *     the same model would mean retrieval had to choose between two rows that
 *     claim to describe the same record, and the older one is never the right
 *     answer.
 *
 *     ACROSS families, rows COEXIST. A model migration writes
 *     (model=B, version=1) alongside (model=A, version=1), so the old family
 *     keeps serving until the new one is complete and cutover is a config change
 *     rather than a window with no coverage.
 *
 *   The audit trail for "what did we used to believe" lives in
 *   marketing_memory_versions — canonical, append-only, and readable. It does not
 *   need a stale vector to preserve it, and a vector could not express it anyway.
 *
 * @security Re-verifies workspace ownership from the CANONICAL row before
 *   rendering or embedding — the job payload is treated as a hint, never as
 *   authorization (the Step 2 rule, applied to a background path).
 * @dependencies embedding_outbox, memory_embeddings, embedding_contract,
 *   embeddingRenderer, playbookGeneralizer, providers
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { newTraceId } from '../../lib/traceId';
import type { EmbeddingProvider, EmbeddingSourceType } from '../../types/embedding';
import { rendererFor } from './embeddingRenderer';
import { playbookSignalRenderer } from './playbookGeneralizer';
import {
  EmbeddingError, backoffSeconds, resolveEmbeddingProvider,
} from './providers';

export interface OutboxJob {
  id: string;
  workspace_id: string | null;
  source_type: EmbeddingSourceType;
  source_id: string;
  source_field: string;
  requested_provider: string;
  requested_model: string;
  requested_dimensions: number;
  attempt_count: number;
  trace_id: string | null;
}

export interface ProcessOutcome {
  jobId: string;
  /**
   * completed   — a vector is current for this source
   * skipped     — already current with the same hash; no provider call was made
   * cancelled   — source gone or permanently ineligible
   * failed      — will retry
   * dead        — attempts exhausted or non-retryable
   */
  result: 'completed' | 'skipped' | 'cancelled' | 'failed' | 'dead';
  errorKind?: string;
  providerLatencyMs?: number;
  traceId: string;
}

export const MAX_ATTEMPTS = 5;

/** Which canonical table backs each source type, and the columns a renderer needs. */
const SOURCE_TABLES: Record<EmbeddingSourceType, { table: string; select: string } | null> = {
  marketing_memory:         { table: 'marketing_memories', select: 'id, workspace_id, memory_type, title, content, source, status' },
  evidence:                 { table: 'evidence',           select: 'id, workspace_id, evidence_type, source_table, data' },
  product_icp:              { table: 'products',           select: 'id, workspace_id, name, category, confirmed_icp' },
  playbook_signal:          { table: 'playbook_signals',   select: 'id, category, market, channel, hook_type, price_tier, install_delta_pct, conversion_rate, retention_d7, embedding_eligible' },
  marketing_memory_version: null,   // not embedded in 3.1C; history is canonical, not searchable
};

/** Claims up to `limit` jobs. Safe to run concurrently — see lm_claim_embedding_work. */
export async function claimWork(worker: string, limit = 10): Promise<OutboxJob[]> {
  const { data, error } = await getSupabaseAdmin()
    .rpc('lm_claim_embedding_work', { p_worker: worker, p_limit: limit });
  if (error) {
    Sentry.captureException(error, { tags: { service: 'embeddingPipeline', fn: 'claimWork' } });
    return [];
  }
  return (data ?? []) as OutboxJob[];
}

async function closeJob(
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await getSupabaseAdmin().from('embedding_outbox').update(patch).eq('id', jobId);
}

/**
 * Processes one claimed job end to end.
 *
 * Never throws: a job failure must not take the worker down. Every exit path
 * closes or reschedules the job, so a claimed row can never be stranded in
 * `processing` by a code path that forgot to finish.
 */
export async function processOne(
  job: OutboxJob,
  providerOverride?: EmbeddingProvider,
): Promise<ProcessOutcome> {
  const db = getSupabaseAdmin();
  const traceId = job.trace_id ?? newTraceId();

  try {
    // ── 1. Is generation switched on at all? ─────────────────────────────────
    const { data: contract } = await db
      .from('embedding_contract')
      .select('provider, model, dimensions, embedding_version, generation_enabled')
      .eq('id', 1)
      .maybeSingle();

    if (!contract || !(contract as { generation_enabled: boolean }).generation_enabled) {
      // Non-retryable and NOT an error condition: this is the shipped state of
      // 3.1C. The job stays durable and is re-enqueued by the backfill once the
      // operator turns generation on.
      await closeJob(job.id, {
        status: 'pending', locked_at: null, locked_by: null,
        last_error_code: 'GENERATION_DISABLED',
        available_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      return { jobId: job.id, result: 'failed', errorKind: 'GENERATION_DISABLED', traceId };
    }
    const active = contract as { model: string; dimensions: number; embedding_version: number; provider: string };

    // ── 2. Load the canonical source ─────────────────────────────────────────
    const spec = SOURCE_TABLES[job.source_type];
    if (!spec) {
      await closeJob(job.id, { status: 'cancelled', last_error_code: 'SOURCE_INELIGIBLE', completed_at: new Date().toISOString() });
      return { jobId: job.id, result: 'cancelled', errorKind: 'SOURCE_INELIGIBLE', traceId };
    }

    const { data: row } = await db.from(spec.table).select(spec.select).eq('id', job.source_id).maybeSingle();
    if (!row) {
      // Deleted between enqueue and execution. Cancel rather than retry — the
      // record is not coming back, and a vector for it must never be written.
      await closeJob(job.id, { status: 'cancelled', last_error_code: 'SOURCE_MISSING', completed_at: new Date().toISOString() });
      return { jobId: job.id, result: 'cancelled', errorKind: 'SOURCE_MISSING', traceId };
    }

    // ── 3. Re-verify tenancy from the CANONICAL row ──────────────────────────
    const canonicalWs = (row as { workspace_id?: string | null }).workspace_id ?? null;
    const isGlobal = job.source_type === 'playbook_signal';
    if (isGlobal ? canonicalWs !== null || job.workspace_id !== null
                 : canonicalWs === null || canonicalWs !== job.workspace_id) {
      // The job's workspace disagrees with the record's. Either the record moved
      // or the job was forged. Both are refusals, not retries — writing this
      // vector could place one tenant's content in another's index.
      await closeJob(job.id, {
        status: 'cancelled', last_error_code: 'WORKSPACE_MISMATCH',
        last_error_detail: 'job workspace does not match the canonical record',
        completed_at: new Date().toISOString(),
      });
      Sentry.captureMessage('embedding job workspace mismatch', {
        level: 'warning', tags: { jobId: job.id, traceId },
      });
      return { jobId: job.id, result: 'cancelled', errorKind: 'WORKSPACE_MISMATCH', traceId };
    }

    // ── 4. Render canonical text (never raw JSONB) ───────────────────────────
    const renderer = isGlobal
      ? (playbookSignalRenderer as unknown as { render: (s: unknown) => { text: string; renderingVersion: number; contentHash: string } | null })
      : (rendererFor(job.source_type) as unknown as { render: (s: unknown) => { text: string; renderingVersion: number; contentHash: string } | null } | null);

    if (!renderer) {
      await closeJob(job.id, { status: 'cancelled', last_error_code: 'SOURCE_INELIGIBLE', completed_at: new Date().toISOString() });
      return { jobId: job.id, result: 'cancelled', errorKind: 'SOURCE_INELIGIBLE', traceId };
    }

    const rendered = renderer.render(row);
    if (!rendered) {
      // Eligibility refused at render time — e.g. a playbook signal that cannot
      // be safely generalized (ADR-066 rule 45), or an empty record. Terminal.
      await closeJob(job.id, {
        status: 'cancelled', last_error_code: 'SOURCE_INELIGIBLE',
        last_error_detail: 'renderer refused this record', completed_at: new Date().toISOString(),
      });
      await db.from('memory_embeddings')
        .update({ status: 'ineligible' })
        .eq('source_type', job.source_type).eq('source_id', job.source_id);
      return { jobId: job.id, result: 'cancelled', errorKind: 'SOURCE_INELIGIBLE', traceId };
    }

    // ── 5. Short-circuit: already current for this exact content ─────────────
    const { data: existing } = await db
      .from('memory_embeddings')
      .select('id, content_hash, rendering_version, status')
      .eq('source_type', job.source_type)
      .eq('source_id', job.source_id)
      .eq('source_field', job.source_field)
      .eq('embedding_model', active.model)
      .eq('embedding_version', active.embedding_version)
      .maybeSingle();

    const cur = existing as { id: string; content_hash: string; rendering_version: number; status: string } | null;
    if (cur && cur.content_hash === rendered.contentHash && cur.rendering_version === rendered.renderingVersion) {
      // The canonical text is unchanged. Restore 'current' — the enqueue trigger
      // marks vectors stale conservatively on every UPDATE, so this is the cheap
      // path that undoes a false alarm without spending a provider call.
      if (cur.status !== 'current') {
        await db.from('memory_embeddings').update({ status: 'current' }).eq('id', cur.id);
      }
      await closeJob(job.id, {
        status: 'completed', content_hash: rendered.contentHash,
        rendering_version: rendered.renderingVersion, completed_at: new Date().toISOString(),
      });
      return { jobId: job.id, result: 'skipped', traceId };
    }

    // ── 6. Embed ─────────────────────────────────────────────────────────────
    const provider = providerOverride ?? resolveEmbeddingProvider().provider;
    const t0 = Date.now();
    const vec = await provider.embedOne(rendered.text);
    const providerLatencyMs = Date.now() - t0;

    // ── 7. Validate before persisting. Never pad, never truncate. ────────────
    if (vec.dimensions !== active.dimensions || vec.vector.length !== active.dimensions) {
      throw new EmbeddingError('DIMENSION_MISMATCH',
        `provider returned ${vec.vector.length}, contract expects ${active.dimensions}`);
    }
    if (!vec.vector.every(n => Number.isFinite(n))) {
      throw new EmbeddingError('MALFORMED_OUTPUT', 'vector contains non-finite values');
    }

    // ── 8. Persist (one row per family; see the header) ──────────────────────
    const { error: upsertErr } = await db.from('memory_embeddings').upsert({
      workspace_id:       job.workspace_id,
      source_type:        job.source_type,
      source_id:          job.source_id,
      source_field:       job.source_field,
      embedding_provider: provider.capabilities.provider,
      embedding_model:    active.model,
      dimensions:         active.dimensions,
      embedding_version:  active.embedding_version,
      rendering_version:  rendered.renderingVersion,
      content_hash:       rendered.contentHash,
      embedding:          `[${vec.vector.join(',')}]`,
      status:             'current',
      last_error:         null,
    }, { onConflict: 'source_type,source_id,source_field,embedding_model,embedding_version' });

    if (upsertErr) throw new EmbeddingError('MALFORMED_OUTPUT', `persist failed: ${upsertErr.code ?? 'unknown'}`);

    await closeJob(job.id, {
      status: 'completed', content_hash: rendered.contentHash,
      rendering_version: rendered.renderingVersion,
      completed_at: new Date().toISOString(), last_error_code: null, last_error_detail: null,
    });

    return { jobId: job.id, result: 'completed', providerLatencyMs, traceId };

  } catch (err) {
    const e = err instanceof EmbeddingError ? err : new EmbeddingError('PROVIDER_UNAVAILABLE', 'unexpected pipeline error');
    const exhausted = job.attempt_count >= MAX_ATTEMPTS;
    const terminal = !e.retryable || exhausted;

    await closeJob(job.id, terminal
      ? {
          status: 'failed', last_error_code: e.kind,
          last_error_detail: exhausted && e.retryable ? 'attempts exhausted' : 'non-retryable',
          completed_at: new Date().toISOString(), locked_at: null, locked_by: null,
        }
      : {
          status: 'pending', last_error_code: e.kind, locked_at: null, locked_by: null,
          available_at: new Date(Date.now() + backoffSeconds(job.attempt_count, e.retryAfterSeconds) * 1000).toISOString(),
        });

    // The message is LaunchMind-authored; no provider body and no source text.
    Sentry.captureMessage(`embedding job ${terminal ? 'dead' : 'retrying'}: ${e.kind}`, {
      level: terminal ? 'error' : 'warning', tags: { jobId: job.id, traceId, kind: e.kind },
    });

    return { jobId: job.id, result: terminal ? 'dead' : 'failed', errorKind: e.kind, traceId };
  }
}

/** Claims and processes a batch, one provider call per job. */
export async function runBatch(
  worker: string,
  limit = 10,
  providerOverride?: EmbeddingProvider,
): Promise<ProcessOutcome[]> {
  const jobs = await claimWork(worker, limit);
  const out: ProcessOutcome[] = [];
  for (const job of jobs) out.push(await processOne(job, providerOverride));
  return out;
}

/**
 * Claims and processes a batch using ONE provider request for the whole group.
 *
 * Rate limits are per REQUEST, not per embedding. Sending 26 texts individually
 * costs 26 requests — on a 3 req/min account that is nine minutes of mostly
 * waiting, and it starves live single-memory work behind the backfill. One
 * batched request costs one slot and finishes in about a second.
 *
 * Correctness is preserved by reusing `processOne` for everything except the
 * provider call itself: each job is still rendered from its CURRENT canonical
 * row, still re-verified for tenancy, and still short-circuits when its hash is
 * unchanged. Only the network call is shared.
 *
 * A batch-level provider failure fails every job in the group with the same
 * kind, which is accurate — they failed for the same reason — and each is then
 * retried or killed by the usual per-job policy.
 *
 * @param worker Identifier recorded on the claim.
 * @param limit  Jobs to claim; capped by the provider's maxBatchSize.
 */
export async function runBatchGrouped(
  worker: string,
  limit = 25,
  providerOverride?: EmbeddingProvider,
): Promise<ProcessOutcome[]> {
  let provider: EmbeddingProvider;
  try {
    provider = providerOverride ?? resolveEmbeddingProvider().provider;
  } catch {
    // Unconfigured: fall back to the per-job path, which records the reason.
    return runBatch(worker, limit, providerOverride);
  }

  const jobs = await claimWork(worker, Math.min(limit, provider.capabilities.maxBatchSize));
  if (jobs.length === 0) return [];

  /**
   * A provider that answers from a pre-computed map for this group and defers
   * to the real provider otherwise. `processOne` keeps full control of
   * rendering, tenancy and persistence; it simply does not make a network call.
   */
  const makeGroupProvider = (byText: Map<string, number[]>): EmbeddingProvider => ({
    capabilities: provider.capabilities,
    async embedOne(text: string) {
      const v = byText.get(text);
      if (v) return { vector: v, dimensions: v.length };
      return provider.embedOne(text);          // rendered text changed mid-flight
    },
    embedBatch: (texts: string[]) => provider.embedBatch(texts),
    healthCheck: () => provider.healthCheck(),
  });

  // Pre-render every job the same way processOne will, so the batch contains
  // exactly the texts it is about to ask for.
  const texts: string[] = [];
  for (const job of jobs) {
    const t = await renderJobText(job);
    if (t) texts.push(t);
  }

  const byText = new Map<string, number[]>();
  const unique = [...new Set(texts)];
  if (unique.length > 0) {
    try {
      const vectors = await provider.embedBatch(unique);
      unique.forEach((t, i) => byText.set(t, vectors[i].vector));
    } catch {
      // Leave the map empty: processOne then calls the provider per job and
      // records the real failure kind against each.
    }
  }

  const grouped = makeGroupProvider(byText);
  const out: ProcessOutcome[] = [];
  for (const job of jobs) out.push(await processOne(job, grouped));
  return out;
}

/**
 * Renders a job's canonical text without side effects, for batch pre-fetch.
 *
 * @returns The text, or null when the source is missing or ineligible — those
 *   cases are handled authoritatively by processOne, not here.
 */
async function renderJobText(job: OutboxJob): Promise<string | null> {
  const spec = SOURCE_TABLES[job.source_type];
  if (!spec) return null;
  const { data: row } = await getSupabaseAdmin()
    .from(spec.table).select(spec.select).eq('id', job.source_id).maybeSingle();
  if (!row) return null;

  const renderer = job.source_type === 'playbook_signal'
    ? (playbookSignalRenderer as unknown as { render: (s: unknown) => { text: string } | null })
    : (rendererFor(job.source_type) as unknown as { render: (s: unknown) => { text: string } | null } | null);
  return renderer?.render(row)?.text ?? null;
}
