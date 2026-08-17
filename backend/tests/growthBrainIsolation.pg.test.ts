/**
 * @file growthBrainIsolation.pg.test.ts
 * @description P0 GATE — Growth Brain business isolation + measurement honesty.
 *
 *   MEASURED DEFECTS (3.3A), all against real owner data:
 *     · owner.route read `marketing_memories` by founder_id only. Both real
 *       businesses carry populated product_id/workspace_id (zero nulls), so
 *       "top 3 by confidence, founder-wide" spanned both companies.
 *     · intelligenceService read `products` as "the founder's newest product
 *       across every workspace" — while `scopedProductIds` sat computed two
 *       queries above and was used by its three neighbours. That row drives two
 *       dimension scores, the context summary and the recommended source.
 *     · `onboarding_sessions` selected product_id and never filtered on it, so
 *       completing onboarding for B marked A's direction confirmed.
 *     · the `learning_events` fallback fires exactly when a workspace is new —
 *       so a brand-new business reliably rendered the other one's event.
 *     · an empty workspace rendered "18% grounded in evidence" from three
 *       hardcoded floors (40/20/35) with nothing connected.
 *
 *   These drive the REAL exported service against a real database. Query logic
 *   is not reproduced here — a helper that rebuilt the filters would certify the
 *   helper and not the code path.
 *
 * @security Two businesses of ONE founder. Founder-wide reads pass a naive
 *   tenant test, so isolation is asserted per-business, not per-founder.
 * @dependencies intelligenceService (real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import { getGrowthBrainCoverage } from '../src/services/intelligenceService';
import type { WorkspaceContext } from '../src/services/workspaceAuthService';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const F   = uuidFrom('gbi-founder');
const WSA = uuidFrom('gbi-ws-a');
const WSB = uuidFrom('gbi-ws-b');
const PA  = uuidFrom('gbi-prod-a');
const PB  = uuidFrom('gbi-prod-b');
/** A third workspace with nothing in it at all — the honesty case. */
const WSE = uuidFrom('gbi-ws-empty');

const db = () => getSupabaseAdmin();
// Fail-closed under `npm run test:pg`; may skip in a normal unit run.
const d = requirePostgres().available ? describe : describe.skip;

const ctxFor = (workspaceId: string): WorkspaceContext =>
  ({ actorId: F, workspaceId, role: 'owner', isOwner: true }) as WorkspaceContext;

/** Deliberately conflicting values, so any leak is unmistakable in an assertion. */
const A = {
  positioning: 'AAA_POSITIONING_ALPHA_ONLY',
  audience:    'AAA_AUDIENCE_ALPHA_ONLY',
  delta:       'AAA_DELTA_ALPHA_ONLY',
  goal:        'AAA_GOAL_ALPHA_ONLY',
  competitor:  'AAA_COMPETITOR_ALPHA_ONLY',
  headline:    'AAA_HEADLINE_ALPHA_ONLY',
};
const B = {
  positioning: 'BBB_POSITIONING_BETA_ONLY',
  audience:    'BBB_AUDIENCE_BETA_ONLY',
  delta:       'BBB_DELTA_BETA_ONLY',
  goal:        'BBB_GOAL_BETA_ONLY',
  competitor:  'BBB_COMPETITOR_BETA_ONLY',
  headline:    'BBB_HEADLINE_BETA_ONLY',
};

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

async function seedBusiness(
  ws: string, prod: string, v: typeof A, createdAt: string, onboardingState: string,
) {
  await must('workspaces', db().from('workspaces').upsert({ id: ws, founder_id: F, name: `GBI ${ws.slice(0, 4)}` }, { onConflict: 'id' }));
  await must('products', db().from('products').upsert({
    id: prod, founder_id: F, workspace_id: ws, name: `GBI ${v.positioning}`,
    store_url: 'https://gbi.invalid', platform: 'app_store',
    category: v.positioning, created_at: createdAt,
    confirmed_icp: { positioning: v.positioning, audience: v.audience },
    scraped_meta: { description: v.positioning },
  }, { onConflict: 'id' }));
  const sessionId = uuidFrom(`gbi-ob-${ws}`);
  await must('onboarding_sessions', db().from('onboarding_sessions').upsert({
    id: sessionId, founder_id: F, product_id: prod, workspace_id: ws,
    current_state: onboardingState,
    // Explicit: the defective read ordered by created_at desc and took limit(1)
    // founder-wide. Leaving this to insert order made the mutation test
    // non-deterministic — it passed under mutation, which is a dead guard.
    created_at: createdAt,
  }, { onConflict: 'id' }));
  await must('founder_context', db().from('founder_context').upsert({
    id: uuidFrom(`gbi-fc-${ws}`), session_id: sessionId, founder_id: F, product_id: prod, workspace_id: ws,
    audience_confirmed: v.audience, context_delta: v.delta,
  }, { onConflict: 'id' }));
  await must('business_goals', db().from('business_goals').upsert({
    id: uuidFrom(`gbi-goal-${ws}`), session_id: sessionId, founder_id: F, product_id: prod,
    goal_type: 'custom', target_value: 10, unit: v.goal, time_horizon_days: 90,
  }, { onConflict: 'id' }));
  await must('competitor_relationships', db().from('competitor_relationships').upsert({
    id: uuidFrom(`gbi-comp-${ws}`), session_id: sessionId, founder_id: F, product_id: prod,
    name: v.competitor, relationship: 'CONFIRMED',
  }, { onConflict: 'id' }));
  await must('strategy_directions', db().from('strategy_directions').upsert({
    id: uuidFrom(`gbi-dir-${ws}`), session_id: sessionId, founder_id: F, product_id: prod,
    headline: v.headline, rationale: v.headline, status: 'acknowledged',
    acknowledged_at: new Date('2026-01-01').toISOString(),
  }, { onConflict: 'id' }));
}

/** Every value that belongs ONLY to the other business. */
const foreignValues = (v: typeof A) => Object.values(v);

d('Growth Brain business isolation (production path)', () => {
  beforeAll(async () => {
    await must('founders', db().from('founders').upsert(
      { id: F, email: 'gbi@lab.invalid', name: 'GBI LAB', plan: 'studio' }, { onConflict: 'id' }));
    // B is created LATER than A on purpose: the defective query took the
    // founder's NEWEST product, so B must be the newest for the test to bite.
    await seedBusiness(WSA, PA, A, '2026-01-01T00:00:00Z', 'DIRECTION_COMPLETE');
    await seedBusiness(WSB, PB, B, '2026-06-01T00:00:00Z', 'PHASE_1_COMPLETE');
    await must('workspaces', db().from('workspaces').upsert(
      { id: WSE, founder_id: F, name: 'GBI EMPTY' }, { onConflict: 'id' }));
  }, 240_000);

  afterAll(async () => {
    for (const p of [PA, PB]) {
      await db().from('strategy_directions').delete().eq('product_id', p);
      await db().from('competitor_relationships').delete().eq('product_id', p);
      await db().from('business_goals').delete().eq('product_id', p);
      await db().from('founder_context').delete().eq('product_id', p);
      await db().from('onboarding_sessions').delete().eq('product_id', p);
    }
    await db().from('products').delete().in('id', [PA, PB]);
    await db().from('workspaces').delete().in('id', [WSA, WSB, WSE]);
    await db().from('founders').delete().eq('id', F);
  });

  it('A sees only A — no value belonging to B appears anywhere', async () => {
    const cov = await getGrowthBrainCoverage(ctxFor(WSA));
    const blob = JSON.stringify(cov);
    for (const foreign of foreignValues(B)) {
      expect(blob, `business B value leaked into A: ${foreign}`).not.toContain(foreign);
    }
    // ...and A's own values ARE present, so the test cannot pass by returning nothing.
    expect(blob).toContain(A.positioning);
  }, 240_000);

  it('B sees only B — reversed', async () => {
    const cov = await getGrowthBrainCoverage(ctxFor(WSB));
    const blob = JSON.stringify(cov);
    for (const foreign of foreignValues(A)) {
      expect(blob, `business A value leaked into B: ${foreign}`).not.toContain(foreign);
    }
    expect(blob).toContain(B.positioning);
  }, 240_000);

  it('the NEWEST-product defect specifically: A does not inherit B positioning', async () => {
    // B was created five months after A. The old query ordered by created_at
    // desc and took limit(1) founder-wide, so this is the exact regression.
    const cov = await getGrowthBrainCoverage(ctxFor(WSA));
    expect(cov.contextSummary.positioning).not.toBe(B.positioning);
    expect(cov.contextSummary.positioning).toBe(A.positioning);
  }, 240_000);

  it('onboarding state does not cross businesses', async () => {
    // A is DIRECTION_COMPLETE, B is PHASE_1_COMPLETE. The founder-wide read
    // took the newest session (B) and credited A with it.
    const a = await getGrowthBrainCoverage(ctxFor(WSA));
    const b = await getGrowthBrainCoverage(ctxFor(WSB));
    // B is PHASE_1_COMPLETE and earns the readiness credit; A is
    // DIRECTION_COMPLETE and must NOT. Asserted as a strict inequality in a
    // known direction — "they differ" would pass for the wrong reason.
    const founderDim = (c: Awaited<ReturnType<typeof getGrowthBrainCoverage>>) =>
      c.dimensions.find(x => x.label === 'Founder direction')?.score ?? null;
    // Direction, not magnitude: B earns the readiness credit and A does not, so
    // A must score strictly LOWER. Asserting an absolute number would couple
    // this test to every other term in the formula; asserting merely "they
    // differ" would pass for the wrong reason. Under the founder-wide read both
    // take B's session and the inequality collapses.
    expect(founderDim(a)).not.toBeNull();
    expect(founderDim(b)).not.toBeNull();
    expect(founderDim(a)!).toBeLessThan(founderDim(b)!);
  }, 240_000);
});

d('Growth Brain measurement honesty (production path)', () => {
  it('an EMPTY workspace reports 0, not a fabricated floor', async () => {
    const cov = await getGrowthBrainCoverage(ctxFor(WSE));

    // The three inferred dimensions carried hardcoded bases 40 / 20 / 35, which
    // floored the overall at 18% for a workspace with nothing in it.
    expect(cov.overallScore).toBe(0);
    expect(cov.overallScore).not.toBe(18);
    for (const dim of cov.dimensions) {
      expect(dim.score === null || dim.score === 0,
        `dimension "${dim.label}" reported ${dim.score} for an empty workspace`).toBe(true);
    }
  }, 240_000);

  it('an empty workspace fabricates no observation text', async () => {
    const cov = await getGrowthBrainCoverage(ctxFor(WSE));
    const blob = JSON.stringify(cov);
    expect(blob).not.toContain('Understood from App Store listing');
    expect(blob).not.toContain('Demand from public product signals');
    expect(cov.contextSummary.positioning).toBeNull();
    expect(cov.contextSummary.topSignal).toBeNull();
  }, 240_000);

  it('no projected-lift number is offered without a measured basis', async () => {
    for (const ws of [WSA, WSE]) {
      const cov = await getGrowthBrainCoverage(ctxFor(ws));
      if (cov.recommendedSource) {
        expect(cov.recommendedSource.expectedGain).toBeNull();
      }
      // The old literals, in the rendered form `X% → Y%`.
      expect(JSON.stringify(cov)).not.toMatch(/"expectedGain":"\d+% → \d+%"/);
    }
  }, 240_000);
});
