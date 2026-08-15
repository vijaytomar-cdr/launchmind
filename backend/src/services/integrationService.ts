/**
 * @file integrationService.ts
 * @description Integration framework — connect, disconnect, and list integrations
 *   beyond the original OAuth channels (ADR-014).
 *   Supports: ga4 (api_key), firebase (service_account), search_console (oauth),
 *   website (url_only), plus existing meta/google/whatsapp/linkedin/email.
 * @security
 *   - Credentials (API keys, service accounts) encrypted via tokenVault AES-256 + KMS.
 *   - encrypted_token NEVER returned to frontend.
 *   - integration_config IS returned (non-secret metadata only).
 * @dependencies tokenVault, supabaseAdmin, audit_logs
 */

import { encryptToken } from '../lib/tokenVault';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export type IntegrationType = 'oauth' | 'api_key' | 'service_account' | 'url_only';
export type IntegrationPlatform =
  | 'meta' | 'google' | 'whatsapp' | 'linkedin' | 'email'
  | 'ga4' | 'firebase' | 'search_console' | 'website'
  | 'app_store_connect' | 'revenue_cat' | 'google_ads' | 'meta_ads';

export interface IntegrationStatus {
  platform:          IntegrationPlatform;
  integration_type:  IntegrationType | null;
  integration_config: Record<string, unknown> | null;
  connected:         boolean;
  scopes:            string[];
  expires_at:        string | null;
  revoked_at:        string | null;
  created_at:        string;
}

/**
 * Connects an API-key-based integration (GA4, Firebase).
 * Encrypts the key and stores integration_config metadata.
 */
export async function connectApiKeyIntegration(opts: {
  founderId:         string;
  platform:          IntegrationPlatform;
  apiKey:            string;
  integrationConfig: Record<string, unknown>;
  scopes?:           string[];
}): Promise<{ id: string }> {
  const { founderId, platform, apiKey, integrationConfig, scopes = [] } = opts;

  const { ciphertext: encryptedToken, kmsKeyId } = await encryptToken(apiKey);

  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .upsert(
      {
        founder_id:         founderId,
        platform,
        encrypted_token:    encryptedToken,
        kms_key_id:         kmsKeyId,
        scopes,
        integration_type:   'api_key',
        integration_config: integrationConfig,
        revoked_at:         null,
      },
      { onConflict: 'founder_id,platform' },
    )
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Upsert failed');

  // Audit log
  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id:    founderId,
    action:        'integration.connected',
    resource_type: 'platform_token',
    resource_id:   data.id,
    metadata:      { platform, integration_type: 'api_key' },
  });

  return data;
}

/**
 * Connects a URL-only integration (website).
 * No credentials — URL stored in integration_config.
 */
export async function connectUrlIntegration(opts: {
  founderId:         string;
  url:               string;
  integrationConfig?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const { founderId, url, integrationConfig = {} } = opts;

  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .upsert(
      {
        founder_id:         founderId,
        platform:           'website' as IntegrationPlatform,
        encrypted_token:    'url_only',    // placeholder — no real token
        kms_key_id:         'none',
        scopes:             [],
        integration_type:   'url_only',
        integration_config: { url, ...integrationConfig },
        revoked_at:         null,
      },
      { onConflict: 'founder_id,platform' },
    )
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Upsert failed');

  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id:    founderId,
    action:        'integration.connected',
    resource_type: 'platform_token',
    resource_id:   data.id,
    metadata:      { platform: 'website', url },
  });

  return data;
}

/**
 * Disconnects an integration (sets revoked_at — row preserved for audit).
 */
export async function disconnectIntegration(
  founderId: string,
  platform: IntegrationPlatform,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('founder_id', founderId)
    .eq('platform', platform)
    .is('revoked_at', null);

  if (error) throw error;

  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id:    founderId,
    action:        'integration.disconnected',
    resource_type: 'platform_token',
    metadata:      { platform },
  });
}

/**
 * Lists all integration statuses for a founder.
 * NEVER returns encrypted_token or kms_key_id.
 */
export async function listIntegrations(founderId: string): Promise<IntegrationStatus[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select(
      'platform, integration_type, integration_config, scopes, expires_at, revoked_at, created_at',
    )
    .eq('founder_id', founderId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map(row => ({
    platform:           row.platform as IntegrationPlatform,
    integration_type:   (row.integration_type ?? null) as IntegrationType | null,
    integration_config: (row.integration_config ?? null) as Record<string, unknown> | null,
    connected:          !row.revoked_at,
    scopes:             row.scopes ?? [],
    expires_at:         row.expires_at ?? null,
    revoked_at:         row.revoked_at ?? null,
    created_at:         row.created_at,
  }));
}

/**
 * Helper: checks if a specific platform is connected and not revoked.
 */
export async function isIntegrationConnected(
  founderId: string,
  platform: IntegrationPlatform,
): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select('id')
    .eq('founder_id', founderId)
    .eq('platform', platform)
    .is('revoked_at', null)
    .single();

  return !!data;
}

export interface Phase2ConnectionStatus {
  connected:   boolean;
  connectedAt: string | null;
  syncStatus:  'pending' | 'synced' | 'error' | null;
}

export interface Phase2Connections {
  app_store_connect: Phase2ConnectionStatus;
  revenue_cat:       Phase2ConnectionStatus;
  google_analytics:  Phase2ConnectionStatus;
  google_ads:        Phase2ConnectionStatus;
  meta_ads:          Phase2ConnectionStatus;
  connectedCount:    number;
}

export type MilestoneState  = 'done' | 'current' | 'pending';
export type StatusSeverity  = 'active' | 'warning' | 'muted';

export interface RoadmapLevelStatus {
  label:    string;
  severity: StatusSeverity;
  active:   boolean;
}

export type ProductPlatform   = 'app_store' | 'play_store' | 'both';
export type RecommendedSource = 'app_store_connect' | 'revenue_cat' | 'ga4';

export interface CapabilityStatus {
  level:           number;
  levelName:       string;
  confidence:      number;
  evidenceLabel:   string;
  completedSteps:  string[];
  nextStep:        string;
  activeGoal:      string | null;
  productPlatform: ProductPlatform;
  recommendedFirst: RecommendedSource;
  milestoneStates: {
    discovery:     MilestoneState;
    alignment:     MilestoneState;
    intelligence:  MilestoneState;
    execution:     MilestoneState;
    autonomy:      MilestoneState;
  };
  roadmapStatuses: {
    level1:  RoadmapLevelStatus;
    level2:  RoadmapLevelStatus;
    level3:  RoadmapLevelStatus;
    level45: RoadmapLevelStatus;
  };
  proofChecks: {
    sourceConnected:  boolean;
    syncComplete:     boolean;
    insightDelivered: boolean;
  };
  connections: Phase2Connections;
}

/**
 * Nothing connected. syncStatus is explicitly null — "never synced" — rather than
 * omitted: a missing field would have every consumer fall back to its own default,
 * and 'pending' vs null is the difference between "working on it" and "no source".
 */
const NOT_CONNECTED: Phase2ConnectionStatus = {
  connected: false, connectedAt: null, syncStatus: null,
};

const EMPTY_CONNECTIONS: Phase2Connections = {
  app_store_connect: { ...NOT_CONNECTED },
  revenue_cat:       { ...NOT_CONNECTED },
  google_analytics:  { ...NOT_CONNECTED },
  google_ads:        { ...NOT_CONNECTED },
  meta_ads:          { ...NOT_CONNECTED },
  connectedCount:    0,
};

const LEVEL_NAMES = ['', 'Public Intelligence', 'Observed Performance', 'Cross-channel Intelligence', 'Execution', 'Autonomy'];

/**
 * Returns the full Growth Brain capability status for the Capability Unlocks page.
 * Aggregates connections, onboarding progress, active goal, and computed level/confidence
 * in a single round-trip. All sub-queries use Promise.allSettled — partial failures degrade
 * gracefully to safe defaults (missing migrations, unset env vars, etc.).
 */
export async function getCapabilityStatus(founderId: string): Promise<CapabilityStatus> {
  // Resolved FIRST so the goal below can be scoped to the same product this
  // function already reports on. Previously the product was "the newest
  // non-archived one" while the goal was "the newest for this founder" — two
  // independent picks that, for a founder with two businesses, routinely named
  // one product and stated the other's goal.
  const { data: activeProducts } = await getSupabaseAdmin()
    .from('products')
    .select('id, platform')
    .eq('founder_id', founderId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const activeProductId = (activeProducts?.[0] as { id?: string } | undefined)?.id ?? null;

  const [connectionsResult, founderResult, goalsResult, insightResult, productResult, onboardingResult] = await Promise.allSettled([
    getPhase2Connections(founderId),
    getSupabaseAdmin()
      .from('founders')
      .select('onboarding_step')
      .eq('id', founderId)
      .single(),
    activeProductId ? getSupabaseAdmin()
      .from('business_goals')
      .select('goal_type, target_value, unit, time_horizon_days')
      .eq('product_id', activeProductId)
      .order('created_at', { ascending: false })
      .limit(1)
      // No product means no goal to report — stating another business's target
      // on this product's capability page is worse than stating none.
      : Promise.resolve({ data: [] }),
    getSupabaseAdmin()
      .from('optimization_insights')
      .select('id', { count: 'exact', head: true })
      .eq('founder_id', founderId),
    getSupabaseAdmin()
      .from('products')
      .select('platform')
      .eq('founder_id', founderId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
    // Check if founder completed the Phase 1 onboarding session flow
    getSupabaseAdmin()
      .from('onboarding_sessions')
      .select('current_state')
      .eq('founder_id', founderId)
      .eq('current_state', 'PHASE_1_COMPLETE')
      .limit(1),
  ]);

  const connections      = connectionsResult.status === 'fulfilled' ? connectionsResult.value : EMPTY_CONNECTIONS;
  const founderStep      = founderResult.status === 'fulfilled' ? (founderResult.value.data?.onboarding_step ?? 0) : 0;
  const hasPhase1Done    = onboardingResult.status === 'fulfilled' && (onboardingResult.value.data?.length ?? 0) > 0;
  // Treat PHASE_1_COMPLETE as equivalent to onboarding_step=6 for users who completed the new flow
  const onboardingStep   = hasPhase1Done ? Math.max(founderStep, 6) : founderStep;
  const goals          = goalsResult.status === 'fulfilled' ? (goalsResult.value.data ?? []) : [];
  const insightCount   = insightResult.status === 'fulfilled' ? (insightResult.value.count ?? 0) : 0;
  const productRow     = productResult.status === 'fulfilled' ? (productResult.value.data?.[0] ?? null) : null;

  // productPlatform: single product → use its platform; no product → default app_store
  const productPlatform: ProductPlatform = productRow?.platform === 'play_store' ? 'play_store' : 'app_store';

  // Level: based on observation connections (App Store Connect, RevenueCat, GA4)
  const observeCount  = [
    connections.app_store_connect.connected,
    connections.revenue_cat.connected,
    connections.google_analytics.connected,
  ].filter(Boolean).length;
  const executeCount = [
    connections.google_ads.connected,
    connections.meta_ads.connected,
  ].filter(Boolean).length;

  let level = 1;
  if (observeCount >= 3 && executeCount >= 1) level = 4;
  else if (observeCount >= 3)                 level = 3;
  else if (observeCount >= 1)                 level = 2;

  // Confidence: 20% base → 62% at completed onboarding → +10% per observation source → cap 95%
  const baseConfidence = Math.min(62, 20 + onboardingStep * 7);
  const confidence     = Math.min(95, baseConfidence + observeCount * 10 + executeCount * 5);

  const evidenceLabel = connections.connectedCount === 0
    ? 'Public evidence only'
    : connections.connectedCount === 1
      ? '1 private source connected'
      : `${connections.connectedCount} private sources connected`;

  // Completed steps derived from onboarding progress
  const completedSteps: string[] = [];
  if (onboardingStep >= 1) completedSteps.push('Product understood');
  if (onboardingStep >= 4) completedSteps.push('Goal learned');
  if (onboardingStep >= 6) completedSteps.push('Boundaries saved');

  const nextStep = connections.connectedCount === 0
    ? 'observed performance'
    : executeCount === 0 ? 'execution channels' : 'autonomy';

  // Active goal — format structured goal data into readable string
  let activeGoal: string | null = null;
  const goal = goals[0] ?? null;
  if (goal) {
    const parts: string[] = [goal.goal_type ?? 'active goal'];
    if (goal.target_value != null) {
      parts.push(`to ${goal.target_value}`);
      if (goal.unit) parts.push(goal.unit);
    }
    if (goal.time_horizon_days) {
      const d = Number(goal.time_horizon_days);
      parts.push(`in ${d} day${d !== 1 ? 's' : ''}`);
    }
    activeGoal = parts.join(' ');
  }

  // Milestone states: reflect onboarding completion + connection activity
  const milestoneStates = {
    discovery:    (onboardingStep >= 3 ? 'done' : onboardingStep >= 1 ? 'current' : 'pending') as MilestoneState,
    alignment:    (onboardingStep >= 6 ? 'done' : onboardingStep >= 3 ? 'current' : 'pending') as MilestoneState,
    intelligence: (observeCount >= 3 ? 'done' : onboardingStep >= 6 ? 'current' : 'pending')   as MilestoneState,
    execution:    (executeCount >= 1 ? 'current' : 'pending')                                   as MilestoneState,
    autonomy:     'pending' as MilestoneState,
  };

  // Roadmap level statuses
  const roadmapStatuses = {
    level1:  { label: 'Active',                                          severity: 'active'  as StatusSeverity, active: true                },
    level2:  { label: observeCount >= 1 ? 'Active' : 'Connect one source', severity: (observeCount >= 1 ? 'active' : 'warning') as StatusSeverity, active: observeCount >= 1  },
    level3:  { label: observeCount >= 3 ? 'Active' : 'When execution begins', severity: (observeCount >= 3 ? 'active' : 'muted') as StatusSeverity, active: observeCount >= 3 },
    level45: { label: 'Future phases',                                   severity: 'muted'   as StatusSeverity, active: false               },
  };

  // Proof checks
  const anyConnSynced = [
    connections.app_store_connect,
    connections.revenue_cat,
    connections.google_analytics,
    connections.google_ads,
    connections.meta_ads,
  ].some(c => c.connected && c.syncStatus === 'synced');

  const proofChecks = {
    sourceConnected:  connections.connectedCount > 0,
    syncComplete:     anyConnSynced,
    insightDelivered: insightCount > 0,
  };

  // recommendedFirst: skip already-connected platforms; respect product platform
  const recommendedFirst: RecommendedSource = (() => {
    if (productPlatform === 'play_store') {
      // No App Store Connect for Play Store apps
      if (!connections.revenue_cat.connected)      return 'revenue_cat';
      if (!connections.google_analytics.connected) return 'ga4';
      return 'revenue_cat';
    }
    // app_store or both
    if (!connections.app_store_connect.connected)  return 'app_store_connect';
    if (!connections.revenue_cat.connected)        return 'revenue_cat';
    if (!connections.google_analytics.connected)   return 'ga4';
    return 'app_store_connect';
  })();

  return {
    level,
    levelName:       LEVEL_NAMES[level],
    confidence,
    evidenceLabel,
    completedSteps,
    nextStep,
    activeGoal,
    productPlatform,
    recommendedFirst,
    milestoneStates,
    roadmapStatuses,
    proofChecks,
    connections,
  };
}

/**
 * Returns connection status for all Phase 2 Capability Unlock sources.
 * Maps platform_tokens rows to a structured status object.
 * NEVER returns encrypted_token or kms_key_id.
 */
export async function getPhase2Connections(founderId: string): Promise<Phase2Connections> {
  const PHASE2_PLATFORMS = ['app_store_connect', 'revenue_cat', 'ga4', 'google_ads', 'meta_ads'] as const;

  const { data } = await getSupabaseAdmin()
    .from('platform_tokens')
    .select('platform, revoked_at, created_at, sync_status')
    .eq('founder_id', founderId)
    .in('platform', PHASE2_PLATFORMS as unknown as string[]);

  const rows = data ?? [];

  const byPlatform = (p: string): Phase2ConnectionStatus => {
    const row = rows.find(r => r.platform === p && !r.revoked_at);
    return {
      connected:   !!row,
      connectedAt: row?.created_at ?? null,
      syncStatus:  (row?.sync_status as 'pending' | 'synced' | 'error' | null) ?? null,
    };
  };

  const statuses = {
    app_store_connect: byPlatform('app_store_connect'),
    revenue_cat:       byPlatform('revenue_cat'),
    google_analytics:  byPlatform('ga4'),
    google_ads:        byPlatform('google_ads'),
    meta_ads:          byPlatform('meta_ads'),
  };

  const connectedCount = Object.values(statuses).filter(s => s.connected).length;

  return { ...statuses, connectedCount };
}
