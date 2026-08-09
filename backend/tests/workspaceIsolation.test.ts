/**
 * @file workspaceIsolation.test.ts
 * @description Proves the workspace tenant boundary for Improve Intelligence.
 *
 *   These tests run against MemoryDb, which HONOURS query predicates. That matters:
 *   with a stub whose .eq() ignores its arguments, every isolation test passes even
 *   if the service forgets its workspace filter. Here a missing
 *   `.eq('workspace_id', …)` surfaces as workspace B's data in workspace A's result.
 *
 *   Covered (Step 2, requirement 4):
 *     - workspace A cannot READ workspace B connections
 *     - workspace A cannot MODIFY workspace B connections
 *     - workspace A cannot access workspace B sync runs
 *     - workspace A cannot access workspace B signals
 *     - background jobs cannot cross workspace boundaries
 *     - a client-supplied workspace id is context, not authorization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FOUNDER_A   = 'aaaa0000-0000-0000-0000-00000000000a';
const FOUNDER_B   = 'bbbb0000-0000-0000-0000-00000000000b';
const OUTSIDER    = 'cccc0000-0000-0000-0000-00000000000c';
const MEMBER_VIEW = 'dddd0000-0000-0000-0000-00000000000d';
const INVITEE     = 'eeee0000-0000-0000-0000-00000000000e';

const WORKSPACE_A = '11110000-0000-0000-0000-000000000001';
const WORKSPACE_B = '22220000-0000-0000-0000-000000000002';

const CONNECTION_A = 'c0000000-0000-0000-0000-0000000000a1';
const CONNECTION_B = 'c0000000-0000-0000-0000-0000000000b1';
const SYNC_RUN_A   = 'd0000000-0000-0000-0000-0000000000a1';
const SYNC_RUN_B   = 'd0000000-0000-0000-0000-0000000000b1';

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => db.asClient(),
}));

vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async () => ({ ciphertext: 'ct', kmsKeyId: 'kms-test' })),
  decryptToken: vi.fn(async () => 'plaintext-token'),
}));

import {
  resolveWorkspaceContext,
  getWorkspaceRole,
  verifyJobWorkspaceBinding,
  requireWorkspaceWrite,
  WorkspaceAccessError,
  WorkspacePermissionError,
  type WorkspaceContext,
} from '../src/services/workspaceAuthService';
import {
  listConnections,
  getConnection,
  getSyncRuns,
  getCanonicalConnectionStates,
  executeSync,
} from '../src/services/connectionService';
import { transitionConnection, InvalidTransitionError } from '../src/services/connectionStateMachine';

/** Builds a context directly, bypassing resolution — used to simulate an attacker
 *  who has a valid context for their OWN workspace and a stolen id from another. */
function ctxFor(actorId: string, workspaceId: string): WorkspaceContext {
  return { actorId, workspaceId, role: 'owner', isOwner: true };
}

beforeEach(() => {
  db = new MemoryDb({
    founders: [
      { id: FOUNDER_A,   active_workspace_id: WORKSPACE_A },
      { id: FOUNDER_B,   active_workspace_id: WORKSPACE_B },
      { id: OUTSIDER,    active_workspace_id: null },
      { id: MEMBER_VIEW, active_workspace_id: null },
      { id: INVITEE,     active_workspace_id: null },
    ],
    workspaces: [
      { id: WORKSPACE_A, founder_id: FOUNDER_A, name: 'Workspace A', created_at: '2026-01-01' },
      { id: WORKSPACE_B, founder_id: FOUNDER_B, name: 'Workspace B', created_at: '2026-01-02' },
    ],
    workspace_members: [
      // Accepted viewer in A — may read, must not write.
      { id: 'm1', workspace_id: WORKSPACE_A, founder_id: MEMBER_VIEW, role: 'viewer', accepted_at: '2026-02-01' },
      // Pending invitation to A — grants nothing until accepted.
      { id: 'm2', workspace_id: WORKSPACE_A, founder_id: INVITEE, role: 'admin', accepted_at: null },
    ],
    workspace_connections: [
      {
        id: CONNECTION_A, workspace_id: WORKSPACE_A, founder_id: FOUNDER_A,
        provider: 'app_store_connect', status: 'HEALTHY', product_id: null,
        permissions_granted: ['READ', 'RECOMMEND'], connection_config: {},
        freshness_status: 'fresh', last_synced_at: '2026-08-01', credential_reference: 'cred-a',
        external_account_id: null, external_account_name: null,
        selected_resource_id: null, selected_resource_name: null,
        error_detail: null, last_trace_id: null,
      },
      {
        id: CONNECTION_B, workspace_id: WORKSPACE_B, founder_id: FOUNDER_B,
        provider: 'app_store_connect', status: 'HEALTHY', product_id: null,
        permissions_granted: ['READ', 'RECOMMEND'], connection_config: {},
        freshness_status: 'fresh', last_synced_at: '2026-08-01', credential_reference: 'cred-b',
        external_account_id: null, external_account_name: null,
        selected_resource_id: null, selected_resource_name: null,
        error_detail: null, last_trace_id: null,
      },
    ],
    connection_sync_runs: [
      { id: SYNC_RUN_A, connection_id: CONNECTION_A, workspace_id: WORKSPACE_A, founder_id: FOUNDER_A, status: 'completed', progress: 100, signals_imported: 3 },
      { id: SYNC_RUN_B, connection_id: CONNECTION_B, workspace_id: WORKSPACE_B, founder_id: FOUNDER_B, status: 'completed', progress: 100, signals_imported: 7 },
    ],
    intelligence_signals: [
      { id: 's1', workspace_id: WORKSPACE_A, founder_id: FOUNDER_A, provider: 'app_store_connect', signal_type: 'downloads', signal_data: { value: 1 } },
      { id: 's2', workspace_id: WORKSPACE_B, founder_id: FOUNDER_B, provider: 'app_store_connect', signal_type: 'downloads', signal_data: { value: 999 } },
      { id: 's3', workspace_id: WORKSPACE_B, founder_id: FOUNDER_B, provider: 'app_store_connect', signal_type: 'impressions', signal_data: { value: 888 } },
    ],
    connection_credentials: [],
    connection_permission_history: [],
    learning_events: [],
  });
});

// ── Membership resolution ─────────────────────────────────────────────────────

describe('membership resolution', () => {
  it('gives the workspace founder the owner role', async () => {
    expect(await getWorkspaceRole(FOUNDER_A, WORKSPACE_A)).toBe('owner');
  });

  it('gives an accepted member their granted role', async () => {
    expect(await getWorkspaceRole(MEMBER_VIEW, WORKSPACE_A)).toBe('viewer');
  });

  it('gives a PENDING invitee nothing', async () => {
    // accepted_at IS NULL must not confer access, even with an admin role recorded.
    expect(await getWorkspaceRole(INVITEE, WORKSPACE_A)).toBeNull();
  });

  it('gives a non-member nothing', async () => {
    expect(await getWorkspaceRole(OUTSIDER, WORKSPACE_A)).toBeNull();
    expect(await getWorkspaceRole(FOUNDER_B, WORKSPACE_A)).toBeNull();
  });
});

// ── The client-supplied workspace id is context, not authorization ────────────

describe('a requested workspace id is context, never authorization', () => {
  it('rejects founder B asking for workspace A', async () => {
    await expect(resolveWorkspaceContext(FOUNDER_B, WORKSPACE_A))
      .rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it('does NOT silently fall back to the actor own workspace', async () => {
    // The dangerous failure mode: treating an unauthorized workspace id as "invalid"
    // and quietly serving the caller's own data instead. That would make the API
    // appear to work while ignoring the requested tenant.
    await expect(resolveWorkspaceContext(FOUNDER_B, WORKSPACE_A)).rejects.toThrow();

    const own = await resolveWorkspaceContext(FOUNDER_B, WORKSPACE_B);
    expect(own.workspaceId).toBe(WORKSPACE_B);
  });

  it('rejects a well-formed but unknown workspace id', async () => {
    await expect(resolveWorkspaceContext(FOUNDER_A, '99990000-0000-0000-0000-000000000009'))
      .rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it('resolves the actor default workspace when none is requested', async () => {
    const ctx = await resolveWorkspaceContext(FOUNDER_A);
    expect(ctx).toMatchObject({ actorId: FOUNDER_A, workspaceId: WORKSPACE_A, role: 'owner' });
  });

  it('ignores a stale active_workspace_id the actor can no longer use', async () => {
    // Point founder B's active workspace at A, then confirm they still resolve to B.
    db.setRows('founders', [
      { id: FOUNDER_B, active_workspace_id: WORKSPACE_A },
      ...db.rows('founders').filter(f => f.id !== FOUNDER_B),
    ]);
    const ctx = await resolveWorkspaceContext(FOUNDER_B);
    expect(ctx.workspaceId).toBe(WORKSPACE_B);
  });
});

// ── Read isolation ────────────────────────────────────────────────────────────

describe('workspace A cannot READ workspace B connections', () => {
  it('listConnections returns only the context workspace rows', async () => {
    const a = await listConnections(ctxFor(FOUNDER_A, WORKSPACE_A));
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe(CONNECTION_A);
    expect(a.map(c => c.workspace_id)).toEqual([WORKSPACE_A]);
  });

  it('getConnection refuses a connection id from another workspace', async () => {
    await expect(getConnection(ctxFor(FOUNDER_A, WORKSPACE_A), CONNECTION_B))
      .rejects.toThrow(/not found or access denied/);
  });

  it('a valid context plus a stolen connection id still fails', async () => {
    // Founder B holds a legitimate context for their own workspace and supplies
    // workspace A's connection id. The workspace predicate must defeat it.
    await expect(getConnection(ctxFor(FOUNDER_B, WORKSPACE_B), CONNECTION_A))
      .rejects.toThrow(/not found or access denied/);
  });
});

// ── Write isolation ───────────────────────────────────────────────────────────

describe('workspace A cannot MODIFY workspace B connections', () => {
  it('transitionConnection refuses a cross-workspace connection', async () => {
    await expect(transitionConnection(WORKSPACE_A, CONNECTION_B, 'SYNC_QUEUED'))
      .rejects.toThrow(/not found or access denied/);

    // And the row is untouched.
    const b = db.rows('workspace_connections').find(r => r.id === CONNECTION_B);
    expect(b?.status).toBe('HEALTHY');
  });

  it('transitionConnection succeeds within the owning workspace', async () => {
    await transitionConnection(WORKSPACE_A, CONNECTION_A, 'SYNC_QUEUED');
    const a = db.rows('workspace_connections').find(r => r.id === CONNECTION_A);
    expect(a?.status).toBe('SYNC_QUEUED');
  });

  it('a viewer cannot write in a workspace they can read', async () => {
    const ctx: WorkspaceContext = { actorId: MEMBER_VIEW, workspaceId: WORKSPACE_A, role: 'viewer', isOwner: false };
    expect(() => requireWorkspaceWrite(ctx)).toThrow(WorkspacePermissionError);
  });

  it('an editor can write', () => {
    const ctx: WorkspaceContext = { actorId: MEMBER_VIEW, workspaceId: WORKSPACE_A, role: 'editor', isOwner: false };
    expect(() => requireWorkspaceWrite(ctx)).not.toThrow();
  });
});

// ── Sync run isolation ────────────────────────────────────────────────────────

describe('workspace A cannot access workspace B sync runs', () => {
  it('returns nothing for another workspace connection', async () => {
    const runs = await getSyncRuns(ctxFor(FOUNDER_A, WORKSPACE_A), CONNECTION_B);
    expect(runs).toEqual([]);
  });

  it('returns only its own runs', async () => {
    const runs = await getSyncRuns(ctxFor(FOUNDER_A, WORKSPACE_A), CONNECTION_A);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(SYNC_RUN_A);
    expect(runs[0].signals_imported).toBe(3); // never B's 7
  });
});

// ── Signal isolation ──────────────────────────────────────────────────────────

describe('workspace A cannot access workspace B signals', () => {
  it('canonical state counts only the context workspace signals', async () => {
    const a = await getCanonicalConnectionStates(ctxFor(FOUNDER_A, WORKSPACE_A));
    expect(a.app_store_connect.signalCount).toBe(1); // not 3

    const b = await getCanonicalConnectionStates(ctxFor(FOUNDER_B, WORKSPACE_B));
    expect(b.app_store_connect.signalCount).toBe(2);
  });

  it('reports NOT_CONNECTED for providers with no row in this workspace', async () => {
    const a = await getCanonicalConnectionStates(ctxFor(FOUNDER_A, WORKSPACE_A));
    expect(a.revenue_cat.status).toBe('NOT_CONNECTED');
    expect(a.revenue_cat.signalCount).toBe(0);
  });
});

// ── Background job isolation ──────────────────────────────────────────────────

describe('background jobs cannot cross workspace boundaries', () => {
  it('verifyJobWorkspaceBinding accepts a correctly bound job', async () => {
    expect(await verifyJobWorkspaceBinding(WORKSPACE_A, CONNECTION_A)).toBe(true);
  });

  it('verifyJobWorkspaceBinding rejects a mismatched pair', async () => {
    expect(await verifyJobWorkspaceBinding(WORKSPACE_A, CONNECTION_B)).toBe(false);
    expect(await verifyJobWorkspaceBinding(WORKSPACE_B, CONNECTION_A)).toBe(false);
  });

  it('rejects empty identifiers rather than matching everything', async () => {
    expect(await verifyJobWorkspaceBinding('', CONNECTION_A)).toBe(false);
    expect(await verifyJobWorkspaceBinding(WORKSPACE_A, '')).toBe(false);
  });

  it('executeSync refuses a job whose workspace does not own the connection', async () => {
    // The realistic attack/bug: a job enqueued for workspace A, then the connection
    // is moved or the payload is tampered with. The worker must refuse before any
    // credential is decrypted or any signal written.
    await expect(
      executeSync(SYNC_RUN_A, CONNECTION_B, WORKSPACE_A, FOUNDER_A, 'lm_00000000000000000000000000000001'),
    ).rejects.toMatchObject({ kind: 'SYNC_FAILED' });

    // No signal was written into workspace A.
    const leaked = db.rows('intelligence_signals').filter(s => s.workspace_id === WORKSPACE_A);
    expect(leaked).toHaveLength(1); // the pre-existing one only
  });

  it('executeSync refuses when the connection was deleted after enqueue', async () => {
    db.setRows(
      'workspace_connections',
      db.rows('workspace_connections').filter(r => r.id !== CONNECTION_A),
    );
    await expect(
      executeSync(SYNC_RUN_A, CONNECTION_A, WORKSPACE_A, FOUNDER_A, 'lm_00000000000000000000000000000002'),
    ).rejects.toMatchObject({ kind: 'SYNC_FAILED' });
  });
});

// ── Regression guard on the state machine ─────────────────────────────────────

describe('state machine tenancy', () => {
  it('does not leak the target state on a cross-workspace attempt', async () => {
    // Must be "not found", not InvalidTransitionError — the latter would confirm
    // the connection exists and reveal its current state.
    const err = await transitionConnection(WORKSPACE_A, CONNECTION_B, 'SYNCING').catch(e => e);
    expect(err).not.toBeInstanceOf(InvalidTransitionError);
    expect((err as Error).message).toMatch(/not found or access denied/);
  });
});
