/**
 * @file ga4Adapter.ts
 * @description Google Analytics 4 observation adapter (journey intelligence).
 *
 *   Authentication: Google OAuth 2.0 with `analytics.readonly`, run through the
 *   canonical oauthService (state + PKCE + single-use), configured in oauthConfig.ts.
 *   The stored credential is the access token; refreshAuthorization exchanges the
 *   refresh token when it expires.
 *
 *   Data path (real Google endpoints):
 *     GET  analyticsadmin/v1beta/accountSummaries         property enumeration
 *     POST analyticsdata/v1beta/properties/{id}:runReport sessions, landing pages,
 *                                                         source/medium, events
 *
 * @security Read-only scope; every call is a report read. The adapter has no method
 *   that can modify a property, a stream, or a conversion definition.
 * @dependencies providers/http, providers/oauthConfig, oauthService, providers/types
 */

import { providerRequest, toNum, isoDaysAgo, isoToday, groupAndSum, breakdownPayload } from './http';
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

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA  = 'https://analyticsdata.googleapis.com/v1beta';
const NAME  = 'Google Analytics';

/** Reporting window. GA4 keeps standard reports well beyond this. */
const WINDOW_DAYS = 28;

const SYNC_STEPS = [
  'Authorization verified',
  'Property selected',
  'Reading sessions and events',
  'Mapping landing pages',
  'Building conversion journey',
  'Detecting drop-off',
  'Updating Growth Brain',
] as const;

/** One row of a GA4 runReport response. */
interface Ga4Row {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?:    Array<{ value?: string }>;
}

interface Ga4Report {
  rows?: Ga4Row[];
  rowCount?: number;
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?:    Array<{ name?: string }>;
}

/** Google returns 401 for an expired token and 403 for a missing scope. */
function classify(status: number): null {
  void status;
  return null; // the shared status mapping is already correct for Google
}

async function runReport(
  propertyId: string,
  credential: string,
  body: Record<string, unknown>,
): Promise<Ga4Report> {
  return providerRequest<Ga4Report>(
    `${DATA}/properties/${encodeURIComponent(propertyId)}:runReport`,
    { providerName: NAME, bearer: credential, method: 'POST', json: body, classifyError: classify },
  );
}

/** Extracts (dimension, metric) pairs from a report, tolerating absent cells. */
function rowsOf(report: Ga4Report): Array<{ dims: string[]; metrics: number[] }> {
  return (report.rows ?? []).map(r => ({
    dims:    (r.dimensionValues ?? []).map(d => (d.value ?? '').trim()),
    metrics: (r.metricValues ?? []).map(m => toNum(m.value) ?? 0),
  }));
}

/** Sums a metric column across every row. */
function sumMetric(report: Ga4Report, index = 0): number {
  return rowsOf(report).reduce((acc, r) => acc + (r.metrics[index] ?? 0), 0);
}

const DATE_RANGE = { startDate: `${WINDOW_DAYS}daysAgo`, endDate: 'today' };

export const ga4Adapter: ProviderAdapter = {
  key:           'ga4',
  displayName:   NAME,
  authMechanism: 'oauth2',
  resourceNoun:  'property',
  readScopes:    ['https://www.googleapis.com/auth/analytics.readonly'],
  syncSteps:     SYNC_STEPS,

  /**
   * Proves the token by listing account summaries.
   * @returns The Google account summary name as identity — stable across token
   *   refreshes and therefore usable as the substitution guard.
   */
  async verifyCredential(ctx: AdapterContext) {
    const body = await providerRequest<{
      accountSummaries?: Array<{ account?: string; displayName?: string }>;
    }>(`${ADMIN}/accountSummaries?pageSize=50`, { providerName: NAME, bearer: ctx.credential });

    const summaries = body.accountSummaries ?? [];
    if (summaries.length === 0) {
      throw new ProviderError(
        'PERMISSION_DENIED',
        'This Google account cannot see any Analytics properties. Grant at least Viewer access to the property you want LaunchMind to learn from.',
      );
    }

    return {
      externalAccountId:   summaries[0].account ?? 'ga4-account',
      externalAccountName: summaries[0].displayName
        ? `Google Analytics · ${summaries[0].displayName}`
        : 'Google Analytics',
    };
  },

  /** Every GA4 property the authorized Google account can read, across all accounts. */
  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const out: ProviderAccount[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 10; page++) {
      const url = `${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const body = await providerRequest<{
        accountSummaries?: Array<{
          displayName?: string;
          propertySummaries?: Array<{ property?: string; displayName?: string; propertyType?: string }>;
        }>;
        nextPageToken?: string;
      }>(url, { providerName: NAME, bearer: ctx.credential });

      for (const acct of body.accountSummaries ?? []) {
        for (const prop of acct.propertySummaries ?? []) {
          // `property` arrives as "properties/123456789"; the numeric id is what
          // the Data API needs.
          const id = (prop.property ?? '').split('/').pop();
          if (!id) continue;
          out.push({
            id,
            name: prop.displayName ?? id,
            accessLevel: acct.displayName ? `Account: ${acct.displayName}` : undefined,
          });
        }
      }

      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }

    return out;
  },

  /** Confirms the property still exists and this token may read it. */
  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const properties = await this.listAccounts(ctx);
    const match = properties.find(p => p.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That Google Analytics property is no longer visible to this Google account. Choose a different property or reconnect.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await providerRequest(`${ADMIN}/accountSummaries?pageSize=1`, { providerName: NAME, bearer: ctx.credential });
      return { reachable: true, authorized: true, detail: null, checkedAt };
    } catch (err) {
      if (err instanceof ProviderError) {
        const authProblem = err.kind === 'NEEDS_REAUTH' || err.kind === 'PERMISSION_DENIED';
        return { reachable: err.kind !== 'PROVIDER_UNAVAILABLE', authorized: !authProblem, detail: err.ownerMessage, checkedAt };
      }
      return { reachable: false, authorized: false, detail: 'Health check failed.', checkedAt };
    }
  },

  /**
   * Exchanges the stored refresh token for a fresh access token.
   * Called by connectionService when the credential has expired.
   */
  async refreshAuthorization(ctx: AdapterContext) {
    const { getOAuthProviderConfig } = await import('./oauthConfig');
    const { refreshAccessToken } = await import('../oauthService');

    const config = getOAuthProviderConfig('ga4');
    if (!config) {
      throw new ProviderError('NEEDS_REAUTH', 'Google Analytics is not configured for automatic refresh. Reconnect to continue.');
    }
    const refreshToken = (ctx.config?.refresh_token as string) ?? ctx.credential;
    const tokens = await refreshAccessToken({ config, refreshToken });
    return {
      accessToken:      tokens.accessToken,
      refreshToken:     tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
    };
  },

  /**
   * Imports journey data: sessions, landing pages, source/medium, and the
   * engagement-to-conversion step.
   *
   * Each report is requested independently so one unavailable dimension degrades to
   * PARTIAL rather than failing the whole sync.
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await providerRequest(`${ADMIN}/accountSummaries?pageSize=1`, { providerName: NAME, bearer: ctx.credential });
    await emit(10, SYNC_STEPS[0]);

    const propertyId = ctx.selectedResourceId;
    if (!propertyId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No Google Analytics property is selected for this connection. Choose the property LaunchMind should learn from.',
      );
    }
    await emit(20, SYNC_STEPS[1]);

    const periodStart = isoDaysAgo(WINDOW_DAYS);
    const periodEnd   = isoToday();
    const signals: ProviderSignal[] = [];
    const unavailable: string[] = [];

    // Sessions and engaged sessions — the base of everything else.
    let sessionsReport: Ga4Report | null = null;
    try {
      sessionsReport = await runReport(propertyId, ctx.credential, {
        dateRanges: [DATE_RANGE],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'activeUsers' }],
      });
    } catch (err) {
      // A hard auth/permission failure must abort; a missing metric must not.
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('sessions');
    }
    await emit(38, SYNC_STEPS[2]);

    if (sessionsReport) {
      const sessions        = sumMetric(sessionsReport, 0);
      const engagedSessions = sumMetric(sessionsReport, 1);
      const activeUsers     = sumMetric(sessionsReport, 2);

      if (sessions > 0) {
        signals.push({
          signalType: 'sessions',
          signalData: {
            source: 'GA4 Data API runReport',
            property_id: propertyId,
            sessions,
            engaged_sessions: engagedSessions,
            active_users: activeUsers,
            engagement_rate: engagedSessions / sessions,
            computed_from: 'engagedSessions ÷ sessions',
            window_days: WINDOW_DAYS,
          },
          periodStart, periodEnd,
        });
      }
    }

    // Landing pages by sessions.
    let landingReport: Ga4Report | null = null;
    try {
      landingReport = await runReport(propertyId, ctx.credential, {
        dateRanges: [DATE_RANGE],
        dimensions: [{ name: 'landingPage' }],
        metrics:    [{ name: 'sessions' }, { name: 'bounceRate' }],
        limit: 50,
      });
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('landing pages');
    }
    await emit(55, SYNC_STEPS[3]);

    if (landingReport) {
      const rows = rowsOf(landingReport);
      const buckets = groupAndSum(rows, r => r.dims[0] || null, r => r.metrics[0] ?? 0);
      const payload = breakdownPayload('landing_page', buckets, 'GA4 Data API runReport');
      if (payload) {
        // Worst-performing page by bounce rate, among pages with real traffic.
        const meaningful = rows.filter(r => (r.metrics[0] ?? 0) >= 20);
        const worst = meaningful.sort((a, b) => (b.metrics[1] ?? 0) - (a.metrics[1] ?? 0))[0];
        signals.push({
          signalType: 'funnel',
          signalData: {
            ...payload,
            property_id: propertyId,
            highest_bounce_page: worst ? { page: worst.dims[0], bounce_rate: worst.metrics[1], sessions: worst.metrics[0] } : null,
          },
          periodStart, periodEnd,
        });
      }
    }

    // Source / medium quality.
    let sourceReport: Ga4Report | null = null;
    try {
      sourceReport = await runReport(propertyId, ctx.credential, {
        dateRanges: [DATE_RANGE],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics:    [{ name: 'sessions' }, { name: 'conversions' }],
        limit: 50,
      });
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('source/medium');
    }
    await emit(72, SYNC_STEPS[4]);

    if (sourceReport) {
      const rows = rowsOf(sourceReport);
      const buckets = groupAndSum(rows, r => r.dims[0] || null, r => r.metrics[0] ?? 0);
      const payload = breakdownPayload('source_medium', buckets, 'GA4 Data API runReport');
      if (payload) {
        // Conversion rate per source, computed only where the source has traffic.
        const perSource = rows
          .filter(r => (r.metrics[0] ?? 0) >= 20)
          .map(r => ({
            source: r.dims[0],
            sessions: r.metrics[0] ?? 0,
            conversions: r.metrics[1] ?? 0,
            conversion_rate: (r.metrics[1] ?? 0) / (r.metrics[0] ?? 1),
          }))
          .sort((a, b) => b.conversion_rate - a.conversion_rate);

        signals.push({
          signalType: 'source_quality',
          signalData: {
            ...payload,
            property_id: propertyId,
            per_source: perSource.slice(0, 10),
            best_converting: perSource[0] ?? null,
            computed_from: 'conversions ÷ sessions per sessionSourceMedium',
          },
          periodStart, periodEnd,
        });
      }
    }

    // Overall conversion — sessions to conversions.
    if (sessionsReport && sourceReport) {
      const sessions = sumMetric(sessionsReport, 0);
      const conversions = rowsOf(sourceReport).reduce((acc, r) => acc + (r.metrics[1] ?? 0), 0);
      if (sessions > 0) {
        signals.push({
          signalType: 'conversion',
          signalData: {
            source: 'GA4 Data API runReport',
            property_id: propertyId,
            value: conversions / sessions,
            sessions,
            conversions,
            computed_from: 'conversions ÷ sessions',
          },
          periodStart, periodEnd,
        });
      }
    }
    await emit(88, SYNC_STEPS[5]);
    await emit(96, SYNC_STEPS[6]);

    if (signals.length === 0) return { signals: [], noHistory: true };

    const partial = unavailable.length > 0;
    return {
      signals,
      partial,
      partialReason: partial
        ? `Google Analytics did not return ${unavailable.join(', ')} for this property, so that part of the journey is not visible yet.`
        : undefined,
    };
  },

  /** Google supports token revocation; oauthService performs the call. */
  async revokeAtProvider(ctx: AdapterContext): Promise<boolean> {
    const { getRevocationUrl, getOAuthProviderConfig } = await import('./oauthConfig');
    const { revokeAtProvider } = await import('../oauthService');
    const url = getRevocationUrl('ga4');
    const config = getOAuthProviderConfig('ga4');
    if (!url || !config) return false;
    return revokeAtProvider({
      revocationUrl: url, token: ctx.credential,
      clientId: config.clientId, clientSecret: config.clientSecret,
    });
  },
};
