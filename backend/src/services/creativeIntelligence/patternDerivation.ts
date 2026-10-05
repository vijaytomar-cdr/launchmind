/**
 * @file patternDerivation.ts
 * @description Observations → patterns — Phase 3.5B6.5 §14, §18.
 *
 *   THE ONE RULE THAT MATTERS. A pattern requires MIN_INDEPENDENT_SOURCES
 *   distinct PUBLISHERS. Not three rows, not three URLs, not three pages of one
 *   company's site — three companies who independently arrived at the same
 *   structure. Without that, "pattern" means "the last thing I looked at", and
 *   the first advert anyone observed would become a category truth.
 *
 *   Two observations from one publisher say something about that publisher's
 *   house style. Three publishers converging on a structure is weak evidence
 *   that the structure suits the category. It is still weak; that is what
 *   `observationConfidence` is for, and why it tops out at MODERATE until the
 *   support is genuinely broad.
 *
 *   NO SCORE IS COMBINED HERE. `quality` carries its dimensions side by side.
 *
 * @security Pure. No database, no network, no model. Every derived description
 *   is checked for abstraction before it can become a pattern, so a description
 *   that is really one advert is dropped with a reason rather than published.
 * @dependencies contract, copyrightBoundary
 */

import {
  MIN_INDEPENDENT_SOURCES, publisherIndependenceKey, creativeFreshness,
  type CreativeObservation, type CreativePattern, type CreativePatternQuality,
  type CreativeStructureDimension,
} from './contract';
import { assessAbstraction } from './copyrightBoundary';

export interface DerivationResult {
  patterns: CreativePattern[];
  /** Candidate groups that did NOT become patterns, and why. */
  rejected: Array<{ key: string; reason: string }>;
}

/** How a group of observations is keyed into a candidate pattern. */
interface Candidate {
  key: string;
  dimension: CreativeStructureDimension;
  description: string;
  doNotImitate: string[];
  members: CreativeObservation[];
}

/**
 * The structural facts each observation contributes.
 *
 * Every branch produces an ABSTRACT sentence with no room for a publisher name,
 * a quotation or a prop — the description is built from the enum, not from the
 * observation's free text, so a hostile or over-specific note cannot become a
 * pattern description by passing through.
 */
function candidatesFrom(o: CreativeObservation): Array<Omit<Candidate, 'members'>> {
  const out: Array<Omit<Candidate, 'members'>> = [];
  const cat = o.category;

  if (o.narrativeShape === 'PROBLEM_LED') {
    out.push({
      key: `PROBLEM_FIRST_RECOGNITION:${cat}`, dimension: 'NARRATIVE_SHAPE',
      description: 'Open with a frustration the audience already recognises, before showing the product.',
      doNotImitate: ['Do not reuse another company’s specific scene, wording or cast.'],
    });
  }
  if (o.narrativeShape === 'BENEFIT_LED') {
    out.push({
      key: `BENEFIT_FIRST_OPENING:${cat}`, dimension: 'NARRATIVE_SHAPE',
      description: 'Open on the outcome the product makes possible, then show how.',
      doNotImitate: ['Do not borrow a specific claim used to express the benefit.'],
    });
  }
  if (o.narrativeShape === 'DEMONSTRATION_LED') {
    out.push({
      key: `DEMONSTRATION_OPENING:${cat}`, dimension: 'NARRATIVE_SHAPE',
      description: 'Open by showing the product being used rather than describing it.',
      doNotImitate: ['Do not copy a specific interface walkthrough.'],
    });
  }
  if (o.narrativeShape === 'COMPARISON_LED') {
    out.push({
      key: `SIDE_BY_SIDE_CONTRAST:${cat}`, dimension: 'NARRATIVE_SHAPE',
      description: 'Set the old way against the new way in one frame, and let the contrast carry the message.',
      doNotImitate: ['Do not name or depict a competitor in the “old way” side.'],
    });
  }
  if (o.productRevealSeconds !== null && o.productRevealSeconds <= 5) {
    out.push({
      key: `EARLY_PRODUCT_REVEAL:${cat}`, dimension: 'PRODUCT_REVEAL_TIMING',
      description: 'Show the product within the first few seconds rather than holding it back.',
      doNotImitate: ['Do not reproduce another product’s reveal shot.'],
    });
  }
  if (o.captionDensity === 'LOW' || o.captionDensity === 'NONE') {
    out.push({
      key: `LOW_CAPTION_DENSITY:${cat}`, dimension: 'CAPTION_DENSITY',
      description: 'Keep on-screen words sparse; let the visual carry most of the meaning.',
      doNotImitate: ['Do not reuse another advert’s caption wording.'],
    });
  }
  if (o.captionDensity === 'HIGH') {
    out.push({
      key: `TEXT_LED_COMPOSITION:${cat}`, dimension: 'CAPTION_DENSITY',
      description: 'Lead with a short written statement the viewer reads before anything else.',
      doNotImitate: ['Do not reuse the statement itself.'],
    });
  }
  if (o.durationSeconds !== null && o.durationSeconds <= 20) {
    out.push({
      key: `SHORT_DURATION:${cat}`, dimension: 'DURATION',
      description: 'Keep it under about twenty seconds; the format rewards brevity.',
      doNotImitate: [],
    });
  }
  // THE TRIGGER MUST MATCH THE SENTENCE. This branch used to fire on "an
  // observation recorded a CTA at all" while describing a SOFT one, so a page
  // ending in a hard transactional demand would have supported a pattern
  // recommending the opposite. A pattern whose evidence does not match its own
  // description is worse than no pattern: it is confidently wrong.
  if (o.ctaStyle && /soft|invit|browse|explore|discover|look|see|learn/i.test(o.ctaStyle)) {
    out.push({
      key: `SOFT_CTA:${cat}`, dimension: 'CTA_STYLE',
      description: 'Close with a low-pressure invitation to look rather than a hard demand to buy.',
      doNotImitate: ['Do not reuse a competitor’s exact call-to-action wording.'],
    });
  }
  if (o.ctaStyle && /hard|transactional|imperative|demand|buy now|book now|start free|sign ?up/i.test(o.ctaStyle)) {
    out.push({
      key: `DIRECT_CTA:${cat}`, dimension: 'CTA_STYLE',
      description: 'Close with one direct, unambiguous action rather than a choice of routes.',
      doNotImitate: ['Do not reuse a competitor’s exact call-to-action wording.'],
    });
  }
  if (o.firstFrame) {
    out.push({
      key: `FIRST_FRAME_STOPS_SCROLL:${cat}`, dimension: 'FIRST_FRAME',
      description: 'Put something legible and specific in the first frame; nothing is established by a title card.',
      doNotImitate: ['Do not recreate a specific opening image.'],
    });
  }
  return out;
}

/**
 * Derives patterns from a set of observations.
 *
 * @param observations   governed observations for one category
 * @param competitorNames names that must not appear in an abstraction
 * @param now            injected so freshness is testable
 */
export function derivePatterns(
  observations: readonly CreativeObservation[],
  competitorNames: readonly string[] = [],
  now = new Date(),
): DerivationResult {
  const groups = new Map<string, Candidate>();

  for (const o of observations) {
    for (const c of candidatesFrom(o)) {
      const g = groups.get(c.key) ?? { ...c, members: [] };
      g.members.push(o);
      groups.set(c.key, g);
    }
  }

  const patterns: CreativePattern[] = [];
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const g of groups.values()) {
    // DISTINCT PUBLISHERS, not rows. This is the whole guard against one
    // company's house style being reported as a category pattern.
    const publishers = new Set(
      g.members.map(m => publisherIndependenceKey(m.publisher, m.sourceRef)));
    if (publishers.size < MIN_INDEPENDENT_SOURCES) {
      rejected.push({
        key: g.key,
        reason: `seen at ${publishers.size} independent source${publishers.size === 1 ? '' : 's'}, ` +
                `which is fewer than the ${MIN_INDEPENDENT_SOURCES} required to call it a pattern`,
      });
      continue;
    }

    const abstraction = assessAbstraction(g.description, competitorNames);
    if (!abstraction.abstract) {
      rejected.push({ key: g.key, reason: `not an abstraction: ${abstraction.reasons.join('; ')}` });
      continue;
    }

    const dates = g.members.map(m => m.observedAt).sort();
    const first = dates[0], last = dates[dates.length - 1];
    const channels = new Set(g.members.map(m => m.channel));
    const formats = new Set(g.members.map(m => m.format));

    const quality: CreativePatternQuality = {
      // Relevance is a property of a USE, not of a pattern. Computed when the
      // pattern is applied to a message, never stored.
      patternRelevance: null,
      categoryFit: Math.min(1, publishers.size / (MIN_INDEPENDENT_SOURCES * 2)),
      channelFit: channels.size === 1 ? 1 : Math.max(0.4, 1 / channels.size),
      // Cannot be known without the owner's confirmed brand in hand.
      brandCompatibility: 'UNKNOWN',
      evidenceBreadth: Math.min(1, publishers.size / 8),
      freshness: creativeFreshness(last, now),
      // CAPPED AT MODERATE below eight independent publishers. Three sources
      // agreeing is a signal; it is not a finding, and labelling it HIGH would
      // make a thin observation sound like a measurement.
      observationConfidence: publishers.size >= 8 ? 'HIGH'
        : publishers.size >= 5 ? 'MODERATE' : 'LOW',
    };

    patterns.push({
      id: g.key,
      key: g.key,
      description: g.description,
      dimension: g.dimension,
      category: g.members[0].category,
      channel: channels.size === 1 ? [...channels][0] : null,
      format: formats.size === 1 ? [...formats][0] : null,
      independentSourceCount: publishers.size,
      firstObservedAt: first,
      lastObservedAt: last,
      quality,
      doNotImitate: g.doNotImitate,
    });
  }

  // Broadest support first. Deliberately NOT a composite ranking — this is one
  // dimension used as a display order, and the caller can see which one.
  patterns.sort((a, b) => b.independentSourceCount - a.independentSourceCount);
  return { patterns, rejected };
}
