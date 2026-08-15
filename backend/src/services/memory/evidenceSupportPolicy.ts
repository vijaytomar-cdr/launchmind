/**
 * @file evidenceSupportPolicy.ts
 * @description Does the attached evidence actually SUPPORT the claim?
 *
 *   THE MEASURED DEFECT:
 *     Gate A checked that evidence EXISTED and was VALID. It never read the
 *     evidence. So "Canva CAC decreased 22% and conversion increased 31%" was
 *     admitted on the strength of a genuine Canva press release that mentions
 *     neither figure. Existence is not support.
 *
 *   DELIBERATELY NOT AN LLM FACT-CHECKER. Gate A is the cheap deterministic
 *   admissibility stage; calling a model on every candidate would collapse the
 *   two-stage architecture and put an untrusted-text interpreter on the hot path.
 *   Everything here is string and number matching over evidence the system
 *   already holds.
 *
 *   THE RULE, in one line: a claim asserting a SPECIFIC QUANTITY must be able to
 *   point at that quantity in its evidence. A qualitative claim need only point
 *   at evidence about the same subject.
 *
 * @security Evidence text is UNTRUSTED. It is scanned for numbers and tokens and
 *   is never interpreted as instruction. Nothing here can grant authority; the
 *   strongest possible result is "this claim may proceed to Gate B".
 * @dependencies none (pure)
 */

/** How much of the claim its evidence actually backs. */
export const SUPPORT_RESULTS = ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'UNVERIFIABLE'] as const;
export type SupportResult = typeof SUPPORT_RESULTS[number];

export const CLAIM_ASSERTION_TYPES = [
  'qualitative',
  'quantitative_metric',
  'comparative',
  'temporal_change',
  'ranking',
  'quoted',
  'existence_launch',
] as const;
export type ClaimAssertionType = typeof CLAIM_ASSERTION_TYPES[number];

export interface EvidenceRecord {
  id: string;
  /** Structured facts, when the producer had them. Preferred over prose. */
  data?: Record<string, unknown> | null;
  /** Raw supporting text, when that is all there is. */
  text?: string | null;
}

export interface SupportDecision {
  result: SupportResult;
  assertionType: ClaimAssertionType;
  /** Quantities the claim asserts. */
  requiredQuantities: string[];
  /** Which of those were located in evidence. */
  matchedQuantities: string[];
  reason: string;
}

/**
 * INTERNAL / PRIVATE claim markers.
 *
 * MEASURED DEFECT (q36): "Leadership has approved a Q4 pivot to enterprise-only
 * pricing" was judged SUPPORTED because one incidental shared word ("pricing")
 * cleared the overlap threshold. A public product page cannot establish a
 * private roadmap decision no matter how much vocabulary it shares — that is a
 * question of PROVENANCE, not wording.
 *
 * Such a claim requires founder/private provenance. Public or system evidence
 * can never manufacture support for it. This grants no authority; it only
 * refuses to confirm.
 */
const INTERNAL_CLAIM_MARKERS = [
  'roadmap', 'internal', 'leadership', 'approved', 'plans to', 'planning to',
  'will launch', 'next quarter', 'internal target', 'budget will', 'we intend',
  'strategy is to', 'pivot to', 'has decided', 'board',
];

/** True when the claim asserts a private/internal decision or intention. */
export function isInternalClaim(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return INTERNAL_CLAIM_MARKERS.some(m => t.includes(m));
}

/** Metric vocabulary whose presence makes a claim quantitative in the strict sense. */
const HARD_METRIC_TOKENS = [
  'cac', 'cpi', 'cpa', 'roas', 'ltv', 'arpu', 'mrr', 'arr',
  'conversion', 'retention', 'churn', 'ctr', 'cpc', 'cpm', 'revenue',
  'rating', 'reviews', 'installs', 'impressions', 'clicks', 'sessions', 'bounce',
];

/** Words that make a claim a comparison or a change over time. */
const CHANGE_TOKENS = ['increased', 'decreased', 'dropped', 'rose', 'fell', 'grew', 'declined', 'improved', 'worsened', 'from', 'to'];
const COMPARATIVE_TOKENS = ['more than', 'less than', 'better than', 'worse than', 'outperform', 'underperform', 'higher', 'lower'];
const RANKING_TOKENS = ['rank', 'ranked', 'position', '#', 'top ', 'best', 'first', 'second'];
const LAUNCH_TOKENS = ['launch', 'launched', 'released', 'announced', 'introduced', 'acquired', 'partnered', 'unveiled'];

/**
 * Extracts every asserted quantity: percentages, currency, ratings, multipliers
 * and bare numbers. Normalized so "4.2" in a claim matches "4.20" in evidence.
 */
export function extractQuantities(text: string): string[] {
  const out = new Set<string>();
  const src = text ?? '';
  // Percentages, currency and multipliers first, so their digits are not also
  // captured as bare numbers under a different normalization.
  for (const m of src.matchAll(/(\d+(?:\.\d+)?)\s*%/g))                 out.add(`pct:${norm(m[1])}`);
  for (const m of src.matchAll(/[$£€₹]\s*(\d+(?:[.,]\d+)?)\s*([kmb]|billion|million|thousand)?/gi))
    out.add(`cur:${norm(m[1])}${m[2] ? ':' + m[2].toLowerCase()[0] : ''}`);
  for (const m of src.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\b/gi))           out.add(`mult:${norm(m[1])}`);
  for (const m of src.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:million|billion|thousand|m|bn|k)\b/gi))
    out.add(`scale:${norm(m[1])}`);
  for (const m of src.matchAll(/\b(\d+(?:\.\d+)?)\b/g))                 out.add(`num:${norm(m[1])}`);
  return [...out];
}

function norm(n: string): string {
  const v = Number(String(n).replace(/,/g, ''));
  return Number.isFinite(v) ? String(v) : String(n);
}

const has = (t: string, tokens: string[]) => tokens.some(k => t.includes(k));

/** Classifies what KIND of assertion the claim is making. */
export function classifyAssertion(claimText: string): ClaimAssertionType {
  const t = (claimText ?? '').toLowerCase();
  const quantities = extractQuantities(t);
  const hasHardMetric = has(t, HARD_METRIC_TOKENS);

  if (t.includes('"') || t.includes('“')) return 'quoted';
  if (quantities.length && hasHardMetric && has(t, CHANGE_TOKENS)) return 'temporal_change';
  if (quantities.length && hasHardMetric) return 'quantitative_metric';
  if (has(t, RANKING_TOKENS) && quantities.length) return 'ranking';
  if (has(t, COMPARATIVE_TOKENS)) return 'comparative';
  if (has(t, LAUNCH_TOKENS)) return 'existence_launch';
  return 'qualitative';
}

/** Every quantity discoverable in an evidence record, structured fields first. */
function evidenceQuantities(ev: EvidenceRecord[]): Set<string> {
  const out = new Set<string>();
  for (const e of ev) {
    // STRUCTURED FIRST. A producer that recorded rating_old/rating_new gives an
    // exact match; prose scanning is the fallback, not the primary path.
    if (e.data) {
      for (const v of Object.values(e.data)) {
        if (typeof v === 'number') extractQuantities(String(v)).forEach(q => out.add(q));
        else if (typeof v === 'string') extractQuantities(v).forEach(q => out.add(q));
      }
    }
    if (e.text) extractQuantities(e.text).forEach(q => out.add(q));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SUBJECT + OUTCOME + DIRECTION
 *
 * MEASURED P0: the qualitative branch below asked ONE question — "do these two
 * texts share vocabulary?" — and answered SUPPORTED if they did. That accepted
 * two categories of evidence it must never accept:
 *
 *   "Email open rates improved"          <- "Warehouse dispatch times improved"
 *   "Testimonial creative improves ..."  <- "Testimonial creatives recorded
 *                                           WEAKER engagement"
 *
 * The second is the serious one: evidence stating the OPPOSITE outcome counted
 * as support for the claim. Support now requires three compatible dimensions —
 * the same SUBJECT, a compatible OUTCOME, and a compatible DIRECTION — and any
 * dimension that cannot be read confidently yields a refusal, never a SUPPORTED.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tokens too generic to establish that two texts discuss the same thing.
 * "pricing" appearing in both a roadmap claim and a public pricing page says
 * nothing; §3 requires such a token not to carry subject support by itself.
 */
const GENERIC_SUBJECT_TOKENS = new Set([
  'pricing', 'price', 'campaign', 'customer', 'client', 'marketing', 'outcome',
  'product', 'user', 'business', 'growth', 'performance', 'result', 'data',
  'metric', 'number', 'team', 'company', 'strategy', 'content', 'market',
  'audience', 'channel', 'month', 'week', 'quarter', 'year', 'time', 'group',
  'test', 'variant', 'across', 'comparison', 'report', 'show', 'record', 'produc',
  'overall', 'total', 'average', 'value', 'change', 'level', 'other', 'general',
  // Function words. They match constantly and mean nothing.
  'that', 'with', 'this', 'from', 'they', 'them', 'their', 'when', 'what',
  'which', 'have', 'been', 'were', 'will', 'than', 'then', 'into', 'also',
  'such', 'only', 'very', 'does', 'each', 'both', 'some', 'most', 'many',
  'after', 'while', 'about', 'would', 'could', 'should', 'there', 'these',
  'those', 'where', 'because', 'during', 'between',
].map(stemToken));

/**
 * MOVEMENT vs VALENCE — the distinction §5 requires.
 *
 * "increase" and "fewer" describe MOVEMENT of a number; what that movement
 * MEANS depends on the metric. "improve" and "worse" already describe meaning.
 * Conflating the two made the first implementation reject
 *
 *   claim    "Email unsubscribe rates IMPROVE with preference centres"
 *   evidence "Preference-centre rollout coincided with FEWER opt-outs"
 *
 * as an opposite-direction contradiction. They agree — unsubscribes going down
 * IS the improvement. Movement is therefore converted onto the good/bad axis
 * using the polarity of the metric being measured, and only then compared.
 */
const MOVEMENT_UP = [
  'increase', 'increases', 'increased', 'increasing', 'higher', 'more',
  'greater', 'grow', 'grows', 'grew', 'growing', 'rise', 'rises', 'rose',
  'rising', 'raise', 'raises', 'raised', 'doubled', 'longer', 'faster', 'up',
];
const MOVEMENT_DOWN = [
  'decrease', 'decreases', 'decreased', 'decreasing', 'reduce', 'reduces',
  'reduced', 'reducing', 'lower', 'lowers', 'lowered', 'fewer', 'less',
  'drop', 'drops', 'dropped', 'fall', 'falls', 'fell', 'falling', 'decline',
  'declines', 'declined', 'shrink', 'shrinks', 'shrank', 'cut', 'cuts',
  'halved', 'shorter', 'slower', 'minimise', 'minimize', 'down',
];
/** Already on the good/bad axis — metric polarity must NOT be applied again. */
const VALENCE_BETTER = [
  'improve', 'improves', 'improved', 'improving', 'better', 'best', 'stronger',
  'strongest', 'outperform', 'outperforms', 'outperformed', 'ahead', 'leads',
  'leading', 'beats', 'beat', 'gain', 'gains', 'gained', 'boost', 'boosts',
  'boosted', 'lift', 'lifts', 'lifted', 'wins', 'won', 'healthier',
];
const VALENCE_WORSE = [
  'worse', 'worsen', 'worsens', 'worsened', 'weaker', 'weakest', 'underperform',
  'underperforms', 'underperformed', 'behind', 'trailed', 'trails', 'lagged',
  'lags', 'deteriorated', 'lost', 'poorer',
];

/**
 * Metrics where DOWN is the good outcome. Without this list every cost, churn
 * and abandonment metric reads backwards.
 */
const NEGATIVE_POLARITY_METRICS = [
  'cac', 'cpa', 'cpi', 'cpc', 'cpm', 'cost', 'spend', 'churn', 'attrition',
  'unsubscribe', 'unsubscribes', 'opt-out', 'opt out', 'optout', 'opt-outs',
  'cancellation', 'cancellations', 'cancel', 'no-show', 'noshow', 'no show',
  'bounce', 'abandon', 'abandoned', 'abandonment', 'refund', 'refunds',
  'complaint', 'complaints', 'failure', 'failed', 'uninstall', 'uninstalls',
  'drop-off', 'dropoff', 'missed appointment', 'missed appointments',
];

const DIRECTION_TOKENS = new Set(
  [...MOVEMENT_UP, ...MOVEMENT_DOWN, ...VALENCE_BETTER, ...VALENCE_WORSE].map(stemToken));

/** Words that invert the direction word they govern. */
const NEGATORS = new Set([
  'not', 'no', 'never', 'without', 'failed', 'fails', 'fail', 'lacked',
  'lacks', 'lack', 'neither', 'nor', 'cannot', 'didn', 'doesn', 'wasn',
  'weren', 'isn', 'aren', 'hasn', 'haven', 'couldn', 'wouldn', 'unable',
]);

/**
 * Outcome families. Two texts naming DIFFERENT known outcomes are talking about
 * different things: evidence about CTR does not support a claim about
 * conversion. Only consulted when BOTH sides name a known outcome — an
 * unrecognised outcome ("no-show rate") falls back to subject + direction
 * rather than being rejected for being outside the vocabulary.
 */
const OUTCOME_FAMILIES: Record<string, string[]> = {
  engagement: ['engagement', 'open rate', 'opens', 'click', 'clicks', 'ctr', 'clickthrough',
    'impression', 'impressions', 'session', 'sessions', 'view', 'views', 'dwell', 'bounce'],
  conversion: ['conversion', 'convert', 'signup', 'sign up', 'sign-up', 'booking', 'book',
    'purchase', 'checkout', 'subscribe', 'subscription start', 'trial', 'install', 'installs',
    'lead', 'activation', 'registration'],
  cost:       ['cac', 'cpa', 'cpi', 'cpc', 'cpm', 'spend', 'cost', 'budget'],
  revenue:    ['revenue', 'mrr', 'arr', 'arpu', 'ltv', 'sales', 'bookings value', 'aov'],
  retention:  ['retention', 'churn', 'renewal', 'repeat', 'cancel', 'cancellation', 'resubscribe'],
  attendance: ['no-show', 'no show', 'noshow', 'missed appointment', 'missed appointments',
    'attendance', 'show rate', 'cancellation rate', 'turnout'],
  // 'review' is deliberately absent: "pipeline review" and "app review" are
  // different words that happen to be spelled the same, and the collision made
  // a sales-pipeline note read as rating evidence.
  rating:     ['rating', 'ratings', 'stars', 'nps', 'satisfaction', 'csat'],
  reach:      ['reach', 'traffic', 'visitor', 'visitors', 'download', 'downloads', 'follower', 'followers'],
};

/**
 * Light suffix normalization, used ONLY as a matching aid and applied to both
 * sides so it cannot manufacture agreement.
 *
 * The naive version tried `es` before `s`, so "rates"->"rat" while "rate"
 * stayed "rate" — every singular/plural pair silently failed to match, which is
 * what drove legitimate qualitative evidence to 0.000 overlap. Order matters,
 * and the trailing-vowel step is what makes "headlines"/"headline" and
 * "features"/"feature" converge.
 */
function stemToken(w: string): string {
  let t = w;
  if (/ies$/.test(t)) t = t.replace(/ies$/, 'y');
  else if (/(sses|shes|ches|xes)$/.test(t)) t = t.replace(/es$/, '');
  else if (/[^s]s$/.test(t)) t = t.replace(/s$/, '');
  if (t.length > 5) t = t.replace(/(ing|ed)$/, '');
  if (t.length > 4) t = t.replace(/e$/, '');
  return t;
}

const tokenize = (s: string): string[] =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

const evidenceBlob = (ev: EvidenceRecord[]): string =>
  ev.map(x => `${x.text ?? ''} ${x.data ? JSON.stringify(x.data) : ''}`).join(' ');

/**
 * DISTINCTIVE subject tokens: content words that are not generic, not
 * directional, and not bare metric names. These are what must actually be
 * shared for two texts to be about the same thing.
 */
export function distinctiveSubjectTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of tokenize(text)) {
    if (raw.length <= 3) continue;
    const t = stemToken(raw);
    if (t.length <= 2) continue;
    if (GENERIC_SUBJECT_TOKENS.has(t)) continue;
    if (DIRECTION_TOKENS.has(t)) continue;
    if (HARD_METRIC_TOKENS.includes(t) || HARD_METRIC_TOKENS.includes(raw)) continue;
    out.add(t);
  }
  return out;
}

/** True when the text measures something where DOWN is the good outcome. */
export function hasNegativePolarityMetric(text: string): boolean {
  const t = ` ${(text ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')} `;
  return NEGATIVE_POLARITY_METRICS.some(m => t.includes(` ${m} `) || t.includes(`${m}s `));
}

/**
 * What the text asserts on the good/bad axis, with negation and metric polarity
 * applied. Empty = the text asserts no outcome at all.
 */
export function assertedValence(text: string): Set<'BETTER' | 'WORSE'> {
  const toks = tokenize(text);
  const out = new Set<'BETTER' | 'WORSE'>();
  const negPolarity = hasNegativePolarityMetric(text);
  const up = new Set(MOVEMENT_UP.map(stemToken));
  const down = new Set(MOVEMENT_DOWN.map(stemToken));
  const better = new Set(VALENCE_BETTER.map(stemToken));
  const worse = new Set(VALENCE_WORSE.map(stemToken));

  for (let i = 0; i < toks.length; i++) {
    const t = stemToken(toks[i]);
    let good: boolean;
    if (better.has(t)) good = true;
    else if (worse.has(t)) good = false;
    else if (up.has(t)) good = !negPolarity;    // more churn is worse; more revenue is better
    else if (down.has(t)) good = negPolarity;   // fewer no-shows is better
    else continue;
    // NEGATION: "did not improve", "no increase", "failed to reduce",
    // "was not associated with higher conversion" — scan a short window back.
    const from = Math.max(0, i - 4);
    if (toks.slice(from, i).some(w => NEGATORS.has(w.replace(/'.*$/, '')))) good = !good;
    out.add(good ? 'BETTER' : 'WORSE');
  }
  return out;
}

/** Known outcome families named by the text. Empty = none recognised. */
export function outcomeFamilies(text: string): Set<string> {
  const t = ` ${(text ?? '').toLowerCase()} `;
  const out = new Set<string>();
  for (const [family, terms] of Object.entries(OUTCOME_FAMILIES)) {
    if (terms.some(term => t.includes(term.includes(' ') || term.includes('-') ? term : ` ${term} `)
      || t.includes(` ${term}s `) || t.includes(` ${term}, `) || t.includes(` ${term}.`))) {
      out.add(family);
    }
  }
  return out;
}

/** Share of the claim's distinctive subject tokens present in the evidence. */
function subjectOverlap(claimText: string, ev: EvidenceRecord[]): number {
  const c = distinctiveSubjectTokens(claimText);
  const e = distinctiveSubjectTokens(evidenceBlob(ev));
  if (!c.size) return 0;
  let hit = 0;
  c.forEach(w => { if (e.has(w)) hit++; });
  return hit / c.size;
}

/**
 * Decides whether the evidence supports the claim.
 *
 * @param claimText - the candidate claim
 * @param evidence  - the evidence rows attached to the candidate
 * @returns a SupportDecision; the caller maps it onto a Gate A verdict
 * @security Evidence is treated as data. No instruction in evidence text can
 *   change the outcome; only numbers and word overlap are read.
 */
export function evaluateEvidenceSupport(
  claimText: string, evidence: EvidenceRecord[],
): SupportDecision {
  const assertionType = classifyAssertion(claimText);
  const required = extractQuantities(claimText).filter(q => !q.startsWith('num:') || assertionType !== 'qualitative');

  if (!evidence.length) {
    return { result: 'UNVERIFIABLE', assertionType, requiredQuantities: required, matchedQuantities: [],
      reason: 'no evidence attached; support cannot be established' };
  }

  const hasReadableEvidence = evidence.some(e => (e.text && e.text.length > 0) || (e.data && Object.keys(e.data).length > 0));
  if (!hasReadableEvidence) {
    return { result: 'UNVERIFIABLE', assertionType, requiredQuantities: required, matchedQuantities: [],
      reason: 'evidence rows carry no readable content to check the claim against' };
  }

  const overlap = subjectOverlap(claimText, evidence);

  // ── Claims that assert specific quantities must point at them ────────────
  const QUANT_TYPES: ClaimAssertionType[] = ['quantitative_metric', 'temporal_change', 'ranking'];
  if (QUANT_TYPES.includes(assertionType) && required.length) {
    const evQ = evidenceQuantities(evidence);
    const matched = required.filter(q => evQ.has(q));
    if (matched.length === 0) {
      return { result: 'UNSUPPORTED', assertionType, requiredQuantities: required, matchedQuantities: matched,
        reason: `claim asserts ${required.length} specific quantity/quantities, none of which appear in its evidence` };
    }
    if (matched.length < required.length) {
      return { result: 'PARTIALLY_SUPPORTED', assertionType, requiredQuantities: required, matchedQuantities: matched,
        reason: `${matched.length}/${required.length} asserted quantities located in evidence` };
    }
    return { result: 'SUPPORTED', assertionType, requiredQuantities: required, matchedQuantities: matched,
      reason: 'every asserted quantity is present in the supporting evidence' };
  }

  // ── Quoted material must actually appear ─────────────────────────────────
  if (assertionType === 'quoted') {
    const quoted = [...(claimText.match(/[""]([^""]{6,})[""]/g) ?? []), ...(claimText.match(/"([^"]{6,})"/g) ?? [])]
      .map(q => q.replace(/["""]/g, '').toLowerCase().trim());
    const blob = evidence.map(e => `${e.text ?? ''} ${e.data ? JSON.stringify(e.data) : ''}`).join(' ').toLowerCase();
    const found = quoted.filter(q => blob.includes(q));
    if (quoted.length && !found.length) {
      return { result: 'UNSUPPORTED', assertionType, requiredQuantities: required, matchedQuantities: [],
        reason: 'quoted text does not appear in the cited evidence' };
    }
  }

  // ── Internal / private claims need private provenance ────────────────────
  // Checked BEFORE overlap: no amount of shared vocabulary in a public document
  // can confirm an internal decision.
  if (isInternalClaim(claimText)) {
    return { result: 'UNVERIFIABLE', assertionType, requiredQuantities: required, matchedQuantities: [],
      reason: 'claim asserts an internal or private decision; public or system evidence cannot establish it' };
  }

  // ── Qualitative / launch / comparative: SUBJECT + OUTCOME + DIRECTION ────
  const no = (reason: string, result: SupportResult = 'UNSUPPORTED'): SupportDecision =>
    ({ result, assertionType, requiredQuantities: required, matchedQuantities: [], reason });

  // (1) SUBJECT. Shared vocabulary is not enough: at least one DISTINCTIVE
  //     token must be shared, so a single generic word cannot carry a claim.
  const claimSubject = distinctiveSubjectTokens(claimText);
  const evSubject = distinctiveSubjectTokens(evidenceBlob(evidence));
  const shared = [...claimSubject].filter(t => evSubject.has(t));
  if (!claimSubject.size) {
    return no('claim states no distinctive subject that evidence could be checked against', 'UNVERIFIABLE');
  }
  if (!shared.length || overlap < 0.15) {
    return no(`evidence does not discuss the claim's subject (overlap ${(overlap * 100).toFixed(0)}%, `
      + `${shared.length} distinctive term(s) shared)`);
  }

  // (2) OUTCOME. Only decisive when BOTH sides name a recognised outcome; an
  //     unrecognised outcome falls through to subject + direction rather than
  //     being rejected for sitting outside the vocabulary.
  const claimOutcome = outcomeFamilies(claimText);
  const evOutcome = outcomeFamilies(evidenceBlob(evidence));
  if (claimOutcome.size && evOutcome.size && ![...claimOutcome].some(f => evOutcome.has(f))) {
    return no(`evidence reports a different outcome (claim: ${[...claimOutcome].join('/')}; `
      + `evidence: ${[...evOutcome].join('/')})`);
  }

  // (3) DIRECTION — the load-bearing gate. A claim asserting movement needs
  //     evidence of movement THE SAME WAY. Evidence that reports the opposite,
  //     or negates the claimed effect, refutes rather than supports it.
  const claimDir = assertedValence(claimText);
  const evDir = assertedValence(evidenceBlob(evidence));
  if (claimDir.size) {
    if (!evDir.size) {
      return no('evidence establishes the subject but reports no outcome at all', 'UNVERIFIABLE');
    }
    // A text asserting BOTH directions cannot be compared confidently — e.g.
    // "Shorter onboarding failed to reduce churn" carries a subject word that
    // is also a direction word. Refuse rather than pick one.
    if (claimDir.size > 1 || evDir.size > 1) {
      return no('claim or evidence asserts more than one outcome direction; support cannot be established safely', 'UNVERIFIABLE');
    }
    if (![...claimDir].some(d => evDir.has(d))) {
      return no(`evidence reports the OPPOSITE outcome (claim: ${[...claimDir].join('/')}; `
        + `evidence: ${[...evDir].join('/')})`);
    }
  }

  return { result: 'SUPPORTED', assertionType, requiredQuantities: required, matchedQuantities: [],
    reason: `evidence shares subject (${shared.slice(0, 4).join(', ')})`
      + `${claimDir.size ? ` and the claimed outcome (${[...claimDir].join('/')})` : ''}` };
}
