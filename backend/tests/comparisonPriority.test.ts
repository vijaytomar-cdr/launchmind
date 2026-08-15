/**
 * @file comparisonPriority.test.ts
 * @description THE P0 GATE for risk-ordered promotion under a capped budget.
 *
 *   MEASURED DEFECT (q25): Gate B evaluated related memories in RETRIEVAL-RANK
 *   order and returned on the first actionable classification. The real q25
 *   comparison set was:
 *
 *     rank 1  OBSERVED_FIRST_PARTY  REINFORCEMENT
 *     rank 2  FOUNDER_ASSERTED      CONTRADICTION   <- never reached
 *     rank 3  OBSERVED_FIRST_PARTY  UNRELATED
 *
 *   The founder-conflicting pair WAS compared and WAS correctly classified. The
 *   loop simply returned REINFORCE first, so a claim inverting a founder belief
 *   raised that belief's confidence with no founder review.
 *
 *   NOTE ON THE ORIGINAL HYPOTHESIS: this was diagnosed — by me, in the previous
 *   pass — as the model budget spending its three slots in rank order. Tracing
 *   the production engine disproved that: the founder pair occupied slot 1 of 3
 *   and returned CONTRADICTION. The budget was never the problem. Tests are
 *   written against the mechanism that was measured, not the one assumed.
 *
 * @security Proves a founder belief cannot be silently reinforced by an
 *   inverting claim, and that an UNCOMPARED founder pair cannot be read as
 *   clearance to reinforce.
 * @dependencies memoryPromotionPolicy (real Gate B)
 */

import { describe, it, expect } from 'vitest';
import {
  decidePromotion, type ComparedMemory, type PromotionInput,
} from '../src/services/memory/memoryPromotionPolicy';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';

const norm = normalizeMemoryScope({ channel: 'meta' });

let seq = 0;
/** One compared incumbent. `rank` is its retrieval position. */
function mem(over: Partial<ComparedMemory> = {}): ComparedMemory {
  seq++;
  return {
    memoryId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
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

function run(related: ComparedMemory[], over: Partial<PromotionInput> = {}) {
  return decidePromotion({
    memoryClass: 'LEARNING',
    authorityTier: 'OBSERVED_FIRST_PARTY',
    candidateSource: 'growth_brain',
    scope: norm.scope,
    scopeKey: norm.scopeKey,
    evidenceIndependenceKeys: ['ev:a'],
    related,
    ...over,
  });
}

describe('Gate B — comparison priority under a capped budget (P0)', () => {
  it('CASE A — q25 shape: a founder CONTRADICTION below a REINFORCEMENT still decides', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 2, classification: 'CONTRADICTION',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
      mem({ finalRank: 3, classification: 'UNRELATED' }),
    ]);
    expect(r.outcome).not.toBe('REINFORCE');
    expect(r.outcome).toBe('CHALLENGE');
    expect(r.requiresFounderReview).toBe(true);
  });

  it('CASE A2 — a contradiction ranked LAST still decides', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 2, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 3, classification: 'DUPLICATE' }),
      mem({ finalRank: 4, classification: 'CONTRADICTION',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
    ]);
    expect(r.outcome).toBe('CHALLENGE');
  });

  it('CASE B — an ordinary (non-founder) contradiction also outranks a reinforcement', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 2, classification: 'CONTRADICTION' }),
    ]);
    expect(r.outcome).not.toBe('REINFORCE');
  });

  it('CASE C — no high-risk pair: retrieval order still decides, unchanged', () => {
    const first = mem({ finalRank: 1, classification: 'REINFORCEMENT' });
    const r = run([
      first,
      mem({ finalRank: 2, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 3, classification: 'DUPLICATE' }),
      mem({ finalRank: 4, classification: 'REINFORCEMENT' }),
    ]);
    expect(r.outcome).toBe('REINFORCE');
    // The rank-1 incumbent is the one reinforced — normal cases are not reordered.
    expect(r.targetMemoryId).toBe(first.memoryId);
  });

  it('CASE D — more high-risk pairs than budget: still decisive, still safe', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'CONTRADICTION' }),
      mem({ finalRank: 2, classification: 'CONTRADICTION',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
      mem({ finalRank: 3, classification: 'CONTRADICTION' }),
      mem({ finalRank: 4, classification: 'CONTRADICTION' }),
    ]);
    expect(['CHALLENGE', 'KEEP_AS_EVIDENCE_ONLY']).toContain(r.outcome);
    expect(r.outcome).not.toBe('REINFORCE');
    expect(r.outcome).not.toBe('SUPERSEDE');
  });

  it('CASE E — founder authority alone does NOT block a safe agreement', () => {
    // Risk comes from unresolved potential conflict, not from authority existing.
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
      mem({ finalRank: 2, classification: 'UNRELATED' }),
    ]);
    expect(r.outcome).toBe('REINFORCE');
  });
});

describe('Gate B — §7 overflow fail-safe: uncompared is not cleared', () => {
  it('an UNRESOLVED founder incumbent blocks a reinforcement', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      // Nominated, never classified — over budget or provider failure.
      mem({ finalRank: 2, classification: null, decidedBy: 'skipped_budget',
            authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }),
    ]);
    expect(r.outcome).not.toBe('REINFORCE');
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(r.reasonCode).toBe('UNRESOLVED_FOUNDER_CONFLICT');
    expect(r.requiresFounderReview).toBe(true);
  });

  it('the same applies when the comparison failed rather than being skipped', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'DUPLICATE' }),
      mem({ finalRank: 2, classification: null, decidedBy: 'unavailable',
            authorityTier: 'FOUNDER_CONFIRMED', source: 'founder_feedback' }),
    ]);
    expect(r.outcome).not.toBe('REINFORCE');
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
  });

  it('an unresolved NON-founder incumbent does not block (no blanket regression)', () => {
    const r = run([
      mem({ finalRank: 1, classification: 'REINFORCEMENT' }),
      mem({ finalRank: 2, classification: null, decidedBy: 'skipped_budget' }),
    ]);
    expect(r.outcome).toBe('REINFORCE');
  });
});
