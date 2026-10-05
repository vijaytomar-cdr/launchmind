/**
 * @file creativeConcepts.ts
 * @description Three creative HYPOTHESES, not three layouts — §8, §9, §10.
 *
 *   WHAT THE PREVIOUS PASS GOT WRONG. It produced three compositions of one
 *   message. Moving a screenshot and changing a background is a variation in
 *   presentation; it is not a different bet about why someone would care. Three
 *   creatives that share a hook, a message order and a product role are one
 *   creative photographed from three angles, and testing them tells the owner
 *   nothing they did not already know.
 *
 *   A CONCEPT IS A HYPOTHESIS. Each one below says something different about
 *   what will make a stranger stop:
 *
 *     A PROBLEM_RECOGNITION  "you will recognise this frustration"
 *     B PRODUCT_DEMONSTRATION "you will understand what this is in two seconds"
 *     C RELIEF                "you will want the calmer version of this"
 *
 *   They deliberately disagree about product prominence, about whether the
 *   opening is about the reader or about the product, and about where the
 *   product appears in the message order. If the owner runs all three and one
 *   wins, they have learned which of those three bets was right — which is the
 *   only reason to make three.
 *
 *   WHAT THEY SHARE, and must: the campaign, the approved product truth, the
 *   confirmed brand, the destination, and every governance boundary. A concept
 *   changes the ANGLE. It cannot change what is true.
 *
 * @security Pure. Concepts influence hook, message order, prominence and
 *   composition — never evidence, never a claim, never an approval. `NARRATIVE`
 *   below marks whether a concept may lean on problem framing; it does not
 *   grant it, because narrativeFramingPolicy still adjudicates every line.
 * @dependencies briefComposition (types only), productComposition (layout type)
 */

import type { CompositionLayout } from '../creative/productComposition';

export const CONCEPT_KEYS = [
  'PROBLEM_RECOGNITION', 'PRODUCT_DEMONSTRATION', 'RELIEF',
] as const;
export type ConceptKey = typeof CONCEPT_KEYS[number];

/** The dimensions §9 requires three concepts to differ across. */
export interface ConceptShape {
  key: ConceptKey;
  /** Owner-facing name. Never an enum on screen. */
  name: string;
  hookType: 'PROBLEM_FIRST' | 'PRODUCT_FIRST' | 'OUTCOME_FIRST';
  messageStructure: 'PROBLEM_THEN_PRODUCT' | 'PRODUCT_THEN_CONTEXT' | 'STATE_THEN_MEANS';
  productProminence: 'SECONDARY' | 'DOMINANT' | 'SUPPORTING';
  narrativeFrame: 'RECOGNITION' | 'EXPLANATION' | 'ASPIRATION';
  visualHierarchy: 'TEXT_LED' | 'PRODUCT_LED' | 'SPACE_LED';
  layout: CompositionLayout;
  /** What the generator is asked to do differently. */
  hookDirection: string;
  /** Extra generation guidance, layered on top of the shared brief. */
  guidance: string;
}

export const CONCEPTS: Record<ConceptKey, ConceptShape> = {
  PROBLEM_RECOGNITION: {
    key: 'PROBLEM_RECOGNITION',
    name: 'Problem recognition',
    hookType: 'PROBLEM_FIRST',
    messageStructure: 'PROBLEM_THEN_PRODUCT',
    productProminence: 'SECONDARY',
    narrativeFrame: 'RECOGNITION',
    visualHierarchy: 'TEXT_LED',
    layout: 'PROBLEM_FRAME',
    hookDirection:
      'open on the starting point the reader may recognise, before naming the product',
    guidance:
      'Open on the situation the reader might be in, addressed to them. The product ' +
      'appears LAST, as the thing that changes the situation — not as proof that ' +
      'anything improved. Do not describe what other people experience. ' +
      'HEADLINE: use a framing shape — a question or an "ought to" statement.',
  },
  PRODUCT_DEMONSTRATION: {
    key: 'PRODUCT_DEMONSTRATION',
    name: 'Product demonstration',
    hookType: 'PRODUCT_FIRST',
    messageStructure: 'PRODUCT_THEN_CONTEXT',
    productProminence: 'DOMINANT',
    narrativeFrame: 'EXPLANATION',
    visualHierarchy: 'PRODUCT_LED',
    layout: 'PRODUCT_HERO',
    hookDirection:
      'say plainly what the product is, in the first line, before anything else',
    guidance:
      'Answer "what is this?" immediately, using only what the product description ' +
      'supports. No lifestyle language, no atmosphere, no problem framing — a reader ' +
      'who has never heard of it should understand what it does from the first line. ' +
      'HEADLINE: name the product and what it does. Do NOT ask a question — a ' +
      'question is the opposite of this concept.',
  },
  RELIEF: {
    key: 'RELIEF',
    name: 'Relief',
    hookType: 'OUTCOME_FIRST',
    messageStructure: 'STATE_THEN_MEANS',
    productProminence: 'SUPPORTING',
    narrativeFrame: 'ASPIRATION',
    visualHierarchy: 'SPACE_LED',
    layout: 'RELIEF_FRAME',
    hookDirection:
      'open on the calmer way this could work, then say how it is done',
    guidance:
      'Describe the simpler state as something the reader could have, not as ' +
      'something anyone has measured. Never convert a feeling into a figure. ' +
      'HEADLINE: an "ought to" or hedged statement about how this could feel. ' +
      'Do NOT ask a question and do NOT open on the problem.',
  },
};

// ── §9 DISTINCTNESS ─────────────────────────────────────────────────────────

/** The dimensions compared. A composite score is deliberately absent. */
export const DISTINCTNESS_DIMENSIONS = [
  'hookType', 'messageStructure', 'productProminence',
  'narrativeFrame', 'visualHierarchy', 'layout',
] as const;

export interface DistinctnessVerdict {
  distinct: boolean;
  /** Dimensions on which all three genuinely differ. */
  differingDimensions: string[];
  /** Dimensions where two or more collapsed. */
  collapsedDimensions: string[];
  /** Owner-safe. Only populated on failure. */
  reason: string | null;
}

/**
 * How many dimensions must genuinely differ.
 *
 * FOUR OF SIX. Not all six: a shared dimension is legitimate — two concepts can
 * reasonably both be text-led. Not two: that is a background and a headline
 * swap, which is what this check exists to reject. Four forces the difference
 * to be about the ARGUMENT rather than the arrangement.
 */
export const MIN_DIFFERING_DIMENSIONS = 4;

/**
 * Are these genuinely different creative hypotheses?
 *
 * @security Structural and deterministic. Called before the owner is offered a
 *   comparison, so three near-identical creatives are refused rather than
 *   presented as a choice.
 */
export function assertConceptsDistinct(shapes: readonly ConceptShape[]): DistinctnessVerdict {
  if (shapes.length < 2) {
    return { distinct: false, differingDimensions: [], collapsedDimensions: [],
      reason: 'There is only one version, so there is nothing to compare.' };
  }
  const differing: string[] = [];
  const collapsed: string[] = [];
  for (const dim of DISTINCTNESS_DIMENSIONS) {
    const values = new Set(shapes.map(s => String(s[dim as keyof ConceptShape])));
    // ALL must differ on a dimension for it to count. Two-of-three sharing a
    // value means that dimension did not separate the set.
    if (values.size === shapes.length) differing.push(dim);
    else collapsed.push(dim);
  }
  const distinct = differing.length >= MIN_DIFFERING_DIMENSIONS;
  return {
    distinct, differingDimensions: differing, collapsedDimensions: collapsed,
    reason: distinct ? null
      : 'These versions are too similar to be worth comparing — they differ in ' +
        'presentation but make the same argument.',
  };
}

/**
 * Two concepts that differ ONLY in wording are not two concepts.
 *
 * Compares the produced copy as well as the declared shape, because a shape can
 * claim to be product-first while the generator writes the same opening three
 * times. Deliberately crude — token overlap of the first line — because the
 * failure it catches is gross, not subtle.
 */
export function copyIsDistinct(
  headlines: readonly string[], overlapCeiling = 0.7,
): { distinct: boolean; worstPair: [number, number] | null; overlap: number } {
  const norm = (s: string) => new Set(
    String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
      .filter(w => w.length > 3));
  let worst = 0; let pair: [number, number] | null = null;
  for (let i = 0; i < headlines.length; i++) {
    for (let j = i + 1; j < headlines.length; j++) {
      const a = norm(headlines[i]), b = norm(headlines[j]);
      if (a.size === 0 || b.size === 0) continue;
      const shared = [...a].filter(t => b.has(t)).length;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap > worst) { worst = overlap; pair = [i, j]; }
    }
  }
  return { distinct: worst <= overlapCeiling, worstPair: pair, overlap: worst };
}
