/**
 * @file revenueCatAdapter.ts
 * @description RevenueCat observation adapter (subscription and retention intelligence).
 *
 *   Authentication: RevenueCat v2 REST API with a secret API key
 *   (`Authorization: Bearer sk_...`). RevenueCat does not offer OAuth for server
 *   integrations, so a scoped secret key created in the RevenueCat dashboard is the
 *   supported production mechanism.
 *
 *   Data path (all real v2 endpoints):
 *     GET /v2/projects                             authorization + project list
 *     GET /v2/projects/{id}/metrics/overview       the metric set RevenueCat publishes
 *
 *   Everything emitted is a metric RevenueCat actually returned. LTV is deliberately
 *   NOT emitted from the overview endpoint: it exposes no churn rate, and an LTV
 *   computed without one would be a guess wearing a number's clothes. ARPU is emitted
 *   instead because MRR ÷ active subscriptions is exact.
 *
 * @security Read-only: the adapter issues GET requests only and exposes no method
 *   that could mutate offerings, entitlements, or customers.
 * @dependencies providers/http, providers/types
 */

import {
  providerRequest, toNum, isoDaysAgo, isoToday,
} from './http';
import {
  ProviderError,
  type AdapterContext,
  type ProgressReporter,
  type ProviderAccount,
  type ProviderAdapter,
  type ProviderHealth,
  type ProviderSignal,
  type SyncResult,
} from './types';

const API = 'https://api.revenuecat.com/v2';
const NAME = 'RevenueCat';

const SYNC_STEPS = [
  'Authorization verified',
  'Project selected',
  'Reading subscription history',
  'Mapping trial to paid',
  'Measuring retention',
  'Deriving revenue per subscriber',
  'Updating Growth Brain',
] as const;

/** One entry from RevenueCat's metrics overview. */
interface RcMetric {
  id?:            string;
  name?:          string;
  value?:         number | string;
  unit?:          string;
  period?:        string;
  last_updated_at?: string | number;
}

interface RcProject { id: string; name?: string }

/** Indexes the overview response by metric id for lookup. */
function indexMetrics(metrics: RcMetric[]): Map<string, RcMetric> {
  const map = new Map<string, RcMetric>();
  for (const m of metrics) {
    if (typeof m.id === 'string') map.set(m.id, m);
  }
  return map;
}

/** Reads a numeric metric by id, or null when RevenueCat did not report it. */
function metricValue(index: Map<string, RcMetric>, id: string): number | null {
  const m = index.get(id);
  return m ? toNum(m.value) : null;
}

function request<T>(path: string, credential: string): Promise<T> {
  return providerRequest<T>(`${API}${path}`, { providerName: NAME, bearer: credential });
}

export const revenueCatAdapter: ProviderAdapter = {
  key:           'revenue_cat',
  displayName:   NAME,
  authMechanism: 'api_key',
  resourceNoun:  'project',
  readScopes:    ['revenue_cat.projects.read', 'revenue_cat.metrics.read'],
  syncSteps:     SYNC_STEPS,

  /**
   * Proves the key by listing projects.
   * @returns The first project id as the account identity — a RevenueCat secret key
   *   is scoped to one account, so this is the stable substitution guard.
   */
  async verifyCredential(ctx: AdapterContext) {
    const body = await request<{ items?: RcProject[] }>('/projects?limit=20', ctx.credential);
    const projects = body.items ?? [];

    if (projects.length === 0) {
      throw new ProviderError(
        'PERMISSION_DENIED',
        'This RevenueCat key cannot see any projects. Check that it is a secret key with read access to the project you want LaunchMind to learn from.',
      );
    }

    return {
      externalAccountId:   projects[0].id,
      externalAccountName: projects.length === 1
        ? `RevenueCat · ${projects[0].name ?? projects[0].id}`
        : 'RevenueCat',
    };
  },

  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const body = await request<{ items?: RcProject[] }>('/projects?limit=100', ctx.credential);
    return (body.items ?? []).map(p => ({ id: p.id, name: p.name ?? p.id }));
  },

  /** Confirms the selected project is still readable by this key. */
  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const body = await request<{ items?: RcProject[] }>('/projects?limit=100', ctx.credential);
    const match = (body.items ?? []).find(p => p.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That RevenueCat project is no longer visible to this key. Choose a different project or reconnect.',
      );
    }
    return { id: match.id, name: match.name ?? match.id };
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await request('/projects?limit=1', ctx.credential);
      return { reachable: true, authorized: true, detail: null, checkedAt };
    } catch (err) {
      if (err instanceof ProviderError) {
        const authProblem = err.kind === 'NEEDS_REAUTH' || err.kind === 'PERMISSION_DENIED';
        return {
          reachable:  err.kind !== 'PROVIDER_UNAVAILABLE',
          authorized: !authProblem,
          detail:     err.ownerMessage,
          checkedAt,
        };
      }
      return { reachable: false, authorized: false, detail: 'Health check failed.', checkedAt };
    }
  },

  /**
   * Imports subscription and retention metrics.
   *
   * RevenueCat's overview endpoint reports a fixed metric set. Each signal is emitted
   * only when the corresponding metric is genuinely present, so a project that has
   * never had a trial produces no trial signal rather than a zero that reads as
   * "measured zero".
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await request('/projects?limit=1', ctx.credential);
    await emit(10, SYNC_STEPS[0]);

    const projectId = ctx.selectedResourceId;
    if (!projectId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No RevenueCat project is selected for this connection. Choose the project LaunchMind should learn from.',
      );
    }
    await this.validateSelection?.(ctx, projectId);
    await emit(22, SYNC_STEPS[1]);

    const overview = await request<{ metrics?: RcMetric[] }>(
      `/projects/${encodeURIComponent(projectId)}/metrics/overview`,
      ctx.credential,
    );
    const metrics = overview.metrics ?? [];
    await emit(45, SYNC_STEPS[2]);

    // RevenueCat reports rolling windows rather than a caller-chosen range. The
    // 28-day window matches the endpoint's own reporting period.
    const periodStart = isoDaysAgo(28);
    const periodEnd   = isoToday();
    const index = indexMetrics(metrics);

    const activeTrials  = metricValue(index, 'active_trials');
    const activeSubs    = metricValue(index, 'active_subscriptions');
    const mrr           = metricValue(index, 'mrr');
    const revenue28d    = metricValue(index, 'revenue');
    const newCustomers  = metricValue(index, 'new_customers');
    const activeUsers   = metricValue(index, 'active_users');

    const signals: ProviderSignal[] = [];
    const provenanceBase = { source: 'RevenueCat metrics overview', project_id: projectId };

    if (activeTrials !== null) {
      signals.push({
        signalType: 'trials',
        signalData: { ...provenanceBase, active_trials: activeTrials, metric_id: 'active_trials' },
        periodStart, periodEnd,
      });
    }
    await emit(58, SYNC_STEPS[3]);

    // Trial-to-paid is emitted only when BOTH sides are present. A conversion rate
    // computed against a missing denominator would be fiction.
    if (activeTrials !== null && activeSubs !== null && activeTrials + activeSubs > 0) {
      signals.push({
        signalType: 'retention',
        signalData: {
          ...provenanceBase,
          active_trials: activeTrials,
          active_subscriptions: activeSubs,
          trial_share: activeTrials / (activeTrials + activeSubs),
          computed_from: 'active trials ÷ (active trials + active subscriptions)',
          metric_ids: ['active_trials', 'active_subscriptions'],
        },
        periodStart, periodEnd,
      });
    }
    await emit(70, SYNC_STEPS[4]);

    if (activeSubs !== null) {
      signals.push({
        signalType: 'churn',
        signalData: {
          ...provenanceBase,
          active_subscriptions: activeSubs,
          active_users: activeUsers,
          new_customers: newCustomers,
          // RevenueCat's overview exposes no churn rate, so none is claimed.
          churn_rate: null,
          note: 'RevenueCat does not report a churn rate on this endpoint; LaunchMind records the subscriber counts it does report.',
          metric_ids: ['active_subscriptions', 'active_users', 'new_customers'],
        },
        periodStart, periodEnd,
      });
    }

    if (mrr !== null) {
      signals.push({
        signalType: 'mrr',
        signalData: { ...provenanceBase, value_usd: mrr, metric_id: 'mrr' },
        periodStart, periodEnd,
      });
    }

    if (revenue28d !== null) {
      signals.push({
        signalType: 'revenue',
        signalData: { ...provenanceBase, value_usd: revenue28d, window_days: 28, metric_id: 'revenue' },
        periodStart, periodEnd,
      });
    }

    // ARPU is exact when both inputs exist. LTV is NOT emitted: it needs a churn rate
    // this endpoint does not provide, and an invented one would be indefensible.
    if (mrr !== null && activeSubs !== null && activeSubs > 0) {
      signals.push({
        signalType: 'ltv',
        signalData: {
          ...provenanceBase,
          arpu_usd: mrr / activeSubs,
          mrr_usd: mrr,
          active_subscriptions: activeSubs,
          ltv_usd: null,
          computed_from: 'MRR ÷ active subscriptions',
          note: 'LTV requires a churn rate, which RevenueCat does not expose on this endpoint. Monthly revenue per subscriber is reported instead.',
        },
        periodStart, periodEnd,
      });
    }
    await emit(88, SYNC_STEPS[5]);
    await emit(96, SYNC_STEPS[6]);

    // A brand-new project returns the metric shape with nothing behind it.
    if (signals.length === 0) return { signals: [], noHistory: true };

    // The endpoint publishes a known metric set; missing entries mean this project
    // has not produced that metric yet.
    const expected = ['active_trials', 'active_subscriptions', 'mrr', 'revenue'];
    const absent = expected.filter(id => !index.has(id));
    const partial = absent.length > 0;

    return {
      signals,
      partial,
      partialReason: partial
        ? `RevenueCat has not reported ${absent.join(', ')} for this project yet, so those parts of the picture are still missing.`
        : undefined,
    };
  },

  /** RevenueCat keys are revoked in their dashboard, not through the API. */
  async revokeAtProvider(): Promise<boolean> {
    return false;
  },
};
