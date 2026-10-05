/**
 * @file contentPackagePolicy.ts
 * @description Content Package — what to create together, and its limits. B4.
 *
 *   PURE. The package is the answer to "here is what I would make", which is the
 *   sentence that separates an AI CMO from a prompt box.
 *
 *   NO NEW TABLE. `content_campaigns.content_package` (migration 117) is already
 *   a JSONB column on the object the package belongs to: a package is WHAT THIS
 *   CAMPAIGN SHOULD PRODUCE, it has no identity apart from its campaign, and it
 *   is replaced wholesale when the plan changes rather than accumulating rows.
 *   A separate table would add a lifecycle nothing needs.
 *
 *   BOUNDED ON PURPOSE. The limits below optimise for strategic completeness,
 *   channel fit, testing value and — the one people forget — OWNER REVIEW
 *   BURDEN. A system rewarded for output produces spam, and a package nobody can
 *   read is the same as no package.
 *
 *   ONE BLOCKED ITEM IS NOT A FAILED PACKAGE. Each item carries its own
 *   readiness, so a missing avatar preference withholds the video and leaves the
 *   other four channels usable.
 *
 * @security A package plans; it never generates, approves, publishes or spends.
 * @dependencies channelRecommendation (types only)
 */

import type { RecommendableChannel } from '../opportunity/channelRecommendation';

/** Deliberately small. See the file header on review burden. */
export const PACKAGE_LIMITS = {
  maxChannels: 5,
  maxVariantsPerChannel: 3,
  maxTotalArtifacts: 10,
} as const;

export const PACKAGE_ITEM_STATES = [
  'READY_TO_GENERATE',
  'BLOCKED_ON_OWNER_CONFIRMATION',
  'BLOCKED_ON_ASSET',
  'BLOCKED_ON_PROOF',
  'UNSUPPORTED_CHANNEL',
] as const;
export type PackageItemState = typeof PACKAGE_ITEM_STATES[number];

/** Variants are intentional strategic alternatives, never reworded copies. */
export const VARIANT_DIMENSIONS = [
  'HOOK_VARIANT', 'ANGLE_VARIANT', 'TONE_VARIANT', 'PROOF_VARIANT', 'CTA_VARIANT',
] as const;
export type VariantDimension = typeof VARIANT_DIMENSIONS[number];

export interface VariantPlan {
  dimension: VariantDimension;
  label: string;
  /** What this variant changes. Owner-safe. */
  intent: string;
}

export interface PackageItem {
  channel: RecommendableChannel;
  quantity: number;
  state: PackageItemState;
  /** Owner-safe reason this item exists. */
  reason: string;
  /** Owner-safe reason it is blocked, when it is. */
  blockedReason: string | null;
  variants: VariantPlan[];
}

export interface ContentPackage {
  campaignId: string | null;
  items: PackageItem[];
  totalPlannedArtifacts: number;
  /** Items an owner can act on right now. */
  readyCount: number;
  blockedCount: number;
  notes: string[];
  /** What LaunchMind suggests looking at first, and why. */
  reviewFirst: { channel: RecommendableChannel; reason: string } | null;
}

export interface PackageInputs {
  campaignId: string | null;
  channels: readonly RecommendableChannel[];
  authorizedAssetCount: number;
  hasEvidence: boolean;
  /** Governed fields still unresolved, e.g. ctaDestination, offer, pricing. */
  ownerConfirmationRequired: readonly string[];
  /** Owner has chosen an avatar/voice for video. Product config, not env. */
  avatarVoiceChosen: boolean;
  /**
   * The video mode this package would actually use.
   *
   * DEFAULTS TO PRODUCT_MOTION because `decideVideoMode` does. Only
   * AVATAR_SPOKESPERSON puts a person on screen, and only that mode needs a
   * presenter — see the block in `planContentPackage` for what this fixes.
   */
  videoMode?: 'PRODUCT_MOTION' | 'AVATAR_SPOKESPERSON' | 'VOICEOVER_CREATIVE';
  opportunityType: string;
}

/** Variant plans per channel. Only where alternatives genuinely help. */
function variantsFor(channel: RecommendableChannel, hasEvidence: boolean): VariantPlan[] {
  if (channel === 'META_AD') {
    const base: VariantPlan[] = [
      { dimension: 'ANGLE_VARIANT', label: 'pain-led',
        intent: 'open on the problem the audience already feels' },
      { dimension: 'ANGLE_VARIANT', label: 'benefit-led',
        intent: 'open on the outcome the product makes possible' },
    ];
    // A proof-led variant with nothing to prove would be a variant that has to
    // invent something, which is the failure mode this whole subsystem exists
    // to prevent.
    if (hasEvidence) base.push({ dimension: 'PROOF_VARIANT', label: 'proof-led',
      intent: 'lead with the evidence LaunchMind can actually stand behind' });
    return base;
  }
  if (channel === 'SHORT_FORM_VIDEO_SCRIPT') {
    return [
      { dimension: 'HOOK_VARIANT', label: 'question-hook', intent: 'open with the audience\'s own question' },
      { dimension: 'HOOK_VARIANT', label: 'demonstration-hook', intent: 'open by showing the problem happening' },
    ];
  }
  return [];
}

const CHANNEL_REASON: Record<RecommendableChannel, string> = {
  GOOGLE_RSA: 'people already searching for this problem can be met directly',
  META_AD: 'a visual audience responds to this kind of message',
  LANDING_PAGE: 'this message needs room to show the proof behind it',
  LINKEDIN_POST: 'your audience discusses this professionally',
  SHORT_FORM_VIDEO_SCRIPT: 'a short demonstration travels further than a description',
};

/**
 * Plans the package. PURE.
 *
 * @security Readiness is computed from what is ACTUALLY available — authorized
 *   assets, resolved owner decisions, eligible evidence. An item is never marked
 *   ready on the assumption that something will be supplied later.
 */
export function planContentPackage(input: PackageInputs): ContentPackage {
  const channels = [...new Set(input.channels)].slice(0, PACKAGE_LIMITS.maxChannels);
  const items: PackageItem[] = [];
  let budget = PACKAGE_LIMITS.maxTotalArtifacts;

  for (const channel of channels) {
    let state: PackageItemState = 'READY_TO_GENERATE';
    let blockedReason: string | null = null;

    // Order matters: the most specific blocker is the most useful to an owner.
    //
    // SHORT VIDEO IS NOT SYNONYMOUS WITH A TALKING HEAD, and this line used to
    // assume it was. Every short-video item was blocked on "choose a presenter
    // and voice" regardless of mode, while `decideVideoMode` was independently
    // defaulting the very same brief to PRODUCT_MOTION — a mode that needs no
    // presenter, no avatar, no voice and no HeyGen at all. Two parts of the
    // system disagreed about the same video, and the owner was shown the
    // pessimistic one: a decision LaunchMind was asking them to make about a
    // person who was never going to appear.
    //
    // Only AVATAR_SPOKESPERSON requires a presenter. VOICEOVER_CREATIVE
    // requires a voice and no face. PRODUCT_MOTION requires neither, and is
    // ready as soon as there is product imagery to move.
    const videoMode = input.videoMode ?? 'PRODUCT_MOTION';
    if (channel === 'SHORT_FORM_VIDEO_SCRIPT'
        && videoMode === 'AVATAR_SPOKESPERSON' && !input.avatarVoiceChosen) {
      state = 'BLOCKED_ON_OWNER_CONFIRMATION';
      blockedReason = 'choose a presenter and voice before this can be produced';
    } else if (channel === 'SHORT_FORM_VIDEO_SCRIPT'
               && videoMode === 'VOICEOVER_CREATIVE' && !input.avatarVoiceChosen) {
      state = 'BLOCKED_ON_OWNER_CONFIRMATION';
      blockedReason = 'choose a voice before this can be produced';
    } else if (channel === 'META_AD' && input.authorizedAssetCount === 0) {
      state = 'BLOCKED_ON_ASSET';
      blockedReason = 'no product imagery you have authorised for marketing use';
    } else if (channel === 'LANDING_PAGE' && !input.hasEvidence) {
      state = 'BLOCKED_ON_PROOF';
      blockedReason = 'a landing page needs proof, and none is available yet';
    } else if (input.ownerConfirmationRequired.includes('ctaDestination')
               && (channel === 'GOOGLE_RSA' || channel === 'META_AD')) {
      state = 'BLOCKED_ON_OWNER_CONFIRMATION';
      blockedReason = 'confirm where this should send people';
    }

    const variants = variantsFor(channel, input.hasEvidence)
      .slice(0, PACKAGE_LIMITS.maxVariantsPerChannel);
    const wanted = Math.max(1, variants.length);
    const quantity = Math.min(wanted, Math.max(0, budget));
    if (quantity === 0) break;                 // total ceiling reached
    budget -= quantity;

    items.push({
      channel, quantity, state,
      reason: CHANNEL_REASON[channel],
      blockedReason,
      variants: variants.slice(0, quantity),
    });
  }

  const ready = items.filter(i => i.state === 'READY_TO_GENERATE');
  const notes: string[] = [];
  if (items.some(i => i.state === 'BLOCKED_ON_ASSET')) {
    notes.push('Some formats need product imagery you have not authorised yet.');
  }
  if (items.some(i => i.state === 'BLOCKED_ON_OWNER_CONFIRMATION')) {
    notes.push('Some items are waiting on a decision only you can make.');
  }
  if (items.some(i => i.state === 'BLOCKED_ON_PROOF')) {
    notes.push('Some items need evidence LaunchMind does not hold yet.');
  }

  // Review-first is the highest-leverage READY item, not the biggest one.
  const priority: RecommendableChannel[] =
    ['LANDING_PAGE', 'GOOGLE_RSA', 'META_AD', 'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT'];
  const first = priority.map(c => ready.find(i => i.channel === c)).find(Boolean) ?? null;

  return {
    campaignId: input.campaignId,
    items,
    totalPlannedArtifacts: ready.reduce((n, i) => n + i.quantity, 0),
    readyCount: ready.length,
    blockedCount: items.length - ready.length,
    notes,
    reviewFirst: first ? { channel: first.channel, reason: first.reason } : null,
  };
}

/**
 * The action that would actually unblock an item — §7.
 *
 * "! Needs you" told the owner that something was required and not what. Two
 * rows on the real AllignX package said exactly that, side by side, for two
 * completely different reasons: one wanted a destination, the other wanted a
 * presenter for a video that was never going to have one. A label that cannot
 * distinguish those is not a label, it is a colour.
 *
 * Returns null for a READY item — a row that needs nothing should say nothing,
 * rather than say "ready" twice.
 */
export interface OwnerAction {
  /** The button. An imperative the owner can act on. */
  label: string;
  /** Where it goes. The UI maps this; the enum never reaches the browser. */
  target: 'DESTINATION' | 'BRAND' | 'MEDIA' | 'VIDEO_APPROACH' | 'PROOF' | 'NONE';
  /** One sentence of context. Owner language, never a lifecycle enum. */
  detail: string;
}

export function ownerActionFor(item: PackageItem): OwnerAction | null {
  if (item.state === 'READY_TO_GENERATE') return null;

  const reason = (item.blockedReason ?? '').toLowerCase();

  if (reason.includes('send people')) {
    return { label: 'Choose destination', target: 'DESTINATION',
      detail: 'Ready once you choose where clicks should go.' };
  }
  if (reason.includes('presenter')) {
    return { label: 'Review video approach', target: 'VIDEO_APPROACH',
      detail: 'This needs someone on screen. Choose who presents it.' };
  }
  if (reason.includes('voice')) {
    return { label: 'Review video approach', target: 'VIDEO_APPROACH',
      detail: 'This needs a spoken voice. Choose one.' };
  }
  if (item.state === 'BLOCKED_ON_ASSET') {
    return { label: 'Choose images', target: 'MEDIA',
      detail: 'Ready once you pick which of your images LaunchMind may use.' };
  }
  if (item.state === 'BLOCKED_ON_PROOF') {
    return { label: 'See what is missing', target: 'PROOF',
      // NOT phrased as an owner failing to act: there is nothing they can
      // click to conjure evidence, and implying otherwise is a dead end.
      detail: 'This format needs proof LaunchMind does not hold yet.' };
  }
  if (item.state === 'UNSUPPORTED_CHANNEL') {
    return { label: '', target: 'NONE', detail: 'Not available for this product yet.' };
  }
  return { label: 'Review', target: 'NONE',
    detail: item.blockedReason ?? 'Waiting on a decision.' };
}

/**
 * Re-decides readiness for an ALREADY PLANNED package, against current context.
 *
 * WHY THIS EXISTS. `content_campaigns.content_package` is a snapshot written
 * when the campaign was composed. It is correct to keep it immutable — it is
 * part of the answer to "what did LaunchMind propose, and when?" — but it was
 * also being rendered to the owner as CURRENT readiness, which it is not. The
 * measured consequence on the real AllignX campaign: the owner confirmed their
 * destination, and Content Intelligence went on telling them to "confirm where
 * this should send people" indefinitely, because the sentence had been frozen
 * into a JSONB column weeks earlier. The owner cannot clear a blocker that is
 * a photograph of a blocker.
 *
 * So the SHAPE is inherited from the snapshot — which channels, how many, which
 * variants, and why that channel was chosen are historical decisions and must
 * not silently drift — while `state` and `blockedReason` are re-derived from
 * what is true right now.
 *
 * @security Re-deriving readiness can only ever be as permissive as
 *   `planContentPackage`; it shares the same branch order and the same inputs.
 *   It cannot mark an item ready that a fresh plan would block.
 */
export function refreshPackageReadiness(
  persisted: readonly PackageItem[],
  input: Omit<PackageInputs, 'channels' | 'campaignId'>,
): PackageItem[] {
  return persisted.map(item => {
    // Reuse the SINGLE readiness implementation rather than restating its
    // branches. A second copy of this ladder would drift from the first, and
    // the drift would show up as an owner being blocked on one surface and
    // unblocked on another — which is the exact bug being fixed.
    const fresh = planContentPackage({
      campaignId: null,
      channels: [item.channel],
      authorizedAssetCount: input.authorizedAssetCount,
      hasEvidence: input.hasEvidence,
      ownerConfirmationRequired: input.ownerConfirmationRequired,
      avatarVoiceChosen: input.avatarVoiceChosen,
      videoMode: input.videoMode,
      opportunityType: input.opportunityType,
    }).items[0];
    if (!fresh) return item;
    return {
      ...item,                       // channel, quantity, variants, reason: historical
      state: fresh.state,            // readiness: current
      blockedReason: fresh.blockedReason,
    };
  });
}

/**
 * Validates a package against the frozen limits.
 *
 * Separate from planning so a package proposed by ANY source — including a model
 * or a future client — is checked by the same rules the planner obeys.
 */
export function validatePackage(pkg: ContentPackage): { ok: boolean; violations: string[] } {
  const v: string[] = [];
  if (pkg.items.length > PACKAGE_LIMITS.maxChannels) {
    v.push(`${pkg.items.length} channels exceeds ${PACKAGE_LIMITS.maxChannels}`);
  }
  for (const i of pkg.items) {
    if (i.variants.length > PACKAGE_LIMITS.maxVariantsPerChannel) {
      v.push(`${i.channel}: ${i.variants.length} variants exceeds ${PACKAGE_LIMITS.maxVariantsPerChannel}`);
    }
  }
  const total = pkg.items.reduce((n, i) => n + i.quantity, 0);
  if (total > PACKAGE_LIMITS.maxTotalArtifacts) {
    v.push(`${total} artifacts exceeds ${PACKAGE_LIMITS.maxTotalArtifacts}`);
  }
  return { ok: v.length === 0, violations: v };
}

/**
 * Selection dimensions, reported SEPARATELY.
 *
 * There is no composite "AI score" here and there will not be one: a single
 * number invites "94% confident" claims that nothing measured.
 */
export interface SelectionAssessment {
  strategicFit: 'ALIGNED' | 'PARTIAL' | 'UNCLEAR';
  brandFit: 'ASSESSED_CONSISTENT' | 'ASSESSED_INCONSISTENT' | 'NOT_ASSESSABLE';
  governanceReadiness: 'READY' | 'NEEDS_REWRITE' | 'NEEDS_OWNER_CONFIRMATION' | 'BLOCKED';
  channelValidity: 'VALID' | 'INVALID';
  proofReadiness: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED';
  creativeQuality: 'NOT_CERTIFIED';
  performance: 'UNKNOWN_UNTIL_EXECUTED';
}
