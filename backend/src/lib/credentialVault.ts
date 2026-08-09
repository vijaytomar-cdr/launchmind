/**
 * @file credentialVault.ts
 * @description The canonical credential-vault interface and provider selection.
 *
 *   Everything that encrypts a provider credential, an OAuth token, or a PKCE
 *   verifier goes through this contract. Cloud-specific code lives behind it, so a
 *   change of key-management provider is a new implementation in `vault/`, not a
 *   change to any service.
 *
 *   The layering is deliberate:
 *
 *     services  →  tokenVault.ts (facade)  →  CredentialVault  →  vault/ociVault.ts
 *
 *   `tokenVault.ts` is kept as the public facade because twelve test suites mock
 *   that module path. Preserving it means the provider swap touches no caller and
 *   no existing test.
 *
 * @security The interface has no method that returns a key, exports a key, or
 *   accepts a key as a parameter. Plaintext appears only as an argument and a return
 *   value; it is never logged, cached, or persisted by anything in this layer.
 * @dependencies vault/ociVault.ts, vaultError.ts
 */

/** Result of an encrypt operation. `keyId` is persisted alongside the ciphertext. */
export interface EncryptResult {
  /** Base64 ciphertext, safe to store. Never returned to a browser. */
  ciphertext: string;
  /**
   * The key that produced this ciphertext, stored per row so keys can rotate
   * without forcing every founder to reconnect.
   *
   * Persisted in the `kms_key_id` column. That column name predates OCI and is
   * kept — renaming it would be a cosmetic migration across four tables. For OCI
   * rows it holds an `ocid1.key...` OCID.
   */
  keyId: string;
}

/** What a health probe learned, without leaking provider internals. */
export interface VaultHealth {
  status: 'healthy' | 'unavailable' | 'auth_failure' | 'config_error';
  /** Owner/operator-safe summary. Never contains an OCID, endpoint, or SDK text. */
  detail: string;
  /** Round-trip latency in ms when the probe actually ran. */
  latencyMs?: number;
}

/**
 * A key-management backend.
 *
 * Implementations MUST:
 *   - fail closed: throw {@link CredentialVaultUnavailableError} rather than return
 *     anything on failure. There is no plaintext fallback and no vault bypass.
 *   - never log plaintext, ciphertext, or credential material.
 *   - accept and preserve a traceId so a vault failure correlates with the request
 *     that caused it.
 */
export interface CredentialVault {
  /** Stable identifier for logs and diagnostics, e.g. 'oci'. */
  readonly name: string;

  /**
   * @param plaintext - The secret. Never logged.
   * @param traceId   - Correlation id, carried onto any thrown error.
   * @throws {Error} CredentialVaultUnavailableError on any failure whatsoever
   */
  encrypt(plaintext: string, traceId?: string | null): Promise<EncryptResult>;

  /**
   * @param ciphertext - As returned by {@link encrypt}
   * @param keyId      - The key id stored alongside that ciphertext
   * @throws {Error} CredentialVaultUnavailableError on any failure whatsoever
   */
  decrypt(ciphertext: string, keyId: string, traceId?: string | null): Promise<string>;

  /**
   * Non-destructive probe. Must not throw — a health endpoint that throws is not a
   * health endpoint.
   */
  healthCheck(): Promise<VaultHealth>;
}

/** Which backend is active. Only OCI exists; the union documents the seam. */
export type VaultProviderName = 'oci';

let cached: CredentialVault | null = null;

/**
 * Returns the active vault, constructing it once.
 *
 * Construction is lazy so that importing this module never reaches for cloud
 * credentials — tests, the type checker, and `--help`-style startup paths must not
 * require a configured vault.
 */
export async function getCredentialVault(): Promise<CredentialVault> {
  if (cached) return cached;
  // Imported lazily: pulling the OCI SDK in at module scope would make every test
  // that imports a service load several MB of client code it never calls. A dynamic
  // import (not require) so this resolves identically under CJS, ESM, and Vitest.
  const { createOciVault } = await import('./vault/ociVault');
  cached = createOciVault();
  return cached;
}

/** Test seam: replace the active vault. */
export function __setCredentialVaultForTest(vault: CredentialVault | null): void {
  cached = vault;
}
