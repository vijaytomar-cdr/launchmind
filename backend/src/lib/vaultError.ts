/**
 * @file vaultError.ts
 * @description The credential-vault failure type, kept in its own module.
 *
 *   WHY IT IS NOT IN tokenVault.ts: tests routinely `vi.mock('../lib/tokenVault')`
 *   to stub encrypt/decrypt. A mocked module does not re-export the real class, so
 *   any `err instanceof CredentialVaultUnavailableError` in a route resolved against
 *   `undefined` and threw a TypeError — turning every typed 401/404/409 into a 500.
 *
 *   Error identity therefore lives somewhere nobody has a reason to mock. The
 *   `isCredentialVaultUnavailable` guard is provided for the same reason: it works
 *   across module-instance boundaries, where `instanceof` alone cannot be trusted.
 *
 * @security The message is a fixed owner-safe string. The underlying provider error
 *   is retained on `cause` for server-side diagnostics and must never be serialized.
 */

/** Why the credential vault could not be used. Never surfaced verbatim to an owner. */
export type VaultFailureReason =
  | 'not_configured'      // vault env vars missing or placeholder — deployment gap
  | 'unauthorized'        // credentials rejected or expired
  | 'unreachable'         // network/endpoint/timeout
  | 'key_unavailable'     // key disabled, pending deletion, or not found
  | 'throttled'
  | 'encryption_failed'
  | 'decryption_failed';

/**
 * Raised when the credential vault itself is unavailable.
 *
 * Deliberately distinct from "the provider rejected your credential". The owner did
 * nothing wrong and has nothing to fix; LaunchMind cannot currently store or read
 * secrets safely. Conflating the two sends an owner to re-authorize a provider that
 * was never the problem.
 *
 * Callers must NOT fall back to plaintext, skip the vault, or degrade encryption.
 * The only correct response is to fail closed and let the owner retry.
 */
export class CredentialVaultUnavailableError extends Error {
  readonly name = 'CredentialVaultUnavailableError';
  /** 503: an infrastructure state, and one that is expected to pass. */
  readonly statusCode = 503;
  readonly code = 'CREDENTIAL_VAULT_UNAVAILABLE';
  readonly retryable = true;
  readonly reason: VaultFailureReason;
  readonly traceId: string | null;

  constructor(reason: VaultFailureReason, traceId: string | null = null, cause?: unknown) {
    super('LaunchMind cannot securely store credentials right now. Nothing was saved.');
    this.reason = reason;
    this.traceId = traceId;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Structural check that survives module mocking and duplicate module instances.
 *
 * @param err - Any thrown value
 * @returns True when it is a credential-vault failure
 */
export function isCredentialVaultUnavailable(err: unknown): err is CredentialVaultUnavailableError {
  if (err instanceof CredentialVaultUnavailableError) return true;
  const e = err as { name?: string; code?: string } | null;
  return e?.name === 'CredentialVaultUnavailableError' || e?.code === 'CREDENTIAL_VAULT_UNAVAILABLE';
}

/**
 * Maps a cloud-provider failure onto a vault reason without leaking internals.
 *
 * Matching is on the SDK's structured error fields, not on message text, so a
 * reworded provider message cannot silently reclassify a failure.
 *
 * Retained for the legacy AWS error shapes so any stray caller still classifies
 * safely; OCI errors are classified by classifyOciError in vault/ociVault.ts.
 *
 * @returns The reason to record; unknown shapes fall back to 'unreachable', which is
 *   retryable — telling an owner to give up on a transient fault is worse than
 *   asking them to try again.
 */
export function classifyVaultError(err: unknown): VaultFailureReason {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  const name = e?.name ?? '';
  const status = e?.$metadata?.httpStatusCode;

  if (
    name === 'UnrecognizedClientException' ||
    name === 'InvalidSignatureException' ||
    name === 'ExpiredTokenException' ||
    name === 'AccessDeniedException' ||
    name === 'CredentialsProviderError' ||
    status === 401 || status === 403
  ) return 'unauthorized';

  if (
    name === 'NotFoundException' ||
    name === 'DisabledException' ||
    name === 'KMSInvalidStateException' ||
    name === 'KeyUnavailableException'
  ) return 'key_unavailable';

  if (name === 'ThrottlingException' || status === 429) return 'throttled';

  if (
    name === 'TimeoutError' ||
    name === 'NetworkingError' ||
    name === 'ENOTFOUND' ||
    (typeof status === 'number' && status >= 500)
  ) return 'unreachable';

  return 'unreachable';
}
