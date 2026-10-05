/**
 * @file creativeSetOrchestration.test.ts
 * @description §3–§8 concept contracts and set orchestration; §36 mutations O1–O10.
 *
 *   Generation is stubbed through the documented `generate` seam so the
 *   orchestration logic — retry targeting, sibling survival, set distinctness —
 *   is measured deterministically rather than against a sampling model.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyHeadlineShape, validateConceptRole, validateSetDistinctness,
  CONCEPT_CONTRACTS, conceptContractDirective,
} from '../src/services/content/creativeConceptContract';
import { CONCEPT_KEYS } from '../src/services/content/creativeConcepts';

/** The documented silent-semantic stub, identical to b3ContentGeneration.test. */
const silent = async () => ({ byField: new Map(), artifactClaims: [],
  unresolvedFields: [], unverifiable: false, failureReason: null });

describe('§8 headline shapes are detected, not assumed', () => {
  it.each([
    ['Still waiting on a callback?',            'QUESTION'],
    ['Home projects shouldn\'t start on hold',  'NORMATIVE'],
    ['Imagine starting somewhere else',         'HYPOTHETICAL'],
    ['AllignX connects you with vetted pros',   'CAPABILITY'],
    ['This could feel calmer',                  'HEDGE'],
    ['Trusted. Vetted. Neighborhood.',          'NOUN_FRAGMENT'],
    ['Home projects, minus the phone tag',      'NOUN_FRAGMENT'],
  ])('%s -> %s', (h, want) => {
    expect(classifyHeadlineShape(h)).toBe(want);
  });
});

describe('§3/§5 each concept must actually perform its role', () => {
  it('B must name what the product does', () => {
    expect(validateConceptRole('PRODUCT_DEMONSTRATION',
      { headline: 'AllignX connects you with vetted pros' })).toEqual([]);
    // A question is the wrong answer to "what is this?"
    const v = validateConceptRole('PRODUCT_DEMONSTRATION',
      { headline: 'Still waiting on a callback?' });
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('HEADLINE_SHAPE');
  });

  it('A may frame, and may not simply name the product', () => {
    expect(validateConceptRole('PROBLEM_RECOGNITION',
      { headline: 'Still waiting on a callback?' })).toEqual([]);
    expect(validateConceptRole('PROBLEM_RECOGNITION',
      { headline: 'AllignX connects you with vetted pros' })).toHaveLength(1);
  });

  it('C may hedge, and may not become B', () => {
    expect(validateConceptRole('RELIEF',
      { headline: 'Home projects could feel calmer' })).toEqual([]);
    expect(validateConceptRole('RELIEF',
      { headline: 'AllignX connects you with vetted pros' })).toHaveLength(1);
  });

  // O3 — the B6.7 regression: every concept permitted a question.
  it('NOT every concept may use a question', () => {
    const permitQuestion = CONCEPT_KEYS
      .filter(k => CONCEPT_CONTRACTS[k].permittedHeadlineShapes.includes('QUESTION'));
    expect(permitQuestion.length).toBeLessThan(CONCEPT_KEYS.length);
  });

  // O2 — one concept's contract applied to another.
  it('the three contracts are genuinely different', () => {
    const sigs = CONCEPT_KEYS.map(k => CONCEPT_CONTRACTS[k].signatureShape);
    expect(new Set(sigs).size).toBe(3);
    const perms = CONCEPT_KEYS.map(k => CONCEPT_CONTRACTS[k].permittedHeadlineShapes.join(','));
    expect(new Set(perms).size).toBe(3);
  });

  it('no concept may use a bare noun fragment', () => {
    for (const k of CONCEPT_KEYS) {
      expect(CONCEPT_CONTRACTS[k].permittedHeadlineShapes).not.toContain('NOUN_FRAGMENT');
      expect(validateConceptRole(k, { headline: 'Trusted. Vetted. Nearby.' })).toHaveLength(1);
    }
  });

  it('an empty headline is a violation, not a pass', () => {
    expect(validateConceptRole('RELIEF', { headline: '' })[0].code).toBe('EMPTY_HEADLINE');
  });

  it('the directive carries structure and never a capability or a claim', () => {
    for (const k of CONCEPT_KEYS) {
      const d = conceptContractDirective(k);
      // A PERFORMANCE CLAIM, not any use of the word. The first version of
      // this pattern matched `converts?` and so flagged the Relief guidance's
      // "never convert a feeling into a figure" — an instruction NOT to make a
      // performance claim, caught as one.
      expect(d).not.toMatch(/\d+\s*%|\bproven\b|\bbest\b|converts?\s+(?:better|more|higher)|conversion rate/i);
      expect(d).toMatch(/HEADLINE:/);
    }
  });
});

describe('§7 set distinctness is separate from per-concept validity', () => {
  it('accepts three genuinely different openings', () => {
    const v = validateSetDistinctness([
      { key: 'PROBLEM_RECOGNITION', headline: 'Still waiting on a callback?' },
      { key: 'PRODUCT_DEMONSTRATION', headline: 'AllignX connects you with vetted pros' },
      { key: 'RELIEF', headline: 'Home projects could feel calmer' },
    ]);
    expect(v.distinct).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it('rejects two concepts that opened the same way', () => {
    const v = validateSetDistinctness([
      { key: 'PROBLEM_RECOGNITION', headline: 'Still waiting on a callback?' },
      { key: 'PRODUCT_DEMONSTRATION', headline: 'Still calling around for help?' },
      { key: 'RELIEF', headline: 'Home projects could feel calmer' },
    ]);
    expect(v.distinct).toBe(false);
    // The OFFENDER is the one for which QUESTION is not the signature shape.
    expect(v.offenders).toEqual(['PRODUCT_DEMONSTRATION']);
  });

  it('names the MINIMUM offenders, never the whole set', () => {
    const v = validateSetDistinctness([
      { key: 'PROBLEM_RECOGNITION', headline: 'Still waiting on a callback?' },
      { key: 'PRODUCT_DEMONSTRATION', headline: 'AllignX connects you with vetted pros' },
      { key: 'RELIEF', headline: 'Still waiting on a callback?' },
    ]);
    expect(v.distinct).toBe(false);
    expect(v.offenders.length).toBeLessThan(3);
  });

  it('rejects near-identical wording even in different shapes', () => {
    const v = validateSetDistinctness([
      { key: 'PROBLEM_RECOGNITION', headline: 'Home projects shouldnt start with hold music?' },
      { key: 'PRODUCT_DEMONSTRATION', headline: 'AllignX connects vetted pros' },
      { key: 'RELIEF', headline: 'Home projects shouldnt start with hold music' },
    ]);
    expect(v.distinct).toBe(false);
  });

  it('produces no score of any kind', () => {
    const v = validateSetDistinctness([
      { key: 'PROBLEM_RECOGNITION', headline: 'Still waiting?' },
      { key: 'RELIEF', headline: 'Could feel calmer' },
    ]) as Record<string, unknown>;
    for (const k of ['score', 'rank', 'winner', 'best', 'confidence', 'predicted']) {
      expect(Object.keys(v)).not.toContain(k);
    }
  });
});

// ── §6 targeted retry, sibling survival ─────────────────────────────────────
describe('§6 orchestration retries only what failed', () => {
  /** Drives the real orchestrator with a scripted generator. */
  async function run(script: (label: string, call: number) => Record<string, string>) {
    vi.resetModules();
    const { generateCreativeSet } = await import('../src/services/content/creativeSetOrchestrator');
    const perLabel = new Map<string, number>();
    const calls: string[] = [];
    const ctx = {
      workspaceId: 'w', productId: 'p',
      application: { name: 'AllignX', category: null, markets: ['usa'],
        description: 'Connect with trusted, vetted home service professionals in your neighborhood.' },
      brand: { fields: {}, missing: [] }, evidence: [], authorizedAssets: [],
      founderDirection: { competitors: [], audienceConfirmed: '', contextDelta: '', primaryGoal: '' },
      brandProvenance: [],
    } as never;
    const strategy = {
      workspaceId: 'w', productId: 'p', objective: 'o', audience: 'a',
      campaignThesis: 't', angle: 'x', coreNarrative: 'n', messageHierarchy: [],
      proofAvailable: [], proofUnavailable: [], ctaIntent: 'See how AllignX works',
      constraints: [], objections: [], productRole: null, primaryBenefit: null,
      brandDirectives: [], prohibitedTerminology: [], intelligenceInformed: [],
      founderOverrides: [], memoryApplied: [], brandKitVersion: 1,
    } as never;
    const out = await generateCreativeSet({
      ctx, strategy, founderId: 'f',
      semantic: silent as never,
      generate: async (system: string) => {
        const label = /Problem recognition/.test(system) ? 'A'
          : /Product demonstration/.test(system) ? 'B' : 'C';
        const n = (perLabel.get(label) ?? 0) + 1;
        perLabel.set(label, n);
        calls.push(`${label}${n}`);
        return JSON.stringify({ content: script(label, n), declaredClaims: [] });
      },
    });
    return { out, calls, perLabel };
  }

  const GOOD: Record<string, Record<string, string>> = {
    A: { headline: 'Still waiting on a callback?', primaryText: 'AllignX connects you with vetted professionals.', description: 'See how AllignX works' },
    B: { headline: 'AllignX connects you with vetted pros', primaryText: 'AllignX connects you with trusted professionals.', description: 'See how AllignX works' },
    C: { headline: 'Home projects could feel calmer', primaryText: 'AllignX connects you with vetted professionals.', description: 'See how AllignX works' },
  };

  it('O4/O9 — a failing B does not cause A or C to be regenerated', async () => {
    const { out, perLabel } = await run((label, n) => {
      if (label === 'B' && n < 2) return { ...GOOD.B, headline: 'Trusted. Vetted. Nearby.' };
      return GOOD[label];
    });
    expect(perLabel.get('A')).toBe(1);
    expect(perLabel.get('C')).toBe(1);
    expect(perLabel.get('B')).toBeGreaterThan(1);
    // Siblings survived and are still ready.
    const byKey = Object.fromEntries(out.concepts.map(c => [c.key, c.status]));
    expect(byKey.PROBLEM_RECOGNITION).toBe('READY');
    expect(byKey.RELIEF).toBe('READY');
  });

  it('O9 — a permanently failing B leaves A and C ready', async () => {
    const { out } = await run((label) =>
      label === 'B' ? { ...GOOD.B, headline: 'Trusted. Vetted. Nearby.' } : GOOD[label]);
    expect(out.readyCount).toBe(2);
    const b = out.concepts.find(c => c.key === 'PRODUCT_DEMONSTRATION')!;
    expect(b.status).toBe('NEEDS_ATTENTION');
    expect(b.ownerReason).toBeTruthy();
    // Owner-safe: no enum leaks into the reason.
    expect(b.ownerReason).not.toMatch(/HEADLINE_SHAPE|NOUN_FRAGMENT|REWRITE_REQUIRED/);
  });

  it('a provider outage is reported as an outage, and is not retried', async () => {
    // The measured case: the writing model became unreachable mid-run and every
    // concept came back empty. Telling the owner their wording needs work would
    // be false, and retrying an outage three times per concept is 9 futile
    // calls per set.
    const { perLabel, out } = await run(() => ({}));   // empty payload => DEGRADED
    expect(perLabel.get('A'), 'the first authoritative outage is attempted once').toBe(1);
    expect(perLabel.get('B'), 'later concepts must be skipped after an outage').toBeUndefined();
    expect(perLabel.get('C'), 'later concepts must be skipped after an outage').toBeUndefined();
    for (const c of out.concepts) {
      expect(c.status).toBe('FAILED');
      expect(c.ownerReason).toMatch(/creative generation is temporarily unavailable/i);
      expect(c.ownerReason).not.toMatch(/provider|anthropic|credits|billing|http/i);
      expect(c.ownerReason).not.toMatch(/wording/i);
    }
    expect(out.totalGenerations).toBe(1);
  });

  it('O8 — retries are bounded by an ABSOLUTE ceiling', async () => {
    const { perLabel } = await run((label) =>
      label === 'B' ? { ...GOOD.B, headline: 'Trusted. Vetted. Nearby.' } : GOOD[label]);
    // ABSOLUTE, not `<= MAX_CONCEPT_ATTEMPTS`. Comparing against the constant
    // makes the assertion self-referential: raising the constant to 99 raises
    // the bound too, and the mutation survives while the test stays green.
    expect(perLabel.get('B')).toBeLessThanOrEqual(4);
    const { MAX_CONCEPT_ATTEMPTS } = await import('../src/services/content/creativeSetOrchestrator');
    expect(MAX_CONCEPT_ATTEMPTS).toBeLessThanOrEqual(4);
  });

  // ── §4 O4 PROOF: successful siblings survive, and are not regenerated ──
  //
  // B6.8 left this unproven. The fixture below makes B fail on its CONCEPT
  // ROLE (a noun fragment, which no concept permits) so it reaches the targeted
  // per-concept retry, and gives A and C content that changes on every call —
  // so if either is regenerated, its identity changes and the assertion catches
  // it. Counting calls alone would not: a regenerated-but-identical sibling
  // looks the same as one that was never touched.
  it('O4 — A and C are not regenerated, and their identity is unchanged', async () => {
    const seen: Record<string, string[]> = { A: [], B: [], C: [] };
    const { out, perLabel } = await run((label, n) => {
      // B fails PERMANENTLY. An eventually-succeeding B leaves the set with no
      // failure at the end, so a mutation that regenerates everything "on
      // failure" never triggers and the test proves nothing. The invariant §4
      // names is that a FAILED sibling does not take the successful ones with
      // it, which requires a sibling that actually stays failed.
      if (label === 'B') return { ...GOOD.B, headline: 'Trusted. Vetted. Nearby.' };
      // A and C differ on every call, so regeneration is visible — but the
      // marker goes at the FRONT. Appending "(take 1)" moved the question mark
      // off the end and changed A's headline SHAPE, so A failed its own
      // contract and was retried nine times: the fixture, not the code.
      const base = GOOD[label].headline;
      const h = n === 1 ? base : `Take ${n} — ${base}`;
      seen[label].push(h);
      return { ...GOOD[label], headline: h };
    });

    expect(perLabel.get('A'), 'A was regenerated').toBe(1);
    expect(perLabel.get('C'), 'C was regenerated').toBe(1);
    expect(perLabel.get('B')).toBe(3);          // bounded, and it stayed failed
    expect(out.concepts.find(c => c.key === 'PRODUCT_DEMONSTRATION')!.status)
      .toBe('NEEDS_ATTENTION');
    expect(out.readyCount).toBe(2);

    // IDENTITY, not just call count.
    const byKey = Object.fromEntries(out.concepts.map(c =>
      [c.key, String((c.result?.payload as Record<string, unknown>)?.headline ?? '')]));
    expect(byKey.PROBLEM_RECOGNITION).toBe(seen.A[0]);
    expect(byKey.RELIEF).toBe(seen.C[0]);
    // The FIRST generation's text survived — no silent regeneration.
    expect(byKey.PROBLEM_RECOGNITION).not.toContain('Take 2');
    expect(byKey.RELIEF).not.toContain('Take 2');

    // And they are still ready.
    for (const c of out.concepts.filter(x => x.key !== 'PRODUCT_DEMONSTRATION')) {
      expect(c.status).toBe('READY');
    }
  });

  // ── §5 O6 PROOF: set-level distinctness retry ────────────────────────
  //
  // Every concept here is INDIVIDUALLY VALID — correct shape, passes
  // governance — so per-concept validation cannot reject any of them. The set
  // still fails, because A and C use nearly the same words in different
  // shapes. This is the ONLY route to the set-level offender analysis: shape
  // collapse is impossible now that the contracts are disjoint.
  it('O6 — a valid-but-collapsed set retries only the offender', async () => {
    const A_Q = 'Could home projects feel calmer?';          // QUESTION, valid for A
    const C_DUP = 'Home projects should feel calmer';        // NORMATIVE, valid for C
    const C_FIX = 'This could feel steadier';                // HEDGE, valid for C

    const { out, perLabel } = await run((label, n) => {
      if (label === 'A') return { ...GOOD.A, headline: A_Q };
      if (label === 'C') return { ...GOOD.C, headline: n === 1 ? C_DUP : C_FIX };
      return GOOD[label];
    });

    // Only C was retried; A and B were produced once and kept.
    expect(perLabel.get('A'), 'A regenerated for C’s collapse').toBe(1);
    expect(perLabel.get('B'), 'B regenerated for C’s collapse').toBe(1);
    expect(perLabel.get('C'), 'C was not retried for the collapse').toBe(2);

    // The set was revalidated and is now distinct.
    expect(out.setDistinct).toBe(true);
    const byKey = Object.fromEntries(out.concepts.map(c =>
      [c.key, String((c.result?.payload as Record<string, unknown>)?.headline ?? '')]));
    expect(byKey.PROBLEM_RECOGNITION).toBe(A_Q);
    expect(byKey.RELIEF).toBe(C_FIX);
    expect(out.readyCount).toBe(3);
  });

  it('O10 — role compliance is measured, not trusted from the prompt', async () => {
    // The generator "obeys" by echoing the role name while writing the wrong shape.
    const { out } = await run((label) => label === 'B'
      ? { headline: 'Product demonstration: trusted, vetted, nearby.',
          primaryText: 'AllignX connects you with professionals.', description: 'See how AllignX works' }
      : GOOD[label]);
    expect(out.concepts.find(c => c.key === 'PRODUCT_DEMONSTRATION')!.status)
      .toBe('NEEDS_ATTENTION');
  });

  it('O5 — a sibling\'s wording never reaches another concept as truth', async () => {
    const seen: string[] = [];
    vi.resetModules();
    const { generateCreativeSet } = await import('../src/services/content/creativeSetOrchestrator');
    const ctx = {
      workspaceId: 'w', productId: 'p',
      application: { name: 'AllignX', category: null, markets: ['usa'],
        description: 'Connect with trusted, vetted home service professionals in your neighborhood.' },
      brand: { fields: {}, missing: [] }, evidence: [], authorizedAssets: [],
      founderDirection: { competitors: [], audienceConfirmed: '', contextDelta: '', primaryGoal: '' },
      brandProvenance: [],
    } as never;
    const strategy = {
      workspaceId: 'w', productId: 'p', objective: 'o', audience: 'a', campaignThesis: 't',
      angle: 'x', coreNarrative: 'n', messageHierarchy: [], proofAvailable: [],
      proofUnavailable: [], ctaIntent: 'c', constraints: [], objections: [],
      productRole: null, primaryBenefit: null, brandDirectives: [], prohibitedTerminology: [],
      intelligenceInformed: [], founderOverrides: [], memoryApplied: [], brandKitVersion: 1,
    } as never;
    await generateCreativeSet({
      ctx, strategy, founderId: 'f', semantic: silent as never,
      generate: async (system: string) => {
        seen.push(system);
        const label = /Problem recognition/.test(system) ? 'A'
          : /Product demonstration/.test(system) ? 'B' : 'C';
        return JSON.stringify({ content: GOOD[label], declaredClaims: [] });
      },
    });
    // A's exact headline must never appear in B's or C's prompt.
    const aHeadline = GOOD.A.headline;
    for (const prompt of seen.slice(1)) {
      expect(prompt, 'a sibling headline leaked into another prompt')
        .not.toContain(aHeadline);
    }
    // The structural note IS allowed — shape, not words.
    expect(seen.slice(1).some(p => /already opens with/i.test(p))).toBe(true);
  });
});
