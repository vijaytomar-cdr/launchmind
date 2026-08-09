/**
 * @file registry.ts
 * @description Registry of real Improve Intelligence provider adapters.
 *
 *   Registered today — the observation-first providers:
 *     App Store Connect (reference) · RevenueCat · Google Analytics 4 ·
 *     Stripe (read-only) · Google Search Console
 *
 *   Google Ads and Meta are registered as ACTION-CAPABLE providers connected in
 *   observation-only mode: their adapters implement no execute_* method, so
 *   connectionExecutionGuard can never permit them to change, publish, or spend.
 *
 *   HubSpot and Mailchimp complete the set as lifecycle observation providers.
 *
 *   Any provider WITHOUT an adapter throws ADAPTER_UNAVAILABLE from getAdapter, the
 *   connection never reaches AUTHORIZED, and the owner sees an explicit "not available
 *   yet" state. That matters: an earlier build fabricated accounts, metrics, and
 *   insights and presented them as observed provider data. Showing nothing beats
 *   showing invented numbers (spec §29.10, §11).
 *
 *   To add a provider: implement ProviderAdapter in ./<provider>.ts and register it
 *   in ADAPTERS below. Nothing else in the sync pipeline needs to change.
 *
 * @security Adapters are looked up by an allow-listed ProviderKey only.
 * @dependencies ./types, ./appStoreConnectAdapter
 */

import { ProviderError, type ProviderAdapter, type ProviderKey } from './types';
import { appStoreConnectAdapter } from './appStoreConnectAdapter';
import { revenueCatAdapter } from './revenueCatAdapter';
import { ga4Adapter } from './ga4Adapter';
import { stripeAdapter } from './stripeAdapter';
import { searchConsoleAdapter } from './searchConsoleAdapter';
import { googleAdsAdapter } from './googleAdsAdapter';
import { metaAdsAdapter } from './metaAdsAdapter';
import { hubspotAdapter } from './hubspotAdapter';
import { mailchimpAdapter } from './mailchimpAdapter';

/** Every provider the product models, whether or not an adapter exists yet. */
export const KNOWN_PROVIDERS: readonly ProviderKey[] = [
  'app_store_connect',
  'revenue_cat',
  'ga4',
  'stripe',
  'search_console',
  'google_ads',
  'meta_ads',
  'hubspot',
  'mailchimp',
] as const;

/**
 * Providers whose first connection is observation-only and whose execution
 * authority (edit / publish / spend) requires a separate, explicit upgrade (spec §5.2).
 */
export const ACTION_CAPABLE_PROVIDERS: readonly ProviderKey[] = ['google_ads', 'meta_ads'] as const;

/** Real adapters, keyed by provider. */
const ADAPTERS = new Map<ProviderKey, ProviderAdapter>();

/**
 * Built-in adapters, registered at module load.
 * Kept separate from ADAPTERS so __resetAdaptersForTest can restore them.
 */
const BUILTIN_ADAPTERS: readonly ProviderAdapter[] = [
  appStoreConnectAdapter,
  revenueCatAdapter,
  ga4Adapter,
  stripeAdapter,
  searchConsoleAdapter,
  // Action-capable, connected observation-only. See connectionExecutionGuard.
  googleAdsAdapter,
  metaAdsAdapter,
  // Lifecycle providers, observation-only.
  hubspotAdapter,
  mailchimpAdapter,
];

for (const adapter of BUILTIN_ADAPTERS) ADAPTERS.set(adapter.key, adapter);

/**
 * Registers a provider adapter. Called at module load by each adapter file.
 * @param adapter - A fully implemented ProviderAdapter
 * @throws {Error} If an adapter is already registered for that provider key
 */
export function registerAdapter(adapter: ProviderAdapter): void {
  if (ADAPTERS.has(adapter.key)) {
    throw new Error(`Adapter already registered for provider: ${adapter.key}`);
  }
  ADAPTERS.set(adapter.key, adapter);
}

/** @returns True when `value` is a provider this product models. */
export function isKnownProvider(value: string): value is ProviderKey {
  return (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

/** @returns True when a real adapter is registered and the provider can be connected. */
export function hasAdapter(provider: string): boolean {
  return isKnownProvider(provider) && ADAPTERS.has(provider);
}

/** @returns Provider keys that can actually be connected right now. */
export function availableProviders(): ProviderKey[] {
  return [...ADAPTERS.keys()];
}

/**
 * Resolves the adapter for a provider.
 * @param provider - Provider slug from the route params
 * @returns The registered ProviderAdapter
 * @throws {ProviderError} ADAPTER_UNAVAILABLE when unknown or not yet implemented
 * @security Rejects any provider outside KNOWN_PROVIDERS before map lookup.
 */
export function getAdapter(provider: string): ProviderAdapter {
  if (!isKnownProvider(provider)) {
    throw new ProviderError('ADAPTER_UNAVAILABLE', `${provider} is not a supported intelligence source.`);
  }
  const adapter = ADAPTERS.get(provider);
  if (!adapter) {
    throw new ProviderError(
      'ADAPTER_UNAVAILABLE',
      'This intelligence source is not available to connect yet. LaunchMind will not show estimated data in its place.',
    );
  }
  return adapter;
}

/**
 * Test-only reset.
 * @param keepBuiltins - false to simulate a provider with no adapter at all
 */
export function __resetAdaptersForTest(keepBuiltins = true): void {
  ADAPTERS.clear();
  if (keepBuiltins) for (const a of BUILTIN_ADAPTERS) ADAPTERS.set(a.key, a);
}

/** Test-only override so a suite can substitute a controllable adapter. */
export function __setAdapterForTest(adapter: ProviderAdapter): void {
  ADAPTERS.set(adapter.key, adapter);
}
