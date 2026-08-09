/**
 * @file credentialVault.test.ts
 * @description Proves the OCI credential vault behaves correctly and fails safely,
 *   with the OCI SDK mocked.
 *
 *   The assertions that matter most are the negative ones:
 *     - no plaintext fallback, ever
 *     - no OCI internals (OCIDs, endpoints, tenancy, SDK text) in any message or log
 *     - a config placeholder is treated as *missing*, not as configured
 *
 *   A vault outage is an infrastructure state the owner cannot fix and did not cause.
 *   Reporting it as "reconnect your provider" would send them to repair something
 *   that was never broken, which is why classification is tested per failure mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── OCI SDK is the only thing stubbed; the vault's own logic is real ─────────
const encryptFn = vi.fn();
const decryptFn = vi.fn();
const instancePrincipalBuild = vi.fn(async () => ({ kind: 'instance-principal' }));
const configFileCtor = vi.fn();

vi.mock('oci-keymanagement', () => ({
  KmsCryptoClient: class {
    endpoint = '';
    encrypt = encryptFn;
    decrypt = decryptFn;
    constructor(public params: unknown) {}
  },
}));

vi.mock('oci-common', () => ({
  ConfigFileAuthenticationDetailsProvider: class {
    constructor(path: unknown, profile: unknown) { configFileCtor(path, profile); }
  },
  InstancePrincipalsAuthenticationDetailsProviderBuilder: class {
    build = instancePrincipalBuild;
  },
}));

const auditInsert = vi.fn(async () => ({ error: null }));
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert: auditInsert }) }),
}));

import { createOciVault, classifyOciError, __resetOciClientForTest } from '../src/lib/vault/ociVault';
import { CredentialVaultUnavailableError } from '../src/lib/vaultError';

const KEY_OCID = 'ocid1.key.oc1.uk-london-1.abcdefg.abcdefghijklmnop';
const ENDPOINT = 'https://abcdefg-crypto.kms.uk-london-1.oci.oraclecloud.com';

/** The shape oci-common's OciError actually has. */
const ociError = (statusCode: number, serviceCode: string) =>
  Object.assign(new Error(`${serviceCode}: request to ${ENDPOINT} for key ${KEY_OCID} in tenancy ocid1.tenancy.oc1..xyz failed`), {
    statusCode, serviceCode, opcRequestId: 'ABC/DEF/GHI',
  });

/** OCI returns base64 in both directions. */
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

let errorSpy: ReturnType<typeof vi.spyOn>;

function configure(mode: 'config_file' | 'instance_principal' = 'config_file') {
  process.env.OCI_VAULT_AUTH_MODE       = mode;
  process.env.OCI_VAULT_KEY_OCID        = KEY_OCID;
  process.env.OCI_VAULT_CRYPTO_ENDPOINT = ENDPOINT;
  process.env.OCI_REGION                = 'uk-london-1';
  process.env.OCI_CONFIG_PROFILE        = 'DEFAULT';
}

beforeEach(() => {
  encryptFn.mockReset(); decryptFn.mockReset();
  instancePrincipalBuild.mockClear(); configFileCtor.mockClear(); auditInsert.mockClear();
  __resetOciClientForTest();
  configure();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

// ── Configuration ────────────────────────────────────────────────────────────

describe('configuration', () => {
  it.each([
    ['OCI_VAULT_AUTH_MODE', ''],
    ['OCI_VAULT_KEY_OCID', ''],
    ['OCI_VAULT_CRYPTO_ENDPOINT', ''],
  ])('refuses to run when %s is missing', async (name) => {
    process.env[name] = '';
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ code: 'CREDENTIAL_VAULT_UNAVAILABLE', reason: 'not_configured' });
    expect(encryptFn).not.toHaveBeenCalled();
  });

  it('treats a template placeholder as MISSING, not configured', async () => {
    // A placeholder looks configured and fails at the worst possible moment.
    process.env.OCI_VAULT_KEY_OCID = 'ocid1.key.oc1..YOUR_KEY_ID';
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ reason: 'not_configured' });
  });

  it('rejects a key id that is not an OCI key OCID', async () => {
    process.env.OCI_VAULT_KEY_OCID = 'arn:aws:kms:us-east-1:1234:key/abc';
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ reason: 'not_configured' });
  });

  it('rejects a non-https crypto endpoint', async () => {
    process.env.OCI_VAULT_CRYPTO_ENDPOINT = 'http://insecure.example.com';
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ reason: 'not_configured' });
  });
});

// ── Auth mode selection ──────────────────────────────────────────────────────

describe('authentication mode selection', () => {
  it('config_file uses the OCI config profile (local development)', async () => {
    configure('config_file');
    process.env.OCI_CONFIG_PROFILE = 'LAUNCHMIND';
    encryptFn.mockResolvedValue({ encryptedData: { ciphertext: 'ct' } });

    await createOciVault().encrypt('secret', 'lm_t');

    expect(configFileCtor).toHaveBeenCalledWith(undefined, 'LAUNCHMIND');
    expect(instancePrincipalBuild).not.toHaveBeenCalled();
  });

  it('instance_principal uses the metadata service (production)', async () => {
    configure('instance_principal');
    encryptFn.mockResolvedValue({ encryptedData: { ciphertext: 'ct' } });

    await createOciVault().encrypt('secret', 'lm_t');

    expect(instancePrincipalBuild).toHaveBeenCalledTimes(1);
    expect(configFileCtor).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised auth mode instead of silently defaulting', async () => {
    // Silently falling back to config_file in production would mean the workload
    // quietly looks for a user API key that must not exist there.
    process.env.OCI_VAULT_AUTH_MODE = 'resource_principal';
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ reason: 'not_configured' });
  });

  it('reports an unreachable metadata service as unreachable, not misconfiguration', async () => {
    configure('instance_principal');
    instancePrincipalBuild.mockRejectedValueOnce(new Error('connect ETIMEDOUT 169.254.169.254'));
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ reason: 'unreachable', retryable: true });
  });
});

// ── Error classification ─────────────────────────────────────────────────────

describe('classifyOciError', () => {
  it.each([
    [401, 'NotAuthenticated', 'unauthorized'],
    [403, 'NotAuthorizedOrNotFound', 'unauthorized'],
    [404, 'NotFound', 'key_unavailable'],
    [409, 'IncorrectState', 'key_unavailable'],
    [429, 'TooManyRequests', 'throttled'],
    [500, 'InternalServerError', 'unreachable'],
    [503, 'ServiceUnavailable', 'unreachable'],
  ])('maps HTTP %i/%s to %s', (status, code, expected) => {
    expect(classifyOciError(ociError(status, code))).toBe(expected);
  });

  it('maps node transport faults to unreachable', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']) {
      expect(classifyOciError(Object.assign(new Error('x'), { code }))).toBe('unreachable');
    }
  });

  it('defaults an unknown shape to a RETRYABLE reason', () => {
    expect(classifyOciError({})).toBe('unreachable');
    expect(classifyOciError(null)).toBe('unreachable');
  });

  it('classifies on structured fields, not on message text', () => {
    const reworded = Object.assign(new Error('totally different wording'), {
      statusCode: 401, serviceCode: 'NotAuthenticated',
    });
    expect(classifyOciError(reworded)).toBe('unauthorized');
  });
});

// ── Encrypt ──────────────────────────────────────────────────────────────────

describe('encrypt', () => {
  it('base64-encodes the plaintext and returns the key OCID', async () => {
    encryptFn.mockResolvedValue({ encryptedData: { ciphertext: 'CIPHER' } });

    const result = await createOciVault().encrypt('my-secret', 'lm_t');

    expect(result).toEqual({ ciphertext: 'CIPHER', keyId: KEY_OCID });
    const sent = encryptFn.mock.calls[0][0].encryptDataDetails;
    expect(sent.keyId).toBe(KEY_OCID);
    expect(sent.plaintext).toBe(b64('my-secret'));      // base64, per the OCI API
    expect(sent.plaintext).not.toBe('my-secret');
  });

  it('treats an empty ciphertext response as a failure, not a success', async () => {
    // A 200 with no ciphertext would otherwise persist an empty credential and fail
    // much later, somewhere far less diagnosable.
    encryptFn.mockResolvedValue({ encryptedData: {} });
    await expect(createOciVault().encrypt('secret', 'lm_t'))
      .rejects.toMatchObject({ reason: 'encryption_failed' });
  });

  it('NEVER falls back to plaintext', async () => {
    encryptFn.mockRejectedValue(ociError(403, 'NotAuthorizedOrNotFound'));
    let outcome: unknown = 'not-thrown';
    try { outcome = await createOciVault().encrypt('super-secret-token', 'lm_t'); }
    catch (e) { outcome = e; }

    expect(outcome).toBeInstanceOf(CredentialVaultUnavailableError);
    expect(JSON.stringify(outcome)).not.toContain('super-secret-token');
  });

  it('preserves the trace id on the thrown error', async () => {
    encryptFn.mockRejectedValue(ociError(401, 'NotAuthenticated'));
    await expect(createOciVault().encrypt('secret', 'lm_trace_abc'))
      .rejects.toMatchObject({ traceId: 'lm_trace_abc', reason: 'unauthorized' });
  });

  it('exposes no OCI internals in the owner-facing message', async () => {
    encryptFn.mockRejectedValue(ociError(403, 'NotAuthorizedOrNotFound'));
    try { await createOciVault().encrypt('secret', 'lm_t'); } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toBe('LaunchMind cannot securely store credentials right now. Nothing was saved.');
      for (const leak of ['ocid1.', 'oraclecloud.com', 'tenancy', 'opc-request', KEY_OCID]) {
        expect(msg).not.toContain(leak);
      }
    }
  });

  it('logs only safe diagnostic metadata', async () => {
    encryptFn.mockRejectedValue(ociError(403, 'NotAuthorizedOrNotFound'));
    try { await createOciVault().encrypt('secret', 'lm_trace_xyz'); } catch { /* expected */ }

    const logged = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('reason=unauthorized');
    expect(logged).toContain('trace=lm_trace_xyz');
    for (const leak of ['ocid1.', 'oraclecloud.com', 'tenancy', 'secret']) {
      expect(logged).not.toContain(leak);
    }
  });
});

// ── Decrypt ──────────────────────────────────────────────────────────────────

describe('decrypt', () => {
  it('base64-decodes the returned plaintext', async () => {
    decryptFn.mockResolvedValue({ decryptedData: { plaintext: b64('recovered-secret') } });
    const out = await createOciVault().decrypt('CIPHER', KEY_OCID, 'lm_t');
    expect(out).toBe('recovered-secret');
  });

  it('uses the key stored WITH the ciphertext, not the configured key', async () => {
    // This is what lets a key rotate without invalidating existing rows.
    const OLD_KEY = 'ocid1.key.oc1.uk-london-1.oldkey.oldoldoldoldold';
    decryptFn.mockResolvedValue({ decryptedData: { plaintext: b64('v') } });

    await createOciVault().decrypt('CIPHER', OLD_KEY, 'lm_t');

    expect(decryptFn.mock.calls[0][0].decryptDataDetails.keyId).toBe(OLD_KEY);
  });

  it('surfaces a wrong-key / failed decrypt as a typed error', async () => {
    decryptFn.mockRejectedValue(ociError(400, 'InvalidParameter'));
    await expect(createOciVault().decrypt('CIPHER', KEY_OCID, 'lm_t'))
      .rejects.toBeInstanceOf(CredentialVaultUnavailableError);
  });

  it('treats an empty plaintext response as a decryption failure', async () => {
    decryptFn.mockResolvedValue({ decryptedData: {} });
    await expect(createOciVault().decrypt('CIPHER', KEY_OCID, 'lm_t'))
      .rejects.toMatchObject({ reason: 'decryption_failed' });
  });
});

// ── Round trip through the mocked SDK ────────────────────────────────────────

describe('round trip', () => {
  it('encrypt → decrypt returns the original value', async () => {
    const vault = createOciVault();
    let stored = '';
    encryptFn.mockImplementation(async (req: { encryptDataDetails: { plaintext: string } }) => {
      stored = req.encryptDataDetails.plaintext;          // already base64
      return { encryptedData: { ciphertext: `wrapped:${stored}` } };
    });
    decryptFn.mockImplementation(async (req: { decryptDataDetails: { ciphertext: string } }) => ({
      decryptedData: { plaintext: req.decryptDataDetails.ciphertext.replace(/^wrapped:/, '') },
    }));

    for (const secret of [
      'sk_live_51ABCdefGHI',
      'ya29.NOTAREAL' + 'q'.repeat(100),
      JSON.stringify({ issuerId: 'a', keyId: 'b', privateKey: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----' }),
      'sk-ünïcödé-🔐-token',
    ]) {
      const { ciphertext, keyId } = await vault.encrypt(secret, 'lm_t');
      expect(ciphertext).not.toContain(secret);
      expect(await vault.decrypt(ciphertext, keyId, 'lm_t')).toBe(secret);
    }
  });
});

// ── Health check ─────────────────────────────────────────────────────────────

describe('healthCheck', () => {
  it('reports healthy when the sentinel round-trips', async () => {
    encryptFn.mockImplementation(async (r: { encryptDataDetails: { plaintext: string } }) =>
      ({ encryptedData: { ciphertext: r.encryptDataDetails.plaintext } }));
    decryptFn.mockImplementation(async (r: { decryptDataDetails: { ciphertext: string } }) =>
      ({ decryptedData: { plaintext: r.decryptDataDetails.ciphertext } }));

    const health = await createOciVault().healthCheck();
    expect(health.status).toBe('healthy');
    expect(typeof health.latencyMs).toBe('number');
  });

  it('distinguishes a configuration failure', async () => {
    process.env.OCI_VAULT_KEY_OCID = '';
    const health = await createOciVault().healthCheck();
    expect(health.status).toBe('config_error');
  });

  it('distinguishes an authentication failure', async () => {
    encryptFn.mockRejectedValue(ociError(401, 'NotAuthenticated'));
    const health = await createOciVault().healthCheck();
    expect(health.status).toBe('auth_failure');
  });

  it('distinguishes an unavailable vault', async () => {
    encryptFn.mockRejectedValue(ociError(503, 'ServiceUnavailable'));
    const health = await createOciVault().healthCheck();
    expect(health.status).toBe('unavailable');
  });

  it('reports unavailable when the round trip returns the WRONG value', async () => {
    // Both calls succeed but the value changed. A vault that round-trips incorrectly
    // is worse than one that is plainly down, so it must not report healthy.
    encryptFn.mockResolvedValue({ encryptedData: { ciphertext: 'x' } });
    decryptFn.mockResolvedValue({ decryptedData: { plaintext: b64('something-else') } });

    const health = await createOciVault().healthCheck();
    expect(health.status).toBe('unavailable');
  });

  it('never throws, and never leaks internals in its detail', async () => {
    encryptFn.mockRejectedValue(ociError(403, 'NotAuthorizedOrNotFound'));
    const health = await createOciVault().healthCheck();
    expect(health.status).not.toBe('healthy');
    for (const leak of ['ocid1.', 'oraclecloud.com', 'tenancy', 'opc-request']) {
      expect(health.detail).not.toContain(leak);
    }
  });
});

// ── Facade + audit ordering ──────────────────────────────────────────────────

describe('tokenVault facade', () => {
  it('keeps the { ciphertext, kmsKeyId } contract callers depend on', async () => {
    encryptFn.mockResolvedValue({ encryptedData: { ciphertext: 'CT' } });
    const { encryptToken } = await import('../src/lib/tokenVault');

    const out = await encryptToken('secret', 'lm_t');
    // kms_key_id is the historic column name; it now holds an OCI key OCID.
    expect(out).toEqual({ ciphertext: 'CT', kmsKeyId: KEY_OCID });
  });

  it('writes an audit row BEFORE returning plaintext', async () => {
    decryptFn.mockResolvedValue({ decryptedData: { plaintext: b64('v') } });
    const { decryptToken } = await import('../src/lib/tokenVault');

    let auditedBeforeDecrypt = false;
    decryptFn.mockImplementation(async () => {
      auditedBeforeDecrypt = auditInsert.mock.calls.length > 0;
      return { decryptedData: { plaintext: b64('v') } };
    });

    await decryptToken('CT', KEY_OCID, 'founder-1', 'lm_t');
    expect(auditedBeforeDecrypt).toBe(true);
  });

  it('records the key id in the audit row but no credential material', async () => {
    decryptFn.mockResolvedValue({ decryptedData: { plaintext: b64('super-secret') } });
    const { decryptToken } = await import('../src/lib/tokenVault');

    await decryptToken('CT', KEY_OCID, 'founder-1', 'lm_t');

    const row = auditInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.action).toBe('token_decrypted');
    expect(JSON.stringify(row)).toContain(KEY_OCID);          // identifier, not a secret
    expect(JSON.stringify(row)).not.toContain('super-secret');
  });
});

// ── AWS is gone ──────────────────────────────────────────────────────────────

describe('AWS removal', () => {
  it('no source file imports the AWS SDK', async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!full.endsWith('.ts')) continue;
        if (readFileSync(full, 'utf-8').includes('@aws-sdk')) offenders.push(full);
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });

  it('the AWS SDK is not a dependency', async () => {
    const pkg = await import('../package.json');
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(deps).filter(k => /^@aws-sdk/.test(k))).toEqual([]);
  });
});
