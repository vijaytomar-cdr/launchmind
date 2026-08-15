/**
 * @file degradedRetrievalSafety.test.ts
 * @description THE DEGRADATION DRILL — every mode in which retrieval can fail,
 *   against a known incumbent, proving no mode produces a blind CREATE_NEW.
 *
 *   THE MEASURED DEFECT THIS CLOSES:
 *     `comparisonUnavailable` was set only when retrieval THREW. A retrieval that
 *     merely degraded returned zero rows without throwing, and Gate B read that
 *     as "nothing related exists" → CREATE_NEW / NO_RELATED_MEMORY. Measured: 84
 *     such decisions against a corpus whose vectors did not exist.
 *
 *   THE INVARIANT UNDER TEST:
 *     Retrieval failure may reduce learning velocity.
 *     It must never increase memory fragmentation.
 *
 *   Presence-based outcomes are deliberately NOT blocked: finding a relation is
 *   positive evidence and stays valid on a partial search. Only the ABSENCE
 *   conclusion requires a trustworthy search.
 *
 * @security Pure policy evaluation. No DB, no network, no owner data.
 * @dependencies memoryPromotionPolicy
 */

import { describe, it, expect } from 'vitest';
import { decidePromotion, type PromotionInput, type ComparedMemory } from '../src/services/memory/memoryPromotionPolicy';

const base: PromotionInput = {
  memoryClass: 'LEARNING',
  authorityTier: 'OBSERVED_FIRST_PARTY',
  candidateSource: 'connection_insight',
  scope: { channel: 'meta' },
  scopeKey: 'a'.repeat(64),
  evidenceIndependenceKeys: ['k1', 'k2'],
  related: [],
};

/** A genuinely related incumbent that a healthy search would have found. */
const incumbent: ComparedMemory = {
  memoryId: 'm1', version: 1,
  scope: { channel: 'meta' }, scopeKey: 'a'.repeat(64),
  memoryClass: 'LEARNING', authorityTier: 'OBSERVED_FIRST_PARTY',
  source: 'analytics', isLegacy: false, status: 'active', confidence: 0.6,
  classification: 'REINFORCEMENT', decidedBy: 'deterministic', finalRank: 1,
  existingIndependenceKeys: ['k9'],
};

/** The seven degradation modes required by the drill. */
const MODES: Array<{ name: string; input: Partial<PromotionInput> }> = [
  { name: 'B lexical-only degradation',      input: { retrievalDegraded: true, retrievalDegradedReasons: ['SEMANTIC_ARM_UNAVAILABLE'] } },
  { name: 'C semantic provider unavailable', input: { retrievalDegraded: true, retrievalDegradedReasons: ['QUERY_EMBEDDING_FAILED'] } },
  { name: 'D semantic SQL failure',          input: { retrievalDegraded: true, retrievalDegradedReasons: ['SEMANTIC_SQL_FAILED'] } },
  { name: 'E zero embeddings',               input: { retrievalDegraded: true, retrievalDegradedReasons: ['NO_CORPUS_VECTORS'] } },
  { name: 'F stale embeddings',              input: { retrievalDegraded: true, retrievalDegradedReasons: ['STALE_VECTORS'] } },
  { name: 'G wrong dimension / contract',    input: { retrievalDegraded: true, retrievalDegradedReasons: ['CONTRACT_MISMATCH'] } },
  { name: 'retrieval threw',                 input: { comparisonUnavailable: true } },
];

describe('degraded retrieval never blind-creates', () => {
  it('A healthy retrieval with zero related still creates (control)', () => {
    const d = decidePromotion({ ...base, retrievalDegraded: false });
    expect(d.outcome).toBe('CREATE_NEW');
    expect(d.reasonCode).toBe('NO_RELATED_MEMORY');
  });

  for (const mode of MODES) {
    it(`${mode.name} → defers instead of creating`, () => {
      const d = decidePromotion({ ...base, ...mode.input });
      expect(d.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
      expect(['RETRIEVAL_DEGRADED', 'COMPARISON_UNAVAILABLE']).toContain(d.reasonCode);
      // The reason must name the degradation, so a deferral is explainable.
      expect(d.reason.length).toBeGreaterThan(20);
    });
  }

  it('degraded retrieval that DOES find a relation still acts on it', () => {
    // Presence is positive evidence; a partial search does not invalidate it.
    const d = decidePromotion({
      ...base, retrievalDegraded: true, retrievalDegradedReasons: ['SEMANTIC_ARM_UNAVAILABLE'],
      related: [incumbent],
    });
    expect(d.outcome).not.toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(d.outcome).toBe('REINFORCE');
  });

  it('degraded retrieval where everything compared is UNRELATED still defers', () => {
    // "All unrelated" is also an absence conclusion, and equally untrustworthy
    // when the arm that would have found the real match did not run.
    const d = decidePromotion({
      ...base, retrievalDegraded: true, retrievalDegradedReasons: ['NO_CORPUS_VECTORS'],
      related: [{ ...incumbent, classification: 'UNRELATED' }],
    });
    expect(d.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(d.reasonCode).toBe('RETRIEVAL_DEGRADED');
  });

  it('REPLAY UNDER OUTAGE: repeated candidates create zero durable memories', () => {
    // What active mode would do during a provider outage. Every replay must
    // defer; none may create, or an outage becomes a duplicate generator.
    const outcomes = Array.from({ length: 25 }, () =>
      decidePromotion({ ...base, retrievalDegraded: true, retrievalDegradedReasons: ['QUERY_EMBEDDING_FAILED'] }).outcome);
    expect(new Set(outcomes)).toEqual(new Set(['KEEP_AS_EVIDENCE_ONLY']));
    expect(outcomes.filter(o => o === 'CREATE_NEW')).toHaveLength(0);
  });

  it('an unresolved comparison still defers (pre-existing rule, unchanged)', () => {
    // The incumbent must be UNRELATED, not REINFORCEMENT: a decisive
    // presence-based outcome is resolved first and correctly wins. The
    // unresolved rule is the fallthrough for when nothing decisive was found.
    const d = decidePromotion({
      ...base,
      related: [{ ...incumbent, classification: 'UNRELATED' }],
      unresolvedComparisons: 1,
    });
    expect(d.outcome).toBe('KEEP_AS_EVIDENCE_ONLY');
    expect(d.reasonCode).toBe('COMPARISON_DEFERRED_UNRESOLVED');
  });
});
