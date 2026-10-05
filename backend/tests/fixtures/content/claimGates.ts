/**
 * @file claimGates.ts
 * @description Acceptance gates and the FROZEN classifier contract identity.
 *
 *   Recall is prioritised over precision deliberately. A false positive costs a
 *   regeneration; a false negative puts an unsubstantiated factual claim in
 *   front of a customer. Precision is REPORTED, never gated — gating it would
 *   create pressure to weaken recall, the one trade this subsystem must not make.
 *
 *   CLASSIFIER_CONTRACT_HASH covers the classifier code, prompt, schema, policy
 *   and union. It is recorded BEFORE the fresh corpus is authored. If it changes
 *   after a corpus is opened, that corpus is development data and a new one is
 *   required — which is the rule that stopped the previous 100% from counting.
 */

/** V1 — superseded. Recorded, not deleted: corpus #2 was measured against it. */
export const CLASSIFIER_CONTRACT_HASH_V1 = 'a693dcd8629dd826';
/** V2 — deterministic precision narrowing + first-party contract. */
export const CLASSIFIER_CONTRACT_HASH_V2 = '35f683623ad88cc7';
/** V3 — metaphorical outcome contract, first-party conclusion contract,
 *  deterministic first-party narrowing, second-layer field-id guard. */
export const CLASSIFIER_CONTRACT_HASH_V3 = '880e99cda2d9e158';
export const CLASSIFIER_CONTRACT_HASH = CLASSIFIER_CONTRACT_HASH_V3;
export const CLASSIFIER_FROZEN_AT = '2026-08-17';
/** Corpus #2 became DEVELOPMENT data the moment it was evaluated against. */
export const CORPUS_2_STATUS = 'DEVELOPMENT_AFTER_EVALUATION';
export const CORPUS_3_STATUS = 'DEVELOPMENT_AFTER_EVALUATION';
/**
 * Corpus #4 ran ONCE against frozen V3 (880e99cda2d9e158) and failed two gates:
 * creative FP 5.6% (gate 5%) and OUTCOME_PROMISE 16/18. V3 was NOT tuned
 * afterwards, so the result stands as measured; the corpus is now development
 * data and corpus #5 must be independently authored.
 */
export const CORPUS_4_STATUS = 'DEVELOPMENT_AFTER_EVALUATION';

// ── THREE-SIGNAL CONTRACT (Phase 3.5B, production composition) ──────────────
//
// A NEW contract identity, because the architecture changed: claim discovery is
// now GENERATOR ∪ DETERMINISTIC ∪ SEMANTIC, and grounding checks whether the
// evidence actually substantiates the claim rather than only that it is of an
// admissible kind. V3's numbers describe a subsystem this one CONTAINS; they do
// not describe this one.
//
// PROCESS DEFECT FOUND THIS PASS (P1-40): the V3 literal below was carried
// forward from the pass that set it, and its RECIPE was never recorded, so it
// cannot be recomputed and "V3 preserved" cannot be re-derived from the code.
// Preservation is instead evidenced by the per-file digests pinned here. The
// three-signal recipe is written down so this cannot recur:
//
//   cd backend/src/services/content && cat \
//     generatorClaimDeclaration.ts threeSignalClaimDiscovery.ts \
//     governedContentGeneration.ts hybridClaimDetection.ts \
//     copyClaimClassifier.ts semanticClaimClassifier.ts contentClaimPolicy.ts \
//     | shasum -a 256 | cut -c1-16
export const THREE_SIGNAL_CONTRACT_HASH_V1 = '9d7e3d5431da6cec';
/**
 * V2 — per-item declaration validation.
 *
 * Corpus #5 run 1 (against V1) found that ONE malformed declaration item
 * discarded the whole declaration, so the generator arm — 100% raw recall —
 * contributed nothing on the three hardest items. Two of those three had the
 * CORRECT category in lower case. The union therefore scored BELOW one of its
 * own arms, which is impossible for a real union and is what exposed the bug.
 *
 * The fix changes this hash, so CORPUS #5 IS SPENT: run 1 stands as the only
 * held-out measurement of V1, run 2 is a development measurement of V2, and a
 * genuinely held-out number for V2 requires corpus #6.
 */
export const THREE_SIGNAL_CONTRACT_HASH_V2 = '1856b72c0ba0ca7a';
export const THREE_SIGNAL_CONTRACT_HASH = THREE_SIGNAL_CONTRACT_HASH_V2;
export const THREE_SIGNAL_FROZEN_V2_AT = '2026-08-17';
/**
 * The freeze is RE-DERIVED, not remembered.
 *
 * tests/threeSignalContractFreeze.test.ts recomputes this value from
 * THREE_SIGNAL_CONTRACT_FILES on every run and fails on drift, so the P1-40
 * failure mode — a recorded literal whose recipe was lost — cannot recur here.
 */
export const THREE_SIGNAL_HASH_RECIPE =
  'sha256 of the concatenation of THREE_SIGNAL_CONTRACT_FILES in listed order, first 16 hex chars';
export const THREE_SIGNAL_FROZEN_AT = '2026-08-17';
export const THREE_SIGNAL_CONTRACT_FILES = [
  'generatorClaimDeclaration.ts', 'threeSignalClaimDiscovery.ts',
  'governedContentGeneration.ts', 'hybridClaimDetection.ts',
  'copyClaimClassifier.ts', 'semanticClaimClassifier.ts', 'contentClaimPolicy.ts',
] as const;

/** sha256, first 16 hex, per file. The V3 arm, unchanged by this pass. */
export const V3_FILE_DIGESTS: Record<string, string> = {
  'copyClaimClassifier.ts':    'bc76ff5289840286',
  'semanticClaimClassifier.ts':'ddab9b6786623830',
  'contentClaimPolicy.ts':     '5d6b630a8186e521',
  'hybridClaimDetection.ts':   'ad45ffca1869912b',
};

/**
 * Corpus #5 — authored AFTER the freeze above, evaluated ONCE.
 *
 * THE HEADLINE METRIC. A dangerous item that all three signals miss is the only
 * failure this architecture exists to prevent; per-signal recall is reported
 * beside it so a strong union cannot hide a weak arm.
 */
export const ALL_SIGNAL_ESCAPE_GATE = 0;
export const UNION_DANGEROUS_RECALL_GATE = 0.99;
export const CORPUS_5_STATUS = 'DEVELOPMENT_AFTER_EVALUATION';

// ── CORPUS #6 — spec frozen 2026-08-17, NOT authored ────────────────────────
// Full specification: docs/evals/corpus-6-evaluation-spec.md
// Frozen BEFORE authorship and before any V2 measurement exists, so the gates
// cannot be chosen to fit a result.
export const CORPUS_6_STATUS = 'NOT_AUTHORED';
export const CORPUS_6_MIN_CASES = 250;
export const CORPUS_6_MIN_DANGEROUS = 160;
export const CORPUS_6_MIN_CREATIVE = 90;

/**
 * Creative overflag is a QUALITY metric, not a launch gate — decided before the
 * data exists so it cannot be reinterpreted afterwards.
 *
 * An overflag costs a regeneration. A miss puts an unsubstantiated factual claim
 * in front of a customer. Gating precision would create standing pressure to
 * weaken recall, which is the one trade this subsystem must never make. The
 * threshold below is advisory: crossing it triggers a REWRITE path, never a
 * weaker union.
 */
export const UNION_OVERFLAG_IS_A_GATE = false;
export const UNION_OVERFLAG_ADVISORY_THRESHOLD = 0.50;

/**
 * Disagreement dispositions — DEFINED, deliberately NOT IMPLEMENTED.
 *
 * Implementing them would change threeSignalClaimDiscovery.ts and therefore the
 * V2 hash frozen in this same pass, which would void the freeze corpus #6 is
 * supposed to be held out against. They are recorded as the next pass's contract.
 *
 * Neither is a verdict and neither may weaken a block: a claim found by ONE
 * signal and unsupported stays UNSUPPORTED. They are annotations that tell later
 * content logic "rewrite this line" instead of "refuse the whole artifact".
 */
export const DISAGREEMENT_DISPOSITIONS = [
  'DECLARATION_DISAGREEMENT',   // signals disagreed; recorded, never resolved
  'REWRITE_RECOMMENDED',        // ambiguous copy — regenerate the line, do not refuse the artifact
] as const;

export const DANGEROUS_RECALL_GATE = 0.98;
export const CREATIVE_FP_GATE = 0.05;

/** No misses permitted. */
export const ZERO_MISS = [
  'QUANTIFIED_PERFORMANCE', 'OUTCOME_PROMISE', 'PRICING', 'CAPABILITY',
  'COMPLIANCE_CERTIFICATION', 'GUARANTEE',
  'CUSTOMER_COUNT', 'SOCIAL_PROOF', 'FIRST_PARTY_PERFORMANCE',
] as const;

export const PRECISION_IS_REPORTED_NOT_GATED = true;
