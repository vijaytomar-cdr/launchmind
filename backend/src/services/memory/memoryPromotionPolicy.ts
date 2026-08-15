/**
 * @file memoryPromotionPolicy.ts
 * @description GATE B — ADR-067 C5, C6, C11, C13, invariant I6.
 *
 *   Gate B answers "given what LaunchMind already believes, what should happen
 *   to the corpus?". It runs only after bounded retrieval and comparison.
 *
 *   WHY THIS IS NOT `BeliefPolicy`. `decide()` has the signature
 *   `(classification, incumbentSource, challengerSource)` — it is pairwise by
 *   construction and structurally cannot express three of the seven outcomes:
 *   CREATE_NEW (there is no incumbent), CREATE_SCOPED_EXCEPTION (both records
 *   survive) and NO_OP (a statement about evidence replay). Widening `decide()`
 *   to take a set would destroy the property that makes it trustworthy — that
 *   it is a small pure function over a fixed tuple. So Gate B sits ABOVE it and
 *   calls it for the pairwise part.
 *
 *   This module DOES NOT WRITE. It returns an outcome; MemoryLifecycleService is
 *   the only thing that applies one (C16).
 *
 * @security Enforces the corroboration rule (C6) — a single-source LEARNING can
 *   never be proposed as `active` — and the legacy quarantine (C11).
 * @dependencies beliefPolicy, authorityPolicy, scopePolicy (all pure)
 */

import { decide, decideWithAuthority, FOUNDER_TIER_SET, type ClaimClassification } from './beliefPolicy';
import {
  type AuthorityTier, qualifiesForImmediateActive, requiresFounderReview,
  mayAutoOverride, AUTHORITY_POLICY_VERSION,
} from './authorityPolicy';
import {
  type MemoryScope, compareMemoryScope, isScopedExceptionOf, type ScopeRelation,
} from './scopePolicy';
import { governMemoryEligibility } from './memoryGovernancePolicy';

/** Bumped when any outcome rule below changes. Persisted on every proposal. */
export const PROMOTION_POLICY_VERSION = 1;

export const PROMOTION_OUTCOMES = [
  'CREATE_NEW',
  'REINFORCE',
  'SUPERSEDE',
  'CHALLENGE',
  'CREATE_SCOPED_EXCEPTION',
  'NO_OP',
  'KEEP_AS_EVIDENCE_ONLY',
] as const;
export type PromotionOutcome = typeof PROMOTION_OUTCOMES[number];

export type MemoryClass = 'DIRECTIVE' | 'FACT' | 'LEARNING' | 'DECISION';

/** One compared incumbent, already classified. */
export interface ComparedMemory {
  memoryId: string;
  version: number;
  scope: MemoryScope;
  scopeKey: string | null;
  memoryClass: MemoryClass | null;
  authorityTier: AuthorityTier;
  /**
   * The incumbent's stored `source`. Passed to BeliefPolicy.decide(), which maps
   * SOURCES to its own precedence tiers internally — handing it an
   * AuthorityTier would fall through to `default: derived_inference` and turn
   * the strongest authority into the weakest.
   */
  source: string;
  /** True for pre-3.2A rows: quarantined by C11. */
  isLegacy: boolean;
  status: string;
  confidence: number;
  classification: ClaimClassification | null;
  decidedBy: 'deterministic' | 'model_assisted' | 'skipped_budget' | 'unavailable';
  finalRank: number;
  /** Independence keys already attached to this memory. */
  existingIndependenceKeys: string[];
}

export interface PromotionInput {
  memoryClass: MemoryClass;
  authorityTier: AuthorityTier;
  /** Candidate's stored `source`, for BeliefPolicy. See ComparedMemory.source. */
  candidateSource: string;
  scope: MemoryScope;
  scopeKey: string;
  evidenceIndependenceKeys: string[];
  /** Set when Gate A reopened a suppressed claim (C20). */
  reopenWithReview?: boolean;
  /** True when at least one comparison could not run (provider outage). */
  comparisonUnavailable?: boolean;
  /**
   * True when retrieval RAN but an arm was degraded (semantic provider down,
   * zero/stale embeddings, contract mismatch, lexical SQL failure).
   *
   * Distinct from `comparisonUnavailable`, which meant "retrieval threw".
   * A degraded search still returns rows, so it can positively ESTABLISH a
   * relationship — but it can never establish ABSENCE of one, because the arm
   * that would have found the incumbent is the arm that did not run.
   *
   * THE INVARIANT: retrieval failure may reduce learning velocity; it must never
   * increase memory fragmentation.
   */
  retrievalDegraded?: boolean;
  /** Why retrieval degraded, persisted so a deferral is explainable. */
  retrievalDegradedReasons?: string[];
  /**
   * Nominated memories the comparator could not classify — deferred and never
   * resolved (model disabled, over the model budget, or a provider failure).
   * An open question is not a finding of "unrelated"; see the fallthrough.
   */
  unresolvedComparisons?: number;
  related: ComparedMemory[];
}

export interface PromotionDecision {
  outcome: PromotionOutcome;
  reasonCode: string;
  reason: string;
  policyVersion: number;
  targetMemoryId: string | null;
  targetMemoryVersion: number | null;
  exceptionToMemoryId: string | null;
  /** Lifecycle state a NEW memory would enter. Null when none is created. */
  proposedEntryState: 'draft' | 'active' | null;
  /** The pairwise action BeliefPolicy permitted, when a pair was involved. */
  beliefAction: 'reinforce' | 'challenge' | 'supersede' | 'none' | null;
  requiresFounderReview: boolean;
  scopeRelation: ScopeRelation | null;
  authorityPolicyVersion: number;
}

function d(
  outcome: PromotionOutcome, reasonCode: string, reason: string,
  over: Partial<PromotionDecision> = {},
): PromotionDecision {
  return {
    outcome, reasonCode, reason,
    policyVersion: PROMOTION_POLICY_VERSION,
    targetMemoryId: null, targetMemoryVersion: null, exceptionToMemoryId: null,
    proposedEntryState: null, beliefAction: null, requiresFounderReview: false,
    scopeRelation: null, authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
    ...over,
  };
}

/**
 * The corroboration rule — ADR-067 C6, invariant I6.
 *
 * A LEARNING supported by a single independent evidence source never reaches
 * `active` automatically. This is the rule that stops one provider reading
 * becoming a durable belief, and it is deliberately cheap: independence is
 * already carried by `evidence.independence_key`.
 *
 * Founder and controlled-experiment authority bypass it (C6) — demanding that a
 * founder statement be corroborated is incoherent, and an experiment contains
 * its own control.
 */
export function entryStateFor(
  memoryClass: MemoryClass,
  authorityTier: AuthorityTier,
  independenceKeys: string[],
): { state: 'draft' | 'active'; reason: string } {
  if (qualifiesForImmediateActive(authorityTier)) {
    return { state: 'active', reason: `authority ${authorityTier} qualifies for immediate active` };
  }
  const independent = new Set(independenceKeys.filter(Boolean)).size;
  if (independent >= 2) {
    return { state: 'active', reason: `${independent} independent evidence sources corroborate` };
  }
  return {
    state: 'draft',
    reason: `only ${independent} independent evidence source; ${memoryClass} requires 2 to become active`,
  };
}

/**
 * Runs Gate B.
 *
 * Evaluates related memories by DECISION RISK and returns the first decisive
 * outcome, using retrieval rank as the tie-break within a risk class.
 *
 * The original rule was pure retrieval order, to stop "a rank-9 duplicate
 * overriding a rank-1 contradiction". That intent is kept and extended: the
 * measured q25 failure was the mirror image — a rank-1 REINFORCEMENT returning
 * before a rank-2 CONTRADICTION against a FOUNDER_ASSERTED belief was ever
 * examined. A contradiction now decides regardless of where it ranks, in either
 * direction. Relevance still orders equals; it no longer outranks consequence.
 */
export function decidePromotion(input: PromotionInput): PromotionDecision {
  const decision = decidePromotionInner(input);

  // ── CANDIDATE-LEVEL UNRESOLVED-FOUNDER GUARD (P0) ────────────────────────
  //
  // THE INVARIANT: if a candidate has ANY unresolved founder-tier conflict, it
  // may not perform ANY unreviewed durable positive belief transition.
  //
  // MEASURED DEFECT: the first version of this guard sat inside the
  // DUPLICATE/REINFORCEMENT branch, so it protected exactly one outcome.
  // SUPERSEDE and CREATE_SCOPED_EXCEPTION were reachable while a founder
  // relationship sat unclassified — a candidate could retire another memory
  // outright with a founder conflict still open. Putting the check in the
  // SUPERSEDE branch too would repeat the structural mistake and leave the next
  // outcome unprotected, so it is enforced HERE, at the one point every
  // candidate-level decision passes through. A new positive outcome added to
  // PROMOTION_OUTCOMES is covered by default, not by remembering to guard it.
  //
  // CREATE_NEW is already blocked upstream by the unresolvedComparisons check
  // and is listed anyway: defence in depth costs nothing and the upstream check
  // is a different mechanism that could be changed independently.
  const unresolvedFounderConflict = findUnresolvedFounderConflict(input.related);
  if (unresolvedFounderConflict
      && DURABLE_POSITIVE_OUTCOMES.has(decision.outcome)
      && !decision.requiresFounderReview) {
    return d('KEEP_AS_EVIDENCE_ONLY', 'UNRESOLVED_FOUNDER_CONFLICT',
      'a founder-authored belief in the comparison set could not be classified; '
      + `evidence is retained and ${decision.outcome} is withheld pending founder review`,
      {
        targetMemoryId: unresolvedFounderConflict.memoryId,
        targetMemoryVersion: unresolvedFounderConflict.version,
        beliefAction: 'none',
        requiresFounderReview: true,
        scopeRelation: decision.scopeRelation,
      });
  }
  return decision;
}

/**
 * Outcomes that durably establish, strengthen or retire a belief.
 *
 * Classified from the RETURN SITES, not from the names: REINFORCE adds
 * confidence, SUPERSEDE retires an incumbent, CREATE_SCOPED_EXCEPTION and
 * CREATE_NEW both mint a memory whose `proposedEntryState` may be `active`.
 * CHALLENGE always carries requiresFounderReview, KEEP_AS_EVIDENCE_ONLY changes
 * nothing, and NO_OP is by definition inert — none of those are durable
 * positive transitions.
 */
const DURABLE_POSITIVE_OUTCOMES: ReadonlySet<PromotionOutcome> = new Set([
  'REINFORCE', 'SUPERSEDE', 'CREATE_SCOPED_EXCEPTION', 'CREATE_NEW',
]);

/**
 * The one definition of "unresolved founder conflict".
 *
 * Founder authority comes from the governed AUTHORITY TIER, never from a source
 * string, and the rule is deliberately NOT widened to every unresolved memory —
 * blanket blocking was mutation-tested and rejected.
 */
function findUnresolvedFounderConflict(related: ComparedMemory[]): ComparedMemory | undefined {
  return related.find(m =>
    m.classification === null && !m.isLegacy
    && m.authorityTier != null && FOUNDER_TIER_SET.has(m.authorityTier));
}

function decidePromotionInner(input: PromotionInput): PromotionDecision {
  const { related } = input;

  // ── No related memory → possible creation (§11) ───────────────────────────
  // Absence of a related memory is not proof the candidate deserves memory; it
  // only means nothing conflicts. The entry-state rule still applies.
  if (related.length === 0) {
    // THE MEASURED DEFECT. Zero results plus a degraded arm is not "nothing
    // related exists" — it is "the arm that would have found it did not run".
    // This exact combination produced 84 blind CREATE_NEW decisions against a
    // corpus that had no vectors at all. Checked here as well as in the
    // post-comparison fallthrough, because zero-results short-circuits earlier.
    if (input.retrievalDegraded || input.comparisonUnavailable) {
      return d('KEEP_AS_EVIDENCE_ONLY', 'RETRIEVAL_DEGRADED',
        'retrieval returned nothing while degraded, so the absence of a related ' +
        'memory could not be established' +
        (input.retrievalDegradedReasons?.length
          ? ` (${input.retrievalDegradedReasons.join(', ')})` : ''),
        { scopeRelation: null });
    }
    const entry = entryStateFor(input.memoryClass, input.authorityTier, input.evidenceIndependenceKeys);
    return d('CREATE_NEW', 'NO_RELATED_MEMORY',
      `no related memory was retrieved; ${entry.reason}`, {
        proposedEntryState: entry.state,
        requiresFounderReview: input.reopenWithReview === true,
      });
  }

  // ── RISK-ORDERED EVALUATION (P0) ─────────────────────────────────────────
  //
  // MEASURED DEFECT: this loop is first-match-wins in RETRIEVAL-RANK order and
  // returns on the first actionable classification. For q25 the comparison set
  // was, in rank order:
  //
  //   rank 1  OBSERVED_FIRST_PARTY  REINFORCEMENT
  //   rank 2  FOUNDER_ASSERTED      CONTRADICTION   <- never reached
  //   rank 3  OBSERVED_FIRST_PARTY  UNRELATED
  //
  // The founder-conflicting pair WAS compared and WAS correctly classified
  // CONTRADICTION; the loop simply returned REINFORCE before it got there. A
  // claim inverting a founder-asserted belief raised that belief's confidence
  // with no founder review.
  //
  // Ordering is by CONSEQUENCE, not relevance: an unhandled contradiction can
  // corrupt durable memory, an unhandled reinforcement cannot. Retrieval rank
  // remains the tie-break WITHIN a class, so relevance still decides among
  // equals and retrieval membership is untouched.
  const riskRank = (m: ComparedMemory): number => {
    if (m.classification === 'CONTRADICTION') return 0;
    if (m.classification === null) return 1;   // unresolved: an open question
    return 2;
  };
  const ordered = related
    .map((m, i) => ({ m, i }))
    .sort((a, b) => riskRank(a.m) - riskRank(b.m) || a.i - b.i)
    .map(x => x.m);

  for (const m of ordered) {
    // ── Legacy quarantine (C11, invariant I11) ─────────────────────────────
    // Evaluated BEFORE the unresolved/unrelated skip, and via the one canonical
    // governance policy.
    //
    // A pre-3.2A row has no governed scope, so we cannot tell whether an
    // opposing claim contradicts it or is a scoped exception to it. Guessing
    // either way is unsafe. Crucially, an UNRESOLVED comparison against a legacy
    // row is not evidence of no relationship — the previous version skipped it
    // by the same branch as UNRELATED, so the candidate fell through to
    // CREATE_NEW and quarantine accuracy measured 2/4.
    const governance = governMemoryEligibility(m, 'TRANSITION');
    if (governance.isLegacy) {
      // Only a positive finding of UNRELATED clears a legacy row from the way.
      if (m.classification === 'UNRELATED') continue;
      const unresolved = m.classification === null;
      return d('KEEP_AS_EVIDENCE_ONLY', governance.reasonCode,
        unresolved
          ? 'a legacy incumbent was nominated and could not be classified; it predates ' +
            'governed scope and may not be related to automatically'
          : 'incumbent predates governed scope; evidence is retained without changing it',
        { targetMemoryId: m.memoryId, targetMemoryVersion: m.version, scopeRelation: 'unknown' });
    }

    if (!m.classification || m.classification === 'UNRELATED') continue;

    const scopeRelation = compareMemoryScope(m.scope, input.scope);

    // ── Scoped exception (C13) ─────────────────────────────────────────────
    // Checked BEFORE contradiction: an opposing claim on a strictly narrower
    // scope is two true statements, not a conflict. This is the over-flagging
    // measured in 3.1G §4.2.
    if (m.classification === 'CONTRADICTION' && isScopedExceptionOf(input.scope, m.scope)) {
      // A scoped exception to a founder-authored memory is a FOUNDER decision.
      //
      // Carving out "except on Meta" from "Never use discount-led messaging"
      // narrows a directive the founder set, and doing it from automated
      // evidence would erode that directive one narrow scope at a time without
      // the founder ever being asked. Shadow observation produced exactly this:
      // automated campaign evidence proposed a scoped exception to a
      // FOUNDER_ASSERTED DIRECTIVE. The exception may still be the right answer
      // — but only a founder may say so, so it becomes a CHALLENGE.
      if (requiresFounderReview(m.authorityTier, input.authorityTier)) {
        return d('CHALLENGE', 'SCOPED_EXCEPTION_TO_FOUNDER_MEMORY',
          'candidate binds a narrower scope than a founder-authored memory; narrowing a ' +
          'founder directive is a founder decision, not an automatic one',
          { targetMemoryId: m.memoryId, targetMemoryVersion: m.version,
            beliefAction: 'challenge', requiresFounderReview: true, scopeRelation: 'narrower' });
      }
      const entry = entryStateFor(input.memoryClass, input.authorityTier, input.evidenceIndependenceKeys);
      return d('CREATE_SCOPED_EXCEPTION', 'NARROWER_SCOPE_EXCEPTION',
        'candidate opposes the incumbent but binds a strictly narrower scope; both remain true',
        {
          exceptionToMemoryId: m.memoryId,
          targetMemoryId: m.memoryId,
          targetMemoryVersion: m.version,
          proposedEntryState: entry.state,
          scopeRelation: 'narrower',
        });
    }

    // ── Different scope is not a relationship at all ───────────────────────
    if (scopeRelation === 'different') {
      continue;   // a conflicting scope means these claims never meet
    }

    // ── Pairwise permission: BOTH policies must agree ──────────────────────
    // BeliefPolicy (Phase 3.1, unmodified) decides on the legacy SOURCE axis.
    // authorityPolicy (C4) decides on the new governed TIER axis, which draws
    // distinctions the source axis cannot — EXPERIMENT_CONTROLLED and a passive
    // observation both map to `observed_first_party` under the old mapping.
    //
    // The two are combined CONSERVATIVELY: supersession requires both to permit
    // it, and review is required if either asks for it. That reuses BeliefPolicy
    // without widening it, and cannot be less safe than Phase 3.1 alone.
    // GOVERNED PATH: when both sides carry a persisted authority tier, precedence
    // comes from the tier alone. Codex review found that calling the source-based
    // `decide()` here left `source` as a load-bearing veto over a governed
    // authority decision. Legacy rows (no tier, or a reconstructed one) still use
    // the source fallback.
    const bothGoverned = m.isLegacy === false && Boolean(m.authorityTier) && Boolean(input.authorityTier);
    const belief = bothGoverned
      ? decideWithAuthority(m.classification, m.authorityTier, input.authorityTier)
      : decide(m.classification, m.source, input.candidateSource);
    const authorityPermitsOverride = mayAutoOverride(m.authorityTier, input.authorityTier);
    const founderReview = requiresFounderReview(m.authorityTier, input.authorityTier)
      || belief.requiresFounderReview
      || input.reopenWithReview === true;

    switch (m.classification) {
      case 'DUPLICATE':
      case 'REINFORCEMENT': {
        // Independent corroboration REINFORCES; a replay changes nothing.
        // Pre-Design flagged that collapsing these into one "duplicate" outcome
        // is what let replayed evidence inflate confidence.
        const isReplay = input.evidenceIndependenceKeys.length > 0
          && input.evidenceIndependenceKeys.every(k => m.existingIndependenceKeys.includes(k));
        if (isReplay) {
          return d('NO_OP', 'EVIDENCE_REPLAY',
            'the same evidence already supports this memory; nothing was learned',
            { targetMemoryId: m.memoryId, targetMemoryVersion: m.version,
              beliefAction: 'none', scopeRelation });
        }
        return d('REINFORCE', m.classification === 'DUPLICATE' ? 'INDEPENDENT_DUPLICATE' : 'AGREEING_EVIDENCE',
          'independent evidence supports an existing belief',
          { targetMemoryId: m.memoryId, targetMemoryVersion: m.version,
            beliefAction: 'reinforce', requiresFounderReview: founderReview, scopeRelation });
      }

      case 'CONTRADICTION': {
        if (belief.action === 'supersede' && authorityPermitsOverride && !founderReview) {
          return d('SUPERSEDE', 'STRONGER_AUTHORITY_CONTRADICTS',
            'a strictly stronger authority contradicts the incumbent on the same scope',
            { targetMemoryId: m.memoryId, targetMemoryVersion: m.version,
              beliefAction: 'supersede', requiresFounderReview: founderReview, scopeRelation });
        }
        // CHALLENGE always requires founder review, regardless of who authored
        // the incumbent. The outcome means the system could NOT resolve the
        // contradiction on authority — so there is no other party who can.
        // Shadow observation emitted a CHALLENGE with requiresFounderReview
        // false; in ACTIVE mode that contradiction would have had no route to
        // resolution and would simply have sat unresolved.
        return d('CHALLENGE', 'CONTRADICTION_REQUIRES_REVIEW',
          founderReview
            ? 'contradicts founder-authored memory; a founder must resolve it'
            : 'contradicts an incumbent of equal or stronger authority; ' +
              'no authority rule can settle it, so a founder must',
          { targetMemoryId: m.memoryId, targetMemoryVersion: m.version,
            beliefAction: 'challenge', requiresFounderReview: true, scopeRelation });
      }
    }
  }

  // ── Everything related was UNRELATED, different-scope, or budget-skipped ──
  if (input.comparisonUnavailable) {
    // A provider outage must never look like "nothing related exists", because
    // that would let CREATE_NEW fire on an unexamined corpus.
    return d('KEEP_AS_EVIDENCE_ONLY', 'COMPARISON_UNAVAILABLE',
      'comparison could not complete; no durable-memory decision is safe',
      { scopeRelation: null });
  }

  // An unresolved comparison must not license a new memory. Reaching here with
  // one means a nominated incumbent was never classified — so "none relates to
  // this claim" is not something the system actually established.
  if ((input.unresolvedComparisons ?? 0) > 0) {
    return d('KEEP_AS_EVIDENCE_ONLY', 'COMPARISON_DEFERRED_UNRESOLVED',
      `${input.unresolvedComparisons} nominated memory/memories were deferred and never ` +
      'classified; creating a new memory would fragment the corpus on an open question',
      { scopeRelation: null });
  }

  // ── ABSENCE REQUIRES A TRUSTWORTHY SEARCH ────────────────────────────────
  // Reaching here means "nothing related was found". That conclusion is only
  // admissible if the search was sound. With a degraded arm, "no related memory"
  // and "we could not look properly" are indistinguishable — and the measured
  // consequence was 84 CREATE_NEW decisions against a corpus whose vectors did
  // not exist. Presence-based outcomes above are unaffected: finding a relation
  // is positive evidence and stays valid even on a partial search.
  if (input.retrievalDegraded) {
    return d('KEEP_AS_EVIDENCE_ONLY', 'RETRIEVAL_DEGRADED',
      'retrieval was degraded, so the absence of a related memory could not be ' +
      'established; creating a new memory here would fragment the corpus' +
      (input.retrievalDegradedReasons?.length
        ? ` (${input.retrievalDegradedReasons.join(', ')})` : ''),
      { scopeRelation: null });
  }

  const entry = entryStateFor(input.memoryClass, input.authorityTier, input.evidenceIndependenceKeys);
  return d('CREATE_NEW', 'NO_RELATED_AFTER_COMPARISON',
    `related memories were retrieved but none relates to this claim; ${entry.reason}`, {
      proposedEntryState: entry.state,
      requiresFounderReview: input.reopenWithReview === true,
    });
}
