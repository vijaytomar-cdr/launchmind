/**
 * @file platformTokenService.ts
 * @description Secure OAuth token storage, retrieval, and revocation for connected platforms.
 *   All tokens are AES-256 encrypted via AWS KMS before touching the DB.
 *   Decrypted tokens are NEVER logged, cached, or returned to the frontend.
 * @security
 *   - storeToken()  : encrypts before insert; writes audit_log 'token_stored'
 *   - getToken()    : verifies founder_id ownership; checks revoked_at; decryptToken()
 *                     writes audit_log 'token_decrypted' before returning plaintext
 *   - revokeToken() : sets revoked_at (row preserved for audit); writes audit_log 'token_revoked'
 *   - encrypted_token and kms_key_id are NEVER returned in any API response
 *   - All errors throw — callers must handle and must NOT expose raw error messages to users
 * @dependencies tokenVault (encryptToken/decryptToken), supabaseAdmin, audit_logs, platform_tokens
 */

import { encryptToken, decryptToken } from '../lib/tokenVault';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export type SupportedPlatform = 'meta' | 'google' | 'whatsapp' | 'linkedin' | 'email';

/**
 * Encrypts and stores an OAuth token for a founder's platform connection.
 * Writes an immutable audit_log entry on success.
 * @param founderId     - UUID of the founder who owns this token
 * @param platform      - The platform being connected
 * @param plaintextToken - Raw OAuth access/refresh token (never stored plaintext)
 * @param scopes        - OAuth scopes granted
 * @param expiresAt     - ISO timestamp when this token expires (optional)
 * @throws {Error} If encryption fails, DB write fails, or founderId is missing
 * @security plaintextToken is encrypted immediately; never written to logs or DB as plaintext
 */
export async function storeToken(
  founderId: string,
  platform: SupportedPlatform,
  plaintextToken: string,
  scopes: string[],
  expiresAt?: string
): Promise<void> {
  if (!founderId) throw new Error('founderId is required');
  if (!plaintextToken) throw new Error('plaintextToken is required');

  const { ciphertext, kmsKeyId } = await encryptToken(plaintextToken);

  const { error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .upsert(
      {
        founder_id: founderId,
        platform,
        encrypted_token: ciphertext,
        kms_key_id: kmsKeyId,
        scopes,
        expires_at: expiresAt ?? null,
        revoked_at: null,
      },
      { onConflict: 'founder_id,platform' }
    );

  if (error) throw new Error(`Failed to store platform token: ${error.message}`);

  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id: founderId,
    action: 'token_stored',
    resource_type: 'platform_token',
    metadata: { platform, scopes },
  });
}

/**
 * Retrieves and decrypts a platform OAuth token for a founder.
 * Verifies ownership and revocation status before decrypting.
 * decryptToken() writes an additional audit_log 'token_decrypted' before returning.
 * @param founderId - UUID of the requesting founder
 * @param platform  - Platform whose token to retrieve
 * @returns         Decrypted plaintext OAuth token
 * @throws {Error}  If token not found, founder mismatch, token revoked, or decryption fails
 * @security
 *   - founderId checked against DB row before any decryption attempt
 *   - revoked_at checked — revoked tokens cannot be retrieved
 *   - Return value must NEVER be logged, cached, or forwarded to the frontend
 */
export async function getToken(
  founderId: string,
  platform: SupportedPlatform
): Promise<string> {
  const { data: row, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select('id, founder_id, encrypted_token, kms_key_id, revoked_at')
    .eq('founder_id', founderId)
    .eq('platform', platform)
    .single();

  if (error || !row) throw new Error(`No ${platform} token found for founder`);

  // Explicit founder_id ownership check — belt-and-suspenders on top of the .eq() filter
  if (row.founder_id !== founderId) {
    throw new Error('Token founder_id mismatch — access denied');
  }

  if (row.revoked_at) {
    throw new Error(`${platform} token has been revoked`);
  }

  return decryptToken(row.encrypted_token, row.kms_key_id, founderId);
}

/**
 * Revokes a platform token by setting revoked_at. The row is preserved for audit.
 * Writes an immutable audit_log entry.
 * @param founderId - UUID of the founder revoking the token
 * @param platform  - Platform whose token to revoke
 * @throws {Error}  If the token does not exist or the DB update fails
 * @security Row is NOT deleted — revoked_at is set so getToken() rejects future use.
 *   Callers should also call the platform's OAuth revoke endpoint before calling this.
 */
export async function revokeToken(
  founderId: string,
  platform: SupportedPlatform
): Promise<void> {
  const { data: existing, error: fetchError } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select('id')
    .eq('founder_id', founderId)
    .eq('platform', platform)
    .single();

  if (fetchError || !existing) throw new Error(`No ${platform} token found to revoke`);

  const { error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('founder_id', founderId)
    .eq('platform', platform);

  if (error) throw new Error(`Failed to revoke token: ${error.message}`);

  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id: founderId,
    action: 'token_revoked',
    resource_type: 'platform_token',
    metadata: { platform },
  });
}

/**
 * Lists connected platforms for a founder.
 * Returns metadata only — encrypted_token and kms_key_id are NEVER included.
 * @param founderId - UUID of the founder
 * @returns Array of connected platform summaries (no sensitive fields)
 * @security encrypted_token and kms_key_id explicitly excluded from SELECT
 */
export async function listConnectedPlatforms(founderId: string): Promise<
  Array<{
    platform: string;
    scopes: string[];
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>
> {
  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select('platform, scopes, expires_at, revoked_at, created_at')
    .eq('founder_id', founderId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list platforms: ${error.message}`);

  return (data ?? []).map((row) => ({
    platform: row.platform,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));
}
