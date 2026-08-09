/**
 * @file executionBoundary.test.ts
 * @description Proves the Step 5 trust boundary for action-capable providers.
 *
 *   Google Ads and Meta hold tokens that could, in principle, change campaigns and
 *   spend money. These tests are the evidence that LaunchMind cannot:
 *
 *     - a read-only connection cannot invoke any execution route
 *     - the persisted permission state, not the provider token, decides
 *     - the AI / system actor is refused before every other check
 *     - founder approval through the audited upgrade path is the only way to widen
 *     - the boundary holds across the workspace tenant line
 *     - even a fully granted owner cannot execute, because no adapter implements it
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { MemoryDb } from './helpers/memoryDb';

const OWNER_A    = 'aa100000-0000-0000-0000-000000000001';
const OWNER_B    = 'bb200000-0000-0000-0000-000000000002';
const EDITOR_A   = 'ee300000-0000-0000-0000-000000000003';
const WORKSPACE_A = '11110000-0000-0000-0000-000000000001';
const WORKSPACE_B = '22220000-0000-0000-0000-000000000002';
const CONN_ADS   = 'c0000000-0000-0000-0000-0000000000a1';
const CONN_B     = 'c0000000-0000-0000-0000-0000000000b1';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => db.asClient() }));
vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async (p: string) => ({ ciphertext: `enc(${p})`, kmsKeyId: 'kms' })),
  decryptToken: vi.fn(async (c: string) => c.replace(/^enc\(/, '').replace(/\)$/, '')),
}));
vi.mock('../src/workers/connectionSyncWorker', () => ({
  enqueueConnectionSync: vi.fn(async () => undefined), getConnectionSyncQueue: vi.fn(() => ({})),
  startConnectionSyncWorker: vi.fn(), stopConnectionSyncWorker: vi.fn(async () => undefined),
  CONNECTION_SYNC_QUEUE_NAME: 'connection-sync',
}));
vi.mock('../src/workers/missionWorker', () => ({
  enqueueMission: vi.fn(async () => undefined), getMissionQueue: vi.fn(() => ({})),
  startMissionWorker: vi.fn(), stopMissionWorker: vi.fn(async () => undefined),
  MISSION_QUEUE_NAME: 'mission-execution',
}));
vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => null), scrapeAppStore: vi.fn(),
  scrapePlayStore: vi.fn(), scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({ sentiment: 'positive', painPoints: [], copySignals: [], marketingOpportunities: [] })),
}));
vi.mock('../src/services/icpService', () => ({ buildICPBrief: vi.fn(() => ({})) }));
vi.mock('../src/services/strategyService', () => ({
  generateStrategy: vi.fn(async () => ({})), generateContentAssets: vi.fn(async () => ({})),
  getProductStrategy: vi.fn(async () => ({ campaigns: [], fullStrategy: null })),
}));
vi.mock('../src/lib/tokens', () => ({ consumeTokens: vi.fn(async () => undefined) }));
vi.mock('../src/services/billingService', () => ({
  createStripeCheckout: vi.fn(async () => ({ url: '' })),
  createRazorpayCheckout: vi.fn(async () => ({ orderId: '', amount: 0, currency: 'INR', keyId: '' })),
  handleStripeWebhook: vi.fn(async () => undefined), handleRazorpayWebhook: vi.fn(async () => undefined),
  cancelSubscription: vi.fn(async () => undefined),
  getSubscriptionStatus: vi.fn(async () => ({ plan: 'solo', tokenBalance: 300, renewalNote: '' })),
}));

import {
  assertExecutionAllowed, canExecute, describeExecutionBoundary,
  ExecutionBlockedError, EXECUTION_ACTIONS, executionMethodName,
} from '../src/services/connectionExecutionGuard';
import { approveAuthorityUpgrade, getEffectivePermissions } from '../src/services/connectionPermissionService';
import type { WorkspaceContext } from '../src/services/workspaceAuthService';
import { googleAdsAdapter } from '../src/services/providers/googleAdsAdapter';
import { metaAdsAdapter } from '../src/services/providers/metaAdsAdapter';
import { assertReadOnlyQuery } from '../src/services/providers/googleAdsAdapter';

const ownerA: WorkspaceContext  = { actorId: OWNER_A,  workspaceId: WORKSPACE_A, role: 'owner',  isOwner: true };
const ownerB: WorkspaceContext  = { actorId: OWNER_B,  workspaceId: WORKSPACE_B, role: 'owner',  isOwner: true };
const editorA: WorkspaceContext = { actorId: EDITOR_A, workspaceId: WORKSPACE_A, role: 'editor', isOwner: false };

function connectionRow(id: string, workspaceId: string, founderId: string, provider = 'google_ads', permissions: string[] = ['READ', 'RECOMMEND']) {
  return {
    id, workspace_id: workspaceId, founder_id: founderId, provider,
    status: 'HEALTHY', product_id: null, permissions_granted: permissions,
    connection_config: {}, freshness_status: 'fresh', last_synced_at: '2026-08-08T00:00:00Z',
    credential_reference: null, external_account_id: 'acct-1', external_account_name: 'Ads',
    selected_resource_id: 'acct-1', selected_resource_name: 'Ads', error_detail: null, last_trace_id: null,
  };
}

beforeEach(() => {
  db = new MemoryDb({
    founders: [
      { id: OWNER_A, active_workspace_id: WORKSPACE_A },
      { id: OWNER_B, active_workspace_id: WORKSPACE_B },
      { id: EDITOR_A, active_workspace_id: null },
    ],
    workspaces: [
      { id: WORKSPACE_A, founder_id: OWNER_A, created_at: '2026-01-01' },
      { id: WORKSPACE_B, founder_id: OWNER_B, created_at: '2026-01-02' },
    ],
    workspace_members: [
      { id: 'm1', workspace_id: WORKSPACE_A, founder_id: EDITOR_A, role: 'editor', accepted_at: '2026-02-01' },
    ],
    workspace_connections: [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads'),
      connectionRow(CONN_B,   WORKSPACE_B, OWNER_B, 'meta_ads'),
    ],
    connection_permission_history: [], connection_credentials: [],
    intelligence_signals: [], connection_insights: [], audit_logs: [],
  });
});

afterEach(() => vi.unstubAllGlobals());

// ── The adapters expose no execution surface ──────────────────────────────────

describe('action-capable adapters are structurally read-only', () => {
  for (const adapter of [googleAdsAdapter, metaAdsAdapter]) {
    it(`${adapter.key} implements no execute_* method`, () => {
      const surface = Object.keys(adapter);
      for (const action of Object.keys(EXECUTION_ACTIONS)) {
        expect(surface).not.toContain(executionMethodName(action));
      }
      // And nothing write-shaped by any other name.
      for (const forbidden of ['mutate', 'createCampaign', 'updateBudget', 'pause', 'publish', 'setStatus']) {
        expect(surface).not.toContain(forbidden);
      }
    });
  }

  it('Meta requests only read scopes — ads_management is never asked for', () => {
    expect(metaAdsAdapter.readScopes).toEqual(['ads_read', 'read_insights']);
    expect(metaAdsAdapter.readScopes).not.toContain('ads_management');
  });

  it('Google Ads documents that its broad scope is constrained by LaunchMind, not Google', () => {
    // Google publishes no read-only scope, so the guarantee must be ours. The test
    // records that fact so a future reader does not mistake the broad scope for a bug.
    expect(googleAdsAdapter.readScopes).toEqual(['https://www.googleapis.com/auth/adwords']);
    // The compensating control:
    expect(Object.keys(googleAdsAdapter).some(k => k.startsWith('execute_'))).toBe(false);
  });
});

// ── GAQL protocol guard ───────────────────────────────────────────────────────

describe('Google Ads query guard', () => {
  it('accepts plain reads', () => {
    expect(() => assertReadOnlyQuery(
      'SELECT campaign.id, metrics.clicks FROM campaign WHERE segments.date DURING LAST_30_DAYS',
    )).not.toThrow();
  });

  it('rejects anything that is not a SELECT', () => {
    for (const query of [
      'MUTATE campaign SET status = PAUSED',
      'UPDATE campaign SET budget = 100',
      'DELETE FROM campaign',
      'INSERT INTO campaign VALUES (1)',
      '',
      '   ',
    ]) {
      expect(() => assertReadOnlyQuery(query)).toThrow(/only reads/i);
    }
  });

  it('rejects a SELECT carrying a smuggled second statement', () => {
    expect(() => assertReadOnlyQuery(
      'SELECT campaign.id FROM campaign; MUTATE campaign SET status = PAUSED',
    )).toThrow(/only reads/i);
  });

  it('rejects mutation keywords regardless of casing or spacing', () => {
    expect(() => assertReadOnlyQuery('select campaign.id from campaign  set  status = 1')).toThrow();
    expect(() => assertReadOnlyQuery('SeLeCt x FROM campaign MuTaTe y')).toThrow();
  });
});

// ── Gate 4: the AI can never execute ──────────────────────────────────────────

describe('a system / AI actor is refused before any other check', () => {
  it('refuses even with full authority granted', async () => {
    // Grant everything, then try as the system. This is the scenario that matters:
    // the owner trusts LaunchMind, and LaunchMind still may not act by itself.
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'CHANGE', 'PUBLISH', 'SPEND']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);

    const err = await assertExecutionAllowed(ownerA, CONN_ADS, 'update_budget', 'system')
      .catch(e => e as ExecutionBlockedError);

    expect(err).toBeInstanceOf(ExecutionBlockedError);
    expect(err.gate).toBe('actor');
    expect(err.code).toBe('SYSTEM_ACTOR_CANNOT_EXECUTE');
  });

  it('refuses the system actor before it can probe any other gate', async () => {
    // A non-existent connection and an unknown action: a system actor must still be
    // stopped by the actor gate, learning nothing about either.
    const err = await assertExecutionAllowed(
      ownerA, '00000000-0000-0000-0000-000000000000', 'not_a_real_action', 'system',
    ).catch(e => e as ExecutionBlockedError);

    expect(err.gate).toBe('actor');
  });

  it('has no import path from the AI layer to permission or execution state', async () => {
    // Structural: the AI platform and agents must not be able to reach these modules.
    const { readFileSync, readdirSync, existsSync } = await import('fs');
    const files = [
      'src/lib/aiPlatform.ts', 'src/lib/aiClient.ts', 'src/services/agentRegistry.ts',
      ...(existsSync('src/services/agents')
        ? readdirSync('src/services/agents').map(f => `src/services/agents/${f}`)
        : []),
    ].filter(f => existsSync(f));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const forbidden of [
        'connectionPermissionService', 'connectionExecutionGuard',
        'connectionCredentialService', 'approveAuthorityUpgrade',
      ]) {
        expect({ file, forbidden, found: source.includes(forbidden) })
          .toEqual({ file, forbidden, found: false });
      }
    }
  });
});

// ── Gate 2: persisted authority, not the provider token ───────────────────────

describe('a read-only connection cannot execute anything', () => {
  for (const action of Object.keys(EXECUTION_ACTIONS)) {
    it(`refuses ${action}`, async () => {
      const err = await assertExecutionAllowed(ownerA, CONN_ADS, action, 'founder')
        .catch(e => e as ExecutionBlockedError);
      expect(err).toBeInstanceOf(ExecutionBlockedError);
      // Stopped by authority, since READ + RECOMMEND is all that was granted.
      expect(err.gate).toBe('authority');
      expect(err.code).toBe('AUTHORITY_NOT_GRANTED');
    });
  }

  it('is not swayed by the provider token being broad', async () => {
    // Google Ads' token could technically change campaigns. LaunchMind's grant is
    // what decides, and it says no.
    expect(await getEffectivePermissions(ownerA, CONN_ADS)).toEqual(['READ', 'RECOMMEND']);
    expect(await canExecute(ownerA, CONN_ADS, 'update_campaign')).toBe(false);
  });

  it('reports every action as blocked in the owner-facing boundary', async () => {
    const boundary = await describeExecutionBoundary(ownerA, CONN_ADS);
    expect(boundary.granted).toEqual(['READ', 'RECOMMEND']);
    expect(boundary.providerExecutionImplemented).toBe(false);
    expect(boundary.actions.every(a => a.allowed === false)).toBe(true);
    for (const a of boundary.actions) {
      expect(a.blockedBy).toBeTruthy();
    }
  });
});

// ── Gate 3: capability. Even full authority cannot execute ────────────────────

describe('even a fully granted owner cannot execute', () => {
  it('is stopped by the capability gate once authority is granted', async () => {
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'CHANGE', 'PUBLISH', 'SPEND']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);

    const err = await assertExecutionAllowed(ownerA, CONN_ADS, 'update_budget', 'founder')
      .catch(e => e as ExecutionBlockedError);

    // Authority passed; capability did not. This is the last line and it holds.
    expect(err.gate).toBe('capability');
    expect(err.code).toBe('EXECUTION_NOT_IMPLEMENTED');
    expect(err.statusCode).toBe(501);
  });

  it('reports the boundary honestly once authority exists', async () => {
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'SPEND']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);
    const boundary = await describeExecutionBoundary(ownerA, CONN_ADS);
    const budget = boundary.actions.find(a => a.action === 'update_budget');
    expect(budget?.allowed).toBe(false);
    expect(budget?.blockedBy).toMatch(/has not implemented/i);
  });
});

// ── Gate 1: workspace role and tenancy ────────────────────────────────────────

describe('workspace role and isolation hold at the execution boundary', () => {
  it('an editor cannot execute even when the workspace has the authority', async () => {
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'CHANGE']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);
    await expect(assertExecutionAllowed(editorA, CONN_ADS, 'update_campaign', 'founder'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_WORKSPACE_ROLE' });
  });

  it('another workspace cannot execute against this connection', async () => {
    await expect(assertExecutionAllowed(ownerB, CONN_ADS, 'update_campaign', 'founder'))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
  });

  it('another workspace cannot even read the boundary', async () => {
    await expect(describeExecutionBoundary(ownerB, CONN_ADS))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
  });
});

// ── Founder approval is the only widening path ────────────────────────────────

describe('authority can only be widened by an audited founder approval', () => {
  it('an approval is required, recorded, and does not enable execution by itself', async () => {
    expect(await getEffectivePermissions(ownerA, CONN_ADS)).toEqual(['READ', 'RECOMMEND']);

    const granted = await approveAuthorityUpgrade(
      ownerA, CONN_ADS, ['CHANGE'], 'Owner approved campaign edits after reviewing the waste report',
    );
    expect(granted).toEqual(['READ', 'RECOMMEND', 'CHANGE']);

    // Audited, attributable, and immutable.
    const history = db.rows('connection_permission_history');
    const approval = history.find(h => h.action === 'upgrade_approved');
    expect(approval).toBeTruthy();
    expect(approval?.changed_by).toBe(OWNER_A);
    expect(approval?.actor_type).toBe('founder');
    expect(approval?.reason).toMatch(/reviewing the waste report/);
    expect(approval?.previous_snapshot).toEqual(['READ', 'RECOMMEND']);

    // And still nothing can execute, because no adapter implements it.
    expect(await canExecute(ownerA, CONN_ADS, 'update_campaign')).toBe(false);
  });

  it('approving CHANGE does not drag PUBLISH or SPEND along', async () => {
    await approveAuthorityUpgrade(ownerA, CONN_ADS, ['CHANGE'], 'Only campaign edits were approved');
    const granted = await getEffectivePermissions(ownerA, CONN_ADS);
    expect(granted).toContain('CHANGE');
    expect(granted).not.toContain('PUBLISH');
    expect(granted).not.toContain('SPEND');
  });

  it('an editor cannot approve an upgrade', async () => {
    await expect(
      approveAuthorityUpgrade(editorA, CONN_ADS, ['SPEND'], 'Editor attempts to self-grant spend'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_WORKSPACE_ROLE' });
    expect(await getEffectivePermissions(ownerA, CONN_ADS)).toEqual(['READ', 'RECOMMEND']);
  });

  it('a cross-workspace approval is refused', async () => {
    await expect(
      approveAuthorityUpgrade(ownerB, CONN_ADS, ['SPEND'], 'Cross tenant escalation attempt'),
    ).rejects.toThrow();
    expect(await getEffectivePermissions(ownerA, CONN_ADS)).toEqual(['READ', 'RECOMMEND']);
  });
});

// ── Route-level enforcement ───────────────────────────────────────────────────

describe('POST /connections/:id/execute enforces the boundary over HTTP', () => {
  let server: FastifyInstance;
  const authA = { authorization: `Bearer ${jwt.sign({ sub: OWNER_A, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' })}` };
  const authB = { authorization: `Bearer ${jwt.sign({ sub: OWNER_B, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' })}` };
  const authEditor = { authorization: `Bearer ${jwt.sign({ sub: EDITOR_A, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' })}` };

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    if (!server) {
      const { buildServer } = await import('../src/server');
      server = await buildServer();
    }
  });

  it('requires authentication', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, body: { action: 'update_campaign' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a read-only connection with the authority gate named', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, headers: authA,
      body: { action: 'update_budget' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('AUTHORITY_NOT_GRANTED');
    expect(body.detail.gate).toBe('authority');
  });

  it('refuses an editor', async () => {
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'CHANGE']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, headers: authEditor,
      body: { action: 'update_campaign' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
  });

  it('refuses across the workspace boundary as not-found', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, headers: authB,
      body: { action: 'update_campaign' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses with 501 even when the owner has granted everything', async () => {
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'CHANGE', 'PUBLISH', 'SPEND']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, headers: authA,
      body: { action: 'launch_campaign' },
    });
    expect(res.statusCode).toBe(501);
    expect(JSON.parse(res.body).code).toBe('EXECUTION_NOT_IMPLEMENTED');
    expect(JSON.parse(res.body).error).toMatch(/[Nn]othing was changed/);
  });

  it('rejects an unknown action', async () => {
    db.setRows('workspace_connections', [
      connectionRow(CONN_ADS, WORKSPACE_A, OWNER_A, 'google_ads', ['READ', 'RECOMMEND', 'SPEND']),
      connectionRow(CONN_B, WORKSPACE_B, OWNER_B, 'meta_ads'),
    ]);
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, headers: authA,
      body: { action: 'transfer_all_funds' },
    });
    expect([400, 403]).toContain(res.statusCode);
    expect(res.body).not.toContain('EXECUTION_NOT_IMPLEMENTED');
  });

  it('exposes the boundary read-only over HTTP', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONN_ADS}/execution-boundary`, headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.granted).toEqual(['READ', 'RECOMMEND']);
    expect(data.providerExecutionImplemented).toBe(false);
    expect(data.actions.every((a: { allowed: boolean }) => !a.allowed)).toBe(true);
  });

  it('the upgrade request path records intent without granting', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/permissions/request-upgrade`, headers: authA,
      body: { levels: ['SPEND'], reason: 'Owner wants LaunchMind to manage paid budget later' },
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.affectsSpend).toBe(true);
    expect(data.approvalStillRequired).toBe(true);

    // Requested, not granted.
    expect(db.rows('workspace_connections').find(c => c.id === CONN_ADS)?.permissions_granted)
      .toEqual(['READ', 'RECOMMEND']);
    expect(db.rows('connection_permission_history').some(h => h.action === 'upgrade_requested')).toBe(true);

    // And execution is still refused.
    const exec = await server.inject({
      method: 'POST', url: `/connections/${CONN_ADS}/execute`, headers: authA,
      body: { action: 'update_budget' },
    });
    expect(exec.statusCode).toBe(403);
  });
});
