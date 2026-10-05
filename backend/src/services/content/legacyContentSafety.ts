/**
 * @file legacyContentSafety.ts
 * @description P1-24 — bounding the UNGOVERNED legacy Studio generation path.
 *
 *   MEASURED DEFECT (3.5A): `studio.route.ts` and `contentService.ts` produce
 *   owner-visible marketing text with no grounding at all — no evidence handles,
 *   no claim check, no owner-text boundary — and the 3.5A baseline measured 0 of
 *   34 copy-shaped claims detected. So a legacy generation could and would put
 *   "SOC 2 compliant" or "increases conversion by 31%" in front of an owner with
 *   nothing behind it.
 *
 *   WHY THIS IS NOT "ROUTE IT THROUGH THE GOVERNED ENGINE". That engine needs a
 *   strategy, a brief and an evidence set the legacy path has never had. Forcing
 *   it through would either fabricate those inputs or break the existing Studio.
 *   The honest smallest fix is different: the legacy lane keeps working for
 *   CREATIVE copy and is refused the ability to emit UNSUPPORTED FACTUAL claims.
 *
 *   This is a REDUCTION in what legacy generation may say. That is the point —
 *   the alternative is leaving unsupported factual marketing claims owner-visible
 *   and calling P1-24 closed, which the brief explicitly forbids.
 *
 * @security Applies to owner-visible text before persistence. Fails toward
 *   refusal: an unclassifiable sentence is treated as a claim.
 * @dependencies copyClaimClassifier, contentClaimPolicy
 */

import { classifyCopyClaim, splitCopyUnits } from './copyClaimClassifier';
import { strictestDisposition } from './contentClaimPolicy';

export interface LegacyScreenResult {
  /** True when the text may be shown to the owner as legacy Studio output. */
  allowed: boolean;
  /** Sentences that carry unsupported factual claims. */
  blockedUnits: Array<{ text: string; category: string; disposition: string }>;
  /** Owner-facing explanation. Never internal vocabulary. */
  reason: string | null;
}

const REFUSAL =
  'Some of this copy makes factual claims LaunchMind cannot substantiate yet — ' +
  'for example performance numbers, customer counts, certifications or ' +
  'guarantees. Legacy Studio generation can write creative copy, but claims like ' +
  'these need governed evidence, which is coming with Content Intelligence.';

/**
 * Screens legacy-generated marketing text.
 *
 * The legacy lane has NO evidence set, so nothing here can be supported —
 * therefore ANY factual claim class is refused, not merely unsupported ones.
 * That is deliberately stricter than the governed engine, because strictness is
 * the only tool available without evidence.
 *
 * @param text            generated copy as it would be persisted
 * @param competitorNames owner-confirmed competitors, for competitor detection
 */
export function screenLegacyContent(
  text: string | null | undefined, competitorNames: readonly string[] = [],
): LegacyScreenResult {
  if (!text || !text.trim()) return { allowed: true, blockedUnits: [], reason: null };

  const blocked: LegacyScreenResult['blockedUnits'] = [];
  for (const unit of splitCopyUnits(text)) {
    const verdict = classifyCopyClaim(unit, competitorNames);
    if (!verdict.isFactualClaim) continue;
    const disposition = strictestDisposition(verdict.categories);
    // ALLOWED_CREATIVE cannot occur for a factual claim, but the check is
    // explicit so a policy change cannot silently open this path.
    if (disposition === 'ALLOWED_CREATIVE') continue;
    blocked.push({ text: unit, category: verdict.category, disposition });
  }

  return blocked.length === 0
    ? { allowed: true, blockedUnits: [], reason: null }
    : { allowed: false, blockedUnits: blocked, reason: REFUSAL };
}
