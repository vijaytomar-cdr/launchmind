/**
 * @file creativeBriefs.ts
 * @description Visual and video creative briefs + provider handoff — B3.
 *
 *   HANDOFF DATA ONLY. No provider is called, selected or configured here.
 *   LaunchMind owns strategy, message, brand context, brief, governance and
 *   lineage; a provider owns rendering. That split is what keeps a vendor change
 *   from becoming a governance change.
 *
 *   THE ASSET RULE, inherited from B1: only AUTHORIZED assets may appear. A
 *   scraped store screenshot, a website hero image and a web-search result are
 *   OBSERVED — they inform reasoning and never enter a creative brief, because a
 *   brief is a plan to publish.
 *
 *   AVATAR AND VOICE ARE NOT ENVIRONMENT CONFIGURATION. Different owners and
 *   products use different ones, so they belong to a governed content record.
 *   The video brief therefore states whether an avatar or voice is NEEDED and
 *   deliberately does not name one.
 *
 * @security A provider receives content and assets. It never receives founder
 *   authority, execution approval, Marketing Memory write access or spend.
 * @dependencies briefComposition, strategyComposition, productContentContext
 */

import type { ContentBrief, B3Channel, BrandingPresence } from './briefComposition';
import type { ContentStrategy } from './strategyComposition';
import type { ProductContentContext } from './productContentContext';

export interface VisualCreativeBrief {
  objective: string;
  channel: B3Channel;
  renderType: 'STATIC_IMAGE';
  aspectRatio: string;
  campaignThesis: string;
  visualConcept: string;
  productRole: string | null;
  logoUsage: BrandingPresence | 'NONE';
  screenshotUsage: 'AUTHORISED_ONLY' | 'NONE';
  brandColors: string[];
  textOverlay: string | null;
  ctaIntent: string | null;
  moodStyle: string | null;
  /** Explicit, because a renderer will otherwise fill the gap itself. */
  prohibitedContent: string[];
  authorizedAssetRefs: string[];
  unavailable: string[];
}

const ASPECT: Partial<Record<B3Channel, string>> = {
  META_AD: '1:1', LANDING_PAGE: '16:9', SHORT_FORM_VIDEO_SCRIPT: '9:16',
};

/**
 * Derives a visual brief. PURE.
 *
 * @security Logo usage falls to NONE unless the owner CONFIRMED a logo — an
 *   observed logo is not permission to stamp it on an advertisement.
 */
export function deriveVisualCreativeBrief(
  brief: ContentBrief, strategy: ContentStrategy, ctx: ProductContentContext,
): VisualCreativeBrief {
  const logoConfirmed = ctx.brand.fields.logo?.ownerConfirmed === true;
  const colors = ['primary_color', 'secondary_color']
    .map(k => ctx.brand.fields[k])
    .filter(f => f?.ownerConfirmed)
    .map(f => String(f!.value));

  const unavailable: string[] = [];
  if (!logoConfirmed) unavailable.push('no confirmed logo');
  if (ctx.authorizedAssets.length === 0) unavailable.push('no authorised product imagery');
  if (colors.length === 0) unavailable.push('no confirmed brand colours');

  return {
    objective: brief.objective,
    channel: brief.channel,
    renderType: 'STATIC_IMAGE',
    aspectRatio: ASPECT[brief.channel] ?? '1:1',
    campaignThesis: strategy.campaignThesis,
    // DEFECT FOUND IN B6A DEVELOPMENT RENDERING, fixed here.
    //
    // This previously used `brief.visualDirection` directly. When no product
    // imagery is authorised, briefComposition sets that field to the SYSTEM
    // explanation "no authorised product imagery is available; describe the
    // outcome without depicting the product UI" — an instruction about what
    // LaunchMind may not do, not a scene. It was being handed to the image
    // model as the thing to draw, which produced a picture derived from a
    // sentence about the absence of pictures.
    //
    // The concept now always describes the OUTCOME. visualDirection is used
    // only when it genuinely names a scene, which is the authorised-imagery
    // branch; the no-imagery case is already carried in `unavailable` as a
    // constraint, which is where a constraint belongs.
    visualConcept: (brief.visualDirection && ctx.authorizedAssets.length > 0)
      ? brief.visualDirection
      : [
          `show the outcome: ${strategy.campaignThesis}`,
          strategy.primaryBenefit ? `it should feel like ${strategy.primaryBenefit}` : '',
          strategy.audience ? `for ${strategy.audience}` : '',
        ].filter(Boolean).join('. '),
    productRole: strategy.productRole,
    logoUsage: logoConfirmed ? brief.brandingPresence : 'NONE',
    screenshotUsage: ctx.authorizedAssets.length > 0 ? 'AUTHORISED_ONLY' : 'NONE',
    brandColors: colors,
    textOverlay: brief.message,
    ctaIntent: brief.ctaIntent,
    moodStyle: ctx.brand.fields.visual_style?.ownerConfirmed
      ? String(ctx.brand.fields.visual_style.value) : null,
    prohibitedContent: [
      'no competitor imagery or branding',
      'no stock photography implying real customers',
      'no invented statistics, badges, ratings or awards',
      'no text that states a claim the brief did not supply',
      ...brief.prohibitedTerminology.map(t => `do not render the word "${t}"`),
    ],
    authorizedAssetRefs: brief.authorizedAssetRefs,
    unavailable,
  };
}

export interface VideoCreativeBrief {
  channel: B3Channel;
  renderType: 'SHORT_FORM_VIDEO';
  videoStyle: string;
  aspectRatio: '9:16';
  avatarNeeded: boolean;
  voiceNeeded: boolean;
  productDemoNeeded: boolean;
  captionsRequired: boolean;
  estimatedSeconds: number;
  scenePlan: Array<{ scene: number; purpose: string; visual: string; voiceover: string; onScreenText: string }>;
  brandAssetRefs: string[];
  prohibitedContent: string[];
  unavailable: string[];
  /**
   * Deliberately absent: avatarId, voiceId. Those are governed product/content
   * configuration an owner chooses, not a process-wide default.
   */
  selectionDeferredToOwner: string[];
}

export function deriveVideoCreativeBrief(
  brief: ContentBrief, ctx: ProductContentContext,
  payload: Record<string, unknown>,
): VideoCreativeBrief {
  const scenes = (Array.isArray(payload.scenePlan) ? payload.scenePlan : []) as Array<Record<string, unknown>>;
  const unavailable: string[] = [];
  if (ctx.authorizedAssets.length === 0) unavailable.push('no authorised product footage or screenshots');
  if (!ctx.brand.fields.logo?.ownerConfirmed) unavailable.push('no confirmed logo');

  return {
    channel: brief.channel,
    renderType: 'SHORT_FORM_VIDEO',
    videoStyle: ctx.brand.fields.visual_style?.ownerConfirmed
      ? String(ctx.brand.fields.visual_style.value) : 'plain, product-led',
    aspectRatio: '9:16',
    // Spoken narration is planned; WHO speaks it is the owner's decision.
    avatarNeeded: true,
    voiceNeeded: true,
    productDemoNeeded: ctx.authorizedAssets.length > 0,
    captionsRequired: true,
    estimatedSeconds: Number(payload.estimatedSeconds ?? 0),
    scenePlan: scenes.map((s, i) => ({
      scene: Number(s.scene ?? i + 1),
      purpose: String(s.purpose ?? ''),
      visual: String(s.visual ?? ''),
      voiceover: String(s.voiceover ?? ''),
      onScreenText: String(s.onScreenText ?? ''),
    })),
    brandAssetRefs: brief.authorizedAssetRefs,
    prohibitedContent: [
      'no competitor footage or branding',
      'no synthetic person presented as a real customer or employee',
      'no invented statistics in narration or on screen',
      ...brief.prohibitedTerminology.map(t => `do not say or show "${t}"`),
    ],
    unavailable,
    selectionDeferredToOwner: ['avatar', 'voice'],
  };
}

/** Provider-neutral render request. Prepared, never sent. */
export interface CreativeRenderRequest {
  workspaceId: string;
  productId: string;
  artifactId: string;
  versionNumber: number;
  channel: B3Channel;
  renderType: 'STATIC_IMAGE' | 'SHORT_FORM_VIDEO';
  creativeBrief: VisualCreativeBrief | VideoCreativeBrief;
  authorizedAssetRefs: string[];
  brandKitVersion: number;
}

/**
 * Fields a creative provider must NEVER receive.
 *
 * Enforced by test. A renderer that could see founder authority or an approval
 * flag is one refactor away from being consulted about them.
 */
export const PROVIDER_FORBIDDEN_FIELDS = [
  'founderAuthority', 'authorityTier', 'executionApproval', 'approvedAt',
  'spendCap', 'budget', 'marketingMemory', 'evidenceHandles', 'ownerCredentials',
] as const;

export function buildCreativeRenderRequest(opts: {
  workspaceId: string; productId: string; artifactId: string; versionNumber: number;
  channel: B3Channel; brief: VisualCreativeBrief | VideoCreativeBrief;
  authorizedAssetRefs: string[]; brandKitVersion: number;
}): CreativeRenderRequest {
  return {
    workspaceId: opts.workspaceId, productId: opts.productId,
    artifactId: opts.artifactId, versionNumber: opts.versionNumber,
    channel: opts.channel,
    renderType: opts.brief.renderType,
    creativeBrief: opts.brief,
    authorizedAssetRefs: opts.authorizedAssetRefs,
    brandKitVersion: opts.brandKitVersion,
  };
}

/**
 * Owner-safe "why this content exists".
 *
 * @security No ids, handles, enums, prompts or reasoning. The owner learns what
 *   informed the work, not how the machine is wired.
 */
export function artifactProvenance(opts: {
  ctx: ProductContentContext; strategy: ContentStrategy;
  opportunityTitle: string; campaignName: string;
}): string[] {
  const lines = [
    `Created from the opportunity "${opts.opportunityTitle}"`,
    `Part of your campaign "${opts.campaignName}"`,
  ];
  if (opts.strategy.intelligenceInformed.length > 0) {
    lines.push('Shaped by a market observation LaunchMind identified');
  }
  if (opts.ctx.brand.fields.brand_voice?.ownerConfirmed) {
    lines.push('Uses the brand voice you confirmed');
  }
  if (opts.strategy.proofAvailable.length > 0) {
    lines.push(`Supported by ${opts.strategy.proofAvailable.join(' and ')}`);
  }
  for (const o of opts.strategy.founderOverrides) lines.push(o);
  for (const m of opts.strategy.memoryApplied) lines.push(`Reflects what has worked before: ${m}`);
  if (opts.strategy.proofUnavailable.length > 0) {
    lines.push('Some messages were left out because you do not have proof for them yet');
  }
  return lines;
}
