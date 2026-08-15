/**
 * @file shadowProposalStore.ts
 * @description Durable SHADOW proposal persistence — ADR-067 C18, invariant I17.
 *
 *   Pre-Design found shadow persisted NOTHING: `ShadowReport` was returned in
 *   memory and discarded, so no proposal could ever be adjudicated, no precision
 *   could be measured, and activation readiness could not be proven. This module
 *   is the fix, and it is the primary deliverable of 3.2A.
 *
 *   IT WRITES ONLY TO PROPOSAL TABLES. It has no access to marketing_memories,
 *   marketing_memory_versions, memory_challenges or learning_events — a proposal
 *   is a record of what WOULD have happened, and writing it into the
 *   authoritative audit trail would make that trail assert transitions that
 *   never occurred.
 *
 * @security Workspace is written from the verified context, never from payload.
 *   Idempotency is enforced by a unique index, not by check-then-insert.
 * @dependencies supabaseAdmin, migration 100
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { PromotionDecision } from './memoryPromotionPolicy';
import type { EligibilityDecision } from './candidateEligibilityPolicy';

export interface ProposalComparisonRecord {
  memoryId: string;
  memoryVersion: number;
  memoryScopeKey: string | null;
  memoryClass: string | null;
  memoryAuthorityTier: string | null;
  memoryIsLegacy: boolean;
  lexicalRank: number | null;
  semanticRank: number | null;
  fusedRank: number | null;
  finalRank: number | null;
  semanticDistance: number | null;
  classification: string | null;
  rationaleCode: string | null;
  ambiguity: number | null;
  decidedBy: 'deterministic' | 'model_assisted' | 'skipped_budget' | 'unavailable' | null;
  modelRequestId: string | null;
  scopeRelation: string | null;
  beliefPolicyAction: string | null;
  requiresFounderReview: boolean;
}

export interface ShadowProposalRecord {
  workspaceId: string;
  productId: string | null;
  idempotencyKey: string;

  claimText: string;
  normalizedClaim: string;
  memoryClass: string;

  scope: Record<string, unknown>;
  scopeKey: string | null;
  scopeSpecificity: number;
  scopeCompleteness: string;

  authorityTier: string;
  provenance: Record<string, unknown>;
  evidenceIds: string[];
  evidenceIndependenceKeys: string[];

  eligibility: EligibilityDecision;

  retrievalMode: string | null;
  retrievalDegraded: boolean;
  relatedMemoryCount: number;
  retrievalDiagnostics: Record<string, unknown>;

  promotion: PromotionDecision | null;

  policyVersions: {
    authority: number;
    scope: number;
    comparison?: number | null;
    promotion?: number | null;
    confidence?: number | null;
    importance?: number | null;
    quality?: number | null;
    retrieval?: number | null;
  };
  importanceScore?: number | null;
  qualityScore?: number | null;

  deterministicOnly: boolean;
  modelCallCount: number;
  modelRequestIds: string[];
  comparisonUnavailable: boolean;

  ingestionMode: string;
  traceId: string | null;

  comparisons: ProposalComparisonRecord[];
}

export interface PersistResult {
  proposalId: string | null;
  /** True when an identical candidate had already been proposed (C14). */
  duplicate: boolean;
  error?: string;
}

/**
 * Persists one proposal and its per-comparison detail.
 *
 * A duplicate idempotency key is NOT an error — it is the idempotency guarantee
 * working. It returns `duplicate: true` so the caller can count replays without
 * treating them as failures.
 *
 * Never throws: a proposal that cannot be written must not break evidence
 * ingestion (C15 degradation rule). The failure is reported and captured.
 */
export async function persistShadowProposal(rec: ShadowProposalRecord): Promise<PersistResult> {
  const db = getSupabaseAdmin();

  const row = {
    workspace_id: rec.workspaceId,
    product_id: rec.productId,
    idempotency_key: rec.idempotencyKey,

    claim_text: rec.claimText,
    normalized_claim: rec.normalizedClaim,
    memory_class: rec.memoryClass,

    scope: rec.scope,
    scope_key: rec.scopeKey,
    scope_specificity: rec.scopeSpecificity,
    scope_completeness: rec.scopeCompleteness,

    authority_tier: rec.authorityTier,
    provenance: rec.provenance,
    evidence_ids: rec.evidenceIds,
    evidence_independence_keys: rec.evidenceIndependenceKeys,

    eligibility_result: rec.eligibility.result,
    eligibility_reason_code: rec.eligibility.reason,
    eligibility_policy_version: rec.eligibility.policyVersion,

    retrieval_mode: rec.retrievalMode,
    retrieval_degraded: rec.retrievalDegraded,
    related_memory_count: rec.relatedMemoryCount,
    retrieval_diagnostics: rec.retrievalDiagnostics,

    promotion_outcome: rec.promotion?.outcome ?? null,
    promotion_reason_code: rec.promotion?.reasonCode ?? null,
    target_memory_id: rec.promotion?.targetMemoryId ?? null,
    target_memory_version: rec.promotion?.targetMemoryVersion ?? null,
    exception_to_memory_id: rec.promotion?.exceptionToMemoryId ?? null,

    proposed_action: rec.promotion?.beliefAction ?? null,
    proposed_entry_state: rec.promotion?.proposedEntryState ?? null,
    requires_founder_review: rec.promotion?.requiresFounderReview ?? false,

    authority_policy_version:  rec.policyVersions.authority,
    scope_policy_version:      rec.policyVersions.scope,
    comparison_policy_version: rec.policyVersions.comparison ?? null,
    promotion_policy_version:  rec.policyVersions.promotion ?? null,
    confidence_policy_version: rec.policyVersions.confidence ?? null,
    importance_policy_version: rec.policyVersions.importance ?? null,
    quality_policy_version:    rec.policyVersions.quality ?? null,
    retrieval_policy_version:  rec.policyVersions.retrieval ?? null,

    importance_score: rec.importanceScore ?? null,
    quality_score:    rec.qualityScore ?? null,

    deterministic_only: rec.deterministicOnly,
    model_call_count: rec.modelCallCount,
    model_request_ids: rec.modelRequestIds,
    comparison_unavailable: rec.comparisonUnavailable,

    ingestion_mode: rec.ingestionMode,
    trace_id: rec.traceId,
  };

  const { data, error } = await db
    .from('memory_shadow_proposals')
    .insert(row)
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 = the unique idempotency index fired. That is the mechanism working.
    if (error.code === '23505') return { proposalId: null, duplicate: true };
    Sentry.captureMessage('shadow proposal persist failed', {
      level: 'error',
      tags: { workspaceId: rec.workspaceId },
      extra: { code: error.code },
    });
    return { proposalId: null, duplicate: false, error: error.message };
  }

  const proposalId = (data as { id: string } | null)?.id ?? null;
  if (!proposalId) return { proposalId: null, duplicate: false, error: 'insert returned no id' };

  if (rec.comparisons.length) {
    const { error: cmpError } = await db.from('memory_shadow_proposal_comparisons').insert(
      rec.comparisons.map(c => ({
        proposal_id: proposalId,
        workspace_id: rec.workspaceId,
        memory_id: c.memoryId,
        memory_version: c.memoryVersion,
        memory_scope_key: c.memoryScopeKey,
        memory_class: c.memoryClass,
        memory_authority_tier: c.memoryAuthorityTier,
        memory_is_legacy: c.memoryIsLegacy,
        lexical_rank: c.lexicalRank,
        semantic_rank: c.semanticRank,
        fused_rank: c.fusedRank,
        final_rank: c.finalRank,
        semantic_distance: c.semanticDistance,
        classification: c.classification,
        rationale_code: c.rationaleCode,
        ambiguity: c.ambiguity,
        decided_by: c.decidedBy,
        model_request_id: c.modelRequestId,
        scope_relation: c.scopeRelation,
        belief_policy_action: c.beliefPolicyAction,
        requires_founder_review: c.requiresFounderReview,
      })),
    );
    if (cmpError) {
      // The proposal itself is already durable; losing comparison detail
      // degrades explainability without losing the decision.
      Sentry.captureMessage('shadow proposal comparisons persist failed', {
        level: 'warning', extra: { code: cmpError.code, proposalId },
      });
    }
  }

  return { proposalId, duplicate: false };
}

/**
 * Reads a proposal back with everything needed to explain it (§20).
 *
 * Deliberately returns the SNAPSHOTTED memory versions and policy versions
 * recorded at proposal time — never the current state of those memories. An
 * explanation that silently used today's versions would describe a decision
 * that was never made.
 */
export async function reconstructProposal(proposalId: string): Promise<{
  proposal: Record<string, unknown> | null;
  comparisons: Record<string, unknown>[];
} > {
  const db = getSupabaseAdmin();
  const { data: proposal } = await db
    .from('memory_shadow_proposals').select('*').eq('id', proposalId).maybeSingle();
  const { data: comparisons } = await db
    .from('memory_shadow_proposal_comparisons')
    .select('*').eq('proposal_id', proposalId).order('final_rank', { ascending: true });

  return {
    proposal: (proposal as Record<string, unknown> | null) ?? null,
    comparisons: (comparisons as Record<string, unknown>[]) ?? [],
  };
}

/** Aggregated shadow metrics for one workspace (§29, C22). */
export async function getShadowMetrics(workspaceId: string): Promise<Record<string, number> | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('memory_shadow_metrics').select('*').eq('workspace_id', workspaceId).maybeSingle();
  if (error || !data) return null;
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>)
      .filter(([k]) => k !== 'workspace_id')
      .map(([k, v]) => [k, Number(v)]),
  );
}
