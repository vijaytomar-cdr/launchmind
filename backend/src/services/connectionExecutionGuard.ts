/**
 * @file connectionExecutionGuard.ts
 * @description The single choke point every provider-mutating action must pass.
 *
 *   Google Ads and Meta are the first ACTION-CAPABLE providers LaunchMind connects to.
 *   Their tokens can, in principle, change campaigns and spend money. Nothing in
 *   LaunchMind may do so, and "nothing does today" is not a durable guarantee — so
 *   this file exists to make it structural.
 *
 *   Four independent gates, all of which must pass. Any one of them alone would stop
 *   an accidental execution; together they mean a mistake in one layer is not enough.
 *
 *     1. WORKSPACE   the actor is a member with the required role
 *     2. AUTHORITY   the connection's persisted grant includes the level
 *     3. CAPABILITY  the adapter actually implements the action
 *     4. ACTOR       a founder initiated it; system/AI actors are refused outright
 *
 *   Gate 3 is currently unsatisfiable by design: no adapter implements any execution
 *   capability. Even a workspace owner who explicitly grants SPEND cannot cause an
 *   external change, because there is nothing to call. Step 5 builds the boundary;
 *   execution itself is a later milestone.
 *
 * @security
 *   - Order matters. Authority is checked BEFORE capability so an unauthorized caller
 *     learns nothing about what the platform can or cannot do.
 *   - `actorType: 'system'` is rejected before any other check. An AI-planned action
 *     cannot execute even inside a workspace whose owner granted SPEND, because the
 *     grant belongs to the owner, not to the planner.
 *   - Every refusal is auditable via connection_permission_history when it involves a
 *     permission change; refusals here are logged with the reason.
 * @dependencies workspaceAuthService, connectionPermissionService, providers/registry
 */

import {
  assertConnectionInWorkspace,
  requireWorkspaceRole,
  type WorkspaceContext,
} from './workspaceAuthService';
import {
  getEffectivePermissions,
  isExecutionPermission,
  type PermissionLevel,
} from './connectionPermissionService';
import { getAdapter } from './providers/registry';

/**
 * Actions that touch something outside LaunchMind, each mapped to the permission it
 * requires. Nothing may be executed that is not listed here.
 */
export const EXECUTION_ACTIONS = {
  update_campaign:  'CHANGE',
  pause_campaign:   'CHANGE',
  update_budget:    'SPEND',
  launch_campaign:  'PUBLISH',
  publish_creative: 'PUBLISH',
  create_campaign:  'SPEND',
} as const satisfies Record<string, PermissionLevel>;

export type ExecutionAction = keyof typeof EXECUTION_ACTIONS;

/** Who is asking. Only a founder may ever trigger an execution. */
export type ActorType = 'founder' | 'system';

/** Raised whenever an execution is refused. Carries which gate stopped it. */
export class ExecutionBlockedError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly gate: 'workspace' | 'authority' | 'capability' | 'actor';

  constructor(gate: ExecutionBlockedError['gate'], code: string, message: string, statusCode = 403) {
    super(message);
    this.name = 'ExecutionBlockedError';
    this.gate = gate;
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** @returns True when `value` names an action LaunchMind models. */
export function isExecutionAction(value: string): value is ExecutionAction {
  return Object.prototype.hasOwnProperty.call(EXECUTION_ACTIONS, value);
}

/** The permission an action requires. */
export function permissionForAction(action: ExecutionAction): PermissionLevel {
  return EXECUTION_ACTIONS[action];
}

/**
 * Reports what a connection could and could not do, for the owner-facing permission
 * panel. Read from the persisted grant and the adapter's real capabilities — never
 * from the provider's token scopes, which for Google Ads are broader than anything
 * LaunchMind will use.
 *
 * @returns Per-action allowed/blocked with the reason
 */
export async function describeExecutionBoundary(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<{
  granted: PermissionLevel[];
  actions: Array<{ action: ExecutionAction; requires: PermissionLevel; allowed: boolean; blockedBy: string | null }>;
  /** True when the adapter implements no execution capability at all. */
  providerExecutionImplemented: boolean;
}> {
  const connection = await assertConnectionInWorkspace(ctx, connectionId);
  const granted = await getEffectivePermissions(ctx, connectionId);

  let capabilities = new Set<string>();
  try {
    const adapter = getAdapter(connection.provider);
    capabilities = new Set(adapterExecutionCapabilities(adapter));
  } catch {
    // No adapter → nothing is possible, which the loop below reports.
  }

  const actions = (Object.keys(EXECUTION_ACTIONS) as ExecutionAction[]).map(action => {
    const requires = EXECUTION_ACTIONS[action];
    const hasAuthority  = granted.includes(requires);
    const hasCapability = capabilities.has(action);
    return {
      action,
      requires,
      allowed: hasAuthority && hasCapability,
      blockedBy: !hasAuthority
        ? `${requires} has not been granted for this connection`
        : !hasCapability
          ? 'LaunchMind has not implemented this action for this provider'
          : null,
    };
  });

  return { granted, actions, providerExecutionImplemented: capabilities.size > 0 };
}

/**
 * Lists the execution actions an adapter genuinely implements.
 *
 * Read-only adapters expose no execution members, so this returns []. Duck-typing on
 * the adapter rather than trusting a declared flag means an adapter cannot claim a
 * capability it has not written.
 */
function adapterExecutionCapabilities(adapter: unknown): string[] {
  const obj = adapter as Record<string, unknown>;
  return (Object.keys(EXECUTION_ACTIONS) as string[]).filter(
    action => typeof obj[executionMethodName(action)] === 'function',
  );
}

/** Method name an adapter would have to implement to support an action. */
export function executionMethodName(action: string): string {
  return `execute_${action}`;
}

/**
 * Asserts an execution may proceed. Throws unless all four gates pass.
 *
 * @param ctx          - Verified workspace context
 * @param connectionId - Connection the action would run against
 * @param action       - What is being attempted
 * @param actorType    - 'founder' for an owner-initiated action; 'system' for anything
 *                       planned by an agent, a mission, or the AI platform
 * @throws {ExecutionBlockedError} Naming the gate that refused
 * @security This is the ONLY sanctioned way to begin a provider-mutating action.
 *   Bypassing it is a security defect, not a shortcut.
 */
export async function assertExecutionAllowed(
  ctx: WorkspaceContext,
  connectionId: string,
  action: string,
  actorType: ActorType = 'founder',
): Promise<void> {
  // Gate 4 first, and unconditionally: no AI-planned action reaches a provider,
  // regardless of what the workspace has granted. Checked before anything else so a
  // system actor cannot even probe the other gates.
  if (actorType !== 'founder') {
    throw new ExecutionBlockedError(
      'actor',
      'SYSTEM_ACTOR_CANNOT_EXECUTE',
      'Only a person can trigger an action against a connected platform. LaunchMind can prepare and recommend, never execute on its own.',
    );
  }

  if (!isExecutionAction(action)) {
    throw new ExecutionBlockedError(
      'capability',
      'UNKNOWN_EXECUTION_ACTION',
      'That action is not something LaunchMind performs.',
      400,
    );
  }

  const required = EXECUTION_ACTIONS[action];

  // Gate 1 — workspace membership and role. Execution needs admin or above; an
  // editor may connect an observation source but may not act on a platform.
  const connection = await assertConnectionInWorkspace(ctx, connectionId);
  requireWorkspaceRole(ctx, 'admin');

  // Gate 2 — persisted authority. Never inferred from the provider's token scopes:
  // the Google Ads `adwords` scope is broad, and LaunchMind still holds only what the
  // owner explicitly granted.
  const granted = await getEffectivePermissions(ctx, connectionId);
  if (!granted.includes(required)) {
    throw new ExecutionBlockedError(
      'authority',
      'AUTHORITY_NOT_GRANTED',
      `This connection is not authorized to ${required.toLowerCase()}. ` +
      `Granted: ${granted.length ? granted.join(', ') : 'nothing'}. ` +
      'An owner must approve an authority upgrade first.',
    );
  }

  // Gate 3 — the adapter must actually implement it. Reached only by a caller who
  // already holds the authority, so it leaks nothing.
  const adapter = getAdapter(connection.provider);
  if (typeof (adapter as unknown as Record<string, unknown>)[executionMethodName(action)] !== 'function') {
    throw new ExecutionBlockedError(
      'capability',
      'EXECUTION_NOT_IMPLEMENTED',
      `LaunchMind can observe ${connection.provider} but does not perform this action yet. Nothing was changed.`,
      501,
    );
  }
}

/**
 * Convenience predicate for UI and non-throwing callers.
 * @returns True only when every gate would pass
 */
export async function canExecute(
  ctx: WorkspaceContext,
  connectionId: string,
  action: string,
  actorType: ActorType = 'founder',
): Promise<boolean> {
  try {
    await assertExecutionAllowed(ctx, connectionId, action, actorType);
    return true;
  } catch {
    return false;
  }
}

/** @returns The execution permissions an action-capable provider could later request. */
export function upgradeableAuthorities(): PermissionLevel[] {
  return (Object.values(EXECUTION_ACTIONS) as PermissionLevel[])
    .filter(isExecutionPermission)
    .filter((p, i, arr) => arr.indexOf(p) === i);
}
