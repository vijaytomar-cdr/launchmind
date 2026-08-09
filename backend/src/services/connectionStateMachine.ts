/**
 * @file connectionStateMachine.ts
 * @description Canonical state model for workspace_connections. Every status write
 *   goes through transitionConnection(), which rejects transitions that are not in
 *   the allow-list. This makes the persisted status the single source of truth for
 *   the Growth Brain, Morning Brief, and Improve Intelligence surfaces — no surface
 *   may infer connection state from button labels or local component state (spec §9).
 * @security Tenancy is re-verified inside the transition (workspace_id predicate on
 *   both the read and the UPDATE), so a caller holding a connection id from another
 *   workspace cannot move it — independently of RLS.
 * @dependencies supabaseAdmin, workspace_connections (migrations 075, 080), traceId
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

/** The 16 persisted connection states (migration 075 CHECK constraint). */
export const CONNECTION_STATES = [
  'NOT_CONNECTED',
  'PREVIEWING',
  'AUTHORIZING',
  'AUTHORIZED',
  'SELECTING_SOURCE',
  'SYNC_QUEUED',
  'SYNCING',
  'PARTIAL',
  'HEALTHY',
  'NO_HISTORY',
  'NEEDS_REAUTH',
  'PERMISSION_DENIED',
  'WRONG_ACCOUNT',
  'PROVIDER_UNAVAILABLE',
  'SYNC_FAILED',
  'DISCONNECTED',
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * States in which the connection is authorized and has usable observed data.
 * Coverage scoring and "connected" badges must use this set, not row existence.
 */
export const HEALTHY_STATES: readonly ConnectionState[] = ['HEALTHY', 'PARTIAL'] as const;

/**
 * States meaning "authorized, sync pipeline engaged, not yet producing data".
 * Shown as in-progress — never as connected-with-data.
 */
export const IN_FLIGHT_STATES: readonly ConnectionState[] = [
  'AUTHORIZING',
  'AUTHORIZED',
  'SELECTING_SOURCE',
  'SYNC_QUEUED',
  'SYNCING',
] as const;

/**
 * States requiring owner action before data can flow again. Historical data
 * imported earlier is preserved; only freshness degrades (spec §14.3).
 */
export const ATTENTION_STATES: readonly ConnectionState[] = [
  'NEEDS_REAUTH',
  'PERMISSION_DENIED',
  'WRONG_ACCOUNT',
  'PROVIDER_UNAVAILABLE',
  'SYNC_FAILED',
] as const;

/** Terminal/idle states — no credential is active. */
export const INACTIVE_STATES: readonly ConnectionState[] = [
  'NOT_CONNECTED',
  'PREVIEWING',
  'DISCONNECTED',
] as const;

/**
 * Allowed transitions. Anything absent is rejected.
 * Read as: from → the set of states it may move to.
 */
const ALLOWED: Record<ConnectionState, readonly ConnectionState[]> = {
  // Owner is browsing; nothing authorized yet.
  NOT_CONNECTED:  ['PREVIEWING', 'AUTHORIZING'],
  PREVIEWING:     ['NOT_CONNECTED', 'AUTHORIZING'],

  // Credential submitted; awaiting a real provider verification result.
  AUTHORIZING:    ['AUTHORIZED', 'PERMISSION_DENIED', 'WRONG_ACCOUNT', 'NEEDS_REAUTH',
                   'PROVIDER_UNAVAILABLE', 'NOT_CONNECTED'],

  // Provider confirmed the credential.
  AUTHORIZED:     ['SELECTING_SOURCE', 'SYNC_QUEUED', 'WRONG_ACCOUNT', 'NEEDS_REAUTH',
                   'PROVIDER_UNAVAILABLE', 'DISCONNECTED'],
  SELECTING_SOURCE: ['AUTHORIZED', 'SYNC_QUEUED', 'WRONG_ACCOUNT', 'NEEDS_REAUTH', 'DISCONNECTED'],

  // Sync pipeline.
  SYNC_QUEUED:    ['SYNCING', 'SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'NEEDS_REAUTH', 'DISCONNECTED'],
  SYNCING:        ['HEALTHY', 'PARTIAL', 'NO_HISTORY', 'SYNC_FAILED', 'NEEDS_REAUTH',
                   'PERMISSION_DENIED', 'WRONG_ACCOUNT', 'PROVIDER_UNAVAILABLE'],

  // Post-sync resting states — all may re-sync.
  HEALTHY:        ['SYNC_QUEUED', 'PARTIAL', 'NO_HISTORY', 'NEEDS_REAUTH', 'SYNC_FAILED',
                   'PROVIDER_UNAVAILABLE', 'DISCONNECTED'],
  PARTIAL:        ['SYNC_QUEUED', 'HEALTHY', 'NO_HISTORY', 'NEEDS_REAUTH', 'SYNC_FAILED',
                   'PROVIDER_UNAVAILABLE', 'DISCONNECTED'],
  NO_HISTORY:     ['SYNC_QUEUED', 'HEALTHY', 'PARTIAL', 'NEEDS_REAUTH', 'SYNC_FAILED',
                   'PROVIDER_UNAVAILABLE', 'DISCONNECTED'],

  // Recovery states — each offers a specific remedy (spec §14).
  NEEDS_REAUTH:        ['AUTHORIZING', 'DISCONNECTED'],
  PERMISSION_DENIED:   ['AUTHORIZING', 'NOT_CONNECTED', 'DISCONNECTED'],
  WRONG_ACCOUNT:       ['SELECTING_SOURCE', 'AUTHORIZING', 'NOT_CONNECTED', 'DISCONNECTED'],
  PROVIDER_UNAVAILABLE:['SYNC_QUEUED', 'AUTHORIZING', 'DISCONNECTED'],
  SYNC_FAILED:         ['SYNC_QUEUED', 'AUTHORIZING', 'NEEDS_REAUTH', 'DISCONNECTED'],

  // Owner revoked access; may start over.
  DISCONNECTED:   ['PREVIEWING', 'AUTHORIZING', 'NOT_CONNECTED'],
};

/** Raised when a caller attempts a transition that is not allowed. */
export class InvalidTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly statusCode = 409;

  constructor(from: string, to: string) {
    super(`Invalid connection state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** @returns True when `value` is one of the 16 persisted states. */
export function isConnectionState(value: string): value is ConnectionState {
  return (CONNECTION_STATES as readonly string[]).includes(value);
}

/**
 * Pure predicate for the transition table. Self-transitions are allowed so that
 * an idempotent worker replay does not fail (e.g. SYNCING → SYNCING).
 * @param from - Current persisted state
 * @param to   - Desired state
 * @returns True when the transition is permitted
 */
export function canTransition(from: string, to: string): boolean {
  if (!isConnectionState(from) || !isConnectionState(to)) return false;
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

/** @returns The states reachable from `from`, or [] when `from` is not a valid state. */
export function allowedTransitions(from: string): readonly ConnectionState[] {
  return isConnectionState(from) ? ALLOWED[from] : [];
}

/**
 * Moves a connection to a new state, rejecting transitions outside the allow-list.
 *
 * Uses a compare-and-set UPDATE (`.eq('status', current)`) so two concurrent writers
 * cannot both believe they made the transition — the loser affects zero rows and
 * gets InvalidTransitionError rather than silently overwriting.
 *
 * @param workspaceId  - Tenant that owns the connection (predicate on read AND update)
 * @param connectionId - Connection to move
 * @param to           - Target state
 * @param opts.traceId - Correlation id; written to last_trace_id
 * @param opts.extra   - Additional columns to set in the same statement
 * @param opts.expectedFrom - Optional guard; when given, the current state must match
 * @returns The updated connection row
 * @throws {InvalidTransitionError} On a disallowed transition or a lost compare-and-set
 * @throws {Error} When the connection does not exist in this workspace
 * @security workspace_id is part of both predicates — a connection id from another
 *   tenant matches nothing, independent of RLS.
 */
export async function transitionConnection(
  workspaceId: string,
  connectionId: string,
  to: ConnectionState,
  opts: {
    traceId?: string;
    extra?: Record<string, unknown>;
    expectedFrom?: ConnectionState;
  } = {},
): Promise<Record<string, unknown>> {
  const db = getSupabaseAdmin();

  const { data: current, error: readErr } = await db
    .from('workspace_connections')
    .select('id, status')
    .eq('id', connectionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (readErr || !current) throw new Error('Connection not found or access denied');

  const from = (current as { status: string }).status;

  if (opts.expectedFrom && from !== opts.expectedFrom) {
    throw new InvalidTransitionError(from, to);
  }
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }

  const patch: Record<string, unknown> = {
    status:     to,
    updated_at: new Date().toISOString(),
    ...(opts.extra ?? {}),
  };
  if (opts.traceId) patch.last_trace_id = opts.traceId;

  const { data, error } = await db
    .from('workspace_connections')
    .update(patch)
    .eq('id', connectionId)
    .eq('workspace_id', workspaceId)
    .eq('status', from) // compare-and-set: guards against a concurrent transition
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`Failed to transition connection: ${error.message}`);
  if (!data) throw new InvalidTransitionError(from, to); // another writer moved it first

  return data as Record<string, unknown>;
}
