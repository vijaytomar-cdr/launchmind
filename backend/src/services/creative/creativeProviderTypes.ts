/**
 * @file creativeProviderTypes.ts
 * @description The contract every creative provider must satisfy — B6A §5.
 *
 *   THE POINT OF THIS FILE: the provider renders, LaunchMind decides.
 *
 *   A provider receives a CreativeRenderRequest and returns bytes. It never
 *   receives founder authority, execution approval, spend, Marketing Memory,
 *   evidence handles or credentials, and it is never asked whether something is
 *   true, approved or ready to publish. Those questions have owners elsewhere,
 *   and a renderer that could see them is one refactor away from being consulted
 *   about them.
 *
 *   Capabilities are declared so B6B can add HeyGen and ElevenLabs by writing an
 *   adapter, not by editing content strategy. Only IMAGE_GENERATION is
 *   implemented in B6A; everything else is named so the shape is stable, and an
 *   unimplemented capability fails as CAPABILITY_UNAVAILABLE rather than
 *   silently degrading into something the owner did not ask for.
 *
 * @security Errors carry a CATEGORY and an owner-safe sentence. Provider
 *   response bodies are never propagated: they echo the request, and for image
 *   providers they can include the prompt and occasionally the credential.
 * @dependencies creativeBriefs (CreativeRenderRequest only)
 */

import type { CreativeRenderRequest } from '../content/creativeBriefs';

export const CREATIVE_CAPABILITIES = [
  'IMAGE_GENERATION', 'IMAGE_EDITING', 'IMAGE_TO_VIDEO', 'TEXT_TO_VIDEO',
  'AVATAR_VIDEO', 'VOICE', 'LIPSYNC', 'TEMPLATE_RENDER',
] as const;
export type CreativeCapability = typeof CREATIVE_CAPABILITIES[number];

/** Implemented in B6A. Everything else is declared, not available. */
export const B6A_CAPABILITIES: readonly CreativeCapability[] = ['IMAGE_GENERATION'];

/** Implemented in B6B. LIPSYNC and TEMPLATE_RENDER remain declared, not built. */
export const B6B_CAPABILITIES: readonly CreativeCapability[] = [
  'IMAGE_GENERATION', 'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO', 'AVATAR_VIDEO', 'VOICE',
];

export type CreativeQualityTier = 'DRAFT' | 'PRODUCTION' | 'PREMIUM';

/**
 * Failure kinds. Each maps to a different thing the owner can do, which is the
 * only reason to distinguish them.
 */
export type CreativeFailureCategory =
  | 'PROVIDER_UNAVAILABLE'   // wait
  | 'RATE_LIMITED'           // wait
  | 'TIMEOUT'                // retry
  | 'MALFORMED_RESPONSE'     // our bug
  | 'INVALID_CONTENT_TYPE'   // our bug or provider change
  | 'OUTPUT_EXPIRED'         // retry
  | 'STORAGE_FAILED'         // retry
  | 'BLOCKED_BY_GOVERNANCE'  // owner must authorise something
  | 'PROVIDER_REFUSED'       // rephrase the concept
  | 'ADAPTER_UNAVAILABLE';   // not configured

/** Categories worth retrying. Everything else needs a person, not a retry. */
export const RETRYABLE: ReadonlySet<CreativeFailureCategory> = new Set([
  'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT', 'OUTPUT_EXPIRED', 'STORAGE_FAILED',
]);

export class CreativeProviderError extends Error {
  readonly category: CreativeFailureCategory;
  /** Owner-safe. Shown in the product; never a stack trace or provider payload. */
  readonly ownerMessage: string;
  constructor(category: CreativeFailureCategory, ownerMessage: string, internal?: string) {
    super(internal ?? category);
    this.name = 'CreativeProviderError';
    this.category = category;
    this.ownerMessage = ownerMessage;
  }
  get retryable(): boolean { return RETRYABLE.has(this.category); }
}

/** What a provider is handed. Assembled by LaunchMind, never by the provider. */
export interface CreativeRenderInstruction {
  /** Sanitised scene description. Contains no ids, handles, enums or authority. */
  prompt: string;
  /** Things the renderer must not do. Carried explicitly, never assumed. */
  negativePrompt: string;
  aspectRatio: string;
  /**
   * Reference images, already proven to be owner-authorised for VISUAL_RENDERING.
   * The provider cannot tell an authorised screenshot from a scraped one, so the
   * decision is made before this object is built and never inside the adapter.
   */
  referenceImageUrls: string[];
  qualityTier: CreativeQualityTier;
  modelRef: string;
}

export interface CreativeRenderOutput {
  /** Provider-hosted and usually short-lived. Never our canonical identity. */
  imageUrl: string;
  mimeType: string;
  widthPx: number | null;
  heightPx: number | null;
  /** Safe correlation reference. Not the prompt, not the response body. */
  providerRequestRef: string | null;
  latencyMs: number;
  /** PROVIDER-REPORTED ONLY. null when the provider reported nothing. */
  costUsd: number | null;
}

/** What a video provider is handed. Same rule as images: no authority, ever. */
export interface VideoRenderInstruction {
  /** Sanitised scene description for a generative video model. */
  prompt?: string;
  negativePrompt?: string;
  aspectRatio: string;
  /** Owner-authorised reference image, proven before this object is built. */
  referenceImageUrl?: string | null;
  /** GOVERNED script text. A provider may voice it; none may rewrite it. */
  spokenScript?: string;
  /** Owner-chosen presenter. Absent for modes with no person. */
  providerAvatarId?: string | null;
  /** Owner-chosen stock voice. Never a cloned one. */
  providerVoiceId?: string | null;
  durationSeconds?: number;
  modelRef: string;
}

/** What a voice provider is handed. Text only — no ids, no authority. */
export interface VoiceRenderInstruction {
  /** GOVERNED script text, verbatim. */
  text: string;
  providerVoiceId: string;
  modelRef: string;
}

export interface MediaRenderOutput {
  /** Provider-hosted and usually short-lived. Never our canonical identity. */
  mediaUrl?: string;
  /** Some providers return bytes directly (ElevenLabs TTS). */
  bytes?: Buffer;
  mimeType: string;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  providerRequestRef: string | null;
  latencyMs: number;
  /** PROVIDER-REPORTED ONLY. null when the provider reported nothing. */
  costUsd: number | null;
}

export interface CreativeProviderAdapter {
  readonly provider: 'REPLICATE' | 'HEYGEN' | 'ELEVENLABS';
  readonly capabilities: readonly CreativeCapability[];
  /** False when credentials are absent — the route answers honestly rather than failing mid-render. */
  isConfigured(): boolean;
  generateImage?(instruction: CreativeRenderInstruction): Promise<CreativeRenderOutput>;
  generateVideo?(instruction: VideoRenderInstruction): Promise<MediaRenderOutput>;
  generateVoice?(instruction: VoiceRenderInstruction): Promise<MediaRenderOutput>;
}

/**
 * Compile-time proof that a render request never carries authority.
 *
 * If someone adds an authority-shaped field to CreativeRenderRequest, this stops
 * compiling. A runtime test exists too; this catches it a step earlier.
 */
export type ProviderSafeRequest = CreativeRenderRequest & {
  founderAuthority?: never; authorityTier?: never; executionApproval?: never;
  approvedAt?: never; spendCap?: never; budget?: never; marketingMemory?: never;
  evidenceHandles?: never; ownerCredentials?: never;
};
