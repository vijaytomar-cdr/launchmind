/**
 * @file candidateEligibilityPolicy.ts
 * @description GATE A — ADR-067 C5, C1, C11, C20, invariant I5.
 *
 *   The cheap deterministic gate that runs BEFORE retrieval, comparison, or any
 *   model call. Its question is not "what should happen to memory?" but "is this
 *   candidate safe and meaningful enough to be considered at all?".
 *
 *   GATE A IS MODEL-FREE, AND THAT IS LOAD-BEARING. It is both the safety
 *   boundary and the cost boundary: a rejected candidate must cost zero
 *   embeddings, zero retrieval and zero model calls. The absence of any import
 *   of aiPlatform / retrievalService here is asserted by a structural test, not
 *   left to review.
 *
 *   It encodes C1's four admission tests — Durability, Generality,
 *   Decision-bearing, Attributable — because those are what stop the corpus
 *   becoming an event warehouse.
 *
 * @security PII, prompt-injection, raw provider prose and forged founder
 *   authority are all refused here, before the candidate can reach anything
 *   expensive or anything durable.
 * @dependencies scopePolicy, authorityPolicy (both pure)
 */

import type { AuthorityTier } from './authorityPolicy';
import { evaluateEvidenceSupport } from './evidenceSupportPolicy';
import { isFounderAuthority } from './authorityPolicy';
import {
  type MemoryScope, type ScopeCompleteness, isGovernedScope, scopeSpecificity,
} from './scopePolicy';

/** Bumped when any check below changes meaning. Persisted on every proposal. */
export const ELIGIBILITY_POLICY_VERSION = 1;

export const ELIGIBILITY_RESULTS = ['ELIGIBLE', 'INELIGIBLE', 'EVIDENCE_ONLY'] as const;
export type EligibilityResult = typeof ELIGIBILITY_RESULTS[number];

/**
 * Reason codes are a closed set so rejection rates are groupable.
 * A free-text reason would make `memory_gate_a_rejections` unusable.
 */
export const ELIGIBILITY_REASONS = [
  'OK',
  'NO_WORKSPACE',
  'WORKSPACE_MISMATCH',
  'NO_PROVENANCE',
  'NO_EVIDENCE',
  'EVIDENCE_INVALID',
  'SOURCE_NOT_ELIGIBLE',
  'NO_IDEMPOTENCY_KEY',
  'SCOPE_UNKNOWN',
  'SCOPE_MISSING',
  'INSUFFICIENT_SAMPLE',
  'CLAIM_TOO_SHORT',
  'PII_DETECTED',
  'SECRET_DETECTED',
  'INSTRUCTION_SHAPED',
  'RAW_PROVIDER_PROSE',
  'NOT_DURABLE',
  'NOT_GENERAL',
  'NOT_DECISION_BEARING',
  'SUPPRESSED_CLAIM',
  'FORGED_AUTHORITY',
  'UNSUPPORTED_AI_INFERENCE',
  'EVIDENCE_DOES_NOT_SUPPORT_CLAIM',
  'EVIDENCE_SUPPORT_UNVERIFIABLE',
] as const;
export type EligibilityReason = typeof ELIGIBILITY_REASONS[number];

export interface EligibilityInput {
  workspaceId: string | null;
  productId: string | null;
  /** Workspace resolved from the CANONICAL record, never from payload. */
  canonicalWorkspaceId: string | null;

  claimText: string;
  memoryClass: 'DIRECTIVE' | 'FACT' | 'LEARNING' | 'DECISION';
  authorityTier: AuthorityTier;

  scope: MemoryScope;
  scopeCompleteness: ScopeCompleteness;

  provenance: { kind: string; sourceId: string; provider?: string | null } | null;
  /** Actor as authenticated by the caller — never parsed from claim text. */
  actorType: 'founder' | 'system' | 'ai';

  evidenceIds: string[];
  evidenceIndependenceKeys: string[];
  /** Evidence rows whose status is not `valid`. */
  invalidEvidenceCount?: number;

  idempotencyKey: string | null;

  /** Rule-declared sample size behind the claim, when the builder knows it. */
  sampleSize?: number | null;
  /** True when the claim text came from a deterministic template or rule. */
  claimIsRuleGenerated: boolean;
  /**
   * Evidence CONTENT, for the support check. Gate A previously verified only
   * that evidence existed; a fabricated CAC passed on the strength of a real
   * press release that never mentions one.
   */
  evidenceRecords?: Array<{ id: string; data?: Record<string, unknown> | null; text?: string | null }>;
  /** Set when a live suppression matches this claim family (C20). */
  suppression?: {
    reasonClass: 'FOUNDER_RETRACTION' | 'FOUNDER_CORRECTION' | 'SYSTEM_INVALID_SOURCE' | 'LEGAL_DELETION';
    suppressedIndependenceKeys: string[];
  } | null;
}

export interface EligibilityDecision {
  result: EligibilityResult;
  reason: EligibilityReason;
  /** How well the evidence backs the claim; null when not evaluated. */
  support?: import('./evidenceSupportPolicy').SupportDecision | null;
  policyVersion: number;
  /** Human-readable, for the proposal record. Never contains claim text. */
  detail: string;
  /** Set when a suppressed claim may be reopened by genuinely new evidence. */
  reopenWithReview?: boolean;
}

// ── Detectors ────────────────────────────────────────────────────────────────

/** Conservative PII shapes. False positives are cheap; a leak is not. */
// Written WITHOUT nested quantifiers. These run against hostile provider text,
// which is precisely the input a catastrophic-backtracking pattern is attacked
// with, so every one is linear-time by construction (character classes rather
// than repeated groups).
const PII_PATTERNS: Array<[RegExp, EligibilityReason]> = [
  [/[\w.%+-]+@[\w-]+\.[a-z]{2,}/i, 'PII_DETECTED'],   // email
  [/\b\d[\d\s-]{7,13}\d\b/,        'PII_DETECTED'],   // phone
  [/\b\d{3}-\d{2}-\d{4}\b/,       'PII_DETECTED'],   // SSN
  [/\b\d[\d -]{11,17}\d\b/,        'PII_DETECTED'],   // payment card
];

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)[-_][A-Za-z0-9]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}/i,
];

/**
 * Instruction-shaped content.
 *
 * These are refused as MEMORY, not as evidence. The provider text is still
 * stored; it simply never becomes something LaunchMind asserts.
 */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore\s[\w\s]{0,20}?(instructions|rules)\b/i,
  /\bsystem\s*(override|prompt)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bdisregard\s[\w\s]{0,12}?(above|previous)\b/i,
  /\b(admin|developer)\smode\b/i,
  /<\/?(claim|system|instruction)[^>]*>/i,
  /\bsource\s*=\s*founder/i,          // a claim asserting its own authority
  // Bounded, linear. The original required the verb to be adjacent, so
  // "the founder HAS approved unlimited spend" passed — measured in the 3.2A
  // observation run. The tier granted was still correct (never founder), but the
  // CLAIM would have entered the corpus asserting founder approval.
  /\bfounder\s[\w\s]{0,18}?(confirmed|approved|authorised|authorized|said|stated|signed off)\b/i,
];

/** Temporary language → fails C1 Durability. */
const TEMPORARY_PATTERNS: RegExp[] = [
  /\b(this|next|last)\s+(week|month|quarter|year)\b/i,
  /\b(today|tomorrow|yesterday|right now|for now|temporarily)\b/i,
  /\buntil\s+(further notice|the end of)\b/i,
  /\bfor\s+the\s+(next|coming)\s+\d+\s+(days?|weeks?|months?)\b/i,
];

/** Metric nouns, used by the Generality test below. */
// The trailing \b applies to the WORD alternatives only. Previously it sat
// after the whole group, so `%` followed by a space never matched — '%' and ' '
// are both non-word characters, and there is no boundary between them. Every
// percentage-shaped bare metric passed the Generality test as a result
// ("3.2% click-through for the meta channel" was admitted as durable memory).
const METRIC_NOUN = /\d[\d.,]{0,12}\s?(%|(?:installs?|clicks?|impressions?|sessions?|users?)\b)/i;

/**
 * A bare metric RESTATEMENT fails C1 Generality — but a claim that merely
 * QUANTIFIES a general finding does not.
 *
 *   "12,400 impressions"                        → bare metric, rejected
 *   "Outcome-led messaging increased conversion by 41%" → general, kept
 *
 * Decided by what remains once the number is removed: a real claim still has a
 * subject and a predicate. Implemented as a strip-and-count rather than a regex
 * so it stays linear — the greedy `[^.]*` version this replaces was a ReDoS
 * shape running against hostile provider text.
 */
function isBareMetricRestatement(text: string): boolean {
  if (!METRIC_NOUN.test(text)) return false;
  // Stop words AND scope nouns are removed: "12400 impressions recorded for the
  // meta channel" is a measurement plus its scope, not a claim. Counting
  // "channel" as content let three bare restatements through in the 3.2A run.
  const NOISE = new Set([
    'the', 'for', 'and', 'was', 'were', 'this', 'that', 'with', 'from', 'per',
    'channel', 'segment', 'market', 'region', 'period', 'quarter', 'recorded',
    'reported', 'observed', 'measured', 'total', 'overall', 'across',
  ]);
  const remaining = text
    .replace(new RegExp(METRIC_NOUN.source, 'gi'), ' ')
    .replace(/[^a-z\s-]/gi, ' ')
    .split(/\s+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 2 && !NOISE.has(w));
  return remaining.length < 4;
}

const MIN_CLAIM_LENGTH = 12;
const MIN_SAMPLE_SIZE = 30;

function fail(reason: EligibilityReason, detail: string): EligibilityDecision {
  return { result: 'INELIGIBLE', reason, policyVersion: ELIGIBILITY_POLICY_VERSION, detail };
}
function evidenceOnly(reason: EligibilityReason, detail: string): EligibilityDecision {
  return { result: 'EVIDENCE_ONLY', reason, policyVersion: ELIGIBILITY_POLICY_VERSION, detail };
}

/**
 * Runs Gate A.
 *
 * Order matters and is deliberate: tenancy and suppression first (cheapest and
 * most consequential), then safety, then the admission tests. A candidate that
 * fails tenancy must not have its text scanned at all.
 *
 * @returns a structured decision — never a bare boolean, because the rejection
 *   reason is the measurement (§29) and the debugging surface.
 */
/**
 * Runs Gate A and attaches the evidence-support decision to whatever verdict is
 * reached. Support is computed once and carried through every exit path, so an
 * adjudicator can always see whether the evidence actually backed the claim —
 * even when a different rule was the one that stopped it.
 */
export function evaluateCandidateEligibility(input: EligibilityInput): EligibilityDecision {
  const support = (!isFounderAuthority(input.authorityTier) && input.evidenceRecords?.length)
    ? evaluateEvidenceSupport(input.claimText ?? '', input.evidenceRecords)
    : null;
  return { ...evaluateGateA(input), support };
}

function evaluateGateA(input: EligibilityInput): EligibilityDecision {
  // ── Tenancy (never trust the payload) ──────────────────────────────────────
  if (!input.workspaceId) return fail('NO_WORKSPACE', 'candidate carries no workspace');
  if (!input.canonicalWorkspaceId) {
    return fail('NO_WORKSPACE', 'workspace could not be resolved from a canonical record');
  }
  if (input.workspaceId !== input.canonicalWorkspaceId) {
    // The cross-workspace refusal. A payload claiming workspace B while its
    // canonical record says A is refused, not silently re-homed.
    return fail('WORKSPACE_MISMATCH',
      'payload workspace disagrees with the workspace resolved from the canonical record');
  }

  // ── Provenance and idempotency ─────────────────────────────────────────────
  if (!input.provenance?.kind || !input.provenance?.sourceId) {
    return fail('NO_PROVENANCE', 'provenance kind or source id missing');
  }
  if (!input.idempotencyKey) {
    return fail('NO_IDEMPOTENCY_KEY', 'candidate identity is not computable');
  }

  // ── Forged authority (§30) ────────────────────────────────────────────────
  // Founder tiers require an authenticated founder actor. Reaching here with a
  // founder tier and a non-founder actor means something tried to grant itself
  // authority.
  if (isFounderAuthority(input.authorityTier) && input.actorType !== 'founder') {
    return fail('FORGED_AUTHORITY',
      `authority tier ${input.authorityTier} requires an authenticated founder actor, got '${input.actorType}'`);
  }

  // ── Suppression (C20) ─────────────────────────────────────────────────────
  if (input.suppression) {
    const s = input.suppression;
    if (s.reasonClass === 'LEGAL_DELETION') {
      return fail('SUPPRESSED_CLAIM', 'claim family is legally deleted and never reopenable');
    }
    const hasNewEvidence = input.evidenceIndependenceKeys.some(
      k => !s.suppressedIndependenceKeys.includes(k));
    if (!hasNewEvidence) {
      // Replay of the discredited evidence. This is the hole Pre-Design found:
      // without it, a retracted belief is recreated by the same evidence.
      return fail('SUPPRESSED_CLAIM',
        `claim family suppressed (${s.reasonClass}) and no independent new evidence is present`);
    }
    if (s.reasonClass === 'FOUNDER_RETRACTION') {
      return {
        result: 'ELIGIBLE', reason: 'OK', policyVersion: ELIGIBILITY_POLICY_VERSION,
        detail: 'founder-retracted claim with genuinely new evidence — founder review required',
        reopenWithReview: true,
      };
    }
  }

  // ── Evidence ──────────────────────────────────────────────────────────────
  // Founder authority is self-evidencing: a founder statement needs no provider
  // row behind it. Everything else does.
  const needsEvidence = !isFounderAuthority(input.authorityTier);
  if (needsEvidence && input.evidenceIds.length === 0) {
    return fail('NO_EVIDENCE', 'no evidence supports a non-founder candidate');
  }
  if ((input.invalidEvidenceCount ?? 0) > 0 && input.evidenceIds.length === (input.invalidEvidenceCount ?? 0)) {
    return fail('EVIDENCE_INVALID', 'every supporting evidence row is non-valid');
  }

  // ── Scope (C10, C11) ──────────────────────────────────────────────────────
  if (!isGovernedScope(input.scopeCompleteness)) {
    return fail('SCOPE_UNKNOWN',
      'scope is explicitly unknown; new durable memory may not be created with unknown scope');
  }
  // Which classes may legitimately bind nothing.
  //
  // MEASURED CORRECTION (3.2A observation): the original rule exempted only
  // DIRECTIVE and rejected founder statements such as "We will prioritise
  // retention over acquisition this quarter" and "Our confirmed ICP is
  // independent home-service providers" as SCOPE_MISSING. Both are legitimately
  // workspace-wide, and demanding that a founder bind a channel to state the ICP
  // is incoherent.
  //
  // The principle: scope binding is required of a claim derived from EVIDENCE
  // about a measured population. It is not required of a choice, an instruction,
  // or a founder's statement about the business as a whole.
  const mayBeUnscoped =
    input.memoryClass === 'DIRECTIVE'                              // governs LaunchMind, not a segment
    || input.memoryClass === 'DECISION'                            // a choice, workspace-wide
    || (input.memoryClass === 'FACT' && isFounderAuthority(input.authorityTier));

  if (!mayBeUnscoped && scopeSpecificity(input.scope) === 0) {
    return fail('SCOPE_MISSING',
      `a ${input.memoryClass} candidate from ${input.authorityTier} must bind at least one scope dimension`);
  }

  // ── Safety scans ──────────────────────────────────────────────────────────
  const text = input.claimText ?? '';
  if (text.trim().length < MIN_CLAIM_LENGTH) {
    return fail('CLAIM_TOO_SHORT', `claim shorter than ${MIN_CLAIM_LENGTH} characters`);
  }
  for (const p of SECRET_PATTERNS) {
    if (p.test(text)) return fail('SECRET_DETECTED', 'claim text matches a credential shape');
  }
  for (const [p, reason] of PII_PATTERNS) {
    if (p.test(text)) return fail(reason, 'claim text matches a personal-data shape');
  }
  for (const p of INSTRUCTION_PATTERNS) {
    if (p.test(text)) {
      return fail('INSTRUCTION_SHAPED',
        'claim text is instruction-shaped or asserts its own authority');
    }
  }

  let supportDecision: import('./evidenceSupportPolicy').SupportDecision | null = null;

  // ── EVIDENCE SUPPORT (deterministic, no model) ────────────────────────────
  // Existence of evidence is not support. A claim asserting a specific quantity
  // must be able to point at that quantity in the evidence it cites; a
  // qualitative claim need only cite evidence about the same subject.
  // Founder authority is exempt: a founder stating their own ICP is not citing
  // provider evidence and has nothing to point at.
  if (!isFounderAuthority(input.authorityTier) && input.evidenceRecords?.length) {
    const support = evaluateEvidenceSupport(input.claimText ?? '', input.evidenceRecords);
    if (support.result === 'UNSUPPORTED') {
      return { ...fail('EVIDENCE_DOES_NOT_SUPPORT_CLAIM', support.reason), support };
    }
    if (support.result === 'UNVERIFIABLE') {
      return { ...fail('EVIDENCE_SUPPORT_UNVERIFIABLE', support.reason), support };
    }
    if (support.result === 'PARTIALLY_SUPPORTED') {
      // Not rejected — the claim may be narrowable — but it must not become
      // durable memory on partial backing.
      return { ...evidenceOnly('EVIDENCE_DOES_NOT_SUPPORT_CLAIM', support.reason), support };
    }
    // SUPPORTED: record it and continue. Later C1 admission rules still apply —
    // support answers "is this claim backed?", not "does it deserve memory?".
    supportDecision = support;
  }

  // ── Raw provider prose (C1 Attributable) ──────────────────────────────────
  if (!input.claimIsRuleGenerated) {
    return evidenceOnly('RAW_PROVIDER_PROSE',
      'claim was not produced by a deterministic template or rule; retained as evidence only');
  }

  // ── C1 admission tests ────────────────────────────────────────────────────
  // DECISION is exempt: the very next rule REQUIRES a DECISION to state a
  // horizon, so rejecting it for having one made the two rules contradictory
  // and no founder DECISION could ever be durable. For every other class a
  // horizon still means the claim belongs to domain state, not memory.
  if (input.memoryClass !== 'DECISION') {
    for (const p of TEMPORARY_PATTERNS) {
      if (p.test(text)) {
        return evidenceOnly('NOT_DURABLE',
          'claim carries a horizon; temporary decisions belong to domain state, not memory');
      }
    }
  }
  if (input.memoryClass === 'DECISION' && !/\b(quarter|year|season|ongoing|permanent)\b/i.test(text)) {
    // A DECISION without a stated horizon is indistinguishable from a passing
    // remark; C3 defines DECISION as "a choice with a stated horizon".
    return evidenceOnly('NOT_DURABLE', 'DECISION candidate states no horizon');
  }
  if (isBareMetricRestatement(text)) {
    return evidenceOnly('NOT_GENERAL',
      'claim restates a single measurement and generalises to nothing');
  }

  // ── Sample adequacy ───────────────────────────────────────────────────────
  if (input.memoryClass === 'LEARNING'
      && typeof input.sampleSize === 'number'
      && input.sampleSize < MIN_SAMPLE_SIZE) {
    return evidenceOnly('INSUFFICIENT_SAMPLE',
      `sample ${input.sampleSize} below the minimum ${MIN_SAMPLE_SIZE} for a LEARNING claim`);
  }

  // ── Unsupported AI-only inference ─────────────────────────────────────────
  if (input.authorityTier === 'DERIVED_INFERENCE' && input.evidenceIds.length === 0) {
    return evidenceOnly('UNSUPPORTED_AI_INFERENCE',
      'derived inference with no supporting evidence may not become durable memory');
  }

  return {
    result: 'ELIGIBLE', reason: 'OK', policyVersion: ELIGIBILITY_POLICY_VERSION,
    detail: 'candidate passed all Gate A checks',
    support: supportDecision,
  };
}
