/**
 * @file actionEquivalence.pg.test.ts
 * @description P0 GATE — action-equivalence suppression (Phase 3.3E remediation).
 *
 *   MEASURED P0 (browser certification): the owner approved "Define a real ICP
 *   before any marketing activity begins". A reload regenerated the same action
 *   with whyNow and nextStep merely rephrased. The exact-snapshot fingerprint
 *   legitimately changed, a new RECOMMENDED row appeared, and the already-
 *   approved action looked outstanding again. The browser rendered server truth
 *   correctly — the server's notion of "outstanding" was wrong.
 *
 *   THE CONTRACT: two identities, answering two different questions.
 *     fingerprint — the exact grounded snapshot the owner saw (audit)
 *     action_key  — what the owner is being asked to decide (outstanding-ness)
 *
 *   Rewording an argument is not a new decision. Changing the action, the
 *   founder-conflict state or the approval requirement IS.
 *
 *   Drives the real exported service against a real database.
 *
 * @security Cases I/J prove the action key cannot match across products or
 *   workspaces, so a settled action in one business can never suppress another.
 * @dependencies growthBrainDecisionService (real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import {
  persistRecommendations, decideRecommendation, actionKeyOf, fingerprintOf,
  legacyActionKeyOf, RECOMMENDATION_CONTRACT_VERSION,
} from '../src/services/growthBrainDecisionService';
import {
  ownerActionFamily, ACTION_TYPE_FAMILY, REQUIRES_APPROVAL, OWNER_ACTION_FAMILIES,
  resolveOwnerActionIntent, resolveActionTarget, type ActionType,
} from '../src/services/growthBrainRecommendationService';
import type { GrowthBrainRecommendation } from '../src/services/growthBrainRecommendationService';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const F   = uuidFrom('ae-founder');
const WSA = uuidFrom('ae-ws-a');
const WSB = uuidFrom('ae-ws-b');
const PA  = uuidFrom('ae-prod-a');
const PA2 = uuidFrom('ae-prod-a2');
const PB  = uuidFrom('ae-prod-b');
const RUN = `${Date.now()}-${process.pid}`;

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

const ctxA  = { workspaceId: WSA, founderId: F, productId: PA as string | null };
const ctxA2 = { workspaceId: WSA, founderId: F, productId: PA2 as string | null };
const ctxB  = { workspaceId: WSB, founderId: F, productId: PB as string | null };

/** The exact recommendation from the browser reproduction. */
const ICP = `Define a real Ideal Customer Profile (ICP) before any marketing activity begins ${RUN}`;

function rec(over: Partial<GrowthBrainRecommendation> = {}): GrowthBrainRecommendation {
  return {
    type: 'RECOMMENDATION', actionType: 'REVIEW_CONTEXT', what: ICP,
    whyNow: 'Original rationale as first generated',
    nextStep: 'Write the ICP down in one paragraph',
    expectedEffect: null,
    supportedBy: [{ kind: 'FOUNDER_DIRECTION', label: 'Your confirmed direction' }],
    supporting: [], founderConflict: null, requiresFounderReview: false,
    requiresApproval: false, evidenceStrength: 'limited evidence', confidence: null,
    ...over,
  } as GrowthBrainRecommendation;
}

/** The same ACTION, with only the explanation reworded — the P0 case. */
const rephrased = (extra: Partial<GrowthBrainRecommendation> = {}) => rec({
  whyNow: 'A completely different way of explaining why this matters now',
  nextStep: 'Draft the customer profile and circulate it for review',
  supportedBy: [{ kind: 'BUSINESS_GOAL', label: 'Your primary goal' }],
  evidenceStrength: 'some evidence',
  ...extra,
});

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

d('Phase 3.3E — action equivalence', () => {
  beforeAll(async () => {
    await must('founders', db().from('founders').upsert(
      { id: F, email: `ae-${RUN}@lab.invalid`, name: 'AE LAB', plan: 'studio' }, { onConflict: 'id' }));
    for (const [ws, prod] of [[WSA, PA], [WSA, PA2], [WSB, PB]] as const) {
      await must('workspaces', db().from('workspaces').upsert(
        { id: ws, founder_id: F, name: `AE ${ws.slice(0, 4)}` }, { onConflict: 'id' }));
      await must('products', db().from('products').upsert({
        id: prod, founder_id: F, workspace_id: ws, name: `AE ${prod.slice(0, 4)}`,
        store_url: 'https://ae.invalid', platform: 'app_store',
      }, { onConflict: 'id' }));
    }
  }, 300_000);

  afterAll(async () => {
    for (const p of [PA, PA2, PB]) await db().from('growth_brain_recommendations').delete().eq('product_id', p);
    await db().from('products').delete().in('id', [PA, PA2, PB]);
    await db().from('workspaces').delete().in('id', [WSA, WSB]);
    await db().from('founders').delete().eq('id', F);
  });

  it('A — an exact snapshot regeneration reuses the same row', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec()]);
    const [r2] = await persistRecommendations(ctxA, [rec()]);
    expect(r2.id).toBe(r1.id);
    expect(r2.supersededByDecisionId).toBeNull();
  }, 300_000);

  it('B/C — THE BROWSER CASE: approved, then whyNow AND nextStep rephrased', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} B` })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');

    const [r2] = await persistRecommendations(ctxA, [rephrased({ what: `${ICP} B` })]);
    // A genuinely new snapshot — history stays truthful.
    expect(r2.id).not.toBe(r1.id);
    // ...but it is NOT a fresh decision: it points at the one already made.
    expect(r2.supersededByDecisionId, 'regenerated action reappeared as outstanding').toBe(r1.id);
    // The prior approval is NOT copied onto the new snapshot.
    expect(r2.decisionStatus).toBe('RECOMMENDED');
  }, 300_000);

  it('D — a DISMISSED action does not reappear after rephrasing', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} D` })]);
    await decideRecommendation(ctxA, r1.id, 'DISMISS');
    const [r2] = await persistRecommendations(ctxA, [rephrased({ what: `${ICP} D` })]);
    expect(r2.supersededByDecisionId).toBe(r1.id);
  }, 300_000);

  it('E — a DEFERRED action is respected after rephrasing', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} E` })]);
    await decideRecommendation(ctxA, r1.id, 'DEFER');
    const [r2] = await persistRecommendations(ctxA, [rephrased({ what: `${ICP} E` })]);
    expect(r2.supersededByDecisionId).toBe(r1.id);
  }, 300_000);

  it('F — a changed actionType requires a NEW owner decision', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} F` })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what: `${ICP} F`, actionType: 'CHANGE_SPEND' })]);
    expect(r2.supersededByDecisionId, 'a different action was suppressed').toBeNull();
    expect(r2.decisionStatus).toBe('RECOMMENDED');
  }, 300_000);

  it('G — a founder-conflict change requires a NEW owner decision', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} G` })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what: `${ICP} G`, founderConflict: { withDirection: 'Maintain premium positioning' } })]);
    expect(r2.supersededByDecisionId, 'a newly conflicting action was suppressed').toBeNull();
    expect(r2.founderReviewRequired).toBe(true);
  }, 300_000);

  it('H — a materially changed approval requirement requires a NEW decision', async () => {
    // REVIEW_CONTEXT needs no approval; LAUNCH_CAMPAIGN does. Both the action
    // type and the approval requirement change, and either alone must suffice.
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} H` })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    expect(r1.requiresApproval).toBe(false);
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what: `${ICP} H`, actionType: 'LAUNCH_CAMPAIGN' })]);
    expect(r2.requiresApproval).toBe(true);
    expect(r2.supersededByDecisionId).toBeNull();
  }, 300_000);

  it('I — the same action in another PRODUCT is not equivalent', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} I` })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [other] = await persistRecommendations(ctxA2, [rec({ what: `${ICP} I` })]);
    expect(other.supersededByDecisionId, 'a decision leaked across products').toBeNull();
    expect(other.decisionStatus).toBe('RECOMMENDED');
    // The keys themselves differ.
    expect(actionKeyOf({ workspaceId: WSA, productId: PA, actionType: 'REVIEW_CONTEXT', what: ICP }))
      .not.toBe(actionKeyOf({ workspaceId: WSA, productId: PA2, actionType: 'REVIEW_CONTEXT', what: ICP }));
  }, 300_000);

  it('J — the same action in another WORKSPACE is not equivalent', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({ what: `${ICP} J` })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [other] = await persistRecommendations(ctxB, [rec({ what: `${ICP} J` })]);
    expect(other.supersededByDecisionId, 'a decision leaked across workspaces').toBeNull();
    expect(actionKeyOf({ workspaceId: WSA, productId: PA, actionType: 'REVIEW_CONTEXT', what: ICP }))
      .not.toBe(actionKeyOf({ workspaceId: WSB, productId: PB, actionType: 'REVIEW_CONTEXT', what: ICP }));
  }, 300_000);

  it('K — repeated regeneration creates no duplicate actionable rows', async () => {
    const what = `${ICP} K`;
    const [r1] = await persistRecommendations(ctxA, [rec({ what })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    for (let i = 0; i < 3; i++) {
      await persistRecommendations(ctxA, [rephrased({ what, whyNow: `variation ${i}` })]);
    }
    const { data } = await db().from('growth_brain_recommendations')
      .select('id, decision_status, superseded_by_decision_id, execution_status')
      .eq('workspace_id', WSA).eq('product_id', PA).eq('what', what);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    // Exactly one row is actionable — the decided one. Every regeneration is
    // retained for audit but linked, not offered.
    const outstanding = rows.filter(r =>
      r.decision_status === 'RECOMMENDED' && r.superseded_by_decision_id === null);
    expect(outstanding).toHaveLength(0);
    expect(rows.filter(r => r.decision_status === 'APPROVED')).toHaveLength(1);
    // No duplicate readiness for a future action.
    expect(rows.filter(r => r.execution_status === 'READY_FOR_ACTION').length).toBeLessThanOrEqual(1);
  }, 300_000);


  // ── Owner action FAMILY normalisation (final P0 closure) ──────────────────

  it('FAM A — RESEARCH → REVIEW_CONTEXT after APPROVE is already decided', async () => {
    // The exact real-model variance: same substantive action, the model simply
    // relabels it. This must not come back as a fresh decision.
    const what = `${ICP} FAM-A`;
    const T = { ownerActionIntent: 'DEFINE_AUDIENCE', actionTarget: 'ICP_DEFINITION' } as const;
    const [r1] = await persistRecommendations(ctxA, [rec({ what, actionType: 'RESEARCH', ...T })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what, actionType: 'REVIEW_CONTEXT', ...T })]);
    expect(r2.id).not.toBe(r1.id);                       // separate snapshot
    expect(r2.supersededByDecisionId, 'relabelled action reappeared').toBe(r1.id);
  }, 300_000);

  it('FAM B — REVIEW_CONTEXT → RESEARCH after DISMISS respects the dismissal', async () => {
    const what = `${ICP} FAM-B`;
    const T = { ownerActionIntent: 'DEFINE_AUDIENCE', actionTarget: 'ICP_DEFINITION' } as const;
    const [r1] = await persistRecommendations(ctxA, [rec({ what, actionType: 'REVIEW_CONTEXT', ...T })]);
    await decideRecommendation(ctxA, r1.id, 'DISMISS');
    const [r2] = await persistRecommendations(ctxA, [rephrased({ what, actionType: 'RESEARCH', ...T })]);
    expect(r2.supersededByDecisionId).toBe(r1.id);
  }, 300_000);

  it('FAM C — RESEARCH → REVIEW_CONTEXT after DEFER respects the defer', async () => {
    const what = `${ICP} FAM-C`;
    const T = { ownerActionIntent: 'DEFINE_AUDIENCE', actionTarget: 'ICP_DEFINITION' } as const;
    const [r1] = await persistRecommendations(ctxA, [rec({ what, actionType: 'RESEARCH', ...T })]);
    await decideRecommendation(ctxA, r1.id, 'DEFER');
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what, actionType: 'REVIEW_CONTEXT', ...T })]);
    expect(r2.supersededByDecisionId).toBe(r1.id);
  }, 300_000);

  it('FAM E/F — a cross-family change still requires a NEW decision', async () => {
    for (const [from, to] of [
      ['RESEARCH', 'CHANGE_SPEND'],
      ['REVIEW_CONTEXT', 'LAUNCH_CAMPAIGN'],
      ['REVIEW_CONTEXT', 'RUN_EXPERIMENT'],
    ] as const) {
      const what = `${ICP} FAM-${from}-${to}`;
      const [r1] = await persistRecommendations(ctxA, [rec({ what, actionType: from })]);
      await decideRecommendation(ctxA, r1.id, 'APPROVE');
      const [r2] = await persistRecommendations(ctxA, [rephrased({ what, actionType: to })]);
      expect(r2.supersededByDecisionId, `${from}→${to} was wrongly suppressed`).toBeNull();
      expect(r2.decisionStatus).toBe('RECOMMENDED');
    }
  }, 300_000);

  it('FAM G — RESEARCH → DRAFT_CONTENT is a DIFFERENT owner action', async () => {
    // Both need no approval today. Grouping them by approval alone would erase
    // the difference between studying the business and producing an artefact.
    const what = `${ICP} FAM-G`;
    const [r1] = await persistRecommendations(ctxA, [rec({ what, actionType: 'RESEARCH' })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what, actionType: 'DRAFT_CONTENT' })]);
    expect(r2.supersededByDecisionId, 'drafting was collapsed into analysis').toBeNull();
  }, 300_000);

  it('APPROVAL SAFETY — no family mixes approval consequences', () => {
    for (const family of OWNER_ACTION_FAMILIES) {
      const members = (Object.keys(ACTION_TYPE_FAMILY) as ActionType[])
        .filter(t => ACTION_TYPE_FAMILY[t] === family);
      const approvals = new Set(members.map(t => REQUIRES_APPROVAL[t]));
      expect(approvals.size, `family ${family} mixes approval consequences`).toBe(1);
    }
    // The pairs §3 names explicitly must never share a family.
    for (const [a, b] of [
      ['RESEARCH', 'CHANGE_SPEND'], ['REVIEW_CONTEXT', 'LAUNCH_CAMPAIGN'],
      ['REVIEW_CONTEXT', 'RUN_EXPERIMENT'], ['DRAFT_CONTENT', 'CHANGE_SPEND'],
    ] as const) {
      expect(ownerActionFamily(a)).not.toBe(ownerActionFamily(b));
    }
  });

  it('the raw actionType is still persisted verbatim for audit', async () => {
    const what = `${ICP} FAM-audit`;
    const [r1] = await persistRecommendations(ctxA, [rec({ what, actionType: 'RESEARCH' })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [
      rephrased({ what, actionType: 'REVIEW_CONTEXT' })]);
    const { data } = await db().from('growth_brain_recommendations')
      .select('id, action_type').in('id', [r1.id, r2.id]);
    const byId = new Map((data as Array<{ id: string; action_type: string }>).map(r => [r.id, r.action_type]));
    expect(byId.get(r1.id)).toBe('RESEARCH');
    expect(byId.get(r2.id)).toBe('REVIEW_CONTEXT');   // not rewritten to match
  }, 300_000);


  // ── SEMANTIC EQUIVALENCE: the reproduced browser paraphrases ─────────────

  /** Both WHATs come verbatim from the real browser reproduction. */
  const ICP_A = `Define a real Ideal Customer Profile (ICP) before any marketing activity begins ${RUN}`;
  const ICP_B = `Define a real Ideal Customer Profile (ICP) before any marketing work begins ${RUN}`;
  const PROV_A = `Import or connect real provider/audience data so signal-based decisions become possible ${RUN}`;
  const PROV_B = `Import real provider data to establish an observed signal baseline ${RUN}`;

  it('SEM A/B — the ICP paraphrase from the browser is a settled action', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: ICP_A, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'DEFINE_AUDIENCE', actionTarget: 'ICP_DEFINITION' })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    // "activity" → "work", and the model also relabels the type.
    const [r2] = await persistRecommendations(ctxA, [rephrased({
      what: ICP_B, actionType: 'RESEARCH',
      ownerActionIntent: 'DEFINE_AUDIENCE', actionTarget: 'ICP_DEFINITION' })]);
    expect(r2.id).not.toBe(r1.id);                       // distinct snapshot
    expect(r2.supersededByDecisionId, 'ICP paraphrase resurfaced').toBe(r1.id);
  }, 300_000);

  it('SEM C — the provider-data paraphrase after DISMISS stays dismissed', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: PROV_A, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'CONNECT_DATA_SOURCE', actionTarget: 'DATA_CONNECTION' })]);
    await decideRecommendation(ctxA, r1.id, 'DISMISS');
    const [r2] = await persistRecommendations(ctxA, [rephrased({
      what: PROV_B, actionType: 'RESEARCH',
      ownerActionIntent: 'CONNECT_DATA_SOURCE', actionTarget: 'DATA_CONNECTION' })]);
    expect(r2.supersededByDecisionId, 'provider-data paraphrase resurfaced').toBe(r1.id);
  }, 300_000);

  it('SEM O — a DEFERRED action stays deferred through paraphrase', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: `${ICP_A} defer`, actionType: 'RESEARCH',
      ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'POSITIONING_STATEMENT' })]);
    await decideRecommendation(ctxA, r1.id, 'DEFER');
    const [r2] = await persistRecommendations(ctxA, [rephrased({
      what: `${ICP_B} defer variant`, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'POSITIONING_STATEMENT' })]);
    expect(r2.supersededByDecisionId).toBe(r1.id);
  }, 300_000);

  // ── §9 FALSE-POSITIVE CONTROLS — same topic is NOT the same action ───────

  it('FP 1 — researching the ICP vs drafting ICP copy are DIFFERENT actions', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: `Research the ideal customer profile ${RUN}`,
      actionType: 'RESEARCH', ownerActionIntent: 'DEFINE_AUDIENCE' })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [rec({
      what: `Draft ICP-specific landing page copy ${RUN}`,
      actionType: 'DRAFT_CONTENT', ownerActionIntent: 'CREATE_DRAFT' })]);
    expect(r2.supersededByDecisionId, 'drafting was merged with research').toBeNull();
  }, 300_000);

  it('FP 2 — analysing Google Ads vs increasing its budget are DIFFERENT actions', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: `Analyze Google Ads performance ${RUN}`,
      actionType: 'RESEARCH', ownerActionIntent: 'ANALYZE_PERFORMANCE' })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [rec({
      what: `Increase Google Ads budget ${RUN}`,
      actionType: 'CHANGE_SPEND', ownerActionIntent: 'CHANGE_SPEND' })]);
    expect(r2.supersededByDecisionId, 'a spend change inherited an analysis decision').toBeNull();
    expect(r2.requiresApproval).toBe(true);
  }, 300_000);

  it('FP 3 — two DIFFERENT advisory intents do not merge', async () => {
    // Runs in a SEPARATE product: other cases in this file legitimately decide
    // CONNECT_DATA_SOURCE and REVIEW_POSITIONING actions in product A, and
    // matching those would be correct behaviour rather than a false positive.
    const [r1] = await persistRecommendations(ctxA2, [rec({
      what: `Define the audience ${RUN}`, actionType: 'RESEARCH', ownerActionIntent: 'DEFINE_AUDIENCE' })]);
    await decideRecommendation(ctxA2, r1.id, 'APPROVE');
    for (const intent of ['CONNECT_DATA_SOURCE', 'ANALYZE_PERFORMANCE', 'RESEARCH_MARKET', 'REVIEW_STORE_PRESENCE'] as const) {
      const [other] = await persistRecommendations(ctxA2, [rec({
        what: `Some other advisory action ${intent} ${RUN}`,
        actionType: 'RESEARCH', ownerActionIntent: intent })]);
      expect(other.supersededByDecisionId, `${intent} merged with DEFINE_AUDIENCE`).toBeNull();
    }
  }, 300_000);

  it('FP 4 — an UNCLASSIFIED action falls back to WHAT and never over-merges', async () => {
    // No intent supplied: the key degrades to normalized WHAT, so two different
    // unclassified actions stay distinct.
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: `Unclassified action one ${RUN}`, actionType: 'RESEARCH' })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    const [r2] = await persistRecommendations(ctxA, [rec({
      what: `Unclassified action two ${RUN}`, actionType: 'RESEARCH' })]);
    expect(r2.supersededByDecisionId).toBeNull();
  }, 300_000);

  it('TRUST BOUNDARY — a model cannot use intent to escape its family', () => {
    // A committing intent claimed on an advisory action degrades to OTHER.
    expect(resolveOwnerActionIntent('RESEARCH', 'CHANGE_SPEND')).toBe('OTHER');
    expect(resolveOwnerActionIntent('REVIEW_CONTEXT', 'LAUNCH_CAMPAIGN')).toBe('OTHER');
    expect(resolveOwnerActionIntent('DRAFT_CONTENT', 'RUN_EXPERIMENT')).toBe('OTHER');
    // ...and an advisory intent claimed on a committing action likewise.
    expect(resolveOwnerActionIntent('CHANGE_SPEND', 'ANALYZE_PERFORMANCE')).toBe('OTHER');
    // Legitimate pairings survive.
    expect(resolveOwnerActionIntent('RESEARCH', 'DEFINE_AUDIENCE')).toBe('DEFINE_AUDIENCE');
    expect(resolveOwnerActionIntent('CHANGE_SPEND', 'CHANGE_SPEND')).toBe('CHANGE_SPEND');
    expect(resolveOwnerActionIntent('RESEARCH', 'NOT_A_REAL_INTENT')).toBe('OTHER');
  });

  it('the validated intent is persisted on the snapshot for audit', async () => {
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: `Intent audit probe ${RUN}`, actionType: 'RESEARCH',
      // Claims a committing intent it is not entitled to.
      ownerActionIntent: 'CHANGE_SPEND' })]);
    expect(r1.ownerActionIntent, 'an inadmissible intent was stored as given').toBe('OTHER');
  }, 300_000);


  // ── THE CODEX REGRESSION: intent must be part of EXACT identity ──────────

  const fpBase = {
    workspaceId: WSA, productId: PA, actionType: 'RESEARCH',
    what: 'Same immutable text', whyNow: 'same', nextStep: 'same',
    expectedEffect: null, supportedBy: [], supporting: [],
    evidenceStrength: 'limited evidence', founderConflict: null,
    founderReviewRequired: false,
    actionTarget: 'UNSPECIFIED',
  };

  it('FP-A/B — identical snapshot text but a DIFFERENT validated intent yields a DIFFERENT fingerprint', () => {
    const other  = fingerprintOf({ ...fpBase, ownerActionIntent: 'OTHER' });
    const define = fingerprintOf({ ...fpBase, ownerActionIntent: 'DEFINE_AUDIENCE' });
    // The exact defect: these used to collide, so the unique
    // (workspace_id, fingerprint) made the upsert reuse the OLD row and return
    // an action key derived from a different snapshot than the input.
    expect(other, 'intent is absent from exact identity').not.toBe(define);
    // ...and the same validated intent is still stable.
    expect(fingerprintOf({ ...fpBase, ownerActionIntent: 'DEFINE_AUDIENCE' })).toBe(define);
  });

  it('FP-C/D — the PERSISTED intent equals the value the fingerprint was built from', async () => {
    // The raw hint is inadmissible for this family and must validate to OTHER;
    // both the fingerprint and the stored column must use that same value.
    const [row] = await persistRecommendations(ctxA, [rec({
      what: `Intent single-source probe ${RUN}`,
      actionType: 'RESEARCH', ownerActionIntent: 'CHANGE_SPEND' })]);
    expect(row.ownerActionIntent).toBe('OTHER');
    const { data } = await db().from('growth_brain_recommendations')
      .select('owner_action_intent, fingerprint').eq('id', row.id).maybeSingle();
    const stored = data as Record<string, unknown>;
    expect(stored.owner_action_intent).toBe('OTHER');
    // Rebuilding the fingerprint from the STORED intent reproduces the row.
    expect(stored.fingerprint).toBe(fingerprintOf({
      workspaceId: WSA, productId: PA, actionType: 'RESEARCH',
      what: `Intent single-source probe ${RUN}`,
      whyNow: 'Original rationale as first generated',
      nextStep: 'Write the ICP down in one paragraph',
      expectedEffect: null,
      supportedBy: [{ kind: 'FOUNDER_DIRECTION', label: 'Your confirmed direction' }],
      supporting: [], evidenceStrength: 'limited evidence',
      founderConflict: null, founderReviewRequired: false,
      ownerActionIntent: 'OTHER', actionTarget: 'UNSPECIFIED',
    }));

    // ...and a VALID intent must round-trip unchanged. Without this, always
    // persisting OTHER would satisfy the assertion above and the single-source
    // guarantee would be untested.
    const [valid] = await persistRecommendations(ctxA, [rec({
      what: `Intent round-trip probe ${RUN}`,
      actionType: 'RESEARCH', ownerActionIntent: 'DEFINE_AUDIENCE' })]);
    expect(valid.ownerActionIntent).toBe('DEFINE_AUDIENCE');
    const { data: v } = await db().from('growth_brain_recommendations')
      .select('owner_action_intent').eq('id', valid.id).maybeSingle();
    expect((v as Record<string, unknown>).owner_action_intent).toBe('DEFINE_AUDIENCE');
  }, 300_000);

  it('FP-I — a decision recorded under the v1 key still suppresses a v2 regeneration', async () => {
    // Runs in workspace B: product A already holds other decided
    // DEFINE_AUDIENCE actions from earlier cases, and matching one of THOSE is
    // correct behaviour — it would just not be evidence about v1 compatibility.
    const what = `Legacy compatibility probe ${RUN}`;
    // INSERTED directly with the v1 key. The immutability trigger correctly
    // refuses to rewrite action_key on an existing row, so a pre-v2 row has to
    // be created as one rather than converted — which is also closer to what a
    // genuine legacy row is.
    const v1Key = legacyActionKeyOf({
      workspaceId: WSB, productId: PB, actionType: 'RESEARCH', what });
    const legacyId = uuidFrom(`ae-legacy-${RUN}`);
    await must('legacy row', db().from('growth_brain_recommendations').insert({
      id: legacyId, workspace_id: WSB, product_id: PB, founder_id: F,
      fingerprint: `legacy-${RUN}`, action_key: v1Key,
      what, why_now: 'legacy why', next_step: 'legacy step',
      action_type: 'RESEARCH', requires_approval: false,
      evidence_strength: 'limited evidence',
      supported_by: [], supporting: [], owner_action_intent: null,
    }));
    const legacy = { id: legacyId };
    await decideRecommendation(ctxB, legacy.id, 'APPROVE');

    const [modern] = await persistRecommendations(ctxB, [rephrased({
      what, actionType: 'REVIEW_CONTEXT', ownerActionIntent: 'DEFINE_AUDIENCE' })]);
    expect(modern.supersededByDecisionId,
      'the owner was asked again because the identity version changed').toBe(legacy.id);
  }, 300_000);

  it('the contract version records the identity change', () => {
    expect(RECOMMENDATION_CONTRACT_VERSION).toBe(3);
  });


  // ── OVER-MERGE: the Codex browser pair must stay distinct ────────────────

  /** Verbatim from the browser reproduction. */
  const POS_STATEMENT = `Establish a clear positioning statement for this product in the US Productivity market ${RUN}`;
  const POS_AUDIENCE  = `Clarify whether this product is genuinely intended for external customers or is purely an internal/developer tool ${RUN}`;

  it('OM A — positioning STATEMENT vs AUDIENCE VALIDATION are different decisions', async () => {
    // Both validate to REVIEW_POSITIONING — which is exactly why intent alone
    // collapsed them. The target is what keeps them apart.
    const [r1] = await persistRecommendations(ctxA, [rec({
      what: POS_STATEMENT, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'POSITIONING_STATEMENT' })]);
    await decideRecommendation(ctxA, r1.id, 'DEFER');

    const [r2] = await persistRecommendations(ctxA, [rec({
      what: POS_AUDIENCE, actionType: 'RESEARCH',
      ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'PRODUCT_AUDIENCE_VALIDATION' })]);
    expect(r2.supersededByDecisionId, 'a different decision inherited the deferral').toBeNull();
    expect(r2.decisionStatus).toBe('RECOMMENDED');
    expect(r2.actionKey).not.toBe(r1.actionKey);

    // R1's deferral is untouched.
    const { data } = await db().from('growth_brain_recommendations')
      .select('decision_status').eq('id', r1.id).maybeSingle();
    expect((data as Record<string, unknown>).decision_status).toBe('DEFERRED');
  }, 300_000);

  it('OM B–E — other same-intent / same-topic pairs stay distinct', async () => {
    const pairs = [
      // research ICP vs draft ICP landing page
      [['RESEARCH', 'DEFINE_AUDIENCE', 'ICP_DEFINITION'], ['DRAFT_CONTENT', 'CREATE_DRAFT', 'CONTENT_ARTIFACT']],
      // analyze Google Ads vs increase Google Ads spend
      [['RESEARCH', 'ANALYZE_PERFORMANCE', 'PERFORMANCE_REVIEW'], ['CHANGE_SPEND', 'CHANGE_SPEND', 'BUDGET_CHANGE']],
      // review positioning vs launch a positioning campaign
      [['REVIEW_CONTEXT', 'REVIEW_POSITIONING', 'POSITIONING_STATEMENT'], ['LAUNCH_CAMPAIGN', 'LAUNCH_CAMPAIGN', 'CAMPAIGN_LAUNCH']],
      // connect provider data vs analyze provider performance
      [['REVIEW_CONTEXT', 'CONNECT_DATA_SOURCE', 'DATA_CONNECTION'], ['RESEARCH', 'ANALYZE_PERFORMANCE', 'PERFORMANCE_REVIEW']],
    ] as const;
    for (const [[at1, i1, t1], [at2, i2, t2]] of pairs) {
      const tag = `${t1}-vs-${t2}`;
      const [a] = await persistRecommendations(ctxB, [rec({
        what: `First of ${tag} ${RUN}`, actionType: at1, ownerActionIntent: i1, actionTarget: t1 })]);
      await decideRecommendation(ctxB, a.id, 'APPROVE');
      const [b] = await persistRecommendations(ctxB, [rec({
        what: `Second of ${tag} ${RUN}`, actionType: at2, ownerActionIntent: i2, actionTarget: t2 })]);
      const merged = b.supersededByDecisionId;
      // Each pair is cleaned up before the next: pairs share targets
      // (PERFORMANCE_REVIEW appears twice), and matching a PREVIOUS pair's
      // decision would be correct merging rather than the defect under test.
      await db().from('growth_brain_recommendations').delete().in('id', [a.id, b.id]);
      expect(merged, `${tag} merged`).toBeNull();
    }
  }, 300_000);

  it('OM F/G/H — paraphrases of the SAME target still merge', async () => {
    for (const [intent, target, base] of [
      ['REVIEW_POSITIONING', 'POSITIONING_STATEMENT', 'positioning'],
      ['DEFINE_AUDIENCE', 'ICP_DEFINITION', 'icp'],
      ['CONNECT_DATA_SOURCE', 'DATA_CONNECTION', 'provider'],
    ] as const) {
      const [a] = await persistRecommendations(ctxA2, [rec({
        what: `${base} original wording ${RUN}`, actionType: 'REVIEW_CONTEXT',
        ownerActionIntent: intent, actionTarget: target })]);
      await decideRecommendation(ctxA2, a.id, 'APPROVE');
      const [b] = await persistRecommendations(ctxA2, [rephrased({
        what: `${base} COMPLETELY different wording for the same ask ${RUN}`,
        actionType: 'RESEARCH', ownerActionIntent: intent, actionTarget: target })]);
      expect(b.supersededByDecisionId, `${base} paraphrase resurfaced`).toBe(a.id);
    }
  }, 300_000);

  it('OM — an UNSPECIFIED target falls back to WHAT and under-merges', async () => {
    // No target: two different asks inside one intent must NOT merge.
    const [a] = await persistRecommendations(ctxB, [rec({
      what: `Untargeted positioning ask one ${RUN}`, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'REVIEW_POSITIONING' })]);
    await decideRecommendation(ctxB, a.id, 'APPROVE');
    const [b] = await persistRecommendations(ctxB, [rec({
      what: `Untargeted positioning ask two ${RUN}`, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'REVIEW_POSITIONING' })]);
    expect(b.supersededByDecisionId, 'an unclassified action over-merged').toBeNull();
  }, 300_000);

  it('TARGET TRUST BOUNDARY — the model cannot pick a committing target', () => {
    expect(resolveActionTarget('REVIEW_POSITIONING', 'BUDGET_CHANGE')).toBe('UNSPECIFIED');
    expect(resolveActionTarget('DEFINE_AUDIENCE', 'CAMPAIGN_LAUNCH')).toBe('UNSPECIFIED');
    expect(resolveActionTarget('ANALYZE_PERFORMANCE', 'EXPERIMENT_DESIGN')).toBe('UNSPECIFIED');
    expect(resolveActionTarget('OTHER', 'POSITIONING_STATEMENT')).toBe('UNSPECIFIED');
    // Legitimate pairings survive.
    expect(resolveActionTarget('REVIEW_POSITIONING', 'POSITIONING_STATEMENT')).toBe('POSITIONING_STATEMENT');
    expect(resolveActionTarget('CHANGE_SPEND', 'BUDGET_CHANGE')).toBe('BUDGET_CHANGE');
    expect(resolveActionTarget('REVIEW_POSITIONING', 'NOT_A_TARGET')).toBe('UNSPECIFIED');
  });

  it('the validated target is persisted and part of exact identity', async () => {
    const [row] = await persistRecommendations(ctxA, [rec({
      what: `Target persistence probe ${RUN}`, actionType: 'REVIEW_CONTEXT',
      ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'BUDGET_CHANGE' })]);
    expect(row.actionTarget, 'an inadmissible target was stored as given').toBe('UNSPECIFIED');
    const fpA = fingerprintOf({ ...fpBase, ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'POSITIONING_STATEMENT' });
    const fpB = fingerprintOf({ ...fpBase, ownerActionIntent: 'REVIEW_POSITIONING', actionTarget: 'PRODUCT_AUDIENCE_VALIDATION' });
    expect(fpA, 'target is absent from exact identity').not.toBe(fpB);
  }, 300_000);

  it('L — the original snapshot and its provenance remain immutable', async () => {
    const what = `${ICP} L`;
    const [r1] = await persistRecommendations(ctxA, [rec({ what })]);
    await decideRecommendation(ctxA, r1.id, 'APPROVE');
    await persistRecommendations(ctxA, [rephrased({ what })]);

    const { data } = await db().from('growth_brain_recommendations')
      .select('why_now, next_step, supported_by, decision_status').eq('id', r1.id).maybeSingle();
    const row = data as Record<string, unknown>;
    expect(row.why_now).toBe('Original rationale as first generated');
    expect(row.next_step).toBe('Write the ICP down in one paragraph');
    expect(JSON.stringify(row.supported_by)).toContain('Your confirmed direction');
    expect(row.decision_status).toBe('APPROVED');
  }, 300_000);
});
