/**
 * @file contentOpportunityPolicy.ts
 * @description What a Content Opportunity may claim — ADR-071 §7/§8, Phase 3.5B2.
 *
 *   PURE. The model proposes; this validates. Everything a model could use to
 *   grant itself standing — an evidence handle it invented, a market trigger with
 *   no market evidence, a promise of virality — is rejected here rather than
 *   filtered somewhere downstream.
 *
 *   AN OPPORTUNITY IS A DECISION, NOT A FACT. It says what LaunchMind thinks is
 *   worth marketing and why. It is not truth, not approval, not permission, and
 *   it carries no advertising copy. Nothing here can be published.
 *
 *   THE "WHY NOW" SPLIT is the point of the whole object:
 *     EVERGREEN               a durable product or audience truth
 *     INTELLIGENCE_TRIGGERED  something changed, and eligible evidence shows it
 *   A generic product fact dressed as a current market event is the failure this
 *   separation exists to prevent — it is how an AI CMO becomes a horoscope.
 *
 * @security Model output is untrusted. Evidence refs are checked against the
 *   handles the SERVER issued for THIS request; anything else is discarded and
 *   recorded, never silently dropped.
 * @dependencies none (pure)
 */

export const OPPORTUNITY_ORIGINS = ['AI_CMO_RECOMMENDED', 'OWNER_DIRECTED'] as const;
export type OpportunityOrigin = typeof OPPORTUNITY_ORIGINS[number];

export const CONTENT_OPPORTUNITY_TYPES = [
  'PRODUCT_FEATURE', 'PRODUCT_BENEFIT', 'MARKET_MOMENT', 'COMPETITOR_GAP',
  'CUSTOMER_EDUCATION', 'SOCIAL_PROOF', 'PRODUCT_LAUNCH', 'SEASONAL',
  'REENGAGEMENT', 'THOUGHT_LEADERSHIP', 'VIRAL_GROWTH', 'OTHER',
] as const;
export type ContentOpportunityType = typeof CONTENT_OPPORTUNITY_TYPES[number];

export const WHY_NOW_KINDS = ['EVERGREEN', 'INTELLIGENCE_TRIGGERED'] as const;
export type WhyNowKind = typeof WHY_NOW_KINDS[number];

/**
 * A viral opportunity is a HYPOTHESIS about why something might spread. Each
 * question must be answered, because "make it go viral" with no mechanism is
 * the marketing equivalent of an unsupported claim.
 */
export interface ViralGrowthHypothesis {
  whyStop: string;
  whyCare: string;
  whyShare: string;
  whyProductBelongs: string;
}

export interface OpportunityCandidate {
  contentOpportunityType: ContentOpportunityType;
  title: string;
  objective: string;
  audienceHypothesis: string;
  messageAngle: string;
  whyNow: string;
  whyNowKind: WhyNowKind;
  recommendedChannels: string[];
  evidenceRefs: string[];
  viralHypothesis?: ViralGrowthHypothesis | null;
}

export type RejectionReason =
  | 'UNKNOWN_TYPE' | 'MISSING_REQUIRED_FIELD' | 'INVENTED_EVIDENCE_REF'
  | 'TRIGGER_WITHOUT_INTELLIGENCE' | 'VIRALITY_PROMISED'
  | 'VIRAL_HYPOTHESIS_INCOMPLETE' | 'UNKNOWN_CHANNEL';

export interface ValidationOutcome {
  accepted: OpportunityCandidate[];
  rejected: Array<{ reason: RejectionReason; detail: string }>;
  /** Refs the model cited that the server never issued. Recorded, not silent. */
  discardedRefs: string[];
}

/**
 * Language that promises an outcome LaunchMind cannot deliver.
 *
 * Deliberately narrow: it targets the PROMISE ("this will go viral",
 * "guaranteed to go viral"), not the topic. An opportunity may legitimately be
 * about increasing organic reach; it may not assert that reach will happen.
 */
const VIRALITY_PROMISE_PHRASES = [
  'will go viral', 'will viral', 'goes viral', 'going viral',
  'make it go viral', 'make this go viral',
  'guaranteed viral', 'viral guarantee', 'guarantee viral',
  'guaranteed organic reach', 'guaranteed reach',
  'guaranteed growth', 'guaranteed shares',
];
/** "guaranteed … viral" with up to three words between. */
const GUARANTEE_NEAR_VIRAL = /\bguarantee\w{0,3} \w{1,20} ?\w{0,20} ?\w{0,20} ?viral\b/;

/**
 * Normalises once, then matches on fixed phrases.
 *
 * REWRITTEN LINEAR after eslint flagged the first version's `(?:\w+\s+){0,3}`
 * as a ReDoS shape. This runs on MODEL OUTPUT, which is semi-hostile input, so
 * the finding was fixed rather than suppressed — the same call made for the
 * Gate A detectors in 3.2A.
 */
function normalise(text: string): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function promisesVirality(text: string): boolean {
  const t = normalise(text);
  if (VIRALITY_PROMISE_PHRASES.some(p => t.includes(p))) return true;
  return GUARANTEE_NEAR_VIRAL.test(t);
}

const REQUIRED: Array<keyof OpportunityCandidate> = [
  'title', 'objective', 'audienceHypothesis', 'messageAngle', 'whyNow',
];

/**
 * Validates model-proposed opportunities against what the server actually holds.
 *
 * @param raw            untrusted model output
 * @param issuedRefs     evidence handle refs the SERVER issued for this request
 * @param allowedChannels channels this deployment can actually create content for
 * @param intelligenceAvailable whether eligible market intelligence exists NOW
 * @security An INTELLIGENCE_TRIGGERED candidate is rejected outright when no
 *   eligible intelligence exists — not downgraded to evergreen. Downgrading
 *   would keep a claim the model made about the world and quietly relabel it.
 */
export function validateOpportunityCandidates(
  raw: unknown,
  opts: {
    issuedRefs: readonly string[];
    allowedChannels: readonly string[];
    intelligenceAvailable: boolean;
  },
): ValidationOutcome {
  const accepted: OpportunityCandidate[] = [];
  const rejected: ValidationOutcome['rejected'] = [];
  const discardedRefs: string[] = [];
  const issued = new Set(opts.issuedRefs);
  const channels = new Set(opts.allowedChannels);

  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      rejected.push({ reason: 'MISSING_REQUIRED_FIELD', detail: 'not an object' });
      continue;
    }
    const c = item as Record<string, unknown>;
    const type = String(c.contentOpportunityType ?? '').toUpperCase().replace(/[\s-]+/g, '_');
    if (!(CONTENT_OPPORTUNITY_TYPES as readonly string[]).includes(type)) {
      rejected.push({ reason: 'UNKNOWN_TYPE', detail: String(c.contentOpportunityType) });
      continue;
    }

    const cand: OpportunityCandidate = {
      contentOpportunityType: type as ContentOpportunityType,
      title: String(c.title ?? '').trim(),
      objective: String(c.objective ?? '').trim(),
      audienceHypothesis: String(c.audienceHypothesis ?? '').trim(),
      messageAngle: String(c.messageAngle ?? '').trim(),
      whyNow: String(c.whyNow ?? '').trim(),
      whyNowKind: String(c.whyNowKind ?? 'EVERGREEN').toUpperCase() === 'INTELLIGENCE_TRIGGERED'
        ? 'INTELLIGENCE_TRIGGERED' : 'EVERGREEN',
      recommendedChannels: Array.isArray(c.recommendedChannels)
        ? c.recommendedChannels.map(String) : [],
      evidenceRefs: Array.isArray(c.evidenceRefs) ? c.evidenceRefs.map(String) : [],
      viralHypothesis: (c.viralHypothesis ?? null) as ViralGrowthHypothesis | null,
    };

    const missing = REQUIRED.filter(k => !String(cand[k] ?? '').trim());
    if (missing.length) {
      rejected.push({ reason: 'MISSING_REQUIRED_FIELD', detail: missing.join(',') });
      continue;
    }

    // A model may CITE evidence. It may not MINT it.
    const kept = cand.evidenceRefs.filter(r => issued.has(r));
    for (const r of cand.evidenceRefs) if (!issued.has(r)) discardedRefs.push(r);
    cand.evidenceRefs = kept;

    if (cand.whyNowKind === 'INTELLIGENCE_TRIGGERED') {
      if (!opts.intelligenceAvailable || kept.length === 0) {
        rejected.push({
          reason: 'TRIGGER_WITHOUT_INTELLIGENCE',
          detail: cand.title.slice(0, 60),
        });
        continue;
      }
    }

    const surface = `${cand.title} ${cand.objective} ${cand.messageAngle} ${cand.whyNow}`;
    if (promisesVirality(surface)) {
      rejected.push({ reason: 'VIRALITY_PROMISED', detail: cand.title.slice(0, 60) });
      continue;
    }

    if (cand.contentOpportunityType === 'VIRAL_GROWTH') {
      const h = cand.viralHypothesis;
      const complete = !!h && ['whyStop', 'whyCare', 'whyShare', 'whyProductBelongs']
        .every(k => String((h as unknown as Record<string, unknown>)[k] ?? '').trim().length > 0);
      if (!complete) {
        rejected.push({ reason: 'VIRAL_HYPOTHESIS_INCOMPLETE', detail: cand.title.slice(0, 60) });
        continue;
      }
      if (promisesVirality(Object.values(h!).join(' '))) {
        rejected.push({ reason: 'VIRALITY_PROMISED', detail: 'hypothesis' });
        continue;
      }
    }

    const badChannel = cand.recommendedChannels.find(ch => !channels.has(ch));
    if (badChannel) {
      // Drop the channel rather than the opportunity: an unknown channel is a
      // suggestion we cannot act on, not a reason the idea is unsound.
      cand.recommendedChannels = cand.recommendedChannels.filter(ch => channels.has(ch));
      rejected.push({ reason: 'UNKNOWN_CHANNEL', detail: badChannel });
    }

    accepted.push(cand);
  }

  return { accepted, rejected, discardedRefs };
}

// ── Prioritisation ──────────────────────────────────────────────────────────

export interface PrioritisedOpportunity {
  candidate: OpportunityCandidate;
  /** Named dimensions, reported separately. There is NO single "AI score". */
  dimensions: {
    strategicRelevance: number;
    timeliness: number;
    evidenceReadiness: number;
    channelFit: number;
  };
  /** Owner-safe reasons. What a person would actually want to read. */
  reasons: string[];
  aiCmoRecommended: boolean;
}

/**
 * Ranks a small set of opportunities.
 *
 * @returns at most `limit` (default 3), ordered, each explaining itself
 * @security Dimensions are reported individually and never collapsed into one
 *   number presented as a verdict. A composite score invites "94% confident"
 *   claims that nothing measured.
 */
export function prioritiseOpportunities(
  candidates: readonly OpportunityCandidate[],
  opts: { objective?: string | null; limit?: number } = {},
): PrioritisedOpportunity[] {
  const limit = opts.limit ?? 3;
  const goal = String(opts.objective ?? '').toLowerCase();

  const scored = candidates.map(candidate => {
    const reasons: string[] = [];

    const strategicRelevance = goal && candidate.objective.toLowerCase().includes(goal.split(' ')[0])
      ? 1 : 0.6;
    if (strategicRelevance === 1) reasons.push('matches your current objective');

    const timeliness = candidate.whyNowKind === 'INTELLIGENCE_TRIGGERED' ? 1 : 0.5;
    if (timeliness === 1) reasons.push('something changed in your market');

    const evidenceReadiness = candidate.evidenceRefs.length > 0 ? 1 : 0.4;
    reasons.push(evidenceReadiness === 1
      ? 'LaunchMind holds evidence that supports this'
      : 'this would need proof you have not provided yet');

    const channelFit = candidate.recommendedChannels.length > 0 ? 1 : 0.3;
    if (channelFit < 1) reasons.push('no suitable channel is available yet');

    return {
      candidate,
      dimensions: { strategicRelevance, timeliness, evidenceReadiness, channelFit },
      reasons,
      aiCmoRecommended: false,
      _rank: strategicRelevance + timeliness + evidenceReadiness + channelFit,
    };
  });

  scored.sort((a, b) => b._rank - a._rank);
  const top = scored.slice(0, limit).map(({ _rank, ...rest }) => { void _rank; return rest; });
  if (top.length > 0) top[0].aiCmoRecommended = true;
  return top;
}
