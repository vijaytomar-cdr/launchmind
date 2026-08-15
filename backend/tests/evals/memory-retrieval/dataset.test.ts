/**
 * @file dataset.test.ts
 * @description Integrity guard for the retrieval evaluation dataset.
 *
 *   Runs in the normal suite and needs no database. Its job is to stop the
 *   benchmark rotting silently: a label pointing at a fixture that no longer
 *   exists would quietly count as a permanent miss, making the baseline look
 *   worse — or, after 3.1D, making the hybrid retriever look better than it is.
 *   Either way the comparison the ADR depends on would be invalid.
 *
 * @security No I/O.
 * @dependencies dataset.ts, fixtures.ts, metrics.ts
 */

import { describe, it, expect } from 'vitest';
import { DATASET, CATEGORY_COUNTS } from './dataset';
import { FIXTURE_IDS, MEMORIES, FOUNDER_A, FOUNDER_B, assertLocalTarget } from './fixtures';
import { percentile, terms } from './metrics';

describe('retrieval eval dataset', () => {
  it('has enough queries to be meaningful (25-40 per Step 3.1A)', () => {
    expect(DATASET.length).toBeGreaterThanOrEqual(25);
    expect(DATASET.length).toBeLessThanOrEqual(40);
  });

  it('has unique query ids', () => {
    const ids = DATASET.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every required category', () => {
    for (const c of ['positioning', 'audience', 'channel', 'campaign_learning',
                     'founder_preference', 'historical_learning', 'contradiction', 'paraphrase']) {
      expect(CATEGORY_COUNTS[c] ?? 0).toBeGreaterThan(0);
    }
  });

  it('references only fixtures that exist', () => {
    const unknown: string[] = [];
    for (const q of DATASET) {
      for (const f of [...q.expected.required,
                       ...(q.expected.acceptable ?? []),
                       ...(q.expected.must_not_include ?? [])]) {
        if (!(f in FIXTURE_IDS)) unknown.push(`${q.id} → ${f}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('always requires at least one record', () => {
    for (const q of DATASET) expect(q.expected.required.length).toBeGreaterThan(0);
  });

  it('never lists the same fixture as both required and forbidden', () => {
    for (const q of DATASET) {
      const forbidden = new Set(q.expected.must_not_include ?? []);
      for (const r of q.expected.required) expect(forbidden.has(r)).toBe(false);
    }
  });

  it('only ever requires records belonging to the tenant under test', () => {
    const byFixture = Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.founder_id]));
    for (const q of DATASET) {
      for (const r of q.expected.required) {
        if (r in byFixture) expect(byFixture[r]).toBe(FOUNDER_A);
      }
    }
  });

  it('uses cross-tenant canaries that really belong to the other tenant', () => {
    const byFixture = Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.founder_id]));
    const canaries = new Set(DATASET.flatMap(q => q.expected.must_not_include ?? []));
    expect(canaries.size).toBeGreaterThan(0);
    for (const c of canaries) expect(byFixture[c]).toBe(FOUNDER_B);
  });

  it('includes paraphrase cases with genuinely no token overlap', () => {
    // If a "paraphrase" query shares a content word with its target title it is
    // not testing paraphrase, and the semantic uplift measured later is inflated.
    const titles = Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.title]));
    const paraphrases = DATASET.filter(q => q.category === 'paraphrase');
    expect(paraphrases.length).toBeGreaterThanOrEqual(4);
    for (const q of paraphrases) {
      const qt = terms(q.query);
      for (const r of q.expected.required) {
        const shared = [...terms(titles[r] ?? '')].filter(t => qt.has(t));
        expect(shared, `${q.id} shares "${shared.join(',')}" with ${r}`).toEqual([]);
      }
    }
  });

  it('includes a contradiction pair that must be retrieved together', () => {
    const both = DATASET.find(q => q.id === 'retrieval_026');
    expect(both?.expected.required).toContain('memory_search_beats_meta');
    expect(both?.expected.required).toContain('memory_search_worse_enterprise');
  });
});

describe('eval safety + metrics', () => {
  it('refuses to seed a hosted Supabase', () => {
    expect(() => assertLocalTarget('https://gseqtbwdenjkwysregpp.supabase.co')).toThrow();
    expect(() => assertLocalTarget('http://127.0.0.1:54321')).not.toThrow();
  });

  it('percentile uses nearest-rank and returns an observed value', () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });
});
