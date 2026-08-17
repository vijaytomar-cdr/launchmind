/**
 * @file growthBrainOutputGrounding.ts
 * @description The TRUST BOUNDARY around generated Growth Brain output.
 *
 *   MEASURED DEFECT (independent review): the input side was governed, the
 *   output side was not. Grounding asked one package-wide question — "does ANY
 *   evidence exist for this business?" — and then attached the ENTIRE package
 *   provenance list to EVERY recommendation. So a single founder goal was
 *   enough to let the model publish
 *
 *       OBSERVATION: "Google Ads conversion increased 31%"
 *
 *   with "Your confirmed direction" shown underneath as its support, for a
 *   business with zero campaigns. Relabelling it INFERENCE would not have
 *   helped: the invented measurement is the problem, not the label.
 *
 *   THE CONTRACT, in one line: model output may never acquire more authority
 *   than the specific evidence it can actually cite.
 *
 *   HOW, without becoming a fact-checker:
 *     1. The SERVER issues evidence handles ("m1", "goal", "perf") from the
 *        package. The model may only CITE them; it cannot mint them.
 *     2. Unresolvable or cross-product handles are discarded on arrival.
 *     3. Each evidence category declares what class of claim it can support.
 *        A founder goal cannot support a performance measurement.
 *     4. A MEASURED claim (a number attached to a metric) must find its own
 *        quantity inside the cited evidence, or it is DROPPED — never
 *        downgraded, because "inference" must not launder an invented figure.
 *
 *   Deliberately NOT: general NL fact verification, a second model judge, a
 *   citation engine, or a scoring framework.
 *
 * @security This is the boundary between untrusted generated text and
 *   owner-visible content. Evidence handles are per-request and resolve only
 *   against the package built for THIS workspace/product, so a cross-business
 *   reference cannot resolve even if the model guesses one.
 * @dependencies evidenceSupportPolicy (reused, unmodified), contextPackageV2
 */

import type { ContextPackageV2 } from '../lib/context/contextPackageV2';
import {
  extractQuantities, distinctiveSubjectTokens, assertedValence,
} from './memory/evidenceSupportPolicy';

/** Owner-facing evidence categories. Matches the production vocabulary. */
export const EVIDENCE_KINDS = [
  'FOUNDER_DIRECTION', 'BUSINESS_GOAL', 'MARKETING_MEMORY', 'PRODUCT_CONTEXT',
  'ONBOARDING_STRATEGY', 'CAMPAIGN_PERFORMANCE', 'COMPETITOR_CONTEXT',
  'MARKET_INTELLIGENCE',
] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];

/**
 * What each category is permitted to support.
 *
 * `measured` means "can substantiate a historical/numeric performance claim".
 * Only first-party performance data and a memory that itself records a figure
 * can do that. A goal is an intention, a product profile is a description, and
 * a competitor list is context — none of them is a measurement.
 */
const CAN_SUPPORT_MEASURED: Record<EvidenceKind, boolean> = {
  CAMPAIGN_PERFORMANCE: true,
  MARKETING_MEMORY: true,      // only if the memory carries the figure — checked per claim
  MARKET_INTELLIGENCE: true,
  FOUNDER_DIRECTION: false,
  BUSINESS_GOAL: false,
  PRODUCT_CONTEXT: false,
  ONBOARDING_STRATEGY: false,
  COMPETITOR_CONTEXT: false,
};

/** One server-issued handle. `ref` is what the model is allowed to cite. */
export interface EvidenceHandle {
  ref: string;
  kind: EvidenceKind;
  /** Owner-facing label. Never an internal id. */
  label: string;
  /** Text the claim can be checked against. Not shown raw to the owner. */
  text: string;
  authority?: string | null;
  memoryClass?: string | null;
  evidenceCount?: number | null;
  detail?: string | null;
}

export interface SupportingClaimInput {
  type: 'OBSERVATION' | 'INFERENCE';
  text: string;
  /** Handles the model cited. Anything unrecognised is discarded. */
  evidenceRefs?: string[];
}

export type DropReason =
  | 'UNSUPPORTED_MEASUREMENT'
  | 'NO_RESOLVABLE_EVIDENCE'
  | 'CATEGORY_CANNOT_SUPPORT_CLAIM';

export interface GroundedClaim {
  type: 'OBSERVATION' | 'INFERENCE';
  text: string;
  /** Only the handles that RESOLVED and are admissible for this claim. */
  refs: EvidenceHandle[];
}

export interface GroundingOutcome {
  claims: GroundedClaim[];
  dropped: Array<{ text: string; reason: DropReason }>;
  downgraded: number;
}

/**
 * Issues the evidence handles for one package.
 *
 * Everything the model is permitted to cite comes from here, and nothing else
 * can resolve. Because the package is already workspace+product scoped, a
 * cross-business reference is unresolvable by construction rather than by a
 * filter that could be forgotten.
 */
export function issueEvidenceHandles(pkg: ContextPackageV2): EvidenceHandle[] {
  const out: EvidenceHandle[] = [];
  const f = pkg.founderContext;

  if (f.audienceConfirmed || f.contextDelta) {
    out.push({
      ref: 'direction', kind: 'FOUNDER_DIRECTION',
      label: 'Your confirmed direction',
      text: [f.audienceConfirmed, f.contextDelta].filter(Boolean).join(' · '),
      detail: 'You told LaunchMind this',
    });
  }
  if (f.primaryGoal) {
    out.push({
      ref: 'goal', kind: 'BUSINESS_GOAL', label: 'Your primary goal',
      text: f.primaryGoal, detail: 'You told LaunchMind this',
    });
  }
  if (f.strategyDirection) {
    out.push({
      ref: 'strategy', kind: 'ONBOARDING_STRATEGY', label: 'Your onboarding strategy',
      text: JSON.stringify(f.strategyDirection).slice(0, 400), detail: null,
    });
  }
  pkg.retrievedMemories.slice(0, 5).forEach((m, i) => {
    out.push({
      ref: `m${i + 1}`, kind: 'MARKETING_MEMORY', label: m.title,
      text: `${m.title} ${m.claim ?? ''}`,
      // Persisted tier only — a source that merely reads like founder input
      // never becomes founder authority.
      authority: m.authorityTier ?? 'UNKNOWN_LEGACY',
      memoryClass: m.memoryClass ?? null,
      evidenceCount: m.evidenceIds.length,
      detail: null,
    });
  });
  if (pkg.authoritative.productName) {
    out.push({
      ref: 'product', kind: 'PRODUCT_CONTEXT', label: 'Your product profile',
      text: [pkg.authoritative.productName, pkg.authoritative.category].filter(Boolean).join(' · '),
      detail: null,
    });
  }
  if (f.competitors.length) {
    out.push({
      ref: 'competitors', kind: 'COMPETITOR_CONTEXT',
      label: `${f.competitors.length} competitor${f.competitors.length === 1 ? '' : 's'} you confirmed`,
      text: f.competitors.map(c => c.name).join(', '), detail: null,
    });
  }
  if (pkg.operational.recentMetrics.length) {
    out.push({
      ref: 'perf', kind: 'CAMPAIGN_PERFORMANCE', label: 'Your campaign performance',
      text: pkg.operational.recentMetrics
        .map(m => `${m.channel}: ${m.installs} installs${m.cpi != null ? `, CPI ${m.cpi}` : ''} (week ${m.weekStart})`)
        .join(' · '),
      detail: `${pkg.operational.recentMetrics.length} metric week(s)`,
    });
  }
  return out;
}

/** Metric vocabulary that turns a number into a performance assertion. */
const METRIC_WORDS = [
  'conversion', 'ctr', 'click-through', 'clickthrough', 'cac', 'cpa', 'cpi', 'cpc', 'cpm',
  'roas', 'ltv', 'arpu', 'mrr', 'arr', 'revenue', 'churn', 'retention', 'bounce',
  'install', 'installs', 'signup', 'signups', 'booking', 'bookings', 'lead', 'leads',
  'impression', 'impressions', 'click', 'clicks', 'open rate', 'unsubscribe', 'spend',
];

/** Words that place a claim in the PAST — i.e. assert something happened. */
const HISTORICAL_WORDS = [
  'increased', 'decreased', 'improved', 'declined', 'dropped', 'rose', 'fell', 'grew',
  'was', 'were', 'has been', 'have been', 'went', 'moved', 'reached', 'hit',
  'last week', 'last month', 'last quarter', 'year over year', 'compared to',
  'up ', 'down ', 'from', 'to',
];

/**
 * Is this a MEASURED historical claim — a number bound to a metric?
 *
 * The distinction that matters: "conversion improved 31%" asserts a measurement
 * LaunchMind must be able to point at. "Testing outcome-led copy may improve
 * conversion" asserts nothing about the past and needs no measurement.
 */
export function isMeasuredHistoricalClaim(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  const hasQuantity = extractQuantities(t).some(q => !q.startsWith('num:') || /\d/.test(q));
  if (!hasQuantity) return false;
  const hasMetric = METRIC_WORDS.some(w => t.includes(w));
  if (!hasMetric) return false;
  // Prospective framing is not a measurement, even with a number in it.
  if (/\b(may|might|could|should|would|expect|target|aim|goal of|test|try)\b/.test(t)) return false;
  return HISTORICAL_WORDS.some(w => t.includes(w));
}

/** Do the claim's own quantities appear in the cited evidence? */
function quantitiesBackedBy(claim: string, refs: EvidenceHandle[]): boolean {
  const required = extractQuantities(claim);
  if (required.length === 0) return false;
  const available = new Set(refs.flatMap(r => extractQuantities(r.text)));
  // EVERY asserted quantity must be locatable. A claim that gets one number
  // right and invents another is still an invented measurement.
  return required.every(q => available.has(q));
}

/**
 * Grounds one recommendation's supporting claims against issued handles.
 *
 * @param claims - what the model produced, with the refs it cited
 * @param handles - the ONLY admissible evidence for this request
 * @returns surviving claims (with resolved refs), plus what was dropped and why
 */
export function groundClaims(
  claims: SupportingClaimInput[], handles: EvidenceHandle[],
): GroundingOutcome {
  const byRef = new Map(handles.map(h => [h.ref, h]));
  const out: GroundingOutcome = { claims: [], dropped: [], downgraded: 0 };

  for (const c of claims) {
    // 1. RESOLVE. A handle the server never issued does not exist — this is
    //    also what makes a cross-product reference impossible.
    const resolved = (c.evidenceRefs ?? [])
      .map(r => byRef.get(r))
      .filter((h): h is EvidenceHandle => h !== undefined);

    const measured = isMeasuredHistoricalClaim(c.text);

    // 2. MEASURED claims must find their own figures in evidence that is
    //    capable of carrying them. Dropped, never downgraded: labelling an
    //    invented measurement "inference" makes it no less invented.
    if (measured) {
      const capable = resolved.filter(h => CAN_SUPPORT_MEASURED[h.kind]);
      if (capable.length === 0) {
        out.dropped.push({ text: c.text, reason: resolved.length ? 'CATEGORY_CANNOT_SUPPORT_CLAIM' : 'UNSUPPORTED_MEASUREMENT' });
        continue;
      }
      if (!quantitiesBackedBy(c.text, capable)) {
        out.dropped.push({ text: c.text, reason: 'UNSUPPORTED_MEASUREMENT' });
        continue;
      }
      out.claims.push({ type: c.type, text: c.text, refs: capable });
      continue;
    }

    // 3. QUALITATIVE. An OBSERVATION still needs something real behind it;
    //    with nothing resolvable it becomes an INFERENCE rather than a fact.
    if (resolved.length === 0) {
      if (c.type === 'OBSERVATION') {
        out.downgraded++;
        out.claims.push({ type: 'INFERENCE', text: c.text, refs: [] });
      } else {
        out.claims.push({ type: 'INFERENCE', text: c.text, refs: [] });
      }
      continue;
    }
    out.claims.push({ type: c.type, text: c.text, refs: resolved });
  }
  return out;
}

/**
 * Deterministic founder-authority conflict check.
 *
 * Reuses the existing evidence-support primitives rather than inventing a
 * semantic engine: same distinctive subject, opposite good/bad direction. It is
 * deliberately narrow — it fires on a direct opposition and stays silent
 * otherwise, so it cannot become a blanket founder block.
 *
 * @returns the conflicting founder evidence, or null
 */
export function detectFounderConflict(
  recommendationText: string, handles: EvidenceHandle[],
): EvidenceHandle | null {
  const recSubject = distinctiveSubjectTokens(recommendationText);
  const recDir = assertedValence(recommendationText);
  if (!recSubject.size || recDir.size !== 1) return null;

  for (const h of handles) {
    const isFounderAuthority = h.kind === 'FOUNDER_DIRECTION' || h.kind === 'BUSINESS_GOAL'
      || (h.kind === 'MARKETING_MEMORY'
          && (h.authority === 'FOUNDER_ASSERTED' || h.authority === 'FOUNDER_CONFIRMED'));
    if (!isFounderAuthority) continue;

    const subj = distinctiveSubjectTokens(h.text);
    const shared = [...recSubject].filter(t => subj.has(t));
    if (!shared.length) continue;

    const dir = assertedValence(h.text);
    if (dir.size !== 1) continue;
    // Same subject, opposite direction → the recommendation opposes what the
    // founder said. Not proof of contradiction, but enough to refuse to
    // present it as established.
    if (![...dir].some(d => recDir.has(d))) return h;
  }
  return null;
}
