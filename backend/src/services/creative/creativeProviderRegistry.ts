/**
 * @file creativeProviderRegistry.ts
 * @description The only way to obtain a creative provider — B6A §5, §6.
 *
 *   Content Studio, strategy composition and the render service all go through
 *   here. Nothing else imports an adapter directly, so there is exactly one
 *   place to look when asking "what can LaunchMind render, and with what".
 *
 *   B6B adds HeyGen and ElevenLabs by registering adapters here. No strategy
 *   file changes, because strategy never asks who the provider is.
 *
 * @security Registration is compile-time. A provider cannot be introduced at
 *   runtime by configuration, so an environment variable cannot widen what
 *   LaunchMind is able to call.
 */

import { ReplicateCreativeAdapter } from './replicateCreativeAdapter';
import { HeyGenCreativeAdapter } from './heygenCreativeAdapter';
import { ElevenLabsCreativeAdapter } from './elevenLabsCreativeAdapter';
import {
  CreativeProviderError, type CreativeProviderAdapter, type CreativeCapability,
} from './creativeProviderTypes';

const ADAPTERS: readonly CreativeProviderAdapter[] = [
  new ReplicateCreativeAdapter(),
  new HeyGenCreativeAdapter(),
  new ElevenLabsCreativeAdapter(),
];

/**
 * A declared capability is not an implemented one.
 *
 * The method is checked rather than trusted: an adapter that lists AVATAR_VIDEO
 * without a generateVideo would otherwise be handed a render and fail deep
 * inside it, where the owner sees a crash instead of "not available yet".
 */
function implementsIt(a: CreativeProviderAdapter, capability: CreativeCapability): boolean {
  switch (capability) {
    case 'IMAGE_GENERATION':
    case 'IMAGE_EDITING':   return typeof a.generateImage === 'function';
    case 'TEXT_TO_VIDEO':
    case 'IMAGE_TO_VIDEO':
    case 'AVATAR_VIDEO':
    case 'LIPSYNC':         return typeof a.generateVideo === 'function';
    case 'VOICE':           return typeof a.generateVoice === 'function';
    default:                return false;
  }
}

/**
 * @throws {CreativeProviderError} ADAPTER_UNAVAILABLE when nothing implements
 *   the capability or the implementation has no credentials. The caller reports
 *   that to the owner; it never falls back to a different capability.
 */
export function getCreativeProvider(capability: CreativeCapability): CreativeProviderAdapter {
  const impl = ADAPTERS.find(a => a.capabilities.includes(capability) && implementsIt(a, capability));
  if (!impl) {
    throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
      'LaunchMind cannot create this kind of creative yet.', `no adapter for ${capability}`);
  }
  if (!impl.isConfigured()) {
    throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
      'Image creation is not available yet.', `${impl.provider} not configured`);
  }
  return impl;
}

/** Owner-safe availability, for deciding whether to OFFER an action. */
export function creativeCapabilityAvailable(capability: CreativeCapability): boolean {
  const impl = ADAPTERS.find(a => a.capabilities.includes(capability) && implementsIt(a, capability));
  return !!impl && impl.isConfigured();
}
