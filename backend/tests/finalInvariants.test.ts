/**
 * @file finalInvariants.test.ts
 * @description Failure-drill system properties and the three architectural
 *   invariants — 3.1G remediation §14 and §17.
 *
 *   §14 asks a different question from the existing drills. Those prove each
 *   failure is CLASSIFIED correctly (401 → NEEDS_REAUTH, 429 → retryable, and so
 *   on). This file asks what survives: after each failure, is canonical memory
 *   intact, is the outbox still durable, is there exactly one current vector, and
 *   can the system still answer a question? A pipeline can classify every error
 *   perfectly and still corrupt the corpus.
 *
 *   §17 re-proves the three invariants by DOING rather than by inspection —
 *   embeddings are switched off and memory is still served; vectors are deleted
 *   and rebuilt from canonical records; a pair of near-identical opposing claims
 *   is pushed through and changes nothing.
 *
 * @security Offline. MemoryDb + deterministic provider; no network, no secrets.
 * @dependencies embeddingPipeline, retrievalService, claimComparison, beliefPolicy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import type { EmbeddingProvider, EmbeddingVector } from '../src/types/embedding';
import { DeterministicEmbeddingProvider } from '../src/services/memory/providers/deterministicProvider';
import { EmbeddingError, type EmbeddingErrorKind } from '../src/services/memory/providers/embeddingErrors';

const WS_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MEM_A = 'dddddddd-0000-4000-8000-00000000000d';
const JOB_ID = 'eeeeeeee-0000-4000-8000-00000000000e';
const CANONICAL_TITLE = 'Search converts better than Meta';
const CANONICAL_CLAIM = 'Search converts better than Meta overall.';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

class Failing implements EmbeddingProvider {
  #inner = new DeterministicEmbeddingProvider(8);
  #fail?: EmbeddingError;
  #badVector?: 'malformed' | 'wrongDims';
  constructor(o: { fail?: EmbeddingError; badVector?: 'malformed' | 'wrongDims' } = {}) {
    this.#fail = o.fail; this.#badVector = o.badVector;
  }
  get capabilities() { return this.#inner.capabilities; }
  async embedOne(t: string): Promise<EmbeddingVector> {
    if (this.#fail) throw this.#fail;
    if (this.#badVector === 'malformed') return { vector: [NaN, 1, 2, 3, 4, 5, 6, 7], dimensions: 8 };
    if (this.#badVector === 'wrongDims') { const v = await this.#inner.embedOne(t); return { vector: v.vector.slice(0, 4), dimensions: 4 }; }
    return this.#inner.embedOne(t);
  }
  async embedBatch(ts: string[]) { return Promise.all(ts.map(t => this.embedOne(t))); }
  async healthCheck() { return this.#inner.healthCheck(); }
}

function seed(existingEmbedding: Record<string, unknown> | null = null): MemoryDb {
  const d = new MemoryDb({
    embedding_contract: [{ id: 1, provider: 'test', model: 'm1', dimensions: 8,
                           embedding_version: 1, generation_enabled: true }],
    marketing_memories: [{
      id: MEM_A, workspace_id: WS_A, product_id: null, memory_type: 'campaign',
      title: CANONICAL_TITLE, content: { claim: CANONICAL_CLAIM },
      source: 'campaign_performance', status: 'active', confidence: 0.83, version: 1,
      evidence_ids: [], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }],
    memory_embeddings: existingEmbedding ? [existingEmbedding] : [],
    embedding_outbox: [{
      id: JOB_ID, workspace_id: WS_A, source_type: 'marketing_memory', source_id: MEM_A,
      source_field: 'canonical', requested_provider: 'test', requested_model: 'm1',
      requested_dimensions: 8, status: 'processing', attempt_count: 1, trace_id: null,
    }],
    playbook_signals: [],
  });
  (globalThis as { __db: MemoryDb }).__db = d;
  db = d;
  return d;
}

async function process(provider: EmbeddingProvider) {
  const { processOne } = await import('../src/services/memory/embeddingPipeline');
  const row = db.rows('embedding_outbox')[0];
  return processOne(row as never, provider);
}

/** The four properties that must hold after ANY failure. */
function assertSystemIntact(label: string): void {
  const mem = db.rows('marketing_memories');
  expect(mem, `${label}: canonical memory must survive`).toHaveLength(1);
  expect(mem[0].title, `${label}: title unchanged`).toBe(CANONICAL_TITLE);
  expect((mem[0].content as { claim: string }).claim, `${label}: claim unchanged`).toBe(CANONICAL_CLAIM);

  expect(db.rows('embedding_outbox'), `${label}: outbox row must remain durable`).toHaveLength(1);

  const current = db.rows('memory_embeddings').filter(e => e.status === 'current');
  expect(current.length, `${label}: at most one current vector`).toBeLessThanOrEqual(1);
}

beforeEach(() => { vi.clearAllMocks(); });

// ── §14 failure-drill matrix ─────────────────────────────────────────────────
describe('§14 what survives each failure', () => {
  const KINDS: Array<[string, EmbeddingErrorKind]> = [
    ['provider 401', 'AUTH_FAILED'],
    ['provider 429', 'RATE_LIMITED'],
    ['timeout', 'TIMEOUT'],
    ['provider 5xx', 'PROVIDER_UNAVAILABLE'],
    ['invalid input', 'INVALID_INPUT'],
  ];

  for (const [label, kind] of KINDS) {
    it(`${label} — memory intact, outbox durable, no partial vector`, async () => {
      seed();
      const out = await process(new Failing({ fail: new EmbeddingError(kind, `${kind} simulated`) }));
      expect(['failed', 'dead']).toContain(out.result);
      assertSystemIntact(label);
      // Nothing half-written: a failure must leave zero vectors, not a broken one.
      expect(db.rows('memory_embeddings').filter(e => e.status === 'current')).toHaveLength(0);
    });
  }

  it('malformed vector response — refused, nothing stored', async () => {
    seed();
    const out = await process(new Failing({ badVector: 'malformed' }));
    expect(out.result).not.toBe('completed');
    assertSystemIntact('malformed vector');
    expect(db.rows('memory_embeddings').filter(e => e.status === 'current')).toHaveLength(0);
  });

  it('dimension mismatch — refused rather than padded or truncated', async () => {
    seed();
    const out = await process(new Failing({ badVector: 'wrongDims' }));
    expect(out.result).not.toBe('completed');
    assertSystemIntact('dimension mismatch');
  });

  it('duplicate delivery — exactly one current vector, never two', async () => {
    seed();
    const first = await process(new Failing());
    expect(first.result).toBe('completed');
    const second = await process(new Failing());   // redelivery of the same job
    expect(['completed', 'skipped']).toContain(second.result);
    assertSystemIntact('duplicate delivery');
    expect(db.rows('memory_embeddings').filter(e => e.status === 'current')).toHaveLength(1);
  });

  it('after any failure, retrieval still answers from canonical memory', async () => {
    // The fallback property. If a provider outage made memory unreachable, the
    // whole "Postgres is authoritative" claim would be decorative.
    seed();
    await process(new Failing({ fail: new EmbeddingError('PROVIDER_UNAVAILABLE', 'down') }));

    db.onRpc('lm_search_memory_fulltext', () => [{ id: MEM_A }]);
    db.onRpc('lm_search_memory_embeddings', () => []);
    const { retrieveMemories, __clearQueryEmbeddingCache } =
      await import('../src/services/memory/retrievalService');
    __clearQueryEmbeddingCache();

    const r = await retrieveMemories(
      { workspaceId: WS_A, query: 'search versus meta' } as never,
      new Failing({ fail: new EmbeddingError('PROVIDER_UNAVAILABLE', 'down') }));

    expect(r.mode).toBe('LEXICAL_ONLY');
    expect(r.results.map(x => x.id)).toContain(MEM_A);
    expect(r.degraded).toBe(true);          // honest about being degraded…
    expect(r.results.length).toBeGreaterThan(0);   // …and still useful
  });
});

// ── §17.1 Postgres is authoritative ──────────────────────────────────────────
describe('§17.1 Postgres is authoritative', () => {
  it('with embeddings switched OFF entirely, memory is still complete and retrievable', async () => {
    seed();
    // No contract at all: the semantic arm cannot even be attempted.
    // NOTE: MemoryDb.rows() returns COPIES, so mutating that array is a no-op —
    // an earlier version of this test "passed" without ever clearing the
    // contract, which made the semantic arm fail for an unrelated reason and
    // proved nothing. setRows is the only real write.
    db.setRows('embedding_contract', []);
    db.onRpc('lm_search_memory_fulltext', () => [{ id: MEM_A }]);
    db.onRpc('lm_search_memory_embeddings', () => { throw new Error('must not be called'); });

    const { retrieveMemories, __clearQueryEmbeddingCache } =
      await import('../src/services/memory/retrievalService');
    __clearQueryEmbeddingCache();
    const r = await retrieveMemories({ workspaceId: WS_A, query: 'search versus meta' } as never);

    expect(r.mode).toBe('LEXICAL_ONLY');
    expect(r.results).toHaveLength(1);
    // Full fidelity, not a stub: the belief comes back with everything needed to
    // cite it, which is what makes the vector store genuinely optional.
    const got = r.results[0];
    expect(got.title).toBe(CANONICAL_TITLE);
    expect(got.claim).toBe(CANONICAL_CLAIM);
    expect(got.confidence).toBe(0.83);
    expect(got.version).toBe(1);
    expect(got.source).toBe('campaign_performance');
  });

  it('deleting every vector does not change a single canonical field', async () => {
    seed();
    await process(new Failing());
    const before = JSON.stringify(db.rows('marketing_memories'));
    db.setRows('memory_embeddings', []);
    expect(db.rows('memory_embeddings')).toHaveLength(0);
    expect(JSON.stringify(db.rows('marketing_memories'))).toBe(before);
  });
});

// ── §17.2 Embeddings are derived ─────────────────────────────────────────────
describe('§17.2 embeddings are derived and rebuildable', () => {
  it('a deleted vector is rebuilt from the canonical record, identically', async () => {
    seed();
    const first = await process(new Failing());
    expect(first.result).toBe('completed');
    const original = { ...db.rows('memory_embeddings')[0] };
    expect(original.status).toBe('current');

    // Destroy the derived data entirely.
    db.setRows('memory_embeddings', []);
    expect(db.rows('memory_embeddings')).toHaveLength(0);

    // Rebuild through the real pipeline from the canonical row alone.
    const rebuilt = await process(new Failing());
    expect(rebuilt.result).toBe('completed');
    const after = db.rows('memory_embeddings')[0];

    // Same content hash: the vector is a pure function of the canonical text, so
    // a rebuild is not merely "a vector" but THE vector.
    expect(after.content_hash).toBe(original.content_hash);
    expect(after.embedding_model).toBe(original.embedding_model);
    expect(after.dimensions).toBe(original.dimensions);
    expect(after.status).toBe('current');
  });

  it('the rebuild reads the CURRENT canonical text, not a cached copy', async () => {
    seed();
    await process(new Failing());
    const beforeHash = db.rows('memory_embeddings')[0].content_hash;

    db.setRows('memory_embeddings', []);
    const changed = db.rows('marketing_memories');
    changed[0].content = { claim: 'Meta converts better than Search now.' };
    db.setRows('marketing_memories', changed);

    await process(new Failing());
    // A changed belief must produce a different vector, or stale content would
    // be embedded forever and retrieval would answer from a belief nobody holds.
    expect(db.rows('memory_embeddings')[0].content_hash).not.toBe(beforeHash);
  });
});

// ── §17.3 Similarity nominates, never decides ────────────────────────────────
describe('§17.3 similarity nominates, never decides', () => {
  it('B1 — near-identical opposing claims produce NO reinforcement and NO mutation', async () => {
    const { compareClaims } = await import('../src/services/memory/claimComparison');
    const { decide } = await import('../src/services/memory/beliefPolicy');

    // These two are extremely close by any lexical or vector measure: they share
    // every token but one. High similarity is exactly the condition under which a
    // similarity-driven system would merge or reinforce them.
    const r = await compareClaims(
      { text: 'Meta creative fatigues above frequency 3', scope: { channel: 'meta' } },
      { text: 'Meta creative performs better above frequency 3', scope: { channel: 'meta' } },
      { allowModel: false });

    expect(r.classification).not.toBe('REINFORCEMENT');
    expect(r.classification).not.toBe('DUPLICATE');
    expect(decide(r.classification, 'campaign_performance', 'analytics').action).toBe('none');
  });

  it('a retrieval result with distance ~0 grants nothing on its own', async () => {
    seed();
    db.onRpc('lm_search_memory_fulltext', () => []);
    db.onRpc('lm_search_memory_embeddings', () => [{ source_id: MEM_A, distance: 0.0001 }]);
    db.setRows('memory_embeddings', [{
      id: 'e1', workspace_id: WS_A, source_type: 'marketing_memory', source_id: MEM_A,
      status: 'current', content_hash: 'a'.repeat(64),
    }]);

    const { retrieveMemories, __clearQueryEmbeddingCache } =
      await import('../src/services/memory/retrievalService');
    __clearQueryEmbeddingCache();
    const before = JSON.stringify(db.rows('marketing_memories'));
    const r = await retrieveMemories({ workspaceId: WS_A, query: CANONICAL_TITLE } as never, new Failing());

    expect(r.results[0]?.semanticDistance).toBeLessThan(0.01);   // a near-perfect match…
    expect(JSON.stringify(db.rows('marketing_memories'))).toBe(before);  // …changed nothing
    expect(db.rows('marketing_memory_versions') ?? []).toHaveLength(0);
  });

  it('decide() cannot receive a similarity score even if a caller wanted to pass one', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', 'src', 'services', 'memory', 'beliefPolicy.ts'), 'utf-8');
    const sig = src.slice(src.indexOf('export function decide'), src.indexOf('export function decide') + 400);
    for (const forbidden of ['distance', 'similarity', 'score', 'embedding', 'vector']) {
      expect(sig.toLowerCase()).not.toContain(forbidden);
    }
  });
});
