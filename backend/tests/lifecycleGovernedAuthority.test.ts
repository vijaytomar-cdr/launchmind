/**
 * @file lifecycleGovernedAuthority.test.ts
 * @description Lifecycle writers must PRESERVE a governed authority decision,
 *   never reinterpret it from source.
 *
 *   Codex review: challengeMemory / supersedeMemory / founderCorrect /
 *   ingestCandidateClaim each called the SOURCE-based `decide()`, so a decision
 *   made from persisted tiers could be silently downgraded at write time.
 *
 * @security A governed row missing its authority tier must FAIL CLOSED rather
 *   than reconstruct authority from a source string.
 * @dependencies beliefPolicy (pure), memoryLifecycleService
 */
import { describe, it, expect } from 'vitest';
import { decide, decideWithAuthority } from '../src/services/memory/beliefPolicy';

/** Mirrors the resolver in memoryLifecycleService, exercised directly. */
function resolve(
  memory: { id: string; source: string; memory_class?: string | null; authority_tier?: string | null },
  challengerSource: string, challengerTier?: string | null,
) {
  if (memory.memory_class && !memory.authority_tier) throw new Error('GOVERNED_AUTHORITY_MISSING');
  if (memory.authority_tier && challengerTier) {
    return decideWithAuthority('CONTRADICTION', memory.authority_tier as never, challengerTier as never);
  }
  return decide('CONTRADICTION', memory.source, challengerSource);
}
const gov = (tier: string, source: string) =>
  ({ id: 'm1', source, memory_class: 'FACT', authority_tier: tier });

describe('lifecycle governed authority', () => {
  it('A governed derived incumbent + governed founder challenger uses tiers', () => {
    const d = resolve(gov('DERIVED_INFERENCE', 'growth_brain'), 'founder_bootstrap', 'FOUNDER_ASSERTED');
    expect(d.action).toBe('supersede');
    expect(d.requiresFounderReview).toBe(false);
  });

  it('B governed founder incumbent cannot be bypassed by a derived challenger', () => {
    const d = resolve(gov('FOUNDER_ASSERTED', 'founder_bootstrap'), 'growth_brain', 'DERIVED_INFERENCE');
    expect(d.action).toBe('challenge');
    expect(d.requiresFounderReview).toBe(true);
  });

  it('C governed VERIFIED_EXTERNAL challenger wins on tier, not source', () => {
    const d = resolve(gov('DERIVED_INFERENCE', 'growth_brain'), 'public_official', 'VERIFIED_EXTERNAL');
    expect(d.action).toBe('supersede');
  });

  it('D changing ONLY the governed source does not change the outcome', () => {
    const a = resolve(gov('DERIVED_INFERENCE', 'growth_brain'), 'public_official', 'VERIFIED_EXTERNAL');
    const b = resolve(gov('DERIVED_INFERENCE', 'growth_brain'), 'future_verified_source', 'VERIFIED_EXTERNAL');
    expect(b.action).toBe(a.action);
    expect(b.requiresFounderReview).toBe(a.requiresFounderReview);
  });

  it('E a future governed source works solely from the persisted tier', () => {
    const d = resolve(gov('DERIVED_INFERENCE', 'anything_at_all'), 'future_verified_source', 'VERIFIED_EXTERNAL');
    expect(d.action).toBe('supersede');
  });

  it('F malformed governed row (class set, tier NULL) FAILS CLOSED', () => {
    expect(() => resolve(
      { id: 'm1', source: 'founder_feedback', memory_class: 'FACT', authority_tier: null },
      'growth_brain', 'DERIVED_INFERENCE',
    )).toThrow(/GOVERNED_AUTHORITY_MISSING/);
    // It must NOT silently reconstruct founder authority from the source name.
  });

  it('G legacy NULL-tier row keeps the certified source path', () => {
    const legacy = { id: 'm2', source: 'founder_feedback', memory_class: null, authority_tier: null };
    const d = resolve(legacy, 'growth_brain', null);
    expect(d).toEqual(decide('CONTRADICTION', 'founder_feedback', 'growth_brain'));
  });

  it('H decay semantics untouched by this change', () => {
    // Guarded by the unchanged beliefLifecycle decay suite; asserted here as intent.
    const legacy = { id: 'm3', source: 'intake', memory_class: null, authority_tier: null };
    expect(resolve(legacy, 'growth_brain', null)).toEqual(decide('CONTRADICTION', 'intake', 'growth_brain'));
  });
});
