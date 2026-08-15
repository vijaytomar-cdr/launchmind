/**
 * @file workspaceAuthService.ts
 * @description Authorization boundary for every workspace-scoped operation.
 *
 *   THE RULE THIS FILE ENFORCES:
 *     A workspace id supplied by the client is CONTEXT, never AUTHORIZATION.
 *
 *   Nothing may act on a workspace because the frontend said so. Every request
 *   resolves four things, in order, server-side:
 *     1. actor      — the founder id from the verified JWT `sub`, nothing else
 *     2. membership — an owned workspace or an ACCEPTED workspace_members row
 *     3. role       — owner | admin | editor | viewer, checked against the operation
 *     4. resource   — the target row must belong to that same workspace
 *
 *   A non-member gets WorkspaceAccessError (404-shaped: "not found"), never a
 *   silent fall-back to their own workspace and never a 200.
 *
 * @security
 *   - Uses the service role for lookups, but the service role is the transport,
 *     never the authorization: every query carries an explicit predicate and the
 *     result is checked before anything is returned. RLS (migration 080) is an
 *     independent second line, not the only line.
 *   - Pending invitations (accepted_at IS NULL) grant nothing.
 * @dependencies supabaseAdmin, workspaces, workspace_members, founders
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** Role ranking. A check passes when the actor's rank >= the required rank. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  admin:  3,
  owner:  4,
};

/** Resolved, server-verified authorization context for one request. */
export interface WorkspaceContext {
  actorId:     string;
  workspaceId: string;
  role:        WorkspaceRole;
  /** True when the actor owns the workspace row itself. */
  isOwner:     boolean;
}

/**
 * Raised when the actor is not a member of the requested workspace, or the
 * workspace does not exist. Both cases are deliberately indistinguishable to the
 * caller: revealing "this workspace exists but is not yours" leaks tenant structure.
 */
export class WorkspaceAccessError extends Error {
  readonly statusCode = 404;
  readonly code = 'WORKSPACE_NOT_FOUND';

  constructor(message = 'Workspace not found') {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

/** Raised when the actor is a member but their role is too low for the operation. */
export class WorkspacePermissionError extends Error {
  readonly statusCode = 403;
  readonly code = 'INSUFFICIENT_WORKSPACE_ROLE';
  readonly requiredRole: WorkspaceRole;
  readonly actualRole: WorkspaceRole;

  constructor(requiredRole: WorkspaceRole, actualRole: WorkspaceRole) {
    super(`This action requires the ${requiredRole} role; you have ${actualRole}.`);
    this.name = 'WorkspacePermissionError';
    this.requiredRole = requiredRole;
    this.actualRole = actualRole;
  }
}

/**
 * Returns the actor's effective role in a workspace, or null when not a member.
 * The workspace's founder is always 'owner', with or without a member row.
 *
 * @param actorId     - Founder id from the verified JWT
 * @param workspaceId - Workspace being accessed
 * @returns The role, or null when the actor has no accepted access
 * @security Both lookups are filtered by actorId; membership is never inferred.
 */
export async function getWorkspaceRole(
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  if (!actorId || !workspaceId) return null;
  const db = getSupabaseAdmin();

  const { data: owned } = await db
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('founder_id', actorId)
    .maybeSingle();

  if (owned) return 'owner';

  const { data: member } = await db
    .from('workspace_members')
    .select('role, accepted_at')
    .eq('workspace_id', workspaceId)
    .eq('founder_id', actorId)
    .not('accepted_at', 'is', null)   // pending invitations grant nothing
    .maybeSingle();

  const row = member as { role: string; accepted_at: string | null } | null;
  if (!row?.role || !row.accepted_at) return null;
  return (row.role as WorkspaceRole) ?? null;
}

/**
 * Resolves and verifies the workspace context for a request.
 *
 * When `requestedWorkspaceId` is provided it is treated as context only: the actor
 * must independently be a member or the call fails. When omitted, the actor's own
 * active workspace is used — but never as a fall-back after a failed check.
 *
 * @param actorId             - Founder id from the verified JWT
 * @param requestedWorkspaceId - Workspace id supplied by the client, if any
 * @returns Verified WorkspaceContext
 * @throws {WorkspaceAccessError} When the workspace is unknown or the actor is not a member
 * @security This is the only sanctioned way to obtain a workspaceId for a mutation.
 */
export async function resolveWorkspaceContext(
  actorId: string,
  requestedWorkspaceId?: string | null,
): Promise<WorkspaceContext> {
  if (!actorId) throw new WorkspaceAccessError();

  if (requestedWorkspaceId) {
    const role = await getWorkspaceRole(actorId, requestedWorkspaceId);
    // No fall-back. A failed membership check ends the request.
    if (!role) throw new WorkspaceAccessError();
    return {
      actorId,
      workspaceId: requestedWorkspaceId,
      role,
      isOwner: role === 'owner',
    };
  }

  const resolved = await getDefaultWorkspaceId(actorId);
  if (!resolved) throw new WorkspaceAccessError('No workspace available for this account');

  const role = await getWorkspaceRole(actorId, resolved);
  if (!role) throw new WorkspaceAccessError();

  return { actorId, workspaceId: resolved, role, isOwner: role === 'owner' };
}

/**
 * The actor's own default workspace, resolved in order:
 *   1. their persisted active workspace, if they may still use it
 *   2. the oldest workspace they own
 *   3. the oldest workspace they are an accepted member of
 *
 * Step 3 matters for invited teammates: someone who owns no workspace but was added
 * to one would otherwise resolve to nothing and be locked out of a workspace they
 * legitimately belong to.
 *
 * @returns Workspace id, or null when the account has no workspace at all
 */
export async function getDefaultWorkspaceId(actorId: string): Promise<string | null> {
  const db = getSupabaseAdmin();

  const { data: founder } = await db
    .from('founders')
    .select('active_workspace_id')
    .eq('id', actorId)
    .maybeSingle();

  const active = (founder as { active_workspace_id?: string | null } | null)?.active_workspace_id;
  // Confirm the stored active workspace is still one the actor may use — a stale
  // pointer left over from a removed membership must not grant access.
  if (active && (await getWorkspaceRole(actorId, active))) return active;

  // FALLBACK ONLY WHEN UNAMBIGUOUS. This took the OLDEST owned workspace, which
  // for a founder with two businesses silently resolved to the first one they
  // created — so an unset or stale active pointer quietly served AllignX to
  // someone operating LaunchMind. With one workspace there is nothing to get
  // wrong and the bootstrap is genuinely useful; with several, guessing is the
  // defect. Returning null makes the caller fail closed.
  const { data: ownedAll } = await db
    .from('workspaces')
    .select('id')
    .eq('founder_id', actorId)
    .order('created_at', { ascending: true })
    .limit(2);

  const owned = (ownedAll ?? []) as Array<{ id: string }>;
  if (owned.length === 1) return owned[0].id;
  if (owned.length > 1) return null;

  // Accepted memberships only. A pending invitation still grants nothing.
  const { data: member } = await db
    .from('workspace_members')
    .select('workspace_id, accepted_at')
    .eq('founder_id', actorId)
    .not('accepted_at', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return (member as { workspace_id?: string } | null)?.workspace_id ?? null;
}

/**
 * Asserts the context's role meets a minimum.
 * @throws {WorkspacePermissionError} When the role is insufficient
 */
export function requireWorkspaceRole(ctx: WorkspaceContext, minimum: WorkspaceRole): void {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[minimum]) {
    throw new WorkspacePermissionError(minimum, ctx.role);
  }
}

/** Mutating a connection requires editor or above. Viewers are read-only. */
export function requireWorkspaceWrite(ctx: WorkspaceContext): void {
  requireWorkspaceRole(ctx, 'editor');
}

/**
 * Granting or approving execution authority (CHANGE/PUBLISH/SPEND) requires admin
 * or above — an editor may connect a read-only source but may not widen authority.
 */
export function requireAuthorityChange(ctx: WorkspaceContext): void {
  requireWorkspaceRole(ctx, 'admin');
}

/**
 * Verifies a connection belongs to the context's workspace — the fourth check
 * (resource ownership). Guards against an id from workspace B being passed with a
 * valid context for workspace A.
 *
 * @returns The connection's provider and founder attribution
 * @throws {WorkspaceAccessError} When the connection is absent or in another workspace
 * @security The workspace predicate is part of the query, so a mismatch returns no
 *   row rather than relying on a post-hoc comparison.
 */
export async function assertConnectionInWorkspace(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<{ id: string; provider: string; founder_id: string; workspace_id: string; status: string }> {
  const { data } = await getSupabaseAdmin()
    .from('workspace_connections')
    .select('id, provider, founder_id, workspace_id, status')
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();

  if (!data) throw new WorkspaceAccessError('Connection not found');
  return data as { id: string; provider: string; founder_id: string; workspace_id: string; status: string };
}

/**
 * Re-verifies a workspace context for a background job.
 *
 * A queued job carries a workspace id in its payload. By the time it runs, the
 * workspace may have been deleted or the actor removed from it. Jobs must therefore
 * re-check rather than trust the payload — otherwise a job enqueued before a
 * membership change could still write across the tenant boundary.
 *
 * @param workspaceId  - Workspace from the job payload
 * @param connectionId - Connection the job intends to act on
 * @returns True only when the connection still exists inside that workspace
 * @security Used by connectionSyncWorker before any signal write.
 */
export async function verifyJobWorkspaceBinding(
  workspaceId: string,
  connectionId: string,
): Promise<boolean> {
  if (!workspaceId || !connectionId) return false;

  const { data } = await getSupabaseAdmin()
    .from('workspace_connections')
    .select('id')
    .eq('id', connectionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  return Boolean(data);
}
