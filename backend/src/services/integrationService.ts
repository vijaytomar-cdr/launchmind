/**
 * @file integrationService.ts
 * @description Integration framework — connect, disconnect, and list integrations
 *   beyond the original OAuth channels (ADR-014).
 *   Supports: ga4 (api_key), firebase (service_account), search_console (oauth),
 *   website (url_only), plus existing meta/google/whatsapp/linkedin/email.
 * @security
 *   - Credentials (API keys, service accounts) encrypted via tokenVault AES-256 + KMS.
 *   - encrypted_token NEVER returned to frontend.
 *   - integration_config IS returned (non-secret metadata only).
 * @dependencies tokenVault, supabaseAdmin, audit_logs
 */

import { encryptToken } from '../lib/tokenVault';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export type IntegrationType = 'oauth' | 'api_key' | 'service_account' | 'url_only';
export type IntegrationPlatform =
  | 'meta' | 'google' | 'whatsapp' | 'linkedin' | 'email'
  | 'ga4' | 'firebase' | 'search_console' | 'website';

export interface IntegrationStatus {
  platform:          IntegrationPlatform;
  integration_type:  IntegrationType | null;
  integration_config: Record<string, unknown> | null;
  connected:         boolean;
  scopes:            string[];
  expires_at:        string | null;
  revoked_at:        string | null;
  created_at:        string;
}

/**
 * Connects an API-key-based integration (GA4, Firebase).
 * Encrypts the key and stores integration_config metadata.
 */
export async function connectApiKeyIntegration(opts: {
  founderId:         string;
  platform:          IntegrationPlatform;
  apiKey:            string;
  integrationConfig: Record<string, unknown>;
  scopes?:           string[];
}): Promise<{ id: string }> {
  const { founderId, platform, apiKey, integrationConfig, scopes = [] } = opts;

  const { ciphertext: encryptedToken, kmsKeyId } = await encryptToken(apiKey);

  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .upsert(
      {
        founder_id:         founderId,
        platform,
        encrypted_token:    encryptedToken,
        kms_key_id:         kmsKeyId,
        scopes,
        integration_type:   'api_key',
        integration_config: integrationConfig,
        revoked_at:         null,
      },
      { onConflict: 'founder_id,platform' },
    )
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Upsert failed');

  // Audit log
  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id:    founderId,
    action:        'integration.connected',
    resource_type: 'platform_token',
    resource_id:   data.id,
    metadata:      { platform, integration_type: 'api_key' },
  });

  return data;
}

/**
 * Connects a URL-only integration (website).
 * No credentials — URL stored in integration_config.
 */
export async function connectUrlIntegration(opts: {
  founderId:         string;
  url:               string;
  integrationConfig?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const { founderId, url, integrationConfig = {} } = opts;

  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .upsert(
      {
        founder_id:         founderId,
        platform:           'website' as IntegrationPlatform,
        encrypted_token:    'url_only',    // placeholder — no real token
        kms_key_id:         'none',
        scopes:             [],
        integration_type:   'url_only',
        integration_config: { url, ...integrationConfig },
        revoked_at:         null,
      },
      { onConflict: 'founder_id,platform' },
    )
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Upsert failed');

  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id:    founderId,
    action:        'integration.connected',
    resource_type: 'platform_token',
    resource_id:   data.id,
    metadata:      { platform: 'website', url },
  });

  return data;
}

/**
 * Disconnects an integration (sets revoked_at — row preserved for audit).
 */
export async function disconnectIntegration(
  founderId: string,
  platform: IntegrationPlatform,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('founder_id', founderId)
    .eq('platform', platform)
    .is('revoked_at', null);

  if (error) throw error;

  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id:    founderId,
    action:        'integration.disconnected',
    resource_type: 'platform_token',
    metadata:      { platform },
  });
}

/**
 * Lists all integration statuses for a founder.
 * NEVER returns encrypted_token or kms_key_id.
 */
export async function listIntegrations(founderId: string): Promise<IntegrationStatus[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select(
      'platform, integration_type, integration_config, scopes, expires_at, revoked_at, created_at',
    )
    .eq('founder_id', founderId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map(row => ({
    platform:           row.platform as IntegrationPlatform,
    integration_type:   (row.integration_type ?? null) as IntegrationType | null,
    integration_config: (row.integration_config ?? null) as Record<string, unknown> | null,
    connected:          !row.revoked_at,
    scopes:             row.scopes ?? [],
    expires_at:         row.expires_at ?? null,
    revoked_at:         row.revoked_at ?? null,
    created_at:         row.created_at,
  }));
}

/**
 * Helper: checks if a specific platform is connected and not revoked.
 */
export async function isIntegrationConnected(
  founderId: string,
  platform: IntegrationPlatform,
): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select('id')
    .eq('founder_id', founderId)
    .eq('platform', platform)
    .is('revoked_at', null)
    .single();

  return !!data;
}
