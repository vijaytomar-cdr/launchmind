/**
 * @file embeddingBackfill.ts
 * @description Controlled backfill: finds canonical records with no current
 *   embedding and enqueues outbox work for them.
 *
 *   IT NEVER CALLS AN EMBEDDING PROVIDER (Step 3.1C §8). The path is strictly
 *
 *       canonical records → outbox → worker → provider → memory_embeddings
 *
 *   so a backfill of ten thousand records is subject to exactly the same
 *   claiming, rate limiting, retry policy, tenancy re-verification and
 *   observability as a single edit. A backfill that called the provider directly
 *   would be a second, unmonitored pipeline with its own bugs — and it would be
 *   the one operators reach for under pressure.
 *
 *   DRY RUN IS THE DEFAULT. `execute` must be passed explicitly. Counting is
 *   cheap and enqueueing is not trivially reversible, so the safe mode is the
 *   one you get by forgetting a flag.
 *
 * @security Workspace selection filters server-side. Playbook signals are
 *   included only when `embedding_eligible` is true (ADR-066 rule 45), which the
 *   generalizer alone sets.
 * @dependencies embedding_outbox, memory_embeddings, canonical tables
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { EmbeddingSourceType } from '../../types/embedding';

export const BACKFILLABLE_SOURCE_TYPES: readonly EmbeddingSourceType[] = [
  'marketing_memory', 'evidence', 'product_icp', 'playbook_signal',
];

export interface BackfillOptions {
  sourceTypes?: EmbeddingSourceType[];
  workspaceId?: string;
  batchSize?: number;
  /** Must be true to enqueue. Absent or false = dry run. */
  execute?: boolean;
}

export interface BackfillCount {
  sourceType: EmbeddingSourceType;
  eligible: number;
  alreadyCurrent: number;
  alreadyQueued: number;
  toEnqueue: number;
  enqueued: number;
}

export interface BackfillReport {
  dryRun: boolean;
  contract: { provider: string; model: string; dimensions: number; generationEnabled: boolean };
  counts: BackfillCount[];
  totals: { eligible: number; toEnqueue: number; enqueued: number };
}

const TABLE_FOR: Record<string, { table: string; tenantScoped: boolean }> = {
  marketing_memory: { table: 'marketing_memories', tenantScoped: true },
  evidence:         { table: 'evidence',           tenantScoped: true },
  product_icp:      { table: 'products',           tenantScoped: true },
  playbook_signal:  { table: 'playbook_signals',   tenantScoped: false },
};

/** Postgres unique-violation. A concurrent trigger enqueued the same source. */
const UNIQUE_VIOLATION = '23505';

/**
 * Inserts outbox rows, tolerating a concurrent trigger having enqueued the same
 * source.
 *
 * Tries the batch first (one round trip for the overwhelmingly common case),
 * and only falls back to per-row inserts when the batch hits a conflict — so a
 * single racing edit costs one extra pass rather than failing a 5,000-row
 * backfill.
 *
 * @returns Number of rows actually inserted.
 */
async function insertSkippingConflicts(
  db: ReturnType<typeof getSupabaseAdmin>,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  const { error } = await db.from('embedding_outbox').insert(rows);
  if (!error) return rows.length;
  if (error.code !== UNIQUE_VIOLATION) {
    throw new Error(`backfill enqueue failed: ${error.message}`);
  }

  let inserted = 0;
  for (const row of rows) {
    const { error: rowErr } = await db.from('embedding_outbox').insert(row);
    if (!rowErr) inserted++;
    else if (rowErr.code !== UNIQUE_VIOLATION) {
      throw new Error(`backfill enqueue failed: ${rowErr.message}`);
    }
    // A unique violation here means an open job already covers this source.
  }
  return inserted;
}

/**
 * Counts (and optionally enqueues) outstanding embedding work.
 *
 * @param opts.execute When absent/false, nothing is written — counts only.
 * @returns Per-source-type counts plus the active contract, so the operator can
 *   see what would be spent BEFORE approving it.
 */
export async function runBackfill(opts: BackfillOptions = {}): Promise<BackfillReport> {
  const db = getSupabaseAdmin();
  const dryRun = opts.execute !== true;
  const batchSize = Math.min(Math.max(opts.batchSize ?? 500, 1), 5_000);
  const types = (opts.sourceTypes ?? BACKFILLABLE_SOURCE_TYPES)
    .filter(t => t in TABLE_FOR) as EmbeddingSourceType[];

  const { data: contractRow } = await db
    .from('embedding_contract')
    .select('provider, model, dimensions, embedding_version, generation_enabled')
    .eq('id', 1).maybeSingle();

  const contract = contractRow as {
    provider: string; model: string; dimensions: number;
    embedding_version: number; generation_enabled: boolean;
  } | null;

  if (!contract) {
    throw new Error('No embedding contract configured (migration 093 seeds row id=1)');
  }

  const counts: BackfillCount[] = [];

  for (const sourceType of types) {
    const spec = TABLE_FOR[sourceType];

    // ── Which canonical rows are eligible? ─────────────────────────────────
    let q = db.from(spec.table).select('id, workspace_id');
    if (sourceType === 'playbook_signal') {
      q = db.from(spec.table).select('id');
      q = q.eq('embedding_eligible', true);       // rule 45: nothing else may be embedded
    } else {
      q = q.not('workspace_id', 'is', null);
      if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId);
    }
    if (sourceType === 'marketing_memory') q = q.eq('status', 'active');

    const { data: rows, error } = await q;
    if (error) throw new Error(`backfill scan failed for ${sourceType}: ${error.message}`);

    const candidates = (rows ?? []) as Array<{ id: string; workspace_id?: string | null }>;

    // ── Which already have a current vector for the ACTIVE family? ─────────
    const { data: currentRows } = await db
      .from('memory_embeddings')
      .select('source_id')
      .eq('source_type', sourceType)
      .eq('embedding_model', contract.model)
      .eq('embedding_version', contract.embedding_version)
      .eq('status', 'current');
    const current = new Set((currentRows ?? []).map(r => (r as { source_id: string }).source_id));

    // ── Which already have an open job? ────────────────────────────────────
    const { data: openRows } = await db
      .from('embedding_outbox')
      .select('source_id')
      .eq('source_type', sourceType)
      .in('status', ['pending', 'processing']);
    const open = new Set((openRows ?? []).map(r => (r as { source_id: string }).source_id));

    const outstanding = candidates.filter(c => !current.has(c.id) && !open.has(c.id));

    let enqueued = 0;
    if (!dryRun && outstanding.length > 0) {
      const slice = outstanding.slice(0, batchSize);
      const payload = slice.map(c => ({
        workspace_id: sourceType === 'playbook_signal' ? null : (c.workspace_id ?? null),
        source_type: sourceType,
        source_id: c.id,
        source_field: 'canonical',
        requested_provider: contract.provider,
        requested_model: contract.model,
        requested_dimensions: contract.dimensions,
        status: 'pending',
        reason: 'backfill',
      }));

      // A plain INSERT, NOT an upsert.
      //
      // The outbox's unique index is PARTIAL — UNIQUE (source_type, source_id,
      // source_field) WHERE status IN ('pending','processing'). PostgREST cannot
      // attach that predicate to an ON CONFLICT clause, and Postgres will not
      // infer a partial index as an arbiter, so `.upsert({onConflict})` fails
      // outright with "no unique or exclusion constraint matching the ON CONFLICT
      // specification". (The enqueue TRIGGER is unaffected: raw SQL can state the
      // predicate, which is why coalescing works there.)
      //
      // An insert is also the correct semantics: `outstanding` already excludes
      // every source with an open job. The only way to hit the constraint is a
      // trigger enqueuing the same source concurrently — in which case the work
      // already exists and skipping it is right, not an error.
      enqueued = await insertSkippingConflicts(db, payload);
    }

    counts.push({
      sourceType,
      eligible: candidates.length,
      alreadyCurrent: candidates.filter(c => current.has(c.id)).length,
      alreadyQueued: candidates.filter(c => open.has(c.id)).length,
      toEnqueue: outstanding.length,
      enqueued,
    });
  }

  return {
    dryRun,
    contract: {
      provider: contract.provider, model: contract.model,
      dimensions: contract.dimensions, generationEnabled: contract.generation_enabled,
    },
    counts,
    totals: {
      eligible:  counts.reduce((a, c) => a + c.eligible, 0),
      toEnqueue: counts.reduce((a, c) => a + c.toEnqueue, 0),
      enqueued:  counts.reduce((a, c) => a + c.enqueued, 0),
    },
  };
}

// ── Observability (ADR-066 rules 12 and 27) ──────────────────────────────────

export interface EmbeddingPipelineHealth {
  status: 'healthy' | 'degraded' | 'unconfigured' | 'queue_backlog';
  pendingJobs: number;
  processingJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  completedJobs: number;
  staleEmbeddings: number;
  currentEmbeddings: number;
  queueAgeSeconds: number;
  generationEnabled: boolean;
  provider: string;
  model: string;
  dimensions: number | null;
}

/** Backlog age past which the pipeline is reported as backed up. */
export const QUEUE_BACKLOG_SECONDS = 3_600;
/** Failed-job count past which the pipeline is reported degraded. */
export const DEGRADED_FAILED_JOBS = 25;

/**
 * Reads pipeline health.
 *
 * Returns counts and status only — never a credential, never input text, never
 * a vector, never a provider payload (Step 3.1C §13).
 */
export async function getEmbeddingHealth(): Promise<EmbeddingPipelineHealth> {
  const db = getSupabaseAdmin();

  const [{ data: stats }, { data: contractRow }] = await Promise.all([
    db.from('embedding_pipeline_stats').select('*').maybeSingle(),
    db.from('embedding_contract').select('provider, model, dimensions, generation_enabled').eq('id', 1).maybeSingle(),
  ]);

  const s = (stats ?? {}) as Record<string, number>;
  const c = contractRow as { provider: string; model: string; dimensions: number; generation_enabled: boolean } | null;

  const queueAge = Number(s.queue_age_seconds ?? 0);
  const failed   = Number(s.failed_jobs ?? 0);
  const generationEnabled = c?.generation_enabled ?? false;

  // Order matters: "nobody switched it on" must not be reported as a backlog,
  // or an operator chases a queue problem that does not exist.
  let status: EmbeddingPipelineHealth['status'] = 'healthy';
  if (!generationEnabled || !c || c.provider === 'unconfigured') status = 'unconfigured';
  else if (queueAge > QUEUE_BACKLOG_SECONDS)                     status = 'queue_backlog';
  else if (failed >= DEGRADED_FAILED_JOBS)                       status = 'degraded';

  return {
    status,
    pendingJobs:       Number(s.pending_jobs ?? 0),
    processingJobs:    Number(s.processing_jobs ?? 0),
    failedJobs:        failed,
    cancelledJobs:     Number(s.cancelled_jobs ?? 0),
    completedJobs:     Number(s.completed_jobs ?? 0),
    staleEmbeddings:   Number(s.stale_embeddings ?? 0),
    currentEmbeddings: Number(s.current_embeddings ?? 0),
    queueAgeSeconds:   queueAge,
    generationEnabled,
    provider:   c?.provider ?? 'unconfigured',
    model:      c?.model ?? 'unconfigured',
    dimensions: c?.dimensions ?? null,
  };
}
