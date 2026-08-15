/**
 * @file unresolvedFounderGuard.test.ts
 * @description THE P0 GATE for unresolved founder conflicts vs durable promotion.
 *
 *   THE INVARIANT: if a candidate has ANY unresolved founder-tier conflict, it
 *   may not perform ANY unreviewed durable positive belief transition.
 *
 *   MEASURED DEFECT (independent review): the first version of this guard lived
 *   INSIDE the DUPLICATE/REINFORCEMENT branch, so it protected exactly one
 *   outcome. A candidate could therefore SUPERSEDE — durably retire — another
 *   memory while a founder relationship about that same candidate sat
 *   unclassified because the model budget ran out or the provider was down.
 *   Classifying all seven PROMOTION_OUTCOMES from their return sites showed
 *   CREATE_SCOPED_EXCEPTION was exposed the same way.
 *
 *   These tests drive the real exported decidePromotion(). The guard is NOT
 *   reimplemented here; a helper that recomputed the risk ordering or the
 *   founder-conflict predicate would certify the helper and not the code path.
 *
 * @security Proves budget exhaustion and provider outage cannot become licence
 *   to mutate durable belief behind the founder's back.
 * @dependencies memoryPromotionPolicy (real Gate B)
 */

import { describe, it, expect } from 'vitest';
import {
  decidePromotion, PROMOTION_OUTCOMES,
  type ComparedMemory, type PromotionInput, type PromotionOutcome,
} from '../src/services/memory/memoryPromotionPolicy';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';

const norm = normalizeMemoryScope({ channel: 'meta' });
/** Strictly narrower than `norm` — drives the scoped-exception branch. */
const narrower = normalizeMemoryScope({ channel: 'meta', audience_segment: 'enterprise' });

let seq = 0;
function mem(over: Partial<ComparedMemory> = {}): ComparedMemory {
  seq++;
  return {
    memoryId: `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`,
    version: 1,
    scope: norm.scope,
    scopeKey: norm.scopeKey,
    memoryClass: 'LEARNING',
    authorityTier: 'OBSERVED_FIRST_PARTY',
    source: 'growth_brain',
    isLegacy: false,
    status: 'active',
    confidence: 0.5,
    classification: 'REINFORCEMENT',
    decidedBy: 'model_assisted',
    finalRank: seq,
    existingIndependenceKeys: [],
    ...over,
  };
}

/** A founder-tier incumbent that was nominated but never classified. */
const unresolvedFounder = (decidedBy: ComparedMemory['decidedBy']) => mem({
  classification: null, decidedBy,
  authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap',
});

function run(related: ComparedMemory[], over: Partial<PromotionInput> = {}) {
  return decidePromotion({
    memoryClass: 'LEARNING',
    authorityTier: 'EXPERIMENT_CONTROLLED',
    candidateSource: 'experiment',
    scope: norm.scope,
    scopeKey: norm.scopeKey,
    evidenceIndependenceKeys: ['ev:a', 'ev:b'],
    related,
    ...over,
  });
}

/** Outcomes that durably establish, strengthen or retire a belief. */
const DURABLE: PromotionOutcome[] = ['REINFORCE', 'SUPERSEDE', 'CREATE_SCOPED_EXCEPTION', 'CREATE_NEW'];
const isSafe = (o: PromotionOutcome) => !DURABLE.includes(o);

describe('unresolved founder conflict blocks durable promotion (P0)', () => {
  it('THE CODEX FINDING — SUPERSEDE is withheld while a founder pair is unresolved', () => {
    const r = run([
      // Weaker non-founder incumbent an EXPERIMENT_CONTROLLED candidate may supersede.
      mem({ finalRank: 1, classification: 'CONTRADICTION',
            authorityTier: 'DERIVED_INFERENCE', source: 'growth_brain' }),
      // Separate founder relationship, never classified — budget ran out.
      unresolvedFounder('skipped_budget'),
    ]);
    expect(r.outcome).not.toBe('SUPERSEDE');
    expect(isSafe(r.outcome)).toBe(true);
    expect(r.requiresFounderReview).toBe(true);
    expect(r.beliefAction).not.toBe('supersede');
  });

  it('CREATE_SCOPED_EXCEPTION is withheld the same way', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'CONTRADICTION',
            scope: { ...norm.scope }, authorityTier: 'DERIVED_INFERENCE', source: 'growth_brain' }),
      unresolvedFounder('skipped_budget'),
    ], { scope: narrower.scope, scopeKey: narrower.scopeKey });
    expect(r.outcome).not.toBe('CREATE_SCOPED_EXCEPTION');
    expect(isSafe(r.outcome)).toBe(true);
  });

  it('MODEL_UNAVAILABLE on the founder relationship blocks promotion', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'CONTRADICTION',
            authorityTier: 'DERIVED_INFERENCE', source: 'growth_brain' }),
      unresolvedFounder('unavailable'),
    ]);
    expect(isSafe(r.outcome)).toBe(true);
    expect(r.requiresFounderReview).toBe(true);
  });

  it('BUDGET-SKIPPED founder relationship blocks REINFORCE', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      unresolvedFounder('skipped_budget'),
    ]);
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(r.reasonCode).toBe('UNRESOLVED_FOUNDER_CONFLICT');
  });

  it('TABLE — no durable positive outcome survives an unresolved founder conflict', () => {
    const shapes: Array<[string, ComparedMemory[], Partial<PromotionInput>]> = [
      ['reinforcement', [mem({ classification: 'REINFORCEMENT' })], {}],
      ['duplicate', [mem({ classification: 'DUPLICATE' })], {}],
      ['supersede', [mem({ classification: 'CONTRADICTION',
        authorityTier: 'DERIVED_INFERENCE', source: 'growth_brain' })], {}],
      ['scoped exception', [mem({ classification: 'CONTRADICTION',
        authorityTier: 'DERIVED_INFERENCE', source: 'growth_brain' })],
        { scope: narrower.scope, scopeKey: narrower.scopeKey }],
      ['create new (all unrelated)', [mem({ classification: 'UNRELATED' })], {}],
    ];
    for (const [name, related, over] of shapes) {
      const r = run([...related, unresolvedFounder('skipped_budget')],
        { ...over, unresolvedComparisons: 1 });
      expect(isSafe(r.outcome), `${name} produced durable ${r.outcome}`).toBe(true);
    }
  });

  it('every durable outcome in PROMOTION_OUTCOMES is accounted for', () => {
    // If a new outcome is added, this fails until it is classified as durable or safe.
    const known: PromotionOutcome[] = [
      ...DURABLE, 'CHALLENGE', 'NO_OP', 'KEEP_AS_EVIDENCE_ONLY',
    ];
    expect([...PROMOTION_OUTCOMES].sort()).toEqual(known.sort());
  });
});

describe('normal-case controls — the guard must not over-block', () => {
  it('A — no unresolved founder conflict: SUPERSEDE still works', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'CONTRADICTION',
            authorityTier: 'DERIVED_INFERENCE', source: 'growth_brain' }),
    ]);
    expect(r.outcome).toBe('SUPERSEDE');
  });

  it('B — RESOLVED founder agreement: REINFORCE still works', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
    ]);
    expect(r.outcome).toBe('REINFORCE');
  });

  it('C — unresolved NON-founder relationship does not blanket-block', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 2, classification: null, decidedBy: 'skipped_budget',
            authorityTier: 'OBSERVED_FIRST_PARTY' }),
    ]);
    expect(r.outcome).toBe('REINFORCE');
  });

  it('D — a definitively classified founder contradiction keeps CHALLENGE', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'CONTRADICTION',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
    ]);
    expect(r.outcome).toBe('CHALLENGE');
    expect(r.requiresFounderReview).toBe(true);
  });

  it('E — an unresolved LEGACY founder-ish row keeps the legacy quarantine path', () => {
    const r = run([
      mem({ finalRank: 1, classification: null, decidedBy: 'skipped_budget',
            isLegacy: true, memoryClass: null }),
    ]);
    expect(isSafe(r.outcome)).toBe(true);
  });
});
