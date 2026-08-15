/**
 * @file retrievalService.test.ts
 * @description Hybrid retrieval behaviour — Phase 3.1D.
 *
 *   Covers fusion, business reranking, budgets, every degradation path, tenancy,
 *   and the structural guarantee that retrieval never writes.
 *
 *   Runs offline against MemoryDb with stubbed RPCs, so each arm can be failed
 *   independently and deterministically. The SQL those RPCs contain — the
 *   tsvector index and the exact vector scan — is proved separately against a
 *   real Postgres in retrievalSql.pg.test.ts. Neither suite substitutes for the
 *   other: this one cannot verify that `<=>` filters by dimension first, and
 *   that one cannot conveniently simulate a provider outage.
 *
 * @security Includes the §11 adversarial cases: identical wording in two
 *   workspaces, forged workspace id, and source-id substitution.
 * @dependencies retrievalService, MemoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MemoryDb } from './helpers/memoryDb';
import type { EmbeddingProvider, EmbeddingVector } from '../src/types/embedding';
import { DeterministicEmbeddingProvider } from '../src/services/memory/providers/deterministicProvider';
import { EmbeddingError } from '../src/services/memory/providers/embeddingErrors';

const WS_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PROD = 'cccccccc-1111-4111-8111-cccccccccccc';

const M = {
  outcome:    '10000001-0000-4000-8000-000000000001',
  founderVeto:'10000002-0000-4000-8000-000000000002',
  weakMarket: '10000003-0000-4000-8000-000000000003',
  otherTenant:'10000004-0000-4000-8000-000000000004',
};

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

class Recorder implements EmbeddingProvider {
  readonly calls: string[] = [];
  #inner = new DeterministicEmbeddingProvider(8);
  #fail?: EmbeddingError;
  #dims?: number;
  constructor(opts: { fail?: EmbeddingError; dims?: number } = {}) { this.#fail = opts.fail; this.#dims = opts.dims; }
  get capabilities() { return this.#inner.capabilities; }
  async embedOne(t: string): Promise<EmbeddingVector> {
    this.calls.push(t);
    if (this.#fail) throw this.#fail;
    const v = await this.#inner.embedOne(t);
    return this.#dims ? { vector: v.vector.slice(0, this.#dims), dimensions: this.#dims } : v;
  }
  async embedBatch(ts: string[]) { return Promise.all(ts.map(t => this.embedOne(t))); }
  async healthCheck() { return this.#inner.healthCheck(); }
}

const memory = (over: Record<string, unknown>) => ({
  workspace_id: WS_A, product_id: PROD, memory_type: 'campaign',
  content: {}, confidence: 0.8, version: 1, status: 'active', source: 'campaign_performance',
  evidence_ids: [], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

function seed(opts: {
  lexical?: Array<{ id: string }> | 'fail';
  semantic?: Array<{ source_id: string; distance: number }> | 'fail';
  contract?: Record<string, unknown> | null;
  embeddings?: Array<Record<string, unknown>>;
} = {}): MemoryDb {
  const d = new MemoryDb({
    embedding_contract: opts.contract === null ? [] : [opts.contract ?? {
      id: 1, model: 'voyage-4', embedding_version: 1, dimensions: 8, generation_enabled: true,
    }],
    marketing_memories: [
      memory({ id: M.outcome,     title: 'Outcome-led messaging increased conversion',
               content: { claim: 'Outcome-led beat feature-led by 41%.' }, confidence: 0.88 }),
      memory({ id: M.founderVeto, title: 'Founder rejected the India market recommendation',
               content: { claim: 'No local operations capacity.' },
               memory_type: 'founder', source: 'founder_feedback', confidence: 0.60 }),
      memory({ id: M.weakMarket,  title: 'Market may be shifting to subscription plans',
               content: { claim: 'Weak, uncorroborated signal.' },
               memory_type: 'market', source: 'growth_brain', confidence: 0.95 }),
      memory({ id: M.otherTenant, workspace_id: WS_B, product_id: null,
               title: 'Outcome-led messaging increased conversion',
               content: { claim: 'A different tenant, identical wording.' }, confidence: 0.99 }),
    ],
    memory_embeddings: opts.embeddings ?? [
      { id: 'e1', workspace_id: WS_A, source_type: 'marketing_memory', source_id: M.outcome,
        status: 'current', content_hash: 'a'.repeat(64) },
    ],
  });

  d.onRpc('lm_search_memory_fulltext', () => {
    if (opts.lexical === 'fail') throw new Error('relation does not exist');
    return opts.lexical ?? [{ id: M.outcome }];
  });
  d.onRpc('lm_search_memory_embeddings', () => {
    if (opts.semantic === 'fail') throw new Error('different vector dimensions');
    return opts.semantic ?? [{ source_id: M.outcome, distance: 0.12 }];
  });

  (globalThis as { __db: MemoryDb }).__db = d;
  return d;
}

async function retrieve(req: Record<string, unknown>, provider?: EmbeddingProvider) {
  const { retrieveMemories } = await import('../src/services/memory/retrievalService');
  return retrieveMemories({ workspaceId: WS_A, query: 'outcome messaging', ...req } as never,
                          provider ?? new Recorder());
}

beforeEach(async () => {
  vi.clearAllMocks();
  // The query-embedding cache is module-level and would otherwise carry a vector
  // from a previous test into the degradation cases, so a "provider unavailable"
  // run would silently succeed from cache and the test would prove nothing.
  const { __clearQueryEmbeddingCache } = await import('../src/services/memory/retrievalService');
  __clearQueryEmbeddingCache();
});

// ── Hybrid + fusion ──────────────────────────────────────────────────────────
describe('hybrid retrieval and fusion', () => {
  it('reports HYBRID when both ranked arms contribute', async () => {
    db = seed();
    const r = await retrieve({});
    expect(r.mode).toBe('HYBRID');
    expect(r.degraded).toBe(false);
    expect(r.results[0].arms).toEqual(expect.arrayContaining(['structured', 'lexical', 'semantic']));
  });

  it('fuses by RANK, not by mixing incomparable scores', async () => {
    // ts_rank_cd is unbounded; cosine distance is [0,2]. RRF only ever sees rank,
    // so a record ranked 1st lexically and 3rd semantically must score exactly
    // 1/(60+1) + 1/(60+3) — computable without knowing either raw score.
    db = seed({
      lexical:  [{ id: M.outcome }, { id: M.weakMarket }],
      semantic: [{ source_id: M.weakMarket, distance: 0.1 }, { source_id: M.founderVeto, distance: 0.2 },
                 { source_id: M.outcome, distance: 0.3 }],
    });
    const r = await retrieve({});
    const outcome = r.results.find(x => x.id === M.outcome)!;
    expect(outcome.fusedScore).toBeCloseTo(1 / 61 + 1 / 63, 10);
    expect(outcome.lexicalRank).toBe(1);
    expect(outcome.semanticRank).toBe(3);
  });

  it('records per-arm rank and provenance on every result', async () => {
    db = seed();
    const r = await retrieve({});
    const top = r.results[0];
    expect(top).toMatchObject({ id: M.outcome, version: 1, workspaceId: WS_A, status: 'active' });
    expect(top.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(top.embeddingStatus).toBe('current');
    expect(typeof top.fusedRank).toBe('number');
    expect(typeof top.finalRank).toBe('number');
  });

  it('is deterministic — identical inputs give identical order', async () => {
    db = seed();
    const a = await retrieve({});
    db = seed();
    const b = await retrieve({});
    expect(a.results.map(r => r.id)).toEqual(b.results.map(r => r.id));
  });

  it('returns domain records, not a prose blob', async () => {
    db = seed();
    const r = await retrieve({});
    expect(Array.isArray(r.results)).toBe(true);
    expect(r.results[0]).toHaveProperty('evidenceIds');
    expect(r.results[0]).toHaveProperty('claim');
    expect(r.results[0]).not.toHaveProperty('prompt');
  });
});

// ── Business reranking ───────────────────────────────────────────────────────
describe('business-aware reranking', () => {
  it('a founder-confirmed memory outranks a higher-similarity weak inference', async () => {
    // The rule the reranker exists for. The weak market memory is ranked FIRST by
    // both arms and carries higher stored confidence; the founder veto is ranked
    // last by both. Precedence must still put the founder first — otherwise
    // LaunchMind would recommend something its owner explicitly refused.
    db = seed({
      lexical:  [{ id: M.weakMarket }, { id: M.founderVeto }],
      semantic: [{ source_id: M.weakMarket, distance: 0.05 }, { source_id: M.founderVeto, distance: 0.40 }],
    });
    const r = await retrieve({});
    expect(r.results[0].id).toBe(M.founderVeto);
    expect(r.results[0].rerankReasons.join(' ')).toMatch(/founder_feedback/);
  });

  it('does not zero out a low-confidence memory, only weights it', async () => {
    db = seed({ lexical: [{ id: M.founderVeto }], semantic: [] });
    const r = await retrieve({});
    expect(r.results.map(x => x.id)).toContain(M.founderVeto);   // confidence 0.60
  });

  it('changes no stored data — reranking is read-only', async () => {
    db = seed();
    const before = db.rows('marketing_memories').map(m => ({ id: m.id, confidence: m.confidence, version: m.version }));
    await retrieve({});
    const after = db.rows('marketing_memories').map(m => ({ id: m.id, confidence: m.confidence, version: m.version }));
    expect(after).toEqual(before);
  });
});

// ── Degradation (§8) ─────────────────────────────────────────────────────────
describe('graceful degradation', () => {
  it('A — provider unavailable → LEXICAL_ONLY, results still returned', async () => {
    db = seed();
    const r = await retrieve({}, new Recorder({ fail: new EmbeddingError('PROVIDER_UNAVAILABLE', 'down') }));
    expect(r.mode).toBe('LEXICAL_ONLY');
    expect(r.degraded).toBe(true);
    expect(r.degradedReasons).toContain('semantic:QUERY_EMBEDDING_FAILED');
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('B — semantic SQL fails → LEXICAL_ONLY, reason surfaced', async () => {
    db = seed({ semantic: 'fail' });
    const r = await retrieve({});
    expect(r.mode).toBe('LEXICAL_ONLY');
    expect(r.degradedReasons).toContain('semantic:SEMANTIC_SQL_FAILED');
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('C — no current embeddings → semantic ran but contributed nothing', async () => {
    db = seed({ semantic: [] });
    const r = await retrieve({});
    const sem = r.arms.find(a => a.arm === 'semantic')!;
    expect(sem.unavailableReason).toBe('NO_CURRENT_EMBEDDINGS');
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('D — a record with a STALE vector is still reachable lexically', async () => {
    db = seed({
      semantic: [],
      embeddings: [{ id: 'e1', workspace_id: WS_A, source_type: 'marketing_memory',
                     source_id: M.outcome, status: 'stale', content_hash: 'b'.repeat(64) }],
    });
    const r = await retrieve({});
    const hit = r.results.find(x => x.id === M.outcome)!;
    expect(hit).toBeTruthy();
    expect(hit.embeddingStatus).toBe('stale');   // flagged, not hidden
  });

  it('F — a query vector of the wrong width never reaches SQL', async () => {
    db = seed();
    const r = await retrieve({}, new Recorder({ dims: 3 }));   // contract says 8
    expect(r.mode).toBe('LEXICAL_ONLY');
    expect(r.degradedReasons).toContain('semantic:QUERY_EMBEDDING_FAILED');
  });

  it('G — both ranked arms fail → STRUCTURED_ONLY still returns memory', async () => {
    db = seed({ lexical: 'fail', semantic: 'fail' });
    const r = await retrieve({});
    expect(r.mode).toBe('STRUCTURED_ONLY');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].rerankReasons[0]).toMatch(/structured fallback/);
  });

  it('distinguishes "nothing relevant" from "subsystem failed"', async () => {
    // Nothing relevant: arms ran, found nothing.
    db = seed({ lexical: [], semantic: [] });
    const empty = await retrieve({});
    expect(empty.results).toHaveLength(0);
    expect(empty.mode).toBe('HYBRID');
    expect(empty.degraded).toBe(false);

    // Subsystem failed: arms could not run.
    db = seed({ lexical: 'fail', semantic: 'fail' });
    const failed = await retrieve({});
    expect(failed.degraded).toBe(true);
    expect(failed.mode).not.toBe('HYBRID');
  });

  it('no contract configured → semantic never attempted, no provider call', async () => {
    db = seed({ contract: null });
    const p = new Recorder();
    const r = await retrieve({}, p);
    expect(r.arms.find(a => a.arm === 'semantic')!.unavailableReason).toBe('PROVIDER_UNCONFIGURED');
    expect(p.calls).toHaveLength(0);
  });
});

// ── Tenancy (§11) ────────────────────────────────────────────────────────────
describe('workspace isolation', () => {
  it('identical wording in another workspace is never returned', async () => {
    // Both tenants hold a memory with the SAME title. The lexical and semantic
    // stubs both nominate the other tenant's row; the structured filter must
    // still exclude it.
    db = seed({
      lexical:  [{ id: M.otherTenant }, { id: M.outcome }],
      semantic: [{ source_id: M.otherTenant, distance: 0.01 }],
    });
    const r = await retrieve({});
    expect(r.results.map(x => x.id)).not.toContain(M.otherTenant);
    expect(r.results.every(x => x.workspaceId === WS_A)).toBe(true);
  });

  it('every arm is given the workspace as a SQL argument, not a post-filter', async () => {
    db = seed();
    await retrieve({});
    for (const call of db.rpcCalls) {
      expect(call.args.p_workspace_id, `${call.name} must be workspace-scoped`).toBe(WS_A);
    }
  });

  it('a forged workspace id returns that workspace\'s data only — never a merge', async () => {
    db = seed();
    const r = await retrieve({ workspaceId: WS_B });
    expect(r.results.every(x => x.workspaceId === WS_B)).toBe(true);
    expect(r.results.map(x => x.id)).not.toContain(M.outcome);
  });

  it('source-id substitution by an arm cannot inject an unknown record', async () => {
    db = seed({ semantic: [{ source_id: '99999999-9999-4999-8999-999999999999', distance: 0.0 }] });
    const r = await retrieve({});
    expect(r.results.map(x => x.id)).not.toContain('99999999-9999-4999-8999-999999999999');
  });

  it('product and type filters are applied', async () => {
    db = seed({ lexical: [{ id: M.outcome }, { id: M.founderVeto }] });
    const r = await retrieve({ memoryTypes: ['founder'] });
    expect(r.results.every(x => x.memoryType === 'founder')).toBe(true);
  });
});

// ── Budgets (§7) ─────────────────────────────────────────────────────────────
describe('budgets', () => {
  it('honours the result limit and reports what was excluded', async () => {
    db = seed({ lexical: [{ id: M.outcome }, { id: M.founderVeto }, { id: M.weakMarket }] });
    const r = await retrieve({ limit: 1 });
    expect(r.results).toHaveLength(1);
    expect(r.excludedForBudget).toBeGreaterThan(0);
  });

  it('honours the token budget', async () => {
    db = seed({ lexical: [{ id: M.outcome }, { id: M.founderVeto }, { id: M.weakMarket }] });
    const r = await retrieve({ tokenBudget: 12 });
    expect(r.tokensUsed).toBeLessThanOrEqual(12);
    expect(r.excludedForBudget).toBeGreaterThan(0);
  });

  it('surfaces the ANN review threshold without acting on it', async () => {
    db = seed();
    const r = await retrieve({});
    expect(r.diagnostics).toHaveProperty('annReviewDue');
    expect(typeof r.diagnostics.annReviewDue).toBe('boolean');
  });

  it('reports per-arm timings for observability', async () => {
    db = seed();
    const r = await retrieve({});
    for (const k of ['structuredMs', 'lexicalMs', 'semanticMs', 'queryEmbeddingMs', 'fusionMs', 'rerankMs', 'totalMs']) {
      expect(typeof (r.timings as Record<string, number>)[k]).toBe('number');
    }
  });
});

// ── §13 Similarity never decides ─────────────────────────────────────────────
describe('retrieval never writes (ADR-066 invariant 3)', () => {
  it('performs no insert, update or delete on any table', async () => {
    db = seed();
    const before = JSON.stringify({
      m: db.rows('marketing_memories'), e: db.rows('memory_embeddings'),
    });
    await retrieve({});
    const after = JSON.stringify({
      m: db.rows('marketing_memories'), e: db.rows('memory_embeddings'),
    });
    expect(after).toBe(before);
  });

  it('creates no learning event and no merge candidate', async () => {
    db = seed();
    await retrieve({});
    expect(db.rows('learning_events')).toHaveLength(0);
    expect(db.rows('growth_brain_learning_events')).toHaveLength(0);
    expect(db.rows('marketing_memory_versions')).toHaveLength(0);
  });

  it('STRUCTURAL — imports no mutation, supersession or learning API', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'services', 'memory', 'retrievalService.ts'), 'utf-8');
    for (const forbidden of [
      'marketingMemoryService', 'knowledgeGraphService', 'learningPipelineService',
      'growthBrainLearningService', 'updateMemory', 'archiveMemory', 'mergeMemories',
      'ingestLearningEvent', 'createMemory',
    ]) {
      expect(src, `retrievalService must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('STRUCTURAL — knows no embedding vendor', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'services', 'memory', 'retrievalService.ts'), 'utf-8');
    // Comments are stripped first: the file's own header explains that it does
    // NOT know about Voyage, and matching that sentence would be a false
    // positive that trains people to weaken the assertion.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const vendor of ['voyage', 'openai', 'cohere', 'api.voyageai.com']) {
      expect(code.toLowerCase(), `retrievalService must not reference ${vendor}`).not.toContain(vendor);
    }
    expect(code).toContain('EmbeddingProvider');
  });
});
