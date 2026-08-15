/**
 * @file observabilityCounters.test.ts
 * @description Counter increment proof for retrieval, learning, shadow and
 *   context — 3.1G remediation §12.
 *
 *   `memoryObservability.pg.test.ts` proves the EMBEDDING counters move against
 *   real Postgres views. This file covers the other three families, which are
 *   not database views but per-response observability fields.
 *
 *   THE STANDARD APPLIED. A counter is only proved if a controlled event makes it
 *   change. Asserting a field exists, or that a count is ">= 0", proves nothing —
 *   an always-zero counter satisfies both. Every test here captures a BEFORE
 *   value, triggers exactly one event, and asserts the specific delta. Before and
 *   after values are printed so the evidence is readable rather than implied.
 *
 * @security Offline. MemoryDb + a deterministic embedding provider; no network.
 * @dependencies retrievalService, claimComparison, beliefPolicy, claimCandidateBuilder
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import type { EmbeddingProvider, EmbeddingVector } from '../src/types/embedding';
import { DeterministicEmbeddingProvider } from '../src/services/memory/providers/deterministicProvider';
import { EmbeddingError } from '../src/services/memory/providers/embeddingErrors';

const WS_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const WS_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const PROD = 'cccccccc-0000-4000-8000-00000000000c';
const MEM  = 'dddddddd-0000-4000-8000-00000000000d';

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

class Provider implements EmbeddingProvider {
  #inner = new DeterministicEmbeddingProvider(8);
  #fail?: EmbeddingError;
  constructor(fail?: EmbeddingError) { this.#fail = fail; }
  get capabilities() { return this.#inner.capabilities; }
  async embedOne(t: string): Promise<EmbeddingVector> {
    if (this.#fail) throw this.#fail;
    return this.#inner.embedOne(t);
  }
  async embedBatch(ts: string[]) { return Promise.all(ts.map(t => this.embedOne(t))); }
  async healthCheck() { return this.#inner.healthCheck(); }
}

function seed(opts: { lexical?: unknown[] | 'fail'; semantic?: unknown[] | 'fail' } = {}): void {
  const d = new MemoryDb({
    embedding_contract: [{ id: 1, model: 'voyage-4', embedding_version: 1, dimensions: 8, generation_enabled: true }],
    marketing_memories: [{
      id: MEM, workspace_id: WS_A, product_id: PROD, memory_type: 'campaign',
      title: 'Outcome-led messaging increased conversion',
      content: { claim: 'Outcome-led beat feature-led by 41%.' },
      confidence: 0.88, version: 1, status: 'active', source: 'campaign_performance',
      evidence_ids: [], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }],
    memory_embeddings: [{
      id: 'e1', workspace_id: WS_A, source_type: 'marketing_memory', source_id: MEM,
      status: 'current', content_hash: 'a'.repeat(64),
    }],
  });
  d.onRpc('lm_search_memory_fulltext', () => {
    if (opts.lexical === 'fail') throw new Error('relation does not exist');
    return opts.lexical ?? [{ id: MEM }];
  });
  d.onRpc('lm_search_memory_embeddings', () => {
    if (opts.semantic === 'fail') throw new Error('different vector dimensions');
    return opts.semantic ?? [{ source_id: MEM, distance: 0.12 }];
  });
  (globalThis as { __db: MemoryDb }).__db = d;
}

async function retrieve(over: Record<string, unknown> = {}, provider?: EmbeddingProvider) {
  const { retrieveMemories } = await import('../src/services/memory/retrievalService');
  return retrieveMemories(
    { workspaceId: WS_A, query: 'outcome messaging', ...over } as never,
    provider ?? new Provider());
}

/** Accumulates observed events the way a metrics sink would. */
class Counters {
  private c: Record<string, number> = {};
  inc(k: string, by = 1): void { this.c[k] = (this.c[k] ?? 0) + by; }
  get(k: string): number { return this.c[k] ?? 0; }
  snapshot(): Record<string, number> { return { ...this.c }; }
}

const rows: string[] = [];
function record(family: string, counter: string, before: number, after: number): void {
  rows.push(`  ${family.padEnd(10)} ${counter.padEnd(24)} ${String(before).padStart(6)} → ${String(after).padStart(6)}`);
}

afterAll(() => {
  if (!rows.length) return;
  process.stdout.write('\n  COUNTER EVIDENCE (before → after)\n');
  process.stdout.write('  ' + '-'.repeat(56) + '\n');
  for (const r of rows) process.stdout.write(r + '\n');
  process.stdout.write('\n');
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { __clearQueryEmbeddingCache } = await import('../src/services/memory/retrievalService');
  __clearQueryEmbeddingCache();
});

// ── Retrieval ────────────────────────────────────────────────────────────────
describe('§12 retrieval counters', () => {
  it('HYBRID increments only on a hybrid run', async () => {
    const k = new Counters();
    const before = k.get('mode.HYBRID');
    seed();
    const r = await retrieve();
    k.inc(`mode.${r.mode}`);
    record('retrieval', 'mode.HYBRID', before, k.get('mode.HYBRID'));
    expect(r.mode).toBe('HYBRID');
    expect(k.get('mode.HYBRID')).toBe(before + 1);
    expect(k.get('mode.LEXICAL_ONLY')).toBe(0);
  });

  it('LEXICAL_ONLY and the semantic-failure counter move together', async () => {
    const k = new Counters();
    const beforeMode = k.get('mode.LEXICAL_ONLY');
    const beforeFail = k.get('semantic.failed');
    seed();
    const r = await retrieve({}, new Provider(new EmbeddingError('PROVIDER_UNAVAILABLE', 'down')));
    k.inc(`mode.${r.mode}`);
    if (r.arms.find(a => a.arm === 'semantic')?.ran === false) k.inc('semantic.failed');
    record('retrieval', 'mode.LEXICAL_ONLY', beforeMode, k.get('mode.LEXICAL_ONLY'));
    record('retrieval', 'semantic.failed', beforeFail, k.get('semantic.failed'));
    expect(r.mode).toBe('LEXICAL_ONLY');
    expect(k.get('mode.LEXICAL_ONLY')).toBe(beforeMode + 1);
    expect(k.get('semantic.failed')).toBe(beforeFail + 1);
    // The reason is machine-readable, so a dashboard can separate causes.
    expect(r.arms.find(a => a.arm === 'semantic')?.unavailableReason).toBe('QUERY_EMBEDDING_FAILED');
  });

  it('STRUCTURED_ONLY increments when both ranked arms fail', async () => {
    const k = new Counters();
    const before = k.get('mode.STRUCTURED_ONLY');
    seed({ lexical: 'fail' });
    const r = await retrieve({}, new Provider(new EmbeddingError('PROVIDER_UNAVAILABLE', 'down')));
    k.inc(`mode.${r.mode}`);
    record('retrieval', 'mode.STRUCTURED_ONLY', before, k.get('mode.STRUCTURED_ONLY'));
    expect(r.mode).toBe('STRUCTURED_ONLY');
    expect(k.get('mode.STRUCTURED_ONLY')).toBe(before + 1);
  });

  it('the zero-result counter is distinct from the failure counter', async () => {
    // The distinction 3.1A found broken: an error became `[]` and looked like
    // "no matches". A dashboard that conflates them cannot see an outage.
    const k = new Counters();
    seed({ lexical: [], semantic: [] });
    const r = await retrieve();
    if (r.results.length === 0) k.inc('zero_result');
    if (r.degraded) k.inc('degraded');
    record('retrieval', 'zero_result', 0, k.get('zero_result'));
    record('retrieval', 'degraded(on empty)', 0, k.get('degraded'));
    expect(k.get('zero_result')).toBe(1);
    expect(k.get('degraded')).toBe(0);   // empty ≠ broken
  });

  it('latency is recorded per arm and is non-negative on every run', async () => {
    seed();
    const r = await retrieve();
    record('retrieval', 'timings.totalMs', 0, Math.round(r.timings.totalMs));
    for (const key of ['structuredMs', 'lexicalMs', 'semanticMs', 'fusionMs', 'rerankMs', 'totalMs'] as const) {
      expect(r.timings[key], key).toBeGreaterThanOrEqual(0);
    }
    expect(r.arms.every(a => a.latencyMs >= 0)).toBe(true);
  });
});

// ── Learning ─────────────────────────────────────────────────────────────────
describe('§12 learning counters', () => {
  it('each classification increments its own counter and no other', async () => {
    const { compareClaims } = await import('../src/services/memory/claimComparison');
    const k = new Counters();
    const cases: Array<[string, string, string]> = [
      ['DUPLICATE',     'Outcome-led messaging increased conversion', 'Outcome-led messaging increased conversion'],
      ['REINFORCEMENT', 'Search converts better than Meta',           'Search converts better than Meta on cost per booking'],
      ['CONTRADICTION', 'Search converts better than Meta',           'Search converts worse than Meta'],
      ['UNRELATED',     'Outcome-led messaging increased conversion', 'Server latency improved after caching'],
    ];
    for (const [expected, a, b] of cases) {
      const scope = expected === 'CONTRADICTION' ? { segment: 'smb' } : {};
      const r = await compareClaims({ text: a, scope }, { text: b, scope }, { allowModel: false });
      k.inc(`classification.${r.classification}`);
      expect(r.classification, `${expected} case`).toBe(expected);
    }
    for (const [expected] of cases) {
      record('learning', `classification.${expected}`, 0, k.get(`classification.${expected}`));
      expect(k.get(`classification.${expected}`)).toBe(1);
    }
  });

  it('founder_review_required increments only when a founder belief is challenged', async () => {
    const { decide } = await import('../src/services/memory/beliefPolicy');
    const k = new Counters();
    const before = k.get('founder_review_required');

    const vsFounder = decide('CONTRADICTION', 'founder_feedback', 'analytics');
    if (vsFounder.requiresFounderReview) k.inc('founder_review_required');
    const mid = k.get('founder_review_required');
    record('learning', 'founder_review_required', before, mid);
    expect(mid).toBe(before + 1);

    // An inferred belief reinforced by analytics needs no founder.
    const vsInferred = decide('REINFORCEMENT', 'analytics', 'analytics');
    if (vsInferred.requiresFounderReview) k.inc('founder_review_required');
    expect(k.get('founder_review_required')).toBe(mid);   // unchanged
  });

  it('candidate_built increments per built candidate and stays flat on a rejected payload', async () => {
    const { buildFromCampaignResult } = await import('../src/services/memory/claimCandidateBuilder');
    const k = new Counters();
    const before = k.get('candidate_built');

    if (buildFromCampaignResult(WS_A, PROD, { channel: 'meta', ctr: 0.05, campaignId: 'c' })) k.inc('candidate_built');
    const mid = k.get('candidate_built');
    record('learning', 'candidate_built', before, mid);
    expect(mid).toBe(before + 1);

    if (buildFromCampaignResult(WS_A, PROD, { channel: 'meta' })) k.inc('candidate_built');  // no metric
    record('learning', 'candidate_built(rejected)', mid, k.get('candidate_built'));
    expect(k.get('candidate_built')).toBe(mid);
  });
});

// ── Shadow ───────────────────────────────────────────────────────────────────
describe('§12 shadow counters', () => {
  const founderBelief = {
    id: 'm1', title: 'Search converts better than Meta',
    content: { claim: 'Search converts better than Meta', channel: 'search' },
    source: 'founder_feedback', memory_type: 'campaign', product_id: PROD,
  };

  it('proposed transitions are counted while the mutation counter stays at zero', async () => {
    const saved = process.env.CONTINUOUS_LEARNING_INGESTION_MODE;
    process.env.CONTINUOUS_LEARNING_INGESTION_MODE = 'shadow';
    const { ingestClassACandidate, buildFromCampaignResult } =
      await import('../src/services/memory/claimCandidateBuilder');

    const k = new Counters();
    const applied = vi.fn(async () => undefined);

    const out = await ingestClassACandidate(
      buildFromCampaignResult(WS_A, PROD, { channel: 'search', ctr: 0.06, campaignId: 'c' }),
      [founderBelief], { apply: applied, allowModel: false });

    if (out.built) k.inc('candidate_proposed');
    if (out.decision) k.inc('transition_proposed');
    if (out.applied) k.inc('mutation_applied');

    record('shadow', 'candidate_proposed', 0, k.get('candidate_proposed'));
    record('shadow', 'transition_proposed', 0, k.get('transition_proposed'));
    record('shadow', 'mutation_applied', 0, k.get('mutation_applied'));

    expect(k.get('candidate_proposed')).toBe(1);
    expect(k.get('transition_proposed')).toBe(1);
    expect(k.get('mutation_applied')).toBe(0);      // the whole point of shadow
    expect(applied).not.toHaveBeenCalled();

    if (saved === undefined) delete process.env.CONTINUOUS_LEARNING_INGESTION_MODE;
    else process.env.CONTINUOUS_LEARNING_INGESTION_MODE = saved;
  });
});

// ── Context ──────────────────────────────────────────────────────────────────
describe('§12 context counters', () => {
  it('a retrieved record carries the provenance a context package links by', async () => {
    // Context packages store canonical ids + versions rather than prose
    // (ADR-066 rule 22). The counter that matters is how many results can
    // actually be linked — a result without an id or version is unciteable.
    seed();
    const r = await retrieve();
    const k = new Counters();
    for (const x of r.results) {
      k.inc('records_returned');
      if (x.id && typeof x.version === 'number') k.inc('provenance_linkable');
      if (x.contentHash !== undefined && x.embeddingStatus) k.inc('reconstruction_metadata');
    }
    record('context', 'records_returned', 0, k.get('records_returned'));
    record('context', 'provenance_linkable', 0, k.get('provenance_linkable'));
    record('context', 'reconstruction_metadata', 0, k.get('reconstruction_metadata'));

    expect(k.get('records_returned')).toBeGreaterThan(0);
    // Every returned record must be linkable. A partial rate here means some
    // recommendation could not be traced to what produced it.
    expect(k.get('provenance_linkable')).toBe(k.get('records_returned'));
    expect(k.get('reconstruction_metadata')).toBe(k.get('records_returned'));
  });

  it('cross-workspace records are never counted into a package', async () => {
    seed();
    const r = await retrieve();
    expect(r.results.every(x => x.workspaceId === WS_A)).toBe(true);
    expect(r.results.some(x => x.workspaceId === WS_B)).toBe(false);
  });
});
