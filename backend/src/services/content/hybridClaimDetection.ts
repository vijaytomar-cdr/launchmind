/**
 * @file hybridClaimDetection.ts
 * @description Deterministic ∪ semantic claim detection — the governed boundary.
 *
 *   NEITHER ARM MAY REMOVE A CLAIM THE OTHER FOUND. The deterministic detector
 *   is precise where it fires (COMPLIANCE and FIRST_PARTY measured 100% in this
 *   pass's audit) and blind elsewhere; the semantic arm generalises but is a
 *   model and can be wrong or unavailable. Union with strictest-policy-wins is
 *   the only combination where a weakness in one arm cannot open a hole.
 *
 *   A semantic result that says "creative" over a deterministic
 *   QUANTIFIED_PERFORMANCE hit changes nothing — that direction is not
 *   expressible in this code, and the mutation that tries it has a named
 *   killing test.
 *
 *   TWO PASSES, for different failure modes:
 *     FIELD-LEVEL     each owner-visible field separately, so a claim is
 *                     attributable to the headline that actually makes it.
 *     ARTIFACT-LEVEL  the normalized whole, because a capability claim can
 *                     emerge from a headline and a description that are each
 *                     innocuous alone ("Built for every channel" +
 *                     "Google, Meta, LinkedIn and more").
 *   The artifact pass only ADDS candidates. It is not a second judge.
 *
 * @security Detection only. Nothing here resolves evidence, assigns authority or
 *   approves anything — that separation is asserted by test.
 * @dependencies copyClaimClassifier, semanticClaimClassifier, contentClaimPolicy
 */

import { classifyCopyClaim, splitCopyUnits, type ClaimCategory } from './copyClaimClassifier';
import { classifySemanticBatch, type ClaimRequirement } from './semanticClaimClassifier';
import { dispositionFor, strictestDisposition, type ClaimDisposition } from './contentClaimPolicy';

export interface DetectedClaim {
  textSpan: string;
  category: ClaimCategory;
  /** Which arm found it. Both when they agree. */
  source: 'DETERMINISTIC' | 'SEMANTIC' | 'BOTH';
  /** Field it came from; 'ARTIFACT' for the cross-field pass. */
  field: string;
  disposition: ClaimDisposition;
}

export interface DetectionOutcome {
  containsClaim: boolean;
  claims: DetectedClaim[];
  /** Strictest policy across every claim found anywhere. */
  overallDisposition: ClaimDisposition;
  /** True when any semantic call failed — the whole artifact is then suspect. */
  degraded: boolean;
  degradedReasons: string[];
}

const REQ_TO_DISPOSITION: Record<ClaimRequirement, ClaimDisposition> = {
  EVIDENCE: 'REQUIRES_EVIDENCE',
  OWNER_CONFIRMATION: 'REQUIRES_OWNER_CONFIRMATION',
  PROHIBITED: 'PROHIBITED_IN_3_5',
};

/** One owner-visible field of a generated artifact. */
export interface ContentField { name: string; text: string }

export interface DetectOptions {
  competitorNames?: readonly string[];
  channel?: string;
  founderId?: string;
  productId?: string | null;
  /** Test seam ONLY. Production always uses the real batch classifier. */
  semantic?: typeof classifySemanticBatch;
}

/**
 * Runs both arms over every field, then over the whole artifact.
 *
 * @param fields owner-visible fields; classify each, never one concatenation
 * @returns the union, with the strictest policy that applies anywhere
 */
export async function detectClaims(
  fields: readonly ContentField[], opts: DetectOptions = {},
): Promise<DetectionOutcome> {
  const semantic = opts.semantic ?? classifySemanticBatch;
  const competitors = opts.competitorNames ?? [];
  const claims: DetectedClaim[] = [];
  const degradedReasons: string[] = [];

  const record = (
    field: string, textSpan: string, category: ClaimCategory,
    source: DetectedClaim['source'], disposition: ClaimDisposition,
  ) => {
    const existing = claims.find(c =>
      c.field === field && c.category === category && c.textSpan === textSpan);
    if (existing) {
      if (existing.source !== source) existing.source = 'BOTH';
      const stricter = strictestDisposition([existing.category, category]);
      if (stricter !== existing.disposition) existing.disposition = stricter;
      return;
    }
    claims.push({ field, textSpan, category, source, disposition });
  };

  // ── DETERMINISTIC, per field. Cheap, local, no provider. ──────────────────
  for (const field of fields) {
    if (!field.text?.trim()) continue;
    for (const unit of splitCopyUnits(field.text)) {
      const det = classifyCopyClaim(unit, competitors);
      if (!det.isFactualClaim) continue;
      for (const cat of det.categories) {
        record(field.name, unit, cat, 'DETERMINISTIC', dispositionFor(cat));
      }
    }
  }

  // ── SEMANTIC, ONE batched call for the whole artifact (P1-30). ────────────
  const batch = await semantic(
    fields.filter(f => f.text?.trim()).map(f => ({ fieldId: f.name, text: f.text })),
    { channel: opts.channel, founderId: opts.founderId, productId: opts.productId },
  );

  // The batch function filters unknown ids, but this layer must not TRUST that
  // — a defence that exists in only one place is a defence one refactor away
  // from being gone. Found by the safety suite, which stubbed the batch arm and
  // watched an invented field id become a recorded claim.
  const sentIds = new Set(fields.map(f => f.name));
  for (const [fieldId, list] of batch.byField) {
    if (!sentIds.has(fieldId)) continue;
    for (const c of list) {
      record(fieldId, c.textSpan || fieldId, c.category, 'SEMANTIC',
        REQ_TO_DISPOSITION[c.requirement]);
    }
  }
  // Cross-field claims only ADD; they never remove a field-level finding.
  for (const c of batch.artifactClaims) {
    if (claims.some(k => k.category === c.category)) continue;
    record('ARTIFACT', c.textSpan || 'artifact-level', c.category, 'SEMANTIC',
      REQ_TO_DISPOSITION[c.requirement]);
  }
  // An unresolved field fails closed for THAT field, not for the artifact.
  for (const fieldId of batch.unresolvedFields) {
    degradedReasons.push(`${fieldId}: ${batch.failureReason ?? 'unresolved'}`);
    record(fieldId, fields.find(f => f.name === fieldId)?.text ?? fieldId,
      'OTHER_FACTUAL_CLAIM', 'SEMANTIC', 'REQUIRES_EVIDENCE');
  }

  const degraded = degradedReasons.length > 0;
  // A degraded run cannot be certified as claim-free, whatever was found.
  const containsClaim = claims.length > 0 || degraded;
  const overall = claims.length > 0
    ? strictestDisposition(claims.map(c => c.category))
    : degraded ? 'REQUIRES_EVIDENCE' : 'ALLOWED_CREATIVE';

  return { containsClaim, claims, overallDisposition: overall, degraded, degradedReasons };
}
