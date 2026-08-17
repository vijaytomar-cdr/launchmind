/**
 * @file growthBrainRecommendationService.ts
 * @description Phase 3.3C — 1–3 grounded, owner-facing Growth Brain recommendations.
 *
 *   WHAT THIS IS NOT: a second context pipeline. It consumes the existing
 *   governed ContextPackageV2 (Phase 3.1E) — which already carries
 *   product-scoped Marketing Memory with persisted authority, founder-confirmed
 *   direction, competitors and campaign state — and adds only the owner-facing
 *   shaping the product was missing.
 *
 *   THE DIVISION OF LABOUR, which is the whole safety argument:
 *     · The MODEL writes prose — what to do, why now, the next step.
 *     · The SERVICE decides everything a reader would take as fact: which
 *       sources exist, how strong the evidence is, whether an item may be
 *       called an OBSERVATION, and whether approval is required.
 *
 *   So provenance is never something the model asserts. It is computed from the
 *   package that was actually built. A model that invents "based on your Google
 *   Ads data" cannot make that source appear, and an item it labels OBSERVATION
 *   is downgraded to INFERENCE unless a real data category backs it.
 *
 * @security Business-scoped through the SAME active-business resolution as the
 *   rest of Growth Brain (workspaceId + productId). Founder authority is read
 *   from the persisted tier and never reconstructed from a source name.
 * @dependencies contextPackageV2 (governed retrieval), aiPlatform
 */

import { buildContextPackageV2, type ContextPackageV2 } from '../lib/context/contextPackageV2';
import { formatContextPackageForModel } from '../lib/context/contextFormatter';
import { callSonnet } from '../lib/aiPlatform';
import {
  issueEvidenceHandles, groundClaims, detectFounderConflict,
  type EvidenceHandle,
} from './growthBrainOutputGrounding';
import { z } from 'zod';

/** What kind of statement this is. Never inferred from wording. */
export const INFO_TYPES = ['OBSERVATION', 'INFERENCE', 'RECOMMENDATION'] as const;
export type InfoType = typeof INFO_TYPES[number];

/**
 * Qualitative evidence state. Deliberately NOT a number: nothing here measures
 * probability, and a decimal would imply a precision that does not exist.
 */
export const EVIDENCE_STRENGTHS = [
  'strong evidence', 'some evidence', 'limited evidence', 'insufficient evidence',
] as const;
export type EvidenceStrength = typeof EVIDENCE_STRENGTHS[number];

/** Owner-facing source kinds. Internal ids are deliberately absent. */
export const PROVENANCE_KINDS = [
  'FOUNDER_DIRECTION', 'MARKETING_MEMORY', 'PRODUCT_CONTEXT',
  'ONBOARDING_STRATEGY', 'CAMPAIGN_PERFORMANCE', 'COMPETITOR_CONTEXT',
  'MARKET_INTELLIGENCE',
] as const;
export type ProvenanceKind = typeof PROVENANCE_KINDS[number];

export interface ProvenanceItem {
  kind: ProvenanceKind;
  /** Plain-English label. Governance translated, not exposed raw. */
  label: string;
  /** Persisted governed tier, or UNKNOWN_LEGACY. Memory only. */
  authority?: string | null;
  memoryClass?: string | null;
  evidenceCount?: number | null;
  detail?: string | null;
}

export interface SupportingItem {
  type: Extract<InfoType, 'OBSERVATION' | 'INFERENCE'>;
  text: string;
}

/**
 * A claim the grounding boundary removed.
 *
 * Deliberately carries NO text. Shipping the fabricated sentence in the API
 * response would put it one careless `.map()` away from the owner's screen,
 * which defeats the point of removing it. The reason is what a diagnostic
 * needs; the text is already in the audit trail behind the model call.
 */
export interface WithheldClaim { reason: string }

export interface GrowthBrainRecommendation {
  type: 'RECOMMENDATION';
  /** Server-issued identity, attached once persisted (Phase 3.3D). */
  id?: string;
  /** Validated action class. The approval policy is derived from THIS. */
  actionType: ActionType;
  /** Server-validated substantive intent. Drives settled-action equivalence. */
  ownerActionIntent?: OwnerActionIntent;
  /** Server-validated decision object inside that intent. */
  actionTarget?: ActionTarget;
  decisionStatus?: string;
  executionStatus?: string;
  what: string;
  whyNow: string;
  /**
   * ONLY the evidence this recommendation actually cited and that resolved.
   * Previously the whole package list was attached to every recommendation, so
   * "Your primary goal" appeared as support for an invented Google Ads figure.
   */
  supportedBy: ProvenanceItem[];
  supporting: SupportingItem[];
  /**
   * Set when the recommendation opposes founder-authority direction. Never
   * silently endorsed: it is surfaced, flagged for review, and never presented
   * as established guidance.
   */
  founderConflict: { withDirection: string } | null;
  requiresFounderReview: boolean;
  expectedEffect: string | null;
  nextStep: string;
  requiresApproval: boolean;
  evidenceStrength: EvidenceStrength;
  /**
   * ALWAYS null pre-launch. Nothing in the pipeline measures a probability, and
   * a model-stated percentage rendered beside real data reads as measurement.
   * The honest signal is `evidenceStrength`, which is derived from inputs that
   * genuinely exist.
   */
  confidence: null;
}

export interface GrowthBrainRecommendations {
  recommendations: GrowthBrainRecommendation[];
  /** What Growth Brain could not see. Rendered, not swallowed. */
  unavailable: string[];
  marketIntelligenceAvailable: boolean;
  /** Set when no recommendation could be grounded at all. */
  reason: string | null;
  /** Unsupported claims the grounding boundary removed. Not owner-facing text. */
  withheld: WithheldClaim[];
}

/** Actions the model may propose, mapped to approval by LaunchMind's rules. */
export const ACTION_TYPES = [
  'REVIEW_CONTEXT', 'RESEARCH', 'DRAFT_CONTENT',
  'RUN_EXPERIMENT', 'LAUNCH_CAMPAIGN', 'CHANGE_SPEND',
] as const;

/**
 * OWNER ACTION FAMILIES — what decision the owner is actually making.
 *
 * MEASURED P0: the production model does not hold `actionType` stable for the
 * same action. It labelled "Define your Ideal Customer Profile before any
 * marketing activity begins" as RESEARCH on one pass and REVIEW_CONTEXT on the
 * next. With the raw type in the equivalence key, an already-approved action
 * came back as outstanding. That variance is classification noise, not a new
 * decision for the owner to make.
 *
 * The family answers "what am I agreeing to?", not "how did the model label
 * it?". The raw `action_type` is still persisted verbatim in the immutable
 * snapshot for audit; only EQUIVALENCE uses the family.
 *
 * WHY EACH MAPPING:
 *   RESEARCH + REVIEW_CONTEXT → ANALYZE_CONTEXT
 *     Both ask the owner to look at something and understand it better. The
 *     owner's decision — "yes, go and work this out" — is identical, and the
 *     two are exactly what the model interchanges.
 *   DRAFT_CONTENT → CREATE_DRAFT
 *     Deliberately NOT merged with ANALYZE_CONTEXT. Producing a marketing
 *     artefact is a different ask from studying the business, even though
 *     neither needs approval today. Grouping by approval alone would erase
 *     that, which §1 forbids.
 *   RUN_EXPERIMENT / LAUNCH_CAMPAIGN / CHANGE_SPEND → their own families
 *     Each commits the business differently — an experiment, a public launch,
 *     money. None may ever absorb another.
 */
export const OWNER_ACTION_FAMILIES = [
  'ANALYZE_CONTEXT', 'CREATE_DRAFT', 'RUN_EXPERIMENT', 'LAUNCH_CAMPAIGN', 'CHANGE_SPEND',
] as const;
export type OwnerActionFamily = typeof OWNER_ACTION_FAMILIES[number];

export const ACTION_TYPE_FAMILY: Record<ActionType, OwnerActionFamily> = {
  RESEARCH:        'ANALYZE_CONTEXT',
  REVIEW_CONTEXT:  'ANALYZE_CONTEXT',
  DRAFT_CONTENT:   'CREATE_DRAFT',
  RUN_EXPERIMENT:  'RUN_EXPERIMENT',
  LAUNCH_CAMPAIGN: 'LAUNCH_CAMPAIGN',
  CHANGE_SPEND:    'CHANGE_SPEND',
};

/**
 * Approval consequence per family.
 *
 * A family may never contain action types with differing approval
 * consequences — that would let a no-approval decision stand in for one that
 * needs the owner. Asserted at module load so the invariant cannot be broken
 * by a later edit to either table.
 */
export function ownerActionFamily(actionType: ActionType): OwnerActionFamily {
  return ACTION_TYPE_FAMILY[actionType];
}

/**
 * Approval is decided HERE, from the action type — never by the model.
 * Mirrors the standing rules: anything that publishes or spends needs the
 * owner (§1.5, §1.6). Reviewing or researching does not.
 */
export type ActionType = typeof ACTION_TYPES[number];

/** THE canonical approval policy. Reused by the decision layer — never copied. */
export const REQUIRES_APPROVAL: Record<ActionType, boolean> = {
  REVIEW_CONTEXT: false, RESEARCH: false, DRAFT_CONTENT: false,
  RUN_EXPERIMENT: true, LAUNCH_CAMPAIGN: true, CHANGE_SPEND: true,
};

/**
 * OWNER ACTION INTENT — what substantive action is being proposed.
 *
 * MEASURED P0: the owner action family fixed `actionType` instability, but
 * equivalence still keyed on normalized WHAT text, so ordinary paraphrasing
 * defeated it:
 *
 *   APPROVED  "…before any marketing activity begins"
 *   RECOMMENDED "…before any marketing work begins"      ← same decision
 *
 *   DISMISSED "Import or connect real provider/audience data so signal-based
 *              decisions become possible"
 *   RECOMMENDED "Import real provider data to establish an observed signal
 *              baseline"                                  ← same decision
 *
 * The vocabulary is deliberately SMALL and derived from what the production
 * model actually recommends today. It is not a taxonomy of marketing; it is the
 * set of distinct decisions an owner is currently asked to make.
 *
 * `OTHER` is load-bearing: an unrecognised or untrusted intent falls back to
 * normalized WHAT, which can only ever UNDER-merge. Nothing is collapsed
 * because the server failed to classify it.
 */
export const OWNER_ACTION_INTENTS = [
  'DEFINE_AUDIENCE',        // define/refine ICP, target customer, segment
  'CONNECT_DATA_SOURCE',    // import or connect provider/analytics data
  'ANALYZE_PERFORMANCE',    // read existing first-party performance
  'REVIEW_POSITIONING',     // positioning, value proposition, messaging review
  'RESEARCH_MARKET',        // competitors, channels, where the audience is
  'REVIEW_STORE_PRESENCE',  // app store / website listing review
  'CREATE_DRAFT',           // produce a marketing artefact
  'RUN_EXPERIMENT',
  'LAUNCH_CAMPAIGN',
  'CHANGE_SPEND',
  'OTHER',                  // unclassified — falls back to normalized WHAT
] as const;
export type OwnerActionIntent = typeof OWNER_ACTION_INTENTS[number];

/**
 * THE TRUST BOUNDARY. An intent is a model HINT; this decides whether it is
 * admissible for the server-derived action family.
 *
 * A model can therefore never use the intent field to make a spend change look
 * advisory: `CHANGE_SPEND` accepts only the `CHANGE_SPEND` intent, and an
 * advisory family accepts no committing intent. A mismatch is not an error —
 * it silently degrades to `OTHER`, which is the conservative outcome.
 */
const INTENTS_BY_FAMILY: Record<OwnerActionFamily, readonly OwnerActionIntent[]> = {
  ANALYZE_CONTEXT: [
    'DEFINE_AUDIENCE', 'CONNECT_DATA_SOURCE', 'ANALYZE_PERFORMANCE',
    'REVIEW_POSITIONING', 'RESEARCH_MARKET', 'REVIEW_STORE_PRESENCE', 'OTHER',
  ],
  CREATE_DRAFT:    ['CREATE_DRAFT', 'OTHER'],
  RUN_EXPERIMENT:  ['RUN_EXPERIMENT', 'OTHER'],
  LAUNCH_CAMPAIGN: ['LAUNCH_CAMPAIGN', 'OTHER'],
  CHANGE_SPEND:    ['CHANGE_SPEND', 'OTHER'],
};

/**
 * Validates a model-supplied intent against the server-derived family.
 *
 * @returns the intent when admissible, otherwise 'OTHER'
 * @security The family comes from `actionType`, which the server maps and from
 *   which approval is derived. The model cannot widen its own authority by
 *   choosing an intent.
 */
export function resolveOwnerActionIntent(
  actionType: ActionType, hint: string | null | undefined,
): OwnerActionIntent {
  if (!hint) return 'OTHER';
  const family = ownerActionFamily(actionType);
  const allowed = INTENTS_BY_FAMILY[family];
  return (allowed as readonly string[]).includes(hint) ? (hint as OwnerActionIntent) : 'OTHER';
}

/**
 * ACTION TARGET — the decision OBJECT inside a broad intent.
 *
 * MEASURED P0: `REVIEW_POSITIONING` proved to be an umbrella. Two materially
 * different asks —
 *
 *   "Establish a clear positioning statement … in the US Productivity market"
 *   "Clarify whether this product is genuinely intended for external customers
 *    or is purely an internal/developer tool"
 *
 * — both validated to that one intent, produced the same action key, and the
 * second inherited the first's DEFERRED decision. Intent alone answers "what
 * kind of work?"; the target answers "about WHAT?".
 *
 * Deliberately small and closed, derived from recommendations the production
 * model actually emits. `UNSPECIFIED` is the conservative fallback: it forces
 * the key back onto normalized WHAT, so an unclassified action can only ever
 * UNDER-merge. Missing target must never let a different action inherit a
 * decision.
 */
export const ACTION_TARGETS = [
  'ICP_DEFINITION',              // who the customer is
  'PRODUCT_AUDIENCE_VALIDATION', // whether there is an external customer at all
  'POSITIONING_STATEMENT',       // how the product is described
  'VALUE_PROPOSITION',           // the promise made to that customer
  'CHANNEL_SELECTION',           // where to reach them
  'COMPETITOR_LANDSCAPE',
  'STORE_LISTING',
  'DATA_CONNECTION',             // connect/import a source
  'PERFORMANCE_REVIEW',          // read what a connected source reports
  'CONTENT_ARTIFACT',
  'EXPERIMENT_DESIGN',
  'CAMPAIGN_LAUNCH',
  'BUDGET_CHANGE',
  'UNSPECIFIED',
] as const;
export type ActionTarget = typeof ACTION_TARGETS[number];

/**
 * Which targets each intent may carry. A target outside its intent's set is
 * inadmissible and degrades to UNSPECIFIED — the model cannot invent a
 * discriminator, only choose among the ones the server already recognises.
 */
const TARGETS_BY_INTENT: Record<OwnerActionIntent, readonly ActionTarget[]> = {
  DEFINE_AUDIENCE:       ['ICP_DEFINITION', 'PRODUCT_AUDIENCE_VALIDATION', 'UNSPECIFIED'],
  REVIEW_POSITIONING:    ['POSITIONING_STATEMENT', 'VALUE_PROPOSITION', 'PRODUCT_AUDIENCE_VALIDATION', 'UNSPECIFIED'],
  RESEARCH_MARKET:       ['CHANNEL_SELECTION', 'COMPETITOR_LANDSCAPE', 'UNSPECIFIED'],
  REVIEW_STORE_PRESENCE: ['STORE_LISTING', 'UNSPECIFIED'],
  CONNECT_DATA_SOURCE:   ['DATA_CONNECTION', 'UNSPECIFIED'],
  ANALYZE_PERFORMANCE:   ['PERFORMANCE_REVIEW', 'UNSPECIFIED'],
  CREATE_DRAFT:          ['CONTENT_ARTIFACT', 'UNSPECIFIED'],
  RUN_EXPERIMENT:        ['EXPERIMENT_DESIGN', 'UNSPECIFIED'],
  LAUNCH_CAMPAIGN:       ['CAMPAIGN_LAUNCH', 'UNSPECIFIED'],
  CHANGE_SPEND:          ['BUDGET_CHANGE', 'UNSPECIFIED'],
  OTHER:                 ['UNSPECIFIED'],
};

/**
 * Validates a model-supplied target against the already-validated intent.
 *
 * @returns the target when admissible, otherwise 'UNSPECIFIED'
 * @security The target is a discriminator only. It never touches approval,
 *   founder conflict, family or scope, so it cannot widen authority.
 */
export function resolveActionTarget(
  intent: OwnerActionIntent, hint: string | null | undefined,
): ActionTarget {
  if (!hint) return 'UNSPECIFIED';
  const allowed = TARGETS_BY_INTENT[intent];
  return (allowed as readonly string[]).includes(hint) ? (hint as ActionTarget) : 'UNSPECIFIED';
}

// INVARIANT: a committing target may never be admissible for an advisory
// intent. Checked at load so a careless edit fails on import.
for (const [intent, targets] of Object.entries(TARGETS_BY_INTENT) as Array<[OwnerActionIntent, readonly ActionTarget[]]>) {
  for (const [committing, owner] of [
    ['BUDGET_CHANGE', 'CHANGE_SPEND'], ['CAMPAIGN_LAUNCH', 'LAUNCH_CAMPAIGN'],
    ['EXPERIMENT_DESIGN', 'RUN_EXPERIMENT'],
  ] as const) {
    if (targets.includes(committing) && intent !== owner) {
      throw new Error(
        `action target "${committing}" is admissible for intent "${intent}" — ` +
        'a committing target must never be reachable from another intent');
    }
  }
}

// INVARIANT: an intent that commits the business may never be admissible for a
// family whose approval consequence differs. Checked at load, like the family
// invariant below, so a careless edit fails on import rather than silently
// downgrading authorization.
for (const [family, intents] of Object.entries(INTENTS_BY_FAMILY) as Array<[OwnerActionFamily, readonly OwnerActionIntent[]]>) {
  for (const committing of ['CHANGE_SPEND', 'LAUNCH_CAMPAIGN', 'RUN_EXPERIMENT'] as const) {
    if (intents.includes(committing) && family !== committing) {
      throw new Error(
        `owner action intent "${committing}" is admissible for family "${family}" — ` +
        'a committing action must never be reachable from a different family');
    }
  }
}


const ModelSchema = z.object({
  recommendations: z.array(z.object({
    what: z.string().min(3),
    whyNow: z.string().min(3),
    expectedEffect: z.string().nullable(),
    nextStep: z.string().min(3),
    actionType: z.enum(ACTION_TYPES),
    // HINT ONLY. Validated server-side against the derived family; an
    // inadmissible value degrades to OTHER and changes no authority.
    ownerActionIntent: z.enum(OWNER_ACTION_INTENTS).optional(),
    // HINT ONLY, validated against the resolved intent. Distinguishes
    // materially different decisions inside one broad intent.
    actionTarget: z.enum(ACTION_TARGETS).optional(),
    supporting: z.array(z.object({
      type: z.enum(['OBSERVATION', 'INFERENCE']),
      text: z.string().min(3),
      // The model may only CITE handles the server issued. Anything else is
      // discarded on arrival — it cannot mint provenance.
      evidenceRefs: z.array(z.string()).optional(),
    })).max(4),
    evidenceRefs: z.array(z.string()).optional(),
  })),
  // NOT capped here: a model returning four must be TRUNCATED by the service,
  // not rejected outright. A schema failure would discard three good
  // recommendations because of one surplus, and the caller would see an outage.
});

// INVARIANT (§3): every action type in a family must share the same approval
// consequence. Checked at load: a mapping edit that violated it would be a
// silent authorization downgrade, so it fails loudly instead.
for (const family of OWNER_ACTION_FAMILIES) {
  const members = (Object.keys(ACTION_TYPE_FAMILY) as ActionType[])
    .filter(t => ACTION_TYPE_FAMILY[t] === family);
  const approvals = new Set(members.map(t => REQUIRES_APPROVAL[t]));
  if (approvals.size > 1) {
    throw new Error(
      `owner action family "${family}" mixes approval consequences (${members.join(', ')}) — ` +
      'a family must never let a no-approval decision stand in for one that needs the owner');
  }
}

const SYSTEM = `You are LaunchMind, an AI CMO advising the owner of one product.

Return ONLY raw JSON — no prose, no markdown fences.

{
  "recommendations": [
    {
      "what": "the action to consider, one sentence",
      "whyNow": "why this deserves attention now, one sentence",
      "expectedEffect": "which business goal or metric this could move, or null",
      "nextStep": "the concrete next step for the owner",
      "actionType": "REVIEW_CONTEXT|RESEARCH|DRAFT_CONTENT|RUN_EXPERIMENT|LAUNCH_CAMPAIGN|CHANGE_SPEND",
      "ownerActionIntent": "DEFINE_AUDIENCE|CONNECT_DATA_SOURCE|ANALYZE_PERFORMANCE|REVIEW_POSITIONING|RESEARCH_MARKET|REVIEW_STORE_PRESENCE|CREATE_DRAFT|RUN_EXPERIMENT|LAUNCH_CAMPAIGN|CHANGE_SPEND|OTHER",
      "actionTarget": "ICP_DEFINITION|PRODUCT_AUDIENCE_VALIDATION|POSITIONING_STATEMENT|VALUE_PROPOSITION|CHANNEL_SELECTION|COMPETITOR_LANDSCAPE|STORE_LISTING|DATA_CONNECTION|PERFORMANCE_REVIEW|CONTENT_ARTIFACT|EXPERIMENT_DESIGN|CAMPAIGN_LAUNCH|BUDGET_CHANGE|UNSPECIFIED",
      "evidenceRefs": ["ids from AVAILABLE EVIDENCE that this recommendation rests on"],
      "supporting": [
        { "type": "OBSERVATION", "text": "something the context DIRECTLY states", "evidenceRefs": ["id"] },
        { "type": "INFERENCE",   "text": "your interpretation of that", "evidenceRefs": ["id"] }
      ]
    }
  ]
}

RULES:
- EVERY recommendation must set evidenceRefs using ids from the AVAILABLE
  EVIDENCE list in the user message. A recommendation citing nothing is
  discarded by the server, so an uncited recommendation is a wasted one.
- An id that is not in that list does not exist. Do not invent ids.
- Set ownerActionIntent to the single best fit for the substantive action. Use
  OTHER only when none fits — it is not a default.
- Set actionTarget to WHAT the decision is about. Two recommendations sharing an
  intent but asking about different things must carry different targets: for
  example "write a positioning statement" is POSITIONING_STATEMENT, while "is
  this product even for external customers?" is PRODUCT_AUDIENCE_VALIDATION.
- At most THREE recommendations, most important first. Fewer is better than padding.
- Mark a supporting item OBSERVATION only if the context states it directly.
  Anything you concluded, suspected or generalised is an INFERENCE.
- Never invent performance numbers, benchmarks, competitor findings or trends.
  If the context does not contain data, say what is missing instead.
- Founder-asserted and founder-confirmed direction outranks all other evidence.
  Never present a lower-authority position as established when it conflicts.
- Write for a busy founder. No internal jargon, no mention of memory, retrieval
  or authority mechanics.`;

/** Owner-facing description of a governed authority tier. */
function authorityLabel(tier: string | null): string {
  switch (tier) {
    case 'FOUNDER_ASSERTED':
    case 'FOUNDER_CONFIRMED':     return 'You told LaunchMind this';
    case 'EXPERIMENT_CONTROLLED': return 'From a controlled experiment';
    case 'OBSERVED_FIRST_PARTY':  return 'Observed in your own data';
    case 'VERIFIED_EXTERNAL':     return 'From a verified external source';
    case 'DERIVED_INFERENCE':     return 'LaunchMind inferred this';
    case 'ANONYMIZED_PLAYBOOK':   return 'Pattern seen across similar products';
    default:                      return 'Recorded before authority tracking — treated as unconfirmed';
  }
}

/**
 * Builds provenance from the package that was ACTUALLY assembled.
 *
 * This is the anti-fabrication mechanism: whatever the model claims, the owner
 * sees the sources that genuinely contributed. A source with no data does not
 * appear, and cannot be conjured by wording.
 */
export function deriveProvenance(pkg: ContextPackageV2): ProvenanceItem[] {
  const out: ProvenanceItem[] = [];
  const f = pkg.founderContext;

  if (f.audienceConfirmed || f.contextDelta || f.primaryGoal) {
    out.push({
      kind: 'FOUNDER_DIRECTION',
      label: 'Your confirmed direction',
      detail: [f.primaryGoal ? `goal: ${f.primaryGoal}` : null,
               f.audienceConfirmed ? 'audience confirmed' : null,
               f.contextDelta ? 'recent context you added' : null]
        .filter(Boolean).join(' · ') || null,
    });
  }
  if (f.strategyDirection) {
    out.push({ kind: 'ONBOARDING_STRATEGY', label: 'Your onboarding strategy', detail: null });
  }
  for (const m of pkg.retrievedMemories.slice(0, 3)) {
    out.push({
      kind: 'MARKETING_MEMORY',
      label: m.title,
      // Persisted tier only. A legacy row stays UNKNOWN_LEGACY — a source that
      // merely reads like founder input never becomes founder authority.
      authority: m.authorityTier ?? 'UNKNOWN_LEGACY',
      memoryClass: m.memoryClass ?? null,
      evidenceCount: m.evidenceIds.length,
      detail: authorityLabel(m.authorityTier ?? null),
    });
  }
  if (pkg.authoritative.productName) {
    out.push({ kind: 'PRODUCT_CONTEXT', label: 'Your product profile', detail: null });
  }
  if (f.competitors.length) {
    out.push({
      kind: 'COMPETITOR_CONTEXT',
      label: `${f.competitors.length} competitor${f.competitors.length === 1 ? '' : 's'} you confirmed`,
      detail: null,
    });
  }
  if (pkg.operational.recentMetrics.length || pkg.operational.activeCampaigns.length) {
    out.push({
      kind: 'CAMPAIGN_PERFORMANCE',
      label: 'Your campaign activity',
      detail: `${pkg.operational.activeCampaigns.length} active · ${pkg.operational.recentMetrics.length} metric week(s)`,
    });
  }
  return out;
}

/**
 * Evidence strength from what genuinely exists — never from the model.
 *
 * Deliberately coarse and countable. Measured first-party performance is the
 * only thing that can reach "strong"; founder direction alone is "some", and a
 * business with neither gets "insufficient" rather than a reassuring number.
 */
export function deriveEvidenceStrength(pkg: ContextPackageV2): EvidenceStrength {
  const hasPerformance = pkg.operational.recentMetrics.length > 0;
  const corroborated = pkg.retrievedMemories.filter(m => m.evidenceIds.length > 0).length;
  const f = pkg.founderContext;
  const founderInputs = [f.audienceConfirmed, f.contextDelta, f.primaryGoal, f.strategyDirection]
    .filter(Boolean).length;

  if (hasPerformance && corroborated > 0) return 'strong evidence';
  if (hasPerformance || corroborated > 0) return 'some evidence';
  if (founderInputs >= 2 || pkg.retrievedMemories.length > 0) return 'limited evidence';
  return 'insufficient evidence';
}

/** What Growth Brain could not see. Stated plainly rather than papered over. */
export function deriveUnavailable(pkg: ContextPackageV2, marketIntel: boolean): string[] {
  const out: string[] = [];
  if (!pkg.operational.recentMetrics.length) out.push('No campaign performance data yet — connect a channel or launch a first campaign.');
  if (!pkg.retrievedMemories.length) out.push('No marketing memory for this product yet.');
  if (!marketIntel) out.push('Market intelligence is not available for this product yet.');
  if (!pkg.founderContext.primaryGoal) out.push('No primary goal set.');
  return out;
}

/*
 * REMOVED: observationBackingExists().
 *
 * It asked a PACKAGE-WIDE question — "does this business have any data at
 * all?" — so one founder goal was enough to license
 * `OBSERVATION: "Google Ads conversion increased 31%"` for a business with no
 * campaigns. Grounding is now per claim, against the evidence that claim
 * actually cited (growthBrainOutputGrounding.groundClaims).
 */

export interface RecommendationRequest {
  workspaceId: string;
  founderId: string;
  productId: string | null;
  /** True only when scoped, non-synthetic market intelligence really resolved. */
  marketIntelligenceAvailable?: boolean;
}

/**
 * Produces at most three grounded recommendations for ONE business.
 *
 * @param req - verified active business (resolved by the caller, as in 3.3B)
 * @returns typed recommendations plus an explicit list of what was unavailable
 * @security Reads only what ContextPackageV2 scopes to this workspace/product.
 */
export async function generateGrowthBrainRecommendations(
  req: RecommendationRequest,
): Promise<GrowthBrainRecommendations> {
  // §10 HONESTY: availability means CONSUMABLE, not merely resolvable. A
  // benchmark that exists in intelligence_network but never enters the context
  // package cannot support any recommendation, so reporting it as available
  // would be a dishonest flag. No MARKET_INTELLIGENCE handle is issued today,
  // so this is false regardless of what the caller resolved. The caller's value
  // is retained as the upstream signal for when the subsystem lands (P1-5).
  const benchmarkResolvable = req.marketIntelligenceAvailable === true;
  const marketIntel = false as boolean;
  void benchmarkResolvable;

  const pkg = await buildContextPackageV2({
    workspaceId: req.workspaceId,
    founderId: req.founderId,
    productId: req.productId,
    intent: 'MORNING_BRIEF',
    // Retrieval input derived from the task, never a system prompt.
    query: 'What are the most important marketing priorities for this product right now?',
    persist: true,
  });

  // The ONLY evidence the model may cite. Issued per request from this
  // package, so a handle for another business cannot resolve.
  const handles = issueEvidenceHandles(pkg);
  const evidenceStrength = deriveEvidenceStrength(pkg);
  const unavailable = deriveUnavailable(pkg, marketIntel);

  // Nothing to reason from is a valid answer. Producing advice here would be
  // advice about a business LaunchMind knows nothing about.
  if (handles.length === 0) {
    return {
      recommendations: [], unavailable, withheld: [],
      marketIntelligenceAvailable: marketIntel,
      reason: 'LaunchMind does not have enough about this product yet to recommend anything specific.',
    };
  }

  let parsed: z.infer<typeof ModelSchema>;
  try {
    const raw = await callSonnet(
      SYSTEM,
      `Context:\n${formatContextPackageForModel(pkg)}\n\n` +
      `AVAILABLE EVIDENCE — cite ONLY these ids in evidenceRefs:\n` +
      handles.map(h => `  ${h.ref} = ${h.kind}: ${h.label}`).join('\n') + `\n\n` +
      `Produce at most three prioritised recommendations for this product. ` +
      `Every supporting item must cite the evidence ids it rests on. ` +
      `An id you did not receive above does not exist.`,
      1400,
      {
        founderId: req.founderId, productId: req.productId,
        promptId: 'growth_brain_recommendations', action: 'growth_brain_recommendations',
        contextPackageId: pkg.id,
      },
      ModelSchema,
    );
    parsed = ModelSchema.parse(JSON.parse(raw));
  } catch {
    // A model outage is not a finding about the business.
    return {
      recommendations: [], unavailable, withheld: [],
      marketIntelligenceAvailable: marketIntel,
      reason: 'Recommendations could not be generated right now. Nothing about your product has changed.',
    };
  }

  const withheld: WithheldClaim[] = [];
  const recommendations: GrowthBrainRecommendation[] = [];

  for (const r of parsed.recommendations.slice(0, 3)) {
    // CLAIM-LEVEL grounding. Each supporting item is checked against the
    // evidence IT cited — not against "does this business have any data".
    const grounded = groundClaims(r.supporting, handles);
    withheld.push(...grounded.dropped.map(d => ({ reason: d.reason })));

    // Recommendation-level refs are the union of what actually resolved, plus
    // anything the recommendation itself cited and that resolved. Nothing else
    // is ever attached, so unrelated real evidence cannot appear as support.
    const byRef = new Map(handles.map(h => [h.ref, h]));
    const cited = new Map<string, EvidenceHandle>();
    for (const ref of r.evidenceRefs ?? []) {
      const h = byRef.get(ref);
      if (h) cited.set(h.ref, h);
    }
    for (const c of grounded.claims) for (const h of c.refs) cited.set(h.ref, h);

    // A recommendation with nothing resolvable behind it is not shown.
    if (cited.size === 0) {
      withheld.push({ reason: 'NO_RESOLVABLE_EVIDENCE' });
      continue;
    }

    const conflict = detectFounderConflict(`${r.what} ${r.whyNow}`, handles);

    recommendations.push({
      type: 'RECOMMENDATION',
      actionType: r.actionType,
      // Validated here, never trusted as given.
      ownerActionIntent: resolveOwnerActionIntent(r.actionType, r.ownerActionIntent),
      actionTarget: resolveActionTarget(
        resolveOwnerActionIntent(r.actionType, r.ownerActionIntent), r.actionTarget),
      what: r.what,
      whyNow: r.whyNow,
      supportedBy: [...cited.values()].map(h => ({
        kind: h.kind as ProvenanceItem['kind'],
        label: h.label,
        authority: h.authority ?? null,
        memoryClass: h.memoryClass ?? null,
        evidenceCount: h.evidenceCount ?? null,
        detail: h.detail ?? (h.authority ? authorityLabel(h.authority === 'UNKNOWN_LEGACY' ? null : h.authority) : null),
      })),
      supporting: grounded.claims.map(c => ({ type: c.type, text: c.text })),
      founderConflict: conflict ? { withDirection: conflict.label } : null,
      // A conflicting recommendation is surfaced for the founder to settle,
      // never returned as established guidance.
      requiresFounderReview: conflict !== null,
      expectedEffect: r.expectedEffect,
      nextStep: r.nextStep,
      requiresApproval: REQUIRES_APPROVAL[r.actionType] || conflict !== null,
      evidenceStrength,
      confidence: null,
    });
  }

  return {
    recommendations,
    unavailable,
    withheld,
    marketIntelligenceAvailable: marketIntel,
    reason: recommendations.length === 0
      ? 'No recommendation could be grounded in what LaunchMind currently knows.'
      : null,
  };
}
