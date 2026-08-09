/**
 * @file oauthService.ts
 * @description Canonical OAuth 2.0 infrastructure shared by every provider adapter.
 *
 *   Replaces the previous stateless HMAC `state` parameter. A stateless state cannot
 *   be made single-use, cannot be revoked, and cannot carry a PKCE verifier — so it
 *   cannot defend against replay or code interception.
 *
 *   Flow:
 *     createAuthorizationRequest()  → persists state/nonce/PKCE, returns the provider URL
 *     …owner authorizes at the provider…
 *     consumeAuthorizationRequest() → validates and single-uses the state
 *     exchangeAuthorizationCode()   → swaps code (+verifier) for tokens
 *
 * @security
 *   - `state`: 256-bit CSPRNG, UNIQUE, single-use (consumed_at), 10-minute TTL,
 *     compared in constant time.
 *   - `nonce`: issued for OIDC providers as an ID-token replay guard.
 *   - PKCE: S256 by default; the verifier is encrypted at rest and never leaves
 *     the backend.
 *   - Redirect URIs are validated against an exact allow-list derived from
 *     API_BASE_URL. No wildcards, no prefix matching, no open redirect.
 *   - The callback re-verifies workspace membership: a state issued before the actor
 *     lost access must not complete.
 *   - Provider client secrets and all tokens stay server-side. Nothing here returns
 *     secret material to a caller.
 *   - Rejected attempts are persisted with a reason so replay is auditable.
 * @dependencies node:crypto, supabaseAdmin, tokenVault, workspaceAuthService,
 *   oauth_authorization_requests
 */

import crypto from 'crypto';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { encryptToken, decryptToken } from '../lib/tokenVault';
import { newTraceId } from '../lib/traceId';
import { getWorkspaceRole } from './workspaceAuthService';

/** How long an authorization request stays valid. Short by design. */
export const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;

export type OAuthIntent = 'connect' | 'reauthorize' | 'authority_upgrade';

/** Per-provider OAuth endpoints and capabilities. */
export interface OAuthProviderConfig {
  provider:        string;
  authorizationUrl: string;
  tokenUrl:        string;
  clientId:        string;
  clientSecret:    string;
  /** Least-privilege scopes. Read-only for observation sources. */
  scopes:          string[];
  usesPkce:        boolean;
  /** OIDC providers get a nonce. */
  usesNonce:       boolean;
  /** Extra static params, e.g. { access_type: 'offline', prompt: 'consent' }. */
  extraAuthParams?: Record<string, string>;
}

/** Raised for any OAuth protocol or validation failure. */
export class OAuthError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ── Redirect URI allow-list ───────────────────────────────────────────────────

/**
 * Builds the exact set of redirect URIs this server will accept.
 * Exact string match only — prefix matching is how open redirects happen.
 */
export function allowedRedirectUris(): string[] {
  const base = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  return [`${base}/connections/oauth/callback`];
}

/** The single redirect URI used for provider callbacks. */
export function canonicalRedirectUri(): string {
  return allowedRedirectUris()[0];
}

/**
 * @param uri - Candidate redirect URI
 * @returns True only on an exact match against the allow-list
 * @security Rejects near-misses such as trailing slashes, added query strings,
 *   userinfo prefixes, and lookalike hosts.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0) return false;
  return allowedRedirectUris().includes(uri);
}

// ── PKCE ──────────────────────────────────────────────────────────────────────

/**
 * Generates an RFC 7636 PKCE pair.
 * @returns { verifier, challenge, method } with an S256 challenge
 */
export function generatePkcePair(): { verifier: string; challenge: string; method: 'S256' } {
  const verifier = crypto.randomBytes(48).toString('base64url'); // 64 chars, within 43–128
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

// ── Authorization request lifecycle ───────────────────────────────────────────

export interface CreatedAuthorizationRequest {
  authorizationUrl: string;
  state:            string;
  requestId:        string;
  expiresAt:        string;
}

/**
 * Creates and persists an authorization request, returning the provider URL to
 * send the owner to.
 *
 * @param args.workspaceId - Tenant the resulting connection will belong to (already verified)
 * @param args.actorId     - Founder initiating the flow
 * @returns The provider authorization URL plus the opaque state
 * @throws {OAuthError} INVALID_REDIRECT_URI when the redirect is not allow-listed
 * @security The state is stored server-side; the browser only ever sees an opaque
 *   random value that carries no founder or workspace identifier.
 */
export async function createAuthorizationRequest(args: {
  config:       OAuthProviderConfig;
  workspaceId:  string;
  actorId:      string;
  intent?:      OAuthIntent;
  connectionId?: string | null;
  traceId?:     string;
}): Promise<CreatedAuthorizationRequest> {
  const redirectUri = canonicalRedirectUri();
  if (!isAllowedRedirectUri(redirectUri)) {
    throw new OAuthError('INVALID_REDIRECT_URI', 'Redirect URI is not allow-listed.', 500);
  }

  const state   = crypto.randomBytes(32).toString('base64url'); // 256 bits
  const nonce   = args.config.usesNonce ? crypto.randomBytes(16).toString('base64url') : null;
  const traceId = args.traceId ?? newTraceId();

  let encryptedVerifier: string | null = null;
  let codeChallenge: string | null = null;
  let challengeMethod: 'S256' | null = null;
  let kmsKeyId: string | null = null;

  if (args.config.usesPkce) {
    const pkce = generatePkcePair();
    // Encryption happens BEFORE the row is written, so a vault outage leaves no
    // half-created authorization request behind and a retry starts clean.
    // CredentialVaultUnavailableError propagates unwrapped: the route maps it to a
    // 503 recovery state, and turning it into a generic OAuthError here would tell
    // the owner to re-authorize a provider that was never the problem.
    const enc = await encryptToken(pkce.verifier, traceId);
    encryptedVerifier = enc.ciphertext;
    kmsKeyId          = enc.kmsKeyId;
    codeChallenge     = pkce.challenge;
    challengeMethod   = pkce.method;
  }

  const expiresAt = new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS).toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from('oauth_authorization_requests')
    .insert({
      state,
      nonce,
      encrypted_code_verifier: encryptedVerifier,
      code_challenge:          codeChallenge,
      code_challenge_method:   challengeMethod,
      kms_key_id:              kmsKeyId,
      provider:                args.config.provider,
      workspace_id:            args.workspaceId,
      actor_id:                args.actorId,
      redirect_uri:            redirectUri,
      scopes:                  args.config.scopes,
      connection_id:           args.connectionId ?? null,
      intent:                  args.intent ?? 'connect',
      trace_id:                traceId,
      expires_at:              expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new OAuthError('REQUEST_PERSIST_FAILED', 'Could not start the authorization flow.', 500);
  }

  const params = new URLSearchParams({
    client_id:     args.config.clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         args.config.scopes.join(' '),
    state,
    ...(nonce ? { nonce } : {}),
    ...(codeChallenge
      ? { code_challenge: codeChallenge, code_challenge_method: challengeMethod as string }
      : {}),
    ...(args.config.extraAuthParams ?? {}),
  });

  return {
    authorizationUrl: `${args.config.authorizationUrl}?${params.toString()}`,
    state,
    requestId:        (data as { id: string }).id,
    expiresAt,
  };
}

/** A validated, single-used authorization request. */
export interface ConsumedAuthorizationRequest {
  id:            string;
  provider:      string;
  workspaceId:   string;
  actorId:       string;
  redirectUri:   string;
  scopes:        string[];
  intent:        OAuthIntent;
  connectionId:  string | null;
  nonce:         string | null;
  /** Decrypted PKCE verifier, when the provider uses PKCE. */
  codeVerifier:  string | null;
  traceId:       string;
}

/**
 * Validates and single-uses an authorization state returned by a provider.
 *
 * Checks, in order:
 *   1. state is well-formed and known
 *   2. not already consumed (replay guard)
 *   3. not expired
 *   4. the actor is STILL a member of the workspace it was issued for
 *
 * Every rejection is recorded with a reason so replay attempts are auditable.
 *
 * @throws {OAuthError} INVALID_STATE | STATE_REPLAYED | STATE_EXPIRED | WORKSPACE_ACCESS_REVOKED
 * @security Marks consumed before returning, so two concurrent callbacks with the
 *   same state cannot both succeed.
 */
export async function consumeAuthorizationRequest(
  state: string,
): Promise<ConsumedAuthorizationRequest> {
  const db = getSupabaseAdmin();

  // Length/charset gate before touching the DB.
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    throw new OAuthError('INVALID_STATE', 'Authorization could not be verified.');
  }

  const { data } = await db
    .from('oauth_authorization_requests')
    .select('*')
    .eq('state', state)
    .maybeSingle();

  const row = data as Record<string, unknown> | null;
  if (!row) throw new OAuthError('INVALID_STATE', 'Authorization could not be verified.');

  // Constant-time comparison of the echoed value against the stored one.
  const stored = String(row.state);
  const a = Buffer.from(stored);
  const b = Buffer.from(state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await rejectRequest(row.id as string, 'state_mismatch');
    throw new OAuthError('INVALID_STATE', 'Authorization could not be verified.');
  }

  if (row.consumed_at) {
    await rejectRequest(row.id as string, 'replay_attempt');
    throw new OAuthError('STATE_REPLAYED', 'This authorization link has already been used.');
  }

  if (new Date(row.expires_at as string).getTime() <= Date.now()) {
    await rejectRequest(row.id as string, 'expired');
    throw new OAuthError('STATE_EXPIRED', 'This authorization link has expired. Please start again.');
  }

  // Membership can change between issuing and callback.
  const role = await getWorkspaceRole(row.actor_id as string, row.workspace_id as string);
  if (!role) {
    await rejectRequest(row.id as string, 'workspace_access_revoked');
    throw new OAuthError(
      'WORKSPACE_ACCESS_REVOKED',
      'You no longer have access to that workspace.',
      403,
    );
  }

  // Single-use: claim it before returning. The consumed_at predicate makes this a
  // compare-and-set, so a concurrent callback loses.
  const { data: claimed } = await db
    .from('oauth_authorization_requests')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id as string)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();

  if (!claimed) {
    throw new OAuthError('STATE_REPLAYED', 'This authorization link has already been used.');
  }

  let codeVerifier: string | null = null;
  if (row.encrypted_code_verifier && row.kms_key_id) {
    codeVerifier = await decryptToken(
      row.encrypted_code_verifier as string,
      row.kms_key_id as string,
      row.actor_id as string,
    );
  }

  return {
    id:           row.id as string,
    provider:     row.provider as string,
    workspaceId:  row.workspace_id as string,
    actorId:      row.actor_id as string,
    redirectUri:  row.redirect_uri as string,
    scopes:       (row.scopes as string[]) ?? [],
    intent:       (row.intent as OAuthIntent) ?? 'connect',
    connectionId: (row.connection_id as string | null) ?? null,
    nonce:        (row.nonce as string | null) ?? null,
    codeVerifier,
    traceId:      (row.trace_id as string) ?? newTraceId(),
  };
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface TokenResponse {
  accessToken:      string;
  refreshToken:     string | null;
  expiresInSeconds: number | null;
  /** Scopes the provider actually granted, which may be narrower than requested. */
  grantedScopes:    string[];
  tokenType:        string;
}

/**
 * Exchanges an authorization code for tokens.
 *
 * @throws {OAuthError} INVALID_REDIRECT_URI | TOKEN_EXCHANGE_FAILED
 * @security
 *   - The redirect URI is re-validated against the allow-list before the call.
 *   - The client secret is read from env at call time and never logged.
 *   - Provider error bodies are NOT surfaced to the caller: they routinely echo
 *     request parameters and would leak the code or secret into logs and responses.
 */
export async function exchangeAuthorizationCode(args: {
  config:       OAuthProviderConfig;
  code:         string;
  redirectUri:  string;
  codeVerifier?: string | null;
}): Promise<TokenResponse> {
  if (!isAllowedRedirectUri(args.redirectUri)) {
    throw new OAuthError('INVALID_REDIRECT_URI', 'Authorization could not be completed.');
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code:          args.code,
    redirect_uri:  args.redirectUri,
    client_id:     args.config.clientId,
    client_secret: args.config.clientSecret,
    ...(args.codeVerifier ? { code_verifier: args.codeVerifier } : {}),
  });

  return postTokenRequest(args.config, body, 'TOKEN_EXCHANGE_FAILED');
}

/**
 * Exchanges a refresh token for a new access token.
 * @throws {OAuthError} TOKEN_REFRESH_FAILED — caller should escalate to NEEDS_REAUTH
 *   after repeated failures.
 */
export async function refreshAccessToken(args: {
  config:       OAuthProviderConfig;
  refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: args.refreshToken,
    client_id:     args.config.clientId,
    client_secret: args.config.clientSecret,
  });

  return postTokenRequest(args.config, body, 'TOKEN_REFRESH_FAILED');
}

/**
 * Best-effort revocation at the provider.
 * Local revocation is authoritative and happens regardless of the outcome here —
 * a provider that does not support revocation must not block disconnect.
 * @returns True when the provider acknowledged the revocation
 */
export async function revokeAtProvider(args: {
  revocationUrl: string;
  token:         string;
  clientId:      string;
  clientSecret:  string;
}): Promise<boolean> {
  try {
    const res = await fetch(args.revocationUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token:         args.token,
        client_id:     args.clientId,
        client_secret: args.clientSecret,
      }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Deletes expired, never-consumed requests. Safe to run on a schedule. */
export async function pruneExpiredAuthorizationRequests(): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from('oauth_authorization_requests')
    .delete()
    .is('consumed_at', null)
    .lt('expires_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .select('id');

  return (data ?? []).length;
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Performs a token endpoint POST and normalizes the response.
 * @security The provider's error body is deliberately discarded — it commonly
 *   contains the submitted code, redirect URI, and sometimes the client secret.
 */
async function postTokenRequest(
  config: OAuthProviderConfig,
  body: URLSearchParams,
  failureCode: string,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(config.tokenUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:         'application/json',
      },
      body: body.toString(),
    });
  } catch {
    throw new OAuthError(failureCode, 'Could not reach the provider. Nothing was changed.', 503);
  }

  if (!res.ok) {
    // Status only. Never the body.
    throw new OAuthError(
      failureCode,
      'The provider rejected this authorization. Nothing was changed in your account.',
      res.status === 400 || res.status === 401 ? 401 : 502,
    );
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError(failureCode, 'The provider returned an unreadable response.', 502);
  }

  const accessToken = json.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new OAuthError(failureCode, 'The provider did not return an access token.', 502);
  }

  const scopeRaw = typeof json.scope === 'string' ? json.scope : '';

  return {
    accessToken,
    refreshToken:     typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : null,
    grantedScopes:    scopeRaw ? scopeRaw.split(/[\s,]+/).filter(Boolean) : [],
    tokenType:        typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}

/** Records why a state consumption attempt was refused. Never throws. */
async function rejectRequest(id: string, reason: string): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from('oauth_authorization_requests')
      .update({ rejected_reason: reason })
      .eq('id', id);
  } catch {
    // Auditing a rejection must not mask the rejection itself.
  }
}
