/**
 * @file connectionService.ts
 * @description Provider-agnostic lifecycle for Improve Intelligence connections:
 *   preview → authorize → select source → queue sync → sync → health → disconnect.
 *
 *   There is NO mock, sample, or fallback data anywhere in this file. Accounts,
 *   metrics, and insights come from a registered ProviderAdapter that made a real
 *   call to the provider API, or they do not exist.
 *
 *   The BullMQ worker is the canonical sync execution path. Nothing here performs
 *   provider I/O on an HTTP request thread.
 *
 * @security
 *   - workspace_id is the tenant boundary. Every read and write carries an explicit
 *     workspace predicate; founder_id is retained only as "who connected it".
 *   - Callers must pass a WorkspaceContext produced by
 *     workspaceAuthService.resolveWorkspaceContext — a workspace id from the client
 *     is context, never authorization.
 *   - Mutations additionally require workspace write role (editor+).
 *   - Credentials live in connection_credentials via connectionCredentialService and
 *     are never returned, logged, or cached here.
 *   - Permissions come from the persisted grant, defaulting to least privilege.
 *     A read-only connection can never imply CHANGE/PUBLISH/SPEND.
 * @dependencies supabaseAdmin, traceId, connectionStateMachine, workspaceAuthService,
 *   connectionCredentialService, connectionPermissionService, providers/registry
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { newTraceId, coerceTraceId } from '../lib/traceId';
import {
  transitionConnection,
  type ConnectionState,
  HEALTHY_STATES,
  IN_FLIGHT_STATES,
  ATTENTION_STATES,
} from './connectionStateMachine';
import { getAdapter, hasAdapter, isKnownProvider, KNOWN_PROVIDERS } from './providers/registry';
import {
  recordLearningEvent,
  snapshotConfidence,
  type LearningEvidenceItem,
} from './growthBrainLearningService';
import { ProviderError, type AdapterContext, type ProviderAccount } from './providers/types';
import {
  requireWorkspaceWrite,
  verifyJobWorkspaceBinding,
  type WorkspaceContext,
} from './workspaceAuthService';
import {
  storeCredential,
  getAccessToken,
  getRefreshToken,
  rotateAccessToken,
  recordRefreshFailure,
  revokeCredential,
  getCredentialSummary,
  CredentialError,
  AccountSubstitutionError,
} from './connectionCredentialService';
import {
  grantInitialPermissions,
  revokeAllPermissions,
  recordReauthorization,
  normalizePermissions,
  type PermissionLevel,
} from './connectionPermissionService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceConnection {
  id: string;
  workspace_id: string;
  founder_id: string;
  product_id: string | null;
  provider: string;
  status: string;
  external_account_id: string | null;
  external_account_name: string | null;
  selected_resource_id: string | null;
  selected_resource_name: string | null;
  freshness_status: string;
  last_synced_at: string | null;
  credential_reference: string | null;
  connection_config: Record<string, unknown>;
  permissions_granted: string[];
  error_detail: string | null;
  last_trace_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionSyncRun {
  id: string;
  connection_id: string;
  workspace_id: string;
  founder_id: string;
  status: string;
  progress: number;
  current_step: string | null;
  steps_completed: unknown[];
  signals_imported: number;
  error_message: string | null;
  trace_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** Maps a ProviderError kind onto the connection state it should produce. */
const ERROR_KIND_TO_STATE: Record<string, ConnectionState> = {
  PERMISSION_DENIED:    'PERMISSION_DENIED',
  WRONG_ACCOUNT:        'WRONG_ACCOUNT',
  NEEDS_REAUTH:         'NEEDS_REAUTH',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  ADAPTER_UNAVAILABLE:  'PROVIDER_UNAVAILABLE',
  SYNC_FAILED:          'SYNC_FAILED',
};

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Gets an existing connection or creates a NOT_CONNECTED stub for
 * (workspace, provider). Creating a stub grants no access.
 * @throws {Error} When the provider slug is not supported
 * @security Row is bound to ctx.workspaceId; founder_id records who created it.
 */
export async function getOrCreateConnection(
  ctx: WorkspaceContext,
  provider: string,
): Promise<WorkspaceConnection> {
  if (!isKnownProvider(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const db = getSupabaseAdmin();

  const { data: existing } = await db
    .from('workspace_connections')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .eq('provider', provider)
    .maybeSingle();

  if (existing) return existing as WorkspaceConnection;

  requireWorkspaceWrite(ctx);

  const { data, error } = await db
    .from('workspace_connections')
    .insert({
      workspace_id: ctx.workspaceId,
      founder_id:   ctx.actorId,
      provider,
      status:       'NOT_CONNECTED',
      permissions_granted: [],
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(`Failed to create connection: ${error?.message}`);
  return data as WorkspaceConnection;
}

/**
 * Lists all connections in the workspace, newest first.
 * @security Scoped by workspace_id — never by founder_id, so every member of a
 *   team workspace sees the same set.
 */
export async function listConnections(ctx: WorkspaceContext): Promise<WorkspaceConnection[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('workspace_connections')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list connections: ${error.message}`);
  return (data ?? []) as WorkspaceConnection[];
}

/**
 * Gets a single connection, verifying it belongs to the context's workspace.
 * @throws {Error} 'Connection not found or access denied' when absent or cross-tenant
 */
export async function getConnection(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<WorkspaceConnection> {
  const { data, error } = await getSupabaseAdmin()
    .from('workspace_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();

  if (error || !data) throw new Error('Connection not found or access denied');
  return data as WorkspaceConnection;
}

// ── Preview (no access granted) ───────────────────────────────────────────────

/**
 * Records that the owner is previewing what a source would unlock. Grants nothing
 * and stores no credential.
 */
export async function previewConnection(
  ctx: WorkspaceContext,
  provider: string,
  traceId: string = newTraceId(),
): Promise<WorkspaceConnection> {
  const connection = await getOrCreateConnection(ctx, provider);
  if (connection.status === 'NOT_CONNECTED' || connection.status === 'DISCONNECTED') {
    requireWorkspaceWrite(ctx);
    return (await transitionConnection(ctx.workspaceId, connection.id, 'PREVIEWING', {
      traceId,
    })) as unknown as WorkspaceConnection;
  }
  return connection;
}

// ── Authorization ─────────────────────────────────────────────────────────────

/**
 * Authorizes a provider connection against the live provider API.
 *
 * A connection reaches AUTHORIZED only after the registered adapter verifies the
 * credential with the provider. On success the credential is stored in the
 * workspace-scoped vault and the connection receives the LEAST-PRIVILEGE grant
 * (READ + RECOMMEND). Provider scopes never widen that grant.
 *
 * @throws {ProviderError} ADAPTER_UNAVAILABLE | PERMISSION_DENIED | NEEDS_REAUTH |
 *   WRONG_ACCOUNT | PROVIDER_UNAVAILABLE
 * @throws {AccountSubstitutionError} When rebinding to a different provider account
 * @security Requires workspace write. Nothing is persisted until the provider accepts.
 */
export async function authorizeConnection(
  ctx: WorkspaceContext,
  provider: string,
  credential: string,
  config: Record<string, unknown> = {},
  traceId: string = newTraceId(),
  options: { refreshToken?: string | null; expiresInSeconds?: number | null; grantedScopes?: string[] } = {},
): Promise<{ connection: WorkspaceConnection; accounts: ProviderAccount[]; permissions: PermissionLevel[] }> {
  requireWorkspaceWrite(ctx);

  const connection = await getOrCreateConnection(ctx, provider);
  const adapter = getAdapter(provider); // throws ADAPTER_UNAVAILABLE before any state change

  await transitionConnection(ctx.workspaceId, connection.id, 'AUTHORIZING', { traceId });

  const adapterCtx: AdapterContext = {
    founderId:            ctx.actorId,
    credential,
    config,
    selectedResourceId:   null,
    selectedResourceName: null,
    traceId,
  };

  let identity: { externalAccountId: string; externalAccountName: string };
  let accounts: ProviderAccount[];
  try {
    identity = await adapter.verifyCredential(adapterCtx);
    accounts = await adapter.listAccounts(adapterCtx);
  } catch (err) {
    await recordProviderFailure(ctx, connection.id, err, traceId);
    throw err;
  }

  // Provider accepted the credential — store it in the workspace-scoped vault.
  let credentialId: string;
  try {
    const summary = await storeCredential({
      workspaceId:         ctx.workspaceId,
      connectionId:        connection.id,
      provider,
      accessToken:         credential,
      refreshToken:        options.refreshToken ?? null,
      credentialType:      options.refreshToken ? 'oauth2' : 'api_key',
      // Least privilege: the adapter's declared read scopes, or what the provider granted.
      scopes:              options.grantedScopes ?? [...adapter.readScopes],
      externalAccountId:   identity.externalAccountId,
      externalAccountName: identity.externalAccountName,
      expiresInSeconds:    options.expiresInSeconds ?? null,
      createdBy:           ctx.actorId,
    });
    credentialId = summary.id;
  } catch (err) {
    if (err instanceof AccountSubstitutionError) {
      await recordProviderFailure(
        ctx,
        connection.id,
        new ProviderError('WRONG_ACCOUNT', err.message),
        traceId,
      );
      throw err;
    }
    await recordProviderFailure(
      ctx,
      connection.id,
      new ProviderError('SYNC_FAILED', 'Could not securely store the credential.'),
      traceId,
    );
    throw err;
  }

  const authorized = (await transitionConnection(ctx.workspaceId, connection.id, 'AUTHORIZED', {
    traceId,
    extra: {
      credential_reference:  credentialId,
      connection_config:     config,
      external_account_id:   identity.externalAccountId,
      external_account_name: identity.externalAccountName,
      error_detail:          null,
    },
  })) as unknown as WorkspaceConnection;

  // Least-privilege grant, audited. Never derived from provider scopes.
  const permissions = await grantInitialPermissions(ctx, connection.id, provider, traceId);

  // Learning log: authorization alone taught LaunchMind nothing about the product yet,
  // so no confidence movement is claimed here. The sync that follows records that.
  await recordLearningEvent({
    workspaceId:  ctx.workspaceId,
    founderId:    connection.founder_id,
    productId:    connection.product_id,
    eventType:    'source_connected',
    trigger:      `${adapter.displayName} was connected as a read-only intelligence source`,
    provider,
    connectionId: connection.id,
    traceId,
    evidence:     [{ label: 'Access granted', value: permissions.join(' · ') }],
    previousState: 'Not connected',
    newState:      `Connected · ${identity.externalAccountName}`,
    createdByType: 'founder',
    createdBy:     ctx.actorId,
  });

  return { connection: { ...authorized, permissions_granted: permissions }, accounts, permissions };
}

/**
 * Moves a connection that needs re-authorization back into the authorization flow.
 * Historical signals are preserved and the permission grant is re-asserted unchanged —
 * reauthorizing never widens authority.
 * @security Requires workspace write.
 */
export async function beginReauthorization(
  ctx: WorkspaceContext,
  connectionId: string,
  traceId: string = newTraceId(),
): Promise<WorkspaceConnection> {
  requireWorkspaceWrite(ctx);

  const existing = await getConnection(ctx, connectionId);

  const updated = (await transitionConnection(ctx.workspaceId, connectionId, 'AUTHORIZING', {
    traceId,
    extra: { freshness_status: 'stale' },
  })) as unknown as WorkspaceConnection;

  await recordReauthorization(ctx, connectionId, traceId);

  await recordLearningEvent({
    workspaceId:  ctx.workspaceId,
    founderId:    existing.founder_id,
    productId:    existing.product_id,
    eventType:    'source_reauthorized',
    trigger:      `${providerLabel(existing.provider)} authorization was renewed`,
    provider:     existing.provider,
    connectionId,
    traceId,
    previousState: 'Authorization expired · data marked stale',
    newState:      'Re-authorizing · previously learned data preserved',
    createdByType: 'founder',
    createdBy:     ctx.actorId,
  });

  return updated;
}

/**
 * Lists the accounts the stored credential is authorized to read.
 * Calls the provider each time — there is no cached or synthesized list.
 * @throws {ProviderError} ADAPTER_UNAVAILABLE when the provider is not implemented
 */
export async function listProviderAccounts(
  ctx: WorkspaceContext,
  connectionId: string,
  traceId: string = newTraceId(),
): Promise<ProviderAccount[]> {
  const connection = await getConnection(ctx, connectionId);
  const adapter = getAdapter(connection.provider);
  const credential = await loadCredential(ctx, connection);

  return adapter.listAccounts({
    founderId:            ctx.actorId,
    credential,
    config:               connection.connection_config ?? {},
    selectedResourceId:   connection.selected_resource_id,
    selectedResourceName: connection.selected_resource_name,
    traceId,
  });
}

/**
 * Records the owner's chosen account/property and moves to SELECTING_SOURCE.
 * @security Requires workspace write.
 */
export async function selectResource(
  ctx: WorkspaceContext,
  connectionId: string,
  resourceId: string,
  resourceName: string,
  traceId: string = newTraceId(),
): Promise<WorkspaceConnection> {
  requireWorkspaceWrite(ctx);

  return (await transitionConnection(ctx.workspaceId, connectionId, 'SELECTING_SOURCE', {
    traceId,
    extra: {
      selected_resource_id:   resourceId,
      selected_resource_name: resourceName,
    },
  })) as unknown as WorkspaceConnection;
}

// ── Sync queueing (HTTP thread) ───────────────────────────────────────────────

/**
 * Creates a sync run and moves the connection to SYNC_QUEUED.
 * Performs no provider work — the caller enqueues a job and returns immediately.
 * @security Requires workspace write. The run row carries workspace_id so the
 *   worker can re-verify the tenant binding before writing anything.
 */
export async function triggerSync(
  ctx: WorkspaceContext,
  connectionId: string,
  traceId: string = newTraceId(),
): Promise<{ syncRunId: string; status: 'queued'; traceId: string }> {
  requireWorkspaceWrite(ctx);
  await transitionConnection(ctx.workspaceId, connectionId, 'SYNC_QUEUED', { traceId });

  const { data: syncRun, error } = await getSupabaseAdmin()
    .from('connection_sync_runs')
    .insert({
      connection_id: connectionId,
      workspace_id:  ctx.workspaceId,
      founder_id:    ctx.actorId,
      status:        'queued',
      progress:      0,
      trace_id:      traceId,
    })
    .select('id')
    .single();

  if (error || !syncRun) throw new Error(`Failed to create sync run: ${error?.message}`);
  return { syncRunId: (syncRun as { id: string }).id, status: 'queued', traceId };
}

/**
 * Returns the last 5 sync runs for a connection.
 * @security Scoped by connection_id AND workspace_id.
 */
export async function getSyncRuns(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<ConnectionSyncRun[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('connection_sync_runs')
    .select('*')
    .eq('connection_id', connectionId)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw new Error(`Failed to get sync runs: ${error.message}`);
  return (data ?? []) as ConnectionSyncRun[];
}

/** @returns The most recent sync run for a connection in this workspace, or null. */
export async function getLatestSyncRun(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<ConnectionSyncRun | null> {
  const { data } = await getSupabaseAdmin()
    .from('connection_sync_runs')
    .select('*')
    .eq('connection_id', connectionId)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data ?? null) as ConnectionSyncRun | null;
}

// ── Sync execution (worker thread only) ───────────────────────────────────────

/**
 * Executes one sync run: verifies the tenant binding, decrypts the credential,
 * calls the provider adapter, and persists what the provider actually returned.
 *
 * Called ONLY by connectionSyncWorker.
 *
 * @param workspaceId  - Tenant from the job payload, RE-VERIFIED here
 * @param actorId      - Founder attribution for credential-decrypt auditing
 * @throws {ProviderError} Re-thrown after state is recorded, so BullMQ can retry
 * @security
 *   - verifyJobWorkspaceBinding() runs first: a job whose workspace no longer owns
 *     the connection is refused, so a queued job cannot cross the tenant boundary
 *     after a membership or ownership change.
 *   - Every signal row is written with the verified workspace_id.
 */
/**
 * Owner-facing provider name, without assuming an adapter is registered.
 * getAdapter() throws for an unimplemented provider, and a log line is not worth
 * failing a disconnect over.
 */
function providerLabel(provider: string): string {
  try {
    return getAdapter(provider).displayName;
  } catch {
    return provider.replace(/_/g, ' ');
  }
}

/**
 * Derives freshness from the age of the last successful sync.
 *
 * The stored `freshness_status` column is set to 'fresh' at sync time and never
 * revisited, so on its own it would still claim "fresh" a month later. Freshness is
 * a function of elapsed time, so it is computed on read.
 *
 * @param lastSyncedAt - ISO timestamp of the last successful sync, or null
 * @param status       - Canonical connection state; an unhealthy connection is stale
 *                       regardless of when it last succeeded
 * @returns 'fresh' (<26h) · 'recent' (<3d) · 'stale' (<14d) · 'outdated' · 'unknown'
 */
export type FreshnessLevel = 'fresh' | 'recent' | 'stale' | 'outdated' | 'unknown';

/** Owner-facing wording. Never a bare colour or a raw enum value in the UI. */
export const FRESHNESS_LABELS: Record<FreshnessLevel, string> = {
  fresh:    'Up to date',
  recent:   'Updated recently',
  stale:    'Getting old',
  outdated: 'Out of date',
  unknown:  'Not synced yet',
};

export function computeFreshness(
  lastSyncedAt: string | null,
  status?: string,
): 'fresh' | 'recent' | 'stale' | 'outdated' | 'unknown' {
  if (!lastSyncedAt) return 'unknown';
  const ms = Date.now() - new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';

  // A connection that needs the owner's attention is not producing current data,
  // however recently it last succeeded.
  if (status && (ATTENTION_STATES as readonly string[]).includes(status)) {
    return ms < 14 * 864e5 ? 'stale' : 'outdated';
  }

  const hours = ms / 36e5;
  if (hours < 26)      return 'fresh';
  if (hours < 72)      return 'recent';
  if (hours < 24 * 14) return 'stale';
  return 'outdated';
}

/**
 * Narrows an insight's jsonb evidence to the { label, value } pairs the learning log
 * stores. Anything that does not match is dropped rather than stringified — a log
 * entry showing `[object Object]` is worse than one showing fewer numbers.
 */
function toLearningEvidence(raw: unknown): LearningEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { label, value } = item as { label?: unknown; value?: unknown };
    if (typeof label !== 'string') return [];
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    return [{ label, value }];
  });
}

export async function executeSync(
  syncRunId: string,
  connectionId: string,
  workspaceId: string,
  actorId: string,
  traceId: string,
): Promise<{
  status: 'completed' | 'partial';
  signalsImported: number;
  noHistory: boolean;
  insightsCreated: number;
}> {
  const db = getSupabaseAdmin();
  const trace = coerceTraceId(traceId);

  // Tenant re-verification BEFORE any work. Never trust the job payload alone.
  const bound = await verifyJobWorkspaceBinding(workspaceId, connectionId);
  if (!bound) {
    throw new ProviderError(
      'SYNC_FAILED',
      'This connection is no longer available in that workspace.',
    );
  }

  // Worker context: tenancy proven above; role checks do not apply to system work.
  const ctx: WorkspaceContext = { actorId, workspaceId, role: 'owner', isOwner: true };

  const connection = await getConnection(ctx, connectionId);
  const adapter = getAdapter(connection.provider);
  const steps = [...adapter.syncSteps];

  await transitionConnection(workspaceId, connectionId, 'SYNCING', { traceId: trace });
  await db
    .from('connection_sync_runs')
    .update({
      status:       'running',
      progress:     5,
      current_step: steps[0] ?? 'Starting',
      started_at:   new Date().toISOString(),
      trace_id:     trace,
    })
    .eq('id', syncRunId)
    .eq('workspace_id', workspaceId);

  /**
   * Writes real progress. Called by the adapter only after an actual provider call
   * has returned, so the bar never runs ahead of the work.
   */
  const reportProgress = async (update: { progress: number; step: string }) => {
    const completed = steps.slice(0, Math.max(1, steps.indexOf(update.step) + 1));
    await db
      .from('connection_sync_runs')
      .update({
        progress:        Math.min(99, Math.max(0, Math.round(update.progress))),
        current_step:    update.step,
        steps_completed: completed.length > 0 ? completed : [update.step],
      })
      .eq('id', syncRunId)
      .eq('workspace_id', workspaceId);
  };

  let result;
  try {
    const credential = await loadCredential(ctx, connection);
    result = await adapter.fetchSignals(
      {
        founderId:            actorId,
        credential,
        config:               connection.connection_config ?? {},
        selectedResourceId:   connection.selected_resource_id,
        selectedResourceName: connection.selected_resource_name,
        traceId:              trace,
      },
      reportProgress,
    );
  } catch (err) {
    await failSyncRun(ctx, syncRunId, connectionId, err, trace);
    throw err;
  }

  // Persist exactly what the provider returned — nothing is added or invented.
  if (result.signals.length > 0) {
    const { error: insertErr } = await db.from('intelligence_signals').upsert(
      result.signals.map((s) => ({
        workspace_id: workspaceId,
        founder_id:   connection.founder_id,
        product_id:   connection.product_id,
        provider:     connection.provider,
        signal_type:  s.signalType,
        signal_data:  s.signalData,
        period_start: s.periodStart,
        period_end:   s.periodEnd,
        synced_at:    new Date().toISOString(),
        trace_id:     trace,
      })),
      {
        // Must match the unique index in migration 087 exactly. It is keyed on
        // WORKSPACE, not founder: a founder may own several workspaces, and each
        // imports its own data for the same provider and period. Keying this on
        // founder_id silently discarded the second workspace's signals.
        onConflict: 'workspace_id,provider,signal_type,period_start,period_end',
        ignoreDuplicates: true,
      },
    );

    if (insertErr) {
      const wrapped = new ProviderError(
        'SYNC_FAILED',
        'Imported data could not be saved. No partial data was kept.',
        insertErr,
      );
      await failSyncRun(ctx, syncRunId, connectionId, wrapped, trace);
      throw wrapped;
    }
  }

  const noHistory = result.noHistory === true || result.signals.length === 0;
  const isPartial = result.partial === true;
  const completedAt = new Date().toISOString();
  const nextState: ConnectionState = noHistory ? 'NO_HISTORY' : isPartial ? 'PARTIAL' : 'HEALTHY';

  // Confidence BEFORE this sync's effect lands. Taken here — after the provider work
  // finished but before the state transition — so the comparison isolates what this
  // sync changed rather than including the time the sync took.
  const priorConfidence = result.signals.length > 0 ? await snapshotConfidence(ctx) : null;

  await db
    .from('connection_sync_runs')
    .update({
      status:           isPartial ? 'partial' : 'completed',
      progress:         100,
      current_step:     steps[steps.length - 1] ?? 'Complete',
      steps_completed:  steps,
      signals_imported: result.signals.length,
      error_message:    isPartial ? (result.partialReason ?? 'Some reports were unavailable.') : null,
      completed_at:     completedAt,
      trace_id:         trace,
    })
    .eq('id', syncRunId)
    .eq('workspace_id', workspaceId);

  await transitionConnection(workspaceId, connectionId, nextState, {
    traceId: trace,
    extra: {
      last_synced_at:   completedAt,
      freshness_status: 'fresh',
      error_detail:     isPartial ? (result.partialReason ?? null) : null,
    },
  });

  // Derive insights from what was actually persisted, then close the correlation
  // chain through to the learning event. Both are skipped when no data arrived —
  // a no-history sync taught LaunchMind nothing, so there is nothing to conclude.
  let insightsCreated = 0;
  let topInsight: { headline: string; detail: string; evidence: unknown } | null = null;
  if (result.signals.length > 0) {
    try {
      const { readSyncedSignals, deriveInsightsForProvider, persistInsights } =
        await import('./connectionInsightService');

      const persisted = await readSyncedSignals(workspaceId, connection.provider, trace);
      // Per-provider rules; a provider with no rules yet simply yields none.
      const derived = deriveInsightsForProvider(connection.provider, persisted);

      if (derived.length > 0) {
        topInsight = {
          headline: derived[0].headline,
          detail:   derived[0].detail,
          evidence: derived[0].evidence,
        };
        const stored = await persistInsights({
          workspaceId,
          connectionId,
          productId:   connection.product_id,
          provider:    connection.provider,
          syncRunId,
          traceId:     trace,
          reportName:  (result.signals[0]?.signalData?.report as string | null) ?? null,
          periodStart: result.signals[0]?.periodStart ?? null,
          periodEnd:   result.signals[0]?.periodEnd ?? null,
          insights:    derived,
        });
        insightsCreated = stored.length;
      }
    } catch (err) {
      // Insight derivation is downstream of the import. Losing it must not discard
      // signals the owner's provider genuinely returned.
      console.warn(`[connectionService] insight derivation failed trace=${trace}:`, (err as Error).message);
    }

    try {
      const { ingestLearningEvent } = await import('./learningPipelineService');
      await ingestLearningEvent(connection.founder_id, connection.product_id, 'analytics_synced', {
        trace_id:         trace,
        workspace_id:     workspaceId,
        provider:         connection.provider,
        connection_id:    connectionId,
        sync_run_id:      syncRunId,
        signals_imported: result.signals.length,
        insights_created: insightsCreated,
        partial:          isPartial,
      });
    } catch (err) {
      console.warn(`[connectionService] learning event failed trace=${trace}:`, (err as Error).message);
    }

    // The owner-facing learning log (spec §4.3). Distinct from the Marketing Memory
    // ingestion event above: this records what LaunchMind now believes and why.
    const newConfidence = await snapshotConfidence(ctx);
    const providerLabel = adapter.displayName;

    await recordLearningEvent({
      workspaceId,
      founderId:   connection.founder_id,
      productId:   connection.product_id,
      eventType:   'source_synced',
      trigger:     isPartial
        ? `${providerLabel} reported partial data — ${result.signals.length} signal${result.signals.length === 1 ? '' : 's'} imported`
        : `${providerLabel} reported ${result.signals.length} signal${result.signals.length === 1 ? '' : 's'}`,
      provider:    connection.provider,
      connectionId,
      syncRunId,
      traceId:     trace,
      // The numbers behind the conclusion, taken from the derived insight when one
      // exists. No insight means no evidence — the log says what was imported, and
      // makes no claim about what it means.
      evidence: topInsight
        ? toLearningEvidence(topInsight.evidence)
        : [{ label: 'Signals imported', value: result.signals.length }],
      previousState: insightsCreated > 0
        ? 'No observed data from this source'
        : `${connection.provider} not yet reporting`,
      newState: topInsight
        ? topInsight.headline
        : `${providerLabel} is reporting; no conclusion yet`,
      priorConfidence,
      newConfidence,
      createdByType: 'system',
    });
  }

  return {
    status:          isPartial ? 'partial' : 'completed',
    signalsImported: result.signals.length,
    noHistory,
    insightsCreated,
  };
}

// ── Disconnect and health ─────────────────────────────────────────────────────

/**
 * Disconnects a connection: revokes the credential, clears all granted authority,
 * and sets status=DISCONNECTED.
 *
 * Previously imported intelligence_signals are retained — the owner revoked future
 * access, not the history LaunchMind already learned from (spec §12.3).
 *
 * @security Requires workspace write. Credential row is kept with revoked_at set,
 *   for audit. Permission revocation is recorded in connection_permission_history.
 */
export async function disconnectConnection(
  ctx: WorkspaceContext,
  connectionId: string,
  traceId: string = newTraceId(),
): Promise<void> {
  requireWorkspaceWrite(ctx);
  const existing = await getConnection(ctx, connectionId); // tenancy check

  await revokeCredential(ctx.workspaceId, connectionId, 'Disconnected by workspace member');
  await revokeAllPermissions(ctx, connectionId, 'Connection disconnected', traceId);

  await transitionConnection(ctx.workspaceId, connectionId, 'DISCONNECTED', {
    traceId,
    extra: { freshness_status: 'unknown', credential_reference: null },
  });

  // Confidence is measured AFTER the transition: disconnecting genuinely lowers what
  // LaunchMind can observe, and the log should show that honestly rather than hide it.
  const after = await snapshotConfidence(ctx);

  await recordLearningEvent({
    workspaceId:  ctx.workspaceId,
    founderId:    existing.founder_id,
    productId:    existing.product_id,
    eventType:    'source_disconnected',
    trigger:      `${providerLabel(existing.provider)} was disconnected`,
    provider:     existing.provider,
    connectionId,
    traceId,
    previousState: 'Reporting observed data',
    newState:      'Disconnected · previously imported data retained, no new data arriving',
    // Only the post-state is known here, and a one-sided number would render as a
    // movement from zero. recordLearningEvent drops it unless both sides are present.
    newConfidence: after,
    createdByType: 'founder',
    createdBy:     ctx.actorId,
  });
}

/** Health summary for one connection, including non-secret credential metadata. */
export async function getConnectionHealth(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<{
  status: string;
  freshness: FreshnessLevel;
  /** Owner-facing sentence for the freshness level. */
  freshness_label: string;
  last_synced_at: string | null;
  signals_count: number;
  provider: string;
  adapter_available: boolean;
  needs_attention: boolean;
  permissions_granted: PermissionLevel[];
  credential_expires_at: string | null;
  external_account_name: string | null;
  selected_resource_name: string | null;
  latest_insight: {
    headline: string;
    detail: string;
    evidence: unknown;
    confidence: number | null;
    created_at: string;
  } | null;
}> {
  const connection = await getConnection(ctx, connectionId);

  const { count } = await getSupabaseAdmin()
    .from('intelligence_signals')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('provider', connection.provider);

  // Non-secret metadata only — no token material ever reaches a route.
  const credential = await getCredentialSummary(ctx.workspaceId, connectionId);

  const { getLiveInsights } = await import('./connectionInsightService');
  const insights = await getLiveInsights(ctx.workspaceId, { connectionId, limit: 1 });
  const latest = insights[0] ?? null;

  // Freshness is derived from the age of the last sync, not from the stored column,
  // which is only ever written at sync time and would still read "fresh" weeks later.
  const freshness = computeFreshness(connection.last_synced_at, connection.status);

  return {
    status:                connection.status,
    freshness,
    freshness_label:       FRESHNESS_LABELS[freshness],
    last_synced_at:        connection.last_synced_at,
    signals_count:         count ?? 0,
    provider:              connection.provider,
    adapter_available:     hasAdapter(connection.provider),
    needs_attention:       (ATTENTION_STATES as readonly string[]).includes(connection.status),
    permissions_granted:   normalizePermissions(connection.permissions_granted),
    credential_expires_at: credential?.expiresAt ?? null,
    external_account_name: credential?.externalAccountName ?? connection.external_account_name,
    selected_resource_name: connection.selected_resource_name,
    latest_insight: latest
      ? {
          headline:   latest.headline,
          detail:     latest.detail,
          evidence:   latest.evidence,
          confidence: latest.confidence,
          created_at: latest.created_at,
        }
      : null,
  };
}

/** @returns True when the connection is authorized and holding observed data. */
export function isConnectionHealthy(status: string): boolean {
  return (HEALTHY_STATES as readonly string[]).includes(status);
}

/** @returns True when the connection is mid-flight (authorized, no data yet). */
export function isConnectionInFlight(status: string): boolean {
  return (IN_FLIGHT_STATES as readonly string[]).includes(status);
}

/** Canonical per-provider state used by every owner-facing surface. */
export interface CanonicalConnectionState {
  provider:          string;
  status:            ConnectionState;
  healthy:           boolean;
  inFlight:          boolean;
  needsAttention:    boolean;
  noHistory:         boolean;
  lastSyncedAt:      string | null;
  /** Derived from the age of the last sync, not from a column written once. */
  freshness:         FreshnessLevel;
  /** Owner-facing sentence for the freshness level. */
  freshnessLabel:    string;
  signalCount:       number;
  adapterAvailable:  boolean;
  errorDetail:       string | null;
  /** Persisted grant. Never inferred from token scopes. */
  permissions:       PermissionLevel[];
}

/**
 * Returns canonical connection state for every modelled provider in this workspace.
 *
 * THE source of truth for "is this source connected". Callers must not infer state
 * from credential existence: a credential can exist while the connection is
 * NEEDS_REAUTH, SYNC_FAILED, or DISCONNECTED.
 *
 * @security Both queries are filtered by workspace_id.
 */
export async function getCanonicalConnectionStates(
  ctx: WorkspaceContext,
): Promise<Record<string, CanonicalConnectionState>> {
  const db = getSupabaseAdmin();

  const [connectionsRes, signalsRes] = await Promise.all([
    db
      .from('workspace_connections')
      .select('provider, status, last_synced_at, freshness_status, error_detail, permissions_granted')
      .eq('workspace_id', ctx.workspaceId),
    db
      .from('intelligence_signals')
      .select('provider')
      .eq('workspace_id', ctx.workspaceId),
  ]);

  const rows = (connectionsRes.data ?? []) as Array<{
    provider: string;
    status: string;
    last_synced_at: string | null;
    freshness_status: string | null;
    error_detail: string | null;
    permissions_granted: unknown;
  }>;

  const signalCounts = new Map<string, number>();
  for (const s of (signalsRes.data ?? []) as Array<{ provider: string }>) {
    signalCounts.set(s.provider, (signalCounts.get(s.provider) ?? 0) + 1);
  }

  const out: Record<string, CanonicalConnectionState> = {};
  for (const provider of KNOWN_PROVIDERS) {
    const row = rows.find((r) => r.provider === provider);
    const status = (row?.status ?? 'NOT_CONNECTED') as ConnectionState;

    out[provider] = {
      provider,
      status,
      healthy:          (HEALTHY_STATES as readonly string[]).includes(status),
      inFlight:         (IN_FLIGHT_STATES as readonly string[]).includes(status),
      needsAttention:   (ATTENTION_STATES as readonly string[]).includes(status),
      noHistory:        status === 'NO_HISTORY',
      lastSyncedAt:     row?.last_synced_at ?? null,
      freshness:        computeFreshness(row?.last_synced_at ?? null, status),
      freshnessLabel:   FRESHNESS_LABELS[computeFreshness(row?.last_synced_at ?? null, status)],
      signalCount:      signalCounts.get(provider) ?? 0,
      adapterAvailable: hasAdapter(provider),
      errorDetail:      row?.error_detail ?? null,
      permissions:      normalizePermissions(row?.permissions_granted),
    };
  }

  return out;
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Loads and decrypts the credential for a connection, refreshing it first when the
 * provider supports refresh and the stored token has expired.
 *
 * OAuth providers (GA4, Search Console) issue short-lived access tokens. Without this
 * an owner would be told to reconnect every hour even though LaunchMind holds a
 * perfectly good refresh token.
 *
 * @throws {ProviderError} NEEDS_REAUTH when absent, revoked, or unrefreshable
 * @security Plaintext is passed straight to the adapter and never persisted or logged.
 *   A rotated token is re-encrypted by the vault, which also re-checks the bound
 *   external account.
 */
async function loadCredential(
  ctx: WorkspaceContext,
  connection: WorkspaceConnection,
): Promise<string> {
  try {
    return await getAccessToken(ctx.workspaceId, connection.id, ctx.actorId);
  } catch (err) {
    if (!(err instanceof CredentialError)) throw err;

    // Only CREDENTIAL_REFRESH_REQUIRED is recoverable without the owner: it means the
    // access token expired but a refresh token is on file.
    if (err.code !== 'CREDENTIAL_REFRESH_REQUIRED') {
      throw new ProviderError('NEEDS_REAUTH', err.message);
    }

    const adapter = getAdapter(connection.provider);
    if (!adapter.refreshAuthorization) {
      throw new ProviderError('NEEDS_REAUTH', err.message);
    }

    const refreshToken = await getRefreshToken(ctx.workspaceId, connection.id, ctx.actorId);
    if (!refreshToken) throw new ProviderError('NEEDS_REAUTH', err.message);

    try {
      const rotated = await adapter.refreshAuthorization({
        founderId:            ctx.actorId,
        credential:           refreshToken,
        config:               { ...(connection.connection_config ?? {}), refresh_token: refreshToken },
        selectedResourceId:   connection.selected_resource_id,
        selectedResourceName: connection.selected_resource_name,
        traceId:              connection.last_trace_id ?? newTraceId(),
      });

      await rotateAccessToken({
        workspaceId:       ctx.workspaceId,
        connectionId:      connection.id,
        accessToken:       rotated.accessToken,
        refreshToken:      rotated.refreshToken,
        expiresInSeconds:  rotated.expiresInSeconds,
      });

      return rotated.accessToken;
    } catch (refreshErr) {
      // Count the failure so repeated refresh problems escalate rather than retry forever.
      await recordRefreshFailure(ctx.workspaceId, connection.id).catch(() => undefined);
      if (refreshErr instanceof ProviderError) throw refreshErr;
      throw new ProviderError(
        'NEEDS_REAUTH',
        'This source needs to be reconnected — its authorization could not be renewed.',
      );
    }
  }
}

/**
 * Records a provider failure on the connection without destroying prior data.
 * @security Only ProviderError.ownerMessage reaches error_detail. Raw provider
 *   responses and stack traces are never persisted or surfaced.
 */
async function recordProviderFailure(
  ctx: WorkspaceContext,
  connectionId: string,
  err: unknown,
  traceId: string,
): Promise<void> {
  const kind = err instanceof ProviderError ? err.kind : 'SYNC_FAILED';
  const ownerMessage =
    err instanceof ProviderError
      ? err.ownerMessage
      : 'Something went wrong reaching this provider. Nothing was changed in your account.';

  try {
    await transitionConnection(
      ctx.workspaceId,
      connectionId,
      ERROR_KIND_TO_STATE[kind] ?? 'SYNC_FAILED',
      { traceId, extra: { error_detail: ownerMessage, freshness_status: 'stale' } },
    );
  } catch {
    // A blocked transition must not mask the original provider error.
  }
}

/** Marks a sync run failed and moves the connection to its recovery state. */
async function failSyncRun(
  ctx: WorkspaceContext,
  syncRunId: string,
  connectionId: string,
  err: unknown,
  traceId: string,
): Promise<void> {
  const ownerMessage =
    err instanceof ProviderError
      ? err.ownerMessage
      : 'The sync could not be completed. Your existing intelligence is unchanged.';

  await getSupabaseAdmin()
    .from('connection_sync_runs')
    .update({
      status:        'failed',
      error_message: ownerMessage,
      completed_at:  new Date().toISOString(),
      trace_id:      traceId,
    })
    .eq('id', syncRunId)
    .eq('workspace_id', ctx.workspaceId);

  await recordProviderFailure(ctx, connectionId, err, traceId);
}
