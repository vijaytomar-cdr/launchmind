/**
 * @file applicabilityPolicy.ts
 * @description Does a GLOBAL external observation apply to THIS product?
 *
 *   Correct tenancy is not applicability. A record stored correctly, owned by
 *   the right workspace, about the right category, can still be the wrong
 *   evidence for this business — and the failure mode that matters is the
 *   optimistic one: an enterprise-SaaS figure reaching an SMB home-services
 *   product because both sentences contain "conversion rate".
 *
 *   THE RULE THAT MAKES IT SAFE: a dimension stated on exactly ONE side is
 *   INSUFFICIENT_CONTEXT, never a match. Phase 3.1 left the opposite behaviour
 *   open in `compareScope()` (a dimension only one side states is skipped);
 *   repeating it here would let an unscoped external claim inherit whatever
 *   scope the product happens to have.
 *
 *   Deterministic and pure: no embeddings, no similarity, no model.
 *
 * @security The verdict gates evidence-handle eligibility. Failing toward
 *   non-use is the whole design.
 * @dependencies contract (pure)
 */

import {
  deriveFreshness, freshnessReferenceDate, permitsEvidenceHandle,
  lifecyclePermitsUse, type FreshnessState, type LifecycleState,
} from './contract';

export const APPLICABILITY_STATES = [
  'APPLICABLE', 'NOT_APPLICABLE', 'INSUFFICIENT_CONTEXT',
] as const;
export type Applicability = typeof APPLICABILITY_STATES[number];

export const SUBJECT_RELATIONS = [
  'OWN_PRODUCT', 'CONFIRMED_COMPETITOR', 'CATEGORY_CONTEXT', 'UNRELATED',
] as const;
export type SubjectRelation = typeof SUBJECT_RELATIONS[number];

/** Dimensions compared. Deliberately a small, closed set. */
export const APPLICABILITY_DIMENSIONS = [
  'category', 'geography', 'audience_segment', 'channel',
] as const;
export type ApplicabilityDimension = typeof APPLICABILITY_DIMENSIONS[number];

type Dims = Partial<Record<ApplicabilityDimension, string | null | undefined>>;

export interface SourceSide {
  subjectKey: string;
  lifecycleState: LifecycleState;
  observedAt: string | null;
  publishedAt: string | null;
  dims: Dims;
}

export interface ProductSide {
  /** Subject keys the owner has CONFIRMED as competitors. Nothing else counts. */
  confirmedCompetitorSubjectKeys: readonly string[];
  /** Subject key of the owner's own listing, when known. */
  ownSubjectKey: string | null;
  dims: Dims;
}

export interface ResolutionVerdict {
  applicability: Applicability;
  reason: string;
  subjectRelation: SubjectRelation;
  freshnessAtResolution: FreshnessState;
  evidenceHandleEligible: boolean;
  ineligibleReason: string | null;
  dimensions: Record<string, { source: string | null; product: string | null; verdict: 'MATCH' | 'MISMATCH' | 'ONE_SIDED' | 'UNSTATED' }>;
}

/** usa|us|united states → us. Keeps market vocabularies comparable. */
export function normalizeGeography(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const map: Record<string, string> = {
    usa: 'us', 'united states': 'us', 'united-states': 'us', us: 'us',
    india: 'in', in: 'in', ind: 'in',
    uk: 'gb', 'united kingdom': 'gb', gb: 'gb',
  };
  return map[s] ?? s;
}

function normalize(dim: ApplicabilityDimension, v: string | null | undefined): string | null {
  if (dim === 'geography') return normalizeGeography(v);
  if (!v) return null;
  const s = v.trim().toLowerCase();
  return s === '' ? null : s;
}

/**
 * Decides applicability of one source record for one product.
 *
 * @param source  - the global observation
 * @param product - what this business is, and which entities it confirmed
 * @param now     - injected so freshness is exact in tests
 * @security INSUFFICIENT_CONTEXT is never treated as usable.
 */
export function resolveApplicability(
  source: SourceSide, product: ProductSide, now: Date = new Date(),
): ResolutionVerdict {
  const freshness = deriveFreshness(
    freshnessReferenceDate(source.observedAt, source.publishedAt), now);

  const relation: SubjectRelation =
      product.ownSubjectKey && source.subjectKey === product.ownSubjectKey ? 'OWN_PRODUCT'
    : product.confirmedCompetitorSubjectKeys.includes(source.subjectKey) ? 'CONFIRMED_COMPETITOR'
    : 'UNRELATED';

  const dimensions: ResolutionVerdict['dimensions'] = {};
  let mismatch: ApplicabilityDimension | null = null;
  let oneSided: ApplicabilityDimension | null = null;
  let matches = 0;

  for (const dim of APPLICABILITY_DIMENSIONS) {
    const s = normalize(dim, source.dims[dim]);
    const p = normalize(dim, product.dims[dim]);
    let verdict: 'MATCH' | 'MISMATCH' | 'ONE_SIDED' | 'UNSTATED';
    if (s && p) { verdict = s === p ? 'MATCH' : 'MISMATCH'; }
    else if (s || p) { verdict = 'ONE_SIDED'; }
    else { verdict = 'UNSTATED'; }

    dimensions[dim] = { source: s, product: p, verdict };
    if (verdict === 'MISMATCH' && !mismatch) mismatch = dim;
    if (verdict === 'ONE_SIDED' && !oneSided) oneSided = dim;
    if (verdict === 'MATCH') matches++;
  }

  const finish = (
    applicability: Applicability, reason: string,
  ): ResolutionVerdict => {
    // Eligibility is a SEPARATE, stricter gate. Applicable-but-stale evidence
    // still cannot back a handle, and the reason is recorded rather than
    // collapsed into the applicability verdict — those are different facts and
    // an owner-facing explanation needs both.
    let eligible = false;
    let ineligibleReason: string | null = null;
    if (applicability !== 'APPLICABLE') {
      ineligibleReason = applicability;
    } else if (!lifecyclePermitsUse(source.lifecycleState)) {
      ineligibleReason = `LIFECYCLE_${source.lifecycleState}`;
    } else if (!permitsEvidenceHandle(freshness)) {
      ineligibleReason = `FRESHNESS_${freshness}`;
    } else {
      eligible = true;
    }
    return {
      applicability, reason, subjectRelation: relation,
      freshnessAtResolution: freshness,
      evidenceHandleEligible: eligible, ineligibleReason, dimensions,
    };
  };

  // 1. Entity gate first. An observation about a company this owner never
  //    confirmed is not about their market — whatever its category says.
  if (relation === 'UNRELATED') {
    return finish('NOT_APPLICABLE',
      'This observation is about an entity that is neither your product nor a competitor you confirmed.');
  }

  // 2. A stated disagreement is decisive, and beats any number of matches.
  if (mismatch) {
    return finish('NOT_APPLICABLE',
      `Source and product disagree on ${mismatch} (${dimensions[mismatch].source} vs ${dimensions[mismatch].product}).`);
  }

  // 3. One-sided dimension: not enough to judge. Fails toward non-use.
  if (oneSided) {
    return finish('INSUFFICIENT_CONTEXT',
      `${oneSided} is stated on only one side, so applicability cannot be established.`);
  }

  // 4. Nothing compared at all is not agreement.
  if (matches === 0) {
    return finish('INSUFFICIENT_CONTEXT',
      'No applicability dimension was stated on both sides.');
  }

  return finish('APPLICABLE',
    `Entity is ${relation === 'OWN_PRODUCT' ? 'your own listing' : 'a competitor you confirmed'}; ` +
    `${matches} dimension(s) matched with no disagreement.`);
}
