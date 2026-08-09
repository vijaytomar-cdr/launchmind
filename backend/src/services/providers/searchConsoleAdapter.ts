/**
 * @file searchConsoleAdapter.ts
 * @description Google Search Console observation adapter (search intelligence).
 *
 *   Authentication: Google OAuth 2.0 with `webmasters.readonly`, run through the
 *   canonical oauthService (state + PKCE + single-use), configured in oauthConfig.ts.
 *
 *   Data path (real Search Console API v3):
 *     GET  /webmasters/v3/sites                              property enumeration
 *     POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query
 *          dimensions ['query'] and ['page'] → clicks, impressions, ctr, position
 *
 *   Search Console finalizes data on a two-to-three day delay, so the window ends
 *   three days ago rather than today. Requesting today would return zeros that read
 *   as "traffic collapsed" instead of "not published yet".
 *
 * @security Read-only scope; the adapter has no method that can request indexing,
 *   submit a sitemap, or change property users.
 * @dependencies providers/http, providers/oauthConfig, oauthService, providers/types
 */

import { providerRequest, toNum, isoDaysAgo } from './http';
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

const API  = 'https://searchconsole.googleapis.com/webmasters/v3';
const NAME = 'Google Search Console';

/** Search Console finalizes data on a delay; ending "today" would report zeros. */
const REPORTING_LAG_DAYS = 3;
const WINDOW_DAYS = 28;

const SYNC_STEPS = [
  'Authorization verified',
  'Property selected',
  'Reading queries and pages',
  'Mapping impressions and clicks',
  'Calculating click-through and position',
  'Finding search opportunities',
  'Updating Growth Brain',
] as const;

interface GscRow {
  keys?:        string[];
  clicks?:      number;
  impressions?: number;
  ctr?:         number;
  position?:    number;
}

interface GscSite { siteUrl?: string; permissionLevel?: string }

/** Owners with only unverified access cannot read analytics. */
function isReadable(permission: string | undefined): boolean {
  return permission !== undefined && permission !== 'siteUnverifiedUser';
}

async function queryAnalytics(
  siteUrl: string,
  credential: string,
  dimensions: string[],
  rowLimit: number,
  startDate: string,
  endDate: string,
): Promise<GscRow[]> {
  const body = await providerRequest<{ rows?: GscRow[] }>(
    `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      providerName: NAME,
      bearer: credential,
      method: 'POST',
      json: { startDate, endDate, dimensions, rowLimit, dataState: 'final' },
    },
  );
  return body.rows ?? [];
}

export const searchConsoleAdapter: ProviderAdapter = {
  key:           'search_console',
  displayName:   NAME,
  authMechanism: 'oauth2',
  resourceNoun:  'site',
  readScopes:    ['https://www.googleapis.com/auth/webmasters.readonly'],
  syncSteps:     SYNC_STEPS,

  /** Proves the token by listing verified sites. */
  async verifyCredential(ctx: AdapterContext) {
    const body = await providerRequest<{ siteEntry?: GscSite[] }>(
      `${API}/sites`, { providerName: NAME, bearer: ctx.credential },
    );

    const readable = (body.siteEntry ?? []).filter(s => isReadable(s.permissionLevel));
    if (readable.length === 0) {
      throw new ProviderError(
        'PERMISSION_DENIED',
        'This Google account has no verified Search Console properties it can read. Verify the property in Search Console, then reconnect.',
      );
    }

    return {
      externalAccountId:   readable[0].siteUrl ?? 'search-console',
      externalAccountName: readable.length === 1
        ? `Search Console · ${readable[0].siteUrl}`
        : 'Google Search Console',
    };
  },

  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const body = await providerRequest<{ siteEntry?: GscSite[] }>(
      `${API}/sites`, { providerName: NAME, bearer: ctx.credential },
    );
    return (body.siteEntry ?? [])
      .filter(s => s.siteUrl && isReadable(s.permissionLevel))
      .map(s => ({
        id:   s.siteUrl as string,
        name: s.siteUrl as string,
        accessLevel: s.permissionLevel,
      }));
  },

  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const sites = await this.listAccounts(ctx);
    const match = sites.find(s => s.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That Search Console property is no longer verified for this Google account. Choose a different property or reconnect.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await providerRequest(`${API}/sites`, { providerName: NAME, bearer: ctx.credential });
      return { reachable: true, authorized: true, detail: null, checkedAt };
    } catch (err) {
      if (err instanceof ProviderError) {
        const authProblem = err.kind === 'NEEDS_REAUTH' || err.kind === 'PERMISSION_DENIED';
        return { reachable: err.kind !== 'PROVIDER_UNAVAILABLE', authorized: !authProblem, detail: err.ownerMessage, checkedAt };
      }
      return { reachable: false, authorized: false, detail: 'Health check failed.', checkedAt };
    }
  },

  async refreshAuthorization(ctx: AdapterContext) {
    const { getOAuthProviderConfig } = await import('./oauthConfig');
    const { refreshAccessToken } = await import('../oauthService');

    const config = getOAuthProviderConfig('search_console');
    if (!config) {
      throw new ProviderError('NEEDS_REAUTH', 'Search Console is not configured for automatic refresh. Reconnect to continue.');
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
   * Imports search performance and derives page/query opportunities.
   *
   * "Opportunity" here has a precise meaning: a query already ranking on page one
   * (position ≤ 20) with meaningful impressions but click-through below the set's own
   * median. That is a gap between visibility and appeal, which is actionable —
   * unlike a generic "improve SEO".
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await providerRequest(`${API}/sites`, { providerName: NAME, bearer: ctx.credential });
    await emit(10, SYNC_STEPS[0]);

    const siteUrl = ctx.selectedResourceId;
    if (!siteUrl) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No Search Console property is selected for this connection. Choose the site LaunchMind should learn from.',
      );
    }
    await emit(20, SYNC_STEPS[1]);

    const endDate   = isoDaysAgo(REPORTING_LAG_DAYS);
    const startDate = isoDaysAgo(REPORTING_LAG_DAYS + WINDOW_DAYS);

    const unavailable: string[] = [];

    let queryRows: GscRow[] = [];
    try {
      queryRows = await queryAnalytics(siteUrl, ctx.credential, ['query'], 250, startDate, endDate);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('query performance');
    }
    await emit(40, SYNC_STEPS[2]);

    let pageRows: GscRow[] = [];
    try {
      pageRows = await queryAnalytics(siteUrl, ctx.credential, ['page'], 250, startDate, endDate);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('page performance');
    }
    await emit(56, SYNC_STEPS[3]);

    // A verified property with no search traffic in the window is healthy, not broken.
    if (queryRows.length === 0 && pageRows.length === 0) {
      await emit(100, SYNC_STEPS[6]);
      return { signals: [], noHistory: true };
    }

    const signals: ProviderSignal[] = [];
    const base = { source: 'Search Console searchAnalytics', site_url: siteUrl, window_days: WINDOW_DAYS };

    const totalClicks      = queryRows.reduce((a, r) => a + (toNum(r.clicks) ?? 0), 0);
    const totalImpressions = queryRows.reduce((a, r) => a + (toNum(r.impressions) ?? 0), 0);

    if (totalImpressions > 0) {
      signals.push({
        signalType: 'impressions',
        signalData: { ...base, value: totalImpressions, unit: 'search impressions', queries_returned: queryRows.length },
        periodStart: startDate, periodEnd: endDate,
      });

      signals.push({
        signalType: 'ctr',
        signalData: {
          ...base,
          value: totalClicks / totalImpressions,
          clicks: totalClicks,
          impressions: totalImpressions,
          computed_from: 'clicks ÷ impressions across all returned queries',
        },
        periodStart: startDate, periodEnd: endDate,
      });
    }
    await emit(70, SYNC_STEPS[4]);

    if (queryRows.length > 0) {
      // Impression-weighted average position — an unweighted mean would let a
      // zero-impression long-tail term distort the figure.
      const weighted = queryRows.reduce((a, r) => a + (toNum(r.position) ?? 0) * (toNum(r.impressions) ?? 0), 0);
      const avgPosition = totalImpressions > 0 ? weighted / totalImpressions : null;

      const top = [...queryRows]
        .sort((a, b) => (toNum(b.impressions) ?? 0) - (toNum(a.impressions) ?? 0))
        .slice(0, 15)
        .map(r => ({
          query: r.keys?.[0] ?? '',
          clicks: toNum(r.clicks) ?? 0,
          impressions: toNum(r.impressions) ?? 0,
          ctr: toNum(r.ctr) ?? 0,
          position: toNum(r.position) ?? 0,
        }));

      signals.push({
        signalType: 'queries',
        signalData: { ...base, top_queries: top, total_queries: queryRows.length },
        periodStart: startDate, periodEnd: endDate,
      });

      if (avgPosition !== null) {
        signals.push({
          signalType: 'rankings',
          signalData: {
            ...base,
            average_position: avgPosition,
            computed_from: 'impression-weighted mean position',
            queries_in_top_10: queryRows.filter(r => (toNum(r.position) ?? 99) <= 10).length,
            queries_in_top_20: queryRows.filter(r => (toNum(r.position) ?? 99) <= 20).length,
          },
          periodStart: startDate, periodEnd: endDate,
        });
      }
    }

    // Opportunities: already visible, under-clicked.
    if (queryRows.length >= 5 && totalImpressions > 0) {
      const eligible = queryRows.filter(r =>
        (toNum(r.impressions) ?? 0) >= 50 && (toNum(r.position) ?? 99) <= 20,
      );

      if (eligible.length >= 3) {
        const ctrs = eligible.map(r => toNum(r.ctr) ?? 0).sort((a, b) => a - b);
        const medianCtr = ctrs[Math.floor(ctrs.length / 2)];

        const under = eligible
          .filter(r => (toNum(r.ctr) ?? 0) < medianCtr)
          .sort((a, b) => (toNum(b.impressions) ?? 0) - (toNum(a.impressions) ?? 0))
          .slice(0, 10)
          .map(r => ({
            query: r.keys?.[0] ?? '',
            impressions: toNum(r.impressions) ?? 0,
            ctr: toNum(r.ctr) ?? 0,
            position: toNum(r.position) ?? 0,
            // Clicks that would be gained at the set's own median CTR.
            clicks_at_median_ctr: Math.round((toNum(r.impressions) ?? 0) * medianCtr - (toNum(r.clicks) ?? 0)),
          }))
          .filter(o => o.clicks_at_median_ctr > 0);

        if (under.length > 0) {
          signals.push({
            signalType: 'source_quality',
            signalData: {
              ...base,
              dimension: 'search_opportunity',
              median_ctr: medianCtr,
              eligible_queries: eligible.length,
              opportunities: under,
              potential_additional_clicks: under.reduce((a, o) => a + o.clicks_at_median_ctr, 0),
              computed_from: 'queries with ≥50 impressions and position ≤20 whose CTR is below the set median',
            },
            periodStart: startDate, periodEnd: endDate,
          });
        }
      }
    }

    if (pageRows.length > 0) {
      const topPages = [...pageRows]
        .sort((a, b) => (toNum(b.impressions) ?? 0) - (toNum(a.impressions) ?? 0))
        .slice(0, 15)
        .map(r => ({
          page: r.keys?.[0] ?? '',
          clicks: toNum(r.clicks) ?? 0,
          impressions: toNum(r.impressions) ?? 0,
          ctr: toNum(r.ctr) ?? 0,
          position: toNum(r.position) ?? 0,
        }));

      signals.push({
        signalType: 'funnel',
        signalData: { ...base, dimension: 'page', top_pages: topPages, total_pages: pageRows.length },
        periodStart: startDate, periodEnd: endDate,
      });
    }
    await emit(88, SYNC_STEPS[5]);
    await emit(96, SYNC_STEPS[6]);

    if (signals.length === 0) return { signals: [], noHistory: true };

    const partial = unavailable.length > 0;
    return {
      signals,
      partial,
      partialReason: partial
        ? `Search Console did not return ${unavailable.join(', ')} for this property, so that part of the search picture is missing.`
        : undefined,
    };
  },

  async revokeAtProvider(ctx: AdapterContext): Promise<boolean> {
    const { getRevocationUrl, getOAuthProviderConfig } = await import('./oauthConfig');
    const { revokeAtProvider } = await import('../oauthService');
    const url = getRevocationUrl('search_console');
    const config = getOAuthProviderConfig('search_console');
    if (!url || !config) return false;
    return revokeAtProvider({
      revocationUrl: url, token: ctx.credential,
      clientId: config.clientId, clientSecret: config.clientSecret,
    });
  },
};
