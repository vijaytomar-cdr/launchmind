/**
 * @file contentCampaignService.ts
 * @description Content Campaign — a narrative container — ADR-071 §9/§10/§11.
 *
 *   NOT the executable `campaigns` table. That one carries spend_cap,
 *   approved_at, launched_at and the §1.5/§1.6 gates. This one has no column in
 *   which budget, schedule, launch or execution approval could be written, so a
 *   future code path cannot grant them by mistake — the separation is structural,
 *   not procedural.
 *
 *   A campaign inherits its identity from the OPPORTUNITY that justified it, and
 *   that link is immutable: it is the answer to "why does this exist?" months
 *   later. Mutable intelligence bodies are never copied into identity fields —
 *   the same two-timeline rule proved in 3.4C, where a snapshot keeps what was
 *   said and the current lifecycle is resolved at read time.
 *
 * @security Proof-available entries must resolve against evidence the SERVER
 *   issued. Evidence is re-resolved at strategy and again at generation, so a
 *   retraction between opportunity and copy fails closed.
 * @dependencies supabaseAdmin, contentOpportunityPolicy, channelRecommendation,
 *   productContentContext
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { ProductContentContext } from '../content/productContentContext';
import type { OpportunityCandidate } from './contentOpportunityPolicy';
import { recommendChannels, recommendContentPackage, type ContentPackageItem } from './channelRecommendation';
import { brandConstraints } from '../content/brandGovernedGeneration';

export interface CampaignMessageArchitecture {
  name: string;
  thesis: string;
  /** What the BUSINESS wants from this campaign. Never shown as a CTA. */
  campaignObjective: string | null;
  audience: string;
  coreProblem: string | null;
  messageAngle: string;
  productRole: string | null;
  primaryBenefit: string | null;
  objections: string[];
  ctaIntent: string | null;
  /** Owner-safe labels of evidence that can substantiate this narrative. */
  proofAvailable: string[];
  /** What this narrative CANNOT prove. Load-bearing: see ADR-070 §4. */
  proofUnavailable: string[];
  recommendedChannels: string[];
  contentPackage: ContentPackageItem[];
  packageNotes: string[];
  /**
   * Brand directives the brief will inherit — ADR-071 §16.
   *
   * Brand governs HOW this is said. It never decides what is true, what the
   * evidence proves, or whether anything may execute. Only OWNER_CONFIRMED
   * fields become directives; an observed tagline is carried as an observation
   * and can never become the official campaign tagline by default.
   */
  brandDirectives: string[];
  /** Terms the owner banned. Enforced deterministically after generation. */
  prohibitedTerms: string[];
}

/**
 * Fields the owner must confirm before they can appear as fact.
 *
 * CTA destination and offer are governed regardless of how confident the model
 * is: sending a customer somewhere, or promising them a price, are decisions
 * with consequences LaunchMind cannot verify.
 */
export const CAMPAIGN_OWNER_CONFIRMATION_REQUIRED = [
  'ctaDestination', 'offer', 'pricing', 'certifications', 'guarantees',
] as const;

/**
 * Derives the campaign narrative from an opportunity and the product context.
 *
 * PURE — no I/O, so the message architecture is testable without a database.
 *
 * @security `proofUnavailable` is computed from what the context CANNOT supply,
 *   not from what the model chose to admit. A narrative that cannot name its
 *   gaps will invent them downstream.
 */
/**
 * A product name fit to appear inside a sentence.
 *
 * Intake stores whatever the store page was titled, which routinely carries
 * " - App Store", " on the App Store" or " - Apps on Google Play". Those belong
 * to the listing, not the product, and reading one aloud in a call to action is
 * how copy starts sounding like a scraper wrote it.
 */
export function displayProductName(raw: string | null | undefined): string {
  const n = String(raw ?? '').trim();
  if (!n) return 'the app';
  return n
    .replace(/\s*[-–—|]\s*(App Store|Apps on Google Play|Google Play)\s*$/i, '')
    .replace(/\s+on the App Store\s*$/i, '')
    .replace(/\s*[-–—|]\s*$/, '')
    .trim() || 'the app';
}

/**
 * What the VIEWER should do, as distinct from what the campaign is for.
 *
 * ROOT CAUSE THIS FIXES. `ctaIntent` was assigned `candidate.objective`, so a
 * campaign whose objective was "Generate organic awareness among professional
 * homeowners" carried that sentence as its call to action. No viewer has ever
 * been asked to generate organic awareness. Three different things had been
 * collapsed into one field:
 *
 *   CAMPAIGN OBJECTIVE   what the business wants  → lives on the opportunity
 *   VIEWER CTA INTENT    what the reader should do → this function
 *   CTA DESTINATION      where they are sent       → owner-confirmed, elsewhere
 *
 * No migration is needed: the objective is already persisted on
 * `saved_opportunities.objective`, so `cta_intent` was never the right home for
 * it. Historical rows keep whatever they were written with — they are snapshots
 * — and only new composition uses the corrected meaning.
 *
 * @security Derived from the opportunity's own shape, never invented. Returns
 *   null when nothing in the context supports an action, because a call to
 *   action nobody can fulfil is worse than none. A DESTINATION is never produced
 *   here — that stays owner-confirmed.
 */
export function deriveViewerCtaIntent(
  candidate: OpportunityCandidate, ctx: ProductContentContext,
): string | null {
  const objective = `${candidate.objective ?? ''} ${candidate.messageAngle ?? ''}`.toLowerCase();
  // The stored name is often the scraped PAGE title ("AllignX・Home Services
  // App - App Store"). A call to action must read like a sentence, so the store
  // suffix is trimmed for display. The stored name is not modified.
  const named = displayProductName(ctx.application.name);

  // Awareness and shareability plays ask for attention, not a transaction.
  if (candidate.contentOpportunityType === 'VIRAL_GROWTH'
      || /awareness|organic|reach|share/.test(objective)) {
    return `See how ${named} works`;
  }
  if (/install|download|sign ?up|trial|register/.test(objective)) {
    return 'Get started';
  }
  if (/book|schedule|appointment|request|quote/.test(objective)) {
    return 'Find help near you';
  }
  if (/learn|understand|educate|explain/.test(objective)) {
    return 'Learn more';
  }
  // A product with nothing confirmed about where it sends people gets the
  // weakest honest ask rather than an invented one.
  return ctx.application.description ? 'Learn more' : null;
}

export function deriveCampaignArchitecture(
  candidate: OpportunityCandidate, ctx: ProductContentContext,
): CampaignMessageArchitecture {
  const cited = new Set(candidate.evidenceRefs);
  const proofAvailable = ctx.evidence.filter(h => cited.has(h.ref)).map(h => h.label);

  const proofUnavailable: string[] = [];
  if (proofAvailable.length === 0) proofUnavailable.push('no evidence supports this message yet');
  if (ctx.authorizedAssets.length === 0) proofUnavailable.push('no authorised product imagery');
  if (!ctx.marketIntelligenceAvailable) proofUnavailable.push('no current market observation');
  for (const f of CAMPAIGN_OWNER_CONFIRMATION_REQUIRED) {
    proofUnavailable.push(`${f} requires your confirmation`);
  }

  const channels = recommendChannels({
    contentOpportunityType: candidate.contentOpportunityType,
    objective: candidate.objective,
    audienceHypothesis: candidate.audienceHypothesis,
    authorizedAssetCount: ctx.authorizedAssets.length,
    hasEvidence: proofAvailable.length > 0,
  });
  const pkg = recommendContentPackage(channels);

  return {
    name: candidate.title,
    thesis: candidate.messageAngle,
    campaignObjective: candidate.objective || null,
    audience: candidate.audienceHypothesis,
    coreProblem: candidate.whyNow || null,
    messageAngle: candidate.messageAngle,
    productRole: ctx.application.name ? `${ctx.application.name} is how this gets solved` : null,
    primaryBenefit: candidate.objective || null,
    objections: [],
    // The VIEWER's action, not the campaign's objective — see
    // deriveViewerCtaIntent. The DESTINATION stays owner-confirmed.
    ctaIntent: deriveViewerCtaIntent(candidate, ctx),
    proofAvailable,
    proofUnavailable,
    recommendedChannels: channels.map(c => c.channel),
    contentPackage: pkg.items,
    packageNotes: pkg.notes,
    brandDirectives: brandConstraints(ctx),
    prohibitedTerms: [...ctx.prohibitedTerms],
  };
}

export class ContentCampaignError extends Error {
  constructor(message: string) { super(message); this.name = 'ContentCampaignError'; }
}

/**
 * Creates a content campaign from an opportunity.
 *
 * @security Lineage is REQUIRED: an opportunity id that does not exist in THIS
 *   workspace is refused, so a campaign cannot be orphaned from the reason it
 *   was created or adopted from another business.
 */
export async function createContentCampaign(opts: {
  ctx: ProductContentContext; founderId: string; opportunityId: string;
  candidate: OpportunityCandidate; persistId?:string; architecture?:CampaignMessageArchitecture;
}): Promise<{ id: string | null; architecture: CampaignMessageArchitecture }> {
  const db = getSupabaseAdmin();

  const { data: opp } = await db.from('saved_opportunities')
    .select('id, product_id')
    .eq('id', opts.opportunityId)
    .eq('workspace_id', opts.ctx.workspaceId)
    .maybeSingle();
  const row = opp as { id?: string; product_id?: string } | null;
  // 404-shaped: a caller must not learn that another workspace's opportunity exists.
  if (!row) throw new ContentCampaignError('Not found.');
  if (row.product_id && row.product_id !== opts.ctx.productId) {
    throw new ContentCampaignError('That opportunity belongs to a different product.');
  }

  const architecture = opts.architecture ?? deriveCampaignArchitecture(opts.candidate, opts.ctx);

  const values = {
    ...(opts.persistId ? {id:opts.persistId} : {}),
    workspace_id: opts.ctx.workspaceId,
    product_id: opts.ctx.productId,
    founder_id: opts.founderId,
    opportunity_id: opts.opportunityId,
    name: architecture.name,
    thesis: architecture.thesis,
    audience: architecture.audience,
    core_problem: architecture.coreProblem,
    message_angle: architecture.messageAngle,
    product_role: architecture.productRole,
    primary_benefit: architecture.primaryBenefit,
    objections: architecture.objections,
    cta_intent: architecture.ctaIntent,
    proof_available: architecture.proofAvailable,
    proof_unavailable: architecture.proofUnavailable,
    recommended_channels: architecture.recommendedChannels,
    content_package: architecture.contentPackage,
    brand_kit_version: opts.ctx.brand.version,
    status: 'DRAFT',
    mode: 'SHADOW',
  };
  const table=db.from('content_campaigns');
  const {data,error}=await (opts.persistId ? table.upsert(values,{onConflict:'id',ignoreDuplicates:true}) : table.insert(values)).select('id').maybeSingle();
  if (error) throw new ContentCampaignError(error.message);

  return { id: (data as { id?: string } | null)?.id ?? opts.persistId ?? null, architecture };
}
