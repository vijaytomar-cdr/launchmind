/**
 * @file promotionBudgets.ts
 * @description Bounded per-candidate cost — ADR-067 C15, invariant I15.
 *
 *   Pre-Design measured the existing path as O(N): load every active memory,
 *   compare sequentially, break only on the first non-UNRELATED result. With the
 *   model enabled that is up to N sequential model calls for a genuinely new
 *   claim — ~66 s at 33 memories, and unbounded as the corpus grows.
 *
 *   These constants are the fix, and they are constants rather than options
 *   because a caller that can raise its own budget is not a budget.
 *
 * @security No I/O. Enforced by MarketingMemoryEngine, asserted by test.
 * @dependencies none
 */

export const PROMOTION_BUDGETS = {
  /** Related memories RetrievalService may return per candidate (ADR-067 C15). */
  maxRelatedMemories: 10,
  /** Deterministic comparisons per candidate. Free, but still bounded. */
  maxDeterministicComparisons: 10,
  /**
   * Model-assisted comparisons per candidate — the top 3 by fused rank that the
   * deterministic path deferred on. Everything below rank 3 that is still
   * ambiguous is recorded as `skipped_budget`, never silently dropped.
   */
  maxModelComparisons: 3,
  /** Hard ceiling on provider calls per candidate, excluding aiPlatform retries. */
  maxModelCallsPerCandidate: 3,
} as const;

/** Bumped when any budget or the retrieval configuration changes meaning. */
export const RETRIEVAL_POLICY_VERSION = 1;

/**
 * Counts model calls for one candidate and refuses to exceed the ceiling.
 *
 * A counter rather than a convention: the engine asks permission before each
 * call, so exceeding the budget is impossible rather than merely discouraged.
 */
export class ModelCallBudget {
  #used = 0;
  #skipped = 0;

  constructor(private readonly max: number = PROMOTION_BUDGETS.maxModelCallsPerCandidate) {}

  /** @returns true when a call is permitted; records a skip otherwise. */
  tryConsume(): boolean {
    if (this.#used >= this.max) { this.#skipped++; return false; }
    this.#used++;
    return true;
  }

  get used(): number { return this.#used; }
  get skipped(): number { return this.#skipped; }
  get exhausted(): boolean { return this.#used >= this.max; }
}
