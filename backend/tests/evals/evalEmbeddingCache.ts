/**
 * @file evalEmbeddingCache.ts
 * @description Persistent REAL-Voyage query-embedding cache for evaluation —
 *   3.2A Observation §2, §4, §5, §7.
 *
 *   WHY THIS EXISTS. Every evaluation query needed one live provider call, and
 *   the account's tier is ~3 requests/minute. That turned an 89-candidate
 *   observation into a rate-limit measurement rather than a retrieval
 *   measurement: unpaced runs degraded to LEXICAL_ONLY, paced runs took 30+
 *   minutes, and paced-with-retry stalled outright. Four attempts, no
 *   publishable result.
 *
 *   The datasets are FIXED. The same 89 candidate claims and the same 32/110
 *   benchmark queries are embedded over and over. Acquiring those vectors ONCE
 *   and reusing them removes the provider from the evaluation loop entirely, so
 *   a Gate A or Gate B code fix can be re-measured in seconds instead of an hour.
 *
 *   THESE ARE REAL VOYAGE VECTORS. The deterministic offline provider is never
 *   used here — its vectors carry no semantic meaning, so nomination measured
 *   against them would be noise wearing a hybrid label. Every entry records
 *   `source: 'REAL_VOYAGE'` and is validated against the live contract.
 *
 *   NOT MARKETING MEMORY. This file-backed cache is evaluation scaffolding. It is
 *   never read by production, never written to `memory_embeddings`, and holds
 *   query vectors — not durable record vectors.
 *
 * @security Contains embedding vectors of synthetic evaluation text only. No
 *   founder data, no credentials.
 * @dependencies providers/index (real Voyage), retrievalService (cache primer)
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveEmbeddingProvider } from '../../src/services/memory/providers/index';
import { EmbeddingError } from '../../src/services/memory/providers/embeddingErrors';
import { __primeQueryEmbeddingCache } from '../../src/services/memory/retrievalService';

/** Append-only JSONL: a crashed acquisition keeps everything it had already got. */
export const CACHE_PATH = join(__dirname, '.query-embedding-cache', 'voyage-queries.jsonl');

export interface CachedEmbedding {
  key: string;
  provider: string;
  model: string;
  dimensions: number;
  /** Normalized text actually sent to the provider. */
  query: string;
  /** Hash of the query CONTENT, so a text edit invalidates naturally. */
  queryHash: string;
  vector: number[];
  /** Always 'REAL_VOYAGE'. Present so a reader can prove provenance. */
  source: 'REAL_VOYAGE';
  acquiredAt: string;
}

export interface CacheIdentity {
  provider: string;
  model: string;
  dimensions: number;
}

/**
 * Cache key.
 *
 * Includes provider, model and dimensions so a contract change invalidates
 * every entry rather than silently mixing model families — the failure mode
 * ADR-066 rule 14 and migration 099's dimension checks both guard against.
 */
export function cacheKey(id: CacheIdentity, query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const h = createHash('sha256').update(normalized).digest('hex');
  return `${id.provider}:${id.model}:${id.dimensions}:${h}`;
}

export function queryHash(query: string): string {
  return createHash('sha256').update(query.trim().replace(/\s+/g, ' ')).digest('hex');
}

/** Loads the cache. Malformed lines are skipped rather than failing the run. */
export function loadCache(): Map<string, CachedEmbedding> {
  const out = new Map<string, CachedEmbedding>();
  if (!existsSync(CACHE_PATH)) return out;
  for (const line of readFileSync(CACHE_PATH, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as CachedEmbedding;
      if (e.source !== 'REAL_VOYAGE') continue;          // never trust a non-real vector
      if (!Array.isArray(e.vector) || e.vector.length !== e.dimensions) continue;
      out.set(e.key, e);
    } catch { /* skip a truncated final line from an interrupted append */ }
  }
  return out;
}

/** Exported so corpus-vector acquisition writes through the SAME cache file
 *  as query acquisition — one mechanism, not two incompatible ones. */
export function appendCache(entry: CachedEmbedding): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  appendFileSync(CACHE_PATH, JSON.stringify(entry) + '\n');
}

// ── Provider-level limiter (§4) ──────────────────────────────────────────────

/**
 * One serialized request queue for the whole acquisition.
 *
 * Deliberately NOT sleeps scattered through calling code: that is what failed
 * four times. Every provider request goes through `schedule()`, so there is
 * exactly one place that knows the rate, one place that honours `Retry-After`,
 * and no way for a caller to accidentally issue a parallel call.
 */
class EvalRateLimiter {
  #chain: Promise<unknown> = Promise.resolve();
  #lastAt = 0;
  #minGapMs: number;

  constructor(requestsPerMinute: number) {
    this.#minGapMs = 60_000 / Math.max(requestsPerMinute, 0.1);
  }

  /** Serializes `fn` behind every previously scheduled call. */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(async () => {
      const wait = this.#lastAt + this.#minGapMs - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.#lastAt = Date.now();
      }
    });
    // The chain must not break on a rejection, or every later call is skipped.
    this.#chain = run.catch(() => undefined);
    return run as Promise<T>;
  }

  /** Applies a provider-supplied Retry-After before the next request. */
  async backOff(seconds: number): Promise<void> {
    this.#lastAt = Date.now() + seconds * 1000 - this.#minGapMs;
  }
}

export interface AcquireOptions {
  requestsPerMinute?: number;
  maxRetries?: number;
  /** Called after each batch so a long acquisition shows progress. */
  onProgress?: (done: number, total: number, fromCache: number) => void;
}

export interface AcquireReport {
  identity: CacheIdentity;
  uniqueQueries: number;
  cacheHits: number;
  acquired: number;
  providerRequests: number;
  batchSize: number;
  elapsedMs: number;
  failures: Array<{ query: string; reason: string }>;
}

/**
 * STAGE A — ensures every query has a real Voyage vector in the cache.
 *
 * Resumable: already-cached queries are skipped, and each acquired vector is
 * appended immediately, so stopping after 30 of 89 resumes at 31.
 *
 * Batched: `embedBatch` sends up to `maxBatchSize` texts in ONE request. The
 * provider sets `input_type: 'document'` for every call regardless of batch
 * size, so batching changes no embedding semantics — the vector for a query is
 * identical whether it was requested alone or with 88 others.
 */
export async function acquireQueryEmbeddings(
  queries: string[],
  opts: AcquireOptions = {},
): Promise<AcquireReport> {
  const started = Date.now();
  const { provider, live } = resolveEmbeddingProvider() as {
    provider: ReturnType<typeof resolveEmbeddingProvider>['provider']; live: boolean;
  };

  if (!live) {
    // The whole point is REAL vectors. Falling back here would produce a cache
    // that looks valid and measures nothing.
    throw new Error(
      'refusing to acquire: the resolved provider is not live. ' +
      'Evaluation embeddings must come from real Voyage, never the deterministic provider.');
  }

  const identity: CacheIdentity = {
    provider: 'voyage',
    model: provider.capabilities.model,
    dimensions: provider.capabilities.dimensions,
  };

  const unique = [...new Set(queries.map(q => q.trim().replace(/\s+/g, ' ')))].filter(Boolean);
  const cache = loadCache();
  const missing = unique.filter(q => !cache.has(cacheKey(identity, q)));
  const cacheHits = unique.length - missing.length;

  const rpm = opts.requestsPerMinute ?? 3;
  const maxRetries = opts.maxRetries ?? 5;
  const limiter = new EvalRateLimiter(rpm);
  const batchSize = Math.min(provider.capabilities.maxBatchSize ?? 128, 128);

  let acquired = 0;
  let providerRequests = 0;
  const failures: AcquireReport['failures'] = [];

  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    let done = false;

    for (let attempt = 0; attempt <= maxRetries && !done; attempt++) {
      try {
        const vectors = await limiter.schedule(async () => {
          providerRequests++;
          return provider.embedBatch(batch);
        });

        // Validate before persisting: a wrong-width or short response cached now
        // would poison every future run silently.
        if (vectors.length !== batch.length) {
          throw new Error(`provider returned ${vectors.length} vectors for ${batch.length} inputs`);
        }
        batch.forEach((q, j) => {
          const v = vectors[j];
          if (v.dimensions !== identity.dimensions || v.vector.length !== identity.dimensions) {
            throw new Error(`dimension mismatch: got ${v.dimensions}, contract ${identity.dimensions}`);
          }
          appendCache({
            key: cacheKey(identity, q), ...identity,
            query: q, queryHash: queryHash(q),
            vector: v.vector, source: 'REAL_VOYAGE',
            acquiredAt: new Date().toISOString(),
          });
          acquired++;
        });
        done = true;
      } catch (err) {
        const e = err as EmbeddingError;
        const isRateLimit = e?.kind === 'RATE_LIMITED';
        if (attempt === maxRetries) {
          for (const q of batch) failures.push({ query: q, reason: e?.message ?? String(err) });
          break;
        }
        // Honour the provider's own Retry-After when it supplies one, rather
        // than guessing a back-off it never asked for.
        const waitS = e?.retryAfterSeconds ?? (isRateLimit ? 25 * (attempt + 1) : 5);
        await limiter.backOff(waitS);
        await new Promise(r => setTimeout(r, waitS * 1000));
      }
    }
    opts.onProgress?.(Math.min(i + batchSize, missing.length), missing.length, cacheHits);
  }

  return {
    identity, uniqueQueries: unique.length, cacheHits, acquired,
    providerRequests, batchSize, elapsedMs: Date.now() - started, failures,
  };
}

export interface PrimeReport {
  requested: number;
  primed: number;
  missing: string[];
  identity: CacheIdentity;
}

/**
 * STAGE B — primes the retrieval query cache from persisted real vectors.
 *
 * Makes ZERO provider calls. A query with no cached vector is reported as
 * missing rather than silently embedded, so an evaluation cannot quietly fall
 * back to a live call and re-introduce the rate-limit dependency.
 */
export function primeFromCache(queries: string[], contract: CacheIdentity & { version: number }): PrimeReport {
  const cache = loadCache();
  const identity: CacheIdentity = {
    provider: contract.provider, model: contract.model, dimensions: contract.dimensions,
  };
  const unique = [...new Set(queries.map(q => q.trim().replace(/\s+/g, ' ')))].filter(Boolean);
  const missing: string[] = [];
  let primed = 0;

  for (const q of unique) {
    const hit = cache.get(cacheKey(identity, q));
    if (!hit) { missing.push(q); continue; }
    // The retrieval cache key format is fixed by retrievalService.
    __primeQueryEmbeddingCache(
      `${contract.model}:${contract.version}:${contract.dimensions}:${q}`, hit.vector);
    primed++;
  }
  return { requested: unique.length, primed, missing, identity };
}

/**
 * Integrity guard (§6). Throws unless every query has a real cached vector.
 *
 * A published hybrid metric must be provably hybrid. This is the same lesson as
 * the 3.1G held-out evaluation, which reported a lexical score under a hybrid
 * heading because nothing checked.
 */
export function assertSemanticCoverage(report: PrimeReport): void {
  if (report.missing.length > 0) {
    throw new Error(
      `semantic_verified = ${report.primed}/${report.requested} — REFUSING TO PUBLISH.\n` +
      `  ${report.missing.length} query/queries have no real Voyage vector. Run Stage A first:\n` +
      `    npm run eval:acquire-embeddings\n` +
      `  first missing: ${report.missing.slice(0, 3).map(q => JSON.stringify(q.slice(0, 60))).join(', ')}`);
  }
}
