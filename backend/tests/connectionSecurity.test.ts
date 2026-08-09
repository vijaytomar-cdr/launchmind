/**
 * @file connectionSecurity.test.ts
 * @description Security tests for the shared connection infrastructure (Step 2, item 13):
 *     - invalid OAuth state
 *     - expired state
 *     - state replay
 *     - workspace access revoked between authorization and callback
 *     - redirect URI validation
 *     - PKCE generation
 *     - account substitution
 *     - token refresh and rotation
 *     - reauthorization does not widen authority
 *     - disconnect / revoke
 *     - permission escalation rejection
 *     - no credential material in anything returned to a caller
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER_A   = 'aaaa0000-0000-0000-0000-00000000000a';
const FOUNDER_B   = 'bbbb0000-0000-0000-0000-00000000000b';
const EDITOR      = 'eded0000-0000-0000-0000-00000000000e';
const WORKSPACE_A = '11110000-0000-0000-0000-000000000001';
const WORKSPACE_B = '22220000-0000-0000-0000-000000000002';
const CONNECTION_A = 'c0000000-0000-0000-0000-0000000000a1';

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => db.asClient(),
}));

// Deterministic, reversible fake vault so tests can assert on what was stored.
vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async (plaintext: string) => ({
    ciphertext: `enc(${plaintext})`,
    kmsKeyId:   'arn:aws:kms:test',
  })),
  decryptToken: vi.fn(async (ciphertext: string) => ciphertext.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

import {
  generatePkcePair,
  isAllowedRedirectUri,
  canonicalRedirectUri,
  createAuthorizationRequest,
  consumeAuthorizationRequest,
  exchangeAuthorizationCode,
  refreshAccessToken,
  OAuthError,
  type OAuthProviderConfig,
} from '../src/services/oauthService';
import {
  storeCredential,
  getCredentialSummary,
  getAccessToken,
  rotateAccessToken,
  revokeCredential,
  AccountSubstitutionError,
  CredentialError,
} from '../src/services/connectionCredentialService';
import {
  grantInitialPermissions,
  approveAuthorityUpgrade,
  requestAuthorityUpgrade,
  downgradeAuthority,
  assertAuthority,
  getEffectivePermissions,
  recordReauthorization,
  normalizePermissions,
  DEFAULT_CONNECTION_PERMISSIONS,
  EXECUTION_PERMISSIONS,
  AuthorityError,
} from '../src/services/connectionPermissionService';
import { WorkspacePermissionError, type WorkspaceContext } from '../src/services/workspaceAuthService';

const OWNER_CTX: WorkspaceContext  = { actorId: FOUNDER_A, workspaceId: WORKSPACE_A, role: 'owner',  isOwner: true };
const EDITOR_CTX: WorkspaceContext = { actorId: EDITOR,    workspaceId: WORKSPACE_A, role: 'editor', isOwner: false };

const TEST_CONFIG: OAuthProviderConfig = {
  provider:         'ga4',
  authorizationUrl: 'https://accounts.example.test/authorize',
  tokenUrl:         'https://oauth.example.test/token',
  clientId:         'test-client-id',
  clientSecret:     'test-client-secret',
  scopes:           ['analytics.readonly'],
  usesPkce:         true,
  usesNonce:        false,
};

beforeEach(() => {
  process.env.API_BASE_URL = 'https://api.launchmind.test';
  db = new MemoryDb({
    founders: [
      { id: FOUNDER_A, active_workspace_id: WORKSPACE_A },
      { id: FOUNDER_B, active_workspace_id: WORKSPACE_B },
      { id: EDITOR,    active_workspace_id: null },
    ],
    workspaces: [
      { id: WORKSPACE_A, founder_id: FOUNDER_A, created_at: '2026-01-01' },
      { id: WORKSPACE_B, founder_id: FOUNDER_B, created_at: '2026-01-02' },
    ],
    workspace_members: [
      { id: 'm1', workspace_id: WORKSPACE_A, founder_id: EDITOR, role: 'editor', accepted_at: '2026-02-01' },
    ],
    workspace_connections: [
      {
        id: CONNECTION_A, workspace_id: WORKSPACE_A, founder_id: FOUNDER_A,
        provider: 'ga4', status: 'HEALTHY', product_id: null,
        permissions_granted: [], connection_config: {},
      },
    ],
    connection_credentials: [],
    connection_permission_history: [],
    oauth_authorization_requests: [],
    audit_logs: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Redirect URI validation ───────────────────────────────────────────────────

describe('redirect URI validation', () => {
  it('accepts only the exact canonical URI', () => {
    expect(isAllowedRedirectUri(canonicalRedirectUri())).toBe(true);
  });

  it('rejects near-miss URIs that prefix matching would allow', () => {
    const base = 'https://api.launchmind.test/connections/oauth/callback';
    for (const evil of [
      `${base}/`,                                   // trailing slash
      `${base}?next=https://evil.test`,             // appended query
      `${base}.evil.test`,                          // suffix host
      'https://api.launchmind.test.evil.test/connections/oauth/callback',
      'https://evil.test/connections/oauth/callback',
      'http://api.launchmind.test/connections/oauth/callback', // downgraded scheme
      'https://user@api.launchmind.test/connections/oauth/callback',
      '',
    ]) {
      expect({ uri: evil, allowed: isAllowedRedirectUri(evil) })
        .toEqual({ uri: evil, allowed: false });
    }
  });
});

// ── PKCE ──────────────────────────────────────────────────────────────────────

describe('PKCE', () => {
  it('produces an S256 challenge derived from the verifier', () => {
    const { verifier, challenge, method } = generatePkcePair();
    expect(method).toBe('S256');
    // RFC 7636 length bounds.
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).not.toBe(verifier);
    // base64url alphabet only — no padding or + /
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats a verifier', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePkcePair().verifier));
    expect(seen.size).toBe(50);
  });
});

// ── Authorization request lifecycle ───────────────────────────────────────────

describe('OAuth state', () => {
  async function newRequest(actorId = FOUNDER_A, workspaceId = WORKSPACE_A) {
    return createAuthorizationRequest({ config: TEST_CONFIG, workspaceId, actorId });
  }

  it('returns an opaque state that leaks no identifiers', async () => {
    const created = await newRequest();
    // The browser must not be able to read the founder or workspace out of it.
    expect(created.state).not.toContain(FOUNDER_A);
    expect(created.state).not.toContain(WORKSPACE_A);
    const decoded = Buffer.from(created.state, 'base64url').toString('utf-8');
    expect(decoded).not.toContain(FOUNDER_A);
    expect(decoded).not.toContain(WORKSPACE_A);
    expect(created.state.length).toBeGreaterThanOrEqual(40); // 256 bits base64url
  });

  it('stores the verifier encrypted and sends only the challenge', async () => {
    await newRequest();
    const row = db.rows('oauth_authorization_requests')[0];
    expect(String(row.encrypted_code_verifier)).toMatch(/^enc\(/);
    expect(row.code_challenge).toBeTruthy();
    expect(row.code_challenge).not.toBe(row.encrypted_code_verifier);
    expect(row.code_challenge_method).toBe('S256');
  });

  it('puts the challenge, not the verifier, in the authorization URL', async () => {
    const created = await newRequest();
    const url = new URL(created.authorizationUrl);
    const row = db.rows('oauth_authorization_requests')[0];
    expect(url.searchParams.get('code_challenge')).toBe(row.code_challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(created.authorizationUrl).not.toContain('code_verifier');
    // The client secret must never appear in a browser-visible URL.
    expect(created.authorizationUrl).not.toContain('test-client-secret');
  });

  it('consumes a valid state exactly once', async () => {
    const created = await newRequest();
    const consumed = await consumeAuthorizationRequest(created.state);
    expect(consumed).toMatchObject({
      provider: 'ga4', workspaceId: WORKSPACE_A, actorId: FOUNDER_A, intent: 'connect',
    });
    expect(consumed.codeVerifier).toBeTruthy();
  });

  it('rejects a REPLAYED state', async () => {
    const created = await newRequest();
    await consumeAuthorizationRequest(created.state);
    await expect(consumeAuthorizationRequest(created.state))
      .rejects.toMatchObject({ code: 'STATE_REPLAYED' });
  });

  it('records the replay attempt for auditing', async () => {
    const created = await newRequest();
    await consumeAuthorizationRequest(created.state);
    await consumeAuthorizationRequest(created.state).catch(() => undefined);
    const row = db.rows('oauth_authorization_requests')[0];
    expect(row.rejected_reason).toBe('replay_attempt');
  });

  it('rejects an UNKNOWN state', async () => {
    await expect(consumeAuthorizationRequest('totally-made-up-state-value-1234'))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects a malformed state before touching the database', async () => {
    for (const bad of ['', 'short', '../../etc/passwd', "' OR 1=1--", 'a'.repeat(500)]) {
      await expect(consumeAuthorizationRequest(bad)).rejects.toBeInstanceOf(OAuthError);
    }
  });

  it('rejects an EXPIRED state', async () => {
    const created = await newRequest();
    const rows = db.rows('oauth_authorization_requests').map(r =>
      r.state === created.state ? { ...r, expires_at: new Date(Date.now() - 1000).toISOString() } : r,
    );
    db.setRows('oauth_authorization_requests', rows);

    await expect(consumeAuthorizationRequest(created.state))
      .rejects.toMatchObject({ code: 'STATE_EXPIRED' });
  });

  it('rejects when the actor LOST workspace access after authorizing', async () => {
    // Issued while the editor was a member; membership removed before the callback.
    const created = await createAuthorizationRequest({
      config: TEST_CONFIG, workspaceId: WORKSPACE_A, actorId: EDITOR,
    });
    db.setRows('workspace_members', []);

    await expect(consumeAuthorizationRequest(created.state))
      .rejects.toMatchObject({ code: 'WORKSPACE_ACCESS_REVOKED' });
  });

  it('rejects a state issued for a workspace the actor never belonged to', async () => {
    // Simulates a forged request row pointing at another tenant.
    const created = await createAuthorizationRequest({
      config: TEST_CONFIG, workspaceId: WORKSPACE_B, actorId: EDITOR,
    });
    await expect(consumeAuthorizationRequest(created.state))
      .rejects.toMatchObject({ code: 'WORKSPACE_ACCESS_REVOKED' });
  });
});

// ── Token exchange ────────────────────────────────────────────────────────────

describe('token exchange', () => {
  it('refuses to exchange against a non-allow-listed redirect URI', async () => {
    await expect(exchangeAuthorizationCode({
      config: TEST_CONFIG, code: 'abc', redirectUri: 'https://evil.test/callback',
    })).rejects.toMatchObject({ code: 'INVALID_REDIRECT_URI' });
  });

  it('sends the PKCE verifier and never exposes the provider error body', async () => {
    let sentBody = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return {
        ok: false, status: 400,
        text: async () => 'error=invalid_grant&client_secret=test-client-secret',
        json: async () => ({ error: 'invalid_grant', client_secret: 'test-client-secret' }),
      } as unknown as Response;
    }));

    const err = await exchangeAuthorizationCode({
      config: TEST_CONFIG, code: 'the-code', redirectUri: canonicalRedirectUri(), codeVerifier: 'v123',
    }).catch(e => e as OAuthError);

    expect(sentBody).toContain('code_verifier=v123');
    // The provider echoed the client secret; none of it may surface.
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).message).not.toContain('test-client-secret');
    expect((err as OAuthError).message).not.toContain('invalid_grant');
  });

  it('normalizes a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600,
        scope: 'analytics.readonly', token_type: 'Bearer',
      }),
    } as unknown as Response)));

    const tokens = await exchangeAuthorizationCode({
      config: TEST_CONFIG, code: 'c', redirectUri: canonicalRedirectUri(), codeVerifier: 'v',
    });
    expect(tokens).toMatchObject({
      accessToken: 'at-1', refreshToken: 'rt-1', expiresInSeconds: 3600,
      grantedScopes: ['analytics.readonly'],
    });
  });

  it('refreshes an access token', async () => {
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, status: 200, json: async () => ({ access_token: 'at-2', expires_in: 1800 }) } as unknown as Response;
    }));

    const tokens = await refreshAccessToken({ config: TEST_CONFIG, refreshToken: 'rt-1' });
    expect(body).toContain('grant_type=refresh_token');
    expect(tokens.accessToken).toBe('at-2');
  });

  it('surfaces a network failure without claiming anything changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const err = await exchangeAuthorizationCode({
      config: TEST_CONFIG, code: 'c', redirectUri: canonicalRedirectUri(),
    }).catch(e => e as OAuthError);
    expect((err as OAuthError).message).toMatch(/Nothing was changed/);
  });
});

// ── Credential vault ──────────────────────────────────────────────────────────

describe('credential vault', () => {
  async function store(accountId = 'acct-1') {
    return storeCredential({
      workspaceId: WORKSPACE_A, connectionId: CONNECTION_A, provider: 'ga4',
      accessToken: 'secret-access-token', refreshToken: 'secret-refresh-token',
      scopes: ['analytics.readonly'], externalAccountId: accountId,
      externalAccountName: 'Test Property', expiresInSeconds: 3600, createdBy: FOUNDER_A,
    });
  }

  it('stores ciphertext, never plaintext', async () => {
    await store();
    const row = db.rows('connection_credentials')[0];
    expect(row.encrypted_access_token).toBe('enc(secret-access-token)');
    expect(row.encrypted_refresh_token).toBe('enc(secret-refresh-token)');
    expect(JSON.stringify(row)).not.toContain('"secret-access-token"');
  });

  it('returns a summary containing no token material', async () => {
    const summary = await store();
    const serialized = JSON.stringify(summary);
    for (const secret of ['secret-access-token', 'secret-refresh-token', 'enc(', 'arn:aws:kms']) {
      expect(serialized).not.toContain(secret);
    }
    expect(summary).toMatchObject({ provider: 'ga4', externalAccountId: 'acct-1' });
  });

  it('scopes reads by workspace — another tenant sees nothing', async () => {
    await store();
    expect(await getCredentialSummary(WORKSPACE_B, CONNECTION_A)).toBeNull();
    expect(await getCredentialSummary(WORKSPACE_A, CONNECTION_A)).not.toBeNull();
  });

  it('rejects ACCOUNT SUBSTITUTION on re-store', async () => {
    await store('acct-1');
    await expect(store('acct-attacker')).rejects.toBeInstanceOf(AccountSubstitutionError);
    // The original binding survives.
    const live = db.rows('connection_credentials').filter(r => !r.revoked_at);
    expect(live).toHaveLength(1);
    expect(live[0].external_account_id).toBe('acct-1');
  });

  it('rejects ACCOUNT SUBSTITUTION on refresh rotation', async () => {
    await store('acct-1');
    await expect(rotateAccessToken({
      workspaceId: WORKSPACE_A, connectionId: CONNECTION_A,
      accessToken: 'at-new', externalAccountId: 'acct-attacker',
    })).rejects.toBeInstanceOf(AccountSubstitutionError);
  });

  it('rotates the access token and clears the failure counter', async () => {
    await store('acct-1');
    const rotated = await rotateAccessToken({
      workspaceId: WORKSPACE_A, connectionId: CONNECTION_A,
      accessToken: 'at-rotated', expiresInSeconds: 7200, externalAccountId: 'acct-1',
    });
    expect(rotated.isExpired).toBe(false);
    const row = db.rows('connection_credentials').find(r => !r.revoked_at);
    expect(row?.encrypted_access_token).toBe('enc(at-rotated)');
    expect(row?.refresh_failure_count).toBe(0);
  });

  it('retires the previous credential rather than deleting it', async () => {
    await store('acct-1');
    await revokeCredential(WORKSPACE_A, CONNECTION_A, 'test');
    await store('acct-1');
    const all = db.rows('connection_credentials');
    expect(all).toHaveLength(2);
    expect(all.filter(r => r.revoked_at)).toHaveLength(1); // audit trail preserved
  });

  it('refuses to hand out a token after revocation', async () => {
    await store();
    await revokeCredential(WORKSPACE_A, CONNECTION_A, 'Disconnected');
    await expect(getAccessToken(WORKSPACE_A, CONNECTION_A, FOUNDER_A))
      .rejects.toMatchObject({ code: 'NO_CREDENTIAL' });
  });

  it('signals that an expired credential needs refresh, not silent failure', async () => {
    await store();
    db.setRows('connection_credentials', db.rows('connection_credentials').map(r => ({
      ...r, expires_at: new Date(Date.now() - 1000).toISOString(),
    })));
    await expect(getAccessToken(WORKSPACE_A, CONNECTION_A, FOUNDER_A))
      .rejects.toMatchObject({ code: 'CREDENTIAL_REFRESH_REQUIRED' });
  });

  it('requires reauthorization when expired with no refresh token', async () => {
    await storeCredential({
      workspaceId: WORKSPACE_A, connectionId: CONNECTION_A, provider: 'ga4',
      accessToken: 'at', refreshToken: null, credentialType: 'api_key',
      expiresInSeconds: -10, createdBy: FOUNDER_A,
    });
    await expect(getAccessToken(WORKSPACE_A, CONNECTION_A, FOUNDER_A))
      .rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' });
  });

  it('never returns a token across the tenant boundary', async () => {
    await store();
    await expect(getAccessToken(WORKSPACE_B, CONNECTION_A, FOUNDER_B))
      .rejects.toBeInstanceOf(CredentialError);
  });
});

// ── Permission architecture ───────────────────────────────────────────────────

describe('permission architecture', () => {
  it('grants only least privilege at connect time', async () => {
    const granted = await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    expect(granted).toEqual([...DEFAULT_CONNECTION_PERMISSIONS]);
    expect(granted).toEqual(['READ', 'RECOMMEND']);
    for (const level of EXECUTION_PERMISSIONS) {
      expect(granted).not.toContain(level);
    }
  });

  it('a read-only connection NEVER implies CHANGE, PUBLISH, or SPEND', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    for (const level of ['CHANGE', 'PUBLISH', 'SPEND'] as const) {
      await expect(assertAuthority(OWNER_CTX, CONNECTION_A, level))
        .rejects.toBeInstanceOf(AuthorityError);
    }
    await expect(assertAuthority(OWNER_CTX, CONNECTION_A, 'READ')).resolves.toBeUndefined();
  });

  it('audits the initial grant', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    const history = db.rows('connection_permission_history');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'granted', workspace_id: WORKSPACE_A, changed_by: FOUNDER_A,
    });
    expect(history[0].permission_snapshot).toEqual(['READ', 'RECOMMEND']);
  });

  it('rejects escalation by an editor — admin is required', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    await expect(
      approveAuthorityUpgrade(EDITOR_CTX, CONNECTION_A, ['SPEND'], 'Editor tries to self-grant spend'),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);

    // Grant unchanged.
    expect(await getEffectivePermissions(OWNER_CTX, CONNECTION_A)).toEqual(['READ', 'RECOMMEND']);
  });

  it('rejects escalation from another workspace', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    const foreign: WorkspaceContext = { actorId: FOUNDER_B, workspaceId: WORKSPACE_B, role: 'owner', isOwner: true };
    await expect(
      approveAuthorityUpgrade(foreign, CONNECTION_A, ['PUBLISH'], 'Cross tenant escalation attempt'),
    ).rejects.toThrow();
    expect(await getEffectivePermissions(OWNER_CTX, CONNECTION_A)).toEqual(['READ', 'RECOMMEND']);
  });

  it('requires a written reason for an upgrade', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    await expect(approveAuthorityUpgrade(OWNER_CTX, CONNECTION_A, ['CHANGE'], 'no'))
      .rejects.toThrow(/record why/);
  });

  it('requesting an upgrade does NOT grant it', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    const req = await requestAuthorityUpgrade(
      OWNER_CTX, CONNECTION_A, ['SPEND'], 'Owner wants paid campaign execution',
    );
    expect(req.affectsSpend).toBe(true);
    expect(req.approvalStillRequired).toBe(true);
    // The persisted grant is untouched.
    expect(await getEffectivePermissions(OWNER_CTX, CONNECTION_A)).toEqual(['READ', 'RECOMMEND']);
    expect(db.rows('connection_permission_history').some(h => h.action === 'upgrade_requested')).toBe(true);
  });

  it('an approved upgrade is the only way execution authority appears', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    const next = await approveAuthorityUpgrade(
      OWNER_CTX, CONNECTION_A, ['CHANGE'], 'Owner approved campaign edits after review',
    );
    expect(next).toEqual(['READ', 'RECOMMEND', 'CHANGE']);
    await expect(assertAuthority(OWNER_CTX, CONNECTION_A, 'CHANGE')).resolves.toBeUndefined();
    // Approving CHANGE must not drag PUBLISH or SPEND along with it.
    await expect(assertAuthority(OWNER_CTX, CONNECTION_A, 'PUBLISH')).rejects.toBeInstanceOf(AuthorityError);
    await expect(assertAuthority(OWNER_CTX, CONNECTION_A, 'SPEND')).rejects.toBeInstanceOf(AuthorityError);
  });

  it('records the audit trail for an approved upgrade', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    await approveAuthorityUpgrade(OWNER_CTX, CONNECTION_A, ['PUBLISH'], 'Owner approved publishing');
    const row = db.rows('connection_permission_history').find(h => h.action === 'upgrade_approved');
    expect(row).toBeTruthy();
    expect(row?.previous_snapshot).toEqual(['READ', 'RECOMMEND']);
    expect(row?.permission_snapshot).toEqual(['READ', 'RECOMMEND', 'PUBLISH']);
    expect((row?.metadata as Record<string, unknown>).execution_granted).toEqual(['PUBLISH']);
  });

  it('downgrade withdraws authority and is audited', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    await approveAuthorityUpgrade(OWNER_CTX, CONNECTION_A, ['SPEND'], 'Approved for a trial period');
    const after = await downgradeAuthority(OWNER_CTX, CONNECTION_A, ['SPEND'], 'Trial finished');
    expect(after).toEqual(['READ', 'RECOMMEND']);
    await expect(assertAuthority(OWNER_CTX, CONNECTION_A, 'SPEND')).rejects.toBeInstanceOf(AuthorityError);
  });

  it('reauthorization does NOT widen authority', async () => {
    await grantInitialPermissions(OWNER_CTX, CONNECTION_A, 'ga4');
    const after = await recordReauthorization(OWNER_CTX, CONNECTION_A);
    expect(after).toEqual(['READ', 'RECOMMEND']);
    const row = db.rows('connection_permission_history').find(h => h.action === 'reauthorized');
    expect((row?.metadata as Record<string, unknown>).authority_widened).toBe(false);
  });

  it('drops unknown levels rather than passing them through', () => {
    expect(normalizePermissions(['READ', 'ADMIN', 'sudo', 'SPEND', 42, null]))
      .toEqual(['READ', 'SPEND']);
    expect(normalizePermissions('READ')).toEqual([]);
    expect(normalizePermissions(undefined)).toEqual([]);
  });

  it('cannot be widened by a malformed value already in the database', async () => {
    // A row containing junk must not resolve to broad authority.
    db.setRows('workspace_connections', db.rows('workspace_connections').map(r => ({
      ...r, permissions_granted: ['READ', '*', 'ALL', 'SPEND '],
    })));
    const granted = await getEffectivePermissions(OWNER_CTX, CONNECTION_A);
    expect(granted).toEqual(['READ']); // 'SPEND ' has a trailing space and is rejected
    await expect(assertAuthority(OWNER_CTX, CONNECTION_A, 'SPEND')).rejects.toBeInstanceOf(AuthorityError);
  });
});
