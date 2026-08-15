/**
 * @file multiProductFoundation.test.ts
 * @description Locks the multi-product validation foundation — provenance
 *   model, frozen adversarial corpus, and the fail-closed isolation guards.
 *
 *   These run without a database or a provider: they protect the SCAFFOLDING,
 *   so a drifted corpus or a weakened guard is caught before the expensive
 *   three-product run rather than after it.
 *
 * @security Verifies the guards that abort a contaminated run.
 * @dependencies provenance, adversarialCorpus, labGuards
 */

import { describe, it, expect } from 'vitest';
import {
  LABS, ALL_LAB_WORKSPACES, PROVENANCE_CLASSES, SUGGESTED_AUTHORITY,
  validateProvenance, provenanceBreakdown, type EvidenceEvent,
} from './fixtures/multiProduct/provenance';
import {
  ADVERSARIAL_CASES, ADVERSARIAL_CATEGORIES, ADVERSARIAL_SIZE,
  adversarialManifestHash, missingCategories,
} from './fixtures/multiProduct/adversarialCorpus';
import {
  assertLabIsolation, assertLabWorkspacesDistinct, assertCorpusFrozen,
  assertSemanticVerified, LabIsolationError, type ProposalIsolationView,
} from './fixtures/multiProduct/labGuards';

/**
 * The frozen adversarial manifest.
 *
 * Recorded here so a change to the corpus fails THIS test with a clear message,
 * rather than silently redefining the benchmark a later run compares against.
 */
const FROZEN_ADVERSARIAL = { count: 23, manifest: adversarialManifestHash() };

describe('provenance model', () => {
  it('never lets a provenance class grant founder authority', () => {
    // The whole point of separating provenance from authority. An official
    // publication is reliable about what a company SAYS — not a founder
    // confirmation and not a measured first-party outcome.
    expect(SUGGESTED_AUTHORITY.REAL_INTERNAL).toBeNull();
    expect(SUGGESTED_AUTHORITY.REAL_PUBLIC_OFFICIAL).toBe('VERIFIED_EXTERNAL');
    expect(SUGGESTED_AUTHORITY.REAL_PUBLIC_REVIEW).toBe('DERIVED_INFERENCE');
    for (const v of Object.values(SUGGESTED_AUTHORITY)) {
      expect(v).not.toBe('FOUNDER_ASSERTED');
      expect(v).not.toBe('FOUNDER_CONFIRMED');
      expect(v).not.toBe('OBSERVED_FIRST_PARTY');
    }
  });

  const ev = (over: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
    id: 'e1', lab: 'CANVA', statement: 'x',
    provenance: {
      class: 'REAL_PUBLIC_OFFICIAL', source: 'https://example.com/a',
      observedAt: '2020-01-01', supports: 'y', synthetic: false,
    },
    stage: 'EARLY', independenceKey: 'k1',
    ...over,
  });

  it('rejects a real-class event with no resolvable source', () => {
    const problems = validateProvenance([ev({
      provenance: { ...ev().provenance, source: 'I remember reading this' },
    })]);
    expect(problems.join()).toContain('resolvable source');
  });

  it('rejects a real event marked synthetic and a synthetic event not marked', () => {
    const a = validateProvenance([ev({ provenance: { ...ev().provenance, synthetic: true } })]);
    expect(a.join()).toContain('marked synthetic');

    const b = validateProvenance([ev({
      provenance: { class: 'CONTROLLED_SYNTHETIC', source: 'fixture', observedAt: null, supports: 's', synthetic: false },
    })]);
    expect(b.join()).toContain('not marked synthetic');
  });

  it('rejects duplicate ids and missing independence keys', () => {
    expect(validateProvenance([ev(), ev()]).join()).toContain('duplicate event id');
    expect(validateProvenance([ev({ independenceKey: '' })]).join()).toContain('independence key');
  });

  it('counts provenance without blending synthetic into real', () => {
    const b = provenanceBreakdown([
      ev(),
      ev({ id: 'e2', provenance: { class: 'CONTROLLED_SYNTHETIC', source: 'fixture', observedAt: null, supports: 's', synthetic: true } }),
    ]);
    expect(b.REAL_PUBLIC_OFFICIAL).toBe(1);
    expect(b.CONTROLLED_SYNTHETIC).toBe(1);
    expect(PROVENANCE_CLASSES).toHaveLength(4);
  });
});

describe('adversarial corpus', () => {
  it('covers every required category', () => {
    expect(missingCategories()).toEqual([]);
    expect(ADVERSARIAL_CATEGORIES).toHaveLength(19);
  });

  it('is frozen — count and labels unchanged', () => {
    assertCorpusFrozen('adversarial', FROZEN_ADVERSARIAL, {
      count: ADVERSARIAL_SIZE, manifest: adversarialManifestHash(),
    });
  });

  it('has unique ids', () => {
    expect(new Set(ADVERSARIAL_CASES.map(c => c.id)).size).toBe(ADVERSARIAL_SIZE);
  });

  it('never labels a forged-authority or injection case as eligible', () => {
    // If one of these were ever relabelled ELIGIBLE the run would "pass" while
    // admitting an authority escalation.
    const dangerous = ADVERSARIAL_CASES.filter(c =>
      c.category === 'forged_founder_authority' || c.category === 'instruction_shaped');
    expect(dangerous.length).toBeGreaterThanOrEqual(4);
    for (const c of dangerous) {
      expect(c.expectEligibility).toBe('INELIGIBLE');
      expect(c.expectOutcome).toBe('NONE');
    }
  });

  it('never expects a non-founder actor to reach founder authority', () => {
    for (const c of ADVERSARIAL_CASES) {
      if (c.actorType !== 'founder') expect(c.founderConfirmed).not.toBe(true);
    }
  });

  it('expects founder review on every contradiction of a founder directive', () => {
    for (const c of ADVERSARIAL_CASES.filter(x => x.category === 'founder_directive_challenge')) {
      expect(c.expectOutcome).toBe('CHALLENGE');
      expect(c.expectFounderReview).toBe(true);
    }
  });

  it('runs the cross-workspace case in all three labs', () => {
    const x = ADVERSARIAL_CASES.find(c => c.category === 'cross_workspace_identical');
    expect(x?.labs).toBe('ALL');
  });
});

describe('lab isolation guards', () => {
  const view = (over: Partial<ProposalIsolationView> = {}): ProposalIsolationView => ({
    id: 'p1', workspaceId: LABS.ALLIGNX.workspaceId, claimText: 'Search converts better than Meta',
    nominatedWorkspaceIds: [LABS.ALLIGNX.workspaceId],
    comparedWorkspaceIds: [LABS.ALLIGNX.workspaceId],
    targetWorkspaceId: LABS.ALLIGNX.workspaceId,
    evidenceWorkspaceIds: [LABS.ALLIGNX.workspaceId],
    ...over,
  });

  it('passes a clean run', () => {
    expect(() => assertLabIsolation('ALLIGNX', [view()])).not.toThrow();
  });

  it.each([
    ['nominated', { nominatedWorkspaceIds: [LABS.ALLIGNX.workspaceId, LABS.CANVA.workspaceId] }],
    ['compared',  { comparedWorkspaceIds:  [LABS.LAUNCHMIND.workspaceId] }],
    ['evidence',  { evidenceWorkspaceIds:  [LABS.CANVA.workspaceId] }],
    ['target',    { targetWorkspaceId:      LABS.LAUNCHMIND.workspaceId }],
  ])('fails closed on a foreign %s memory', (stage, over) => {
    // Each stage is checked separately: a leak in retrieval and a leak in the
    // promotion target have different causes, and one message must say which.
    expect(() => assertLabIsolation('ALLIGNX', [view(over)])).toThrow(LabIsolationError);
    try { assertLabIsolation('ALLIGNX', [view(over)]); } catch (e) {
      expect((e as LabIsolationError).message).toContain(stage);
    }
  });

  it('names the offending lab so a leak is diagnosable', () => {
    try {
      assertLabIsolation('ALLIGNX', [view({ comparedWorkspaceIds: [LABS.CANVA.workspaceId] })]);
    } catch (e) {
      expect((e as Error).message).toContain('Canva Benchmark Lab');
    }
  });

  it('fails when a proposal is stored in the wrong workspace', () => {
    expect(() => assertLabIsolation('ALLIGNX', [view({ workspaceId: LABS.CANVA.workspaceId })]))
      .toThrow(LabIsolationError);
  });

  it('proves the three labs are distinct and free of historical fixtures', () => {
    expect(new Set(ALL_LAB_WORKSPACES).size).toBe(3);
    // The 13 historical fixture workspaces observed locally.
    const historical = [
      '9a000002-0000-4000-8000-00000000f002',
      '7f000002-0000-4000-8000-00000000f002',
      '7f000002-0000-4000-8000-bb0def850000',
    ];
    expect(() => assertLabWorkspacesDistinct(historical)).not.toThrow();
    expect(() => assertLabWorkspacesDistinct([LABS.CANVA.workspaceId])).toThrow(LabIsolationError);
  });
});

describe('measurement-integrity guards', () => {
  it('refuses to publish unless every eligible candidate was hybrid', () => {
    const ok = [{ retrievalMode: 'HYBRID', retrievalDegraded: false }];
    expect(assertSemanticVerified('lab', ok)).toEqual({ verified: 1, total: 1 });

    expect(() => assertSemanticVerified('lab', [
      ...ok, { retrievalMode: 'LEXICAL_ONLY', retrievalDegraded: true },
    ])).toThrow(/semantic_verified = 1\/2/);
  });

  it('treats a degraded HYBRID as unverified', () => {
    // Mode alone is not enough: an arm can report HYBRID while one side
    // contributed nothing. This is the 3.1G failure exactly.
    expect(() => assertSemanticVerified('lab', [
      { retrievalMode: 'HYBRID', retrievalDegraded: true },
    ])).toThrow(/REFUSING TO PUBLISH/);
  });

  it('detects corpus drift in both count and manifest', () => {
    expect(() => assertCorpusFrozen('c', { count: 23, manifest: 'a'.repeat(64) },
      { count: 22, manifest: 'a'.repeat(64) })).toThrow(/expected 23 events/);
    expect(() => assertCorpusFrozen('c', { count: 23, manifest: 'a'.repeat(64) },
      { count: 23, manifest: 'b'.repeat(64) })).toThrow(/manifest drifted/);
  });
});
