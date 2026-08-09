/**
 * @file oauthConfig.ts
 * @description Per-provider OAuth endpoint configuration.
 *
 *   Returns a config ONLY when the provider's client credentials are actually
 *   present in the environment. A provider with no configured client returns null,
 *   which the route surfaces as 501 "not available to connect yet" — the same
 *   honest answer as a missing adapter, rather than sending the owner to a broken
 *   authorization screen.
 *
 *   Scopes here are the least-privilege READ set for each provider. Nothing in this
 *   file requests write, publish, or spend authority; those require a separate,
 *   audited authority upgrade (connectionPermissionService), and granting them in
 *   LaunchMind does not by itself broaden the provider token.
 *
 * @security
 *   - Client secrets are read from process.env at call time and never logged,
 *     returned, or persisted.
 *   - PKCE is enabled for every provider that supports it.
 * @dependencies oauthService (OAuthProviderConfig)
 */

import type { OAuthProviderConfig } from '../oauthService';
import { resolveMetaAppCredentials } from './metaCredentials';

/** Non-secret shape of a provider's OAuth wiring. */
interface ProviderOAuthTemplate {
  authorizationUrl: string;
  tokenUrl:         string;
  revocationUrl?:   string;
  /** Least-privilege read scopes. */
  scopes:           string[];
  usesPkce:         boolean;
  usesNonce:        boolean;
  /** Env var names holding the client credentials. */
  clientIdEnv:      string;
  clientSecretEnv:  string;
  extraAuthParams?: Record<string, string>;
}

/**
 * OAuth templates per provider.
 *
 * App Store Connect and RevenueCat are absent on purpose: both authenticate with
 * issuer-signed keys / API keys rather than OAuth, and are connected through
 * POST /connections/:provider/connect.
 */
const TEMPLATES: Record<string, ProviderOAuthTemplate> = {
  ga4: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:         'https://oauth2.googleapis.com/token',
    revocationUrl:    'https://oauth2.googleapis.com/revoke',
    scopes:           ['https://www.googleapis.com/auth/analytics.readonly'],
    usesPkce:         true,
    usesNonce:        false,
    clientIdEnv:      'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv:  'GOOGLE_OAUTH_CLIENT_SECRET',
    // offline + consent are required for Google to return a refresh token.
    extraAuthParams:  { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' },
  },

  search_console: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:         'https://oauth2.googleapis.com/token',
    revocationUrl:    'https://oauth2.googleapis.com/revoke',
    scopes:           ['https://www.googleapis.com/auth/webmasters.readonly'],
    usesPkce:         true,
    usesNonce:        false,
    clientIdEnv:      'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv:  'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams:  { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' },
  },

  google_ads: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:         'https://oauth2.googleapis.com/token',
    revocationUrl:    'https://oauth2.googleapis.com/revoke',
    // Google Ads has no read-only scope; observation-only is enforced by LaunchMind's
    // own permission grant (READ + RECOMMEND) and by adapters exposing no mutations.
    scopes:           ['https://www.googleapis.com/auth/adwords'],
    usesPkce:         true,
    usesNonce:        false,
    clientIdEnv:      'GOOGLE_ADS_CLIENT_ID',
    clientSecretEnv:  'GOOGLE_ADS_CLIENT_SECRET',
    extraAuthParams:  { access_type: 'offline', prompt: 'consent' },
  },

  meta_ads: {
    authorizationUrl: 'https://www.facebook.com/v20.0/dialog/oauth',
    tokenUrl:         'https://graph.facebook.com/v20.0/oauth/access_token',
    scopes:           ['ads_read', 'read_insights'], // read-only; no ads_management
    usesPkce:         true,
    usesNonce:        false,
    // Canonical. Resolution goes through metaCredentials.ts, which also accepts the
    // deprecated META_ADS_APP_ID/_SECRET alias for one release.
    clientIdEnv:      'META_ADS_CLIENT_ID',
    clientSecretEnv:  'META_ADS_CLIENT_SECRET',
  },

  stripe: {
    authorizationUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl:         'https://connect.stripe.com/oauth/token',
    revocationUrl:    'https://connect.stripe.com/oauth/deauthorize',
    scopes:           ['read_only'],
    usesPkce:         false, // Stripe Connect OAuth does not support PKCE
    usesNonce:        false,
    clientIdEnv:      'STRIPE_CONNECT_CLIENT_ID',
    clientSecretEnv:  'STRIPE_SECRET_KEY',
  },

  hubspot: {
    authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl:         'https://api.hubapi.com/oauth/v1/token',
    scopes:           ['crm.objects.contacts.read', 'crm.objects.deals.read'],
    usesPkce:         false,
    usesNonce:        false,
    clientIdEnv:      'HUBSPOT_CLIENT_ID',
    clientSecretEnv:  'HUBSPOT_CLIENT_SECRET',
  },

  mailchimp: {
    authorizationUrl: 'https://login.mailchimp.com/oauth2/authorize',
    tokenUrl:         'https://login.mailchimp.com/oauth2/token',
    scopes:           [], // Mailchimp grants account-level read on authorization
    usesPkce:         false,
    usesNonce:        false,
    clientIdEnv:      'MAILCHIMP_CLIENT_ID',
    clientSecretEnv:  'MAILCHIMP_CLIENT_SECRET',
  },
};

/**
 * Resolves the OAuth config for a provider.
 *
 * @param provider - Provider slug
 * @returns Config with live client credentials, or null when the provider does not
 *   use OAuth or its client credentials are not configured in this environment
 * @security Returning null (→ HTTP 501) is the honest answer for an unconfigured
 *   provider. Never build an authorization URL with a placeholder client id.
 */
export function getOAuthProviderConfig(provider: string): OAuthProviderConfig | null {
  const template = TEMPLATES[provider];
  if (!template) return null;

  // Meta is resolved through metaCredentials.ts so the canonical pair and the
  // deprecated alias behave identically here and in the legacy route — and so an
  // id and a secret can never come from different pairs.
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (provider === 'meta_ads') {
    const meta = resolveMetaAppCredentials();
    clientId     = meta?.appId;
    clientSecret = meta?.appSecret;
  } else {
    clientId     = process.env[template.clientIdEnv];
    clientSecret = process.env[template.clientSecretEnv];
  }

  if (!clientId || !clientSecret) return null;

  return {
    provider,
    authorizationUrl: template.authorizationUrl,
    tokenUrl:         template.tokenUrl,
    clientId,
    clientSecret,
    scopes:           template.scopes,
    usesPkce:         template.usesPkce,
    usesNonce:        template.usesNonce,
    extraAuthParams:  template.extraAuthParams,
  };
}

/** @returns True when the provider authenticates via OAuth (configured or not). */
export function providerUsesOAuth(provider: string): boolean {
  return provider in TEMPLATES;
}

/** @returns The provider's revocation endpoint, when it has one. */
export function getRevocationUrl(provider: string): string | null {
  return TEMPLATES[provider]?.revocationUrl ?? null;
}

/** @returns Providers whose OAuth client credentials are configured right now. */
export function oauthConfiguredProviders(): string[] {
  return Object.keys(TEMPLATES).filter(p => getOAuthProviderConfig(p) !== null);
}
