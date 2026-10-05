/**
 * @file ownerTextBoundary.test.ts
 * @description THE P1-20 GATE — owner text never carries an internal citation.
 *
 *   The defect this freezes was found in a real browser, not by a unit test:
 *   the model wrote its own citation markers into the prose, grounding only ever
 *   inspected `evidenceRefs`, and the markers rendered on the Growth Brain card.
 *
 *   Half of these cases are NEGATIVE — legitimate prose that must survive
 *   untouched. A sanitizer that corrupts advice to fix a formatting problem is a
 *   worse defect than the one it replaces, so the over-strip cases carry the
 *   same weight as the leak cases.
 *
 * @security This is the last boundary before generated text reaches a person.
 * @dependencies ownerTextBoundary, growthBrainOutputGrounding (both real)
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeOwnerText, sanitizeOwnerFields, containsInternalCitation,
} from '../src/services/ownerTextBoundary';
import { groundClaims, type EvidenceHandle } from '../src/services/growthBrainOutputGrounding';

const mi = (ref: string, text: string): EvidenceHandle => ({
  ref, kind: 'MARKET_INTELLIGENCE', label: `Rival — App Store observation`,
  text, authority: 'VERIFIED_EXTERNAL', freshness: 'CURRENT',
});

describe('P1-20 — internal citations never reach owner text', () => {
  // ── A / B: the observed defect, verbatim ────────────────────────────────
  it('A — a single inline MI handle is removed and the prose survives', () => {
    const v = sanitizeOwnerText('Things 3 is a paid app (mi10).');
    expect(v.text).toBe('Things 3 is a paid app.');
    expect(v.rejected).toBe(false);
    expect(v.normalized).toBe(true);
  });

  it('B — the exact browser-observed string comes back clean', () => {
    const v = sanitizeOwnerText(
      'Things 3 positions on day planning and goal progress (mi7), holds a ' +
      '4.82-star rating from 27,809 ratings (mi8, mi9), and is a paid app (mi10).');
    expect(v.text).toBe(
      'Things 3 positions on day planning and goal progress, holds a ' +
      '4.82-star rating from 27,809 ratings, and is a paid app.');
    expect(containsInternalCitation(v.text)).toBe(false);
    expect(v.rejected).toBe(false);
  });

  // ── C / D: structured evidence is untouched ─────────────────────────────
  it('C/D — sanitising prose never detaches a claim from its evidence', () => {
    const handles = [mi('mi8', 'Things 3 holds a 4.82 star public store rating.')];
    const out = groundClaims([{
      type: 'OBSERVATION',
      text: 'Things 3 has a 4.82-star rating (mi8).',
      evidenceRefs: ['mi8'],
    }], handles);

    // Grounding still resolves the structured ref…
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].refs.map(r => r.ref)).toEqual(['mi8']);
    // …and the boundary cleans only the prose.
    const v = sanitizeOwnerText(out.claims[0].text);
    expect(v.text).toBe('Things 3 has a 4.82-star rating.');
    expect(out.claims[0].refs[0].label).toContain('App Store observation');
  });

  // ── E: a fabricated inline handle creates nothing ───────────────────────
  it('E — an inline handle the server never issued cannot become provenance', () => {
    const handles = [mi('mi8', 'Things 3 holds a 4.82 star public store rating.')];
    const out = groundClaims([{
      type: 'OBSERVATION',
      text: 'Competitors are strongly rated (mi99).',
      evidenceRefs: [],            // the model cited NOTHING structurally
    }], handles);
    // No evidence resolved, so it cannot stand as an observation…
    expect(out.claims[0].refs).toHaveLength(0);
    expect(out.claims[0].type).toBe('INFERENCE');
    // …and the marker is still removed from what the owner reads.
    const v = sanitizeOwnerText(out.claims[0].text);
    expect(v.text).toBe('Competitors are strongly rated.');
    expect(containsInternalCitation(v.text)).toBe(false);
  });

  // ── F / G: OVER-STRIP SAFETY. These matter as much as the leak cases. ────
  it('F — ordinary prose containing "MI" or handle words is byte-identical', () => {
    for (const s of [
      'MI strategy is unclear for this product.',
      'The Mi 10 is a competing device.',
      'Market intelligence is not available for this product yet.',
      'Clarify the product goal and the direction before spending.',
      'Review competitors and your performance together.',
      'Your strategy should name one audience.',
      'Ship the M1 optimised build.',
    ]) {
      const v = sanitizeOwnerText(s);
      expect(v.text, s).toBe(s);
      expect(v.normalized, s).toBe(false);
      expect(v.rejected, s).toBe(false);
    }
  });

  it('G — numbers, versions and ratings are untouched', () => {
    for (const s of [
      'version 10 shipped last week',
      'rating 4.8 across 27,809 ratings',
      'iPhone 16 users convert better',
      'Increase spend from $100 to $250.',
      'A 31% lift is the target.',
    ]) {
      expect(sanitizeOwnerText(s).text, s).toBe(s);
    }
  });

  // ── H–K: every owner-visible field, not just supporting[] ───────────────
  it('H/I/J/K — what, whyNow, expectedEffect and nextStep are all covered', () => {
    const r = sanitizeOwnerFields({
      what: 'Differentiate positioning against Things 3 (mi7).',
      whyNow: 'Both competitors hold strong store positions (mi8, mi9).',
      expectedEffect: 'Clearer conversion from the listing [mi1].',
      nextStep: 'Rewrite the subtitle, according to mi10.',
    });
    expect(r.rejected).toEqual([]);
    expect(r.values.what).toBe('Differentiate positioning against Things 3.');
    expect(r.values.whyNow).toBe('Both competitors hold strong store positions.');
    expect(r.values.expectedEffect).toBe('Clearer conversion from the listing.');
    expect(r.values.nextStep).toBe('Rewrite the subtitle.');
    for (const v of Object.values(r.values)) expect(containsInternalCitation(v)).toBe(false);
  });

  // ── L: the memory handle class leaks the same way ───────────────────────
  it('L — Marketing Memory handles (m1…) are covered by the same boundary', () => {
    expect(sanitizeOwnerText('Trust badges lifted bookings before (m1).').text)
      .toBe('Trust badges lifted bookings before.');
    expect(sanitizeOwnerText('Per m3, email cadence matters.').text)
      .toBe('email cadence matters.');
    // But the OWNER-SAFE handles are ordinary words and stay in prose.
    expect(sanitizeOwnerText('Your goal and direction both point at bookings.').normalized).toBe(false);
  });

  // ── N: clean prose is byte-equivalent ───────────────────────────────────
  it('N — already-clean model prose is returned unchanged', () => {
    const s = 'Things 3 holds a 4.82-star rating from 27,809 ratings and is a paid app.';
    const v = sanitizeOwnerText(s);
    expect(v.text).toBe(s);
    expect(v.normalized).toBe(false);
  });

  // ── The reject backstop: the invariant, not a best-effort regex ──────────
  it('a citation shape the normaliser does not recognise is REJECTED, not shipped', () => {
    // Brace and angle forms are deliberately NOT rewritten by layer 1 — they
    // are refused by layer 2 instead. The first version of this test used
    // "{see mi8 …}", which layer 1 DID recognise via the attribution rule, so
    // it proved nothing about the backstop.
    for (const s of ['The rating is strong {mi8}.', 'Rated highly <<mi8>>.']) {
      expect(sanitizeOwnerText(s).rejected, s).toBe(true);
    }
    // And a "claim" that was only a citation is not advice.
    expect(sanitizeOwnerText('(mi1)').rejected).toBe(true);
  });

  it('containsInternalCitation is precise: citation position only', () => {
    expect(containsInternalCitation('rating (mi8)')).toBe(true);
    expect(containsInternalCitation('according to mi8')).toBe(true);
    expect(containsInternalCitation('Ship the M1 optimised build.')).toBe(false);
    expect(containsInternalCitation('MI strategy is unclear')).toBe(false);
  });
});

// ── O / P: behaviours that must NOT change ─────────────────────────────────
describe('P1-20 — grounding behaviour is unchanged', () => {
  it('O — numeric grounding still drops a fabricated quantity', () => {
    const handles = [mi('mi1', 'Rival holds a 4.40 star public store rating.')];
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Category conversion increased 31% last quarter (mi1).',
      evidenceRefs: ['mi1'],
    }], handles);
    expect(out.claims).toHaveLength(0);
    expect(out.dropped[0].reason).toBe('UNSUPPORTED_MEASUREMENT');
  });

  it('O2 — the first-party/external separation is unaffected by markers', () => {
    const handles = [mi('mi1', 'Rival holds a 4.70 star public store rating.')];
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Your rating is 4.70 (mi1).', evidenceRefs: ['mi1'],
    }], handles);
    expect(out.dropped[0].reason).toBe('EXTERNAL_CANNOT_SUPPORT_FIRST_PARTY_CLAIM');
  });

  it('P — founder-conflict detection is unchanged by sanitisation', async () => {
    const { detectFounderConflict } = await import('../src/services/growthBrainOutputGrounding');
    const handles: EvidenceHandle[] = [{
      ref: 'direction', kind: 'FOUNDER_DIRECTION', label: 'Your confirmed direction',
      text: 'Enterprise positioning reduces trust with solo tradespeople',
    }];
    const dirty = 'Enterprise positioning improves trust with solo tradespeople (mi1)';
    const clean = sanitizeOwnerText(dirty).text;
    // Same verdict before and after — removing a marker cannot change whether a
    // conflict is found, which is why the service detects on the CLEANED text.
    expect(detectFounderConflict(clean, handles)).not.toBeNull();
    expect(detectFounderConflict(dirty, handles)?.ref)
      .toBe(detectFounderConflict(clean, handles)?.ref);
  });
});

// ── SERVICE-LEVEL WIRING ───────────────────────────────────────────────────
// The module tests above passed while mutations 2 and 3 SURVIVED: nothing
// asserted that the recommendation SERVICE actually applies the boundary to
// `what`/`whyNow`/`nextStep`, or that provenance still resolves afterwards.
// Driving the real service with a stubbed model closes both.
import { vi } from 'vitest';

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({
    recommendations: [{
      what: 'Differentiate positioning against Things 3 (mi1).',
      whyNow: 'Both competitors hold strong store positions (mi1, mi2).',
      expectedEffect: 'Clearer store conversion [mi1].',
      nextStep: 'Rewrite the subtitle, according to mi2.',
      actionType: 'RESEARCH',
      supporting: [{
        type: 'OBSERVATION',
        text: 'Rival holds a 4.40 star public store rating (mi1).',
        evidenceRefs: ['mi1'],
      }],
      evidenceRefs: ['mi1'],
    }],
  })),
  callHaiku: vi.fn(async () => '{}'),
}));

vi.mock('../src/lib/context/contextPackageV2', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    buildContextPackageV2: vi.fn(async () => ({
      id: 'ctx', workspaceId: 'ws', productId: 'p', founderId: 'f',
      contextType: 'MORNING_BRIEF', createdAt: '2026-01-01', traceId: 't',
      authoritative: { productName: 'Mine', category: 'productivity', markets: ['usa'], plan: 'studio', workspaceId: 'ws', productId: 'p', tokenBalance: null },
      founderContext: { audienceConfirmed: 'Busy professionals', contextDelta: null,
        workingStyle: null, primaryGoal: 'Grow subs', nextInitiative: null, targetWindow: null,
        confirmedIcp: null, competitors: [], strategyDirection: null },
      retrievedMemories: [],
      operational: { activeCampaigns: [], recentMetrics: [], knowledgeNodes: [] },
      marketEvidence: [{
        handleRef: 'mi1', label: 'Rival — App Store observation', subject: 'Rival',
        subjectRelation: 'CONFIRMED_COMPETITOR', observationType: 'LISTING_RATING',
        claim: 'Rival holds a 4.40 star public store rating.', structuredValue: 4.4,
        unit: 'stars', provider: 'app_store', observedAt: '2026-08-10T00:00:00.000Z',
        publishedAt: null, freshness: 'CURRENT', lifecycle: 'ACTIVE',
        authorityTier: 'VERIFIED_EXTERNAL', independenceKey: 'k1', entityGroupKey: null,
      }],
      marketIntelligence: { mode: 'ACTIVE', subjectsInScope: 1, resolved: 1, eligible: 1, available: true, reason: null },
      retrieval: { mode: 'HYBRID', degraded: false, degradedReasons: [], memoryOutcome: 'none_relevant',
        memoriesConsidered: 0, memoriesSelected: 0, excludedForBudget: 0, query: 'q' },
      budget: { total: 8000, used: 0, memoryBudget: 2000, memoryUsed: 0 }, buildMs: 1,
    })),
  };
});

describe('P1-20 — the SERVICE applies the boundary, not just the module', () => {
  it('M2/M3 — every owner-visible field is clean AND provenance still resolves', async () => {
    const { generateGrowthBrainRecommendations } =
      await import('../src/services/growthBrainRecommendationService');
    const res = await generateGrowthBrainRecommendations({
      workspaceId: 'ws', founderId: 'f', productId: 'p',
    });

    expect(res.recommendations.length, 'the stub produced nothing — vacuous').toBe(1);
    const r = res.recommendations[0];

    // M2: the recommendation's OWN prose fields, not just supporting[].
    for (const field of [r.what, r.whyNow, r.nextStep, r.expectedEffect ?? '']) {
      expect(containsInternalCitation(field), `leaked in "${field}"`).toBe(false);
      expect(field).not.toMatch(/\(mi\d+/);
    }
    expect(r.what).toBe('Differentiate positioning against Things 3.');
    expect(r.nextStep).toBe('Rewrite the subtitle.');

    // supporting[] too.
    for (const s of r.supporting) expect(containsInternalCitation(s.text)).toBe(false);
    expect(r.supporting[0].text).toBe('Rival holds a 4.40 star public store rating.');

    // M3: sanitising prose must NOT detach the claim from its evidence.
    expect(r.supportedBy.length, 'provenance was lost during sanitisation').toBeGreaterThan(0);
    expect(r.supportedBy.map(p => p.kind)).toContain('MARKET_INTELLIGENCE');
    expect(r.supportedBy[0].label).toContain('App Store observation');
    expect(res.marketIntelligenceAvailable).toBe(true);
  });
});
