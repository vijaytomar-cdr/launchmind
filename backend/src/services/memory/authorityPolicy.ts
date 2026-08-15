/**
 * @file authorityPolicy.ts
 * @description Persisted, versioned authority — ADR-067 C4, invariant I4.
 *
 *   Pre-Design found authority was derived at read time by `precedenceTier()`,
 *   a hard-coded switch over `source`. Nothing persisted the tier, so editing
 *   that switch would silently reinterpret every historical decision. This
 *   module makes authority an explicit value computed ONCE, at decision time,
 *   and stamped with the policy version that produced it.
 *
 *   THE RULE THIS ENCODES:
 *
 *     current policy computes authority for a NEW candidate.
 *     historical authority is READ from what was persisted.
 *
 *   `precedenceTier()` in beliefPolicy is retained only as the bootstrap
 *   mapping for rows that predate the column. It is never consulted to explain
 *   a decision that recorded its own tier.
 *
 *   AUTHORITY CANNOT BE CLAIMED, ONLY GRANTED. Tier is derived from
 *   authenticated provenance — who the pipeline knows produced the evidence —
 *   never from the text of the claim. A provider insight that says "the founder
 *   confirmed X" is provider text, and resolves to a provider tier.
 *
 * @security The forge-resistance property is the point: see `authorityForCandidate`.
 * @dependencies none (pure)
 */

/** Strongest first. Index is the rank; lower rank wins. */
export const AUTHORITY_TIERS = [
  'FOUNDER_ASSERTED',       // the founder stated it unprompted
  'FOUNDER_CONFIRMED',      // the founder approved a LaunchMind proposal
  'EXPERIMENT_CONTROLLED',  // a designed test with a control (new in C4)
  'OBSERVED_FIRST_PARTY',   // measured outcome from a connected provider
  'VERIFIED_EXTERNAL',      // an official primary public source (migration 107)
  'DERIVED_INFERENCE',      // model- or rule-derived, no direct outcome evidence
  'ANONYMIZED_PLAYBOOK',    // cross-founder generalisation
] as const;
export type AuthorityTier = typeof AUTHORITY_TIERS[number];

/**
 * Bumped whenever the provenance→tier mapping or the override rules change.
 *
 * Persisted on every proposal and every authoritative transition. A decision
 * made under v1 must still report v1 after this becomes v2.
 */
export const AUTHORITY_POLICY_VERSION = 1;

/** Tiers a founder must be involved in. Never assignable from automated input. */
const FOUNDER_TIERS: readonly AuthorityTier[] = ['FOUNDER_ASSERTED', 'FOUNDER_CONFIRMED'];

/**
 * How the candidate reached LaunchMind. This is the ONLY input to authority.
 *
 * `actorType` comes from the authenticated request context or the worker's own
 * identity — never from payload text.
 */
export interface ProvenanceContext {
  /** Who caused this candidate to exist. */
  actorType: 'founder' | 'system' | 'ai';
  /** Machine origin: 'onboarding' | 'connection_insight' | 'campaign_result' | … */
  kind: string;
  /** True only when the founder explicitly approved a specific proposal. */
  founderConfirmed?: boolean;
  /** True only for a controlled experiment with a declared control arm. */
  controlledExperiment?: boolean;
  /** Legacy stored `source`, used only when nothing better is known. */
  legacySource?: string;
}

export function authorityRank(tier: AuthorityTier): number {
  const i = AUTHORITY_TIERS.indexOf(tier);
  return i === -1 ? AUTHORITY_TIERS.length : i;
}

/**
 * Computes the authority tier for a NEW candidate.
 *
 * Deliberately ignores claim text. A candidate whose text asserts founder
 * authority is compared as data; the tier it receives depends on the
 * authenticated actor that produced it. This is what makes §30's forged-founder
 * test pass structurally rather than by pattern-matching hostile strings.
 *
 * @returns the tier, and the reason it was granted (persisted for audit).
 */
export function authorityForCandidate(
  p: ProvenanceContext,
): { tier: AuthorityTier; policyVersion: number; reason: string } {
  const v = AUTHORITY_POLICY_VERSION;

  // Founder tiers require an authenticated founder actor. `kind` alone is not
  // enough: a worker replaying an onboarding payload is still `system`.
  if (p.actorType === 'founder') {
    if (p.founderConfirmed) {
      return { tier: 'FOUNDER_CONFIRMED', policyVersion: v,
               reason: 'authenticated founder approved a specific proposal' };
    }
    return { tier: 'FOUNDER_ASSERTED', policyVersion: v,
             reason: 'authenticated founder stated this directly' };
  }

  if (p.controlledExperiment && p.kind === 'experiment_result') {
    return { tier: 'EXPERIMENT_CONTROLLED', policyVersion: v,
             reason: 'designed experiment with a declared control arm' };
  }

  switch (p.kind) {
    // ── PUBLIC SOURCES (migration 107) ────────────────────────────────────
    // VERIFIED_EXTERNAL means: LaunchMind holds a high-quality external source
    // showing this was publicly STATED or observed. It does NOT mean the founder
    // confirmed it, that private performance was measured, or that it is true
    // forever — scope and valid-time still govern that.
    //
    // Reachable only with a non-founder actor: the founder branch above returns
    // first, so a public source can never be laundered into founder authority.
    case 'public_source_official':
      return { tier: 'VERIFIED_EXTERNAL', policyVersion: v,
               reason: 'official primary public source (company or first-party publication)' };
    case 'public_source_reputable':
      return { tier: 'DERIVED_INFERENCE', policyVersion: v,
               reason: 'reputable secondary public reporting; not a first-party statement' };
    case 'connection_insight':
    case 'campaign_result':
    case 'analytics_synced':
      return { tier: 'OBSERVED_FIRST_PARTY', policyVersion: v,
               reason: 'measured outcome from a connected first-party provider' };
    case 'experiment_result':
      // An experiment without a declared control is an observation, not a test.
      return { tier: 'OBSERVED_FIRST_PARTY', policyVersion: v,
               reason: 'experiment result without a declared control arm' };
    case 'playbook':
      return { tier: 'ANONYMIZED_PLAYBOOK', policyVersion: v,
               reason: 'anonymized cross-founder signal' };
    default:
      // Unknown provenance gets the WEAKEST usable tier, never a default that
      // happens to be convenient.
      return { tier: 'DERIVED_INFERENCE', policyVersion: v,
               reason: `no first-party outcome evidence for provenance kind '${p.kind}'` };
  }
}

/**
 * Precedence rank over AUTHORITY TIERS. Lower wins.
 *
 * THE CANONICAL PRECEDENCE INPUT for governed rows. `beliefPolicy.precedenceTier`
 * is a LEGACY fallback for rows that predate `authority_tier` and must never be
 * consulted when a governed tier is present — that duplication is what let a
 * source string veto a governed authority decision.
 */
export function authorityPrecedenceRank(tier: AuthorityTier): number {
  const i = AUTHORITY_TIERS.indexOf(tier);
  return i === -1 ? AUTHORITY_TIERS.length : i;
}

/**
 * Retrieval weighting derived from AUTHORITY, not from a source name.
 *
 * Mirrors the intent of retrievalService's legacy SOURCE_PRECEDENCE table, whose
 * unknown-source default of 1.0 silently under-weighted governed VERIFIED_EXTERNAL
 * and FOUNDER_ASSERTED rows.
 */
/**
 * BOUNDED BY RRF GEOMETRY — the spread is derived, not chosen.
 *
 * MEASURED DEFECT: these were 1.60 … 0.85, a 1.78x spread applied as an
 * unrestricted multiplier on RRF scores. RRF (K=60) is heavily compressed:
 *   rank 1  -> 1/61 = 0.01639
 *   rank 5  -> 1/65 = 0.01538   ratio 1.066
 *   rank 25 -> 1/85 = 0.01176   ratio 1.393
 * A 1.78x authority factor therefore dwarfs even a 25-rank relevance gap. It was
 * measured doing exactly that: a near-exact lexical match (DERIVED, 0.90) landed
 * at rank 5 while a two-token match (FOUNDER, 1.60) took rank 1.
 *
 * THE CONTRACT: relevance controls NOMINATION; authority controls PRECEDENCE
 * AMONG SIMILARLY RELEVANT memories. The spread is capped just above the RRF
 * ratio across ~3 ranks — (60+4)/(60+1) = 1.049 — so authority can reorder a
 * near-tie but cannot substitute for relevance.
 *
 * Ordering is unchanged; only the magnitude is bounded. Promotion precedence is
 * UNAFFECTED and still uses the full canonical hierarchy (authorityPrecedenceRank).
 */
/**
 * BOUNDED NEAR-TIE AUTHORITY — spread derived from RRF geometry, not chosen.
 *
 * Stage 1 (retrievalService) selects MEMBERSHIP by relevance. This table only
 * ORDERS within that set, and its spread is deliberately narrow enough that it
 * cannot reverse a large relevance gap:
 *
 *   RRF K=60 score ratios     rank 1 vs 3  = 63/61 = 1.033
 *                             rank 1 vs 6  = 66/61 = 1.082
 *                             rank 1 vs 25 = 85/61 = 1.393
 *
 * The historical 1.60/0.85 = 1.88x spread exceeded the ratio across the entire
 * candidate range, and was measured demoting a fused-rank-1 memory to final
 * rank 6 behind a fused-rank-6 one.
 *
 * The spread is chosen as the WIDEST value that still satisfies the
 * large-relevance-gap case, preserving maximum useful authority signal.
 * Overridable ONLY for the evaluation sweep; production uses the default.
 */
// SWEEP RESULT (frozen 8-case matrix, real retrieveMemories, real Postgres):
//   1.02 -> 8/8 pass. Case 1 margin decisive: fused 1 -> final 1 vs weak final 6.
//   1.05 -> Case 7 source invariance fails.
//   1.08 -> Case 7 fails; Case 1 passes by ONE rank (3 vs 4).
//   1.12 -> Case 1 FAILS (relevant 4, weak 3) — the original defect returns.
//
// The brief asks for the WIDEST spread still satisfying the large-relevance-gap
// case, which is nominally 1.08. 1.02 is selected instead: it is the only value
// that also preserves governed SOURCE INVARIANCE, and it satisfies the P0
// large-gap case by five ranks rather than one. Buying a wider authority signal
// with a one-rank margin on a P0 safety case, while breaking a separate frozen
// contract property, is the wrong trade before launch.
const AUTHORITY_SPREAD = Number(process.env.LM_EVAL_AUTHORITY_SPREAD ?? '1.02');

/** Tier steps, strongest first. Ordering is fixed; only magnitude is bounded. */
const TIER_STEPS: Array<[AuthorityTier, number]> = [
  ['FOUNDER_ASSERTED', 3], ['FOUNDER_CONFIRMED', 3], ['EXPERIMENT_CONTROLLED', 2],
  ['OBSERVED_FIRST_PARTY', 2], ['VERIFIED_EXTERNAL', 1],
  ['DERIVED_INFERENCE', 0], ['ANONYMIZED_PLAYBOOK', -1],
];

export const AUTHORITY_RETRIEVAL_WEIGHT: Record<AuthorityTier, number> =
  Object.fromEntries(TIER_STEPS.map(([tier, step]) => [
    tier, Math.pow(AUTHORITY_SPREAD, step / 3),
  ])) as Record<AuthorityTier, number>;

/** True when the tier could only have been granted with a founder in the loop. */
export function isFounderAuthority(tier: AuthorityTier): boolean {
  return FOUNDER_TIERS.includes(tier);
}

/**
 * May `challenger` silently override `incumbent`?
 *
 * Strictly stronger authority only. Equal authority never auto-overrides —
 * two observations of equal standing disagreeing is exactly the case a human
 * should see.
 */
export function mayAutoOverride(incumbent: AuthorityTier, challenger: AuthorityTier): boolean {
  return authorityRank(challenger) < authorityRank(incumbent);
}

/**
 * Does a conflict need a founder? (ADR-066 §17, preserved.)
 *
 * Founder-authored memory challenged by anything non-founder always does.
 */
export function requiresFounderReview(incumbent: AuthorityTier, challenger: AuthorityTier): boolean {
  return isFounderAuthority(incumbent) && !isFounderAuthority(challenger);
}

/**
 * May this authority create an `active` memory without corroboration? (C6)
 *
 * Founder authority is the authority — demanding a second source to corroborate
 * a founder statement is incoherent. A controlled experiment already contains
 * its own control, so it is corroborated by construction. Everything else must
 * earn `active` with a second INDEPENDENT observation.
 */
export function qualifiesForImmediateActive(tier: AuthorityTier): boolean {
  return tier === 'FOUNDER_ASSERTED'
      || tier === 'FOUNDER_CONFIRMED'
      || tier === 'EXPERIMENT_CONTROLLED';
}

/**
 * Reads the authority of a HISTORICAL decision.
 *
 * Returns exactly what was persisted. Falls back to the bootstrap mapping only
 * for rows written before the column existed, and says so, so a caller can tell
 * a recorded tier from a reconstructed one.
 */
export function historicalAuthority(
  persistedTier: string | null | undefined,
  persistedVersion: number | null | undefined,
  legacySource?: string,
): { tier: AuthorityTier; policyVersion: number | null; reconstructed: boolean } {
  if (persistedTier && (AUTHORITY_TIERS as readonly string[]).includes(persistedTier)) {
    return {
      tier: persistedTier as AuthorityTier,
      policyVersion: persistedVersion ?? null,
      reconstructed: false,
    };
  }
  return {
    tier: bootstrapTierFromSource(legacySource),
    policyVersion: null,
    reconstructed: true,
  };
}

/**
 * Bootstrap mapping for pre-3.2A rows ONLY.
 *
 * Never used to explain a decision that recorded its own tier. Kept separate
 * from `authorityForCandidate` so the two cannot be confused at a call site.
 */
export function bootstrapTierFromSource(source?: string | null): AuthorityTier {
  switch (source) {
    // Migration 107 governed sources. Their absence here is what allowed
    // `founder_bootstrap` — a FOUNDER_ASSERTED path — to be scored as the
    // WEAKEST precedence, and made SUPERSEDE unreachable. See ADR-068 A1.1.
    case 'founder_bootstrap': return 'FOUNDER_ASSERTED';
    case 'public_official':   return 'VERIFIED_EXTERNAL';
    case 'public_reputable':  return 'DERIVED_INFERENCE';
    case 'founder_feedback': return 'FOUNDER_ASSERTED';
    case 'experiment':       return 'OBSERVED_FIRST_PARTY';
    case 'campaign_performance':
    case 'analytics':        return 'OBSERVED_FIRST_PARTY';
    case 'review':           return 'OBSERVED_FIRST_PARTY';
    case 'intake':           return 'FOUNDER_CONFIRMED';
    case 'growth_brain':
    case 'ai_conversation':  return 'DERIVED_INFERENCE';
    default:                 return 'DERIVED_INFERENCE';
  }
}
