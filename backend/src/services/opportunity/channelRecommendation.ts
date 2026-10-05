/**
 * @file channelRecommendation.ts
 * @description Which channels a content opportunity belongs on — ADR-071 §12/§13.
 *
 *   PURE. The owner should not have to know where content belongs; that is the
 *   AI CMO's job. This module decides from the OPPORTUNITY, never from what
 *   LaunchMind happens to be able to execute.
 *
 *   THE RULE THAT SHAPES THIS FILE: provider credentials and execution
 *   availability are NOT evidence that a channel is strategically correct.
 *   "We have a Google Ads token" is a fact about plumbing, not about marketing,
 *   and letting it drive the recommendation is how a product starts advising
 *   whatever it happens to be wired to.
 *
 * @security Recommends only channels the frozen pipeline can actually govern.
 *   Asset-dependent channels are withheld when no AUTHORIZED asset exists, so a
 *   recommendation never implies imagery the owner cannot lawfully use.
 * @dependencies none (pure)
 */

export const RECOMMENDABLE_CHANNELS = [
  'GOOGLE_RSA', 'META_AD', 'LANDING_PAGE', 'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT',
] as const;
export type RecommendableChannel = typeof RECOMMENDABLE_CHANNELS[number];

export interface ChannelRecommendation {
  channel: RecommendableChannel;
  /** Owner-safe reason. Never "you have a token for it". */
  reason: string;
  /** Suggested number of artifacts. Bounded and small on purpose. */
  quantity: number;
  /** True when this channel normally wants imagery we do not have. */
  assetConstrained: boolean;
}

export interface ChannelInputs {
  contentOpportunityType: string;
  objective: string;
  audienceHypothesis: string;
  /** Count of AUTHORIZED assets. Observed assets deliberately do not count. */
  authorizedAssetCount: number;
  hasEvidence: boolean;
}

const B2B_SIGNALS = ['b2b', 'agency', 'agencies', 'founder', 'saas', 'team', 'enterprise', 'operator'];

/**
 * Recommends channels for one opportunity.
 *
 * @returns an ordered, bounded list — never every channel, because "create
 *   everything everywhere" is not a marketing decision
 */
export function recommendChannels(input: ChannelInputs): ChannelRecommendation[] {
  const out: ChannelRecommendation[] = [];
  const audience = `${input.audienceHypothesis} ${input.objective}`.toLowerCase();
  const type = input.contentOpportunityType;
  const isB2B = B2B_SIGNALS.some(s => audience.includes(s));

  const add = (channel: RecommendableChannel, reason: string, quantity: number,
               assetConstrained = false) =>
    out.push({ channel, reason, quantity, assetConstrained });

  // Intent-led demand capture: only worth it when there is something to promise
  // and evidence behind it.
  if (['PRODUCT_FEATURE', 'PRODUCT_BENEFIT', 'COMPETITOR_GAP', 'PRODUCT_LAUNCH'].includes(type)) {
    add('GOOGLE_RSA', 'people already searching for this problem can be met directly', 1);
  }
  // Paid social carries imagery. Recommended either way, but flagged when we
  // hold nothing the owner may lawfully publish.
  if (['PRODUCT_BENEFIT', 'MARKET_MOMENT', 'SOCIAL_PROOF', 'PRODUCT_LAUNCH', 'SEASONAL'].includes(type)) {
    add('META_AD', 'a visual audience responds to this kind of message', 3,
        input.authorizedAssetCount === 0);
  }
  // A landing page is where a claim has room to be substantiated.
  if (input.hasEvidence
      && ['PRODUCT_FEATURE', 'PRODUCT_LAUNCH', 'COMPETITOR_GAP', 'PRODUCT_BENEFIT'].includes(type)) {
    add('LANDING_PAGE', 'this message needs room to show the proof behind it', 1);
  }
  if (isB2B || ['THOUGHT_LEADERSHIP', 'CUSTOMER_EDUCATION', 'COMPETITOR_GAP'].includes(type)) {
    add('LINKEDIN_POST', 'your audience discusses this professionally', 1);
  }
  if (['VIRAL_GROWTH', 'CUSTOMER_EDUCATION', 'PRODUCT_LAUNCH', 'MARKET_MOMENT'].includes(type)) {
    add('SHORT_FORM_VIDEO_SCRIPT', 'a short demonstration travels further than a description', 2);
  }

  // Never nothing: a product truth can always be said somewhere.
  if (out.length === 0) {
    add('LANDING_PAGE', 'this is a durable product message worth stating clearly', 1);
  }
  return out;
}

export interface ContentPackageItem {
  channel: RecommendableChannel;
  quantity: number;
  reason: string;
  /** Withheld until the owner authorises imagery. */
  blockedOnAssets: boolean;
}

/**
 * The package LaunchMind would create — the answer to "here's what I'd do".
 *
 * @security Items are RECOMMENDATIONS. Nothing here is generated, approved or
 *   executable, and an asset-constrained item says so rather than quietly
 *   planning to use imagery the owner has not authorised.
 */
export function recommendContentPackage(
  channels: readonly ChannelRecommendation[],
): { items: ContentPackageItem[]; totalArtifacts: number; notes: string[] } {
  const items = channels.map(c => ({
    channel: c.channel, quantity: c.quantity, reason: c.reason,
    blockedOnAssets: c.assetConstrained,
  }));
  const notes: string[] = [];
  if (items.some(i => i.blockedOnAssets)) {
    notes.push('Some formats need product imagery you have not authorised yet.');
  }
  return {
    items,
    totalArtifacts: items.filter(i => !i.blockedOnAssets).reduce((n, i) => n + i.quantity, 0),
    notes,
  };
}
