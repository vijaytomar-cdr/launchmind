/**
 * @file ociVault.ts
 * @description OCI Vault / Key Management implementation of {@link CredentialVault}.
 *
 *   All API shapes here were read from the INSTALLED packages
 *   (oci-common 2.139, oci-keymanagement 2.139), not from memory:
 *
 *     client.encrypt({ encryptDataDetails: { keyId, plaintext } })
 *        → { encryptedData: { ciphertext } }
 *     client.decrypt({ decryptDataDetails: { keyId, ciphertext } })
 *        → { decryptedData: { plaintext, plaintextChecksum } }
 *
 *   Two OCI specifics that shape this file:
 *
 *   1. OCI KMS splits MANAGEMENT (create/rotate keys) from CRYPTOGRAPHIC
 *      (encrypt/decrypt) endpoints. Crypto has a per-vault hostname and the client
 *      will not discover it — it must be set explicitly. Only the crypto endpoint is
 *      configured here, because this service never manages keys. That is also why
 *      no vault OCID or compartment OCID is required at runtime.
 *
 *   2. `plaintext` is base64 in BOTH directions. Encrypt takes base64 and decrypt
 *      returns base64, so the encoding is symmetric and internal to this file.
 *
 * @security
 *   - Fails CLOSED. Every error path throws CredentialVaultUnavailableError; there
 *     is deliberately no plaintext fallback and no vault bypass, because storing an
 *     unencrypted provider credential to keep a flow moving would trade a
 *     recoverable outage for a permanent security failure.
 *   - Never logs plaintext, ciphertext, key OCIDs, or endpoints. Diagnostics carry
 *     only a reason code and a trace id.
 *   - Production uses Instance Principal: short-lived identity from the OCI metadata
 *     service, no static credentials on disk or in the environment.
 * @dependencies oci-common, oci-keymanagement, ../vaultError
 */

import * as common from 'oci-common';
import * as keymanagement from 'oci-keymanagement';
import {
  CredentialVaultUnavailableError,
  type VaultFailureReason,
} from '../vaultError';
import type { CredentialVault, EncryptResult, VaultHealth } from '../credentialVault';

/** Authentication modes this implementation supports. */
export type OciAuthMode = 'config_file' | 'instance_principal';

/** Config read from the environment, resolved once. */
interface OciVaultConfig {
  authMode:       OciAuthMode;
  keyOcid:        string;
  cryptoEndpoint: string;
  region:         string | null;
  profile:        string;
}

/**
 * Reads and validates configuration.
 *
 * @throws {CredentialVaultUnavailableError} reason 'not_configured' when a required
 *   value is missing or still a template placeholder. A placeholder is treated as
 *   missing on purpose: it looks configured and fails at the worst moment otherwise.
 */
function readConfig(traceId: string | null): OciVaultConfig {
  const authModeRaw = (process.env.OCI_VAULT_AUTH_MODE ?? '').trim();
  const keyOcid     = (process.env.OCI_VAULT_KEY_OCID ?? '').trim();
  const endpoint    = (process.env.OCI_VAULT_CRYPTO_ENDPOINT ?? '').trim();
  const region      = (process.env.OCI_REGION ?? '').trim() || null;
  const profile     = (process.env.OCI_CONFIG_PROFILE ?? 'DEFAULT').trim();

  const placeholder = (v: string) => !v || /YOUR_|your_|<|EXAMPLE|xxxx/i.test(v);

  const missing: string[] = [];
  if (authModeRaw !== 'config_file' && authModeRaw !== 'instance_principal') missing.push('OCI_VAULT_AUTH_MODE');
  if (placeholder(keyOcid) || !keyOcid.startsWith('ocid1.key.'))             missing.push('OCI_VAULT_KEY_OCID');
  if (placeholder(endpoint) || !/^https:\/\//.test(endpoint))                missing.push('OCI_VAULT_CRYPTO_ENDPOINT');

  if (missing.length > 0) {
    logFailure('config', 'not_configured', traceId, `missing/invalid: ${missing.join(',')}`);
    throw new CredentialVaultUnavailableError('not_configured', traceId);
  }

  return { authMode: authModeRaw as OciAuthMode, keyOcid, cryptoEndpoint: endpoint, region, profile };
}

/**
 * Builds an OCI authentication provider for the configured mode.
 *
 * `config_file` — local development. The private key stays referenced by `key_file`
 * inside ~/.oci/config; its contents are never read into the environment.
 *
 * `instance_principal` — production on an OCI Compute VM. Identity comes from the
 * instance metadata service, so there is no user API key and nothing long-lived to
 * leak or rotate.
 *
 * Resource Principal is deliberately not implemented: it applies to Functions, OKE
 * workload identity, and Data Science, none of which describe a docker-compose
 * deployment on a Compute VM. Adding it now would be an untested branch.
 */
async function buildAuthProvider(
  cfg: OciVaultConfig,
  traceId: string | null,
): Promise<common.AuthenticationDetailsProvider> {
  try {
    if (cfg.authMode === 'instance_principal') {
      return await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    }
    return new common.ConfigFileAuthenticationDetailsProvider(undefined, cfg.profile);
  } catch (err) {
    // A missing ~/.oci/config, an unreadable key_file, or an unreachable metadata
    // service all land here. They are configuration/identity problems, not crypto
    // problems, and are reported as such so an operator looks in the right place.
    const reason: VaultFailureReason =
      cfg.authMode === 'instance_principal' ? 'unreachable' : 'not_configured';
    logFailure('auth', reason, traceId, cfg.authMode);
    throw new CredentialVaultUnavailableError(reason, traceId, err);
  }
}

/** Cached client. Rebuilt only if configuration changes (tests, credential rotation). */
let clientCache: { key: string; client: keymanagement.KmsCryptoClient } | null = null;

async function getCryptoClient(
  cfg: OciVaultConfig,
  traceId: string | null,
): Promise<keymanagement.KmsCryptoClient> {
  const cacheKey = `${cfg.authMode}|${cfg.cryptoEndpoint}|${cfg.profile}`;
  if (clientCache && clientCache.key === cacheKey) return clientCache.client;

  const authenticationDetailsProvider = await buildAuthProvider(cfg, traceId);

  try {
    const client = new keymanagement.KmsCryptoClient({ authenticationDetailsProvider });
    // Crypto operations have a per-vault hostname the client cannot infer.
    client.endpoint = cfg.cryptoEndpoint;
    clientCache = { key: cacheKey, client };
    return client;
  } catch (err) {
    logFailure('client', 'not_configured', traceId, 'client construction');
    throw new CredentialVaultUnavailableError('not_configured', traceId, err);
  }
}

/**
 * Maps an OCI failure onto a vault reason without leaking OCI internals.
 *
 * Matching is on the SDK's structured `statusCode`/`serviceCode` (oci-common's
 * OciError), never on message text — a reworded Oracle message must not silently
 * reclassify a failure.
 *
 * @returns Unknown shapes fall back to 'unreachable', which is retryable. Telling an
 *   owner to give up on a transient fault is worse than asking them to try again.
 */
export function classifyOciError(err: unknown): VaultFailureReason {
  const e = err as { statusCode?: number; serviceCode?: string; code?: string; name?: string } | null;
  const status  = e?.statusCode;
  const service = (e?.serviceCode ?? '').toLowerCase();

  if (status === 401 || service === 'notauthenticated')                    return 'unauthorized';
  if (status === 403 || service === 'notauthorizedor[notfound]')           return 'unauthorized';
  if (status === 404 || service === 'notfound')                            return 'key_unavailable';
  if (status === 409 || service === 'incorrectstate')                      return 'key_unavailable';
  if (status === 429 || service === 'toomanyrequests')                     return 'throttled';
  if (typeof status === 'number' && status >= 500)                         return 'unreachable';

  // Node-level transport faults never reach OciError.
  const nodeCode = e?.code ?? e?.name ?? '';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|AbortError/i.test(nodeCode)) return 'unreachable';

  return 'unreachable';
}

/**
 * Emits a diagnostic line.
 *
 * Records ONLY the operation, reason, trace id, and a short non-sensitive hint.
 * OCI messages can carry OCIDs, tenancy ids, and request context, so the error
 * itself is never logged.
 */
function logFailure(
  op: 'encrypt' | 'decrypt' | 'health' | 'auth' | 'config' | 'client',
  reason: VaultFailureReason,
  traceId: string | null,
  hint = '',
): void {
  console.error(
    `[ociVault] credential vault unavailable op=${op} reason=${reason} trace=${traceId ?? 'none'}${hint ? ` hint=${hint}` : ''}`,
  );
}

/** Builds the OCI-backed vault. */
export function createOciVault(): CredentialVault {
  return {
    name: 'oci',

    async encrypt(plaintext: string, traceId: string | null = null): Promise<EncryptResult> {
      const cfg = readConfig(traceId);
      const client = await getCryptoClient(cfg, traceId);

      let response;
      try {
        response = await client.encrypt({
          encryptDataDetails: {
            keyId:     cfg.keyOcid,
            // OCI takes base64 plaintext. Encoding is internal to this file.
            plaintext: Buffer.from(plaintext, 'utf-8').toString('base64'),
          },
        });
      } catch (err) {
        const reason = classifyOciError(err);
        logFailure('encrypt', reason, traceId);
        throw new CredentialVaultUnavailableError(reason, traceId, err);
      }

      const ciphertext = response?.encryptedData?.ciphertext;
      if (!ciphertext) {
        // A 200 with no ciphertext is not a success. Returning here would persist an
        // empty credential and fail much later, somewhere far less diagnosable.
        logFailure('encrypt', 'encryption_failed', traceId, 'empty ciphertext');
        throw new CredentialVaultUnavailableError('encryption_failed', traceId);
      }

      return { ciphertext, keyId: cfg.keyOcid };
    },

    async decrypt(ciphertext: string, keyId: string, traceId: string | null = null): Promise<string> {
      const cfg = readConfig(traceId);
      const client = await getCryptoClient(cfg, traceId);

      let response;
      try {
        response = await client.decrypt({
          decryptDataDetails: {
            // The key recorded WITH the ciphertext, not the currently-configured
            // key: that is what allows a key to rotate without invalidating rows.
            keyId: keyId || cfg.keyOcid,
            ciphertext,
          },
        });
      } catch (err) {
        const reason = classifyOciError(err);
        logFailure('decrypt', reason, traceId);
        throw new CredentialVaultUnavailableError(reason, traceId, err);
      }

      const b64 = response?.decryptedData?.plaintext;
      if (!b64) {
        logFailure('decrypt', 'decryption_failed', traceId, 'empty plaintext');
        throw new CredentialVaultUnavailableError('decryption_failed', traceId);
      }

      return Buffer.from(b64, 'base64').toString('utf-8');
    },

    async healthCheck(): Promise<VaultHealth> {
      // Non-destructive: encrypts a fixed sentinel and decrypts it back. It proves
      // both directions and the key grant, creates nothing, and stores nothing.
      const SENTINEL = 'launchmind-vault-health-probe';
      const started = Date.now();

      try {
        const cfg = readConfig(null);
        const client = await getCryptoClient(cfg, null);

        const enc = await client.encrypt({
          encryptDataDetails: {
            keyId: cfg.keyOcid,
            plaintext: Buffer.from(SENTINEL, 'utf-8').toString('base64'),
          },
        });
        const ct = enc?.encryptedData?.ciphertext;
        if (!ct) return { status: 'unavailable', detail: 'Vault returned no ciphertext.' };

        const dec = await client.decrypt({
          decryptDataDetails: { keyId: cfg.keyOcid, ciphertext: ct },
        });
        const back = Buffer.from(dec?.decryptedData?.plaintext ?? '', 'base64').toString('utf-8');

        if (back !== SENTINEL) {
          // Both calls succeeded but the value changed. Reported as unavailable
          // rather than healthy: a vault that round-trips incorrectly is worse than
          // one that is plainly down.
          return { status: 'unavailable', detail: 'Vault round trip did not return the original value.' };
        }

        return { status: 'healthy', detail: 'Encrypt and decrypt verified.', latencyMs: Date.now() - started };
      } catch (err) {
        const reason = err instanceof CredentialVaultUnavailableError
          ? err.reason
          : classifyOciError(err);

        // Distinguish the three operator-actionable cases. No OCID, endpoint, or SDK
        // text crosses this boundary.
        if (reason === 'not_configured') {
          return { status: 'config_error', detail: 'Credential vault is not configured.' };
        }
        if (reason === 'unauthorized') {
          return { status: 'auth_failure', detail: 'Credential vault rejected this workload’s identity.' };
        }
        return { status: 'unavailable', detail: 'Credential vault is not reachable.' };
      }
    },
  };
}

/** Test seam: forget the cached client so a test can change configuration. */
export function __resetOciClientForTest(): void {
  clientCache = null;
}
