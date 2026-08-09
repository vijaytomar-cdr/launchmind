/**
 * @file appleJwt.ts
 * @description Mints App Store Connect API bearer assertions.
 *
 *   Apple does not use OAuth for the App Store Connect API. Every request carries a
 *   short-lived ES256 JWT that the caller signs with a private key downloaded from
 *   App Store Connect → Users and Access → Integrations → App Store Connect API.
 *
 *   Token shape required by Apple:
 *     header  { alg: 'ES256', kid: <Key ID>, typ: 'JWT' }
 *     payload { iss: <Issuer ID>, iat, exp, aud: 'appstoreconnect-v1' }
 *
 *   Apple rejects any token whose lifetime exceeds 20 minutes, so assertions are
 *   minted per call rather than stored. The only thing at rest is the private key,
 *   held encrypted in connection_credentials.
 *
 * @security
 *   - The .p8 private key never leaves the backend and is never logged.
 *   - Assertions are ~15 minutes and are not persisted anywhere.
 *   - Malformed keys produce a typed NEEDS_REAUTH rather than a stack trace, so a
 *     paste error is a recoverable owner-facing state, not a 500.
 * @dependencies jose (ES256 / PKCS8), providers/types
 */

import { importPKCS8, SignJWT } from 'jose';
import { ProviderError } from './types';

/** Apple's fixed audience for App Store Connect API tokens. */
const ASC_AUDIENCE = 'appstoreconnect-v1';

/** Apple's hard ceiling is 20 minutes; 15 leaves room for clock skew. */
const ASC_TOKEN_TTL_SECONDS = 15 * 60;

/** The three pieces App Store Connect issues together for an API key. */
export interface AppleApiKeyCredential {
  /** Issuer ID (UUID) shown above the key list. */
  issuerId:   string;
  /** Key ID (10 chars) of the specific key. */
  keyId:      string;
  /** Contents of the downloaded .p8 file, PEM-encoded PKCS#8. */
  privateKey: string;
}

/**
 * Normalizes a pasted .p8 key.
 *
 * Owners paste these out of a text editor, a terminal, or an env var, so the header
 * and footer arrive with literal `\n`, CRLF, or no line breaks at all. Apple's key is
 * still valid in every case; only the PEM framing is mangled.
 *
 * @param raw - Whatever the owner supplied
 * @returns A PEM string jose can import
 * @throws {ProviderError} NEEDS_REAUTH when the value is not a private key at all
 */
export function normalizePrivateKey(raw: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ProviderError('NEEDS_REAUTH', 'The App Store Connect private key is missing.');
  }

  // Turn escaped newlines into real ones and normalize line endings.
  let pem = raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();

  const HEADER = '-----BEGIN PRIVATE KEY-----';
  const FOOTER = '-----END PRIVATE KEY-----';

  if (!pem.includes(HEADER)) {
    // Some owners paste only the base64 body. Rebuild the PEM framing around it.
    const body = pem.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(body) || body.length < 40) {
      throw new ProviderError(
        'NEEDS_REAUTH',
        'That does not look like an App Store Connect private key. Paste the full contents of the .p8 file you downloaded from Apple.',
      );
    }
    pem = `${HEADER}\n${(body.match(/.{1,64}/g) ?? []).join('\n')}\n${FOOTER}`;
  }

  // Re-wrap the body at 64 characters — jose rejects a single-line PEM body.
  const body = pem
    .replace(HEADER, '')
    .replace(FOOTER, '')
    .replace(/\s+/g, '');

  return `${HEADER}\n${(body.match(/.{1,64}/g) ?? []).join('\n')}\n${FOOTER}`;
}

/**
 * Serializes the three credential parts into the single string the credential vault
 * stores. Only the private key is secret, but issuer and key id are kept with it so
 * one encrypted blob is sufficient to call Apple.
 */
export function packAppleCredential(cred: AppleApiKeyCredential): string {
  return JSON.stringify({
    issuerId:   cred.issuerId,
    keyId:      cred.keyId,
    privateKey: normalizePrivateKey(cred.privateKey),
  });
}

/**
 * Reverses packAppleCredential.
 *
 * Also accepts a bare .p8 body plus issuer/key ids supplied out of band via
 * connection_config, which is how a connection created before packing was
 * introduced would look.
 *
 * @throws {ProviderError} NEEDS_REAUTH when the credential cannot be reconstructed
 */
export function unpackAppleCredential(
  stored: string,
  config: Record<string, unknown> = {},
): AppleApiKeyCredential {
  let parsed: Partial<AppleApiKeyCredential> | null = null;
  try {
    const candidate = JSON.parse(stored) as Partial<AppleApiKeyCredential>;
    if (candidate && typeof candidate === 'object' && candidate.privateKey) parsed = candidate;
  } catch {
    // Not JSON — treat the whole value as the raw key below.
  }

  const issuerId   = parsed?.issuerId   ?? (config.issuer_id as string | undefined);
  const keyId      = parsed?.keyId      ?? (config.key_id as string | undefined);
  const privateKey = parsed?.privateKey ?? stored;

  if (!issuerId || !keyId) {
    throw new ProviderError(
      'NEEDS_REAUTH',
      'This App Store Connect connection is missing its Issuer ID or Key ID. Reconnect to supply them.',
    );
  }

  return { issuerId, keyId, privateKey: normalizePrivateKey(privateKey) };
}

/**
 * Signs a short-lived App Store Connect bearer assertion.
 *
 * @param cred - Issuer ID, Key ID, and PKCS#8 private key
 * @returns A compact JWS to send as `Authorization: Bearer <token>`
 * @throws {ProviderError} NEEDS_REAUTH when the key cannot be imported or signed with
 * @security The returned assertion is short-lived and must never be persisted.
 *   Import failures are mapped to a typed error so the raw key never reaches a log.
 */
export async function signAppleAssertion(cred: AppleApiKeyCredential): Promise<string> {
  let key;
  try {
    key = await importPKCS8(normalizePrivateKey(cred.privateKey), 'ES256');
  } catch {
    // Deliberately no cause: the message could echo key material.
    throw new ProviderError(
      'NEEDS_REAUTH',
      'That App Store Connect private key could not be read. Download a fresh .p8 key from Apple and reconnect.',
    );
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cred.keyId, typ: 'JWT' })
      .setIssuer(cred.issuerId)
      .setIssuedAt(now)
      .setExpirationTime(now + ASC_TOKEN_TTL_SECONDS)
      .setAudience(ASC_AUDIENCE)
      .sign(key);
  } catch {
    throw new ProviderError(
      'NEEDS_REAUTH',
      'Could not sign a request for App Store Connect with the stored key. Reconnect with a fresh key.',
    );
  }
}
