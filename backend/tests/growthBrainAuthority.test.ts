/**
 * @file growthBrainAuthority.test.ts
 * @description P0 GATE — governed authority must reach the model, and legacy
 *   provenance must never be promoted into authority.
 *
 *   MEASURED DEFECT (3.3A): `authority_tier` was selected by retrievalService
 *   and used internally for reranking, but appeared ZERO times in
 *   contextPackageV2 and contextFormatter. The model therefore saw
 *   `type · source · confidence` and had no way to tell a FOUNDER_ASSERTED
 *   belief from a DERIVED_INFERENCE.
 *
 *   THE LOAD-BEARING HALF is the legacy control. All eight real owner memories
 *   carry `authority_tier: NULL` and `memory_class: NULL` with `source: intake`
 *   — they are legacy rows under the Phase 3.2 discriminator. If the formatter
 *   ever reconstructed authority from `source`, a legacy row whose provenance
 *   merely *reads* like founder input would acquire founder authority by
 *   looking the part. Source is provenance. It is not authority.
 *
 *   Drives the real exported formatter. No labelling logic is reproduced here.
 *
 * @security Proves founder authority cannot be manufactured from a source string.
 * @dependencies contextFormatter (real), contextPackageV2 types
 */

import { describe, it, expect } from 'vitest';
import { formatContextPackageForModel } from '../src/lib/context/contextFormatter';
import type { ContextPackageV2 } from '../src/lib/context/contextPackageV2';
import type { RetrievedMemory } from '../src/services/memory/retrievalTypes';

function memory(over: Partial<RetrievedMemory>): RetrievedMemory {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'ws', productId: 'p',
    memoryType: 'product', title: 'Premium positioning is intentional',
    claim: 'Premium positioning is intentional', content: {},
    confidence: 0.9, version: 1, status: 'active', source: 'growth_brain',
    authorityTier: null, memoryClass: null, evidenceIds: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    contentHash: null, embeddingStatus: 'current',
    arms: ['structured'], lexicalRank: null, semanticRank: null,
    semanticDistance: null, fusedScore: 1, fusedRank: 1, finalRank: 1,
    rerankReasons: [],
    ...over,
  } as RetrievedMemory;
}

function pkg(memories: RetrievedMemory[]): ContextPackageV2 {
  return {
    id: 'ctx', workspaceId: 'ws', productId: 'p', founderId: 'f',
    contextType: 'MORNING_BRIEF', createdAt: '2026-01-01', traceId: 't',
    authoritative: { productName: 'Acme', category: null, markets: [], plan: 'solo' },
    founderContext: {
      audienceConfirmed: null, contextDelta: null, workingStyle: null,
      primaryGoal: null, nextInitiative: null, targetWindow: null,
      confirmedIcp: null, competitors: [], strategyDirection: null,
    },
    retrievedMemories: memories,
    operational: { activeCampaigns: [], recentMetrics: [], knowledgeNodes: [] },
    retrieval: {
      memoryOutcome: 'selected', memoriesConsidered: memories.length,
      memoriesSelected: memories.length, mode: 'HYBRID', degraded: false,
      degradedReasons: [],
    },
    budget: { total: 8000, used: 100, memoryBudget: 2000, memoryUsed: 50 },
    buildMs: 1,
  } as unknown as ContextPackageV2;
}

const render = (m: RetrievedMemory) => formatContextPackageForModel(pkg([m]));

describe('governed authority reaches the model', () => {
  it('a FOUNDER_ASSERTED memory is labelled as such', () => {
    const out = render(memory({ authorityTier: 'FOUNDER_ASSERTED', memoryClass: 'DIRECTIVE', source: 'founder_bootstrap' }));
    expect(out).toContain('authority: FOUNDER_ASSERTED');
    expect(out).toContain('class: DIRECTIVE');
  });

  it('every governed tier survives verbatim', () => {
    for (const tier of ['FOUNDER_ASSERTED', 'FOUNDER_CONFIRMED', 'EXPERIMENT_CONTROLLED',
      'OBSERVED_FIRST_PARTY', 'VERIFIED_EXTERNAL', 'DERIVED_INFERENCE', 'ANONYMIZED_PLAYBOOK']) {
      expect(render(memory({ authorityTier: tier }))).toContain(`authority: ${tier}`);
    }
  });

  it('evidence presence is stated, not implied', () => {
    expect(render(memory({ evidenceIds: [] }))).toContain('evidence: none recorded');
    expect(render(memory({ evidenceIds: ['e1', 'e2'] }))).toContain('evidence: 2 record(s)');
  });

  it('the model is told founder authority outranks other evidence', () => {
    const out = render(memory({ authorityTier: 'DERIVED_INFERENCE' }));
    expect(out).toMatch(/FOUNDER_ASSERTED and FOUNDER_CONFIRMED/);
    expect(out).toMatch(/outrank/i);
    // And what to do on conflict, rather than silently preferring the inference.
    expect(out).toMatch(/do NOT present the lower-authority position as an established/i);
  });
});

describe('LEGACY CONTROL — provenance must not become authority', () => {
  /** The exact shape of all eight real owner memories today. */
  const legacy = (source: string) =>
    memory({ authorityTier: null, memoryClass: null, source });

  it('a legacy row is UNKNOWN_LEGACY, never a founder tier', () => {
    const out = render(legacy('intake'));
    expect(out).toContain('authority: UNKNOWN_LEGACY');
    expect(out).not.toContain('authority: FOUNDER_ASSERTED');
    expect(out).not.toContain('authority: FOUNDER_CONFIRMED');
  });

  it('founder-SHAPED sources do not confer founder authority', () => {
    // These are the ones that would be tempting to map. Each must stay UNKNOWN.
    for (const src of ['founder_feedback', 'founder_bootstrap', 'founder', 'onboarding', 'intake']) {
      const out = render(legacy(src));
      expect(out, `source "${src}" leaked into authority`).toContain('authority: UNKNOWN_LEGACY');
      expect(out, `source "${src}" was promoted to founder authority`).not.toMatch(/authority: FOUNDER_/);
      // Provenance is still shown — on the source line, where it belongs.
      expect(out).toContain(`source: ${src}`);
    }
  });

  it('the model is told UNKNOWN_LEGACY is weak, not founder direction', () => {
    const out = render(legacy('founder_feedback'));
    expect(out).toMatch(/UNKNOWN_LEGACY means the authority of that item was never established/);
    expect(out).toMatch(/treat it as weak, not as founder direction/);
  });

  it('a governed row and a legacy row with the SAME source are labelled differently', () => {
    const governed = render(memory({ authorityTier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' }));
    const notGoverned = render(legacy('founder_bootstrap'));
    expect(governed).toContain('authority: FOUNDER_ASSERTED');
    expect(notGoverned).toContain('authority: UNKNOWN_LEGACY');
  });
});
