/**
 * @file connectionStateMachine.test.ts
 * @description Verifies the guarded connection state machine.
 *   Every persisted status write goes through transitionConnection(), so these tests
 *   are what stop a connection from jumping straight to HEALTHY, or from being
 *   resurrected out of DISCONNECTED without re-authorizing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const WORKSPACE_ID    = 'aa100000-0000-0000-0000-000000000001';
const OTHER_WORKSPACE = 'bb200000-0000-0000-0000-000000000002';
const CONNECTION_ID = 'cc300000-0000-0000-0000-000000000003';

const mockFrom = vi.fn();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  canTransition,
  allowedTransitions,
  isConnectionState,
  transitionConnection,
  InvalidTransitionError,
  CONNECTION_STATES,
  HEALTHY_STATES,
  ATTENTION_STATES,
} from '../src/services/connectionStateMachine';

/**
 * Builds a Supabase chain stub.
 * @param currentStatus - Status the stored row reports, or null for "no such row"
 * @param updateWins    - false simulates a concurrent writer winning the compare-and-set
 */
function chainFor(currentStatus: string | null, updateWins = true) {
  const readChain = {
    select: () => readChain,
    eq:     () => readChain,
    maybeSingle: () =>
      Promise.resolve({
        data:  currentStatus ? { id: CONNECTION_ID, status: currentStatus } : null,
        error: null,
      }),
  };

  const updateChain = {
    update: () => updateChain,
    eq:     () => updateChain,
    select: () => updateChain,
    maybeSingle: () =>
      Promise.resolve({
        data: updateWins && currentStatus
          ? { id: CONNECTION_ID, founder_id: WORKSPACE_ID, status: 'PENDING_ASSERT' }
          : null,
        error: null,
      }),
  };

  // transitionConnection calls .select() first (read), then .update().
  return { ...readChain, ...updateChain, select: () => readChain, update: () => updateChain };
}

beforeEach(() => {
  mockFrom.mockReset();
});

// ── Pure transition table ─────────────────────────────────────────────────────

describe('canTransition', () => {
  it('allows the happy path: NOT_CONNECTED → … → HEALTHY', () => {
    expect(canTransition('NOT_CONNECTED', 'AUTHORIZING')).toBe(true);
    expect(canTransition('AUTHORIZING', 'AUTHORIZED')).toBe(true);
    expect(canTransition('AUTHORIZED', 'SELECTING_SOURCE')).toBe(true);
    expect(canTransition('SELECTING_SOURCE', 'SYNC_QUEUED')).toBe(true);
    expect(canTransition('SYNC_QUEUED', 'SYNCING')).toBe(true);
    expect(canTransition('SYNCING', 'HEALTHY')).toBe(true);
  });

  it('rejects skipping authorization entirely', () => {
    // The bug class this guards: a connection appearing connected without a provider
    // ever having accepted a credential.
    expect(canTransition('NOT_CONNECTED', 'HEALTHY')).toBe(false);
    expect(canTransition('NOT_CONNECTED', 'AUTHORIZED')).toBe(false);
    expect(canTransition('PREVIEWING', 'HEALTHY')).toBe(false);
    expect(canTransition('PREVIEWING', 'SYNC_QUEUED')).toBe(false);
  });

  it('rejects syncing without authorization', () => {
    expect(canTransition('NOT_CONNECTED', 'SYNCING')).toBe(false);
    expect(canTransition('DISCONNECTED', 'SYNC_QUEUED')).toBe(false);
    expect(canTransition('PERMISSION_DENIED', 'SYNC_QUEUED')).toBe(false);
  });

  it('requires re-authorization after NEEDS_REAUTH', () => {
    expect(canTransition('NEEDS_REAUTH', 'HEALTHY')).toBe(false);
    expect(canTransition('NEEDS_REAUTH', 'SYNC_QUEUED')).toBe(false);
    expect(canTransition('NEEDS_REAUTH', 'AUTHORIZING')).toBe(true);
  });

  it('lets a disconnected source start over but not resume', () => {
    expect(canTransition('DISCONNECTED', 'AUTHORIZING')).toBe(true);
    expect(canTransition('DISCONNECTED', 'PREVIEWING')).toBe(true);
    expect(canTransition('DISCONNECTED', 'HEALTHY')).toBe(false);
  });

  it('treats NO_HISTORY and PARTIAL as live states that can re-sync', () => {
    expect(canTransition('NO_HISTORY', 'SYNC_QUEUED')).toBe(true);
    expect(canTransition('NO_HISTORY', 'HEALTHY')).toBe(true);
    expect(canTransition('PARTIAL', 'SYNC_QUEUED')).toBe(true);
    expect(canTransition('PARTIAL', 'HEALTHY')).toBe(true);
  });

  it('routes every sync failure mode out of SYNCING', () => {
    for (const outcome of ['HEALTHY', 'PARTIAL', 'NO_HISTORY', 'SYNC_FAILED',
                           'NEEDS_REAUTH', 'PERMISSION_DENIED', 'WRONG_ACCOUNT',
                           'PROVIDER_UNAVAILABLE']) {
      expect(canTransition('SYNCING', outcome)).toBe(true);
    }
  });

  it('allows self-transitions so a replayed worker job is idempotent', () => {
    expect(canTransition('SYNCING', 'SYNCING')).toBe(true);
    expect(canTransition('HEALTHY', 'HEALTHY')).toBe(true);
  });

  it('rejects unknown states on either side', () => {
    expect(canTransition('BOGUS', 'HEALTHY')).toBe(false);
    expect(canTransition('HEALTHY', 'BOGUS')).toBe(false);
  });

  it('leaves no dead end — every state can still reach an inactive state', () => {
    // SYNCING cannot exit directly (a sync in flight must resolve first), but it
    // must not be a trap: every state needs a path back to NOT_CONNECTED or
    // DISCONNECTED. Breadth-first over the transition table proves it.
    const EXITS = ['NOT_CONNECTED', 'DISCONNECTED'];

    for (const start of CONNECTION_STATES) {
      const seen = new Set<string>([start]);
      const queue = [start];
      let reachedExit = EXITS.includes(start);

      while (queue.length > 0 && !reachedExit) {
        const current = queue.shift() as string;
        for (const next of allowedTransitions(current)) {
          if (EXITS.includes(next)) { reachedExit = true; break; }
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }

      expect({ state: start, reachedExit }).toEqual({ state: start, reachedExit: true });
    }
  });

  it('does not let an in-flight authorization jump straight to DISCONNECTED', () => {
    // Nothing is connected yet, so "disconnect" is not the meaningful exit.
    expect(canTransition('AUTHORIZING', 'DISCONNECTED')).toBe(false);
    expect(canTransition('AUTHORIZING', 'NOT_CONNECTED')).toBe(true);
  });
});

describe('state classification', () => {
  it('counts only HEALTHY and PARTIAL as holding observed data', () => {
    expect(HEALTHY_STATES).toEqual(['HEALTHY', 'PARTIAL']);
    // NO_HISTORY is a healthy connection but must never imply observed data.
    expect(HEALTHY_STATES).not.toContain('NO_HISTORY');
    expect(HEALTHY_STATES).not.toContain('SYNCING');
  });

  it('classifies every recovery state as needing owner attention', () => {
    for (const s of ['NEEDS_REAUTH', 'PERMISSION_DENIED', 'WRONG_ACCOUNT',
                     'PROVIDER_UNAVAILABLE', 'SYNC_FAILED']) {
      expect(ATTENTION_STATES).toContain(s);
    }
  });

  it('recognises exactly the 16 persisted states', () => {
    expect(CONNECTION_STATES).toHaveLength(16);
    expect(isConnectionState('HEALTHY')).toBe(true);
    expect(isConnectionState('healthy')).toBe(false);
  });

  it('returns [] for allowedTransitions from an unknown state', () => {
    expect(allowedTransitions('NOPE')).toEqual([]);
    expect(allowedTransitions('SYNCING').length).toBeGreaterThan(0);
  });
});

// ── Persisted transitions ─────────────────────────────────────────────────────

describe('transitionConnection', () => {
  it('persists a legal transition', async () => {
    mockFrom.mockImplementation(() => chainFor('AUTHORIZED'));
    const row = await transitionConnection(WORKSPACE_ID, CONNECTION_ID, 'SYNC_QUEUED', {
      traceId: 'lm_00000000000000000000000000000001',
    });
    expect(row).toBeDefined();
  });

  it('throws InvalidTransitionError on an illegal transition', async () => {
    mockFrom.mockImplementation(() => chainFor('NOT_CONNECTED'));
    await expect(
      transitionConnection(WORKSPACE_ID, CONNECTION_ID, 'HEALTHY'),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('reports a 409-worthy error with both endpoints named', async () => {
    mockFrom.mockImplementation(() => chainFor('NOT_CONNECTED'));
    await expect(
      transitionConnection(WORKSPACE_ID, CONNECTION_ID, 'HEALTHY'),
    ).rejects.toMatchObject({ from: 'NOT_CONNECTED', to: 'HEALTHY', statusCode: 409 });
  });

  it('honours an expectedFrom guard', async () => {
    mockFrom.mockImplementation(() => chainFor('SYNCING'));
    await expect(
      transitionConnection(WORKSPACE_ID, CONNECTION_ID, 'HEALTHY', { expectedFrom: 'SYNC_QUEUED' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('fails when the connection is not in the caller workspace', async () => {
    // The row read is scoped by workspace_id, so another tenant sees nothing.
    mockFrom.mockImplementation(() => chainFor(null));
    await expect(
      transitionConnection(OTHER_WORKSPACE, CONNECTION_ID, 'SYNC_QUEUED'),
    ).rejects.toThrow(/not found or access denied/);
  });

  it('fails closed when a concurrent writer wins the compare-and-set', async () => {
    // Update matched zero rows because status changed between read and write.
    mockFrom.mockImplementation(() => chainFor('SYNC_QUEUED', false));
    await expect(
      transitionConnection(WORKSPACE_ID, CONNECTION_ID, 'SYNCING'),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});
