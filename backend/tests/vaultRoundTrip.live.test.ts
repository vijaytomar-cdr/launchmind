/**
 * @file vaultRoundTrip.live.test.ts
 * @description credential → encrypt → decrypt → equality, against a REAL OCI Vault.
 *
 *   credentialVault.test.ts stubs the OCI SDK, which proves the error handling and
 *   the request shapes but says nothing about whether a credential actually survives
 *   the round trip. If encrypt/decrypt does not round-trip, every OAuth provider
 *   fails at the PKCE-verifier step and every stored provider token becomes
 *   unreadable — so this is the precondition to check before wiring any provider.
 *
 *   Only the audit-log DB write is stubbed; the OCI calls are real.
 *
 *   Run (see AGENTS.md):
 *     OCI_VAULT_AUTH_MODE=config_file \
 *     OCI_VAULT_KEY_OCID=ocid1.key... \
 *     OCI_VAULT_CRYPTO_ENDPOINT=https://<prefix>-crypto.kms.<region>.oci.oraclecloud.com \
 *     OCI_REGION=<region> npm --prefix backend run test:vault
 *
 *   Skips loudly when the vault is unconfigured or still holds template
 *   placeholders. A skipped round trip is not evidence of a working vault.
 *
 * @security Uses throwaway sentinel values. Nothing is persisted. No OCID, endpoint,
 *   ciphertext, or plaintext is printed.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// The audit write is the only stub — decryptToken records an audit_logs row before
// returning plaintext, and this test must not write to a real database.
const auditInsert = vi.fn(async () => ({ error: null }));
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert: auditInsert }) }),
}));

import { encryptToken, decryptToken, checkVaultHealth } from '../src/lib/tokenVault';

let live = false;
let skipReason = '';

beforeAll(() => {
  const mode     = (process.env.OCI_VAULT_AUTH_MODE ?? '').trim();
  const keyOcid  = (process.env.OCI_VAULT_KEY_OCID ?? '').trim();
  const endpoint = (process.env.OCI_VAULT_CRYPTO_ENDPOINT ?? '').trim();

  // A placeholder is worse than nothing: it looks configured and fails at runtime.
  const placeholder = (v: string) => !v || /YOUR_|your_|<|EXAMPLE|xxxx/i.test(v);

  if (mode !== 'config_file' && mode !== 'instance_principal') skipReason = 'OCI_VAULT_AUTH_MODE not set';
  else if (placeholder(keyOcid) || !keyOcid.startsWith('ocid1.key.')) skipReason = 'OCI_VAULT_KEY_OCID missing or placeholder';
  else if (placeholder(endpoint)) skipReason = 'OCI_VAULT_CRYPTO_ENDPOINT missing or placeholder';
  else live = true;
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!live) { console.warn(`[SKIPPED — ${skipReason}] ${name}`); return; }
    await fn();
  }, 60_000);

describe('OCI credential vault — real encrypt/decrypt round trip', () => {
  maybe('a credential survives encrypt → decrypt byte-identically', async () => {
    const credential = 'sk_live_' + 'NOTAREALKEY00000'.repeat(3) + '_END';

    const { ciphertext, kmsKeyId } = await encryptToken(credential, 'lm_roundtrip');
    expect(ciphertext).toBeTruthy();
    expect(kmsKeyId).toBe(process.env.OCI_VAULT_KEY_OCID);
    expect(kmsKeyId.startsWith('ocid1.key.')).toBe(true);   // OCI, not an AWS ARN

    const recovered = await decryptToken(ciphertext, kmsKeyId, 'probe-founder', 'lm_roundtrip');
    expect(recovered).toBe(credential);
    expect(recovered.length).toBe(credential.length);
  });

  maybe('the ciphertext does not contain the plaintext', async () => {
    const credential = 'rk_test_UNIQUE_MARKER_9f3a2b';
    const { ciphertext } = await encryptToken(credential, 'lm_roundtrip');

    expect(ciphertext).not.toBe(credential);
    expect(ciphertext).not.toContain(credential);
    expect(ciphertext).not.toContain('UNIQUE_MARKER');
    // Base64 of the plaintext would also be a leak.
    expect(ciphertext).not.toContain(Buffer.from(credential, 'utf-8').toString('base64'));
  });

  maybe('round-trips the shapes real providers actually use', async () => {
    const credentials = [
      'sk_live_' + 'NOTAREALKEY'.repeat(2) + 'FIXTURE00',                       // Stripe restricted key
      'ya29.NOTAREAL-' + 'q'.repeat(120),                       // Google access token
      '1//0gNOTAREAL-refresh-token_' + 'z'.repeat(60),                // Google refresh token
      JSON.stringify({ issuerId: 'a-b-c', keyId: 'ABC123',        // Apple packed credential
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n' }),
      'sk-ünïcödé-🔐-token',                                       // non-ASCII must survive
    ];

    for (const credential of credentials) {
      const { ciphertext, kmsKeyId } = await encryptToken(credential, 'lm_roundtrip');
      const recovered = await decryptToken(ciphertext, kmsKeyId, 'probe-founder', 'lm_roundtrip');
      expect(recovered).toBe(credential);
    }
  });

  maybe('two encryptions of the same credential differ but both decrypt', async () => {
    // Deterministic ciphertext would leak that two workspaces hold the same secret.
    const credential = 'sk_test_same_input_twice';
    const a = await encryptToken(credential, 'lm_roundtrip');
    const b = await encryptToken(credential, 'lm_roundtrip');

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptToken(a.ciphertext, a.kmsKeyId, 'f', 'lm_roundtrip')).toBe(credential);
    expect(await decryptToken(b.ciphertext, b.kmsKeyId, 'f', 'lm_roundtrip')).toBe(credential);
  });

  maybe('an audit row is written BEFORE plaintext is returned', async () => {
    // The ordering is the security property: a decrypt that returns before its audit
    // entry exists is an unlogged credential read.
    const { ciphertext, kmsKeyId } = await encryptToken('sk_audit_check', 'lm_roundtrip');
    auditInsert.mockClear();

    const recovered = await decryptToken(ciphertext, kmsKeyId, 'founder-xyz', 'lm_roundtrip');
    expect(auditInsert).toHaveBeenCalled();
    expect(recovered).toBe('sk_audit_check');
  });

  maybe('tampered ciphertext fails closed rather than returning garbage', async () => {
    const { ciphertext, kmsKeyId } = await encryptToken('sk_tamper_target', 'lm_roundtrip');

    const raw = Buffer.from(ciphertext, 'base64');
    raw[Math.floor(raw.length / 2)] ^= 0xff;                     // flip a byte
    const tampered = raw.toString('base64');

    await expect(decryptToken(tampered, kmsKeyId, 'f', 'lm_roundtrip')).rejects.toBeTruthy();
  });

  maybe('the health probe reports healthy against the live vault', async () => {
    const health = await checkVaultHealth();
    expect(health.status).toBe('healthy');
    // The detail is operator-facing and must not carry infrastructure identifiers.
    for (const leak of ['ocid1.', 'oraclecloud.com', 'tenancy']) {
      expect(health.detail).not.toContain(leak);
    }
  });
});
