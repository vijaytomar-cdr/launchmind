/**
 * @file contextIntents.ts
 * @description Governed retrieval intents and per-intent budgets — Phase 3.1E.
 *
 *   The Context Engine must not send one generic query to RetrievalService for
 *   every task (Step 3.1E §7). "Write today's headline" and "why did you change
 *   your mind about channels?" want different memory: the first wants current
 *   active learning, the second needs superseded beliefs that the first must not
 *   see. An intent is the policy object that encodes that difference.
 *
 *   RETRIEVAL POLICY IS NOT OWNER-CONTROLLED. An intent is chosen by the CALLING
 *   CODE from this closed set. Owner text becomes the query string; it never
 *   selects memory types, widens the budget, or unlocks archived history.
 *   Otherwise "show me everything including archived" would be a prompt away
 *   from being a policy change.
 *
 * @security `includeArchived` is the sensitive flag: archived memories are
 *   superseded beliefs, and surfacing them in a generation task would let the
 *   model act on something LaunchMind has already stopped believing.
 * @dependencies retrievalTypes
 */

export const CONTEXT_INTENTS = [
  'STRATEGY_RECOMMENDATION',
  'MORNING_BRIEF',
  'CAMPAIGN_PLANNING',
  'CONTENT_GENERATION',
  'PERFORMANCE_REVIEW',
  'OWNER_QUESTION',
  'MISSION_EXECUTION',
  'HISTORICAL_EXPLANATION',
  'DIAGNOSTIC',
] as const;
export type ContextIntent = typeof CONTEXT_INTENTS[number];

/** Retention class from migration 095. */
export type RetentionClass = 'decision' | 'briefing' | 'ephemeral';

export interface IntentPolicy {
  /** Memory types worth retrieving. Empty = no restriction. */
  memoryTypes: string[];
  /** Candidates each retrieval arm may return. */
  candidateLimit: number;
  /** Memories that may reach the package. */
  finalLimit: number;
  /** Token budget for the RETRIEVED MEMORY section only. */
  memoryTokenBudget: number;
  /** Token budget for the whole package. */
  totalTokenBudget: number;
  /**
   * Whether superseded/archived belief is eligible.
   *
   * False almost everywhere. A generation task that retrieves a belief
   * LaunchMind has abandoned will act on it, and nothing downstream marks it as
   * abandoned once it is in the prompt.
   */
  includeArchived: boolean;
  /**
   * Whether founder-confirmed context is mandatory in the package.
   *
   * True everywhere an output could contradict the owner. Retrieval ranking is
   * about relevance; this is about authority, and authority is not negotiable
   * by rank (ADR-066 rule 28).
   */
  founderContextRequired: boolean;
  retention: RetentionClass;
}

/**
 * Per-intent policy.
 *
 * Budgets are deliberately modest. The corpus is small today, but a package that
 * grows with the corpus is a package whose cost and latency grow with tenure —
 * the failure mode ADR-066 rule 19 exists to prevent.
 */
export const INTENT_POLICIES: Record<ContextIntent, IntentPolicy> = {
  // Durable owner-facing commitments. Widest memory, longest retention.
  STRATEGY_RECOMMENDATION: {
    memoryTypes: [], candidateLimit: 25, finalLimit: 10,
    memoryTokenBudget: 1_200, totalTokenBudget: 3_000,
    includeArchived: false, founderContextRequired: true, retention: 'decision',
  },
  CAMPAIGN_PLANNING: {
    memoryTypes: ['campaign', 'creative', 'customer', 'founder', 'experiment'],
    candidateLimit: 25, finalLimit: 8,
    memoryTokenBudget: 1_000, totalTokenBudget: 2_500,
    includeArchived: false, founderContextRequired: true, retention: 'decision',
  },

  // Recurring summaries.
  MORNING_BRIEF: {
    memoryTypes: [], candidateLimit: 20, finalLimit: 6,
    memoryTokenBudget: 700, totalTokenBudget: 2_000,
    includeArchived: false, founderContextRequired: true, retention: 'briefing',
  },
  PERFORMANCE_REVIEW: {
    memoryTypes: ['campaign', 'experiment', 'customer', 'market'],
    candidateLimit: 20, finalLimit: 8,
    memoryTokenBudget: 900, totalTokenBudget: 2_200,
    includeArchived: false, founderContextRequired: true, retention: 'briefing',
  },

  // Generation. Narrow on purpose: brand and creative memory, current only.
  CONTENT_GENERATION: {
    memoryTypes: ['brand', 'creative', 'campaign', 'customer', 'founder'],
    candidateLimit: 20, finalLimit: 6,
    memoryTokenBudget: 800, totalTokenBudget: 2_000,
    includeArchived: false, founderContextRequired: true, retention: 'ephemeral',
  },

  // Ad-hoc. The owner's own words drive the query.
  OWNER_QUESTION: {
    memoryTypes: [], candidateLimit: 25, finalLimit: 8,
    memoryTokenBudget: 1_000, totalTokenBudget: 2_500,
    includeArchived: false, founderContextRequired: true, retention: 'ephemeral',
  },

  MISSION_EXECUTION: {
    memoryTypes: [], candidateLimit: 20, finalLimit: 6,
    memoryTokenBudget: 800, totalTokenBudget: 2_200,
    includeArchived: false, founderContextRequired: true, retention: 'decision',
  },

  /**
   * The ONLY intent permitted to see superseded belief.
   *
   * "Why did you change your mind?" is unanswerable without the belief that was
   * abandoned — 3.1D measured historical_learning at 25% precisely because
   * archived memory was unreachable. Confining that to one intent means a
   * content-generation call still cannot act on a retracted claim.
   */
  HISTORICAL_EXPLANATION: {
    memoryTypes: [], candidateLimit: 25, finalLimit: 10,
    memoryTokenBudget: 1_200, totalTokenBudget: 2_800,
    includeArchived: true, founderContextRequired: true, retention: 'briefing',
  },

  /** Debug/inspection surface. No model call, so no durable retention. */
  DIAGNOSTIC: {
    memoryTypes: [], candidateLimit: 25, finalLimit: 10,
    memoryTokenBudget: 1_200, totalTokenBudget: 3_000,
    includeArchived: false, founderContextRequired: false, retention: 'ephemeral',
  },
};

/**
 * @returns Lifecycle statuses eligible for this intent.
 */
export function statusesFor(intent: ContextIntent): string[] {
  // Lifecycle-aware (3.1F §13). CHALLENGED memory is contested, not wrong, so it
  // stays eligible for reasoning intents — clearly tagged — while generation
  // intents see only settled belief. SUPERSEDED, RETRACTED and STALE are
  // excluded everywhere except historical explanation, which exists precisely
  // to show what LaunchMind used to think.
  if (INTENT_POLICIES[intent].includeArchived) {
    return ['active', 'challenged', 'stale', 'superseded', 'retracted', 'archived'];
  }
  switch (intent) {
    // Reasoning intents: a contested belief is useful context, provided the
    // model is told it is contested.
    case 'STRATEGY_RECOMMENDATION':
    case 'OWNER_QUESTION':
    case 'PERFORMANCE_REVIEW':
      return ['active', 'challenged'];
    // Generation intents: settled belief only. Acting on a contested claim
    // produces owner-facing copy LaunchMind is not confident in.
    default:
      return ['active'];
  }
}

/**
 * Section priority when the total budget binds (Step 3.1E §9).
 *
 * Ordered so that what LaunchMind is REQUIRED to know survives, and what merely
 * helps is dropped first. Authoritative state and founder-confirmed direction
 * come before any retrieved memory: a package that drops the owner's stated
 * constraint to make room for a better-ranked historical observation is worse
 * than one that returns less history.
 */
export const SECTION_PRIORITY = [
  'authoritative',      // product, workspace, plan — what is true now
  'founder_confirmed',  // the owner's own direction and boundaries
  'retrieved',          // evidence-backed marketing memory
  'operational',        // current campaigns and performance
  'constraint',         // approval boundaries (small, always fits)
] as const;
export type SectionKind = typeof SECTION_PRIORITY[number];
