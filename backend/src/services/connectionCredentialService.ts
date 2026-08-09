/**
 * @file connectionCredentialService.ts
 * @description Workspace-scoped credential vault for provider connections.
 *
 *   Every read, write, refresh, and revoke of a provider credential goes through
 *   here. Nothing else in the codebase should touch connection_credentials.
 *
 * @security
 *   - Plaintext exists only as a local inside a single function call. It is never
 *     returned to a route, logged, cached, or written to analytics.
 *   - Ciphertext is produced by lib/tokenVault (AES-256 via AWS KMS).
 *   - Every query is filtered by workspace_id AND connection_id, so a credential
 *     can never be read across the tenant boundary even with a valid connection id.
 *   - decryptToken() writes an audit_logs row before returning plaintext.
 *   - External account binding is enforced on rotation: a provider returning a
 *     different account id is rejected as account substitution, not silently
 *     rebound to whatever the provider last said.
 *   - Revoked credentials are retained (revoked_at set) for audit; never deleted.
 * @dependencies tokenVault, supabaseAdmin, connection_credentials
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { encryptToken, decryptToken } from '../lib/tokenVault';

/** Credential metadata safe to expose to a route. Contains no secret material. */
export interface CredentialSummary {
  id:                  string;
  provider:            string;
  credentialType:      'oauth2' | 'api_key';
  scopes:              string[];
  externalAccountId:   string | null;
  externalAccountName: string | null;
  expiresAt:           string | null;
  lastRefreshedAt:     string | null;
  revokedAt:           string | null;
  /** True when expires_at is in the past. */
  isExpired:           boolean;
}

/** Raised when a credential is missing, revoked, or unusable. */
export class CredentialError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Raised when a provider returns a different account than the one bound. */
export class AccountSubstitutionError extends Error {
  readonly statusCode = 409;
  readonly code = 'WRONG_ACCOUNT';
  readonly expected: string;
  readonly received: string;

  constructor(expected: string, received: string) {
    super(
      'This authorization is for a different provider account than the one already ' +
      'connected. Reconnect with the original account, or disconnect first.',
    );
    this.name = 'AccountSubstitutionError';
    this.expected = expected;
    this.received = received;
  }
}

/**
 * Stores a freshly obtained credential, revoking any previous live one for the
 * same connection.
 *
 * When a live credential already exists and is bound to an external account, the
 * incoming account must match — otherwise this is an account substitution and the
 * write is refused (spec §8, §23).
 *
 * @param args.workspaceId       - Tenant this credential belongs to
 * @param args.connectionId      - Connection it authorizes
 * @param args.accessToken       - Plaintext access token or API key (encrypted here)
 * @param args.refreshToken      - Plaintext refresh token, when the provider issued one
 * @param args.expiresInSeconds  - Lifetime reported by the provider
 * @returns Non-secret summary of the stored credential
 * @throws {AccountSubstitutionError} When rebinding to a different provider account
 * @security Nothing in the return value can be used to call the provider.
 */
export async function storeCredential(args: {
  workspaceId:         string;
  connectionId:        string;
  provider:            string;
  accessToken:         string;
  refreshToken?:       string | null;
  credentialType?:     'oauth2' | 'api_key';
  scopes?:             string[];
  externalAccountId?:  string | null;
  externalAccountName?: string | null;
  /** Correlates a credential-vault failure with the request that caused it. */
  traceId?: string | null;
  expiresInSeconds?:   number | null;
  createdBy:           string;
}): Promise<CredentialSummary> {
  const db = getSupabaseAdmin();

  // Account-substitution guard against the existing live credential.
  const existing = await getLiveCredentialRow(args.workspaceId, args.connectionId);
  if (
    existing?.external_account_id &&
    args.externalAccountId &&
    existing.external_account_id !== args.externalAccountId
  ) {
    throw new AccountSubstitutionError(String(existing.external_account_id), args.externalAccountId);
  }

  const access = await encryptToken(args.accessToken, args.traceId ?? null);
  const refresh = args.refreshToken ? await encryptToken(args.refreshToken, args.traceId ?? null) : null;

  // Retire the previous credential first — the partial unique index allows only one
  // live row per connection.
  if (existing) {
    await db
      .from('connection_credentials')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'Replaced by a new authorization' })
      .eq('id', existing.id)
      .eq('workspace_id', args.workspaceId);
  }

  const expiresAt = args.expiresInSeconds
    ? new Date(Date.now() + args.expiresInSeconds * 1000).toISOString()
    : null;

  const { data, error } = await db
    .from('connection_credentials')
    .insert({
      workspace_id:            args.workspaceId,
      connection_id:           args.connectionId,
      provider:                args.provider,
      encrypted_access_token:  access.ciphertext,
      encrypted_refresh_token: refresh?.ciphertext ?? null,
      kms_key_id:              access.kmsKeyId,
      credential_type:         args.credentialType ?? 'oauth2',
      scopes:                  args.scopes ?? [],
      external_account_id:     args.externalAccountId ?? null,
      external_account_name:   args.externalAccountName ?? null,
      expires_at:              expiresAt,
      created_by:              args.createdBy,
    })
    .select('*')
    .single();

  if (error || !data) throw new CredentialError('STORE_FAILED', 'Could not securely store the credential.', 500);
  return toSummary(data as Record<string, unknown>);
}

/**
 * Returns non-secret metadata about a connection's live credential.
 * Safe to include in an API response.
 * @returns Summary, or null when there is no live credential
 */
export async function getCredentialSummary(
  workspaceId: string,
  connectionId: string,
): Promise<CredentialSummary | null> {
  const row = await getLiveCredentialRow(workspaceId, connectionId);
  return row ? toSummary(row) : null;
}

/**
 * Decrypts and returns the access token for a provider call.
 *
 * ONLY adapters, via connectionService, may call this. The returned string must be
 * passed straight to the provider HTTP client and never stored, logged, or returned.
 *
 * @throws {CredentialError} NO_CREDENTIAL when absent or revoked
 * @throws {CredentialError} CREDENTIAL_EXPIRED when past expiry with no refresh token
 * @security decryptToken writes an audit_logs entry before returning plaintext.
 */
export async function getAccessToken(
  workspaceId: string,
  connectionId: string,
  founderIdForAudit: string,
): Promise<string> {
  const row = await getLiveCredentialRow(workspaceId, connectionId);
  if (!row) {
    throw new CredentialError('NO_CREDENTIAL', 'This source needs to be reconnected before it can be used.');
  }

  if (isExpired(row.expires_at as string | null)) {
    if (!row.encrypted_refresh_token) {
      throw new CredentialError(
        'CREDENTIAL_EXPIRED',
        'This source needs to be reconnected — its authorization has expired.',
      );
    }
    // Caller should refresh first; surfaced as a distinct code so the route can map
    // it to NEEDS_REAUTH rather than a generic failure.
    throw new CredentialError('CREDENTIAL_REFRESH_REQUIRED', 'This source needs its authorization refreshed.');
  }

  return decryptToken(
    row.encrypted_access_token as string,
    row.kms_key_id as string,
    founderIdForAudit,
  );
}

/** @returns The decrypted refresh token, or null when the provider issued none. */
export async function getRefreshToken(
  workspaceId: string,
  connectionId: string,
  founderIdForAudit: string,
): Promise<string | null> {
  const row = await getLiveCredentialRow(workspaceId, connectionId);
  if (!row?.encrypted_refresh_token) return null;
  return decryptToken(
    row.encrypted_refresh_token as string,
    row.kms_key_id as string,
    founderIdForAudit,
  );
}

/**
 * Rotates the stored access token after a successful refresh exchange.
 *
 * Refreshing replaces credential material only. It never changes the connection's
 * granted permissions and never rebinds the external account.
 *
 * @throws {AccountSubstitutionError} When the refresh returns a different account
 */
export async function rotateAccessToken(args: {
  workspaceId:       string;
  connectionId:      string;
  accessToken:       string;
  refreshToken?:     string | null;
  expiresInSeconds?: number | null;
  externalAccountId?: string | null;
  /** Correlates a credential-vault failure with the request that caused it. */
  traceId?: string | null;
}): Promise<CredentialSummary> {
  const db = getSupabaseAdmin();
  const row = await getLiveCredentialRow(args.workspaceId, args.connectionId);
  if (!row) throw new CredentialError('NO_CREDENTIAL', 'There is no credential to refresh.');

  if (
    row.external_account_id &&
    args.externalAccountId &&
    row.external_account_id !== args.externalAccountId
  ) {
    throw new AccountSubstitutionError(row.external_account_id as string, args.externalAccountId);
  }

  const access = await encryptToken(args.accessToken, args.traceId ?? null);
  const refresh = args.refreshToken ? await encryptToken(args.refreshToken, args.traceId ?? null) : null;

  const patch: Record<string, unknown> = {
    encrypted_access_token: access.ciphertext,
    kms_key_id:             access.kmsKeyId,
    last_refreshed_at:      new Date().toISOString(),
    refresh_failure_count:  0,
    updated_at:             new Date().toISOString(),
    expires_at: args.expiresInSeconds
      ? new Date(Date.now() + args.expiresInSeconds * 1000).toISOString()
      : (row.expires_at ?? null),
  };
  // Providers that rotate refresh tokens send a new one; those that don't keep the old.
  if (refresh) patch.encrypted_refresh_token = refresh.ciphertext;

  const { data, error } = await db
    .from('connection_credentials')
    .update(patch)
    .eq('id', row.id as string)
    .eq('workspace_id', args.workspaceId)
    .select('*')
    .single();

  if (error || !data) throw new CredentialError('ROTATE_FAILED', 'Could not update the stored credential.', 500);
  return toSummary(data as Record<string, unknown>);
}

/** Records a failed refresh so repeated failures can escalate to NEEDS_REAUTH. */
export async function recordRefreshFailure(
  workspaceId: string,
  connectionId: string,
): Promise<number> {
  const row = await getLiveCredentialRow(workspaceId, connectionId);
  if (!row) return 0;

  const next = ((row.refresh_failure_count as number) ?? 0) + 1;
  await getSupabaseAdmin()
    .from('connection_credentials')
    .update({ refresh_failure_count: next, updated_at: new Date().toISOString() })
    .eq('id', row.id as string)
    .eq('workspace_id', workspaceId);

  return next;
}

/**
 * Revokes the live credential for a connection.
 * The row is retained with revoked_at set — never deleted, so the fact that access
 * was once granted stays auditable.
 * @returns True when a credential was revoked
 */
export async function revokeCredential(
  workspaceId: string,
  connectionId: string,
  reason: string,
): Promise<boolean> {
  const row = await getLiveCredentialRow(workspaceId, connectionId);
  if (!row) return false;

  await getSupabaseAdmin()
    .from('connection_credentials')
    .update({
      revoked_at:     new Date().toISOString(),
      revoked_reason: reason,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', row.id as string)
    .eq('workspace_id', workspaceId);

  return true;
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Fetches the single live (non-revoked) credential row for a connection.
 * @security workspace_id is part of the predicate — a connection id from another
 *   tenant cannot reach this row.
 */
async function getLiveCredentialRow(
  workspaceId: string,
  connectionId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await getSupabaseAdmin()
    .from('connection_credentials')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('connection_id', connectionId)
    .is('revoked_at', null)
    .maybeSingle();

  return (data as Record<string, unknown> | null) ?? null;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

/** Projects a DB row to the non-secret summary. Token columns are never included. */
function toSummary(row: Record<string, unknown>): CredentialSummary {
  return {
    id:                  row.id as string,
    provider:            row.provider as string,
    credentialType:      (row.credential_type as 'oauth2' | 'api_key') ?? 'oauth2',
    scopes:              (row.scopes as string[]) ?? [],
    externalAccountId:   (row.external_account_id as string | null) ?? null,
    externalAccountName: (row.external_account_name as string | null) ?? null,
    expiresAt:           (row.expires_at as string | null) ?? null,
    lastRefreshedAt:     (row.last_refreshed_at as string | null) ?? null,
    revokedAt:           (row.revoked_at as string | null) ?? null,
    isExpired:           isExpired((row.expires_at as string | null) ?? null),
  };
}
