/**
 * @file contentClaimPolicy.ts
 * @description What a classified copy claim is ALLOWED to do — ADR-070 §5.
 *
 *   Classification says what kind of assertion a sentence is. This says whether
 *   it may be used, and on what terms. The split matters: a classifier that also
 *   adjudicated would make "detect it" and "permit it" one decision, and
 *   loosening detection to permit something would then be invisible.
 *
 *   THE RULE THAT SHAPES EVERYTHING: an unsupported factual claim is DROPPED,
 *   never relabelled as creative. Phase 3.3C established that downgrading an
 *   invented measurement to "inference" launders it; the same is true of calling
 *   an unsupported "SOC 2 compliant" a stylistic choice.
 *
 * @security Uncertainty fails toward non-use.
 * @dependencies copyClaimClassifier (types only)
 */

import type { ClaimCategory } from './copyClaimClassifier';

export type ClaimDisposition =
  | 'ALLOWED_CREATIVE'
  | 'REQUIRES_EVIDENCE'
  | 'REQUIRES_OWNER_CONFIRMATION'
  | 'PROHIBITED_IN_3_5';

/** ADR-070 §5, frozen. */
const POLICY: Record<ClaimCategory, ClaimDisposition> = {
  QUANTIFIED_PERFORMANCE:  'REQUIRES_EVIDENCE',
  CUSTOMER_COUNT:          'REQUIRES_EVIDENCE',
  SOCIAL_PROOF:            'REQUIRES_EVIDENCE',
  COMPARATIVE:             'REQUIRES_EVIDENCE',
  COMPETITOR_CLAIM:        'REQUIRES_EVIDENCE',
  CAPABILITY:              'REQUIRES_EVIDENCE',
  PRICING:                 'REQUIRES_EVIDENCE',
  GEOGRAPHIC_AVAILABILITY: 'REQUIRES_EVIDENCE',
  FIRST_PARTY_PERFORMANCE: 'REQUIRES_EVIDENCE',
  // A superlative or exclusivity claim is a comparative claim about every
  // competitor at once. It needs the same substantiation, not less.
  SUPERLATIVE:             'REQUIRES_EVIDENCE',
  EXCLUSIVITY:             'REQUIRES_EVIDENCE',

  // LaunchMind cannot read a SOC 2 report or a security posture. The owner
  // asserts these and owns them; LaunchMind never certifies them.
  SECURITY:                'REQUIRES_OWNER_CONFIRMATION',
  COMPLIANCE_CERTIFICATION:'REQUIRES_OWNER_CONFIRMATION',
  GUARANTEE:               'REQUIRES_OWNER_CONFIRMATION',
  ENDORSEMENT:             'REQUIRES_OWNER_CONFIRMATION',

  // Urgency the model invented is manufactured pressure on a real customer.
  SCARCITY_URGENCY:        'PROHIBITED_IN_3_5',
  REGULATED_VERTICAL:      'PROHIBITED_IN_3_5',
  LEGAL_APPROVAL:          'PROHIBITED_IN_3_5',

  // A qualitative promise of a result is still a promise the business must be
  // able to stand behind. It escalates to GUARANTEE or PROHIBITED via
  // strictest-wins when the same sentence also carries those signals.
  OUTCOME_PROMISE:         'REQUIRES_EVIDENCE',
  OTHER_FACTUAL_CLAIM:     'REQUIRES_EVIDENCE',
  CREATIVE_NON_FACTUAL:    'ALLOWED_CREATIVE',
};

export function dispositionFor(category: ClaimCategory): ClaimDisposition {
  return POLICY[category] ?? 'REQUIRES_EVIDENCE';
}

/** Strictest wins when a sentence is several things at once. */
const SEVERITY: Record<ClaimDisposition, number> = {
  PROHIBITED_IN_3_5: 0, REQUIRES_OWNER_CONFIRMATION: 1,
  REQUIRES_EVIDENCE: 2, ALLOWED_CREATIVE: 3,
};

export function strictestDisposition(categories: readonly ClaimCategory[]): ClaimDisposition {
  if (categories.length === 0) return 'ALLOWED_CREATIVE';
  return categories
    .map(dispositionFor)
    .sort((a, b) => SEVERITY[a] - SEVERITY[b])[0];
}

export const OWNER_CONFIRMABLE: readonly ClaimCategory[] = [
  'SECURITY', 'COMPLIANCE_CERTIFICATION', 'GUARANTEE', 'ENDORSEMENT',
];

/**
 * May this owner-confirmation claim be used?
 *
 * Requires an explicit governed assertion for THAT category. Generic product
 * context mentioning "security" does not make "SOC 2 compliant" true, which is
 * the exact inference this function exists to refuse.
 */
export function ownerConfirmationSatisfied(
  category: ClaimCategory, confirmed: readonly string[],
): boolean {
  return confirmed.map(c => c.toUpperCase()).includes(category);
}
