/**
 * @file memoryLifecycleService.ts
 * @description The ONLY service permitted to apply a lifecycle change to a
 *   marketing memory — Phase 3.1F completion pass.
 *
 *   The chain, and why it is three modules rather than one:
 *
 *     claimComparison   proposes  (a model may participate)
 *     beliefPolicy      decides   (pure, deterministic, no I/O)
 *     memoryLifecycle   applies   (this file — the only writer)
 *
 *   A single module doing all three would make "similarity never decides"
 *   unenforceable by inspection. Split this way, the model cannot reach the
 *   decision and the decision cannot be skipped: every method here derives its
 *   action from `decide()` rather than accepting one from a caller.
 *
 *   EVERY TRANSITION IS ATOMIC. Snapshot + move + learning event commit together
 *   inside `lm_apply_memory_transition` (migration 097). Doing it from here with
 *   three PostgREST calls would leave windows where a belief changed with no
 *   explanation recorded — the exact failure this milestone exists to prevent.
 *
 * @security Workspace is verified against the memory ROW inside the RPC, never
 *   trusted from an argument. Founder-confirmed memory can never be superseded
 *   automatically; it produces a challenge that requires owner resolution.
 * @dependencies beliefPolicy, claimComparison, lm_apply_memory_transition
 */

import * as Sentry from '@sentry/node';
import type { AuthorityTier } from './authorityPolicy';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { newTraceId } from '../../lib/traceId';
import {
  decide, decideWithAuthority, computeConfidence, precedenceTier, assertTransition,
  type PolicyDecision,
  CONFIDENCE_POLICY_VERSION, type ClaimClassification, type MemoryState,
  type EvidenceRef,
} from './beliefPolicy';
import { compareClaims, type ComparableClaim, type ComparisonResult } from './claimComparison';

export type ActorType = 'system' | 'founder' | 'ai';

export interface MemoryRow {
  id: string; workspace_id: string; founder_id: string; product_id: string | null;
  memory_type: string; title: string; content: Record<string, unknown> | null;
  source: string; confidence: number; status: MemoryState; version: number;
  evidence_ids: string[] | null; reinforcement_count: number; updated_at: string;
}

export interface TransitionOutcome {
  memoryId: string;
  applied: boolean;
  fromStatus: MemoryState;
  toStatus: MemoryState | null;
  confidenceBefore: number;
  confidenceAfter: number;
  newVersion: number | null;
  learningEventId: string | null;
  requiresFounderReview: boolean;
  challengeId: string | null;
  reason: string;
  classification?: ClaimClassification;
  traceId: string;
}

/** Confidence must move by at least this much to be worth its own event (§6). */
export const CONFIDENCE_MATERIALITY = 0.05;

async function loadMemory(memoryId: string, workspaceId: string): Promise<MemoryRow | null> {
  const { data } = await getSupabaseAdmin()
    .from('marketing_memories')
    .select('id, workspace_id, founder_id, product_id, memory_type, title, content, source, authority_tier, memory_class, confidence, status, version, evidence_ids, reinforcement_count, updated_at')
    .eq('id', memoryId).eq('workspace_id', workspaceId).maybeSingle();
  return (data as MemoryRow) ?? null;
}

async function loadEvidence(ids: string[], workspaceId: string): Promise<EvidenceRef[]> {
  if (ids.length === 0) return [];
  const { data } = await getSupabaseAdmin()
    .from('evidence').select('id, independence_key')
    .in('id', ids).eq('workspace_id', workspaceId);
  return ((data ?? []) as Array<{ id: string; independence_key: string | null }>)
    .map(e => ({ id: e.id, independenceKey: e.independence_key }));
}

function ageDays(updatedAt: string): number {
  return Math.max(0, (Date.now() - Date.parse(updatedAt)) / 86_400_000);
}

/** Calls the atomic RPC. All three writes commit together or none do. */
async function applyTransition(params: {
  memory: MemoryRow; toStatus: MemoryState; eventType: string; actorType: ActorType;
  reason: string; newConfidence?: number; classification?: string | null;
  evidenceIds?: string[]; supersededBy?: string | null; requiresReview?: boolean;
  reinforce?: boolean; traceId: string;
}): Promise<{ newVersion: number; learningEventId: string } | null> {
  // Validated here too, so an illegal move fails before a round trip and with a
  // TypeScript-shaped error rather than a Postgres one.
  assertTransition(params.memory.status, params.toStatus);

  const { data, error } = await getSupabaseAdmin().rpc('lm_apply_memory_transition', {
    p_memory_id: params.memory.id,
    p_workspace_id: params.memory.workspace_id,
    p_to_status: params.toStatus,
    p_event_type: params.eventType,
    p_actor_type: params.actorType,
    p_reason: params.reason,
    p_new_confidence: params.newConfidence ?? null,
    p_policy_version: CONFIDENCE_POLICY_VERSION,
    p_classification: params.classification ?? null,
    p_evidence_ids: params.evidenceIds ?? [],
    p_superseded_by: params.supersededBy ?? null,
    p_requires_review: params.requiresReview ?? false,
    p_trace_id: params.traceId,
    p_content_hash: null,
    p_reinforce: params.reinforce ?? false,
  });

  if (error) {
    Sentry.captureMessage('memory transition failed', {
      level: 'error',
      tags: { memoryId: params.memory.id, to: params.toStatus, code: error.code ?? 'unknown' },
    });
    return null;
  }
  const row = (data as Array<{ new_version: number; learning_event_id: string }>)?.[0];
  return row ? { newVersion: row.new_version, learningEventId: row.learning_event_id } : null;
}

// ── Reinforcement (§8) ───────────────────────────────────────────────────────

/**
 * Strengthens an existing memory with compatible new evidence.
 *
 * Confidence is RECOMPUTED from the full evidence set rather than incremented,
 * so re-importing the same observation cannot inflate it — the independence key
 * collapses duplicates before the count is taken.
 */

/**
 * AUTHORITY FACT — "is this founder-authored?" — read from the PERSISTED tier.
 *
 * Codex review: all four lifecycle call sites reconstructed this from `source`
 * via `precedenceTier()`, so a governed `founder_bootstrap` row was not
 * recognised as founder authority. The legacy source path is retained ONLY for
 * rows with no persisted tier.
 *
 * NOTE — AUTHORITY IS NOT DECAY. This function answers an authority question.
 * Whether a memory decays is a separate, unchanged concern; see ADR-068 A3.
 */

/**
 * GOVERNANCE ERROR — a governed row is missing its required authority tier.
 *
 * The DB completeness constraint (migration 099) should make this impossible.
 * If it happens anyway the application must FAIL CLOSED rather than reconstruct
 * governed authority from a source string, which is precisely the veto the
 * canonical contract removes.
 */
export class GovernedAuthorityMissingError extends Error {
  readonly code = 'GOVERNED_AUTHORITY_MISSING';
  constructor(memoryId: string) {
    super(`memory ${memoryId} is governed (memory_class set) but has no authority_tier`);
    this.name = 'GovernedAuthorityMissingError';
  }
}

/**
 * GOVERNANCE ERROR — a governed lifecycle operation was invoked without the
 * challenger's authority tier.
 *
 * Codex review: the previous predicate (`incumbent tier && challenger tier`)
 * silently fell back to source precedence whenever a caller omitted the tier —
 * and the real nested paths (ingestCandidateClaim -> challenge/supersede,
 * supersede -> challenge downgrade, memoryAgent -> supersede) all omitted it.
 */
export class GovernedChallengerAuthorityMissingError extends Error {
  readonly code = 'GOVERNED_CHALLENGER_AUTHORITY_MISSING';
  constructor(memoryId: string) {
    super(`governed lifecycle operation on ${memoryId} requires challengerAuthorityTier`);
    this.name = 'GovernedChallengerAuthorityMissingError';
  }
}

/**
 * THE ONE lifecycle authority resolver.
 *
 * Codex review: four lifecycle writers called the SOURCE-based `decide()`, so a
 * governed promotion decision made from persisted tiers could be silently
 * reinterpreted from source strings at write time. This routes governed pairs
 * through the tier-based path and keeps the certified source path for true
 * legacy rows only.
 *
 * @throws {GovernedAuthorityMissingError} when the row is governed but untiered.
 */
function decideForLifecycle(
  classification: ClaimClassification,
  memory: { id: string; source: string; memory_class?: string | null; authority_tier?: string | null },
  challengerSource: string,
  challengerAuthorityTier?: string | null,
): PolicyDecision {
  const governedRow = Boolean(memory.memory_class);
  if (governedRow && !memory.authority_tier) throw new GovernedAuthorityMissingError(memory.id);

  // A GOVERNED incumbent may only be decided on tiers. A missing challenger tier
  // is a CALLER DEFECT, not evidence that the row is legacy — treating it as
  // legacy silently re-derived authority from source and could bypass founder
  // review. Legacy status is a property of the INCUMBENT, never of what the
  // caller happened to pass.
  const governedIncumbent = Boolean(memory.memory_class) || Boolean(memory.authority_tier);
  if (governedIncumbent) {
    if (!memory.authority_tier) throw new GovernedAuthorityMissingError(memory.id);
    if (!challengerAuthorityTier) throw new GovernedChallengerAuthorityMissingError(memory.id);
    return decideWithAuthority(
      classification,
      memory.authority_tier as AuthorityTier,
      challengerAuthorityTier as AuthorityTier,
    );
  }
  // TRUE legacy: memory_class NULL and authority_tier NULL.
  return decide(classification, memory.source, challengerSource);
}

function isFounderMemory(memory: { source: string; authority_tier?: string | null }): boolean {
  const tier = memory.authority_tier;
  if (tier) return tier === 'FOUNDER_ASSERTED' || tier === 'FOUNDER_CONFIRMED';
  return precedenceTier(memory.source) === 'founder_confirmed';   // legacy fallback
}

export async function reinforceMemory(
  memoryId: string, workspaceId: string,
  opts: { evidenceIds?: string[]; actorType?: ActorType; reason?: string; traceId?: string } = {},
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }

  const merged = [...new Set([...(memory.evidence_ids ?? []), ...(opts.evidenceIds ?? [])])];
  const evidence = await loadEvidence(merged, workspaceId);

  const conf = computeConfidence({
    source: memory.source, memoryType: memory.memory_type,
    supportingEvidence: evidence,
    contradictionCount: await openChallengeCount(memoryId, workspaceId),
    reinforcementCount: memory.reinforcement_count + 1,
    ageDays: 0,                                   // reinforcement refreshes recency
    founderConfirmed: isFounderMemory(memory),
  });

  const res = await applyTransition({
    memory, toStatus: 'active', eventType: 'MEMORY_REINFORCED',
    actorType: opts.actorType ?? 'system',
    reason: opts.reason ?? 'compatible evidence supports this memory',
    newConfidence: conf.value, classification: 'REINFORCEMENT',
    evidenceIds: opts.evidenceIds ?? [], reinforce: true, traceId,
  });

  return {
    memoryId, applied: !!res, fromStatus: memory.status, toStatus: 'active',
    confidenceBefore: memory.confidence, confidenceAfter: conf.value,
    newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
    requiresFounderReview: false, challengeId: null,
    reason: conf.factors.join('; '), classification: 'REINFORCEMENT', traceId,
  };
}

async function openChallengeCount(memoryId: string, workspaceId: string): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from('memory_challenges').select('id')
    .eq('memory_id', memoryId).eq('workspace_id', workspaceId).eq('status', 'open');
  return (data ?? []).length;
}

// ── Challenge (§7, §9) ───────────────────────────────────────────────────────

/**
 * Records that something contradicts a memory, WITHOUT applying it.
 *
 * When the incumbent is founder-confirmed the challenge is flagged for owner
 * review and the founder's statement stays ACTIVE — LaunchMind surfaces the
 * disagreement rather than resolving it on the owner's behalf (§5).
 */
export async function challengeMemory(
  memoryId: string, workspaceId: string,
  opts: {
    challengerMemoryId?: string | null; challengerSource: string;
    /** Governed challenger authority. When present with a governed incumbent, tiers decide. */
    challengerAuthorityTier?: string | null;
    evidenceIds?: string[]; classification?: ClaimClassification;
    rationale?: string; decidedBy?: 'deterministic' | 'model_assisted' | 'founder';
    actorType?: ActorType; traceId?: string;
  },
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }

  const decision = decideForLifecycle(opts.classification ?? 'CONTRADICTION', memory, opts.challengerSource, opts.challengerAuthorityTier);
  const db = getSupabaseAdmin();

  // The challenge record survives regardless of whether the memory moves — it is
  // the durable statement that a conflict exists.
  const { data: chal } = await db.from('memory_challenges').insert({
    workspace_id: workspaceId, memory_id: memoryId, memory_version: memory.version,
    challenger_memory_id: opts.challengerMemoryId ?? null,
    challenger_evidence_ids: opts.evidenceIds ?? [],
    classification: opts.classification ?? 'CONTRADICTION',
    decided_by: opts.decidedBy ?? 'deterministic',
    rationale: opts.rationale ?? decision.reason,
    requires_founder_review: decision.requiresFounderReview,
    trace_id: traceId,
  }).select('id').maybeSingle();

  const challengeId = (chal as { id: string } | null)?.id ?? null;

  if (decision.action === 'none') {
    return { memoryId, applied: false, fromStatus: memory.status, toStatus: null,
             confidenceBefore: memory.confidence, confidenceAfter: memory.confidence,
             newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId, reason: decision.reason, traceId };
  }

  const evidence = await loadEvidence(memory.evidence_ids ?? [], workspaceId);
  const conf = computeConfidence({
    source: memory.source, memoryType: memory.memory_type,
    supportingEvidence: evidence,
    contradictionCount: (await openChallengeCount(memoryId, workspaceId)),
    reinforcementCount: memory.reinforcement_count,
    ageDays: ageDays(memory.updated_at),
    founderConfirmed: isFounderMemory(memory),
  });

  const res = await applyTransition({
    memory, toStatus: 'challenged', eventType: 'MEMORY_CHALLENGED',
    actorType: opts.actorType ?? 'system', reason: decision.reason,
    newConfidence: conf.value, classification: opts.classification ?? 'CONTRADICTION',
    evidenceIds: opts.evidenceIds ?? [], requiresReview: decision.requiresFounderReview, traceId,
  });

  return {
    memoryId, applied: !!res, fromStatus: memory.status, toStatus: 'challenged',
    confidenceBefore: memory.confidence, confidenceAfter: conf.value,
    newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
    requiresFounderReview: decision.requiresFounderReview, challengeId,
    reason: decision.reason, classification: 'CONTRADICTION', traceId,
  };
}

/** Challenge resolved in the incumbent's favour (§17 scenario I). */
export async function resolveChallengeToActive(
  memoryId: string, workspaceId: string,
  opts: { challengeId?: string; note?: string; actorType?: ActorType; traceId?: string } = {},
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'challenged', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }

  const db = getSupabaseAdmin();
  await db.from('memory_challenges')
    .update({ status: 'resolved_kept', resolved_at: new Date().toISOString(),
              resolved_by: opts.actorType ?? 'founder', resolution_note: opts.note ?? null })
    .eq('memory_id', memoryId).eq('workspace_id', workspaceId).eq('status', 'open');

  const evidence = await loadEvidence(memory.evidence_ids ?? [], workspaceId);
  const conf = computeConfidence({
    source: memory.source, memoryType: memory.memory_type, supportingEvidence: evidence,
    contradictionCount: 0,                          // resolved in its favour
    reinforcementCount: memory.reinforcement_count,
    ageDays: ageDays(memory.updated_at),
    founderConfirmed: isFounderMemory(memory),
  });

  const res = await applyTransition({
    memory, toStatus: 'active', eventType: 'MEMORY_CHALLENGE_RESOLVED',
    actorType: opts.actorType ?? 'founder',
    reason: opts.note ?? 'challenge resolved; memory kept', newConfidence: conf.value,
    requiresReview: false, traceId,
  });

  return { memoryId, applied: !!res, fromStatus: memory.status, toStatus: 'active',
           confidenceBefore: memory.confidence, confidenceAfter: conf.value,
           newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
           requiresFounderReview: false, challengeId: opts.challengeId ?? null,
           reason: 'challenge resolved to active', traceId };
}

// ── Supersede / retract / stale ──────────────────────────────────────────────

/**
 * Replaces a memory with a newer accepted belief (scenario J).
 *
 * Refuses when the incumbent is founder-confirmed and the replacement is not:
 * that path must go through the founder, not through this function.
 */
export async function supersedeMemory(
  memoryId: string, workspaceId: string,
  opts: { supersededById: string; challengerSource: string; challengerAuthorityTier?: string | null; reason?: string;
          actorType?: ActorType; traceId?: string },
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }

  const decision = decideForLifecycle('CONTRADICTION', memory, opts.challengerSource, opts.challengerAuthorityTier);
  if (decision.action !== 'supersede') {
    // Downgraded to a challenge. This is the guardrail, not an error: an
    // inference asking to overwrite the founder gets a review item instead.
    return challengeMemory(memoryId, workspaceId, {
      challengerMemoryId: opts.supersededById, challengerSource: opts.challengerSource,
      // Forward the SAME tier that drove the decision above. Recomputing it
      // downstream from source is exactly the defect this closes.
      challengerAuthorityTier: opts.challengerAuthorityTier,
      classification: 'CONTRADICTION', rationale: decision.reason,
      actorType: opts.actorType, traceId,
    });
  }

  const res = await applyTransition({
    memory, toStatus: 'superseded', eventType: 'MEMORY_SUPERSEDED',
    actorType: opts.actorType ?? 'system',
    reason: opts.reason ?? decision.reason, classification: 'CONTRADICTION',
    supersededBy: opts.supersededById, traceId,
  });

  await getSupabaseAdmin().from('memory_challenges')
    .update({ status: 'resolved_superseded', resolved_at: new Date().toISOString() })
    .eq('memory_id', memoryId).eq('workspace_id', workspaceId).eq('status', 'open');

  return { memoryId, applied: !!res, fromStatus: memory.status, toStatus: 'superseded',
           confidenceBefore: memory.confidence, confidenceAfter: memory.confidence,
           newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
           requiresFounderReview: false, challengeId: null,
           reason: opts.reason ?? decision.reason, traceId };
}

/** Withdraws a claim found to be invalid. Retained visibly as history (§21). */
export async function retractMemory(
  memoryId: string, workspaceId: string,
  opts: { reason: string; actorType?: ActorType; traceId?: string },
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }
  const res = await applyTransition({
    memory, toStatus: 'retracted', eventType: 'MEMORY_RETRACTED',
    actorType: opts.actorType ?? 'founder', reason: opts.reason, traceId,
  });
  return { memoryId, applied: !!res, fromStatus: memory.status, toStatus: 'retracted',
           confidenceBefore: memory.confidence, confidenceAfter: memory.confidence,
           newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
           requiresFounderReview: false, challengeId: null, reason: opts.reason, traceId };
}

/** Marks a memory possibly outdated by time, not by contradiction (scenario L). */
export async function markStale(
  memoryId: string, workspaceId: string,
  opts: { reason?: string; traceId?: string } = {},
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }
  const evidence = await loadEvidence(memory.evidence_ids ?? [], workspaceId);
  const conf = computeConfidence({
    source: memory.source, memoryType: memory.memory_type, supportingEvidence: evidence,
    contradictionCount: 0, reinforcementCount: memory.reinforcement_count,
    ageDays: ageDays(memory.updated_at),
    founderConfirmed: isFounderMemory(memory),
  });
  const res = await applyTransition({
    memory, toStatus: 'stale', eventType: 'MEMORY_MARKED_STALE',
    actorType: 'system', reason: opts.reason ?? 'evidence beyond its freshness window',
    newConfidence: conf.value, traceId,
  });
  return { memoryId, applied: !!res, fromStatus: memory.status, toStatus: 'stale',
           confidenceBefore: memory.confidence, confidenceAfter: conf.value,
           newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
           requiresFounderReview: false, challengeId: null,
           reason: opts.reason ?? 'stale', traceId };
}

// ── Founder correction (§12) ─────────────────────────────────────────────────

/**
 * The founder says an inferred memory is wrong.
 *
 * The incorrect memory is PRESERVED and superseded, never edited — editing it
 * would erase the fact that LaunchMind once believed it, which is exactly what
 * an owner needs to see to trust the correction took effect.
 *
 * @param opts.replacementMemoryId The founder-confirmed memory that replaces it,
 *   when one was created.
 */
export async function founderCorrect(
  memoryId: string, workspaceId: string,
  opts: { reason: string; replacementMemoryId?: string | null; traceId?: string },
): Promise<TransitionOutcome> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found', traceId };
  }

  // A founder correction is the strongest source there is, so the decision is
  // `supersede` for anything the founder did not themselves assert.
  // A founder correction is founder authority by construction.
  const decision = decideForLifecycle('CONTRADICTION', memory, 'founder_feedback', 'FOUNDER_CONFIRMED');
  const toStatus: MemoryState = decision.action === 'supersede' ? 'superseded' : 'challenged';

  const res = await applyTransition({
    memory, toStatus, eventType: 'FOUNDER_CORRECTION',
    actorType: 'founder', reason: opts.reason, classification: 'CONTRADICTION',
    supersededBy: opts.replacementMemoryId ?? null,
    requiresReview: false, traceId,
  });

  await getSupabaseAdmin().from('memory_challenges')
    .update({ status: 'resolved_superseded', resolved_at: new Date().toISOString(),
              resolved_by: 'founder', resolution_note: opts.reason })
    .eq('memory_id', memoryId).eq('workspace_id', workspaceId).eq('status', 'open');

  return { memoryId, applied: !!res, fromStatus: memory.status, toStatus,
           confidenceBefore: memory.confidence, confidenceAfter: memory.confidence,
           newVersion: res?.newVersion ?? null, learningEventId: res?.learningEventId ?? null,
           requiresFounderReview: false, challengeId: null, reason: opts.reason, traceId };
}

// ── The full ingestion path (§8, §9, §10, §11) ───────────────────────────────

/**
 * Compares a candidate claim against an existing memory and applies whatever
 * policy allows.
 *
 * This is the end-to-end entry point: compare → decide → apply → learn.
 *
 * UNRELATED deliberately mutates nothing and does NOT create a memory (§11).
 * Whether an unrelated claim deserves to become a new memory is an ingestion
 * decision, not a comparison one, and keeping them separate stops a comparison
 * from silently growing the corpus.
 */
export async function ingestCandidateClaim(
  memoryId: string, workspaceId: string,
  candidate: ComparableClaim,
  opts: {
    challengerSource: string; challengerAuthorityTier?: string | null;
    evidenceIds?: string[]; challengerMemoryId?: string | null;
    allowModel?: boolean; actorType?: ActorType; traceId?: string;
  },
): Promise<TransitionOutcome & { comparison: ComparisonResult | null }> {
  const traceId = opts.traceId ?? newTraceId();
  const memory = await loadMemory(memoryId, workspaceId);
  if (!memory) {
    return { memoryId, applied: false, fromStatus: 'active', toStatus: null,
             confidenceBefore: 0, confidenceAfter: 0, newVersion: null, learningEventId: null,
             requiresFounderReview: false, challengeId: null, reason: 'memory not found',
             traceId, comparison: null };
  }

  const existing: ComparableClaim = {
    text: (typeof memory.content?.claim === 'string' ? memory.content.claim : memory.title),
    scope: {
      channel:  (memory.content?.channel as string) ?? null,
      segment:  (memory.content?.segment as string) ?? null,
      market:   (memory.content?.market as string) ?? null,
      timeframe:(memory.content?.timeframe as string) ?? null,
      productId: memory.product_id,
    },
    memoryType: memory.memory_type,
  };

  const comparison = await compareClaims(existing, candidate, {
    allowModel: opts.allowModel,
    auditCtx: { founderId: memory.founder_id, productId: memory.product_id },
  });

  const decision = decideForLifecycle(comparison.classification, memory, opts.challengerSource, opts.challengerAuthorityTier);

  let outcome: TransitionOutcome;
  switch (decision.action) {
    case 'reinforce':
      outcome = await reinforceMemory(memoryId, workspaceId, {
        evidenceIds: opts.evidenceIds, actorType: opts.actorType,
        reason: decision.reason, traceId,
      });
      break;
    case 'challenge':
      outcome = await challengeMemory(memoryId, workspaceId, {
        challengerMemoryId: opts.challengerMemoryId, challengerSource: opts.challengerSource,
        challengerAuthorityTier: opts.challengerAuthorityTier,
        evidenceIds: opts.evidenceIds, classification: comparison.classification,
        rationale: comparison.rationaleCode, decidedBy: comparison.decidedBy,
        actorType: opts.actorType, traceId,
      });
      break;
    case 'supersede':
      outcome = await supersedeMemory(memoryId, workspaceId, {
        supersededById: opts.challengerMemoryId ?? memoryId,
        challengerSource: opts.challengerSource,
        challengerAuthorityTier: opts.challengerAuthorityTier,
        reason: decision.reason, actorType: opts.actorType, traceId,
      });
      break;
    default:
      outcome = { memoryId, applied: false, fromStatus: memory.status, toStatus: null,
                  confidenceBefore: memory.confidence, confidenceAfter: memory.confidence,
                  newVersion: null, learningEventId: null, requiresFounderReview: false,
                  challengeId: null, reason: decision.reason, traceId };
  }

  return { ...outcome, classification: comparison.classification, comparison };
}
