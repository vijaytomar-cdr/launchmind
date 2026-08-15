/**
 * @file memoryGovernanceRemediation.test.ts
 * @description Locks the three 3.2A remediation blockers shut — B1 (under-
 *   matching / fragmentation), B2 (legacy quarantine), B3 (model deferral).
 *
 *   Each test corresponds to a defect that was MEASURED in the shadow
 *   observation, not one that was imagined. The comments say which.
 *
 * @security Contains the structural guard that stops the legacy quarantine from
 *   being bypassed by a future code path.
 * @dependencies memoryGovernancePolicy, memoryPromotionPolicy,
 *   candidateEligibilityPolicy
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  governMemoryEligibility, isLegacyMemory, mayBeTransitionTarget,
} from '../src/services/memory/memoryGovernancePolicy';
import { decidePromotion, type ComparedMemory } from '../src/services/memory/memoryPromotionPolicy';
import { evaluateCandidateEligibility } from '../src/services/memory/candidateEligibilityPolicy';

const WS = '7f000002-0000-4000-8000-00000000abcd';

function incumbent(over: Partial<ComparedMemory> = {}): ComparedMemory {
  return {
    memoryId: '11111111-1111-4111-8111-111111111111', version: 1,
    scope: { channel: 'google_ads' }, scopeKey: 'k1',
    memoryClass: 'LEARNING', authorityTier: 'OBSERVED_FIRST_PARTY',
    source: 'campaign_performance', isLegacy: false, status: 'active', confidence: 0.6,
    classification: 'DUPLICATE', decidedBy: 'deterministic', finalRank: 1,
    existingIndependenceKeys: ['src-a'],
    ...over,
  };
}

function promote(over: Parameters<typeof decidePromotion>[0] extends infer T ? Partial<T> : never = {}) {
  return decidePromotion({
    memoryClass: 'LEARNING', authorityTier: 'OBSERVED_FIRST_PARTY',
    candidateSource: 'campaign_performance',
    scope: { channel: 'google_ads' }, scopeKey: 'k1',
    evidenceIndependenceKeys: ['src-b'],
    related: [incumbent()],
    ...over,
  });
}

function gateA(over: Record<string, unknown> = {}) {
  return evaluateCandidateEligibility({
    workspaceId: WS, canonicalWorkspaceId: WS, productId: null,
    claimText: 'Search converts better than Meta on paid acquisition',
    memoryClass: 'LEARNING', authorityTier: 'OBSERVED_FIRST_PARTY',
    scope: { channel: 'google_ads' }, scopeCompleteness: 'partial',
    provenance: { kind: 'campaign_performance', sourceId: 's1' },
    actorType: 'system', evidenceIds: ['e1'], evidenceIndependenceKeys: ['src-a'],
    idempotencyKey: 'i1', sampleSize: 250, claimIsRuleGenerated: true,
    ...over,
  } as Parameters<typeof evaluateCandidateEligibility>[0]);
}

// ── B1 — an unresolved comparison is not a finding of "unrelated" ────────────
describe('B1 · unresolved comparisons cannot license a new memory', () => {
  // MEASURED: all three near-duplicate paraphrases nominated the correct
  // incumbent at rank 1 with scope `same`, the comparator deferred, the model
  // was disabled, and Gate B created a new memory anyway.
  it('returns KEEP_AS_EVIDENCE_ONLY when a nominated memory was never classified', () => {
    const r = promote({
      related: [incumbent({ classification: null, decidedBy: 'unavailable' })],
      unresolvedComparisons: 1,
    });
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(r.reasonCode).toBe('COMPARISON_DEFERRED_UNRESOLVED');
  });

  it('still creates when every nominated memory was positively classified UNRELATED', () => {
    const r = promote({
      related: [incumbent({ classification: 'UNRELATED' })],
      unresolvedComparisons: 0,
    });
    expect(r.outcome).toBe('CREATE_NEW');
  });

  it('a resolved relationship decides even when another comparison is unresolved', () => {
    // The guard must not block a decision the system genuinely reached.
    const r = promote({
      related: [
        incumbent({ classification: 'REINFORCEMENT', finalRank: 1 }),
        incumbent({ memoryId: '22222222-2222-4222-8222-222222222222',
                    classification: null, decidedBy: 'unavailable', finalRank: 2 }),
      ],
      unresolvedComparisons: 1,
    });
    expect(r.outcome).toBe('REINFORCE');
  });

  it('a provider outage is not silently treated as "nothing related"', () => {
    const r = promote({ related: [incumbent({ classification: 'UNRELATED' })], comparisonUnavailable: true });
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
  });
});

// ── B2 — legacy quarantine ──────────────────────────────────────────────────
describe('B2 · legacy quarantine', () => {
  const legacy = (over: Partial<ComparedMemory> = {}) =>
    incumbent({ isLegacy: true, memoryClass: null, scope: {}, scopeKey: null, ...over });

  it.each([
    ['reinforcement', 'REINFORCEMENT'],
    ['contradiction', 'CONTRADICTION'],
    ['duplicate',     'DUPLICATE'],
  ] as const)('never transitions a legacy row on %s', (_label, classification) => {
    const r = promote({ related: [legacy({ classification })] });
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(r.reasonCode).toBe('LEGACY_UNSCOPED_INCUMBENT');
  });

  // MEASURED: this is the case that made quarantine 2/4. An unresolved
  // comparison against a legacy row was skipped by the same branch as
  // UNRELATED, so the candidate fell through to CREATE_NEW.
  it('quarantines a legacy row the comparator could not classify', () => {
    const r = promote({ related: [legacy({ classification: null, decidedBy: 'unavailable' })] });
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(r.reasonCode).toBe('LEGACY_UNSCOPED_INCUMBENT');
  });

  it('a legacy row positively found UNRELATED does not block an unrelated creation', () => {
    const r = promote({ related: [legacy({ classification: 'UNRELATED' })], unresolvedComparisons: 0 });
    expect(r.outcome).toBe('CREATE_NEW');
  });

  it('a legacy row can never be a scoped-exception parent', () => {
    // Narrower candidate scope against an unscoped legacy row: the tempting
    // reading is "exception", but nobody knows what the legacy row applies to.
    const r = promote({
      scope: { channel: 'google_ads', geography: 'usa' },
      related: [legacy({ classification: 'CONTRADICTION' })],
    });
    expect(r.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(r.exceptionToMemoryId).toBeNull();
  });

  it('governs by intent: readable and comparable, never transitionable', () => {
    const row = { memoryClass: null };
    expect(governMemoryEligibility(row, 'NOMINATE').permitted).toBe(true);
    expect(governMemoryEligibility(row, 'COMPARE').permitted).toBe(true);
    expect(governMemoryEligibility(row, 'DIAGNOSTIC').permitted).toBe(true);
    expect(governMemoryEligibility(row, 'TRANSITION').permitted).toBe(false);
    expect(mayBeTransitionTarget(row)).toBe(false);
    expect(mayBeTransitionTarget({ memoryClass: 'LEARNING' })).toBe(true);
  });

  it('treats an absent class the same as an explicit null', () => {
    expect(isLegacyMemory({})).toBe(true);
    expect(isLegacyMemory({ memoryClass: null })).toBe(true);
    expect(isLegacyMemory({ memoryClass: 'FACT' })).toBe(false);
  });
});

// ── §8 — structural: the quarantine cannot be bypassed ──────────────────────
describe('§8 · one canonical legacy-governance check', () => {
  it('no memory service re-derives the legacy discriminator inline', () => {
    // The rule lived inline in Gate B and could only fire post-classification.
    // If a future path re-derives it, this fails rather than silently regressing.
    const dir = join(__dirname, '../src/services/memory');
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name === 'memoryGovernancePolicy.ts') continue;   // the one home
        for (const [i, line] of readFileSync(p, 'utf-8').split('\n').entries()) {
          if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
          // `!x.memory_class`, `memory_class === null`, `memoryClass == null`
          if (/!\s*\w+[?.]*\.memory_?[Cc]lass\b/.test(line)
              || /memory_?[Cc]lass\s*[=!]==?\s*null/.test(line)) {
            offenders.push(`${entry.name}:${i + 1}: ${line.trim().slice(0, 70)}`);
          }
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});

// ── B3 / safety — founder authority cannot be narrowed automatically ────────
describe('founder authority', () => {
  // MEASURED: automated campaign evidence proposed a scoped exception to a
  // FOUNDER_ASSERTED DIRECTIVE, which would erode a founder directive one
  // narrow scope at a time without the founder ever being asked.
  it('a scoped exception to a founder memory becomes a CHALLENGE', () => {
    const r = promote({
      scope: { channel: 'meta', geography: 'usa' },
      authorityTier: 'OBSERVED_FIRST_PARTY',
      related: [incumbent({
        classification: 'CONTRADICTION', scope: { channel: 'meta' },
        memoryClass: 'DIRECTIVE', authorityTier: 'FOUNDER_ASSERTED', source: 'founder_feedback',
      })],
    });
    expect(r.outcome).toBe('CHALLENGE');
    expect(r.requiresFounderReview).toBe(true);
  });

  it('a scoped exception between equal automated authorities is still permitted', () => {
    const r = promote({
      scope: { channel: 'google_ads', geography: 'usa' },
      related: [incumbent({ classification: 'CONTRADICTION', scope: { channel: 'google_ads' } })],
    });
    expect(r.outcome).toBe('CREATE_SCOPED_EXCEPTION');
  });

  it('every CHALLENGE requires founder review', () => {
    // A CHALLENGE means no authority rule could settle it — so nothing else can.
    const r = promote({
      related: [incumbent({ classification: 'CONTRADICTION' })],
    });
    expect(r.outcome).toBe('CHALLENGE');
    expect(r.requiresFounderReview).toBe(true);
  });
});

// ── Gate A defects found by the observation ─────────────────────────────────
describe('Gate A · measured defects', () => {
  it('rejects a percentage-shaped bare metric', () => {
    // METRIC_NOUN ended in \b after `%`; between `%` and a space there is no
    // word boundary, so no percentage metric had ever matched.
    const r = gateA({ claimText: '3.2% click-through for the meta channel' });
    expect(r.result).toBe('EVIDENCE_ONLY');
    expect(r.reason).toBe('NOT_GENERAL');
  });

  it('still admits a general finding that happens to be quantified', () => {
    const r = gateA({ claimText: 'Search increased conversion by 41% versus Meta across paid channels' });
    expect(r.result).toBe('ELIGIBLE');
  });

  it('admits a founder DECISION that states a horizon', () => {
    // TEMPORARY_PATTERNS fired before the DECISION rule, and the two rules
    // contradicted: one requires a horizon, the other rejected any.
    const r = gateA({
      claimText: 'We will prioritise retention over acquisition this quarter',
      memoryClass: 'DECISION', authorityTier: 'FOUNDER_ASSERTED', actorType: 'founder',
    });
    expect(r.result).toBe('ELIGIBLE');
  });

  it('still rejects a horizon-bearing LEARNING as not durable', () => {
    const r = gateA({ claimText: 'Meta performs better this quarter than last' });
    expect(r.result).toBe('EVIDENCE_ONLY');
    expect(r.reason).toBe('NOT_DURABLE');
  });
});
