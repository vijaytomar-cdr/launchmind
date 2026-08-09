/**
 * @file tokenVault.ts
 * @description Public facade over the credential vault.
 *
 *   Every service that handles a provider credential, an OAuth access/refresh token,
 *   or a PKCE verifier calls `encryptToken` / `decryptToken` from here. Those two
 *   signatures are the stable contract; which cloud performs the cryptography is an
 *   implementation detail behind {@link CredentialVault}.
 *
 *   This file remains the entry point specifically because twelve test suites mock
 *   `../lib/tokenVault`. Keeping the facade meant migrating from AWS KMS to OCI Vault
 *   without touching a single caller or a single existing test.
 *
 *   Backend: **OCI Vault / Key Management**. AWS KMS was removed once the database
 *   was verified to hold zero AWS-encrypted rows across platform_tokens,
 *   connection_credentials, and oauth_authorization_requests.
 *
 * @security
 *   - Plaintext is NEVER logged, cached, or returned to the frontend.
 *   - Every decryptToken() call writes an audit_logs entry BEFORE returning the
 *     token. A decrypt that returned first would be an unlogged credential read.
 *   - The caller verifies founder/workspace ownership before invoking decryptToken.
 *   - The key id is stored alongside each ciphertext, so keys rotate without forcing
 *     a reconnect.
 * @dependencies credentialVault.ts, vault/ociVault.ts, supabaseAdmin, audit_logs
 */

import { getCredentialVault } from './credentialVault';
import { getSupabaseAdmin } from './supabaseAdmin';

// Error identity lives in vaultError.ts, which nothing mocks. Defining it in this
// module meant `vi.mock('../lib/tokenVault')` erased the class, so route-level
// instanceof checks resolved against undefined and every typed error became a 500.
export {
  CredentialVaultUnavailableError,
  classifyVaultError,
  isCredentialVaultUnavailable,
} from './vaultError';
export type { VaultFailureReason } from './vaultError';

export type { CredentialVault, VaultHealth } from './credentialVault';

/**
 * Encrypts a credential.
 *
 * @param plaintext - Raw credential, OAuth token, or PKCE verifier
 * @param traceId   - Correlation id, carried onto any thrown vault error
 * @returns `{ ciphertext, kmsKeyId }` — persist BOTH. `kmsKeyId` is the historic
 *   column name and now holds an OCI key OCID; it is not renamed here because that
 *   would be a cosmetic migration across four tables.
 * @throws {CredentialVaultUnavailableError} on any vault failure. Never falls back
 *   to plaintext.
 * @security Plaintext exists only as an argument; it is never logged.
 */
export async function encryptToken(
  plaintext: string,
  traceId: string | null = null,
): Promise<{ ciphertext: string; kmsKeyId: string }> {
  const vault = await getCredentialVault();
  const { ciphertext, keyId } = await vault.encrypt(plaintext, traceId);
  return { ciphertext, kmsKeyId: keyId };
}

/**
 * Decrypts a credential, writing an audit entry first.
 *
 * @param ciphertext - Stored ciphertext
 * @param kmsKeyId   - The key id stored with it (OCI key OCID)
 * @param founderId  - Owner, for the audit trail; verified by the caller
 * @param traceId    - Correlation id
 * @throws {CredentialVaultUnavailableError} on any vault failure
 * @security The audit row is written BEFORE the plaintext is returned, so a
 *   credential read cannot happen without a record of it.
 */
export async function decryptToken(
  ciphertext: string,
  kmsKeyId: string,
  founderId: string,
  traceId: string | null = null,
): Promise<string> {
  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id: founderId,
    action: 'token_decrypted',
    resource_type: 'platform_token',
    // The key id is an identifier, not a secret; it is what makes a decrypt
    // attributable to a specific key during an incident review.
    metadata: { keyId: kmsKeyId },
  });

  const vault = await getCredentialVault();
  return vault.decrypt(ciphertext, kmsKeyId, traceId);
}

/**
 * Non-destructive vault probe for /health/detailed.
 * @returns A status the health endpoint can render. Never throws.
 */
export async function checkVaultHealth() {
  try {
    const vault = await getCredentialVault();
    return await vault.healthCheck();
  } catch {
    return { status: 'unavailable' as const, detail: 'Credential vault probe failed.' };
  }
}
