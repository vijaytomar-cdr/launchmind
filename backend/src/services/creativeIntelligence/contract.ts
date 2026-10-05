/**
 * @file contract.ts
 * @description The Creative Intelligence contract, as code — Phase 3.5B6.5 §14–§19.
 *
 *   WHAT CREATIVE INTELLIGENCE IS. A body of ABSTRACTIONS about how marketing
 *   creative in a category tends to be STRUCTURED: what the first frame does,
 *   how soon the product appears, whether the opening leads with the problem or
 *   the benefit, how dense the captions are, what shape the call to action
 *   takes. It exists so LaunchMind produces creative with a deliberate
 *   structure rather than whatever a diffusion model finds aesthetically safe.
 *
 *   WHAT IT IS NOT, and this file is where the "not" is enforced:
 *
 *     NOT A TEMPLATE LIBRARY.  A pattern is a sentence about structure. No
 *       observation stores competitor pixels, and nothing here can hand a
 *       competitor's asset to a renderer — see copyrightBoundary.ts.
 *     NOT EVIDENCE.  A pattern may change HOW something is said. It can never
 *       substantiate WHAT is true. "Open with the problem" is a structural
 *       recommendation; "customers wait three days" is a claim about the world,
 *       and no amount of observing other people's adverts produces one.
 *     NOT A PERFORMANCE PREDICTION.  Public engagement is an OBSERVATION of
 *       popularity. Popularity is not effectiveness, effectiveness is not
 *       causation, and none of the three is available to us for someone else's
 *       campaign whose spend, targeting and objective we cannot see.
 *
 *   NO COMPOSITE SCORE. There is deliberately no `creativeScore` and no
 *   `viralityScore`. A single number invites ranking, ranking invites "use the
 *   highest one", and the dimensions here measure genuinely different things —
 *   how well a pattern fits this channel says nothing about how many
 *   independent sources support it. They are kept separate so a weak one cannot
 *   be averaged away by a strong one.
 *
 * @security Pure and deterministic. No database, no network, no model. The
 *   influence ceiling defined here is the ONLY set of things a creative pattern
 *   may change, and `assertInfluenceIsStructural` is the choke point.
 * @dependencies none
 */

import { createHash } from 'crypto';

export const CREATIVE_INTELLIGENCE_POLICY_VERSION = 1 as const;

// ── MODE ────────────────────────────────────────────────────────────────────

export const CREATIVE_INTELLIGENCE_MODES = ['OFF', 'SHADOW', 'ACTIVE'] as const;
export type CreativeIntelligenceMode = typeof CREATIVE_INTELLIGENCE_MODES[number];

/**
 * The running mode. Defaults to ACTIVE.
 *
 * ACTIVE is safe as a default here in a way it is NOT for Market Intelligence,
 * and the difference is worth stating rather than assuming: Market Intelligence
 * carries facts about other companies that could become claims, so it defaults
 * to SHADOW. Creative Intelligence carries no facts at all — its entire output
 * is structural advice that cannot enter a claim, enforced below. The failure
 * mode of a wrong pattern is a differently-shaped advert, not a false statement.
 */
export function resolveCreativeIntelligenceMode(
  raw = process.env.CREATIVE_INTELLIGENCE_MODE,
): CreativeIntelligenceMode {
  const v = (raw ?? 'ACTIVE').toUpperCase();
  if (v === 'OFF' || v === 'SHADOW' || v === 'ACTIVE') return v;
  return 'OFF';   // a misconfiguration should quieten the system, not widen it
}

// ── SOURCE CLASSES ──────────────────────────────────────────────────────────

/**
 * Where an observation may come from.
 *
 * Every member is PUBLIC and reachable WITHOUT AUTHENTICATION. There is
 * deliberately no member for an authenticated feed, a personal account, or
 * anything behind an anti-bot control: the absence of the enum value is the
 * control, because a source class that cannot be named cannot be recorded.
 */
export const CREATIVE_SOURCE_CLASSES = [
  'PUBLIC_BRAND_PAGE',       // a company's own public marketing page
  'PUBLIC_APP_STORE_CREATIVE', // store screenshots/preview copy, already public
  'PUBLIC_AD_LIBRARY',       // a platform's public, published ad library
  'PUBLIC_VIDEO_METADATA',   // metadata visible without signing in
  'PUBLIC_LANDING_PAGE',
  'ANALYST_OR_EDITORIAL',    // a published article describing category creative
  'LAUNCHMIND_MARKET_RESEARCH', // an observation LaunchMind already holds
] as const;
export type CreativeSourceClass = typeof CREATIVE_SOURCE_CLASSES[number];

/** Source classes that may never be recorded. Named so a reader can see them. */
export const REFUSED_SOURCE_CLASSES = [
  'AUTHENTICATED_FEED', 'PRIVATE_ACCOUNT', 'PERSONAL_PROFILE',
  'PAYWALLED_CONTENT', 'ANTI_BOT_BYPASS', 'PURCHASED_SCRAPE',
] as const;

// ── STRUCTURAL DIMENSIONS ───────────────────────────────────────────────────

/** What an observation records. All structural; none is a claim about a product. */
export const CREATIVE_STRUCTURE_DIMENSIONS = [
  'HOOK_STRUCTURE',        // what the opening does
  'FIRST_FRAME',           // what is on screen at t=0
  'PRODUCT_REVEAL_TIMING', // how soon the product appears
  'NARRATIVE_SHAPE',       // problem-led / benefit-led / demonstration / comparison
  'CAPTION_DENSITY',       // how much text is on screen
  'VISUAL_COMPOSITION',    // recurring layout
  'PACING',
  'DURATION',
  'CTA_STYLE',
] as const;
export type CreativeStructureDimension = typeof CREATIVE_STRUCTURE_DIMENSIONS[number];

export const NARRATIVE_SHAPES = [
  'PROBLEM_LED', 'BENEFIT_LED', 'DEMONSTRATION_LED', 'COMPARISON_LED',
  'STORY_LED', 'SPOKESPERSON_LED', 'UNKNOWN',
] as const;
export type NarrativeShape = typeof NARRATIVE_SHAPES[number];

export const CAPTION_DENSITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const;
export type CaptionDensity = typeof CAPTION_DENSITIES[number];

// ── OBSERVATION ─────────────────────────────────────────────────────────────

/**
 * One publicly observed piece of category creative, recorded structurally.
 *
 * NOTE WHAT IS ABSENT: there is no field for the creative's copy, no field for
 * its image or video bytes, and no field for a storage path. An observation is
 * a DESCRIPTION of a structure, so the asset itself is never needed and
 * therefore never held. That is a stronger control than a rule about how the
 * asset may be used.
 */
export interface CreativeObservation {
  id: string;
  sourceClass: CreativeSourceClass;
  /** Where it was seen. A public URL or a stable public reference. */
  sourceRef: string;
  /** Who published it, as a plain name. Never used as a style instruction. */
  publisher: string | null;
  channel: string;
  category: string;
  format: 'SHORT_VIDEO' | 'STATIC_IMAGE' | 'CAROUSEL' | 'LANDING_PAGE' | 'STORE_LISTING';
  observedAt: string;

  narrativeShape: NarrativeShape;
  hookStructure: string | null;
  firstFrame: string | null;
  productRevealSeconds: number | null;
  captionDensity: CaptionDensity;
  visualComposition: string | null;
  pacing: string | null;
  durationSeconds: number | null;
  ctaStyle: string | null;

  /**
   * A popularity figure, IF it was genuinely visible publicly.
   *
   * Named PUBLIC_ENGAGEMENT_OBSERVATION rather than anything containing
   * "performance" so that no reader, and no future function, can mistake it for
   * a measurement of effectiveness. It is what a counter said on a given day.
   */
  publicEngagement: { metric: string; value: number; observedAt: string } | null;
  /** What this observation cannot tell us. Always populated for engagement. */
  signalLimitations: string[];
  notes: string | null;
}

/** The sentence a source is allowed to contribute if engagement was recorded. */
export const ENGAGEMENT_LIMITATION_NOTES = [
  'This is a public count, not a measure of whether the creative worked.',
  'The spend, targeting and objective behind it are not visible.',
  'A popular post may have been popular for reasons unrelated to its structure.',
] as const;

// ── PATTERN ─────────────────────────────────────────────────────────────────

/**
 * An abstraction supported by several INDEPENDENT observations.
 *
 * `MIN_INDEPENDENT_SOURCES` is the rule that stops one post from becoming a
 * trend. Two observations from the same publisher are one publisher's habit;
 * the count below is of DISTINCT publishers, not of rows.
 */
export const MIN_INDEPENDENT_SOURCES = 3;

export interface CreativePattern {
  id: string;
  key: string;
  /** One sentence, abstract enough to be expressed independently. */
  description: string;
  dimension: CreativeStructureDimension;
  category: string;
  channel: string | null;
  format: string | null;
  /** Distinct publishers behind it. Never a row count. */
  independentSourceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  /** Kept SEPARATE, deliberately. See the note about composite scores above. */
  quality: CreativePatternQuality;
  /** What LaunchMind should NOT take from this pattern. */
  doNotImitate: string[];
}

/**
 * The dimensions. Never combined.
 *
 * Each is 0..1 or a labelled state, and each answers a different question. A
 * mean of them would answer none.
 */
export interface CreativePatternQuality {
  /** How well it matches the message at hand. Computed per use, not stored. */
  patternRelevance: number | null;
  categoryFit: number;
  channelFit: number;
  /** Does it survive the owner's confirmed brand? */
  brandCompatibility: 'COMPATIBLE' | 'NEEDS_ADAPTATION' | 'INCOMPATIBLE' | 'UNKNOWN';
  /** Distinct publishers, normalised. Breadth, not truth. */
  evidenceBreadth: number;
  freshness: 'CURRENT' | 'AGING' | 'STALE';
  observationConfidence: 'LOW' | 'MODERATE' | 'HIGH';
}

// ── THE EVIDENCE BOUNDARY (§17) ─────────────────────────────────────────────

/**
 * The ONLY things a creative pattern may influence.
 *
 * This list is the whole of Creative Intelligence's authority. Everything about
 * a creative EXCEPT what it asserts.
 */
export const CREATIVE_INFLUENCE_DIMENSIONS = [
  'FORMAT', 'HOOK', 'PACING', 'LAYOUT', 'MESSAGE_ORDERING',
  'REVEAL_TIMING', 'VISUAL_COMPOSITION', 'CAPTION_DENSITY',
  'CREATIVE_VARIATION', 'CTA_STYLE',
] as const;
export type CreativeInfluenceDimension = typeof CREATIVE_INFLUENCE_DIMENSIONS[number];

/**
 * Things a creative pattern may NEVER establish.
 *
 * Enumerated rather than implied. A future contributor adding a field to
 * `CreativeInfluence` has to read past this list to do it, and
 * `assertInfluenceIsStructural` will refuse them at runtime if they do.
 */
export const CREATIVE_CANNOT_SUBSTANTIATE = [
  'PRODUCT_CLAIM', 'CUSTOMER_RESULT', 'PERFORMANCE_CLAIM', 'RATING',
  'AWARD', 'TESTIMONIAL', 'MEASURED_OUTCOME', 'CUSTOMER_COUNT',
  'PRICING', 'GUARANTEE', 'CERTIFICATION', 'COMPARATIVE_SUPERIORITY',
] as const;
export type CreativeForbiddenAssertion = typeof CREATIVE_CANNOT_SUBSTANTIATE[number];

/** One pattern applied to one piece of work, with owner-safe provenance. */
export interface CreativeInfluence {
  patternKey: string;
  dimension: CreativeInfluenceDimension;
  /** What changes. Structural language only. */
  directive: string;
  /** Owner-safe sentence. No handles, no publisher list, no source URLs. */
  ownerRationale: string;
}

export class CreativeBoundaryError extends Error {
  constructor(readonly reason: string, readonly ownerMessage: string) {
    super(reason);
    this.name = 'CreativeBoundaryError';
  }
}

/**
 * Words that turn a structural directive into an assertion about the world.
 *
 * Linear patterns only — these run over model output and observation text, and
 * a backtracking one would be a denial-of-service surface.
 *
 * DELIBERATELY NOT A PROMPT INSTRUCTION. The generator is also told not to do
 * this, but telling is advisory and this is not: an influence carrying any of
 * these never reaches assembly, whatever a model intended.
 */
const ASSERTION_SHAPES: Array<{ test: RegExp; label: CreativeForbiddenAssertion }> = [
  // LINEAR. `\d+(\.\d+)?` gives the engine two ways to consume a digit run,
  // which is the classic catastrophic-backtracking shape on a non-matching
  // tail. Split into "digits, then optionally a dot and digits" with no
  // overlap. These patterns run over model and provider text, so a
  // denial-of-service surface here is a real one.
  // ALTERNATION, NOT A NESTED OPTIONAL. Every earlier shape here put a
  // quantifier inside an optional group — `\d+(\.\d+)?`, then
  // `\d(?:\.\d{1,3})?` — and the analyser kept objecting even once the
  // repetition was bounded. Two flat branches with no nesting are trivially
  // linear and need no argument about star height. It matters because these
  // run over provider and model output, which is exactly the text an attacker
  // would control.
  { test: /\d\.\d{1,3} ?%/, label: 'PERFORMANCE_CLAIM' },
  { test: /\d ?%/, label: 'PERFORMANCE_CLAIM' },
  { test: /\b(increase|improve|boost|lift|raise|reduce|cut|drop)s?\b[^.]{0,40}\b(conversion|ctr|click|install|revenue|retention|roas|cpi)\b/i, label: 'PERFORMANCE_CLAIM' },
  { test: /\b(converts?|performs?)\s+(better|worse|best)\b/i, label: 'PERFORMANCE_CLAIM' },
  { test: /\bcustomers?\s+(wait|save|spend|report|say)\b/i, label: 'CUSTOMER_RESULT' },
  // Split rather than nested: the `(of\s+)?` optional group sitting behind
  // `\s+` let the engine re-partition whitespace on every failure.
  { test: /\b(?:thousands|millions)\s+of\s+(?:users|customers|homeowners|downloads)\b/i, label: 'CUSTOMER_COUNT' },
  { test: /\d[\d,]{2,}\s+(?:of\s)?(?:users|customers|homeowners|downloads)\b/i, label: 'CUSTOMER_COUNT' },
  // `star\b` does not match "stars" — the boundary after "star" fails against
  // the following "s". Found by the test, not by reading.
  { test: /\d(?:\.\d)?\s*stars?\b/i, label: 'RATING' },
  { test: /\d(?:\.\d)?\s*\/\s*5\b/, label: 'RATING' },
  { test: /\b(award|award-winning|voted|ranked\s+#?\d)\b/i, label: 'AWARD' },
  { test: /\btestimonial/i, label: 'TESTIMONIAL' },
  { test: /\breview\s+from\s+a\s+real\s+(?:customer|user)\b/i, label: 'TESTIMONIAL' },
  { test: /\breview\s+from\s+a\s+(?:customer|user)\b/i, label: 'TESTIMONIAL' },
  { test: /\bguarantee(d|s)?\b/i, label: 'GUARANTEE' },
  { test: /\bcertified\b|\bcertification\b/i, label: 'CERTIFICATION' },
  { test: /\b(cheaper|faster|better|more effective)\s+than\b/i, label: 'COMPARATIVE_SUPERIORITY' },
  // NO \b BEFORE A CURRENCY SYMBOL. `$` is not a word character, so `\b$`
  // requires a word character immediately before it — which means "the $49"
  // never matched and only "cost$49" would have. Same defect class as above.
  { test: /(?:\$|£|€|₹)\s?\d/, label: 'PRICING' },
  { test: /\bwill\s+(convert|perform|win|outperform)\b/i, label: 'PERFORMANCE_CLAIM' },
  { test: /\b(guarantee|ensures?)\s+(virality|engagement|reach)\b/i, label: 'PERFORMANCE_CLAIM' },
];

/**
 * Refuses an influence that has stopped being structural.
 *
 * @throws {CreativeBoundaryError} when the directive or rationale asserts
 *   anything from CREATIVE_CANNOT_SUBSTANTIATE, or names a dimension outside
 *   the influence ceiling.
 * @security THE choke point for §17. Every path that turns a pattern into a
 *   creative instruction goes through here, so there is one place to audit.
 */
export function assertInfluenceIsStructural(inf: CreativeInfluence): void {
  if (!(CREATIVE_INFLUENCE_DIMENSIONS as readonly string[]).includes(inf.dimension)) {
    throw new CreativeBoundaryError(
      `dimension ${inf.dimension} is outside the creative influence ceiling`,
      'LaunchMind set that suggestion aside because it went beyond how something is presented.');
  }
  const text = `${inf.directive} ${inf.ownerRationale}`;
  for (const shape of ASSERTION_SHAPES) {
    if (shape.test.test(text)) {
      throw new CreativeBoundaryError(
        `creative influence asserted ${shape.label}: ${inf.directive}`,
        'LaunchMind set that suggestion aside because it made a claim it cannot back up.');
    }
  }
}

/** Same test, without throwing. For filtering a batch. */
export function influenceIsStructural(inf: CreativeInfluence): boolean {
  try { assertInfluenceIsStructural(inf); return true; }
  catch { return false; }
}

// ── IDENTITY ────────────────────────────────────────────────────────────────

/** Distinct-publisher key. Two pages of one company are ONE independent source. */
export function publisherIndependenceKey(publisher: string | null, sourceRef: string): string {
  if (publisher && publisher.trim()) {
    return createHash('sha256').update(publisher.trim().toLowerCase()).digest('hex').slice(0, 16);
  }
  // Fall back to the registrable host. Two URLs on one domain are one source.
  let host = '';
  try { host = new URL(sourceRef).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { host = sourceRef.toLowerCase(); }
  return createHash('sha256').update(host).digest('hex').slice(0, 16);
}

export function observationIdentity(o: {
  sourceRef: string; observedAt: string; format: string;
}): string {
  return createHash('sha256')
    .update(`${o.sourceRef}|${o.observedAt}|${o.format}`).digest('hex').slice(0, 32);
}

/** Age-based freshness. Category creative turns over quickly. */
export function creativeFreshness(lastObservedAt: string, now = new Date()): CreativePatternQuality['freshness'] {
  const ms = now.getTime() - new Date(lastObservedAt).getTime();
  const days = ms / 86_400_000;
  if (days <= 120) return 'CURRENT';
  if (days <= 365) return 'AGING';
  return 'STALE';
}
