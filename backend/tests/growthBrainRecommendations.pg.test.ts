/**
 * @file growthBrainRecommendations.pg.test.ts
 * @description Phase 3.3C acceptance matrix — grounded, typed, business-scoped
 *   Growth Brain recommendations.
 *
 *   Drives the REAL service against a real database. The model call is the only
 *   thing stubbed, and it is stubbed to be HOSTILE: it returns fabricated
 *   provenance claims, everything labelled OBSERVATION, and a spend action —
 *   because the property under test is that the SERVICE, not the model, decides
 *   provenance, evidence strength, information type and approval. A cooperative
 *   stub would prove nothing.
 *
 *   Nothing about scoping, provenance or typing is reimplemented here.
 *
 * @security Two businesses under ONE founder: a founder-wide read passes a naive
 *   tenant test, so isolation is asserted per-business in both directions.
 * @dependencies growthBrainRecommendationService (real), contextPackageV2 (real),
 *   local Postgres
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';

/** A deliberately untrustworthy model: over-claims on every axis we guard. */
vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({
    recommendations: [
      {
        what: 'Increase paid spend on Google Ads',
        whyNow: 'Momentum is building',
        expectedEffect: 'More bookings',
        nextStep: 'Raise the daily budget',
        actionType: 'CHANGE_SPEND',
        // Cites a REAL handle for a fabricated measurement, plus a handle the
        // server never issued. Both paths must be refused.
        evidenceRefs: ['goal', 'ga4_dashboard'],
        supporting: [
          { type: 'OBSERVATION', text: 'Your Google Ads conversion rate rose 31% last week', evidenceRefs: ['goal'] },
          { type: 'OBSERVATION', text: 'Competitors are spending more', evidenceRefs: ['ga4_dashboard'] },
        ],
      },
      { what: 'Rewrite the landing page', whyNow: 'Trust matters', expectedEffect: null,
        nextStep: 'Draft a variant', actionType: 'DRAFT_CONTENT',
        evidenceRefs: ['m1'],
        supporting: [{ type: 'INFERENCE', text: 'Trust messaging may be weak', evidenceRefs: ['m1'] }] },
      { what: 'Third idea', whyNow: 'Because', expectedEffect: null, nextStep: 'Look into it',
        actionType: 'RESEARCH', evidenceRefs: ['product'], supporting: [] },
      { what: 'FOURTH idea that must be dropped', whyNow: 'Overflow', expectedEffect: null,
        nextStep: 'Overflow next step', actionType: 'RESEARCH', evidenceRefs: ['product'], supporting: [] },
    ],
  })),
  callHaiku: vi.fn(async () => '{}'),
  callMessages: vi.fn(async () => '{}'),
  generateAI: vi.fn(async () => ({ text: '{}' })),
}));

const {
  generateGrowthBrainRecommendations, deriveProvenance, deriveEvidenceStrength,
} = await import('../src/services/growthBrainRecommendationService');

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const F   = uuidFrom('gbr-founder');
const WSA = uuidFrom('gbr-ws-a');
const WSB = uuidFrom('gbr-ws-b');
const PA  = uuidFrom('gbr-prod-a');
const PB  = uuidFrom('gbr-prod-b');
const WSE = uuidFrom('gbr-ws-empty');
/** Product only: provenance exists, but no data can back an OBSERVATION. */
const WSC = uuidFrom('gbr-ws-bare');
/** Founder memory that directly opposes the stub's spend recommendation. */
const WSF = uuidFrom('gbr-ws-founder');
const PF  = uuidFrom('gbr-prod-founder');
const PC  = uuidFrom('gbr-prod-bare');

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

const NORM = normalizeMemoryScope({ geography: 'usa' });

// Titles deliberately share vocabulary with the service's fixed retrieval query
// ("most important marketing priorities for this product") so the lexical arm
// can find them without embeddings. The DISTINCTIVE token is what the isolation
// assertions match on.
const A_MEMORY = 'AAAALPHATRUST marketing priorities for this product';
const B_MEMORY = 'BBBBETADISCOUNT marketing priorities for this product';
const A_GOAL   = 'AAA_GOAL_BOOKINGS_ALPHA';
const B_GOAL   = 'BBB_GOAL_SIGNUPS_BETA';

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

async function seed(ws: string, prod: string, memory: string, goal: string, tier: string | null) {
  await must('workspaces', db().from('workspaces').upsert(
    { id: ws, founder_id: F, name: `GBR ${ws.slice(0, 4)}` }, { onConflict: 'id' }));
  await must('products', db().from('products').upsert({
    id: prod, founder_id: F, workspace_id: ws, name: `GBR ${memory.slice(0, 8)}`,
    store_url: 'https://gbr.invalid', platform: 'app_store',
  }, { onConflict: 'id' }));

  const sessionId = uuidFrom(`gbr-ses-${ws}`);
  await must('onboarding_sessions', db().from('onboarding_sessions').upsert({
    id: sessionId, founder_id: F, product_id: prod, workspace_id: ws,
    current_state: 'PHASE_1_COMPLETE',
  }, { onConflict: 'id' }));
  await must('founder_context', db().from('founder_context').upsert({
    id: uuidFrom(`gbr-fc-${ws}`), session_id: sessionId, founder_id: F,
    product_id: prod, workspace_id: ws,
    audience_confirmed: `${goal} audience`, context_delta: `${goal} delta`,
  }, { onConflict: 'id' }));
  await must('business_goals', db().from('business_goals').upsert({
    id: uuidFrom(`gbr-goal-${ws}`), session_id: sessionId, founder_id: F, product_id: prod,
    goal_type: 'custom', target_value: 20, unit: goal, time_horizon_days: 90,
  }, { onConflict: 'id' }));

  await must('marketing_memories', db().from('marketing_memories').upsert({
    id: uuidFrom(`gbr-mem-${ws}`), founder_id: F, product_id: prod, workspace_id: ws,
    memory_type: 'product', title: memory, content: { claim: memory },
    source: 'growth_brain', confidence: 0.8, status: 'active', version: 1,
    evidence_ids: [],
    // Migration 099: a GOVERNED row must carry class + authority + policy
    // version + a resolved scope. A legacy row keeps the null-tier shape, which
    // is the discriminator this test depends on.
    ...(tier
      ? {
          memory_class: 'FACT', authority_tier: tier, authority_policy_version: 1,
          scope: NORM.scope, scope_key: NORM.scopeKey,
          scope_specificity: NORM.specificity, scope_completeness: NORM.completeness,
        }
      : { scope: {}, scope_specificity: 0, scope_completeness: 'unknown' }),
  }, { onConflict: 'id' }));
}

const run = (ws: string, prod: string | null) =>
  generateGrowthBrainRecommendations({ workspaceId: ws, founderId: F, productId: prod });

d('Phase 3.3C — Growth Brain recommendations', () => {
  beforeAll(async () => {
    await must('founders', db().from('founders').upsert(
      { id: F, email: 'gbr@lab.invalid', name: 'GBR LAB', plan: 'studio' }, { onConflict: 'id' }));
    // B is richer AND governed founder-tier, so any leak into A is unmistakable.
    await seed(WSA, PA, A_MEMORY, A_GOAL, null);              // legacy, null tier
    await seed(WSB, PB, B_MEMORY, B_GOAL, 'FOUNDER_ASSERTED');
    await must('workspaces', db().from('workspaces').upsert(
      { id: WSE, founder_id: F, name: 'GBR EMPTY' }, { onConflict: 'id' }));
    await must('workspaces', db().from('workspaces').upsert(
      { id: WSC, founder_id: F, name: 'GBR BARE' }, { onConflict: 'id' }));
    await must('products', db().from('products').upsert({
      id: PC, founder_id: F, workspace_id: WSC, name: 'GBR BARE PRODUCT',
      store_url: 'https://gbr.invalid', platform: 'app_store',
    }, { onConflict: 'id' }));
    // Founder-asserted direction that OPPOSES the stub's "increase paid spend".
    await seed(WSF, PF, 'Paid spend on Google Ads reduces efficiency for this product',
      'AAA_GOAL_FOUNDER', 'FOUNDER_ASSERTED');
  }, 300_000);

  afterAll(async () => {
    for (const p of [PA, PB]) {
      await db().from('marketing_memories').delete().eq('product_id', p);
      await db().from('business_goals').delete().eq('product_id', p);
      await db().from('founder_context').delete().eq('product_id', p);
      await db().from('onboarding_sessions').delete().eq('product_id', p);
    }
    await db().from('marketing_memories').delete().eq('product_id', PF);
    await db().from('business_goals').delete().eq('product_id', PF);
    await db().from('founder_context').delete().eq('product_id', PF);
    await db().from('onboarding_sessions').delete().eq('product_id', PF);
    await db().from('products').delete().in('id', [PA, PB, PC, PF]);
    await db().from('workspaces').delete().in('id', [WSA, WSB, WSE, WSC, WSF]);
    await db().from('founders').delete().eq('id', F);
  });

  it('CASE A — a memory-informed recommendation uses A, never B', async () => {
    const res = await run(WSA, PA);
    const blob = JSON.stringify(res);
    expect(blob, 'B memory leaked into A').not.toContain('BBBBETADISCOUNT');
    expect(blob, 'B goal leaked into A').not.toContain(B_GOAL);
    // A's own memory really is available as a source.
    expect(res.recommendations.some(r =>
      r.supportedBy.some(p => p.kind === 'MARKETING_MEMORY' && p.label === A_MEMORY))).toBe(true);
  }, 300_000);

  it('CASE G — reversed: B sees only B', async () => {
    const res = await run(WSB, PB);
    const blob = JSON.stringify(res);
    expect(blob, 'A memory leaked into B').not.toContain('AAAALPHATRUST');
    expect(blob, 'A goal leaked into B').not.toContain(A_GOAL);
    expect(blob).toContain('BBBBETADISCOUNT');
  }, 300_000);

  it('CASE B — founder authority is carried, and legacy is not promoted', async () => {
    const b = await run(WSB, PB);
    const bMem = b.recommendations.flatMap(r => r.supportedBy).find(p => p.kind === 'MARKETING_MEMORY');
    expect(bMem?.authority).toBe('FOUNDER_ASSERTED');
    expect(bMem?.detail).toBe('You told LaunchMind this');

    // A's memory is legacy (null tier). Its source must NOT make it founder.
    const a = await run(WSA, PA);
    const aMem = a.recommendations.flatMap(r => r.supportedBy).find(p => p.kind === 'MARKETING_MEMORY');
    expect(aMem?.authority).toBe('UNKNOWN_LEGACY');
    expect(aMem?.authority).not.toMatch(/FOUNDER_/);
  }, 300_000);

  it('CASE D — provenance is derived from real sources, not model claims', async () => {
    const res = await run(WSA, PA);
    // Provenance is now CLAIM-LEVEL: only what this recommendation cited AND
    // that resolved. The first recommendation cited `goal` and a handle that
    // does not exist, so only the goal may appear.
    const kinds = res.recommendations[0].supportedBy.map(p => p.kind);
    expect(kinds).toContain('BUSINESS_GOAL');
    expect(kinds).not.toContain('CAMPAIGN_PERFORMANCE');
    expect(kinds).not.toContain('MARKET_INTELLIGENCE');
    // The fabricated +31% measurement must have been withheld, not shown.
    expect(JSON.stringify(res.recommendations)).not.toContain('31%');
    expect(res.withheld.some(w => w.reason === 'CATEGORY_CANNOT_SUPPORT_CLAIM'
      || w.reason === 'UNSUPPORTED_MEASUREMENT')).toBe(true);
  }, 300_000);

  it('CASE E — an OBSERVATION with no backing data is downgraded to INFERENCE', async () => {
    // A product-only workspace: enough provenance to produce recommendations,
    // but nothing that can back a DIRECT observation. The empty workspace is
    // useless here — it returns zero recommendations, so the assertion would be
    // vacuous and the guard would not be load-bearing.
    const bare = await run(WSC, PC);
    expect(bare.recommendations.length, 'fixture must produce recommendations').toBeGreaterThan(0);
    const items = bare.recommendations.flatMap(r => r.supporting);

    // The fabricated measurement is GONE entirely (dropped, not downgraded),
    // and anything left that the model called OBSERVATION has no resolvable
    // backing, so it must read as INFERENCE.
    // The fabricated measurement must not survive ANYWHERE owner-visible —
    // including the withheld list, which carries reasons only.
    expect(JSON.stringify(bare)).not.toContain('31%');
    expect(items.every(s => s.type === 'INFERENCE'), 'an unbacked OBSERVATION survived').toBe(true);

    // Under CLAIM-level grounding the hostile stub cannot produce a surviving
    // OBSERVATION for the richer product either: its measured claim is dropped
    // and its other "observation" cites a handle the server never issued. That
    // is the correct outcome, not a gap — the positive path (a real metric,
    // accurately referenced, surviving as an OBSERVATION) is CASE C of
    // growthBrainOutputGrounding.test.ts, which uses a truthful citation.
    const a = await run(WSA, PA);
    expect(a.recommendations.flatMap(r => r.supporting).every(s => s.type === 'INFERENCE')).toBe(true);
  }, 300_000);

  it('CASE F — an empty business fabricates nothing', async () => {
    const res = await run(WSE, null);
    const blob = JSON.stringify(res);
    expect(res.marketIntelligenceAvailable).toBe(false);
    expect(res.unavailable.join(' ')).toMatch(/performance data/i);
    expect(res.unavailable.join(' ')).toMatch(/market intelligence/i);
    // No invented performance, benchmark or gain reaches the owner.
    expect(blob).not.toMatch(/\d+%/);
    for (const rec of res.recommendations) {
      expect(rec.confidence).toBeNull();
      expect(rec.evidenceStrength).toBe('insufficient evidence');
    }
  }, 300_000);

  it('CASE H — no arbitrary confidence anywhere; strength is derived', async () => {
    for (const [ws, prod] of [[WSA, PA], [WSB, PB], [WSE, null]] as const) {
      const res = await run(ws, prod);
      const blob = JSON.stringify(res);
      expect(blob).not.toContain('"confidence":0.5');
      for (const rec of res.recommendations) expect(rec.confidence).toBeNull();
    }
    // Derived from inputs that exist: neither product has performance data.
    const a = await run(WSA, PA);
    expect(a.recommendations[0].evidenceStrength).toBe('limited evidence');
  }, 300_000);

  it('CASE I — at most three recommendations', async () => {
    // The stub returns FOUR; the service must drop the overflow.
    const res = await run(WSA, PA);
    expect(res.recommendations.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(res)).not.toContain('FOURTH idea');
  }, 300_000);

  it('CASE F/service — founder-conflicting guidance is flagged, never established', async () => {
    // The stub recommends "Increase paid spend on Google Ads"; the founder
    // asserted that paid spend REDUCES efficiency. Exercises the guard through
    // the SERVICE, not the exported predicate — removing the wiring must fail.
    const res = await run(WSF, PF);
    const spend = res.recommendations.find(r => /spend/i.test(r.what));
    expect(spend, 'fixture must produce the spend recommendation').toBeDefined();
    expect(spend!.founderConflict, 'founder conflict not detected').not.toBeNull();
    expect(spend!.requiresFounderReview).toBe(true);
    // Conflicting guidance can never be actioned without the owner.
    expect(spend!.requiresApproval).toBe(true);
  }, 300_000);

  it('CASE G/service — a NON-conflicting business is not blanket-blocked', async () => {
    const res = await run(WSA, PA);
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.recommendations.every(r => r.founderConflict === null)).toBe(true);
    expect(res.recommendations.every(r => r.requiresFounderReview === false)).toBe(true);
  }, 300_000);

  it('approval is decided by LaunchMind, not by the model', async () => {
    const res = await run(WSA, PA);
    const spend = res.recommendations.find(r => /spend/i.test(r.what));
    const draft = res.recommendations.find(r => /landing page/i.test(r.what));
    expect(spend?.requiresApproval).toBe(true);
    expect(draft?.requiresApproval).toBe(false);
  }, 300_000);

  it('every recommendation answers the full owner contract', async () => {
    const res = await run(WSA, PA);
    for (const r of res.recommendations) {
      expect(r.type).toBe('RECOMMENDATION');
      expect(r.what.length).toBeGreaterThan(0);
      expect(r.whyNow.length).toBeGreaterThan(0);
      expect(r.nextStep.length).toBeGreaterThan(0);
      expect(r.supportedBy.length).toBeGreaterThan(0);
      expect(typeof r.requiresApproval).toBe('boolean');
      expect(r.confidence).toBeNull();
    }
  }, 300_000);
});

d('Phase 3.3C — derivation helpers on real packages', () => {
  it('evidence strength never reports strong without measured performance', async () => {
    const res = await run(WSA, PA);
    expect(res.recommendations[0].evidenceStrength).not.toBe('strong evidence');
  }, 300_000);
});

export { deriveProvenance, deriveEvidenceStrength };
