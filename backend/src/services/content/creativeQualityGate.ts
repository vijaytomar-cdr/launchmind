/**
 * @file creativeQualityGate.ts
 * @description Pre-render creative quality gate for one governed concept.
 *
 * Governance answers "may we say this?". This gate answers the different
 * question "is this specific and intentional enough to spend rendering money
 * on?". It is deterministic, dimensional and deliberately has no aggregate
 * score. A pass predicts no performance and grants no approval.
 */

import type { ConceptKey } from './creativeConcepts';

export const CREATIVE_QUALITY_DIMENSIONS = [
  'HOOK_STRENGTH', 'SPECIFICITY', 'DISTINCTIVENESS', 'PRODUCT_RELEVANCE',
  'MESSAGE_CLARITY', 'CHANNEL_FIT', 'SHAREABILITY', 'GOVERNANCE', 'ASSET_PLAN',
] as const;
export type CreativeQualityDimension = typeof CREATIVE_QUALITY_DIMENSIONS[number];

export interface CreativeQualityFinding {
  dimension: CreativeQualityDimension;
  state: 'PASS' | 'WATCH' | 'FAIL';
  ownerReason: string;
  retryHint: string | null;
}

export interface CreativeQualityVerdict {
  state: 'PUBLISHABLE_CANDIDATE' | 'NEEDS_IMPROVEMENT';
  findings: CreativeQualityFinding[];
  blocking: CreativeQualityFinding[];
  /** A quality verdict is never a performance prediction. */
  performanceKnown: false;
}

const GENERIC_LINES = [
  /^home services made easy[.!]?$/i,
  /^your trusted home services solution[.!]?$/i,
  /^take control of your home today[.!]?$/i,
  /^quality service you can count on[.!]?$/i,
  /^making life easier, one service at a time[.!]?$/i,
  /^(?:discover|experience) (?:the )?(?:future|difference|possibilities)[.!]?$/i,
];

function strings(payload: Record<string, unknown>): string[] {
  return Object.values(payload).flatMap(value =>
    typeof value === 'string' ? [value.trim()]
      : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map(v => v.trim())
        : []).filter(Boolean);
}

/**
 * Evaluate strategy quality before a visual provider is called.
 *
 * @security `governanceEligible` is an INPUT from the existing frozen gates;
 * this function cannot turn it true. Creative quality never creates evidence.
 */
export function evaluateCreativeConceptQuality(input: {
  concept: ConceptKey;
  payload: Record<string, unknown>;
  productName: string | null;
  audience: string | null;
  channel: string;
  hasAssetPlan: boolean;
  governanceEligible: boolean;
}): CreativeQualityVerdict {
  const copy = strings(input.payload);
  const headline = String(input.payload.headline ?? input.payload.hook ?? input.payload.h1 ?? '').trim();
  const all = copy.join(' ');
  const generic = copy.find(line => GENERIC_LINES.some(pattern => pattern.test(line)));
  const productNamed = !!input.productName && new RegExp(
    `\\b${input.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(all);
  const audienceTokens = String(input.audience ?? '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(token => token.length >= 5);
  const audienceSpecific = audienceTokens.some(token => all.toLowerCase().includes(token));
  const findings: CreativeQualityFinding[] = [];
  const add = (dimension: CreativeQualityDimension, state: CreativeQualityFinding['state'],
    ownerReason: string, retryHint: string | null = null) =>
    findings.push({ dimension, state, ownerReason, retryHint });

  add('HOOK_STRENGTH', headline.length >= 18
    ? 'PASS' : 'FAIL', headline.length >= 18
      ? 'The opening communicates a complete idea.'
      : 'The opening is too thin to establish the idea.',
    headline.length >= 18 ? null : 'write a complete, concrete opening idea');
  add('SPECIFICITY', generic ? 'FAIL' : (audienceSpecific || productNamed ? 'PASS' : 'WATCH'),
    generic ? `The line “${generic}” could belong to almost any brand.`
      : audienceSpecific || productNamed ? 'The concept is tied to this product or audience.'
        : 'The concept could be more specific to this audience.',
    generic ? 'replace generic marketing language with a product- and audience-specific observation' : null);
  add('DISTINCTIVENESS', generic ? 'FAIL' : 'PASS', generic
    ? 'The central line is interchangeable with generic advertising.'
    : 'The concept has a defined creative role.', generic
      ? 'use the assigned concept role to make a materially different argument' : null);
  add('PRODUCT_RELEVANCE', productNamed ? 'PASS'
    : input.concept === 'PROBLEM_RECOGNITION' ? 'WATCH' : 'FAIL', productNamed
      ? 'The product has a clear role in the message.'
      : input.concept === 'PROBLEM_RECOGNITION'
        ? 'The product can remain secondary, but must appear in the final artifact.'
        : 'The product is not meaningfully connected to the concept.',
    productNamed || input.concept === 'PROBLEM_RECOGNITION' ? null
      : 'connect the idea explicitly to the product using only verified capability language');
  add('MESSAGE_CLARITY', copy.length >= 2 && all.length >= 45 ? 'PASS' : 'FAIL',
    copy.length >= 2 && all.length >= 45 ? 'The hook and supporting message are both present.'
      : 'The concept does not yet contain enough message structure to review.',
    copy.length >= 2 && all.length >= 45 ? null : 'provide a hook and a clear supporting message');
  add('CHANNEL_FIT', input.channel === 'META_AD' && headline.length > 90 ? 'WATCH' : 'PASS',
    input.channel === 'META_AD' && headline.length > 90
      ? 'The opening may be dense at feed size.' : 'The structure fits the selected channel.');
  add('SHAREABILITY', input.concept === 'PROBLEM_RECOGNITION' ? 'PASS' : 'WATCH',
    input.concept === 'PROBLEM_RECOGNITION'
      ? 'Immediate recognition gives the audience a plausible reason to respond or share.'
      : 'No first-party response data exists for this hook yet.');
  add('GOVERNANCE', input.governanceEligible ? 'PASS' : 'FAIL', input.governanceEligible
    ? 'Existing product-truth and claim checks passed.'
    : 'The wording did not clear existing product-truth checks.',
    input.governanceEligible ? null : 'remove or rewrite unsupported claims without broadening product capability');
  add('ASSET_PLAN', input.hasAssetPlan ? 'PASS' : 'FAIL', input.hasAssetPlan
    ? 'The concept has an authorized visual plan.'
    : 'No authorized visual asset plan is available.',
    input.hasAssetPlan ? null : 'choose an authorized product image or an explicitly product-free composition');

  const blocking = findings.filter(f => f.state === 'FAIL');
  return {
    state: blocking.length === 0 ? 'PUBLISHABLE_CANDIDATE' : 'NEEDS_IMPROVEMENT',
    findings, blocking, performanceKnown: false,
  };
}
