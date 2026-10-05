/**
 * @file strategyComposition.ts
 * @description Real Content Strategy from real intelligence — ADR-071 §10, B3.
 *
 *   PURE derivation + a thin persist. Everything that decides what the strategy
 *   SAYS is testable without a database, because the interesting failures here
 *   are judgement failures, not storage failures.
 *
 *   THREE PRECEDENCE RULES, in order, and the order is the design:
 *
 *     1. FOUNDER DIRECTION WINS. Market Intelligence may describe a competitive
 *        condition; it may not select a thesis the founder ruled out. "Compete
 *        on price" cannot become the campaign thesis when the owner said not to,
 *        no matter how strong the signal.
 *     2. MEMORY SHAPES FORM, NOT FACT. "Outcome-led headlines performed better"
 *        may steer the hook. It can never become "we improve results by 31%" —
 *        performing well is not evidence, and 3.3C exists because that
 *        conflation shipped once already.
 *     3. PROOF UNAVAILABLE IS CARRIED, NOT DROPPED. A strategy that quietly
 *        forgets what it cannot prove invites generation to invent it.
 *
 * @security Evidence appears as server-issued refs and owner-safe labels. No
 *   model output can add to `proofAvailable`; it is computed from the context.
 * @dependencies productContentContext, contentCampaignService, supabaseAdmin
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { ProductContentContext } from './productContentContext';
import type { CampaignMessageArchitecture } from '../opportunity/contentCampaignService';

export interface MemoryPreference {
  /** Owner-safe label, e.g. "outcome-led headlines have performed better". */
  label: string;
  kind: 'HOOK_STYLE' | 'TONE' | 'CHANNEL' | 'FORMAT';
}

export interface ContentStrategy {
  workspaceId: string;
  productId: string;
  objective: string;
  audience: string;
  campaignThesis: string;
  angle: string;
  coreNarrative: string;
  messageHierarchy: string[];
  proofAvailable: string[];
  proofUnavailable: string[];
  ctaIntent: string | null;
  constraints: string[];
  objections: string[];
  productRole: string | null;
  primaryBenefit: string | null;
  brandDirectives: string[];
  prohibitedTerminology: string[];
  /** Which fields eligible intelligence actually informed. Audit, not display. */
  intelligenceInformed: string[];
  /** Founder rules that overrode something. Owner-safe wording. */
  founderOverrides: string[];
  /** Memory preferences applied. Form only — never proof. */
  memoryApplied: string[];
  brandKitVersion: number;
}

/** Prohibition phrasings LaunchMind understands in founder direction. */
const PROHIBITION_MARKERS = [
  'do not', "don't", 'never', 'avoid', 'no ', 'not competing on', 'stop ',
];

/**
 * Extracts prohibitions the founder stated in their own words.
 *
 * Deliberately simple: it looks for an explicit negative followed by a subject.
 * A missed prohibition means the strategy proceeds and the claim engine still
 * governs it; a hallucinated one would silently narrow the owner's options,
 * which is the worse error.
 */
export function founderProhibitions(ctx: ProductContentContext): string[] {
  const sources = [ctx.founderDirection.contextDelta, ctx.founderDirection.audienceConfirmed]
    .filter((s): s is string => !!s);
  const out: string[] = [];
  for (const text of sources) {
    for (const sentence of text.split(/[.;\n]+/)) {
      const t = sentence.trim().toLowerCase();
      if (!t) continue;
      if (PROHIBITION_MARKERS.some(m => t.includes(m))) out.push(sentence.trim());
    }
  }
  return out;
}

/** Does a candidate thesis collide with something the founder ruled out? */
export function violatesFounderDirection(thesis: string, prohibitions: readonly string[]): string | null {
  const t = thesis.toLowerCase();
  for (const p of prohibitions) {
    // Compare on the CONTENT words of the prohibition, not the negation itself:
    // "do not compete on price" prohibits theses about competing on price.
    const subject = p.toLowerCase()
      .replace(/\b(do not|don't|never|avoid|stop|not)\b/g, ' ')
      .split(/\s+/).filter(w => w.length > 3);
    if (subject.length === 0) continue;
    const hits = subject.filter(w => t.includes(w)).length;
    if (hits >= Math.min(2, subject.length)) return p;
  }
  return null;
}

export interface StrategyInput {
  ctx: ProductContentContext;
  architecture: CampaignMessageArchitecture;
  /** Governed memory preferences. Form only — the caller must not pass facts. */
  memoryPreferences?: readonly MemoryPreference[];
  /** Angles eligible intelligence supports, with the ref that supports each. */
  intelligenceAngles?: ReadonlyArray<{ angle: string; ref: string; objection?: string }>;
}

/**
 * Derives the strategy. PURE.
 *
 * @security `proofAvailable` is recomputed from the context's CURRENT evidence,
 *   not copied from the campaign — evidence can be retracted between the two,
 *   and a stale copy is how a withdrawn number survives into copy.
 */
export function deriveContentStrategy(input: StrategyInput): ContentStrategy {
  const { ctx, architecture } = input;
  const prohibitions = founderProhibitions(ctx);
  const intelligenceInformed: string[] = [];
  const founderOverrides: string[] = [];
  const memoryApplied: string[] = [];

  // ── thesis ────────────────────────────────────────────────────────────────
  let thesis = architecture.thesis;
  const angles = input.intelligenceAngles ?? [];
  const eligibleRefs = new Set(ctx.evidence.map(h => h.ref));
  const usableAngles = angles.filter(a => eligibleRefs.has(a.ref));

  if (usableAngles.length > 0 && ctx.marketIntelligenceAvailable) {
    const candidate = usableAngles[0];
    const clash = violatesFounderDirection(candidate.angle, prohibitions);
    if (clash) {
      // The condition may still be described; it just cannot become the thesis.
      founderOverrides.push(
        `A market signal suggested an angle you asked LaunchMind to avoid, so it was not used as the campaign thesis.`);
    } else {
      thesis = candidate.angle;
      intelligenceInformed.push('campaignThesis', 'angle');
    }
  }

  // ── objections ────────────────────────────────────────────────────────────
  const objections = [...architecture.objections];
  for (const a of usableAngles) {
    if (a.objection) { objections.push(a.objection); intelligenceInformed.push('objections'); }
  }

  // ── hierarchy, shaped by memory FORM preferences only ─────────────────────
  const hierarchy = [thesis, architecture.primaryBenefit, architecture.coreProblem]
    .filter((s): s is string => !!s);
  for (const pref of input.memoryPreferences ?? []) {
    if (pref.kind === 'HOOK_STYLE' || pref.kind === 'FORMAT') {
      memoryApplied.push(pref.label);
      // Reorders emphasis. Adds no factual content, which is the whole rule.
      if (/outcome/i.test(pref.label) && architecture.primaryBenefit) {
        const i = hierarchy.indexOf(architecture.primaryBenefit);
        if (i > 0) { hierarchy.splice(i, 1); hierarchy.unshift(architecture.primaryBenefit); }
      }
    }
    if (pref.kind === 'TONE') memoryApplied.push(pref.label);
  }

  // ── proof, recomputed from CURRENT evidence ───────────────────────────────
  const availableLabels = new Set(ctx.evidence.map(h => h.label));
  const proofAvailable = architecture.proofAvailable.filter(p => availableLabels.has(p));
  const retracted = architecture.proofAvailable.filter(p => !availableLabels.has(p));
  const proofUnavailable = [...architecture.proofUnavailable];
  for (const r of retracted) {
    proofUnavailable.push(`${r} is no longer available as proof`);
  }

  const whyNow = ctx.marketIntelligenceAvailable && intelligenceInformed.length > 0
    ? 'a current market observation' : 'a durable product truth';
  if (ctx.marketIntelligenceAvailable && intelligenceInformed.length > 0) {
    intelligenceInformed.push('whyNowFraming');
  }

  return {
    workspaceId: ctx.workspaceId, productId: ctx.productId,
    objective: architecture.primaryBenefit ?? 'growth',
    audience: architecture.audience,
    campaignThesis: thesis,
    angle: thesis,
    coreNarrative: `${thesis} — framed by ${whyNow}.`,
    messageHierarchy: hierarchy,
    proofAvailable, proofUnavailable,
    ctaIntent: architecture.ctaIntent,
    constraints: [...architecture.brandDirectives],
    objections,
    productRole: architecture.productRole,
    primaryBenefit: architecture.primaryBenefit,
    brandDirectives: architecture.brandDirectives,
    prohibitedTerminology: [...new Set([...architecture.prohibitedTerms, ...ctx.prohibitedTerms])],
    intelligenceInformed: [...new Set(intelligenceInformed)],
    founderOverrides, memoryApplied,
    brandKitVersion: ctx.brand.version,
  };
}

/**
 * Persists a strategy.
 *
 * @security Scope comes from the strategy, which took it from the context. A
 *   campaign id from another workspace is refused before any write.
 */
export async function persistContentStrategy(
  strategy: ContentStrategy,
  opts: { founderId: string; campaignId: string; recommendationId?: string | null; persistId?:string },
): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data: campaign } = await db.from('content_campaigns')
    .select('id').eq('id', opts.campaignId)
    .eq('workspace_id', strategy.workspaceId).maybeSingle();
  if (!campaign) throw new Error('Not found.');

  const values = {
    ...(opts.persistId ? {id:opts.persistId} : {}),
    workspace_id: strategy.workspaceId, product_id: strategy.productId,
    founder_id: opts.founderId, content_campaign_id: opts.campaignId,
    recommendation_id: opts.recommendationId ?? null,
    objective: strategy.objective, audience: strategy.audience, angle: strategy.angle,
    message_hierarchy: strategy.messageHierarchy,
    proof_available: strategy.proofAvailable,
    proof_unavailable: strategy.proofUnavailable,
    cta_intent: strategy.ctaIntent, constraints: strategy.constraints,
    mode: 'SHADOW',
  };
  const table=db.from('content_strategies');
  const {data,error}=await (opts.persistId ? table.upsert(values,{onConflict:'id',ignoreDuplicates:true}) : table.insert(values)).select('id').maybeSingle();
  if (error) throw new Error(`strategy persist failed: ${error.message}`);
  return (data as { id?: string } | null)?.id ?? opts.persistId ?? null;
}
