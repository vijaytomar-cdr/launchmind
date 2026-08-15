/**
 * @file corpusEmbeddingCertification.ts
 * @description Makes it structurally impossible to publish a HYBRID retrieval
 *   score against a corpus that is not actually embedded.
 *
 *   THE DEFECT THIS CLOSES:
 *     `assertSemanticCoverage()` verified that the QUERY vectors were primed. It
 *     said nothing about the corpus. So a run with 26 memories and ZERO vectors
 *     reported `HYBRID` with "the semantic arm confirmed active" — the semantic
 *     arm was live, it simply had nothing to match against. Every retrieval
 *     number produced that way is a lexical score under a hybrid heading.
 *
 *   TWO COVERAGES, ONE CONTRACT:
 *     QUERY_COVERAGE  every benchmark query has a real provider vector
 *     CORPUS_COVERAGE every eligible memory has a `current` embedding whose
 *                     provider, model, version, dimensions, rendering version and
 *                     content hash all match the active contract
 *     Only when BOTH are 100% may a run call itself HYBRID_CERTIFIED.
 *
 *   RATE LIMITS — why acquisition is cached, not regenerated:
 *     Voyage's free tier is 3 requests/minute and `clearCorpus()` deleted every
 *     eval vector on each run, forcing a full live re-embed that could never
 *     finish. Corpus vectors are therefore acquired ONCE into the same JSONL
 *     cache the query side already uses (consolidated, not a second mechanism)
 *     and replayed from disk thereafter. The cache is keyed by
 *     provider:model:dimensions:sha256(rendered text) — because the rendered text
 *     already encodes the rendering version, a rendering change produces a
 *     different key and cannot silently reuse a stale vector.
 *
 * @security TEST/CERTIFICATION ONLY. Never import from production code paths.
 *   Writes vectors only into disposable certification workspaces, and refuses to
 *   run against a non-local Supabase.
 * @dependencies evalEmbeddingCache, embeddingRenderer, providers
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCache, appendCache, cacheKey, queryHash, type CacheIdentity } from './evalEmbeddingCache';
import { marketingMemoryRenderer } from '../../src/services/memory/embeddingRenderer';
import { resolveEmbeddingProvider } from '../../src/services/memory/providers';

export interface ActiveContract {
  provider: string;
  model: string;
  dimensions: number;
  embedding_version: number;
}

export interface CorpusCoverageReport {
  workspaceIds: string[];
  contract: ActiveContract;
  /** Eligible governed memories that MUST have a vector. */
  expected: number;
  current: number;
  missing: string[];
  stale: string[];
  /** Rows whose identity disagrees with the active contract. */
  mismatched: Array<{ id: string; why: string }>;
  failedJobs: number;
  pendingJobs: number;
  complete: boolean;
}

/** Reads the one authoritative contract row. */
export async function readActiveContract(db: SupabaseClient): Promise<ActiveContract> {
  const { data } = await db.from('embedding_contract')
    .select('provider, model, dimensions, embedding_version').eq('id', 1).maybeSingle();
  if (!data) throw new Error('no embedding_contract row: retrieval cannot be certified');
  return data as ActiveContract;
}

/**
 * THE FAIL-CLOSED GUARD.
 *
 * Every field is checked against the ACTIVE CONTRACT, not against whatever the
 * row happens to contain — a vector written under an older model is not coverage.
 */
export async function certifyCorpusCoverage(
  db: SupabaseClient, workspaceIds: string[],
): Promise<CorpusCoverageReport> {
  const contract = await readActiveContract(db);

  const { data: mems } = await db.from('marketing_memories')
    .select('id, title, content, memory_type, source, status, confidence, created_at, updated_at')
    .in('workspace_id', workspaceIds);
  const memories = (mems ?? []) as Array<Record<string, unknown>>;

  const { data: embs } = await db.from('memory_embeddings')
    .select('source_id, status, embedding_provider, embedding_model, dimensions, embedding_version, rendering_version, content_hash')
    .in('workspace_id', workspaceIds).eq('source_type', 'marketing_memory');
  const byId = new Map(((embs ?? []) as Array<Record<string, unknown>>).map(e => [String(e.source_id), e]));

  const missing: string[] = [];
  const stale: string[] = [];
  const mismatched: Array<{ id: string; why: string }> = [];
  let current = 0;

  for (const m of memories) {
    const id = String(m.id);
    const e = byId.get(id);
    if (!e) { missing.push(id); continue; }
    if (e.status === 'stale') { stale.push(id); continue; }
    if (e.status !== 'current') { missing.push(id); continue; }

    const rendered = marketingMemoryRenderer.render(m as never);
    const why: string[] = [];
    if (e.embedding_provider !== contract.provider) why.push(`provider ${e.embedding_provider}≠${contract.provider}`);
    if (e.embedding_model !== contract.model) why.push(`model ${e.embedding_model}≠${contract.model}`);
    if (Number(e.dimensions) !== contract.dimensions) why.push(`dims ${e.dimensions}≠${contract.dimensions}`);
    if (Number(e.embedding_version) !== contract.embedding_version) why.push(`version ${e.embedding_version}≠${contract.embedding_version}`);
    if (Number(e.rendering_version) !== rendered.renderingVersion) why.push(`rendering ${e.rendering_version}≠${rendered.renderingVersion}`);
    if (e.content_hash && e.content_hash !== rendered.contentHash) why.push('content hash drifted from source');
    if (why.length) { mismatched.push({ id, why: why.join('; ') }); continue; }
    current++;
  }

  // Outstanding jobs for THESE sources only — a failed job elsewhere is noise.
  const ids = memories.map(m => String(m.id));
  const { data: jobs } = await db.from('embedding_outbox')
    .select('status, source_id').in('workspace_id', workspaceIds).eq('source_type', 'marketing_memory');
  const rel = ((jobs ?? []) as Array<Record<string, unknown>>).filter(j => ids.includes(String(j.source_id)));

  const failedJobs  = rel.filter(j => j.status === 'failed').length;
  const pendingJobs = rel.filter(j => j.status === 'pending' || j.status === 'processing').length;

  return {
    workspaceIds, contract,
    expected: memories.length, current,
    missing, stale, mismatched, failedJobs, pendingJobs,
    complete: memories.length > 0
      && current === memories.length
      && missing.length === 0 && stale.length === 0 && mismatched.length === 0
      && failedJobs === 0 && pendingJobs === 0,
  };
}

/**
 * Refuses to let a caller publish HYBRID without full corpus coverage.
 *
 * NO BYPASS FLAG. An opt-out is how the query-side guard's sibling hole stayed
 * open — the point of this function is that certification cannot be argued with.
 */
export function assertCorpusCoverage(r: CorpusCoverageReport): void {
  if (r.complete) return;
  throw new Error(
    `CORPUS_SEMANTIC_COVERAGE_INCOMPLETE — refusing to publish retrieval metrics as HYBRID.\n` +
    `  expected=${r.expected} current=${r.current} missing=${r.missing.length} ` +
    `stale=${r.stale.length} mismatched=${r.mismatched.length} ` +
    `failedJobs=${r.failedJobs} pendingJobs=${r.pendingJobs}\n` +
    `  contract=${r.contract.provider}/${r.contract.model}/${r.contract.dimensions}d/v${r.contract.embedding_version}\n` +
    (r.mismatched.length ? `  first mismatch: ${r.mismatched[0].id} — ${r.mismatched[0].why}\n` : '') +
    `  Run \`npm run eval:acquire-corpus\` to acquire corpus vectors.`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Retries ONLY RATE_LIMITED, up to 5 times with growing backoff. */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await fn(); } catch (e) {
      const kind = (e as { kind?: string }).kind;
      if (kind !== 'RATE_LIMITED') throw e;
      lastErr = e;
      const waitMs = (e as { retryAfterSeconds?: number }).retryAfterSeconds
        ? (e as { retryAfterSeconds: number }).retryAfterSeconds * 1000
        : 25_000 * (attempt + 1);
      console.log(`  rate limited; waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/5)…`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

export interface AcquireCorpusReport {
  expected: number;
  fromCache: number;
  embedded: number;
  providerRequests: number;
  written: number;
}

/**
 * Acquires corpus vectors, preferring the cache, and writes them into
 * `memory_embeddings` with contract-correct identity.
 *
 * BATCHED: every cache miss goes in ONE `embedBatch` call, so a 26-memory corpus
 * costs one request rather than 26. A batch failure is RAISED, not swallowed —
 * `runBatchGrouped` catches it silently and falls back to per-job calls, which is
 * how the rate-limit budget was burned without anyone noticing.
 */
export async function acquireCorpusVectors(
  db: SupabaseClient, workspaceIds: string[],
): Promise<AcquireCorpusReport> {
  const contract = await readActiveContract(db);
  const { provider, live } = resolveEmbeddingProvider();
  if (!live) {
    throw new Error(
      `refusing to acquire corpus vectors from a non-live provider ` +
      `(${provider.capabilities.provider}/${provider.capabilities.dimensions}d). ` +
      `This is exactly how 8-dimension deterministic vectors entered a 1024 contract.`);
  }
  if (provider.capabilities.dimensions !== contract.dimensions) {
    throw new Error(
      `PROVIDER_CONTRACT_MISMATCH: provider declares ${provider.capabilities.dimensions}d, ` +
      `contract requires ${contract.dimensions}d. Refusing before spending a provider call.`);
  }

  const { data: mems } = await db.from('marketing_memories')
    .select('id, workspace_id, title, content, memory_type, source, status, confidence, created_at, updated_at')
    .in('workspace_id', workspaceIds);
  const memories = (mems ?? []) as Array<Record<string, unknown>>;

  const identity: CacheIdentity = {
    provider: contract.provider, model: contract.model, dimensions: contract.dimensions,
  };
  const cache = loadCache();

  const prepared = memories.map(m => {
    const rendered = marketingMemoryRenderer.render(m as never);
    return { m, rendered, key: cacheKey(identity, rendered.text) };
  });

  const misses = prepared.filter(p => !cache.has(p.key));
  let providerRequests = 0;
  if (misses.length) {
    const texts = [...new Set(misses.map(p => p.rendered.text))];
    // ONE request for the whole corpus. RATE_LIMITED is retried with backoff
    // because the free tier is 3 req/min and a certification run must be
    // repeatable; every OTHER error propagates, because a silent fallback to
    // per-item calls is what burned the quota and hid the real failure.
    const vectors = await withRateLimitRetry(() => provider.embedBatch(texts));
    providerRequests = 1;
    if (vectors.length !== texts.length) {
      throw new Error(`batch returned ${vectors.length} vectors for ${texts.length} texts`);
    }
    texts.forEach((t, i) => {
      const v = vectors[i];
      if (v.vector.length !== contract.dimensions) {
        throw new Error(`DIMENSION_MISMATCH: provider returned ${v.vector.length}, contract expects ${contract.dimensions}`);
      }
      const entry = {
        key: cacheKey(identity, t),
        provider: identity.provider, model: identity.model, dimensions: identity.dimensions,
        query: t.trim().replace(/\s+/g, ' '), queryHash: queryHash(t),
        vector: v.vector, source: 'REAL_VOYAGE' as const,
        acquiredAt: new Date().toISOString(),
      };
      cache.set(entry.key, entry);
      appendCache(entry);
    });
  }

  let written = 0;
  for (const p of prepared) {
    const hit = cache.get(p.key);
    if (!hit) continue;
    const { error } = await db.from('memory_embeddings').upsert({
      workspace_id: String(p.m.workspace_id),
      source_type: 'marketing_memory', source_id: String(p.m.id), source_field: 'canonical',
      embedding_provider: contract.provider, embedding_model: contract.model,
      dimensions: contract.dimensions, embedding_version: contract.embedding_version,
      rendering_version: p.rendered.renderingVersion, content_hash: p.rendered.contentHash,
      embedding: JSON.stringify(hit.vector), status: 'current', last_error: null,
      // Matches the memory_embeddings_identity unique index exactly (migration 089):
      // (source_type, source_id, source_field, embedding_model, embedding_version).
    }, { onConflict: 'source_type,source_id,source_field,embedding_model,embedding_version' });
    if (error) throw new Error(`embedding upsert failed: ${error.message}`);
    written++;
  }

  // Required jobs are satisfied; close them so the guard's job checks are clean.
  await db.from('embedding_outbox').update({ status: 'completed', completed_at: new Date().toISOString() })
    .in('workspace_id', workspaceIds).eq('source_type', 'marketing_memory').in('status', ['pending', 'failed']);

  return {
    expected: memories.length,
    fromCache: prepared.length - misses.length,
    embedded: misses.length,
    providerRequests,
    written,
  };
}
