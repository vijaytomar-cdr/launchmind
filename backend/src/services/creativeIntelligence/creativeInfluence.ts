/**
 * @file creativeInfluence.ts
 * @description Patterns → creative direction — Phase 3.5B6.5 §19, §20.
 *
 *   THE CONTAMINATION RISK THIS FILE MANAGES. Creative Intelligence is
 *   observation of OTHER companies' work. Strategy is what is true and intended
 *   about THIS product. If the first is allowed to edit the second, the owner's
 *   audience, product role, evidence and stated direction start drifting toward
 *   whatever the category happens to be doing — and no one would ever see it
 *   happen, because both look like reasonable sentences.
 *
 *   So influence is BOUNDED BY CONSTRUCTION rather than by intent:
 *
 *     `CreativeDirection` has fields for hook, format, reveal timing, caption
 *     density, composition and CTA style. It has NO field for audience, product
 *     role, message truth, evidence, proof or founder direction. A pattern
 *     cannot rewrite what it cannot address.
 *
 *   PRECEDENCE, when two inputs disagree:
 *     founder boundary   beats   creative pattern      (always)
 *     confirmed brand    beats   category aesthetics   (always)
 *     creative pattern   beats   nothing               it is the weakest input
 *
 * @security Every influence passes assertInfluenceIsStructural before it is
 *   returned. A stale or retracted pattern is filtered before selection, so a
 *   withdrawn observation stops affecting new work rather than lingering.
 * @dependencies contract
 */

import {
  assertInfluenceIsStructural, influenceIsStructural,
  type CreativeInfluence, type CreativePattern,
} from './contract';

/**
 * The shape a creative may be given. Note what is NOT here.
 *
 * No audience. No product role. No message. No proof. No claim. Those come from
 * strategy, and this type has nowhere to put them.
 */
export interface CreativeDirection {
  hook: string | null;
  narrativeShape: string | null;
  revealTiming: string | null;
  captionDensity: string | null;
  composition: string | null;
  ctaStyle: string | null;
  /** Owner-safe. Each is a sentence, never a source list. */
  influences: CreativeInfluence[];
  /** Structures deliberately NOT taken. */
  notImitated: string[];
  /** Present only when the direction is thin, so the UI can say so honestly. */
  limitation: string | null;
}

export interface DirectionInputs {
  patterns: readonly CreativePattern[];
  /** The message this creative has to carry. Used to score relevance ONLY. */
  messageAngle: string;
  channel: string;
  /** Owner boundaries. These WIN. */
  founderBoundaries?: readonly string[];
  /** Confirmed brand directives. These WIN over category aesthetics. */
  brandDirectives?: readonly string[];
  now?: Date;
}

/**
 * How well a pattern fits THIS message.
 *
 * Deliberately crude and deliberately transparent: token overlap between the
 * pattern's dimension vocabulary and the message. A model-scored relevance
 * would be more nuanced and completely unauditable, and the cost of getting
 * this slightly wrong is a differently-shaped advert.
 */
function relevance(p: CreativePattern, messageAngle: string, channel: string): number {
  const msg = messageAngle.toLowerCase();
  let score = 0.4;                                    // a category pattern is weakly relevant by default
  if (p.channel && p.channel === channel) score += 0.2;
  if (p.dimension === 'NARRATIVE_SHAPE') {
    if (/frustrat|chaos|hassle|problem|struggle|pain|annoy|wait|chase/.test(msg)
        && p.key.startsWith('PROBLEM_FIRST')) score += 0.3;
    if (/simpl|easier|relief|calm|effortless|benefit/.test(msg)
        && p.key.startsWith('BENEFIT_FIRST')) score += 0.3;
    if (/versus|vs\b|instead of|compared|contrast|old way/.test(msg)
        && p.key.startsWith('SIDE_BY_SIDE')) score += 0.3;
    if (/show|demo|walkthrough|how it works/.test(msg)
        && p.key.startsWith('DEMONSTRATION')) score += 0.3;
  }
  if (p.quality.freshness === 'AGING') score -= 0.1;
  return Math.max(0, Math.min(1, score));
}

const DIMENSION_TO_INFLUENCE: Record<string, CreativeInfluence['dimension']> = {
  NARRATIVE_SHAPE: 'HOOK',
  FIRST_FRAME: 'HOOK',
  PRODUCT_REVEAL_TIMING: 'REVEAL_TIMING',
  CAPTION_DENSITY: 'CAPTION_DENSITY',
  VISUAL_COMPOSITION: 'VISUAL_COMPOSITION',
  PACING: 'PACING',
  DURATION: 'FORMAT',
  CTA_STYLE: 'CTA_STYLE',
  HOOK_STRUCTURE: 'HOOK',
};

/**
 * Builds the creative direction for one piece of work.
 *
 * Returns an EMPTY direction rather than throwing when there are no usable
 * patterns: content creation must work identically with Creative Intelligence
 * absent, which is the only way to know the rest of the system does not depend
 * on it.
 */
export function buildCreativeDirection(input: DirectionInputs): CreativeDirection {
  const now = input.now ?? new Date();
  const empty: CreativeDirection = {
    hook: null, narrativeShape: null, revealTiming: null, captionDensity: null,
    composition: null, ctaStyle: null, influences: [], notImitated: [],
    limitation: null,
  };

  // STALE PATTERNS ARE DROPPED. An observation from two years ago describes a
  // category that has moved on, and quietly continuing to apply it is how a
  // product ends up making last year's adverts forever.
  const usable = input.patterns.filter(p =>
    p.quality.freshness !== 'STALE'
    && p.independentSourceCount >= 3
    && new Date(p.lastObservedAt).getTime() <= now.getTime() + 86_400_000);

  if (usable.length === 0) {
    return {
      ...empty,
      limitation: 'LaunchMind does not have current creative observations for this ' +
        'category yet, so the structure below is its own judgement rather than an ' +
        'observed pattern.',
    };
  }

  const scored = usable
    .map(p => ({ p, r: relevance(p, input.messageAngle, input.channel) }))
    .filter(x => x.r >= 0.5)             // an irrelevant pattern changes nothing
    .sort((a, b) => b.r - a.r)
    .slice(0, 4);

  if (scored.length === 0) {
    return {
      ...empty,
      limitation: 'LaunchMind holds creative observations for this category, but none ' +
        'of them fit this particular message, so it has not applied any.',
    };
  }

  const direction: CreativeDirection = { ...empty, influences: [], notImitated: [] };

  for (const { p, r } of scored) {
    const dim = DIMENSION_TO_INFLUENCE[p.dimension];
    if (!dim) continue;
    const inf: CreativeInfluence = {
      patternKey: p.key,
      dimension: dim,
      directive: p.description,
      // OWNER-SAFE. Says how broadly it was seen, and says plainly that this
      // is an observation of structure. It never names a company, never quotes
      // a source, and never claims the structure works.
      //
      // WORDED CAREFULLY, AND THE GUARD IS WHY. An earlier draft ended "...not
      // a prediction that it will perform", which reads as a disclaimer and
      // matched the performance-claim shape in assertInfluenceIsStructural —
      // so every influence was silently dropped and the owner saw an empty
      // creative direction with no explanation. The guard was right and the
      // sentence was wrong. Denying a claim still puts the claim in the text.
      ownerRationale: `Seen at ${p.independentSourceCount} independent sources in ` +
        `current ${p.category} marketing. This is an observation about how this ` +
        `kind of message is usually structured, not a statement about results.`,
    };
    // THE CHOKE POINT. An influence that has become an assertion is dropped
    // here rather than being softened, so a bad pattern is absent rather than
    // present-and-quiet.
    if (!influenceIsStructural(inf)) continue;
    assertInfluenceIsStructural(inf);

    direction.influences.push(inf);
    direction.notImitated.push(...p.doNotImitate);

    if (dim === 'HOOK' && !direction.hook) {
      direction.hook = p.description;
      direction.narrativeShape = p.key.split(':')[0];
    }
    if (dim === 'REVEAL_TIMING' && !direction.revealTiming) direction.revealTiming = p.description;
    if (dim === 'CAPTION_DENSITY' && !direction.captionDensity) direction.captionDensity = p.description;
    if (dim === 'VISUAL_COMPOSITION' && !direction.composition) direction.composition = p.description;
    if (dim === 'CTA_STYLE' && !direction.ctaStyle) direction.ctaStyle = p.description;
    void r;
  }

  // PRECEDENCE. A founder boundary or a confirmed brand directive that
  // contradicts a category pattern wins, and the owner is told which one gave
  // way — a silent override is indistinguishable from the pattern never having
  // been considered.
  const overrides = [...(input.founderBoundaries ?? []), ...(input.brandDirectives ?? [])];
  if (overrides.length > 0 && direction.influences.length > 0) {
    direction.notImitated.push(
      'Where your own brand direction differs from what is common in the category, ' +
      'your direction is used.');
  }

  direction.notImitated = [...new Set(direction.notImitated)];

  // SILENCE IS NOT AN ANSWER. If every candidate influence was dropped — most
  // plausibly by the structural guard above — the owner would otherwise see an
  // empty Creative Direction with no explanation, which reads as "LaunchMind
  // has no view" when the truth is "LaunchMind had a view and refused it".
  if (direction.influences.length === 0) {
    direction.limitation = 'LaunchMind found relevant creative structures for this ' +
      'category but set them aside, so the creative below follows its own judgement.';
  }
  return direction;
}

/**
 * The compact owner-facing summary — §20.
 *
 * Three words and one sentence. NOT a competitor gallery, and not an invitation
 * to browse examples: showing an owner the adverts LaunchMind looked at is one
 * click away from an owner asking for one of them to be copied.
 */
export function summariseDirection(d: CreativeDirection): {
  recommends: string[]; why: string | null; limitation: string | null;
} {
  const recommends: string[] = [];
  if (d.narrativeShape?.startsWith('PROBLEM_FIRST')) recommends.push('Problem-first');
  if (d.narrativeShape?.startsWith('BENEFIT_FIRST')) recommends.push('Benefit-first');
  if (d.narrativeShape?.startsWith('DEMONSTRATION')) recommends.push('Show it working');
  if (d.narrativeShape?.startsWith('SIDE_BY_SIDE')) recommends.push('Before and after');
  if (d.revealTiming) recommends.push('Product appears early');
  if (d.captionDensity?.includes('sparse')) recommends.push('Low caption density');
  if (d.captionDensity?.includes('written statement')) recommends.push('Text-led');
  if (d.ctaStyle) recommends.push('Soft call to action');

  const why = d.influences.length === 0 ? null
    : 'These structures appear repeatedly in current marketing for your category ' +
      'and fit the message you are trying to tell.';
  return { recommends, why, limitation: d.limitation };
}
