/**
 * @file ownerDirectedIntent.ts
 * @description "Create something else" — the owner-directed content path.
 *
 *   An AI CMO must be able to take an instruction. The danger in taking one is
 *   that a request phrased as a fact ("say our conversion is 80% higher") reads
 *   like permission to assert it. It is not, and the split enforced here is the
 *   reason:
 *
 *     LaunchMind may UNDERSTAND what the owner wants.
 *     LaunchMind may not treat what the owner wants as TRUE.
 *
 *   Structurally: this module never writes to the evidence set and never passes
 *   the owner's sentence anywhere that produces `proofAvailable`. That field is
 *   computed by deriveCampaignArchitecture from `ctx.evidence` filtered by the
 *   candidate's cited refs, and candidate refs are validated against the refs
 *   actually issued for this product. An owner sentence therefore has no path to
 *   becoming proof, whatever it says.
 *
 *   INTERPRETATION BEFORE GENERATION. The owner sees what LaunchMind understood
 *   — objective, audience, message, the product's role, why it fits, what it
 *   would create and what it still needs — and can adjust or cancel BEFORE
 *   anything is written. A prompt that goes straight to content is a generator
 *   wearing a CMO's clothes.
 *
 * @security The owner's text enters generation fenced and explicitly labelled as
 *   direction (see contentOpportunityService). Everything it inspires is then
 *   governed by the same claim engine as any other copy.
 * @dependencies contentOpportunityService · contentCampaignService ·
 *   strategyComposition · briefComposition · directionAdjustment (disclosure only)
 */

import type { ProductContentContext } from './productContentContext';
import type { OpportunityCandidate } from '../opportunity/contentOpportunityPolicy';
import { generateContentOpportunities, persistContentOpportunity } from '../opportunity/contentOpportunityService';
import { deriveCampaignArchitecture, createContentCampaign } from '../opportunity/contentCampaignService';
import { deriveContentStrategy, persistContentStrategy } from './strategyComposition';
import { deriveBriefSet, persistContentBrief, B3_CHANNELS, type B3Channel } from './briefComposition';
import { directionCannotProve } from './directionAdjustment';

export class OwnerDirectedError extends Error {
  constructor(message: string) { super(message); this.name = 'OwnerDirectedError'; }
}

/** The starting points an owner picks from. Marketing language only. */
export const OWNER_DIRECTED_SUGGESTIONS = [
  'Promote a new feature',
  'Explain an important product benefit',
  'Create messaging for an announcement',
  'Build a campaign around a launch',
  'Help people understand why this product is different',
] as const;

export interface OwnerDirectedInterpretation {
  /** Echoed so the owner can see exactly what was read. */
  request: string;
  objective: string;
  audience: string;
  message: string;
  productRole: string;
  whyThisFits: string[];
  recommends: Array<{ channel: string; label: string; why: string }>;
  stillNeeds: string[];
  /** What this request cannot make true. Empty for an ordinary request. */
  cannotProve: string[];
  /** True when the model could not be reached; the owner is told, not guessed at. */
  degraded: boolean;
  /** Server-held candidate, echoed back on apply. Not authority — revalidated. */
  candidate: OpportunityCandidate;
}

const CHANNEL_LABEL: Record<string, string> = {
  GOOGLE_RSA: 'Google search ad', META_AD: 'Meta ad', LANDING_PAGE: 'Landing page',
  LINKEDIN_POST: 'LinkedIn post', SHORT_FORM_VIDEO_SCRIPT: 'Short video script',
};

function toB3(raw: readonly string[]): B3Channel[] {
  const allowed = new Set<string>(B3_CHANNELS);
  const seen = new Set<string>();
  const out: B3Channel[] = [];
  for (const c of raw) {
    const up = String(c).toUpperCase();
    if (allowed.has(up) && !seen.has(up)) { seen.add(up); out.push(up as B3Channel); }
  }
  return out;
}

/**
 * Reads an owner request into a marketing interpretation. Writes NOTHING.
 *
 * @param ownerRequest what the owner typed, in their own words
 * @throws {OwnerDirectedError} when nothing usable could be understood — said
 *   plainly rather than filled in with a plausible campaign the owner never asked for
 * @security The interpretation is derived from the PRODUCT context. Two products
 *   given the same sentence produce different interpretations because audience,
 *   evidence, brand and authorised assets differ — the request steers, the
 *   product decides.
 */
export async function interpretOwnerRequest(opts: {
  ctx: ProductContentContext; founderId: string; ownerRequest: string;
  generate?: (prompt: string) => Promise<string>;
}): Promise<OwnerDirectedInterpretation> {
  const request = opts.ownerRequest.trim();
  if (request.length < 4) throw new OwnerDirectedError('Tell me a little more about what you want to market.');

  const result = await generateContentOpportunities({
    ctx: opts.ctx, origin: 'OWNER_DIRECTED', ownerRequest: request,
    founderId: opts.founderId, generate: opts.generate,
  });

  const top = result.prioritised[0]?.candidate;
  if (!top) {
    throw new OwnerDirectedError(
      result.degraded
        ? 'I could not work that out just now. Try again in a moment.'
        : 'I could not turn that into something I can market truthfully yet. Try describing the outcome you want customers to understand.',
    );
  }

  const architecture = deriveCampaignArchitecture(top, opts.ctx);
  const channels = toB3(architecture.recommendedChannels);

  const whyThisFits: string[] = [];
  if (opts.ctx.application.name) {
    whyThisFits.push(`${opts.ctx.application.name} is what this message is about`);
  }
  if (opts.ctx.founderDirection.audienceConfirmed) {
    whyThisFits.push(`It speaks to ${opts.ctx.founderDirection.audienceConfirmed}, the audience you confirmed`);
  }
  if (architecture.proofAvailable.length > 0) {
    whyThisFits.push(`Your current evidence supports part of it: ${architecture.proofAvailable.join(', ')}`);
  }
  if (opts.ctx.brand.fields.tone?.ownerConfirmed) {
    whyThisFits.push(`It will be written in the tone you confirmed`);
  }
  if (whyThisFits.length === 0) whyThisFits.push('It follows from how your product is positioned');

  const stillNeeds: string[] = [];
  if (architecture.proofAvailable.length === 0) {
    stillNeeds.push('Evidence, if you want this to make a measurable claim');
  }
  if (opts.ctx.authorizedAssets.length === 0) {
    stillNeeds.push('Product imagery you authorise LaunchMind to use');
  }
  if (!opts.ctx.brand.fields.cta_destination?.ownerConfirmed) {
    stillNeeds.push('Where this should send people');
  }
  if (!opts.ctx.brand.fields.tone?.ownerConfirmed) {
    stillNeeds.push('Your brand tone, so this sounds like you');
  }

  return {
    request,
    objective: architecture.primaryBenefit || top.objective,
    audience: architecture.audience,
    message: architecture.messageAngle,
    productRole: architecture.productRole
      ?? 'Your product is what makes this possible',
    whyThisFits,
    recommends: channels.map(c => ({
      channel: c, label: CHANNEL_LABEL[c] ?? c,
      why: architecture.packageNotes[0] ?? 'It suits this message and audience',
    })),
    stillNeeds,
    cannotProve: directionCannotProve({ messageEmphasis: request }),
    degraded: result.degraded,
    candidate: top,
  };
}

export interface OwnerDirectedApplyResult {
  opportunityId: string;
  campaignId: string;
  strategyId: string;
  briefIds: Record<string, string>;
  channels: B3Channel[];
}

/**
 * Commits an interpretation the owner accepted: opportunity → campaign →
 * strategy → briefs. Generates no content — the owner decides that next.
 *
 * @security The candidate is re-derived through the same architecture and
 *   strategy functions used by the recommended path, so an owner-directed
 *   campaign is governed identically to one LaunchMind proposed itself.
 */
export async function applyOwnerDirected(opts: {
  ctx: ProductContentContext; founderId: string; candidate: OpportunityCandidate;
}): Promise<OwnerDirectedApplyResult> {
  const { ctx, founderId, candidate } = opts;

  const opportunityId = await persistContentOpportunity({
    ctx, founderId, origin: 'OWNER_DIRECTED', candidate,
  });
  if (!opportunityId) throw new OwnerDirectedError('Could not save this.');

  const { id: campaignId, architecture } =
    await createContentCampaign({ ctx, founderId, opportunityId, candidate });
  if (!campaignId) throw new OwnerDirectedError('Could not save this.');

  const strategy = deriveContentStrategy({ ctx, architecture });
  const strategyId = await persistContentStrategy(strategy, { founderId, campaignId });
  if (!strategyId) throw new OwnerDirectedError('Could not save this.');

  const channels = toB3(architecture.recommendedChannels);
  const briefIds: Record<string, string> = {};
  for (const b of deriveBriefSet(channels, strategy, ctx)) {
    const id = await persistContentBrief(b, { founderId, strategyId, campaignId });
    if (id) briefIds[b.channel] = id;
  }

  return { opportunityId, campaignId, strategyId, briefIds, channels };
}
