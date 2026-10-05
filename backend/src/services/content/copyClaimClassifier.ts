/**
 * @file copyClaimClassifier.ts
 * @description Copy-shaped factual-claim classification — the central Phase 3.5B work.
 *
 *   MEASURED DEFECT (3.5A baseline): the recommendation-era grounding detected
 *   0 of 34 copy-shaped claims. Root cause was NOT extraction —
 *   `"increases conversion by 31%"` extracts `pct:31` correctly — but
 *   CLASSIFICATION: `isMeasuredHistoricalClaim` requires a past-tense marker from
 *   HISTORICAL_WORDS. Recommendation prose is past tense ("conversion increased
 *   31% last week"); marketing copy is present or imperative. And for
 *   superlatives, exclusivity, certifications, guarantees, social proof,
 *   capability, pricing and geography there was no detector at all, because none
 *   of them carries a quantity.
 *
 *   The consequence was worse than a miss: unclassified claims fell to the
 *   qualitative branch, where any resolvable handle satisfies them — so
 *   "The best AI CMO for small teams" would publish as an OBSERVATION supported
 *   by "Your primary goal". That is the package-wide grounding defect Phase 3.3C
 *   removed, returning in a new syntactic shape.
 *
 *   THIS MODULE IS DELIBERATELY NOT A MODEL. A second unrestricted LLM grading
 *   the first one's output cannot be certified, cannot be mutation-tested, and
 *   fails differently every run. Classification here is lexical and structural:
 *   bounded, inspectable, and identical on every call.
 *
 *   IT CLASSIFIES, IT DOES NOT ADJUDICATE. Whether a claim may be used is
 *   `contentClaimPolicy`'s decision; whether it is supported is the grounding
 *   layer's. This file answers one question: what KIND of assertion is this?
 *
 * @security Fails toward detection. An ambiguous sentence is reported as a claim,
 *   because an unnecessary evidence requirement costs a regeneration while a
 *   missed one puts an unsupported factual claim in front of a customer.
 * @dependencies evidenceSupportPolicy (extractQuantities only)
 */

import { extractQuantities } from '../memory/evidenceSupportPolicy';
import { isExplicitlyDenied } from './assertionContext';

export const CLAIM_CATEGORIES = [
  'QUANTIFIED_PERFORMANCE', 'CUSTOMER_COUNT', 'SOCIAL_PROOF', 'SUPERLATIVE',
  'COMPARATIVE', 'EXCLUSIVITY', 'CAPABILITY', 'PRICING',
  'GEOGRAPHIC_AVAILABILITY', 'FIRST_PARTY_PERFORMANCE', 'COMPETITOR_CLAIM',
  'SECURITY', 'COMPLIANCE_CERTIFICATION', 'GUARANTEE', 'ENDORSEMENT',
  'SCARCITY_URGENCY', 'REGULATED_VERTICAL', 'LEGAL_APPROVAL',
  // Added in hardening pass 2. A QUALITATIVE promise of a future result —
  // "your pipeline fills while you sleep" — is substantiation-sensitive but
  // carries no metric and no number, so QUANTIFIED_PERFORMANCE cannot hold it
  // without distorting what that category means. Forcing it there was the
  // CATEGORY_GAP that let three such claims through both arms.
  'OUTCOME_PROMISE',
  'OTHER_FACTUAL_CLAIM', 'CREATIVE_NON_FACTUAL',
] as const;
export type ClaimCategory = typeof CLAIM_CATEGORIES[number];

export interface ClaimVerdict {
  /** Strongest category found. CREATIVE_NON_FACTUAL only when nothing fired. */
  category: ClaimCategory;
  /** Everything that fired, strongest first. A sentence can be several things. */
  categories: ClaimCategory[];
  /** True for anything that is not CREATIVE_NON_FACTUAL. */
  isFactualClaim: boolean;
  /** The token or phrase that triggered each category — makes it auditable. */
  signals: Array<{ category: ClaimCategory; signal: string }>;
  /** Quantities the sentence asserts, if any. */
  quantities: string[];
}

// ── Lexicons ────────────────────────────────────────────────────────────────
// Plain substrings and simple bounded patterns. No nested quantifiers: this runs
// on model output derived from untrusted listing text, and a catastrophic
// backtracking pattern here would be a denial-of-service surface.

const SUPERLATIVE = [
  'the best', 'the fastest', 'the easiest', 'the most', 'the simplest',
  'the smartest', 'the safest', 'the cheapest', 'the leading', 'the #1',
  'the number one', 'world-class', 'best-in-class', 'industry-leading',
  'unmatched', 'unbeatable', 'unrivalled', 'unrivaled', 'the top',
];

const COMPARATIVE = [
  'better than', 'faster than', 'cheaper than', 'more effective than',
  'outperforms', 'outperform', 'beats ', 'beat competitors', 'twice as',
  '2x ', '3x ', '10x ', 'half the', 'more than traditional', 'vs traditional',
  'compared to agencies', 'better results than', 'than agencies',
];

const EXCLUSIVITY = [
  'the only', 'only platform', 'only tool', 'only ai', 'nobody else',
  'no one else', 'no other', 'first and only', 'exclusively',
];

const CUSTOMER_COUNT = [
  'join thousands', 'thousands of', 'millions of', 'hundreds of',
  'teams use', 'businesses use', 'founders use', 'customers use',
  'used by', 'trusted by', 'loved by', 'chosen by', 'powering',
];

const SOCIAL_PROOF = [
  'trusted by', 'loved by', 'rated', 'reviews', 'testimonial', 'customers say',
  'founders love', 'see why', 'star rating', 'award-winning', 'award winning',
  'as seen in', 'featured in',
];

const SECURITY = [
  'encryption', 'encrypted', 'bank-grade', 'bank grade', 'military-grade',
  'never used to train', 'never shared', 'your data is safe', 'data is secure',
  'secure by default', 'zero trust', 'end-to-end',
];

const COMPLIANCE = [
  'soc 2', 'soc2', 'iso 27001', 'iso27001', 'gdpr', 'hipaa', 'ccpa', 'pci dss',
  'pci-dss', 'certified', 'certification', 'compliant', 'compliance ready',
  'audited', 'accredited',
];

const GUARANTEE = [
  'guarantee', 'guaranteed', 'money-back', 'money back', 'risk-free',
  'risk free', 'no questions asked', 'promise', 'we promise', 'or your money',
];

const ENDORSEMENT = [
  'recommended by', 'endorsed by', 'partnered with', 'official partner',
  'backed by', 'approved by',
];

const SCARCITY = [
  'spots left', 'seats left', 'limited time', 'ends friday', 'ends today',
  'offer ends', 'only ', 'act now', 'hurry', 'last chance', 'while supplies',
  'today only', 'expires',
];

const REGULATED = [
  'cure', 'treat', 'diagnose', 'fda', 'clinically proven', 'medically',
  'investment returns', 'guaranteed income', 'make money', 'earn $',
  'get rich', 'financial advice', 'loan approval', 'credit score',
];

const LEGAL_APPROVAL = [
  'legally approved', 'legal approval', 'lawyer approved', 'attorney reviewed',
  'legally compliant', 'meets all regulations',
];

const CAPABILITY = [
  'works with', 'connects to', 'integrates with', 'integration with',
  'syncs with', 'supports ', 'automatically ', 'built-in', 'built in',
  'one click', 'one-click', 'import from', 'export to', 'switch from',
];

const PRICING = [
  'free forever', 'free plan', 'free trial', 'starting at', 'starts at',
  'per month', '/month', '/mo', 'per user', 'no credit card', 'save %',
  '% off', 'discount', 'pricing', 'plans from',
];

const GEOGRAPHY = [
  'available in', 'available nationwide', 'nationwide', 'worldwide',
  'globally available', 'in the us', 'in the uk', 'across europe',
  'in india', 'available across',
];

/**
 * Possessive references to the reader's own metrics.
 *
 * NOT sufficient on its own. "See your campaign data in one place" is
 * functionality, not a performance assertion, and the bare possessive+metric
 * rule fired on it — the deterministic arm's half of the P1-32 asymmetry, and
 * the one false positive it contributed to corpus #3. An ASSERTION signal is
 * now required alongside.
 */
const FIRST_PARTY = ['your campaign', 'your conversion', 'your ctr', 'your cac',
  'your roas', 'your installs', 'your revenue', 'your rating', 'your spend'];

/**
 * Evidence that the sentence ASSERTS a result rather than offering a view of it.
 *
 * Deliberately narrow: the deterministic arm is a high-precision supplement and
 * the semantic arm carries implicit rankings and conclusions. Reduced recall
 * here is the intended trade — a false positive on functionality copy is worse
 * than a miss the semantic arm catches.
 */
const FIRST_PARTY_ASSERTION = [
  'proves', 'prove', 'tells the story', 'speak for themselves', 'says otherwise',
  'outperform', 'outperforms', 'already beat', 'is higher', 'is lower',
  'increased', 'decreased', 'improved', 'dropped', 'grew', 'fell',
  'better than', 'worse than', 'ahead of', 'behind',
];

/** Verbs that offer a VIEW of data rather than asserting a result. */
const DATA_ACCESS_VERBS = [
  'see', 'view', 'compare', 'analyze', 'analyse', 'understand', 'bring',
  'explore', 'track', 'monitor', 'review', 'measure', 'connect',
];

/** Metric vocabulary that turns a number into a performance assertion. */
const PERF_METRIC = [
  'conversion', 'ctr', 'click-through', 'cac', 'cpa', 'cpi', 'cpc', 'cpm',
  'roas', 'roi', 'ltv', 'arpu', 'mrr', 'arr', 'revenue', 'churn', 'retention',
  'bounce', 'install', 'signup', 'lead', 'booking', 'impression', 'click',
  'open rate', 'spend', 'budget', 'cost', 'results', 'growth', 'traffic',
];

/** Verbs that assert a performance CHANGE, in any tense. */
const PERF_MOVEMENT = [
  'increase', 'increases', 'increased', 'boost', 'boosts', 'boosted',
  'improve', 'improves', 'improved', 'grow', 'grows', 'grew',
  'cut', 'cuts', 'reduce', 'reduces', 'reduced', 'save', 'saves', 'saved',
  'lower', 'lowers', 'lowered', 'double', 'doubles', 'doubled',
  'lift', 'lifts', 'lifted', 'drive', 'drives', 'drove', 'stop wasting',
  // Added AFTER the held-out run failed its QUANTIFIED_PERFORMANCE zero-miss
  // gate on "Slash acquisition costs without slashing reach." The gate was NOT
  // relaxed; the lexicon was incomplete. Disclosed as post-hoc: any recall
  // figure from that corpus is no longer a clean held-out measurement.
  'slash', 'slashes', 'slashed', 'trim', 'trims', 'shrink', 'shrinks',
  'eliminate', 'eliminates', 'halve', 'halves', 'accelerate', 'accelerates',
  'maximize', 'maximise', 'minimize', 'minimise', 'recover', 'recovers',
];

/** Time-to-result promises. Factual even without a metric word. */
const TIME_PROMISE = [
  'in days', 'in hours', 'in minutes', 'in weeks', 'within days',
  'within a week', 'overnight', 'same day', 'in under',
];

/** Strongest first. A sentence is reported under its most dangerous category. */
const ORDER: ClaimCategory[] = [
  'LEGAL_APPROVAL', 'REGULATED_VERTICAL', 'COMPLIANCE_CERTIFICATION',
  'GUARANTEE', 'SECURITY', 'ENDORSEMENT', 'FIRST_PARTY_PERFORMANCE',
  'QUANTIFIED_PERFORMANCE', 'CUSTOMER_COUNT', 'SOCIAL_PROOF', 'COMPETITOR_CLAIM',
  'COMPARATIVE', 'SUPERLATIVE', 'EXCLUSIVITY', 'PRICING', 'CAPABILITY',
  'GEOGRAPHIC_AVAILABILITY', 'SCARCITY_URGENCY', 'OUTCOME_PROMISE',
  'OTHER_FACTUAL_CLAIM', 'CREATIVE_NON_FACTUAL',
];

/**
 * The first lexicon term the text ASSERTS — never one it explicitly DENIES.
 *
 * "This is not an outcome promise" contains the substring "promise" and would
 * have fired GUARANTEE before this check existed: the sentence's entire
 * purpose is to deny the claim, and firing on it punished the model for
 * hedging correctly instead of overclaiming. `isExplicitlyDenied` is the ONE
 * shared primitive for this — see assertionContext.ts — reused here exactly
 * as `productCapabilityContract.ts` reuses it for capability verbs and
 * qualifiers, so a category added to either file inherits negation-awareness
 * rather than needing its own reimplementation.
 */
function firstHit(text: string, lexicon: readonly string[]): string | null {
  for (const term of lexicon) {
    if (text.includes(term) && !isExplicitlyDenied(text, term)) return term;
  }
  return null;
}

/**
 * WORD-BOUNDARY match. Substring matching was the precision defect:
 * "growth" CONTAINS "grow", so the single bare noun in "A quieter kind of
 * growth" satisfied the metric lexicon AND the movement lexicon at once, and
 * the `movement && metric` rule fired on it. Three of four false positives on
 * fresh corpus #2 came from exactly that.
 */
function wordHit(text: string, lexicon: readonly string[]): string | null {
  for (const term of lexicon) {
    const t = term.trim();
    if (!t) continue;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Multi-word terms need boundaries only at the ends.
    if (new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, 'i').test(text)) return t;
  }
  return null;
}

/**
 * Is there a genuine comparison here — something being compared ON something?
 *
 * "Steady beats frantic" is a slogan; "Our onboarding beats Rival on conversion"
 * is a commercial comparison. A bare comparative verb alone is not a claim, so
 * it needs an entity, a metric, or a quantity alongside it.
 */
function hasComparisonContext(
  text: string, competitorNames: readonly string[], metric: string | null, hasNumber: boolean,
): boolean {
  if (metric || hasNumber) return true;
  if (competitorNames.some(n => n.trim().length > 2 && text.includes(n.trim().toLowerCase()))) return true;
  return /\b(?:than|versus|vs\.?|compared)\b/i.test(text)
      || wordHit(text, ['agency', 'agencies', 'competitor', 'competitors', 'legacy', 'alternative', 'incumbent']) !== null;
}

/**
 * Classifies one piece of marketing copy.
 *
 * @param text            the sentence or fragment as it would be shown
 * @param competitorNames names the owner confirmed, so a competitor mention is
 *                        recognised as one rather than as generic prose
 * @returns every category that fired, strongest first
 */
export function classifyCopyClaim(
  text: string, competitorNames: readonly string[] = [],
): ClaimVerdict {
  const raw = String(text ?? '');
  const t = raw.toLowerCase();
  const signals: ClaimVerdict['signals'] = [];
  const add = (category: ClaimCategory, signal: string | null) => {
    if (signal) signals.push({ category, signal });
  };

  const quantities = extractQuantities(raw).filter(q => !q.startsWith('num:') || /\d/.test(q));
  const hasNumber = quantities.length > 0 || /\b\d/.test(raw);

  add('LEGAL_APPROVAL', firstHit(t, LEGAL_APPROVAL));
  add('REGULATED_VERTICAL', firstHit(t, REGULATED));
  add('COMPLIANCE_CERTIFICATION', firstHit(t, COMPLIANCE));
  add('GUARANTEE', firstHit(t, GUARANTEE));
  add('SECURITY', firstHit(t, SECURITY));
  add('ENDORSEMENT', firstHit(t, ENDORSEMENT));

  // First-party possessive + metric is NOT enough — it must also ASSERT a
  // result, and must not be framed as an offer to display the data.
  const fp = firstHit(t, FIRST_PARTY);
  const assertion = wordHit(t, FIRST_PARTY_ASSERTION);
  const dataAccess = wordHit(t, DATA_ACCESS_VERBS);
  if (fp && (assertion || hasNumber) && !dataAccess) {
    add('FIRST_PARTY_PERFORMANCE', `${fp} + ${assertion ?? 'quantity'}`);
  }

  // Quantified performance: a number OR a movement verb, next to a metric —
  // deliberately NOT requiring past tense, which is what the old guard demanded
  // and what marketing copy never supplies.
  // WORD boundaries, and the movement token must be a DIFFERENT word from the
  // metric token — one noun cannot supply both halves of the rule.
  const metric = wordHit(t, PERF_METRIC);
  const movementRaw = wordHit(t, PERF_MOVEMENT);
  const movement = movementRaw && metric && movementRaw === metric ? null : movementRaw;

  // The deterministic arm is a HIGH-PRECISION signal detector, so it asserts a
  // QUANTIFIED claim only when a quantity is actually present. A movement verb
  // on a metric with no number is a qualitative promise, which is the semantic
  // arm's territory and OUTCOME_PROMISE's category — both REQUIRES_EVIDENCE, so
  // policy is unchanged either way.
  if (hasNumber && (metric || movement)) {
    add('QUANTIFIED_PERFORMANCE', `${movement ?? ''}${metric ? ` ${metric}` : ''}`.trim() || 'quantity+metric');
  } else if (movement && metric) {
    add('OUTCOME_PROMISE', `${movement} ${metric}`);
  }
  // "Get results in days" — a promise about outcome speed, no metric needed.
  const timePromise = firstHit(t, TIME_PROMISE);
  if (timePromise) add('OUTCOME_PROMISE', timePromise);

  const count = firstHit(t, CUSTOMER_COUNT);
  if (count) add('CUSTOMER_COUNT', count);
  add('SOCIAL_PROOF', firstHit(t, SOCIAL_PROOF));

  const competitor = competitorNames
    .map(n => n.trim().toLowerCase()).filter(Boolean)
    .find(n => n.length > 2 && t.includes(n));
  if (competitor) add('COMPETITOR_CLAIM', competitor);

  // A bare comparative verb needs something being compared.
  const comparative = firstHit(t, COMPARATIVE);
  if (comparative && hasComparisonContext(t, competitorNames, metric, hasNumber)) {
    add('COMPARATIVE', comparative);
  }
  add('SUPERLATIVE', firstHit(t, SUPERLATIVE));
  add('EXCLUSIVITY', firstHit(t, EXCLUSIVITY));
  add('PRICING', firstHit(t, PRICING));
  add('CAPABILITY', firstHit(t, CAPABILITY));
  add('GEOGRAPHIC_AVAILABILITY', firstHit(t, GEOGRAPHY));
  add('SCARCITY_URGENCY', firstHit(t, SCARCITY));

  // A bare number with no category is still an assertion about the world.
  if (signals.length === 0 && hasNumber) {
    add('OTHER_FACTUAL_CLAIM', quantities[0] ?? 'numeric assertion');
  }

  if (signals.length === 0) {
    return {
      category: 'CREATIVE_NON_FACTUAL', categories: ['CREATIVE_NON_FACTUAL'],
      isFactualClaim: false, signals: [], quantities,
    };
  }

  const found = new Set(signals.map(s => s.category));
  const categories = ORDER.filter(c => found.has(c));
  return {
    category: categories[0], categories,
    isFactualClaim: true,
    signals: signals.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)),
    quantities,
  };
}

/** Splits copy into the units a claim decision applies to. */
export function splitCopyUnits(text: string): string[] {
  return String(text ?? '')
    .split(/(?:[.!?]+\s+)|\n+|(?:\s+[·|—]\s+)/)
    .map(s => s.trim().replace(/[.!?]+$/, '').trim())
    .filter(s => s.length > 0);
}
