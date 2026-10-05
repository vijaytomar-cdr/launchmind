/**
 * @file briefComposition.ts
 * @description Channel briefs from one strategy — ADR-071 §11, Phase 3.5B3.
 *
 *   One strategy, many channel briefs. Each brief is a SNAPSHOT: it records what
 *   was decided, so an artifact generated from it can be explained months later
 *   even after the strategy moves on.
 *
 *   THE PART THAT MATTERS MOST is `ownerConfirmationRequired`. A brief that
 *   leaves a CTA destination, an offer or a price blank invites the model to
 *   fill it in, and a fabricated destination is a customer sent somewhere real.
 *   Those fields are named as UNRESOLVED rather than defaulted, so the gap is
 *   visible to the owner and to generation.
 *
 * @security Only AUTHORIZED assets are referenced. Observed imagery is never
 *   offered to a brief, so a visual direction cannot quietly plan around a
 *   competitor screenshot.
 * @dependencies strategyComposition, productContentContext, channelValidators
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { ContentStrategy } from './strategyComposition';
import type { ProductContentContext } from './productContentContext';

export const B3_CHANNELS = [
  'GOOGLE_RSA', 'META_AD', 'LANDING_PAGE', 'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT',
] as const;
export type B3Channel = typeof B3_CHANNELS[number];

export const CONTENT_FAMILY: Record<B3Channel, string> = {
  GOOGLE_RSA: 'ACQUISITION',
  META_AD: 'ACQUISITION',
  LANDING_PAGE: 'CONVERSION',
  LINKEDIN_POST: 'ORGANIC',
  SHORT_FORM_VIDEO_SCRIPT: 'ORGANIC',
};

/** How loudly the product should be branded on this surface. */
export type BrandingPresence = 'PROMINENT' | 'SUPPORTING' | 'MINIMAL';

/** Fields a model must never invent. Named, not defaulted. */
export const OWNER_CONFIRMATION_FIELDS = [
  'ctaDestination', 'offer', 'pricing', 'certification', 'guarantee', 'endorsement',
] as const;
export type OwnerConfirmationField = typeof OWNER_CONFIRMATION_FIELDS[number];

export interface ContentBrief {
  channel: B3Channel;
  contentFamily: string;
  workspaceId: string;
  productId: string;
  audience: string;
  objective: string;
  message: string;
  hookDirection: string;
  ctaIntent: string | null;
  /** null until the owner supplies it. Never guessed. */
  ctaDestination: string | null;
  offer: string | null;
  tone: string | null;
  brandConstraints: string[];
  prohibitedTerminology: string[];
  proofAvailable: string[];
  proofUnavailable: string[];
  brandingPresence: BrandingPresence;
  /** Owner-safe labels of AUTHORIZED assets only. */
  authorizedAssetRefs: string[];
  visualDirection: string | null;
  channelConstraints: string[];
  ownerConfirmationRequired: OwnerConfirmationField[];
  brandKitVersion: number;
}

const CHANNEL_CONSTRAINTS: Record<B3Channel, string[]> = {
  GOOGLE_RSA: ['3–15 headlines, each ≤30 characters', '2–4 descriptions, each ≤90 characters',
               'no repeated punctuation', 'no all-caps words'],
  META_AD: ['primary text truncates in feed after ~125 characters',
            'headline ≤40 characters', 'description ≤30 characters'],
  LANDING_PAGE: ['H1 target ≤70 characters (hard cap 84)', 'subhead ≤160 characters', 'at least one CTA ≤25 characters'],
  LINKEDIN_POST: ['first two lines decide whether it is expanded', 'no hashtag stuffing'],
  SHORT_FORM_VIDEO_SCRIPT: ['hook lands in the first 2 seconds', 'vertical 9:16',
                            'on-screen text must be readable without sound'],
};

/** Branding presence follows the surface, not a global preference. */
function brandingFor(channel: B3Channel, hasAuthorizedLogo: boolean): BrandingPresence {
  if (!hasAuthorizedLogo) return 'MINIMAL';
  switch (channel) {
    case 'META_AD': case 'SHORT_FORM_VIDEO_SCRIPT': return 'PROMINENT';
    case 'LANDING_PAGE': return 'SUPPORTING';
    // A search ad is read as text and a LinkedIn post carries the poster's
    // identity already; stamping a logo into either is noise, not branding.
    case 'GOOGLE_RSA': case 'LINKEDIN_POST': return 'MINIMAL';
  }
}

const HOOKS: Record<B3Channel, (s: ContentStrategy) => string> = {
  GOOGLE_RSA: s => `match the intent behind "${s.audience}" searching for this problem`,
  META_AD: s => `interrupt the scroll with the problem, not the product: ${s.coreNarrative}`,
  LANDING_PAGE: s => `state the thesis plainly, then show the proof: ${s.campaignThesis}`,
  LINKEDIN_POST: s => `open with the tension your audience recognises: ${s.campaignThesis}`,
  SHORT_FORM_VIDEO_SCRIPT: s => `show the problem in two seconds: ${s.campaignThesis}`,
};

/**
 * Derives one channel brief. PURE.
 *
 * @security `ownerConfirmationRequired` lists every governed field this brief
 *   could not resolve. Generation must treat each as unavailable rather than
 *   inventing a value.
 */
export function deriveContentBrief(
  channel: B3Channel, strategy: ContentStrategy, ctx: ProductContentContext,
  supplied: { ctaDestination?: string | null; offer?: string | null } = {},
): ContentBrief {
  const logo = ctx.brand.fields.logo;
  const hasAuthorizedLogo = logo?.ownerConfirmed === true && ctx.authorizedAssets.length > 0;

  const unresolved: OwnerConfirmationField[] = [];
  if (!supplied.ctaDestination) unresolved.push('ctaDestination');
  if (!supplied.offer) unresolved.push('offer');
  // Pricing, certification, guarantee and endorsement are unresolved unless the
  // owner confirmed them — LaunchMind cannot read a SOC 2 report or a price list.
  for (const f of ['pricing', 'certification', 'guarantee', 'endorsement'] as const) {
    if (!ctx.brand.fields[f]?.ownerConfirmed) unresolved.push(f);
  }

  const needsVisual = channel === 'META_AD' || channel === 'SHORT_FORM_VIDEO_SCRIPT'
    || channel === 'LANDING_PAGE';

  return {
    channel, contentFamily: CONTENT_FAMILY[channel],
    workspaceId: strategy.workspaceId, productId: strategy.productId,
    audience: strategy.audience,
    objective: strategy.objective,
    message: strategy.campaignThesis,
    hookDirection: HOOKS[channel](strategy),
    ctaIntent: strategy.ctaIntent,
    ctaDestination: supplied.ctaDestination ?? null,
    offer: supplied.offer ?? null,
    tone: ctx.brand.fields.tone?.ownerConfirmed ? String(ctx.brand.fields.tone.value) : null,
    brandConstraints: strategy.brandDirectives,
    prohibitedTerminology: strategy.prohibitedTerminology,
    proofAvailable: strategy.proofAvailable,
    proofUnavailable: strategy.proofUnavailable,
    brandingPresence: brandingFor(channel, hasAuthorizedLogo),
    // AUTHORIZED only. Observed assets are not offered here at all.
    authorizedAssetRefs: ctx.authorizedAssets.map(a =>
      `${String(a.assetType ?? 'image').toLowerCase()} you authorised`),
    visualDirection: needsVisual
      ? (ctx.authorizedAssets.length > 0
          ? `use your authorised product imagery to show ${strategy.primaryBenefit ?? 'the outcome'}`
          : 'no authorised product imagery is available; describe the outcome without depicting the product UI')
      : null,
    channelConstraints: CHANNEL_CONSTRAINTS[channel],
    ownerConfirmationRequired: unresolved,
    brandKitVersion: ctx.brand.version,
  };
}

/** Derives one brief per recommended channel, from ONE strategy. */
export function deriveBriefSet(
  channels: readonly B3Channel[], strategy: ContentStrategy, ctx: ProductContentContext,
  supplied: { ctaDestination?: string | null; offer?: string | null } = {},
): ContentBrief[] {
  return channels.map(c => deriveContentBrief(c, strategy, ctx, supplied));
}

export async function persistContentBrief(
  brief: ContentBrief,
  opts: { founderId: string; strategyId: string; campaignId: string; persistId?:string },
): Promise<string | null> {
  const values = {
    ...(opts.persistId ? {id:opts.persistId} : {}),
    strategy_id: opts.strategyId, content_campaign_id: opts.campaignId,
    workspace_id: brief.workspaceId, product_id: brief.productId, founder_id: opts.founderId,
    content_channel: brief.channel.toLowerCase(),
    objective: brief.objective, audience: brief.audience, key_message: brief.message,
    tone: brief.tone, cta_text: brief.ctaIntent, cta_destination: brief.ctaDestination,
    offer: brief.offer, constraints: brief.channelConstraints,
    owner_confirmed: [], evidence_summary: brief.proofAvailable,
    mode: 'SHADOW',
  };
  const table=getSupabaseAdmin().from('content_briefs');
  const {data,error}=await (opts.persistId ? table.upsert(values,{onConflict:'id',ignoreDuplicates:true}) : table.insert(values)).select('id').maybeSingle();
  if (error) throw new Error(`brief persist failed: ${error.message}`);
  return (data as { id?: string } | null)?.id ?? opts.persistId ?? null;
}
