/**
 * @file founderBootstrapGovernance.test.ts
 * @description Founder onboarding context is admitted as GOVERNED memory.
 * @security Unconfirmed AI-prefilled values must never become founder memory.
 * @dependencies founderBootstrapPolicy
 */
import { describe, it, expect } from 'vitest';
import {
  admitFounderBootstrap, bootstrapIdempotencyKey, BOOTSTRAP_CLASS,
  UNMEASURED_FOUNDER_ASSERTION, BOOTSTRAP_SOURCE, type FounderBootstrapCandidate,
} from '../src/services/memory/founderBootstrapPolicy';

const base = (over: Partial<FounderBootstrapCandidate> = {}): FounderBootstrapCandidate => ({
  workspaceId: 'ws-1', productId: 'p-1', founderId: 'f-1',
  category: 'audience',
  title: 'Primary audience confirmed during onboarding',
  content: { audienceConfirmed: 'independent home-service providers' },
  sourceRef: { table: 'founder_context', rowId: 'fc-1', field: 'audience_confirmed' },
  founderConfirmed: true,
  ...over,
});

describe('governed founder bootstrap', () => {
  it('admits founder-confirmed context with FULL governance — no NULL discriminator', () => {
    const a = admitFounderBootstrap(base());
    expect(a.admit).toBe(true);
    const r = a.row!;
    expect(r.memory_class).toBe('FACT');
    expect(r.authority_tier).toBe('FOUNDER_ASSERTED');
    expect(r.authority_policy_version).toBeTypeOf('number');
    expect(r.confidence_policy_version).toBeTypeOf('number');
    expect(r.source).toBe(BOOTSTRAP_SOURCE);
    expect(r.scope_key).toBeTruthy();
    expect(r.status).toBe('active');
    for (const f of ['memory_class', 'authority_tier', 'authority_policy_version', 'scope_key']) {
      expect(r[f]).not.toBeNull();
    }
  });

  it('carries reconstructible provenance to the canonical row', () => {
    const r = admitFounderBootstrap(base()).row!;
    expect((r.content as Record<string, unknown>).sourceRef)
      .toEqual({ table: 'founder_context', rowId: 'fc-1', field: 'audience_confirmed' });
  });

  it('REFUSES AI-prefilled values the founder never confirmed', () => {
    const a = admitFounderBootstrap(base({ founderConfirmed: false }));
    expect(a.admit).toBe(false);
    expect(a.reason).toMatch(/not explicitly entered or confirmed/);
  });

  it('confidence is a declared constant, not a fabricated gradient and not 1.0', () => {
    const cats: Array<FounderBootstrapCandidate['category']> = ['audience', 'context_delta', 'goal', 'competitors'];
    const values = cats.map(category => admitFounderBootstrap(base({
      category, content: { v: 'something substantive enough to admit' },
    })).row!.confidence);
    expect(new Set(values).size).toBe(1);                       // no per-category gradient
    expect(values[0]).toBe(UNMEASURED_FOUNDER_ASSERTION);
    expect(values[0]).not.toBe(1.0);                            // authority ≠ certainty
    expect([0.8, 0.85, 0.9, 0.95]).not.toContain(values[0]);    // the old decorative values are gone
  });

  it('class is chosen by SEMANTICS, not by who said it', () => {
    expect(BOOTSTRAP_CLASS.audience).toBe('FACT');       // who customers ARE, not an instruction
    expect(BOOTSTRAP_CLASS.context_delta).toBe('FACT');
    expect(BOOTSTRAP_CLASS.goal).toBe('DECISION');       // a chosen objective
    expect(BOOTSTRAP_CLASS.competitors).toBe('FACT');
    expect(Object.values(BOOTSTRAP_CLASS)).not.toContain('DIRECTIVE');
  });

  it('IDEMPOTENT: identity is the source row, so replay cannot duplicate', () => {
    const a = bootstrapIdempotencyKey(base());
    const b = bootstrapIdempotencyKey(base({ title: 'reworded title' }));
    expect(a).toBe(b);                                   // wording is not identity
    const c = bootstrapIdempotencyKey(base({ sourceRef: { table: 'founder_context', rowId: 'fc-2', field: 'audience_confirmed' } }));
    expect(c).not.toBe(a);                               // a different source row is a different memory
  });

  it('refuses when workspace or founder attribution is missing', () => {
    expect(admitFounderBootstrap(base({ workspaceId: '' })).admit).toBe(false);
    expect(admitFounderBootstrap(base({ founderId: '' })).admit).toBe(false);
  });

  it('refuses empty content rather than writing a hollow memory', () => {
    expect(admitFounderBootstrap(base({ content: {} })).admit).toBe(false);
  });
});
