/**
 * @file memoryGovernancePolicy.ts
 * @description THE single place that decides what an existing memory row is
 *   allowed to participate in — ADR-067 C11, invariant I11.
 *
 *   WHY THIS EXISTS. The legacy discriminator (`memory_class IS NULL`) was
 *   tested inline inside Gate B's post-classification loop. That had two
 *   consequences, both measured in the 3.2A observation:
 *
 *     1. The quarantine could only fire on a row the comparator had already
 *        classified. A legacy row that was nominated but DEFERRED was skipped
 *        by the same branch as UNRELATED, and the candidate fell through to
 *        CREATE_NEW — quarantine accuracy 2/4.
 *     2. Any future code path that loads a memory and acts on it would have had
 *        to remember to repeat the check. Nothing structural stopped it.
 *
 *   So the rule now lives in one function, is expressed per INTENT, and is
 *   asserted by a structural test that fails if `memory_class` null-testing
 *   reappears anywhere else.
 *
 *   WHAT A LEGACY ROW IS. The 33 pre-3.2A production rows are synthetic,
 *   evidence-free, unscoped and unclassified. They may remain readable for
 *   history and compatibility. They may NOT behave as governed durable memory:
 *   not as a contradiction target, not as a supersession target, not as a
 *   reinforcement sink, not as a scoped-exception parent, and never as the
 *   authoritative incumbent for an automated transition. Until a row is audited
 *   and classified, LaunchMind does not know what it means or what it applies
 *   to — and acting on it would assert a scope nobody established.
 *
 * @security The quarantine that protects the 33 unaudited production rows from
 *   automated mutation. Widening it requires an ADR amendment, not a patch.
 * @dependencies none — pure, no I/O, no model
 */

/** Bumped when any rule below changes. Persisted alongside promotion decisions. */
export const GOVERNANCE_POLICY_VERSION = 1;

/** What the caller wants to do with the memory. */
export type GovernanceIntent =
  /** Offer it to bounded retrieval / comparison as a candidate incumbent. */
  | 'NOMINATE'
  /** Run ClaimComparison against it. */
  | 'COMPARE'
  /** Make it the target of a lifecycle change (reinforce/supersede/challenge/except). */
  | 'TRANSITION'
  /** Read it for display, history, or a shadow diagnostic. */
  | 'DIAGNOSTIC';

export type GovernanceVerdict =
  /** Fully governed: normal participation. */
  | 'NORMAL'
  /** Readable and comparable, but cannot be changed or built upon. */
  | 'LEGACY_READ_ONLY'
  /** Must not be the target of an automated lifecycle transition. */
  | 'INELIGIBLE_FOR_TRANSITION';

/** The minimum shape needed to govern a row. Deliberately narrow. */
export interface GovernableMemory {
  /** NULL marks a pre-3.2A row. THE legacy discriminator. */
  memoryClass?: string | null;
  status?: string | null;
}

export interface GovernanceDecision {
  verdict: GovernanceVerdict;
  reasonCode: string;
  reason: string;
  /** True when the intent is permitted. */
  permitted: boolean;
  isLegacy: boolean;
  policyVersion: number;
}

/**
 * The ONE legacy test in the codebase.
 *
 * A pre-3.2A row carries no `memory_class`. Migration 099's governed-completeness
 * CHECK is written as "legacy OR governed-and-complete", so a row with a class
 * is guaranteed to also carry authority, policy version, scope key and a
 * non-unknown completeness. Class alone is therefore a sufficient discriminator.
 */
export function isLegacyMemory(m: GovernableMemory): boolean {
  return m.memoryClass === null || m.memoryClass === undefined;
}

function decision(
  verdict: GovernanceVerdict, reasonCode: string, reason: string,
  permitted: boolean, isLegacy: boolean,
): GovernanceDecision {
  return { verdict, reasonCode, reason, permitted, isLegacy, policyVersion: GOVERNANCE_POLICY_VERSION };
}

/**
 * Decides whether `memory` may participate in `intent`.
 *
 * Legacy rows are permitted to be nominated, compared and displayed — that is
 * the "compatibility/read path" the ADR allows, and it is what lets a founder
 * still find an old belief. They are refused only at TRANSITION, which is the
 * single point where the corpus would change.
 */
export function governMemoryEligibility(
  memory: GovernableMemory,
  intent: GovernanceIntent,
): GovernanceDecision {
  const legacy = isLegacyMemory(memory);

  if (!legacy) {
    return decision('NORMAL', 'GOVERNED', 'row carries a governed class and authority', true, false);
  }

  switch (intent) {
    case 'NOMINATE':
    case 'COMPARE':
    case 'DIAGNOSTIC':
      // Visible and comparable. Comparing is safe because comparison decides
      // nothing on its own — TRANSITION is where the refusal bites.
      return decision('LEGACY_READ_ONLY', 'LEGACY_UNSCOPED_INCUMBENT',
        'row predates governed scope; readable and comparable but not modifiable', true, true);

    case 'TRANSITION':
      return decision('INELIGIBLE_FOR_TRANSITION', 'LEGACY_UNSCOPED_INCUMBENT',
        'row predates governed scope and has not been audited; it may not be reinforced, ' +
        'contradicted, superseded, or used as a scoped-exception parent automatically',
        false, true);
  }
}

/**
 * Convenience for the common question at Gate B.
 *
 * A legacy row may never be the target of an automated corpus change, whatever
 * the comparator concluded — including when the comparator concluded nothing.
 */
export function mayBeTransitionTarget(memory: GovernableMemory): boolean {
  return governMemoryEligibility(memory, 'TRANSITION').permitted;
}
