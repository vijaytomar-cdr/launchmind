/**
 * @file connectionPermissionService.ts
 * @description Canonical permission architecture for provider connections.
 *
 *   Six separate authorities, never collapsed into one "connected" flag:
 *     READ      observe data from the source
 *     RECOMMEND use that data in LaunchMind's own recommendations
 *     DRAFT     prepare assets/changes for owner review
 *     CHANGE    modify existing objects in the provider
 *     PUBLISH   make something live in the provider
 *     SPEND     commit money
 *
 *   The invariant this file exists to guarantee (spec §15, §23):
 *     A read-only connection can NEVER imply CHANGE, PUBLISH, or SPEND.
 *
 *   Effective authority is read from the persisted grant on the connection — never
 *   inferred from OAuth scopes, provider capabilities, or connection status. A
 *   provider handing back a broad token does not widen what LaunchMind may do.
 *
 *   This file implements the permission MODEL and the upgrade MECHANISM only.
 *   It deliberately contains no execution: approving SPEND records that the owner
 *   granted it; actually spending is a later milestone.
 *
 * @security
 *   - Every grant, upgrade, denial, and revocation appends to
 *     connection_permission_history (append-only, migration 083).
 *   - Upgrades require workspace admin or above and a written reason.
 *   - assertAuthority() is the single choke point for "may LaunchMind do X here".
 * @dependencies supabaseAdmin, workspace_connections, connection_permission_history,
 *   workspaceAuthService
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { newTraceId } from '../lib/traceId';
import {
  requireAuthorityChange,
  requireWorkspaceWrite,
  assertConnectionInWorkspace,
  type WorkspaceContext,
} from './workspaceAuthService';

/** The canonical permission ladder, ordered least → most consequential. */
export const PERMISSION_LEVELS = [
  'READ',
  'RECOMMEND',
  'DRAFT',
  'CHANGE',
  'PUBLISH',
  'SPEND',
] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/**
 * Least privilege for a new intelligence connection (spec §15 default).
 * Observation and internal reasoning only — nothing that touches the provider.
 */
export const DEFAULT_CONNECTION_PERMISSIONS: readonly PermissionLevel[] = ['READ', 'RECOMMEND'];

/**
 * Authorities that mutate something outside LaunchMind. These can only ever be
 * added through an explicit, audited upgrade — never at connect time, and never
 * as a side effect of the scopes a provider returns.
 */
export const EXECUTION_PERMISSIONS: readonly PermissionLevel[] = ['CHANGE', 'PUBLISH', 'SPEND'];

/** @returns True when the level is one LaunchMind models. */
export function isPermissionLevel(value: string): value is PermissionLevel {
  return (PERMISSION_LEVELS as readonly string[]).includes(value);
}

/** @returns True when granting this level requires an explicit authority upgrade. */
export function isExecutionPermission(level: PermissionLevel): boolean {
  return (EXECUTION_PERMISSIONS as readonly string[]).includes(level);
}

/**
 * Normalizes an arbitrary array into a valid, de-duplicated, ladder-ordered set.
 * Unknown entries are dropped rather than passed through, so a malformed value in
 * the database can never widen authority.
 */
export function normalizePermissions(raw: unknown): PermissionLevel[] {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set<PermissionLevel>();
  for (const item of input) {
    if (typeof item === 'string' && isPermissionLevel(item)) seen.add(item);
  }
  return PERMISSION_LEVELS.filter(p => seen.has(p));
}

/** Raised when an operation needs an authority the connection has not been granted. */
export class AuthorityError extends Error {
  readonly statusCode = 403;
  readonly code = 'AUTHORITY_NOT_GRANTED';
  readonly required: PermissionLevel;
  readonly granted: PermissionLevel[];

  constructor(required: PermissionLevel, granted: PermissionLevel[]) {
    super(
      `This connection is not authorized to ${required.toLowerCase()}. ` +
      `Granted: ${granted.length ? granted.join(', ') : 'nothing'}.`,
    );
    this.name = 'AuthorityError';
    this.required = required;
    this.granted = granted;
  }
}

/**
 * Reads the effective permission set for a connection.
 *
 * Sourced from workspace_connections.permissions_granted, the persisted grant.
 * Not from OAuth scopes and not from connection status — a HEALTHY connection with
 * a broad provider token still holds only what was granted here.
 *
 * @security Query is scoped by both connection id and workspace id.
 */
export async function getEffectivePermissions(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<PermissionLevel[]> {
  const { data } = await getSupabaseAdmin()
    .from('workspace_connections')
    .select('permissions_granted')
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();

  return normalizePermissions((data as { permissions_granted?: unknown } | null)?.permissions_granted);
}

/**
 * The single choke point for "may LaunchMind do X with this connection".
 *
 * @throws {AuthorityError} When the authority has not been granted
 * @security Call this before any provider-mutating action. Never branch on
 *   connection status, provider name, or token scope instead.
 */
export async function assertAuthority(
  ctx: WorkspaceContext,
  connectionId: string,
  required: PermissionLevel,
): Promise<void> {
  const granted = await getEffectivePermissions(ctx, connectionId);
  if (!granted.includes(required)) throw new AuthorityError(required, granted);
}

/** Pure helper: does this permission set include the required authority? */
export function hasAuthority(granted: readonly string[], required: PermissionLevel): boolean {
  return normalizePermissions(granted).includes(required);
}

/**
 * Records the initial least-privilege grant when a connection is first authorized.
 *
 * Always writes DEFAULT_CONNECTION_PERMISSIONS. Callers cannot pass a wider set —
 * that is what makes "observation never implies execution" structural rather than
 * a convention.
 *
 * @param ctx           - Verified workspace context (editor or above)
 * @param connectionId  - Connection being granted
 * @param provider      - Provider slug, recorded in the audit metadata
 * @param traceId       - Correlation id
 * @returns The permission set that was granted
 * @security Requires workspace write. Appends to connection_permission_history.
 */
export async function grantInitialPermissions(
  ctx: WorkspaceContext,
  connectionId: string,
  provider: string,
  traceId: string = newTraceId(),
): Promise<PermissionLevel[]> {
  requireWorkspaceWrite(ctx);

  const granted = [...DEFAULT_CONNECTION_PERMISSIONS];
  const previous = await getEffectivePermissions(ctx, connectionId);

  await getSupabaseAdmin()
    .from('workspace_connections')
    .update({ permissions_granted: granted, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'granted',
    snapshot: granted,
    previous,
    reason: 'Least-privilege grant at connection time',
    metadata: { provider, least_privilege: true },
    traceId,
  });

  return granted;
}

/** A pending or resolved request to widen a connection's authority. */
export interface AuthorityUpgradeRequest {
  connectionId: string;
  requested:    PermissionLevel[];
  current:      PermissionLevel[];
  reason:       string;
  /** True when approval will let LaunchMind commit money. */
  affectsSpend: boolean;
  /** Always true — approval never removes the owner's per-action approval gate. */
  approvalStillRequired: boolean;
}

/**
 * Records a request to widen a connection's authority.
 *
 * Requests nothing by itself: it writes an `upgrade_requested` audit row and returns
 * a description of exactly what would change, so the UI can show the owner what they
 * are being asked to grant before anything is granted (spec §15).
 *
 * @throws {Error} When the requested levels are invalid or no reason is given
 * @security Requires workspace admin or above.
 */
export async function requestAuthorityUpgrade(
  ctx: WorkspaceContext,
  connectionId: string,
  requestedLevels: string[],
  reason: string,
  traceId: string = newTraceId(),
): Promise<AuthorityUpgradeRequest> {
  requireAuthorityChange(ctx);
  await assertConnectionInWorkspace(ctx, connectionId);

  const requested = normalizePermissions(requestedLevels);
  if (requested.length === 0) {
    throw new Error('No valid permission levels were requested.');
  }
  if (!reason || reason.trim().length < 8) {
    throw new Error('An upgrade request must state why the new authority is needed.');
  }

  const current = await getEffectivePermissions(ctx, connectionId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'upgrade_requested',
    // Snapshot is unchanged: requesting is not granting.
    snapshot: current,
    previous: current,
    reason,
    metadata: { requested, new_levels: requested.filter(r => !current.includes(r)) },
    traceId,
  });

  return {
    connectionId,
    requested,
    current,
    reason,
    affectsSpend: requested.includes('SPEND'),
    // Widening authority never removes per-action approval (§1.5, §1.6).
    approvalStillRequired: true,
  };
}

/**
 * Approves an authority upgrade and widens the persisted grant.
 *
 * This is the ONLY path by which CHANGE, PUBLISH, or SPEND can ever appear on a
 * connection. Connecting a source, refreshing a token, and re-authorizing all leave
 * the grant untouched.
 *
 * Note: this records that the owner granted the authority. It does not execute
 * anything — campaign execution is a later milestone.
 *
 * @throws {Error} When the connection is not in this workspace or levels are invalid
 * @security Requires workspace admin or above; appends an immutable audit row.
 */
export async function approveAuthorityUpgrade(
  ctx: WorkspaceContext,
  connectionId: string,
  approvedLevels: string[],
  reason: string,
  traceId: string = newTraceId(),
): Promise<PermissionLevel[]> {
  requireAuthorityChange(ctx);
  await assertConnectionInWorkspace(ctx, connectionId);

  const approved = normalizePermissions(approvedLevels);
  if (approved.length === 0) throw new Error('No valid permission levels were approved.');
  if (!reason || reason.trim().length < 8) {
    throw new Error('An upgrade approval must record why the authority was granted.');
  }

  const previous = await getEffectivePermissions(ctx, connectionId);
  const next = normalizePermissions([...previous, ...approved]);

  await getSupabaseAdmin()
    .from('workspace_connections')
    .update({ permissions_granted: next, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'upgrade_approved',
    snapshot: next,
    previous,
    reason,
    metadata: {
      approved,
      newly_granted: next.filter(p => !previous.includes(p)),
      execution_granted: next.filter(p => isExecutionPermission(p)),
    },
    traceId,
  });

  return next;
}

/** Records a refused upgrade. The grant is deliberately left unchanged. */
export async function denyAuthorityUpgrade(
  ctx: WorkspaceContext,
  connectionId: string,
  deniedLevels: string[],
  reason: string,
  traceId: string = newTraceId(),
): Promise<PermissionLevel[]> {
  requireAuthorityChange(ctx);
  await assertConnectionInWorkspace(ctx, connectionId);

  const current = await getEffectivePermissions(ctx, connectionId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'upgrade_denied',
    snapshot: current,
    previous: current,
    reason,
    metadata: { denied: normalizePermissions(deniedLevels) },
    traceId,
  });

  return current;
}

/**
 * Narrows a connection's authority back down. Used when an owner withdraws
 * execution authority without disconnecting the source entirely.
 * @security Requires admin or above.
 */
export async function downgradeAuthority(
  ctx: WorkspaceContext,
  connectionId: string,
  removeLevels: string[],
  reason: string,
  traceId: string = newTraceId(),
): Promise<PermissionLevel[]> {
  requireAuthorityChange(ctx);
  await assertConnectionInWorkspace(ctx, connectionId);

  const remove = new Set(normalizePermissions(removeLevels));
  const previous = await getEffectivePermissions(ctx, connectionId);
  const next = previous.filter(p => !remove.has(p));

  await getSupabaseAdmin()
    .from('workspace_connections')
    .update({ permissions_granted: next, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'downgraded',
    snapshot: next,
    previous,
    reason: reason || 'Authority withdrawn by workspace admin',
    metadata: { removed: [...remove] },
    traceId,
  });

  return next;
}

/**
 * Removes all authority — used on disconnect. The history row is retained so the
 * fact that the connection once held a given authority stays auditable.
 */
export async function revokeAllPermissions(
  ctx: WorkspaceContext,
  connectionId: string,
  reason: string,
  traceId: string = newTraceId(),
): Promise<void> {
  const previous = await getEffectivePermissions(ctx, connectionId);

  await getSupabaseAdmin()
    .from('workspace_connections')
    .update({ permissions_granted: [], updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'revoked',
    snapshot: [],
    previous,
    reason,
    metadata: {},
    traceId,
  });
}

/**
 * Re-asserts the existing grant after a credential is replaced.
 *
 * Reauthorization explicitly does NOT widen authority: a fresh token with broader
 * provider scopes still yields the same LaunchMind permissions.
 */
export async function recordReauthorization(
  ctx: WorkspaceContext,
  connectionId: string,
  traceId: string = newTraceId(),
): Promise<PermissionLevel[]> {
  const current = await getEffectivePermissions(ctx, connectionId);

  await appendPermissionHistory({
    ctx,
    connectionId,
    action: 'reauthorized',
    snapshot: current,
    previous: current,
    reason: 'Credential replaced; authority unchanged',
    metadata: { authority_widened: false },
    traceId,
  });

  return current;
}

/** Reads the audit trail for a connection, newest first. */
export async function getPermissionHistory(
  ctx: WorkspaceContext,
  connectionId: string,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await getSupabaseAdmin()
    .from('connection_permission_history')
    .select('*')
    .eq('connection_id', connectionId)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Appends one immutable audit row. Never throws into the caller's path — losing an
 * audit write must not roll back a permission change the owner already made, but it
 * must be reported loudly.
 */
async function appendPermissionHistory(args: {
  ctx: WorkspaceContext;
  connectionId: string;
  action: string;
  snapshot: PermissionLevel[];
  previous: PermissionLevel[];
  reason: string;
  metadata: Record<string, unknown>;
  traceId: string;
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('connection_permission_history')
    .insert({
      connection_id:       args.connectionId,
      workspace_id:        args.ctx.workspaceId,
      permission_snapshot: args.snapshot,
      previous_snapshot:   args.previous,
      action:              args.action,
      changed_by:          args.ctx.actorId,
      actor_type:          'founder',
      reason:              args.reason,
      metadata:            args.metadata,
      trace_id:            args.traceId,
    });

  if (error) {
    console.error(
      `[connectionPermissionService] AUDIT WRITE FAILED action=${args.action} ` +
      `connection=${args.connectionId} trace=${args.traceId}: ${error.message}`,
    );
  }
}
