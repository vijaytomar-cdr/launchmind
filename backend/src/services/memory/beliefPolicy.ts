/**
 * @file beliefPolicy.ts
 * @description The deterministic policy engine for memory lifecycle, source
 *   precedence and confidence — Phase 3.1F.
 *
 *   EVERYTHING HERE IS PURE AND DETERMINISTIC. No model call, no I/O, no
 *   randomness. A model may PROPOSE that two claims contradict (claimComparison),
 *   but only this module decides what that means for a memory's state or
 *   confidence, and it decides the same way every time.
 *
 *   That separation is the whole point of ADR-066 invariant 3. "Similarity
 *   nominates; it never decides" is only enforceable if the deciding is
 *   somewhere a model cannot reach.
 *
 *   WHAT CONFIDENCE MEANS. Strength of support for a LaunchMind BELIEF — not
 *   the probability the statement is objectively true. Two independent campaigns
 *   agreeing raises support; it does not make a claim 80% likely in any
 *   frequentist sense, and presenting it that way would be false precision on a
 *   sample of two.
 *
 * @security Pure functions. Cannot write, cannot be influenced by stored text.
 * @dependencies types/memory only
 */

import {
  bootstrapTierFromSource, authorityPrecedenceRank, type AuthorityTier,
} from './authorityPolicy';

// ── Lifecycle ────────────────────────────────────────────────────────────────

export const MEMORY_STATES = [
  'draft', 'active', 'challenged', 'superseded', 'stale', 'retracted', 'archived',
] as const;
export type MemoryState = typeof MEMORY_STATES[number];

/**
 * Governed transitions.
 *
 * SUPERSEDED and RETRACTED are terminal for that version: a belief that has been
 * replaced or withdrawn does not quietly come back. Reviving a claim means
 * creating a NEW memory with its own evidence and its own history — which is
 * exactly the audit trail a silent revival would destroy.
 *
 * `archived` is the legacy synonym for superseded (migration 096) and is
 * accepted as a source state so pre-3.1F rows can still move forward.
 */
export const ALLOWED_TRANSITIONS: Record<MemoryState, MemoryState[]> = {
  draft:      ['active', 'retracted'],
  active:     ['challenged', 'stale', 'superseded', 'retracted'],
  challenged: ['active', 'superseded', 'retracted'],
  stale:      ['active', 'superseded', 'retracted'],
  archived:   ['superseded', 'retracted'],
  superseded: [],
  retracted:  [],
};

export class InvalidTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = 'INVALID_MEMORY_TRANSITION';
  constructor(from: MemoryState, to: MemoryState) {
    super(`Memory cannot move ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: MemoryState, to: MemoryState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: MemoryState, to: MemoryState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** States eligible for everyday retrieval. */
export const RETRIEVABLE_STATES: MemoryState[] = ['active'];
/** Additionally eligible when a caller explicitly wants contested belief. */
export const CHALLENGED_STATES: MemoryState[] = ['active', 'challenged'];
/** Everything, for historical explanation. Nothing is ever erased from history. */
export const HISTORICAL_STATES: MemoryState[] = [...MEMORY_STATES];

// ── Source precedence (ADR-066 rule 28) ──────────────────────────────────────

export const SOURCE_PRECEDENCE_ORDER = [
  'founder_confirmed',
  'observed_first_party',
  'verified_external',
  'derived_inference',
  'anonymized_playbook',
] as const;
export type PrecedenceTier = typeof SOURCE_PRECEDENCE_ORDER[number];

/**
 * AUTHORITY IS THE CANONICAL AXIS. Precedence is DERIVED from the authority tier,
 * never rediscovered from the source string.
 *
 * THE DEFECT THIS REPLACES: this function carried a SECOND, independent
 * source→authority mapping alongside `bootstrapTierFromSource`. The two
 * disagreed on existing sources (`intake` → verified_external here vs
 * FOUNDER_CONFIRMED there; `review` → verified_external vs OBSERVED_FIRST_PARTY),
 * and neither knew the migration-107 sources, so `founder_bootstrap` scored as
 * the weakest tier and SUPERSEDE became unreachable.
 *
 * SOURCE answers "where did this come from". AUTHORITY_TIER answers "how much
 * authority does it carry". PRECEDENCE ranks authority. A source name must never
 * independently establish precedence.
 */
const TIER_TO_PRECEDENCE: Record<AuthorityTier, PrecedenceTier> = {
  FOUNDER_ASSERTED:      'founder_confirmed',
  FOUNDER_CONFIRMED:     'founder_confirmed',
  EXPERIMENT_CONTROLLED: 'observed_first_party',
  OBSERVED_FIRST_PARTY:  'observed_first_party',
  VERIFIED_EXTERNAL:     'verified_external',
  DERIVED_INFERENCE:     'derived_inference',
  ANONYMIZED_PLAYBOOK:   'anonymized_playbook',
};

/**
 * Precedence for a LEGACY row that carries only a source string.
 *
 * Governed rows carry `authority_tier` and must be compared through
 * `authorityPolicy.mayAutoOverride` on tiers directly; this path exists for rows
 * predating that column. One mapping, reached through one function.
 */
export function precedenceTier(source: string): PrecedenceTier {
  // The eight pre-3.2A sources keep their certified precedence verbatim.
  //
  // A full unification (deriving ALL of these from bootstrapTierFromSource) was
  // implemented and measured first: it moved `review` verified_external ->
  // observed_first_party and `intake` verified_external -> founder_confirmed,
  // which additionally changed DECAY classification and broke two lifecycle
  // tests. That blast radius is real and belongs in its own pass — it is not
  // part of closing this defect.
  switch (source) {
    case 'founder_feedback':      return 'founder_confirmed';
    case 'campaign_performance':
    case 'analytics':
    case 'experiment':            return 'observed_first_party';
    case 'review':
    case 'intake':                return 'verified_external';
    case 'ai_conversation':
    case 'growth_brain':          return 'derived_inference';
  }
  // EVERY OTHER SOURCE resolves through the authority path rather than falling
  // to a silent `derived_inference` default. That default is what made
  // `founder_bootstrap` the weakest tier and SUPERSEDE unreachable; a future
  // migration adding a source can no longer be silently downgraded here.
  return TIER_TO_PRECEDENCE[bootstrapTierFromSource(source)];
}

/** Lower index = stronger. */
export function precedenceRank(source: string): number {
  return SOURCE_PRECEDENCE_ORDER.indexOf(precedenceTier(source));
}

/**
 * Whether `challenger` may automatically override `incumbent`.
 *
 * The trust rule, stated as code: a weaker source may never silently replace a
 * stronger one. It may still CHALLENGE it — that is how LaunchMind changes its
 * mind without overwriting the owner.
 *
 * Note "higher precedence" does not mean permanently true (§4). A founder
 * assertion can be superseded — by the founder, or by an explicitly resolved
 * challenge. It just cannot be superseded *silently* by an inference.
 */
/**
 * GOVERNED pairwise decision, keyed on persisted AUTHORITY TIERS.
 *
 * Codex review: governed promotion previously required BOTH a source-derived
 * precedence (here) and a tier-derived override decision (authorityPolicy), so a
 * source string remained a load-bearing veto even when `authority_tier` was
 * populated. This entry point removes that: when both sides carry a governed
 * tier, precedence comes from the tier alone.
 */
export function decideWithAuthority(
  classification: ClaimClassification,
  incumbentTier: AuthorityTier,
  challengerTier: AuthorityTier,
): PolicyDecision {
  const stronger = authorityPrecedenceRank(challengerTier) < authorityPrecedenceRank(incumbentTier);
  const founderIncumbent = FOUNDER_TIER_SET.has(incumbentTier);
  const founderChallenger = FOUNDER_TIER_SET.has(challengerTier);

  if (classification === 'CONTRADICTION') {
    // Founder authority is never auto-overridden by a weaker challenger.
    if (founderIncumbent && !founderChallenger) {
      return { action: 'challenge', targetState: 'challenged', requiresFounderReview: true,
               reason: 'a non-founder challenger contradicts a founder-authored belief' };
    }
    if (stronger) {
      return { action: 'supersede', targetState: 'superseded', requiresFounderReview: false,
               reason: 'a strictly stronger authority contradicts the incumbent' };
    }
    return { action: 'challenge', targetState: 'challenged', requiresFounderReview: false,
             reason: 'equal or weaker authority contradicts; no precedence to resolve it' };
  }
  if (classification === 'REINFORCEMENT' || classification === 'DUPLICATE') {
    return { action: 'reinforce', targetState: null, requiresFounderReview: false,
             reason: 'agreeing evidence' };
  }
  return { action: 'none', targetState: null, requiresFounderReview: false, reason: 'unrelated' };
}

export const FOUNDER_TIER_SET = new Set<AuthorityTier>(['FOUNDER_ASSERTED', 'FOUNDER_CONFIRMED']);

/** LEGACY source-based override. Only for rows with no persisted authority_tier. */
export function mayAutoOverride(incumbentSource: string, challengerSource: string): boolean {
  return precedenceRank(challengerSource) < precedenceRank(incumbentSource);
}

/** Founder-confirmed memory always needs owner resolution (§17). */
export function requiresFounderReview(incumbentSource: string, challengerSource: string): boolean {
  return precedenceTier(incumbentSource) === 'founder_confirmed'
      && precedenceTier(challengerSource) !== 'founder_confirmed';
}

// ── Decay (§13) ──────────────────────────────────────────────────────────────

export const DECAY_CLASSES = [
  'NON_DECAYING', 'SLOW_DECAY', 'PERFORMANCE_DECAY', 'SOURCE_FRESHNESS_DRIVEN',
] as const;
export type DecayClass = typeof DECAY_CLASSES[number];

/**
 * Half-life in days. NON_DECAYING has none, deliberately.
 *
 * "Founder requires approval over $500" is a standing constraint; letting it
 * fade would quietly remove a guardrail the owner set. "Meta creative style X
 * performed well last month" genuinely does age.
 */
const DECAY_HALF_LIFE_DAYS: Record<DecayClass, number | null> = {
  NON_DECAYING:            null,
  SLOW_DECAY:              540,
  PERFORMANCE_DECAY:       90,
  SOURCE_FRESHNESS_DRIVEN: 180,
};

/** Derives the decay class. Same mapping migration 096 backfilled with. */
export function decayClassFor(source: string, memoryType: string): DecayClass {
  if (precedenceTier(source) === 'founder_confirmed') return 'NON_DECAYING';
  if (['campaign', 'creative', 'experiment'].includes(memoryType)) return 'PERFORMANCE_DECAY';
  if (['market', 'competitor', 'seasonality'].includes(memoryType)) return 'SOURCE_FRESHNESS_DRIVEN';
  return 'SLOW_DECAY';
}

/** @returns Multiplier in (0,1]. Exactly 1 for NON_DECAYING, at any age. */
export function decayFactor(decayClass: DecayClass, ageDays: number): number {
  const halfLife = DECAY_HALF_LIFE_DAYS[decayClass];
  if (halfLife === null) return 1;
  return Math.pow(0.5, Math.max(0, ageDays) / halfLife);
}

// ── Evidence independence (§14) ──────────────────────────────────────────────

export interface EvidenceRef {
  id: string;
  /** `${source_table}:${source_id}` — the same observation imported twice shares it. */
  independenceKey: string | null;
}

/**
 * Counts INDEPENDENT evidence.
 *
 * Two rows sharing an independence key are one observation recorded twice — a
 * re-imported GA4 event, a replayed webhook — and counting them as two
 * confirmations would let a retry inflate confidence without new information.
 * Rows with no key are counted individually but conservatively: absence of a key
 * is not proof of independence, so this is an approximation and is documented as
 * one rather than presented as exact.
 */
export function independentEvidenceCount(evidence: EvidenceRef[]): number {
  const keyed = new Set<string>();
  let unkeyed = 0;
  for (const e of evidence) {
    if (e.independenceKey) keyed.add(e.independenceKey);
    else unkeyed++;
  }
  return keyed.size + unkeyed;
}

// ── Confidence (§10, §11, §12) ───────────────────────────────────────────────

export const CONFIDENCE_POLICY_VERSION = 1;

/** Below this, a memory leaves everyday retrieval but is never deleted (§12). */
export const RETRIEVAL_CONFIDENCE_FLOOR = 0.25;

export interface ConfidenceInputs {
  source: string;
  memoryType: string;
  /** Independent evidence supporting the claim. */
  supportingEvidence: EvidenceRef[];
  /** Open, unresolved contradictions. */
  contradictionCount: number;
  reinforcementCount: number;
  /** Days since the memory was last reinforced or updated. */
  ageDays: number;
  /** True when a founder explicitly confirmed this statement. */
  founderConfirmed: boolean;
}

export interface ConfidenceResult {
  value: number;
  policyVersion: number;
  band: ConfidenceBand;
  /** Human-readable contributions, for the learning event and for explanation. */
  factors: string[];
}

export const CONFIDENCE_BANDS = ['LOW', 'MODERATE', 'STRONG', 'VERY_STRONG'] as const;
export type ConfidenceBand = typeof CONFIDENCE_BANDS[number];

/** Internal thresholds. Owner-facing labels are NOT decided here (§11). */
export function confidenceBand(value: number): ConfidenceBand {
  if (value < 0.35) return 'LOW';
  if (value < 0.60) return 'MODERATE';
  if (value < 0.82) return 'STRONG';
  return 'VERY_STRONG';
}

/**
 * Computes confidence deterministically.
 *
 * Shape, and why:
 *
 *   base            from source precedence — where the claim came from is the
 *                   single strongest signal available before any evidence
 *   evidence lift   SUBLINEAR (log). The second independent confirmation is
 *                   worth much more than the ninth; linear growth would let
 *                   volume masquerade as certainty
 *   reinforcement   small, capped — repetition is weaker than independence
 *   contradiction   sharp penalty. One credible contradiction should matter more
 *                   than one more confirmation, because it is the thing most
 *                   likely to be true and unwelcome
 *   decay           applied by class; NON_DECAYING is untouched
 *   founder floor   a founder-confirmed statement never falls below 0.60 through
 *                   age or inference alone. Only the founder, or a resolved
 *                   challenge, moves it — which is §5 expressed numerically
 *
 * @returns A value in [0,1] with the factors that produced it.
 */
export function computeConfidence(input: ConfidenceInputs): ConfidenceResult {
  const factors: string[] = [];

  const BASE: Record<PrecedenceTier, number> = {
    founder_confirmed:    0.75,
    observed_first_party: 0.60,
    verified_external:    0.50,
    derived_inference:    0.40,
    anonymized_playbook:  0.35,
  };
  const tier = precedenceTier(input.source);
  let value = BASE[tier];
  factors.push(`base ${value.toFixed(2)} (${tier})`);

  const independent = independentEvidenceCount(input.supportingEvidence);
  if (independent > 0) {
    // log2(1+n)/8 — 1 → +0.125, 3 → +0.25, 7 → +0.375. Diminishing by design.
    const lift = Math.log2(1 + independent) / 8;
    value += lift;
    factors.push(`+${lift.toFixed(3)} from ${independent} independent evidence`);
  }

  if (input.reinforcementCount > 0) {
    const lift = Math.min(0.10, input.reinforcementCount * 0.02);
    value += lift;
    factors.push(`+${lift.toFixed(3)} from ${input.reinforcementCount} reinforcement(s)`);
  }

  if (input.contradictionCount > 0) {
    const penalty = Math.min(0.40, input.contradictionCount * 0.20);
    value -= penalty;
    factors.push(`-${penalty.toFixed(3)} from ${input.contradictionCount} open contradiction(s)`);
  }

  const decayClass = decayClassFor(input.source, input.memoryType);
  const factor = decayFactor(decayClass, input.ageDays);
  if (factor < 1) {
    const before = value;
    value *= factor;
    factors.push(`×${factor.toFixed(3)} decay (${decayClass}, ${Math.round(input.ageDays)}d): ${before.toFixed(2)} → ${value.toFixed(2)}`);
  } else {
    factors.push(`no decay (${decayClass})`);
  }

  if (input.founderConfirmed && value < 0.60) {
    factors.push(`floor 0.60 applied (founder-confirmed cannot be eroded by inference)`);
    value = 0.60;
  }

  value = Math.max(0, Math.min(1, value));
  return { value: Number(value.toFixed(4)), policyVersion: CONFIDENCE_POLICY_VERSION, band: confidenceBand(value), factors };
}

/** @returns True when the memory is below the floor and should leave normal retrieval. */
export function belowRetrievalFloor(confidence: number): boolean {
  return confidence < RETRIEVAL_CONFIDENCE_FLOOR;
}

// ── Classification → decision (§8) ───────────────────────────────────────────

export type ClaimClassification = 'DUPLICATE' | 'REINFORCEMENT' | 'CONTRADICTION' | 'UNRELATED';

export interface PolicyDecision {
  action: 'reinforce' | 'challenge' | 'supersede' | 'none';
  targetState: MemoryState | null;
  requiresFounderReview: boolean;
  reason: string;
}

/**
 * Turns a CLASSIFICATION into a DECISION.
 *
 * This is the choke point ADR-066 invariant 3 describes. A model may produce the
 * classification; it can never produce the decision, because the decision is a
 * pure function of the classification plus source precedence, evaluated here.
 *
 * @param classification What the comparison concluded (possibly model-assisted).
 * @param incumbentSource The existing memory's source.
 * @param challengerSource The new claim's source.
 */
export function decide(
  classification: ClaimClassification,
  incumbentSource: string,
  challengerSource: string,
): PolicyDecision {
  switch (classification) {
    case 'UNRELATED':
      return { action: 'none', targetState: null, requiresFounderReview: false,
               reason: 'claims are unrelated' };

    case 'DUPLICATE':
      // Not a new fact. Reinforce rather than create a second copy of the same
      // belief, which would then double-count as independent support.
      return { action: 'reinforce', targetState: 'active', requiresFounderReview: false,
               reason: 'duplicate claim reinforces the existing memory' };

    case 'REINFORCEMENT':
      return { action: 'reinforce', targetState: 'active', requiresFounderReview: false,
               reason: 'compatible evidence supports the existing memory' };

    case 'CONTRADICTION': {
      if (requiresFounderReview(incumbentSource, challengerSource)) {
        // THE trust rule. Evidence may disagree with the founder; it may not
        // overrule them without the founder being asked.
        return {
          action: 'challenge', targetState: 'challenged', requiresFounderReview: true,
          reason: 'contradicts a founder-confirmed statement; requires founder resolution',
        };
      }
      if (mayAutoOverride(incumbentSource, challengerSource)) {
        return {
          action: 'supersede', targetState: 'superseded', requiresFounderReview: false,
          reason: `stronger source (${precedenceTier(challengerSource)}) supersedes ${precedenceTier(incumbentSource)}`,
        };
      }
      // Equal or weaker: record the conflict, change nothing.
      return {
        action: 'challenge', targetState: 'challenged', requiresFounderReview: false,
        reason: 'contradiction from an equal or weaker source; recorded, not applied',
      };
    }
  }
}
