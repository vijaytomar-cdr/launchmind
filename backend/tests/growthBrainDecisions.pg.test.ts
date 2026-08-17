/**
 * @file growthBrainDecisions.pg.test.ts
 * @description Phase 3.3D acceptance matrix — the owner decision layer.
 *
 *   The contract under test: APPROVE authorises a FUTURE action and never
 *   performs one; business scope comes from the verified workspace and never
 *   from the client; founder conflict cannot be made to disappear by clicking
 *   approve; provenance survives the evidence that produced it; and a
 *   double-click cannot mint a second durable decision.
 *
 *   Drives the real exported service against a real database. Nothing about
 *   transitions, approval policy or scoping is reimplemented here.
 *
 * @security Cases F/G are the isolation proof: one founder, two businesses, in
 *   both directions. A founder-wide implementation would pass a naive tenant
 *   test, so scope is asserted per business.
 * @dependencies growthBrainDecisionService (real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import {
  persistRecommendations, decideRecommendation, listRecommendationDecisions,
  DecisionError,
} from '../src/services/growthBrainDecisionService';
import type { GrowthBrainRecommendation } from '../src/services/growthBrainRecommendationService';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const F   = uuidFrom('gbd-founder');
const WSA = uuidFrom('gbd-ws-a');
const WSB = uuidFrom('gbd-ws-b');
const PA  = uuidFrom('gbd-prod-a');
const PB  = uuidFrom('gbd-prod-b');

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

const ctxA = { workspaceId: WSA, founderId: F, productId: PA as string | null };
/** Second product in the SAME workspace — the cross-product isolation case. */
const PA2 = uuidFrom('gbd-prod-a2');
const ctxA2 = { workspaceId: WSA, founderId: F, productId: PA2 as string | null };
const ctxB = { workspaceId: WSB, founderId: F, productId: PB as string | null };

/** A generated recommendation, as Phase 3.3C would produce it. */
function rec(over: Partial<GrowthBrainRecommendation> = {}): GrowthBrainRecommendation {
  return {
    type: 'RECOMMENDATION',
    actionType: 'RESEARCH',
    what: 'Review how the listing communicates speed',
    whyNow: 'Your goal depends on it',
    supportedBy: [{ kind: 'BUSINESS_GOAL', label: 'Your primary goal', authority: null, memoryClass: null, evidenceCount: null, detail: 'You told LaunchMind this' }],
    supporting: [{ type: 'INFERENCE', text: 'Clarity may help conversion' }],
    founderConflict: null,
    requiresFounderReview: false,
    expectedEffect: 'Bookings',
    nextStep: 'Read the listing end to end',
    requiresApproval: false,
    evidenceStrength: 'limited evidence',
    confidence: null,
    ...over,
  } as GrowthBrainRecommendation;
}

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

d('Phase 3.3D — owner decision layer', () => {
  beforeAll(async () => {
    await must('founders', db().from('founders').upsert(
      { id: F, email: 'gbd@lab.invalid', name: 'GBD LAB', plan: 'studio' }, { onConflict: 'id' }));
    for (const [ws, prod, name] of [[WSA, PA, 'GBD A'], [WSA, PA2, 'GBD A2'], [WSB, PB, 'GBD B']] as const) {
      await must('workspaces', db().from('workspaces').upsert(
        { id: ws, founder_id: F, name: `WS ${ws.slice(0, 4)}` }, { onConflict: 'id' }));
      await must('products', db().from('products').upsert({
        id: prod, founder_id: F, workspace_id: ws, name,
        store_url: 'https://gbd.invalid', platform: 'app_store',
      }, { onConflict: 'id' }));
    }
  }, 300_000);

  afterAll(async () => {
    await db().from('growth_brain_recommendations').delete().in('workspace_id', [WSA, WSB]);
    await db().from('products').delete().in('id', [PA, PA2, PB]);
    await db().from('workspaces').delete().in('id', [WSA, WSB]);
    await db().from('founders').delete().eq('id', F);
  });

  it('A — APPROVE an ordinary recommendation persists, and executes nothing', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'A-approve ordinary' })]);
    expect(r.decisionStatus).toBe('RECOMMENDED');
    const out = await decideRecommendation(ctxA, r.id, 'APPROVE');
    expect(out.decisionStatus).toBe('APPROVED');
    expect(out.workspaceId).toBe(WSA);
    expect(out.productId).toBe(PA);
    // No approval was required, so nothing becomes ready for action.
    expect(out.executionStatus).toBe('NOT_STARTED');
  }, 300_000);

  it('B — DISMISS persists and executes nothing', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'B-dismiss' })]);
    const out = await decideRecommendation(ctxA, r.id, 'DISMISS');
    expect(out.decisionStatus).toBe('DISMISSED');
    expect(out.executionStatus).toBe('NOT_STARTED');
  }, 300_000);

  it('C — DEFER persists and executes nothing', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'C-defer' })]);
    const out = await decideRecommendation(ctxA, r.id, 'DEFER');
    expect(out.decisionStatus).toBe('DEFERRED');
    expect(out.executionStatus).toBe('NOT_STARTED');
  }, 300_000);

  it('D — an approval-required action reaches READY_FOR_ACTION, never EXECUTED', async () => {
    const [r] = await persistRecommendations(ctxA, [
      rec({ what: 'D-spend', actionType: 'CHANGE_SPEND', requiresApproval: false }),
    ]);
    // The caller passed requiresApproval:false; the server re-derived it.
    expect(r.requiresApproval).toBe(true);
    const out = await decideRecommendation(ctxA, r.id, 'APPROVE');
    expect(out.decisionStatus).toBe('APPROVED');
    expect(out.executionStatus).toBe('READY_FOR_ACTION');
    expect(out.executionStatus).not.toBe('EXECUTED');
  }, 300_000);

  it('E — founder conflict cannot be silently approved away', async () => {
    const [r] = await persistRecommendations(ctxA, [
      rec({ what: 'E-conflict', founderConflict: { withDirection: 'Maintain premium positioning' } }),
    ]);
    expect(r.founderReviewRequired).toBe(true);

    // A plain approve is refused.
    await expect(decideRecommendation(ctxA, r.id, 'APPROVE'))
      .rejects.toMatchObject({ code: 'FOUNDER_REVIEW_REQUIRED', statusCode: 422 });

    // With explicit acknowledgement it proceeds — and the conflict REMAINS on
    // the record, so history can never read as "there was no conflict".
    const out = await decideRecommendation(ctxA, r.id, 'APPROVE', { acknowledgeFounderConflict: true });
    expect(out.decisionStatus).toBe('APPROVED');
    expect(out.founderConflict).not.toBeNull();
    expect(out.founderReviewRequired).toBe(true);
    expect(out.founderReviewAcknowledged).toBe(true);
  }, 300_000);

  it('F — cross-WORKSPACE mutation is rejected, both directions', async () => {
    const [a] = await persistRecommendations(ctxA, [rec({ what: 'F-a-only' })]);
    const [b] = await persistRecommendations(ctxB, [rec({ what: 'F-b-only' })]);

    await expect(decideRecommendation({ workspaceId: WSB, founderId: F, productId: PB }, a.id, 'DISMISS'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    await expect(decideRecommendation({ workspaceId: WSA, founderId: F, productId: PA }, b.id, 'DISMISS'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    // Neither was touched.
    const { data } = await db().from('growth_brain_recommendations')
      .select('id, decision_status').in('id', [a.id, b.id]);
    for (const row of (data ?? []) as Array<{ decision_status: string }>) {
      expect(row.decision_status).toBe('RECOMMENDED');
    }
  }, 300_000);

  it('G — cross-PRODUCT evidence cannot be reached via a supplied id', async () => {
    const [b] = await persistRecommendations(ctxB, [rec({ what: 'G-b-product' })]);
    // A's context, B's recommendation id — the only scope that counts is the
    // verified workspace, so this is indistinguishable from "does not exist".
    await expect(decideRecommendation({ workspaceId: WSA, founderId: F, productId: PA }, b.id, 'APPROVE'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const decisionsA = await listRecommendationDecisions({ workspaceId: WSA, productId: PA });
    expect(decisionsA.every(x => x.workspaceId === WSA)).toBe(true);
    expect(decisionsA.some(x => x.what === 'G-b-product')).toBe(false);
  }, 300_000);

  it('H — duplicate approval and regeneration are idempotent', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'H-idempotent' })]);
    const first = await decideRecommendation(ctxA, r.id, 'APPROVE');
    const second = await decideRecommendation(ctxA, r.id, 'APPROVE');   // double-click
    expect(second.id).toBe(first.id);
    expect(second.decisionStatus).toBe('APPROVED');
    expect(second.decidedAt).toBe(first.decidedAt);   // unchanged, not re-stamped

    // Regenerating the same recommendation reuses the row and preserves the
    // decision rather than resetting it to RECOMMENDED.
    const again = await persistRecommendations(ctxA, [rec({ what: 'H-idempotent' })]);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(r.id);
    expect(again[0].decisionStatus).toBe('APPROVED');

    const { count } = await db().from('growth_brain_recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', WSA).eq('what', 'H-idempotent');
    expect(count).toBe(1);
  }, 300_000);

  it('I — the provenance snapshot survives the evidence that produced it', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({
      what: 'I-provenance',
      supportedBy: [{ kind: 'MARKETING_MEMORY', label: 'Trust badges lift bookings',
        authority: 'OBSERVED_FIRST_PARTY', memoryClass: 'FACT', evidenceCount: 2, detail: null }],
    })]);
    await decideRecommendation(ctxA, r.id, 'APPROVE');

    // The underlying evidence changes — here, the product is renamed and the
    // lab memory would no longer be retrieved.
    await must('products', db().from('products')
      .update({ name: 'GBD A RENAMED' }).eq('id', PA));

    const history = await listRecommendationDecisions({ workspaceId: WSA, productId: PA });
    const found = history.find(x => x.what === 'I-provenance');
    expect(found).toBeDefined();
    // Snapshot, not regenerated from current context.
    expect(JSON.stringify(found!.supportedBy)).toContain('Trust badges lift bookings');
    expect(JSON.stringify(found!.supportedBy)).toContain('OBSERVED_FIRST_PARTY');
  }, 300_000);

  it('J — client-supplied authority fields are ignored', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({
      what: 'J-tampered',
      actionType: 'LAUNCH_CAMPAIGN',
      requiresApproval: false,                    // client says no approval
      evidenceStrength: 'strong evidence',
      founderConflict: null,
    })]);
    // Server re-derived approval from the validated action type.
    expect(r.requiresApproval).toBe(true);
    expect(r.actionType).toBe('LAUNCH_CAMPAIGN');
    // And approving still cannot execute.
    const out = await decideRecommendation(ctxA, r.id, 'APPROVE');
    expect(out.executionStatus).toBe('READY_FOR_ACTION');
  }, 300_000);

  it('K — an unknown recommendation id is a safe 404 with no mutation', async () => {
    const before = await listRecommendationDecisions({ workspaceId: WSA, productId: PA });
    await expect(decideRecommendation(ctxA, uuidFrom('gbd-nonexistent'), 'APPROVE'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    const after = await listRecommendationDecisions({ workspaceId: WSA, productId: PA });
    expect(after.length).toBe(before.length);
  }, 300_000);

  it('L — an owner decision mutates NO Marketing Memory', async () => {
    // BOTH counts must be workspace-scoped. Counting
    // marketing_memory_versions globally made this test depend on every OTHER
    // suite in the run: memoryGovernance and lifecycleTierPropagation legitimately
    // create versions, so the global count moved and this failed under the
    // certification profile while passing in isolation. The product was never
    // implicated — the assertion was.
    const versionsIn = async () => {
      const { data } = await db().from('marketing_memories')
        .select('id').eq('workspace_id', WSA);
      const ids = ((data ?? []) as Array<{ id: string }>).map(m => m.id);
      if (ids.length === 0) return 0;
      const { count } = await db().from('marketing_memory_versions')
        .select('id', { count: 'exact', head: true }).in('memory_id', ids);
      return count ?? 0;
    };
    const memBefore = await db().from('marketing_memories')
      .select('id', { count: 'exact', head: true }).eq('workspace_id', WSA);
    const versionsBefore = await versionsIn();

    const [r] = await persistRecommendations(ctxA, [rec({ what: 'L-no-learning' })]);
    await decideRecommendation(ctxA, r.id, 'APPROVE');

    const memAfter = await db().from('marketing_memories')
      .select('id', { count: 'exact', head: true }).eq('workspace_id', WSA);
    const versionsAfter = await versionsIn();
    expect(memAfter.count ?? 0).toBe(memBefore.count ?? 0);
    expect(versionsAfter).toBe(versionsBefore);
  }, 300_000);


  // ── Phase 3.3D hardening cases ────────────────────────────────────────────

  it('IDENTITY A — the exact same recommendation reuses its identity', async () => {
    const [first]  = await persistRecommendations(ctxA, [rec({ what: 'ID-stable' })]);
    const [second] = await persistRecommendations(ctxA, [rec({ what: 'ID-stable' })]);
    expect(second.id).toBe(first.id);
  }, 300_000);

  it('IDENTITY B/C/D/E — a materially changed recommendation gets a NEW identity', async () => {
    const base = { what: 'ID-variants', whyNow: 'base why', nextStep: 'base step' } as const;
    const [b0] = await persistRecommendations(ctxA, [rec(base)]);

    // B — different provenance
    const [bProv] = await persistRecommendations(ctxA, [rec({ ...base,
      supportedBy: [{ kind: 'MARKETING_MEMORY', label: 'Different source', authority: 'OBSERVED_FIRST_PARTY', memoryClass: 'FACT', evidenceCount: 1, detail: null }] })]);
    // C — different rationale
    const [bWhy] = await persistRecommendations(ctxA, [rec({ ...base, whyNow: 'a materially different reason' })]);
    // D — founder conflict appeared
    const [bConf] = await persistRecommendations(ctxA, [rec({ ...base,
      founderConflict: { withDirection: 'Maintain premium positioning' } })]);
    // E — different next step
    const [bStep] = await persistRecommendations(ctxA, [rec({ ...base, nextStep: 'a different next step' })]);

    for (const [label, v] of [['provenance', bProv], ['whyNow', bWhy], ['conflict', bConf], ['nextStep', bStep]] as const) {
      expect(v.id, `${label} collided with the base identity`).not.toBe(b0.id);
    }
    // ...and none of them inherited the base decision.
    await decideRecommendation(ctxA, b0.id, 'APPROVE');
    const [again] = await persistRecommendations(ctxA, [rec({ ...base, whyNow: 'a materially different reason' })]);
    expect(again.id).toBe(bWhy.id);
    expect(again.decisionStatus).toBe('RECOMMENDED');
  }, 300_000);

  it('F2 — same-workspace CROSS-PRODUCT mutation is rejected, both directions', async () => {
    const [a]  = await persistRecommendations(ctxA,  [rec({ what: 'XP-product-a' })]);
    const [a2] = await persistRecommendations(ctxA2, [rec({ what: 'XP-product-a2' })]);

    // Same workspace, different product. Workspace scoping alone would let these through.
    await expect(decideRecommendation(ctxA2, a.id, 'DISMISS'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(decideRecommendation(ctxA, a2.id, 'DISMISS'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });

    const { data } = await db().from('growth_brain_recommendations')
      .select('id, decision_status').in('id', [a.id, a2.id]);
    for (const row of (data ?? []) as Array<{ decision_status: string }>) {
      expect(row.decision_status).toBe('RECOMMENDED');
    }
  }, 300_000);

  it('K/L/M/N — direct client UPDATE of snapshot and policy columns is denied', async () => {
    // CHANGE_SPEND so requires_approval is TRUE — patching it to false is then
    // a genuine change rather than a no-op the trigger rightly permits.
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'DB-immutable',
      actionType: 'CHANGE_SPEND',
      founderConflict: { withDirection: 'Maintain premium positioning' } })]);
    expect(r.requiresApproval).toBe(true);

    // Even as service_role — the trigger, not the policy, is what makes the
    // snapshot immutable, so no code path can rewrite history.
    for (const patch of [
      { what: 'rewritten text' },
      { supported_by: [{ kind: 'CAMPAIGN_PERFORMANCE', label: 'fabricated' }] },
      // Genuinely DIFFERENT values throughout: the trigger correctly permits a
      // no-op write of an identical value, so a same-value patch would prove
      // nothing.
      { action_type: 'RESEARCH' },
      { requires_approval: false },
      { founder_conflict: null },
      { founder_review_required: false },
      { product_id: PA2 },
    ]) {
      const { error } = await db().from('growth_brain_recommendations')
        .update(patch).eq('id', r.id);
      expect(error, `snapshot rewrite allowed: ${JSON.stringify(patch)}`).not.toBeNull();
    }

    // The row is unchanged.
    const { data } = await db().from('growth_brain_recommendations')
      .select('what, requires_approval, founder_conflict, founder_review_required')
      .eq('id', r.id).maybeSingle();
    const row = data as Record<string, unknown>;
    expect(row.what).toBe('DB-immutable');
    expect(row.requires_approval).toBe(true);
    expect(row.founder_conflict).not.toBeNull();
    expect(row.founder_review_required).toBe(true);
  }, 300_000);

  it('the validated decision path still works after immutability is enforced', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'DB-decision-allowed' })]);
    const out = await decideRecommendation(ctxA, r.id, 'DEFER');
    expect(out.decisionStatus).toBe('DEFERRED');
  }, 300_000);

  it('product_id must belong to workspace_id (DB integrity)', async () => {
    // PB belongs to workspace B; pairing it with workspace A must be refused by
    // the composite foreign key, not merely by application code.
    const { error } = await db().from('growth_brain_recommendations').insert({
      workspace_id: WSA, product_id: PB, founder_id: F,
      fingerprint: 'integrity-probe', what: 'x', why_now: 'y', next_step: 'z',
      action_type: 'RESEARCH', requires_approval: false,
      evidence_strength: 'limited evidence',
    });
    expect(error, 'a product from another workspace was accepted').not.toBeNull();
  }, 300_000);

  it('an invalid transition is refused', async () => {
    const [r] = await persistRecommendations(ctxA, [rec({ what: 'invalid-transition' })]);
    await decideRecommendation(ctxA, r.id, 'DISMISS');
    await expect(decideRecommendation(ctxA, r.id, 'APPROVE'))
      .rejects.toBeInstanceOf(DecisionError);
  }, 300_000);
});
