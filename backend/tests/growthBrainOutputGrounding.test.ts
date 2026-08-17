/**
 * @file growthBrainOutputGrounding.test.ts
 * @description THE P0 GATE for output grounding — the frozen 12-case matrix.
 *
 *   MEASURED DEFECT: grounding was package-wide. "Does this business have ANY
 *   evidence?" was enough to license
 *
 *       OBSERVATION: "Google Ads conversion increased 31%"
 *
 *   for a business with zero campaigns, with the whole package provenance list
 *   ("Your primary goal") attached underneath as its support. Relabelling it
 *   INFERENCE would not have helped — the invented measurement is the defect,
 *   not the label.
 *
 *   Every case drives the real exported grounding functions. Nothing about
 *   resolution, admissibility or conflict detection is reimplemented here.
 *
 * @security This is the boundary between generated text and owner-visible
 *   content. Case K proves a handle from another business cannot resolve.
 * @dependencies growthBrainOutputGrounding (real)
 */

import { describe, it, expect } from 'vitest';
import {
  issueEvidenceHandles, groundClaims, detectFounderConflict,
  isMeasuredHistoricalClaim, type EvidenceHandle,
} from '../src/services/growthBrainOutputGrounding';
import type { ContextPackageV2 } from '../src/lib/context/contextPackageV2';

/** Builds a real package shape with only the parts a case needs. */
function pkg(over: {
  goal?: string | null; audience?: string | null; memories?: Array<{ title: string; claim?: string; tier?: string | null }>;
  metrics?: Array<{ channel: string; installs: number; cpi: number | null; weekStart: string }>;
  product?: string | null; competitors?: string[];
} = {}): ContextPackageV2 {
  return {
    id: 'ctx', workspaceId: 'ws', productId: 'p', founderId: 'f',
    contextType: 'MORNING_BRIEF', createdAt: '2026-01-01', traceId: 't',
    authoritative: { productName: over.product === undefined ? 'Acme' : over.product, category: null, markets: [], plan: 'solo' },
    founderContext: {
      audienceConfirmed: over.audience ?? null, contextDelta: null, workingStyle: null,
      primaryGoal: over.goal ?? null, nextInitiative: null, targetWindow: null,
      confirmedIcp: null,
      competitors: (over.competitors ?? []).map(name => ({ name, relationship: 'direct', differentiator: null })),
      strategyDirection: null,
    },
    retrievedMemories: (over.memories ?? []).map((m, i) => ({
      id: `mem-${i}`, workspaceId: 'ws', productId: 'p', memoryType: 'product',
      title: m.title, claim: m.claim ?? m.title, content: {}, confidence: 0.8, version: 1,
      status: 'active', source: 'growth_brain',
      authorityTier: m.tier ?? null, memoryClass: m.tier ? 'FACT' : null, evidenceIds: [],
      createdAt: '2026-01-01', updatedAt: '2026-01-01', contentHash: null,
      embeddingStatus: 'current', arms: ['structured'], lexicalRank: null, semanticRank: null,
      semanticDistance: null, fusedScore: 1, fusedRank: 1, finalRank: i + 1, rerankReasons: [],
    })),
    operational: { activeCampaigns: [], recentMetrics: over.metrics ?? [], knowledgeNodes: [] },
    retrieval: { memoryOutcome: 'selected', memoriesConsidered: 0, memoriesSelected: 0, mode: 'HYBRID', degraded: false, degradedReasons: [] },
    budget: { total: 8000, used: 100, memoryBudget: 2000, memoryUsed: 50 }, buildMs: 1,
  } as unknown as ContextPackageV2;
}

const refsOf = (h: EvidenceHandle[]) => h.map(x => x.ref);

describe('output grounding — the frozen 12-case matrix (P0)', () => {
  it('A — invented Google Ads +31% with NO campaign data is dropped', () => {
    const h = issueEvidenceHandles(pkg({ goal: 'Grow homeowner bookings' }));
    const out = groundClaims([{
      type: 'OBSERVATION',
      text: 'Your Google Ads conversion rate increased 31% last week',
      evidenceRefs: ['goal'],
    }], h);
    expect(out.claims).toHaveLength(0);
    expect(out.dropped[0].reason).toBe('CATEGORY_CANNOT_SUPPORT_CLAIM');
  });

  it('B — an unrelated real memory cannot legitimise an invented CTR figure', () => {
    const h = issueEvidenceHandles(pkg({
      memories: [{ title: 'Homeowners respond to trust badges', tier: 'OBSERVED_FIRST_PARTY' }],
    }));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'CTR improved 18% month over month', evidenceRefs: ['m1'],
    }], h);
    // The memory CAN carry measurements in principle, but not THIS one.
    expect(out.claims).toHaveLength(0);
    expect(out.dropped[0].reason).toBe('UNSUPPORTED_MEASUREMENT');
  });

  it('C — a real metric accurately referenced survives as an OBSERVATION', () => {
    const h = issueEvidenceHandles(pkg({
      metrics: [{ channel: 'meta', installs: 420, cpi: 3.5, weekStart: '2026-01-05' }],
    }));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Meta drove 420 installs last week', evidenceRefs: ['perf'],
    }], h);
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].type).toBe('OBSERVATION');
    expect(refsOf(out.claims[0].refs)).toContain('perf');
  });

  it('D — a real metric exists but the model invents a DIFFERENT value → rejected', () => {
    const h = issueEvidenceHandles(pkg({
      metrics: [{ channel: 'meta', installs: 420, cpi: 3.5, weekStart: '2026-01-05' }],
    }));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Meta drove 980 installs last week', evidenceRefs: ['perf'],
    }], h);
    expect(out.claims).toHaveLength(0);
    expect(out.dropped[0].reason).toBe('UNSUPPORTED_MEASUREMENT');
  });

  it('E — product-only workspace: fabricated performance is withheld', () => {
    const h = issueEvidenceHandles(pkg({ product: 'Acme' }));
    const out = groundClaims([
      { type: 'OBSERVATION', text: 'Conversion is down 14% this month', evidenceRefs: ['product'] },
      { type: 'OBSERVATION', text: 'CAC decreased from $42 to $31', evidenceRefs: ['product'] },
    ], h);
    expect(out.claims).toHaveLength(0);
    expect(out.dropped).toHaveLength(2);
  });

  it('F — founder premium direction vs derived discount guidance → conflict detected', () => {
    const h = issueEvidenceHandles(pkg({
      memories: [{ title: 'Premium positioning improves brand perception', tier: 'FOUNDER_ASSERTED' }],
    }));
    const conflict = detectFounderConflict(
      'Premium positioning reduces brand perception, so discount instead', h);
    expect(conflict).not.toBeNull();
    expect(conflict?.kind).toBe('MARKETING_MEMORY');
  });

  it('G — a COMPATIBLE founder-aligned recommendation is NOT blocked', () => {
    const h = issueEvidenceHandles(pkg({
      memories: [{ title: 'Premium positioning improves brand perception', tier: 'FOUNDER_ASSERTED' }],
    }));
    expect(detectFounderConflict(
      'Premium positioning improves brand perception further with proof points', h)).toBeNull();
    // ...and an unrelated subject does not trip it either — no blanket block.
    expect(detectFounderConflict('Reduce email send frequency', h)).toBeNull();
  });

  it('H — a real memory supporting a qualitative claim shows memory provenance', () => {
    const h = issueEvidenceHandles(pkg({
      memories: [{ title: 'Trust badges lift bookings', tier: 'OBSERVED_FIRST_PARTY' }],
    }));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Trust badges have helped bookings before', evidenceRefs: ['m1'],
    }], h);
    expect(out.claims[0].refs[0].kind).toBe('MARKETING_MEMORY');
    expect(out.claims[0].refs[0].authority).toBe('OBSERVED_FIRST_PARTY');
  });

  it('I — evidence NOT cited is never attached as support', () => {
    const p = pkg({
      goal: 'Grow homeowner bookings',
      memories: [{ title: 'Unrelated email cadence finding', tier: 'OBSERVED_FIRST_PARTY' }],
      competitors: ['Thumbtack'],
    });
    const h = issueEvidenceHandles(p);
    const out = groundClaims([{
      type: 'INFERENCE', text: 'Focus experiments on homeowner bookings', evidenceRefs: ['goal'],
    }], h);
    const attached = refsOf(out.claims[0].refs);
    expect(attached).toEqual(['goal']);
    expect(attached).not.toContain('m1');
    expect(attached).not.toContain('competitors');
  });

  it('J — a nonexistent evidence reference is discarded', () => {
    const h = issueEvidenceHandles(pkg({ goal: 'Grow bookings' }));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Bookings look healthy', evidenceRefs: ['ga4_dashboard', 'stripe', 'nope'],
    }], h);
    // Nothing resolved → cannot stand as an observation.
    expect(out.claims[0].type).toBe('INFERENCE');
    expect(out.claims[0].refs).toHaveLength(0);
    expect(out.downgraded).toBe(1);
  });

  it('K — a cross-product handle cannot resolve', () => {
    // Handles are issued from THIS package. A ref naming another business's
    // evidence is unresolvable by construction, not by a filter.
    const h = issueEvidenceHandles(pkg({ goal: 'Product A goal' }));
    const out = groundClaims([{
      type: 'OBSERVATION', text: 'Product B saw stronger results', evidenceRefs: ['productB_perf', 'm99'],
    }], h);
    expect(out.claims[0].refs).toHaveLength(0);
    expect(out.claims[0].type).toBe('INFERENCE');
  });

  it('L — a prospective inference with no historical assertion is allowed', () => {
    const h = issueEvidenceHandles(pkg({ goal: 'Grow homeowner bookings' }));
    const out = groundClaims([{
      type: 'INFERENCE',
      text: 'Testing clearer outcome-led messaging may improve conversion',
      evidenceRefs: ['goal'],
    }], h);
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].type).toBe('INFERENCE');
    expect(refsOf(out.claims[0].refs)).toContain('goal');
  });
});

describe('measured-claim detection (the load-bearing predicate)', () => {
  it('recognises invented historical measurements', () => {
    for (const t of [
      'Your Google Ads conversion rate increased 31% last week',
      'CTR improved 18% month over month',
      'CAC decreased from $42 to $31',
      'Conversion is down 14% this month',
    ]) expect(isMeasuredHistoricalClaim(t), t).toBe(true);
  });

  it('does NOT treat prospective language as a measurement', () => {
    for (const t of [
      'Testing clearer outcome-led messaging may improve conversion',
      'Aim for a 20% lift in bookings',
      'Clarify the primary conversion goal before optimizing campaigns',
      'Trust badges have helped bookings before',
    ]) expect(isMeasuredHistoricalClaim(t), t).toBe(false);
  });
});
