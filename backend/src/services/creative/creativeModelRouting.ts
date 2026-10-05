/**
 * @file creativeModelRouting.ts
 * @description Which model renders which kind of creative — B6A §17.
 *
 *   Model choice is CONFIGURATION, not business logic. Hardcoding a model
 *   identifier inside content strategy would make swapping it a change to how
 *   LaunchMind thinks about marketing, which it is not.
 *
 *   DRAFT and PRODUCTION use Flux 1.1 Pro. The controlled 2026-09-05
 *   comparison found materially better object realism and absence of invented
 *   lettering than Schnell with identical art direction and composition.
 *   Evidence: artifacts/image-model-benchmark/REPORT.md. Neither candidate
 *   passed creative readiness; this selection does not bypass pixel critique.
 *   PREMIUM remains unrouted and requires an explicit owner decision.
 *
 *   No price is written here. Replicate reports usage per prediction; that is
 *   what gets recorded. An invented price is worse than no price, because it
 *   looks like a measurement.
 *
 * @security Nothing here reads the environment or touches a credential.
 */

import type { CreativeCapability, CreativeQualityTier } from './creativeProviderTypes';

/** The four rendered outputs B6A supports. Not 31 legacy types. */
export const B6A_CREATIVE_KINDS = [
  'META_AD_VISUAL', 'SOCIAL_POST_VISUAL', 'LANDING_PAGE_HERO', 'PRODUCT_VISUAL',
] as const;
/** B6B adds one video kind and the audio track a video may need. */
export const B6B_CREATIVE_KINDS = ['SHORT_FORM_VIDEO', 'VOICEOVER_AUDIO'] as const;
export type CreativeKind =
  | typeof B6A_CREATIVE_KINDS[number] | typeof B6B_CREATIVE_KINDS[number];

export interface CreativeModelRoute {
  provider: 'REPLICATE';
  capability: CreativeCapability;
  modelRef: string;
  qualityTier: CreativeQualityTier;
  supportsReferenceImage: boolean;
  supportsInpainting: boolean;
  supportsAspectRatio: boolean;
  /** Provider-reported per prediction. We never estimate it here. */
  costSource: 'PROVIDER_REPORTED';
}

const ROUTES: Record<CreativeQualityTier, CreativeModelRoute | null> = {
  DRAFT: {
    provider: 'REPLICATE', capability: 'IMAGE_GENERATION',
    modelRef: 'black-forest-labs/flux-1.1-pro',
    qualityTier: 'DRAFT',
    supportsReferenceImage: false, supportsInpainting: false, supportsAspectRatio: true,
    costSource: 'PROVIDER_REPORTED',
  },
  PRODUCTION: {
    provider: 'REPLICATE', capability: 'IMAGE_GENERATION',
    modelRef: 'black-forest-labs/flux-1.1-pro',
    qualityTier: 'PRODUCTION',
    supportsReferenceImage: true, supportsInpainting: false, supportsAspectRatio: true,
    costSource: 'PROVIDER_REPORTED',
  },
  // Declared, intentionally unrouted. See file header.
  PREMIUM: null,
};

export class CreativeRoutingError extends Error {
  constructor(message: string) { super(message); this.name = 'CreativeRoutingError'; }
}

export function routeCreativeModel(tier: CreativeQualityTier): CreativeModelRoute {
  const route = ROUTES[tier];
  if (!route) {
    throw new CreativeRoutingError(
      `Quality tier ${tier} is not available yet and requires an explicit owner decision.`);
  }
  return route;
}

/** Aspect ratio per creative kind. The channel decides shape, not the model. */
const ASPECT: Record<CreativeKind, string> = {
  META_AD_VISUAL: '1:1',
  SOCIAL_POST_VISUAL: '1:1',
  LANDING_PAGE_HERO: '16:9',
  PRODUCT_VISUAL: '4:3',
  // Short-form is vertical. Not a provider capability — a platform reality.
  SHORT_FORM_VIDEO: '9:16',
  VOICEOVER_AUDIO: '9:16',
};
export function aspectForKind(kind: CreativeKind): string { return ASPECT[kind]; }

/** Which B3 channel produces which rendered kind. Channels with no visual are absent. */
const CHANNEL_TO_KIND: Record<string, CreativeKind> = {
  META_AD: 'META_AD_VISUAL',
  LINKEDIN_POST: 'SOCIAL_POST_VISUAL',
  LANDING_PAGE: 'LANDING_PAGE_HERO',
  SHORT_FORM_VIDEO_SCRIPT: 'SHORT_FORM_VIDEO',
};
export function creativeKindForChannel(channel: string): CreativeKind | null {
  return CHANNEL_TO_KIND[channel] ?? null;
}


// ── Video routing — B6B §21 ────────────────────────────────────────────────
//
// Mode decides capability; capability decides provider. Strategy never asks who
// is configured. "HeyGen is available, therefore use an avatar" is precisely the
// inversion this table exists to prevent: an avatar appears because the MESSAGE
// needs someone to say it, and never because a key is present.

import type { VideoMode } from './videoModePolicy';

export interface VideoRoute {
  provider: 'REPLICATE' | 'HEYGEN' | 'ELEVENLABS';
  capability: CreativeCapability;
  modelRef: string;
  /** A second render this mode also needs, e.g. a voice track before assembly. */
  companion?: { provider: 'ELEVENLABS'; capability: CreativeCapability; modelRef: string };
}

const VIDEO_ROUTES: Record<VideoMode, VideoRoute> = {
  // Generative motion. No person is requested of this provider at all.
  PRODUCT_MOTION: {
    provider: 'REPLICATE', capability: 'TEXT_TO_VIDEO',
    // Chosen after wan-2.5-t2v-fast failed every prediction with an opaque
    // provider-side E002. Verified working at 9:16 720p in development.
    modelRef: 'bytedance/seedance-1-lite',
  },
  // A chosen presenter speaking a given script. The only mode with a person.
  AVATAR_SPOKESPERSON: {
    provider: 'HEYGEN', capability: 'AVATAR_VIDEO', modelRef: 'heygen/avatar-v2',
  },
  // Motion plus a chosen stock voice reading the governed script.
  VOICEOVER_CREATIVE: {
    provider: 'REPLICATE', capability: 'TEXT_TO_VIDEO',
    modelRef: 'bytedance/seedance-1-lite',
    companion: { provider: 'ELEVENLABS', capability: 'VOICE', modelRef: 'eleven_multilingual_v2' },
  },
};

/** When a reference image exists, motion is image-to-video rather than text-to-video. */
export const IMAGE_TO_VIDEO_MODEL = 'bytedance/seedance-1-lite';

/**
 * Models withdrawn from active routing, and why.
 *
 * Kept as a record rather than deleted: without it the next person to read the
 * provider docs picks wan-2.5-t2v-fast again on its published merits and
 * rediscovers the same dead end.
 */
export const WITHDRAWN_VIDEO_MODELS: ReadonlyArray<{ modelRef: string; reason: string }> = [
  { modelRef: 'wan-video/wan-2.5-t2v-fast',
    reason: 'Every tested prediction failed with an opaque provider-side E002.' },
  { modelRef: 'wan-video/wan-2.5-i2v-fast',
    reason: 'Same family as the failing text-to-video model; never verified working.' },
];

/** A withdrawn model must never be reachable through routing. */
export function isWithdrawnVideoModel(modelRef: string): boolean {
  return WITHDRAWN_VIDEO_MODELS.some(m => m.modelRef === modelRef);
}

export function routeVideoMode(mode: VideoMode): VideoRoute {
  const r = VIDEO_ROUTES[mode];
  if (!r) throw new CreativeRoutingError(`No route for video mode ${mode}.`);
  // A model verified broken must not reach a provider, whatever a future edit
  // puts in the table above.
  if (isWithdrawnVideoModel(r.modelRef)) {
    throw new CreativeRoutingError(
      `Video model ${r.modelRef} is withdrawn from routing and must not be used.`);
  }
  return r;
}
