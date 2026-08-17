/**
 * @file growthBrainDecisionService.ts
 * @description Phase 3.3D — the owner decision layer for Growth Brain.
 *
 *   WHAT THIS IS: persistence and validation for "the owner decided something
 *   about a recommendation". APPROVE authorises a FUTURE action; it never
 *   performs one.
 *
 *   WHAT THIS IS NOT: an execution engine, a workflow engine, or a learning
 *   trigger. `execution_status` has no `EXECUTED` value in the schema, so
 *   shipping execution by accident is not expressible — a later milestone must
 *   widen the CHECK constraint deliberately.
 *
 *   THE THREE THINGS THE CLIENT CANNOT SUPPLY:
 *     · recommendation identity — the server mints it from a fingerprint
 *     · requiresApproval / actionType — re-derived server-side on every write
 *     · provenance, evidence strength, founder conflict — snapshotted at
 *       generation time and never rewritten
 *
 *   The client sends a recommendation id and a verb. Everything a reader would
 *   treat as authority comes from the row the server already wrote.
 *
 * @security Business scope is derived from the verified WorkspaceContext, never
 *   from a client-supplied product id. Every mutation is filtered on
 *   workspace_id, so another business's recommendation resolves to "not found"
 *   rather than to a permission error that would confirm it exists.
 * @dependencies growthBrainRecommendationService (approval policy, reused)
 */

import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import {
  REQUIRES_APPROVAL, ownerActionFamily, resolveOwnerActionIntent, resolveActionTarget,
  type ActionType, type OwnerActionIntent, type GrowthBrainRecommendation,
} from './growthBrainRecommendationService';

/** Owner decisions. Deliberately small — this is not a workflow engine. */
export const DECISION_STATUSES = ['RECOMMENDED', 'APPROVED', 'DISMISSED', 'DEFERRED'] as const;
export type DecisionStatus = typeof DECISION_STATUSES[number];

/**
 * Separate from the decision. `EXECUTED` deliberately does not exist yet — see
 * the schema note in migration 108.
 */
export const EXECUTION_STATUSES = ['NOT_STARTED', 'READY_FOR_ACTION'] as const;
export type ExecutionStatus = typeof EXECUTION_STATUSES[number];

/** Verbs the owner may send. */
export const DECISION_ACTIONS = ['APPROVE', 'DISMISS', 'DEFER'] as const;
export type DecisionAction = typeof DECISION_ACTIONS[number];

const ACTION_TO_STATUS: Record<DecisionAction, DecisionStatus> = {
  APPROVE: 'APPROVED', DISMISS: 'DISMISSED', DEFER: 'DEFERRED',
};

/**
 * The permitted transition graph. Intentionally tiny.
 *
 * A decided recommendation may be re-decided (an owner may change their mind),
 * but re-applying the SAME decision is a no-op rather than a second record —
 * that is what makes a double-click safe.
 */
const ALLOWED_FROM: Record<DecisionStatus, DecisionStatus[]> = {
  RECOMMENDED: ['APPROVED', 'DISMISSED', 'DEFERRED'],
  DEFERRED:    ['APPROVED', 'DISMISSED', 'DEFERRED'],
  APPROVED:    ['APPROVED', 'DISMISSED'],
  DISMISSED:   ['DISMISSED', 'DEFERRED'],
};

export class DecisionError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
    this.name = 'DecisionError';
  }
}

export interface PersistedRecommendation {
  id: string;
  workspaceId: string;
  productId: string | null;
  what: string;
  whyNow: string;
  nextStep: string;
  expectedEffect: string | null;
  actionType: ActionType;
  requiresApproval: boolean;
  evidenceStrength: string;
  supportedBy: unknown;
  supporting: unknown;
  founderConflict: unknown;
  decisionStatus: DecisionStatus;
  executionStatus: ExecutionStatus;
  founderReviewRequired: boolean;
  founderReviewAcknowledged: boolean;
  decidedAt: string | null;
  createdAt: string;
  /** Identity of the ACTION, as distinct from the exact snapshot. */
  actionKey: string | null;
  /** Server-validated substantive intent, as understood at decision time. */
  ownerActionIntent: string | null;
  /** Server-validated decision object inside that intent. */
  actionTarget: string | null;
  /**
   * Set when this regenerated snapshot asks for a decision the owner already
   * made. Non-null means: keep for audit, do NOT present as outstanding.
   */
  supersededByDecisionId: string | null;
}

/**
 * Contract version. Bumped 1 → 2 when the validated owner action intent became
 * part of exact snapshot identity (see fingerprintOf).
 */
export const RECOMMENDATION_CONTRACT_VERSION = 3;

/** The v1 identity form, retained ONLY to recognise rows written before v2. */
const LEGACY_CONTRACT_VERSION = 1;

/**
 * Deterministic canonical JSON: object keys sorted at every depth.
 *
 * Without this the hash would depend on key insertion order, so the same
 * recommendation could yield two identities across runs - the same class of bug
 * as the one below, arriving from the opposite direction.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * Durable identity for the EXACT grounded recommendation the owner saw.
 *
 * MEASURED DEFECT: this hashed only (workspace, product, actionType, what). Two
 * materially different recommendations - different rationale, different next
 * step, different provenance, or one carrying a founder conflict the other did
 * not - collided on that key, and the second silently INHERITED the first's
 * owner decision. An owner who approved one thing would have been recorded as
 * having approved another.
 *
 * Now hashed over the whole immutable snapshot: deterministic and exact, with
 * no semantic similarity and no model. The same recommendation regenerated
 * reuses its identity; anything materially different gets a new one.
 */
export function fingerprintOf(input: {
  workspaceId: string; productId: string | null; actionType: string;
  what: string; whyNow: string; nextStep: string; expectedEffect: string | null;
  supportedBy: unknown; supporting: unknown; evidenceStrength: string;
  founderConflict: unknown; founderReviewRequired: boolean;
  /** VALIDATED intent — never the raw model hint. */
  ownerActionIntent: string;
  /** VALIDATED target — never the raw model hint. */
  actionTarget: string;
}): string {
  return createHash('sha256')
    .update(canonical({
      v: RECOMMENDATION_CONTRACT_VERSION,
      workspaceId: input.workspaceId,
      productId: input.productId ?? null,
      actionType: input.actionType,
      what: input.what.trim(),
      whyNow: input.whyNow.trim(),
      nextStep: input.nextStep.trim(),
      expectedEffect: input.expectedEffect?.trim() ?? null,
      supportedBy: input.supportedBy ?? [],
      supporting: input.supporting ?? [],
      evidenceStrength: input.evidenceStrength,
      founderConflict: input.founderConflict ?? null,
      founderReviewRequired: input.founderReviewRequired,
      // MEASURED DEFECT: omitting this made two SEMANTICALLY DIFFERENT
      // snapshots — one resolving to OTHER, one to DEFINE_AUDIENCE — share a
      // fingerprint. The unique (workspace_id, fingerprint) then made the
      // upsert reuse the OLD row, so the returned row carried an action key
      // derived from a different snapshot than the input. The intent is part of
      // what the snapshot MEANS, so it belongs in exact identity.
      ownerActionIntent: input.ownerActionIntent,
      // Same lesson as the intent: a field that changes what the snapshot MEANS
      // must be in exact identity, or two different snapshots collide on
      // (workspace_id, fingerprint) and the upsert reuses the wrong row.
      actionTarget: input.actionTarget,
    }))
    .digest('hex')
    .slice(0, 48);
}

/**
 * ACTION-EQUIVALENCE KEY — "what is the owner being asked to decide?"
 *
 * Distinct from `fingerprint`, which identifies the exact grounded snapshot the
 * owner saw and must stay exact for audit. This second identity exists because
 * those are different questions, and answering the second with the first is
 * what produced the measured P0: the owner approved an action, a reload had the
 * model rephrase whyNow and nextStep, the snapshot hash legitimately changed,
 * and the settled action reappeared as outstanding.
 *
 * Derived ONLY from fields that define the action. Deliberately excludes
 * whyNow, nextStep prose, provenance labels, evidence ordering, evidence
 * strength and any other explanation — rewording an argument does not ask the
 * owner for a new decision. No embeddings, no model.
 *
 * Keyed on the OWNER ACTION FAMILY, not the raw model `actionType`. The model
 * labelled one identical recommendation RESEARCH and then REVIEW_CONTEXT, which
 * resurfaced an approved action; the family is what the owner actually decided
 * about. The raw type still lives verbatim in the immutable snapshot.
 */
export function actionKeyOf(input: {
  workspaceId: string; productId: string | null; actionType: string; what: string;
  ownerActionIntent?: string | null; actionTarget?: string | null;
}): string {
  // Normalisation is deliberately conservative: case, punctuation and
  // whitespace only. It must not merge two genuinely different asks.
  const normalizedWhat = input.what
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // The substantive action, validated server-side. When it resolves to OTHER —
  // unrecognised, absent, or inadmissible for this family — the key falls back
  // to normalized WHAT. That direction only ever UNDER-merges: an action the
  // server could not classify is never collapsed with anything else.
  const intent = resolveOwnerActionIntent(
    input.actionType as ActionType, input.ownerActionIntent ?? null);
  const target = resolveActionTarget(intent as OwnerActionIntent, input.actionTarget ?? null);

  // The discriminator degrades conservatively at every step. Only a fully
  // classified action (intent AND target) is keyed structurally; anything less
  // falls back to normalized WHAT, which can under-merge but never over-merge.
  // That is the direction that matters: an unclassified action being offered
  // twice is an annoyance, whereas a different action inheriting a decision is
  // the defect this exists to prevent.
  const discriminator =
    intent === 'OTHER'          ? `what:${normalizedWhat}`
    : target === 'UNSPECIFIED'  ? `intent:${intent}|what:${normalizedWhat}`
    :                             `intent:${intent}|target:${target}`;

  return createHash('sha256')
    .update([
      RECOMMENDATION_CONTRACT_VERSION, input.workspaceId,
      input.productId ?? '-',
      ownerActionFamily(input.actionType as ActionType),
      discriminator,
    ].join('\u0000'))
    .digest('hex')
    .slice(0, 48);
}

/**
 * The v1 action key: family + normalized WHAT, no intent.
 *
 * Kept ONLY so a decision recorded before v2 still suppresses its own
 * regeneration. Historical rows are never rewritten, so the lookup has to be
 * able to recognise the older form rather than the rows being migrated to the
 * newer one.
 */
export function legacyActionKeyOf(input: {
  workspaceId: string; productId: string | null; actionType: string; what: string;
}): string {
  const normalizedWhat = input.what
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update([
      LEGACY_CONTRACT_VERSION, input.workspaceId, input.productId ?? '-',
      ownerActionFamily(input.actionType as ActionType), normalizedWhat,
    ].join('\u0000'))
    .digest('hex')
    .slice(0, 48);
}

/**
 * Is a regenerated recommendation the SAME decision the owner already made?
 *
 * Same action key is necessary but not sufficient. A change in founder-conflict
 * state or in the approval requirement changes what the owner would be
 * agreeing to, so those force a fresh decision even when the action reads the
 * same.
 */
function isSameOwnerDecision(
  candidate: { actionKey: string; legacyActionKey?: string; hasConflict: boolean; requiresApproval: boolean },
  prior: { action_key: unknown; founder_conflict: unknown; requires_approval: unknown },
): boolean {
  // Either identity form may match: a decision recorded under v1 must still
  // recognise its own regeneration under v2.
  const keyMatches = prior.action_key === candidate.actionKey
    || (candidate.legacyActionKey != null && prior.action_key === candidate.legacyActionKey);
  return keyMatches
    && (prior.founder_conflict !== null) === candidate.hasConflict
    && Boolean(prior.requires_approval) === candidate.requiresApproval;
}

const rowToRec = (r: Record<string, unknown>): PersistedRecommendation => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  productId: (r.product_id as string | null) ?? null,
  what: String(r.what),
  whyNow: String(r.why_now),
  nextStep: String(r.next_step),
  expectedEffect: (r.expected_effect as string | null) ?? null,
  actionType: r.action_type as ActionType,
  requiresApproval: Boolean(r.requires_approval),
  evidenceStrength: String(r.evidence_strength),
  supportedBy: r.supported_by ?? [],
  supporting: r.supporting ?? [],
  founderConflict: r.founder_conflict ?? null,
  decisionStatus: r.decision_status as DecisionStatus,
  executionStatus: r.execution_status as ExecutionStatus,
  founderReviewRequired: Boolean(r.founder_review_required),
  founderReviewAcknowledged: Boolean(r.founder_review_acknowledged),
  decidedAt: (r.decided_at as string | null) ?? null,
  createdAt: String(r.created_at),
  actionKey: (r.action_key as string | null) ?? null,
  ownerActionIntent: (r.owner_action_intent as string | null) ?? null,
  actionTarget: (r.owner_action_target as string | null) ?? null,
  supersededByDecisionId: (r.superseded_by_decision_id as string | null) ?? null,
});

/**
 * Persists a generated batch and returns the rows WITH server identity.
 *
 * Upsert on (workspace_id, fingerprint): regenerating the same recommendation
 * reuses its row, so an existing owner decision is preserved rather than reset
 * by a refresh. The snapshot columns are written ONLY on insert — a later
 * regeneration must not rewrite the evidence a past decision was made against.
 *
 * @security `requires_approval` is re-derived from the action type here, so the
 *   stored value cannot disagree with policy even if a caller passed something
 *   else.
 */
export async function persistRecommendations(
  ctx: { workspaceId: string; founderId: string; productId: string | null },
  recs: GrowthBrainRecommendation[],
): Promise<PersistedRecommendation[]> {
  if (recs.length === 0) return [];
  const db = getSupabaseAdmin();

  const rows = recs.map(r => {
    const conflict = r.founderConflict ?? null;
    // SINGLE SOURCE. Validated exactly once, then fed to the fingerprint, the
    // action key and the persisted column. There is deliberately no second
    // call site — independent re-resolution is precisely how the fingerprint
    // and the stored intent came to disagree.
    const intent = resolveOwnerActionIntent(r.actionType, r.ownerActionIntent ?? null);
    const target = resolveActionTarget(intent, r.actionTarget ?? null);
    return {
      workspace_id: ctx.workspaceId,
      product_id: ctx.productId,
      founder_id: ctx.founderId,
      owner_action_intent: intent,
      owner_action_target: target,
      action_key: actionKeyOf({
        workspaceId: ctx.workspaceId, productId: ctx.productId,
        actionType: r.actionType, what: r.what,
        ownerActionIntent: intent, actionTarget: target,
      }),
      fingerprint: fingerprintOf({
        workspaceId: ctx.workspaceId, productId: ctx.productId, actionType: r.actionType,
        what: r.what, whyNow: r.whyNow, nextStep: r.nextStep, expectedEffect: r.expectedEffect,
        supportedBy: r.supportedBy, supporting: r.supporting,
        evidenceStrength: r.evidenceStrength,
        founderConflict: conflict, founderReviewRequired: conflict !== null,
        ownerActionIntent: intent, actionTarget: target,
      }),
      what: r.what,
      why_now: r.whyNow,
      next_step: r.nextStep,
      expected_effect: r.expectedEffect,
      action_type: r.actionType,
      // Re-derived, never taken from the caller.
      requires_approval: REQUIRES_APPROVAL[r.actionType],
      evidence_strength: r.evidenceStrength,
      supported_by: r.supportedBy,
      supporting: r.supporting,
      founder_conflict: conflict,
      founder_review_required: conflict !== null,
    };
  });

  const { error } = await db.from('growth_brain_recommendations')
    .upsert(rows, { onConflict: 'workspace_id,fingerprint', ignoreDuplicates: true });
  if (error) throw new DecisionError(`persist failed: ${error.message}`, 500, 'PERSIST_FAILED');

  const { data } = await db.from('growth_brain_recommendations')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .in('fingerprint', rows.map(r => r.fingerprint));
  const persisted = ((data ?? []) as Array<Record<string, unknown>>);

  // ── ACTION-EQUIVALENCE SUPPRESSION ────────────────────────────────────────
  //
  // A snapshot the owner has not seen before is still a NEW ROW — history stays
  // truthful and nothing earlier is rewritten. But if it asks for a decision
  // already made on this exact action, it is LINKED to that decision instead of
  // being offered again. Scoped to this workspace AND product, so an identical
  // action in another business can never satisfy it.
  const decidedPriors = await db.from('growth_brain_recommendations')
    .select('id, action_key, founder_conflict, requires_approval, decision_status, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .eq('product_id', ctx.productId as string)
    .not('decision_status', 'eq', 'RECOMMENDED')
    // Deliberately NOT filtered on superseded_by_decision_id. The question is
    // "has the owner decided this action before?", not "…via a row that was
    // itself never linked". Excluding linked rows broke the chain: a row that
    // was suppressed at creation and then decided vanished as a prior, so the
    // NEXT paraphrase found nothing and resurfaced.
    // MOST RECENT FIRST, with an explicit limit. Ascending order plus
    // PostgREST's default row cap returned the OLDEST decisions and silently
    // dropped the newest — so the decision just made was invisible as a prior
    // and the next paraphrase resurfaced. Recency is also the right semantics:
    // the latest decision on an action is the one that stands.
    .order('decided_at', { ascending: false })
    .limit(200);
  const priors = (decidedPriors.data ?? []) as Array<Record<string, unknown>>;

  for (const row of persisted) {
    if (row.decision_status !== 'RECOMMENDED' || row.superseded_by_decision_id) continue;
    const match = priors.find(prior => prior.id !== row.id && isSameOwnerDecision({
      actionKey: String(row.action_key),
      // Lets a decision recorded under v1 still recognise this regeneration.
      legacyActionKey: legacyActionKeyOf({
        workspaceId: ctx.workspaceId, productId: ctx.productId,
        actionType: String(row.action_type), what: String(row.what),
      }),
      hasConflict: row.founder_conflict !== null,
      requiresApproval: Boolean(row.requires_approval),
    }, prior as never));
    if (!match) continue;
    // Link only. The prior decision is NOT copied onto this row — pretending
    // the owner approved THIS snapshot would be a different lie.
    await db.from('growth_brain_recommendations')
      .update({ superseded_by_decision_id: match.id, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('workspace_id', ctx.workspaceId);
    row.superseded_by_decision_id = match.id;
  }

  return persisted.map(rowToRec);
}

/**
 * Records an owner decision.
 *
 * @param ctx - VERIFIED workspace context; the only source of business scope
 * @param recommendationId - server-issued id
 * @param action - APPROVE | DISMISS | DEFER
 * @param opts.acknowledgeFounderConflict - explicit acknowledgement, required
 *   to approve a recommendation that opposes founder direction
 * @throws {DecisionError} 404 when the recommendation is not in this workspace,
 *   409 on an invalid transition, 422 when founder review is unacknowledged
 * @security The workspace filter is on the SELECT, so another business's
 *   recommendation is indistinguishable from one that does not exist.
 */
export async function decideRecommendation(
  ctx: { workspaceId: string; founderId: string; productId: string | null },
  recommendationId: string,
  action: DecisionAction,
  opts: { acknowledgeFounderConflict?: boolean; note?: string } = {},
): Promise<PersistedRecommendation> {
  const db = getSupabaseAdmin();

  // BOTH keys. Workspace alone was insufficient: one workspace can hold several
  // products, so a recommendation for product B was mutable from product A's
  // context. The active product is server-resolved, never client-supplied.
  let q = db.from('growth_brain_recommendations')
    .select('*')
    .eq('id', recommendationId)
    .eq('workspace_id', ctx.workspaceId);
  q = ctx.productId ? q.eq('product_id', ctx.productId) : q.is('product_id', null);
  const { data: existing } = await q.maybeSingle();
  if (!existing) {
    throw new DecisionError('Recommendation not found', 404, 'NOT_FOUND');
  }

  const row = existing as Record<string, unknown>;
  const from = row.decision_status as DecisionStatus;
  const to = ACTION_TO_STATUS[action];

  if (!ALLOWED_FROM[from]?.includes(to)) {
    throw new DecisionError(
      `Cannot ${action.toLowerCase()} a recommendation that is already ${from.toLowerCase()}`,
      409, 'INVALID_TRANSITION');
  }

  // IDEMPOTENCY: the same decision applied twice is the same decision. Returned
  // unchanged so a double-click or a retried request cannot produce a second
  // durable record or a second future action.
  if (from === to) return rowToRec(row);

  // FOUNDER CONFLICT: approval cannot silently pass over founder direction.
  // The flag is never cleared — an acknowledgement is recorded ALONGSIDE it, so
  // the history can never be read as "there was no conflict".
  const conflictOpen = Boolean(row.founder_review_required);
  let acknowledged = Boolean(row.founder_review_acknowledged);
  if (action === 'APPROVE' && conflictOpen) {
    if (opts.acknowledgeFounderConflict !== true) {
      throw new DecisionError(
        'This recommendation conflicts with your stated direction and needs your explicit review before approval',
        422, 'FOUNDER_REVIEW_REQUIRED');
    }
    acknowledged = true;
  }

  // Approval authorises a future action. It does NOT execute one, and there is
  // no EXECUTED state to reach from here.
  const execution: ExecutionStatus =
    to === 'APPROVED' && Boolean(row.requires_approval) ? 'READY_FOR_ACTION' : 'NOT_STARTED';

  const { data: updated, error } = await db.from('growth_brain_recommendations')
    .update({
      decision_status: to,
      execution_status: execution,
      founder_review_acknowledged: acknowledged,
      decided_at: new Date().toISOString(),
      decided_by: ctx.founderId,
      decision_note: opts.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', recommendationId)
    .eq('workspace_id', ctx.workspaceId)
    .eq('product_id', ctx.productId as string)   // ← repeated on the write
    .select('*')
    .maybeSingle();
  if (error || !updated) {
    throw new DecisionError('Decision could not be saved', 500, 'UPDATE_FAILED');
  }
  return rowToRec(updated as Record<string, unknown>);
}

/** Decision history for the ACTIVE business only. */
export async function listRecommendationDecisions(
  ctx: { workspaceId: string; productId?: string | null }, limit = 20,
): Promise<PersistedRecommendation[]> {
  let q = getSupabaseAdmin()
    .from('growth_brain_recommendations')
    .select('*')
    .eq('workspace_id', ctx.workspaceId);
  if (ctx.productId !== undefined) {
    q = ctx.productId ? q.eq('product_id', ctx.productId) : q.is('product_id', null);
  }
  const { data } = await q
    .not('decision_status', 'eq', 'RECOMMENDED')
    .order('decided_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToRec);
}
