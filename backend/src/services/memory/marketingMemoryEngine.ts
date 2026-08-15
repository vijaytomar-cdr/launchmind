/**
 * @file marketingMemoryEngine.ts
 * @description The orchestration layer — ADR-067 C16, C15, C14, invariants I5, I15, I16.
 *
 *   Owns CALL ORDER, BUDGET, IDEMPOTENCY, LOCKING and the shadow/active fork.
 *   It owns no policy and performs no authoritative write. Without it the call
 *   order lives in every caller, which is exactly how the three bypass paths
 *   Pre-Design found came to exist.
 *
 *   THE ORDER IS THE ARCHITECTURE:
 *
 *     Gate A  (pure, no I/O)          ← rejects here cost nothing
 *       ↓
 *     RetrievalService (≤10)          ← bounded; replaces the O(N) full scan
 *       ↓
 *     ClaimComparison                 ← deterministic first, model ≤3
 *       ↓
 *     Gate B                          ← corpus-level outcome
 *       ↓
 *     SHADOW: durable proposal    |   ACTIVE (later): MemoryLifecycleService
 *
 *   RETRIEVAL IS NOT MODIFIED. RetrievalService nominates; this module then
 *   loads the governance columns for the ≤10 ids it returned. Widening the
 *   retriever's own SELECT would risk the frozen retrieval benchmark for no
 *   architectural gain.
 *
 * @security Workspace is resolved from the CANONICAL record and every stage is
 *   filtered by it. This module writes only to shadow proposal tables — asserted
 *   by a structural test.
 * @dependencies candidateEligibilityPolicy, retrievalService, claimComparison,
 *   memoryPromotionPolicy, shadowProposalStore, scopePolicy, authorityPolicy
 */

import { createHash } from 'crypto';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { newTraceId } from '../../lib/traceId';
import { retrieveMemories } from './retrievalService';
import { compareDeterministic, compareClaims, type ComparableClaim } from './claimComparison';
import { CONFIDENCE_POLICY_VERSION } from './beliefPolicy';
import {
  evaluateCandidateEligibility, type EligibilityDecision,
} from './candidateEligibilityPolicy';
import {
  decidePromotion, type ComparedMemory, type PromotionDecision, type MemoryClass,
  PROMOTION_POLICY_VERSION,
} from './memoryPromotionPolicy';
import {
  authorityForCandidate, type AuthorityTier, type ProvenanceContext,
  AUTHORITY_POLICY_VERSION, bootstrapTierFromSource,
} from './authorityPolicy';
import {
  normalizeMemoryScope, SCOPE_POLICY_VERSION, type MemoryScope, compareMemoryScope,
} from './scopePolicy';
import {
  PROMOTION_BUDGETS, RETRIEVAL_POLICY_VERSION, ModelCallBudget,
} from './promotionBudgets';
import { isLegacyMemory } from './memoryGovernancePolicy';
import { persistShadowProposal, type ProposalComparisonRecord } from './shadowProposalStore';
import { ingestionMode } from './claimCandidateBuilder';

/** Comparison prompt/behaviour version, persisted per proposal. */
export const COMPARISON_POLICY_VERSION = 1;

export interface MemoryCandidate {
  workspaceId: string;
  productId: string | null;
  claimText: string;
  memoryClass: MemoryClass;
  /** Stored `source` value, for BeliefPolicy's legacy precedence axis. */
  source: string;
  scope: unknown;
  provenance: { kind: string; sourceId: string; provider?: string | null };
  /** Authenticated actor. NEVER derived from claim text. */
  actorType: 'founder' | 'system' | 'ai';
  founderConfirmed?: boolean;
  controlledExperiment?: boolean;
  evidenceIds?: string[];
  /** Evidence CONTENT for Gate A's support check (existence is not support). */
  evidenceRecords?: Array<{ id: string; data?: Record<string, unknown> | null; text?: string | null }>;
  evidenceIndependenceKeys?: string[];
  sampleSize?: number | null;
  /** True when the claim came from a deterministic template or rule. */
  claimIsRuleGenerated: boolean;
  /** Reference to authoritative domain state (C2). */
  domainRef?: Record<string, unknown> | null;
}

export interface EngineResult {
  traceId: string;
  idempotencyKey: string;
  mode: string;
  eligibility: EligibilityDecision;
  promotion: PromotionDecision | null;
  proposalId: string | null;
  duplicate: boolean;
  modelCalls: number;
  relatedRetrieved: number;
  /** True when nothing beyond Gate A ran. Proves I5 at runtime. */
  shortCircuited: boolean;
  /**
   * True when an arm that should have contributed did not. Surfaced so a CALLER
   * can tell a thin result caused by a degraded subsystem from a thin corpus —
   * the same distinction RetrievalService makes, which is worthless if the layer
   * above swallows it.
   */
  retrievalDegraded: boolean;
  error?: string;
}

/**
 * Authority of a retrieved incumbent.
 *
 * FAILS CLOSED on a malformed governed row (memory_class set, authority_tier
 * NULL). Codex review: this previously called `bootstrapTierFromSource()` and
 * continued as governed, reconstructing governed authority from a source string —
 * the exact veto the canonical contract removes. Migration 099's completeness
 * constraint should make the state unreachable; if it occurs anyway the engine
 * must refuse rather than invent.
 *
 * Legacy rows (memory_class NULL) keep the centralized compatibility mapping.
 */
function resolveIncumbentTier(
  g: GovernanceRow | undefined,
  r: { source: string },
): AuthorityTier {
  if (g?.authority_tier) return g.authority_tier as AuthorityTier;
  if (g?.memory_class) {
    throw new Error(
      `GOVERNED_AUTHORITY_MISSING: memory ${g.id} has memory_class but no authority_tier`);
  }
  return bootstrapTierFromSource(g?.source ?? r.source);
}

/** Normalizes claim text for identity and comparison. */
function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Stable fingerprint of a claim family, used by suppressions (C20). */
export function claimFingerprint(workspaceId: string, normalized: string, scopeKey: string): string {
  return createHash('sha256').update(`${workspaceId}|${normalized}|${scopeKey}`).digest('hex');
}

/**
 * Deterministic candidate identity — ADR-067 C14.
 *
 * Deliberately includes the NORMALIZED claim and scope key rather than raw
 * wording: model-proposed phrasing must never be the sole identity, or a
 * reworded duplicate would process twice.
 */
export function candidateIdempotencyKey(c: {
  workspaceId: string; productId: string | null;
  provenanceKind: string; sourceId: string;
  normalizedClaim: string; scopeKey: string;
  independenceKeys: string[];
}): string {
  const parts = [
    c.workspaceId, c.productId ?? '-', c.provenanceKind, c.sourceId,
    c.normalizedClaim, c.scopeKey,
    [...new Set(c.independenceKeys)].sort().join(','),
  ].join('|');
  return createHash('sha256').update(parts).digest('hex');
}

/** Resolves the workspace from a CANONICAL record, never from the payload. */
async function resolveCanonicalWorkspace(productId: string | null): Promise<string | null> {
  if (!productId) return null;
  const { data } = await getSupabaseAdmin()
    .from('products').select('workspace_id').eq('id', productId).maybeSingle();
  return (data as { workspace_id: string | null } | null)?.workspace_id ?? null;
}

/** Live suppression for this claim family (C20). */
async function findSuppression(workspaceId: string, fingerprint: string): Promise<{
  reasonClass: 'FOUNDER_RETRACTION' | 'FOUNDER_CORRECTION' | 'SYSTEM_INVALID_SOURCE' | 'LEGAL_DELETION';
  suppressedIndependenceKeys: string[];
} | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('memory_suppressions')
    .select('reason_class, suppressed_evidence_independence_keys, expires_at')
    .eq('workspace_id', workspaceId)
    .eq('claim_fingerprint', fingerprint)
    .is('reversed_at', null)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { reason_class: string; suppressed_evidence_independence_keys: string[]; expires_at: string | null };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return {
    reasonClass: row.reason_class as 'FOUNDER_RETRACTION',
    suppressedIndependenceKeys: row.suppressed_evidence_independence_keys ?? [],
  };
}

/** Governance columns for the ids RetrievalService nominated. */
interface GovernanceRow {
  id: string; memory_class: string | null; authority_tier: string | null;
  scope: Record<string, unknown> | null; scope_key: string | null; source: string;
  status: string; confidence: number; version: number;
}

async function loadGovernance(workspaceId: string, ids: string[]): Promise<Map<string, GovernanceRow>> {
  if (!ids.length) return new Map();
  const { data } = await getSupabaseAdmin()
    .from('marketing_memories')
    .select('id, memory_class, authority_tier, scope, scope_key, source, status, confidence, version')
    .eq('workspace_id', workspaceId)      // tenancy re-applied, never assumed
    .in('id', ids);
  return new Map(((data ?? []) as GovernanceRow[]).map(r => [r.id, r]));
}

/** Independence keys already attached to a memory, for the replay test. */
async function loadAttachedIndependence(memoryIds: string[]): Promise<Map<string, string[]>> {
  if (!memoryIds.length) return new Map();
  const { data } = await getSupabaseAdmin()
    .from('memory_evidence').select('memory_id, independence_key').in('memory_id', memoryIds);
  const out = new Map<string, string[]>();
  for (const r of (data ?? []) as Array<{ memory_id: string; independence_key: string | null }>) {
    if (!r.independence_key) continue;
    out.set(r.memory_id, [...(out.get(r.memory_id) ?? []), r.independence_key]);
  }
  return out;
}

/**
 * Processes one candidate end to end.
 *
 * In `shadow` (the only mode 3.2A supports) it persists a durable proposal and
 * mutates no authoritative table. `active` is deliberately NOT implemented here:
 * the fork exists so activation is a controlled change at one place, not an
 * architectural rewrite.
 */
export async function processCandidate(
  candidate: MemoryCandidate,
  opts: { allowModel?: boolean; traceId?: string } = {},
): Promise<EngineResult> {
  const traceId = opts.traceId ?? newTraceId();
  const mode = ingestionMode();
  const budget = new ModelCallBudget();

  // ── Normalize (one canonical normalizer, C10) ──────────────────────────────
  const normalized = normalizeMemoryScope(candidate.scope);
  const normalizedClaim = normalizeClaim(candidate.claimText);
  const independenceKeys = [...new Set(candidate.evidenceIndependenceKeys ?? [])];

  const idempotencyKey = candidateIdempotencyKey({
    workspaceId: candidate.workspaceId,
    productId: candidate.productId,
    provenanceKind: candidate.provenance?.kind ?? 'unknown',
    sourceId: candidate.provenance?.sourceId ?? 'unknown',
    normalizedClaim,
    scopeKey: normalized.scopeKey,
    independenceKeys,
  });

  // ── Authority from authenticated provenance only (C4, §30) ─────────────────
  const provenanceCtx: ProvenanceContext = {
    actorType: candidate.actorType,
    kind: candidate.provenance?.kind ?? 'unknown',
    founderConfirmed: candidate.founderConfirmed,
    controlledExperiment: candidate.controlledExperiment,
    legacySource: candidate.source,
  };
  const authority = authorityForCandidate(provenanceCtx);

  const canonicalWorkspaceId = candidate.productId
    ? await resolveCanonicalWorkspace(candidate.productId)
    : candidate.workspaceId;

  const fingerprint = claimFingerprint(candidate.workspaceId, normalizedClaim, normalized.scopeKey);
  const suppression = canonicalWorkspaceId === candidate.workspaceId
    ? await findSuppression(candidate.workspaceId, fingerprint)
    : null;

  // ── GATE A — pure, model-free (invariant I5) ───────────────────────────────
  const eligibility = evaluateCandidateEligibility({
    workspaceId: candidate.workspaceId,
    productId: candidate.productId,
    canonicalWorkspaceId,
    claimText: candidate.claimText,
    memoryClass: candidate.memoryClass,
    authorityTier: authority.tier,
    scope: normalized.scope,
    scopeCompleteness: normalized.completeness,
    provenance: candidate.provenance ?? null,
    actorType: candidate.actorType,
    evidenceIds: candidate.evidenceIds ?? [],
    evidenceRecords: candidate.evidenceRecords,
    evidenceIndependenceKeys: independenceKeys,
    idempotencyKey,
    sampleSize: candidate.sampleSize ?? null,
    claimIsRuleGenerated: candidate.claimIsRuleGenerated,
    suppression,
  });

  const basePolicyVersions = {
    authority: AUTHORITY_POLICY_VERSION,
    scope: SCOPE_POLICY_VERSION,
    confidence: CONFIDENCE_POLICY_VERSION,
    retrieval: RETRIEVAL_POLICY_VERSION,
  };

  const baseRecord = {
    workspaceId: candidate.workspaceId,
    productId: candidate.productId,
    idempotencyKey,
    claimText: candidate.claimText,
    normalizedClaim,
    memoryClass: candidate.memoryClass,
    scope: normalized.scope as Record<string, unknown>,
    scopeKey: normalized.scopeKey,
    scopeSpecificity: normalized.specificity,
    scopeCompleteness: normalized.completeness,
    authorityTier: authority.tier,
    provenance: { ...candidate.provenance, authorityReason: authority.reason,
                  domainRef: candidate.domainRef ?? null } as Record<string, unknown>,
    evidenceIds: candidate.evidenceIds ?? [],
    evidenceRecords: candidate.evidenceRecords,
    evidenceIndependenceKeys: independenceKeys,
    eligibility,
    ingestionMode: mode,
    traceId,
  };

  // Gate A rejection short-circuits: no embedding, no retrieval, no model call.
  // The proposal is STILL persisted, because the rejection reason is the
  // measurement (§29) — a silently dropped candidate teaches nothing.
  if (eligibility.result !== 'ELIGIBLE') {
    const persisted = await persistShadowProposal({
      ...baseRecord,
      retrievalMode: null, retrievalDegraded: false,
      relatedMemoryCount: 0, retrievalDiagnostics: {},
      promotion: null,
      policyVersions: basePolicyVersions,
      deterministicOnly: true, modelCallCount: 0, modelRequestIds: [],
      comparisonUnavailable: false,
      comparisons: [],
    });
    return {
      traceId, idempotencyKey, mode, eligibility, promotion: null,
      proposalId: persisted.proposalId, duplicate: persisted.duplicate,
      modelCalls: 0, relatedRetrieved: 0, shortCircuited: true,
      retrievalDegraded: false,      // Gate A short-circuited; retrieval never ran
      error: persisted.error,
    };
  }

  // ── BOUNDED RETRIEVAL (C15) — replaces the O(N) scan ───────────────────────
  let related: Awaited<ReturnType<typeof retrieveMemories>> | null = null;
  let retrievalFailed = false;
  try {
    related = await retrieveMemories({
      workspaceId: candidate.workspaceId,
      productId: candidate.productId ?? undefined,
      query: candidate.claimText,
      limit: PROMOTION_BUDGETS.maxRelatedMemories,
    });
  } catch (err) {
    // A retrieval outage must not block ingestion (C15). It also must not look
    // like "nothing related exists", which would let CREATE_NEW fire blind.
    retrievalFailed = true;
    Sentry.captureException(err, { tags: { stage: 'memoryEngine.retrieval' } });
  }

  const nominated = (related?.results ?? []).slice(0, PROMOTION_BUDGETS.maxRelatedMemories);
  const governance = await loadGovernance(candidate.workspaceId, nominated.map(r => r.id));
  const attachedIndependence = await loadAttachedIndependence(nominated.map(r => r.id));

  // ── COMPARISON: deterministic for all, model for the top few deferred ──────
  const comparisons: ProposalComparisonRecord[] = [];
  const compared: ComparedMemory[] = [];
  const modelRequestIds: string[] = [];
  let comparisonUnavailable = retrievalFailed;

  const candidateClaim: ComparableClaim = {
    text: candidate.claimText,
    scope: {
      channel: normalized.scope.channel ?? null,
      segment: normalized.scope.audience_segment ?? null,
      market: normalized.scope.geography ?? null,
      timeframe: normalized.scope.timeframe ?? null,
      productId: candidate.productId,
    },
    memoryType: candidate.memoryClass,
  };

  const deferred: Array<{ index: number; memClaim: ComparableClaim }> = [];

  for (const [i, r] of nominated.entries()) {
    if (i >= PROMOTION_BUDGETS.maxDeterministicComparisons) break;
    const g = governance.get(r.id);
    const memScope = normalizeMemoryScope(g?.scope ?? {}, { allowUnknown: true });
    // Routed through the ONE governance policy, never re-derived inline.
    const isLegacy = isLegacyMemory({ memoryClass: g?.memory_class ?? null });

    const memClaim: ComparableClaim = {
      text: r.claim ?? r.title,
      scope: {
        channel: memScope.scope.channel ?? null,
        segment: memScope.scope.audience_segment ?? null,
        market: memScope.scope.geography ?? null,
        timeframe: memScope.scope.timeframe ?? null,
        productId: r.productId,
      },
      memoryType: g?.memory_class ?? r.memoryType,
    };

    const det = compareDeterministic(memClaim, candidateClaim);
    const record: ProposalComparisonRecord = {
      memoryId: r.id,
      memoryVersion: r.version,
      memoryScopeKey: g?.scope_key ?? null,
      memoryClass: g?.memory_class ?? null,
      memoryAuthorityTier: resolveIncumbentTier(g, r),
      memoryIsLegacy: isLegacy,
      lexicalRank: r.lexicalRank, semanticRank: r.semanticRank,
      fusedRank: r.fusedRank, finalRank: r.finalRank,
      semanticDistance: r.semanticDistance,
      classification: det?.classification ?? null,
      rationaleCode: det?.rationaleCode ?? null,
      ambiguity: det?.ambiguity ?? null,
      // 'unavailable' = the deterministic comparator DEFERRED and nothing has
      // resolved it yet. It was previously initialised to 'skipped_budget',
      // which conflated "deliberately deferred to the model" with "never
      // compared at all" and made the under-matching in the first observation
      // impossible to diagnose from the persisted record. Budget-skip is
      // applied explicitly further down, after the model stage.
      decidedBy: det ? 'deterministic' : 'unavailable',
      modelRequestId: null,
      scopeRelation: compareMemoryScope(memScope.scope, normalized.scope),
      beliefPolicyAction: null,
      requiresFounderReview: false,
    };
    comparisons.push(record);

    compared.push({
      memoryId: r.id, version: r.version,
      scope: memScope.scope as MemoryScope, scopeKey: g?.scope_key ?? null,
      memoryClass: (g?.memory_class as MemoryClass | null) ?? null,
      authorityTier: resolveIncumbentTier(g, r),
      source: g?.source ?? r.source,
      isLegacy,
      status: g?.status ?? r.status,
      confidence: g?.confidence ?? r.confidence,
      classification: det?.classification ?? null,
      decidedBy: det ? 'deterministic' : 'skipped_budget',
      finalRank: r.finalRank,
      existingIndependenceKeys: attachedIndependence.get(r.id) ?? [],
    });

    if (!det) deferred.push({ index: comparisons.length - 1, memClaim });
  }

  // Model-assisted only for the top-N deferred by rank, hard-capped (C15).
  if (opts.allowModel !== false) {
    for (const dfr of deferred.slice(0, PROMOTION_BUDGETS.maxModelComparisons)) {
      if (!budget.tryConsume()) break;
      try {
        const res = await compareClaims(dfr.memClaim, candidateClaim, {
          allowModel: true,
          auditCtx: { founderId: null, productId: candidate.productId, contextPackageId: null },
        });
        // THE MODEL IS ADVISORY. When the deterministic layer established
        // SAME_SUBJECT_DIFFERENT_MEASURE, compareClaims marks the result
        // `unresolved` unless the model found a genuine contradiction or
        // reinforcement. An unresolved pair keeps a NULL classification, which
        // Gate B already turns into KEEP_AS_EVIDENCE_ONLY. Without this a model
        // answering "UNRELATED" would mint a new memory for two claims about the
        // same intervention.
        const resolved = res.unresolved ? null : res.classification;
        comparisons[dfr.index].classification = resolved;
        comparisons[dfr.index].rationaleCode = res.rationaleCode;
        comparisons[dfr.index].ambiguity = res.ambiguity;
        comparisons[dfr.index].decidedBy = res.decidedBy === 'model_assisted' ? 'model_assisted' : 'deterministic';
        compared[dfr.index].classification = resolved;
        compared[dfr.index].decidedBy = comparisons[dfr.index].decidedBy ?? 'deterministic';
        if (res.modelRequestId) modelRequestIds.push(res.modelRequestId);
      } catch (err) {
        // Provider outage: the pair is UNDETERMINED, not UNRELATED. Marking it
        // unrelated would let a contradiction slip through as a new memory.
        comparisons[dfr.index].decidedBy = 'unavailable';
        compared[dfr.index].decidedBy = 'unavailable';
        comparisonUnavailable = true;
        Sentry.captureException(err, { tags: { stage: 'memoryEngine.comparison' } });
      }
    }
    // Anything still deferred past the budget is recorded, never silently dropped.
    for (const dfr of deferred.slice(PROMOTION_BUDGETS.maxModelComparisons)) {
      comparisons[dfr.index].decidedBy = 'skipped_budget';
      compared[dfr.index].decidedBy = 'skipped_budget';
    }
  }

  // A comparison the deterministic path deferred and nothing resolved is an
  // OPEN QUESTION, not a finding of "unrelated". Gate B must not read it as
  // permission to create a new memory.
  //
  // This is the measured cause of B1. In the first observation all three
  // near-duplicate paraphrases nominated the correct incumbent at rank 1 with
  // scope `same` and semantic distance 0.10–0.15; the comparator deferred (as
  // ADR-066 Amendment 5 requires for a paraphrase), the model was disabled for
  // that run, and Gate B fell through to CREATE_NEW because a null
  // classification is skipped by the same branch as UNRELATED. The same would
  // happen in ACTIVE mode during any provider outage — silently fragmenting
  // the corpus exactly when comparison is least reliable.
  const unresolvedComparisons = compared.filter(c => c.classification === null).length;

  // ── GATE B ─────────────────────────────────────────────────────────────────
  // A DEGRADED retrieval is not a failed one — it returns rows — but it cannot
  // prove absence. Passed separately from `comparisonUnavailable` so the policy
  // can block only the absence-based outcome. Previously `related.degraded` was
  // written onto the proposal and never consulted by the decision.
  const retrievalDegraded = related?.degraded ?? retrievalFailed;
  const retrievalDegradedReasons =
    related?.degradedReasons ?? (retrievalFailed ? ['RETRIEVAL_THREW'] : []);

  const promotion = decidePromotion({
    retrievalDegraded,
    retrievalDegradedReasons,
    memoryClass: candidate.memoryClass,
    authorityTier: authority.tier,
    candidateSource: candidate.source,
    scope: normalized.scope,
    scopeKey: normalized.scopeKey,
    evidenceIndependenceKeys: independenceKeys,
    reopenWithReview: eligibility.reopenWithReview,
    comparisonUnavailable,
    unresolvedComparisons,
    related: compared,
  });

  for (const c of comparisons) {
    if (c.memoryId === promotion.targetMemoryId) {
      c.beliefPolicyAction = promotion.beliefAction;
      c.requiresFounderReview = promotion.requiresFounderReview;
    }
  }

  // ── SHADOW: persist, mutate nothing ────────────────────────────────────────
  const persisted = await persistShadowProposal({
    ...baseRecord,
    retrievalMode: related?.mode ?? null,
    retrievalDegraded: related?.degraded ?? retrievalFailed,
    relatedMemoryCount: nominated.length,
    retrievalDiagnostics: {
      arms: related?.arms ?? [],
      degradedReasons: related?.degradedReasons ?? (retrievalFailed ? ['retrieval_failed'] : []),
      timings: related?.timings ?? null,
      deferredComparisons: deferred.length,
      skippedForBudget: budget.skipped,
      unresolvedComparisons,
    },
    promotion,
    policyVersions: {
      ...basePolicyVersions,
      comparison: COMPARISON_POLICY_VERSION,
      promotion: PROMOTION_POLICY_VERSION,
    },
    deterministicOnly: budget.used === 0,
    modelCallCount: budget.used,
    modelRequestIds,
    comparisonUnavailable,
    comparisons,
  });

  return {
    traceId, idempotencyKey, mode, eligibility, promotion,
    proposalId: persisted.proposalId, duplicate: persisted.duplicate,
    modelCalls: budget.used, relatedRetrieved: nominated.length,
    shortCircuited: false,
    retrievalDegraded: related?.degraded ?? retrievalFailed,
    error: persisted.error,
  };
}
