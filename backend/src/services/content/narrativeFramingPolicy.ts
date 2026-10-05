/**
 * @file narrativeFramingPolicy.ts
 * @description The narrative-framing boundary — Phase 3.5B6.6 §2–§6.
 *
 *   THE PROBLEM THIS SOLVES, precisely. The claim system correctly refuses
 *   unsupported factual assertions. It was also refusing ordinary problem
 *   framing — "Calling multiple contractors can be frustrating" — because the
 *   semantic arm classifies any recognisable statement about the world as
 *   OTHER_FACTUAL_CLAIM, and no evidence LaunchMind holds mentions contractors
 *   being frustrating. The result was an AI CMO that could describe a product
 *   but could not open an advert.
 *
 *   THIS IS NOT A MARKETING EXEMPTION. An exemption would be a category that
 *   lets copy escape grounding, and the first thing anyone would do is route
 *   an inconvenient claim through it. This is the opposite shape:
 *
 *     THREE INDEPENDENT GATES, ALL OF WHICH MUST PASS
 *       1. CATEGORY   only two claim classes are even considered
 *       2. DISQUALIFY any of ~40 assertion shapes ends it immediately
 *       3. QUALIFY    it must POSITIVELY look like framing, not merely fail
 *                     to look like a claim
 *
 *   Gate 3 is the one that makes this safe. A "not obviously a claim" rule
 *   fails open — every sentence nobody wrote a detector for becomes narrative.
 *   Requiring a recognised framing SHAPE fails closed: an unrecognised sentence
 *   stays exactly as unsupported as it was.
 *
 *   WHY A NEW FILE. All seven claim files are frozen under
 *   THREE_SIGNAL_CONTRACT_HASH_V2 (1856b72c0ba0ca7a). This module wraps the
 *   frozen grounding rather than editing it — the same device by which
 *   threeSignalClaimDiscovery.ts extended the frozen V3 detector without
 *   touching it. Narrative framing is therefore ADDITIVE and reversible: delete
 *   this file and the system returns to its previous behaviour exactly.
 *
 *   WHAT IT CAN NEVER DO. Narrative framing carries `assertsMeasuredFact:false`
 *   and `evidenceRequired:false`, and there is no code path by which it becomes
 *   evidence, satisfies a product claim, or raises anything's confidence. It
 *   changes whether a SENTENCE may be written. It changes nothing about what is
 *   true.
 *
 * @security Deterministic and model-free. Every pattern is linear — these run
 *   over model output, so a backtracking one would be a denial-of-service
 *   surface. Fails closed at every gate.
 * @dependencies copyClaimClassifier (types only), threeSignalClaimDiscovery (types only)
 */

import type { ClaimCategory } from './copyClaimClassifier';
import type { GroundedClaimResult, GroundingOutcome } from './threeSignalClaimDiscovery';

/** How a line is allowed to exist without evidence. */
export const NARRATIVE_SOURCE_TYPE = 'NARRATIVE_FRAMING' as const;

/**
 * The ONLY claim classes narrative framing may rescue.
 *
 * Deliberately two. CAPABILITY is absent because a capability is a statement
 * about the product and must ground against the product's own description —
 * which, since the previous pass, it can. Every quantified, comparative,
 * social-proof, superlative, pricing, guarantee, scarcity, endorsement and
 * first-party class is absent because no framing wrapper makes those anything
 * other than assertions about the world.
 */
export const NARRATIVE_ELIGIBLE_CATEGORIES: readonly ClaimCategory[] = [
  'OTHER_FACTUAL_CLAIM', 'OUTCOME_PROMISE',
];

/** Number words that count things, where a digit would be equally disqualifying. */
const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|dozens|' +
  'twenty|thirty|fifty|hundred|hundreds|thousand|thousands|million|millions|' +
  'half|twice|double|triple|couple';

/**
 * Units that turn a number into a claim about behaviour, time, people or money.
 *
 * THE REASON THIS LIST EXISTS rather than "block every number": "start your
 * search from one place" and "one app" are idiom, while "five phone calls" and
 * "three days" are quantified assertions about what customers do. The
 * difference is not the number — it is what the number counts. A bare digit is
 * always refused; a number WORD is refused when it counts one of these.
 */
const COUNTED_UNITS =
  'call|calls|phone calls|contractor|contractors|provider|providers|pro|pros|' +
  'homeowner|homeowners|customer|customers|user|users|client|clients|people|' +
  'day|days|hour|hours|minute|minutes|week|weeks|month|months|second|seconds|' +
  'time|times|quote|quotes|estimate|estimates|dollar|dollars|percent|' +
  'response|responses|booking|bookings|job|jobs|project|projects';

/**
 * Every shape that ends narrative eligibility immediately.
 *
 * Each carries the §3 heading it enforces so the mapping from the contract to
 * the code is checkable by reading rather than by trust.
 */
const DISQUALIFIERS: Array<{ test: RegExp; reason: string }> = [
  // §3 NUMBERS — a digit is never framing.
  { test: /\d/, reason: 'it states a number' },
  { test: new RegExp(`\\b(?:${NUMBER_WORDS})\\s+(?:of\\s+)?(?:${COUNTED_UNITS})\\b`, 'i'),
    reason: 'it counts something it cannot measure' },
  { test: new RegExp(`\\b(?:${NUMBER_WORDS})\\s+\\w+\\s+(?:${COUNTED_UNITS})\\b`, 'i'),
    reason: 'it counts something it cannot measure' },

  // §3 TIME CLAIMS — a duration is a measurement.
  { test: /\bin (?:a few |just |under |less than )?(?:seconds|minutes|hours|days|weeks)\b/i,
    reason: 'it promises a timeframe' },
  { test: /\b(?:takes?|waiting|waits?|wait|spend|spends?|spent|waste|wastes?|wasted|saves?|saved)\b[^.?!]{0,24}\b(?:seconds|minutes|hours|days|weeks|months)\b/i,
    reason: 'it states how long something takes' },
  { test: /\b(?:instantly|immediately|same[- ]day|overnight|right away|within the hour)\b/i,
    reason: 'it promises a timeframe' },

  // §3 PREVALENCE — how common something is, is a measurement.
  { test: /\b(?:most|majority|everyone|everybody|nobody|no one|all|usually|typically|often|commonly|frequently|rarely|seldom|many|few|countless|plenty of)\b/i,
    reason: 'it says how common something is' },
  // ALWAYS / NEVER, EXCEPT WHEN HEDGED. These are absolutes and belong above,
  // but "a callback that MAY never come" is not an absolute — the modal is the
  // whole difference between describing a worry and reporting a fact. Keeping
  // them in the flat list refused a legitimate second-person question, which is
  // exactly the over-refusal this phase exists to fix. A population making the
  // same statement is still caught by the prevalence and population rules.
  { test: /(?<!\b(?:may|might|could|can|sometimes)\s)\b(?:always|never)\b/i,
    reason: 'it states an absolute' },

  // §3 CUSTOMER EXPERIENCE — a statement about actual customers.
  { test: /\b(?:our|their)\s+(?:customers?|clients?|users?|homeowners?)\b/i,
    reason: 'it describes real customers' },
  { test: /\b(?:customers?|clients?|users?|homeowners?|people)\s+(?:say|said|report|reported|tell|told|love|hate|prefer|choose|switch|switched|trust|rate)\b/i,
    reason: 'it describes what customers do or think' },

  // §3 TESTIMONIAL SHAPES — a voice with no speaker.
  { test: /(^|[.?!]\s)\s*(?:i|we)\s+(?:found|got|used|tried|switched|love|loved|finally)\b/i,
    reason: 'it speaks as a customer' },
  { test: /\bfinally,?\s+(?:i|we|someone|a)\b/i, reason: 'it speaks as a customer' },

  // §3 PRODUCT OUTCOMES — what the product will produce for the reader.
  { test: /\b(?:gets?|get|helps?|makes?|lets?|allows?|enables?|ensures?|delivers?|guarantees?|eliminates?|removes?|ends?|stops?|solves?|fixes?|cuts?|reduces?|speeds?|books?)\s+(?:you|your|it|them|the)\b[^.?!]{0,40}\b(?:faster|quicker|sooner|easier|instantly|booked|done|solved|scheduled|hired|matched|responses?)\b/i,
    reason: 'it promises a result' },
  { test: /\b(?:never|no more)\b[^.?!]{0,30}\b(?:again|another)\b/i,
    reason: 'it promises a result' },
  { test: /\bget\s+(?:booked|matched|hired|scheduled|connected)\b/i, reason: 'it promises a result' },

  // §3 COMPARATIVE.
  { test: /\b(?:easier|faster|quicker|cheaper|simpler|better|smarter|more \w+)\s+than\b/i,
    reason: 'it compares itself to something else' },
  { test: /\b(?:vs\.?|versus|compared to|unlike)\b/i, reason: 'it compares itself to something else' },
  { test: /\b(?:as many|as much|as fast|as easy)\b/i, reason: 'it compares itself to something else' },

  // §3 PERFORMANCE.
  { test: /\b(?:conversion|click[- ]through|ctr|roi|roas|response rate|success rate|win rate)\b/i,
    reason: 'it states a performance figure' },
  // PROPORTIONAL REDUCTION WITHOUT A DIGIT. "Feel your search time cut in half"
  // states a measured halving while containing no number my earlier patterns
  // could see — "half" only disqualified when it counted a listed unit, and
  // here it counts nothing. Found by the adversarial test, not by reading.
  { test: /\b(?:in|by)\s+(?:half|a\s+(?:third|quarter|fraction))\b/i,
    reason: 'it states how much something is reduced' },
  { test: /\ba\s+fraction\s+of\s+the\s+time\b/i,
    reason: 'it states how much something is reduced' },
  // A quantity NOUN being acted on is a measurement even with no figure:
  // "cut your search time", "reduce the wait", "save you effort".
  { test: /\b(?:cut|cuts|reduce|reduces|slash|slashes|shrink|shrinks|halve|halves|save|saves)\b[^.?!]{0,24}\b(?:time|wait|waiting|effort|hassle|cost|costs)\b/i,
    reason: 'it claims to reduce something it has not measured' },

  // §3 SOCIAL PROOF.
  { test: /\b(?:trusted by|rated|reviews?|reviewed|recommended by|voted|award|award[- ]winning|testimonial|five[- ]star)\b/i,
    reason: 'it claims other people endorse it' },

  // §3 SUPERLATIVES.
  // FLAT, NOT NESTED. `(?:the\s+)?` in front of an alternation gave the engine
  // two ways to consume the same whitespace on a non-matching tail. The
  // optional prefix bought nothing — the words are disqualifying wherever they
  // appear — so it is simply gone. These patterns run over model output, so an
  // exponential shape here is a real denial-of-service surface.
  { test: /\b(?:best|easiest|fastest|simplest|cheapest|greatest|leading|top[- ]rated|only)\b/i,
    reason: 'it claims to be the best or the only one' },
  { test: /\bnumber one\b|#\s?1\b/i, reason: 'it claims to be the best or the only one' },

  // §3 SCARCITY / URGENCY.
  { test: /\b(?:filling up|running out|limited (?:time|spots?|availability)|act now|hurry|don'?t miss|last chance|while (?:they|supplies) last|book now|today only|available now)\b/i,
    reason: 'it manufactures urgency' },

  // §3 GUARANTEES.
  { test: /\b(?:guarantee|guaranteed|promise|promised|we'?ll ensure|risk[- ]free|no[- ]risk)\b/i,
    reason: 'it makes a guarantee' },
  // An imperative closing with a time commitment IS a guarantee — "Find
  // someone today" promises an outcome inside a window nobody has measured.
  { test: /^(?:find|get|book|hire|schedule|connect with)\b[^.?!]{0,40}\b(?:today|tonight|now|this week)\b/i,
    reason: 'it makes a guarantee' },

  // A POPULATION MAKING AN INDICATIVE ASSERTION is a prevalence claim even
  // with no quantifier attached: "Contractors disappear" and "Homeowners waste
  // hours" say something measurable about a group. Framing describes a
  // situation the READER may recognise; it does not report on a population.
  { test: /^(?:homeowners?|contractors?|providers?|customers?|clients?|users?|people|everyone|professionals?)\b[^.?!]{0,50}\b(?:are|is|do|does|don'?t|doesn'?t|will|won'?t|have|has|wait|waits|waste|wastes|disappear|disappears|struggle|struggles|hate|hates|love|loves|prefer|prefers|never|always)\b/i,
    reason: 'it states what a group of people does' },
];

/**
 * Shapes that POSITIVELY mark a line as framing rather than assertion.
 *
 * At least one must match. This is the fail-closed half of the contract: a
 * sentence that merely dodged every disqualifier is not thereby narrative, it
 * is simply a sentence nobody has written a detector for yet.
 */
const QUALIFIERS: Array<{ test: RegExp; kind: string }> = [
  // A question posed to the reader about their own situation.
  { test: /\?\s*$/, kind: 'a question put to the reader' },
  // Hypothetical / invitation to picture something.
  { test: /\b(?:imagine|picture|suppose|what if|think about|consider)\b/i, kind: 'a hypothetical' },
  // Normative framing — how things OUGHT to be, which asserts nothing measured.
  // BOTH NUMBERS OF THE VERB. The first draft matched "doesn't have to" and
  // not "don't have to", so an identical normative framing was rescued or
  // refused depending on whether its subject happened to be plural — which is
  // grammar, not governance.
  { test: /\b(?:shouldn'?t|should not|does\s?n'?t have to|do\s?n'?t have to|does not have to|do not have to|needn'?t|no need to|ought to|should be)\b/i,
    kind: 'a statement about how things should be' },
  // Hedged generality — explicitly not a report of fact.
  { test: /\b(?:can be|could be|may feel|might feel|can feel|often feels|tends to feel|is meant to|is supposed to)\b/i,
    kind: 'a hedged description of a situation' },
  // NO BARE SECOND PERSON. An earlier draft qualified any line containing
  // "you" or "your", which is nearly every line of marketing ever written —
  // and an existing test caught what that costs: "Your funnel, unclogged" was
  // rescued as framing when it is an outcome promise wearing a pronoun. The
  // other four qualifiers are self-limiting (a question asks, a hypothetical
  // supposes, a normative says ought, a hedge withholds); second person on its
  // own commits to nothing and therefore excludes nothing.
  //
  // Second-person lines still qualify readily — through the question,
  // hypothetical, normative or hedge they almost always carry. Every §5 SAFE
  // example passes without this rule.
];

export interface NarrativeVerdict {
  eligible: boolean;
  /** Why it qualified. Internal audit; the owner sees a plain sentence. */
  qualifiedBy: string | null;
  /** Why it did not. Owner-safe phrasing. */
  refusedBecause: string | null;
}

/**
 * Is this text narrative framing?
 *
 * @param text     the exact span the claim system flagged
 * @param category the claim class it was given
 * @security All three gates must pass. Order is deliberate: category first, so
 *   an ineligible class never even reaches the text patterns.
 */
export function classifyNarrativeFraming(
  text: string, category: ClaimCategory,
): NarrativeVerdict {
  if (!NARRATIVE_ELIGIBLE_CATEGORIES.includes(category)) {
    return { eligible: false, qualifiedBy: null,
      refusedBecause: 'it makes a claim that needs evidence' };
  }
  const t = String(text ?? '');
  for (const d of DISQUALIFIERS) {
    if (d.test.test(t)) {
      return { eligible: false, qualifiedBy: null, refusedBecause: d.reason };
    }
  }
  for (const q of QUALIFIERS) {
    if (q.test.test(t)) return { eligible: true, qualifiedBy: q.kind, refusedBecause: null };
  }
  // FAILS CLOSED. Not obviously a claim is not the same as recognisably framing.
  return { eligible: false, qualifiedBy: null,
    refusedBecause: 'it reads as a statement of fact rather than a way of describing the situation' };
}

/** One line permitted as framing, with the provenance that must travel with it. */
export interface NarrativeLine {
  field: string;
  textSpan: string;
  sourceType: typeof NARRATIVE_SOURCE_TYPE;
  evidenceRequired: false;
  assertsMeasuredFact: false;
  qualifiedBy: string;
  /** Owner-safe. §6 — no enum, no internal id. */
  ownerNote: string;
}

/**
 * Claim shapes for which TOKEN OVERLAP alone is not grounding — §7.
 *
 * THE MEASURED DEFECT. The frozen `substantiates()` accepts a claim when its
 * distinctive tokens overlap the evidence text. That is right for a capability
 * — "connects with professionals" against a description saying exactly that.
 * It is wrong for a statement about what PEOPLE DO: "Still calling around
 * trying to find someone for your home project?" was marked SUPPORTED because
 * the product description contains "home", and one shared noun is not evidence
 * that anyone calls around.
 *
 * The consequence was not a bad advert — narrative framing would have permitted
 * that line anyway — it was a DISHONEST PROVENANCE. The artifact recorded
 * "supported by your product profile" for a sentence the product profile says
 * nothing about, and an audit months later would have believed it.
 *
 * `substantiates()` is inside the frozen contract and cannot be changed, so
 * this is a post-check on its RESULT, applied ONLY to the shapes where overlap
 * is insufficient. Every other SUPPORTED verdict is left exactly as the frozen
 * layer decided it — a blanket distrust would be a second, unmeasured grounding
 * system.
 */
const OVERLAP_INSUFFICIENT: Array<{ test: RegExp; kind: string }> = [
  // What people do, feel or experience.
  { test: /\b(?:calling|call|called|waiting|wait|waited|chasing|chase|hunting|searching around|ringing)\b/i,
    kind: 'customer behaviour' },
  { test: /\b(?:frustrat|annoy|exhaust|tiring|tired|hassle|headache|nightmare|struggle|painful)/i,
    kind: 'a description of how people feel' },
  { test: /\b(?:homeowners?|contractors?|providers?|customers?|clients?|users?|people)\b/i,
    kind: 'a statement about a group of people' },
  // Rhetorical address about a situation rather than about the product.
  { test: /\?\s*$/, kind: 'a question about the reader’s situation' },
  { test: /\b(?:still|another|again|yet another)\b/i, kind: 'a description of a recurring situation' },
];

/**
 * Categories on which the post-check runs.
 *
 * OTHER_FACTUAL_CLAIM only. It is the catch-all the semantic arm assigns when
 * nothing more specific fits, so it is where behaviour statements land — and
 * it is the one category whose SUPPORTED verdicts are routinely the product of
 * a single shared noun. CAPABILITY is deliberately excluded: overlap against
 * the product description is exactly the right test for a capability, and
 * weakening it would undo the fix that made product claims groundable at all.
 */
const POST_CHECK_CATEGORIES: readonly string[] = ['OTHER_FACTUAL_CLAIM'];

export interface OverlapVerdict {
  /** True when overlap alone cannot have established this. */
  insufficient: boolean;
  kind: string | null;
}

/**
 * Was this SUPPORTED verdict really earned, or is it token overlap?
 *
 * @security Can only ever make a verdict STRICTER. There is no branch that
 *   turns UNSUPPORTED into SUPPORTED.
 */
export function overlapIsInsufficient(
  textSpan: string, category: string, support: readonly string[],
): OverlapVerdict {
  if (!POST_CHECK_CATEGORIES.includes(category)) return { insufficient: false, kind: null };
  // Only when the support is the PRODUCT PROFILE. Campaign performance or
  // marketing memory backing a behaviour statement is real evidence and is
  // left alone.
  const productOnly = support.length > 0
    && support.every(sp => /product profile|product context/i.test(sp));
  if (!productOnly) return { insufficient: false, kind: null };
  for (const s of OVERLAP_INSUFFICIENT) {
    if (s.test.test(String(textSpan))) return { insufficient: true, kind: s.kind };
  }
  return { insufficient: false, kind: null };
}

export interface NarrativeAdjudication {
  /** Claims that remain genuinely unsupported. */
  stillUnsupported: GroundedClaimResult[];
  /** Claims permitted as framing, with provenance. */
  narrative: NarrativeLine[];
  /** Spans refused framing, and why. Feeds the rewrite note. */
  refused: Array<{ textSpan: string; reason: string }>;
}

export const NARRATIVE_OWNER_NOTE =
  'Problem-framing language — not presented as a measured customer result.';

/**
 * Adjudicates a grounding outcome.
 *
 * SPAN-LEVEL, NOT CLAIM-LEVEL, and this is load-bearing. One sentence can be
 * classified several times — "Thousands of homeowners trust AllignX" fires as
 * CUSTOMER_COUNT and as OTHER_FACTUAL_CLAIM. Adjudicating each claim alone
 * would let the second one grant narrative relief to a sentence the first one
 * correctly refused, and the sentence would ship. So a span is rescued only
 * when EVERY unsupported claim on it is independently eligible.
 *
 * @security Only UNSUPPORTED results are considered. PROHIBITED and
 *   NEEDS_OWNER_CONFIRMATION are untouched and unreachable from here — a
 *   prohibited claim class cannot be reframed into acceptability, and an owner
 *   decision cannot be made on the owner's behalf by a regex.
 */
export function adjudicateNarrativeFraming(
  grounding: GroundingOutcome,
): NarrativeAdjudication {
  // §7 — a SUPPORTED verdict that rests only on token overlap with the product
  // profile, for a claim about behaviour or feeling, is treated as unsupported
  // BEFORE framing is considered. It then either qualifies as framing (and is
  // recorded honestly as framing) or stays unsupported. What it must not do is
  // remain recorded as "supported by your product profile".
  const downgraded = grounding.results.filter(r =>
    r.verdict === 'SUPPORTED'
    && overlapIsInsufficient(r.claim.textSpan, r.claim.category, r.support).insufficient);
  const unsupported = [
    ...grounding.results.filter(r => r.verdict === 'UNSUPPORTED'),
    ...downgraded.map(r => ({ ...r, verdict: 'UNSUPPORTED' as const, support: [] })),
  ];
  const bySpan = new Map<string, GroundedClaimResult[]>();
  for (const r of unsupported) {
    const k = `${r.claim.field}::${r.claim.textSpan.toLowerCase().trim()}`;
    bySpan.set(k, [...(bySpan.get(k) ?? []), r]);
  }

  const stillUnsupported: GroundedClaimResult[] = [];
  const narrative: NarrativeLine[] = [];
  const refused: Array<{ textSpan: string; reason: string }> = [];

  for (const group of bySpan.values()) {
    const verdicts = group.map(r => ({
      r, v: classifyNarrativeFraming(r.claim.textSpan, r.claim.category),
    }));
    const allEligible = verdicts.every(x => x.v.eligible);
    if (allEligible) {
      const first = verdicts[0];
      narrative.push({
        field: first.r.claim.field,
        textSpan: first.r.claim.textSpan,
        sourceType: NARRATIVE_SOURCE_TYPE,
        evidenceRequired: false,
        assertsMeasuredFact: false,
        qualifiedBy: first.v.qualifiedBy ?? 'framing',
        ownerNote: NARRATIVE_OWNER_NOTE,
      });
      continue;
    }
    stillUnsupported.push(...group);
    const why = verdicts.find(x => !x.v.eligible)?.v.refusedBecause;
    if (why) refused.push({ textSpan: group[0].claim.textSpan, reason: why });
  }

  return { stillUnsupported, narrative, refused };
}
