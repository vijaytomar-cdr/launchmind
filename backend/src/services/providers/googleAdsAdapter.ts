/**
 * @file googleAdsAdapter.ts
 * @description Google Ads observation adapter. READ AND RECOMMEND ONLY.
 *
 *   Google Ads is action-capable, which makes it a trust boundary rather than just
 *   another data source.
 *
 *   THE PROBLEM: Google publishes no read-only OAuth scope. The only scope that grants
 *   analytics access — `https://www.googleapis.com/auth/adwords` — also grants the
 *   ability to change campaigns, move budgets, and spend money. LaunchMind cannot
 *   narrow that at Google.
 *
 *   THE ANSWER: enforce read-only on our side, in three independent layers.
 *     1. STRUCTURAL   this adapter implements no execute_* method, so
 *                     connectionExecutionGuard's capability gate can never pass
 *     2. PROTOCOL     every Google Ads call goes through searchStream with a GAQL
 *                     query that assertReadOnlyQuery() has verified. Mutate endpoints
 *                     are never constructed
 *     3. AUTHORITY    the connection is granted READ + RECOMMEND only, and
 *                     CHANGE/PUBLISH/SPEND require a separate audited upgrade
 *
 *   Any one layer would stop an accidental write. All three means a mistake in one is
 *   not sufficient.
 *
 *   Data path (real Google Ads API v18):
 *     GET  /v18/customers:listAccessibleCustomers   account enumeration
 *     POST /v18/customers/{id}/googleAds:searchStream   GAQL reads
 *
 * @security The developer token is a LaunchMind platform credential, not the owner's,
 *   and is read from env per call. It is never stored per connection or logged.
 * @dependencies providers/http, providers/types
 */

import { providerRequest, toNum, isoDaysAgo, groupAndSum, breakdownPayload } from './http';
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

const API_VERSION = 'v18';
const API  = `https://googleads.googleapis.com/${API_VERSION}`;
const NAME = 'Google Ads';
const WINDOW_DAYS = 30;

const SYNC_STEPS = [
  'Authorization verified',
  'Ad account selected',
  'Reading campaign performance',
  'Comparing keyword and search-term spend',
  'Measuring conversion quality',
  'Identifying inefficient spend',
  'Updating Growth Brain',
] as const;

/** Google Ads reports money in micros. */
const MICROS = 1_000_000;

/**
 * GAQL clauses that would indicate anything other than a read.
 * GAQL itself is select-only — mutations use different REST endpoints — but this
 * guard makes the intent explicit and catches a future mistake at the last moment
 * before a query leaves the process.
 */
const FORBIDDEN_QUERY_TOKENS = [
  'mutate', 'insert ', 'update ', 'delete ', 'remove ', 'create ',
  'set ', 'drop ', ';',
];

/**
 * Verifies a GAQL string is a pure read before it is sent.
 *
 * @throws {ProviderError} SYNC_FAILED when the query is not a plain SELECT
 * @security Defence in depth. The adapter only ever builds SELECT queries; this
 *   ensures that stays true even if a future change is careless.
 */
export function assertReadOnlyQuery(query: string): void {
  const normalized = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `;

  if (!normalized.trimStart().startsWith('select ')) {
    throw new ProviderError('SYNC_FAILED', 'LaunchMind only reads from Google Ads. That request was blocked.');
  }
  for (const token of FORBIDDEN_QUERY_TOKENS) {
    if (normalized.includes(token)) {
      throw new ProviderError('SYNC_FAILED', 'LaunchMind only reads from Google Ads. That request was blocked.');
    }
  }
}

/** The platform-level developer token Google requires on every Ads API call. */
function developerToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) {
    throw new ProviderError(
      'ADAPTER_UNAVAILABLE',
      'Google Ads is not available to connect yet — LaunchMind is missing its Google Ads developer token.',
    );
  }
  return token;
}

/** Strips `customers/` from a resource name and any formatting from an id. */
function bareCustomerId(value: string): string {
  return value.replace(/^customers\//, '').replace(/-/g, '');
}

interface GaqlRow {
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  metrics?: {
    impressions?: string | number; clicks?: string | number; costMicros?: string | number;
    conversions?: string | number; conversionsValue?: string | number;
    ctr?: string | number; averageCpc?: string | number;
  };
  searchTermView?: { searchTerm?: string };
  adGroupCriterion?: { keyword?: { text?: string; matchType?: string } };
}

/**
 * Runs a GAQL read via searchStream.
 * @throws {ProviderError} On a non-read query or any HTTP failure
 */
async function search(ctx: AdapterContext, customerId: string, query: string): Promise<GaqlRow[]> {
  assertReadOnlyQuery(query);

  const headers: Record<string, string> = { 'developer-token': developerToken() };
  // Manager (MCC) accounts require the manager id alongside the child customer id.
  const loginCustomerId = ctx.config?.login_customer_id;
  if (typeof loginCustomerId === 'string' && loginCustomerId) {
    headers['login-customer-id'] = bareCustomerId(loginCustomerId);
  }

  const body = await providerRequest<Array<{ results?: GaqlRow[] }> | { results?: GaqlRow[] }>(
    `${API}/customers/${encodeURIComponent(bareCustomerId(customerId))}/googleAds:searchStream`,
    { providerName: NAME, bearer: ctx.credential, method: 'POST', json: { query }, headers },
  );

  // searchStream returns an array of chunks; a single object is tolerated too.
  const chunks = Array.isArray(body) ? body : [body];
  return chunks.flatMap(c => c.results ?? []);
}

export const googleAdsAdapter: ProviderAdapter = {
  key:           'google_ads',
  displayName:   NAME,
  authMechanism: 'oauth2',
  resourceNoun:  'ad account',
  // Google grants no narrower scope. The read-only guarantee is LaunchMind's, enforced
  // by the three layers described at the top of this file.
  readScopes:    ['https://www.googleapis.com/auth/adwords'],
  syncSteps:     SYNC_STEPS,

  async verifyCredential(ctx: AdapterContext) {
    const body = await providerRequest<{ resourceNames?: string[] }>(
      `${API}/customers:listAccessibleCustomers`,
      { providerName: NAME, bearer: ctx.credential, headers: { 'developer-token': developerToken() } },
    );

    const names = body.resourceNames ?? [];
    if (names.length === 0) {
      throw new ProviderError(
        'PERMISSION_DENIED',
        'This Google account cannot see any Google Ads accounts. Grant it at least read access in Google Ads, then reconnect.',
      );
    }

    return {
      externalAccountId:   bareCustomerId(names[0]),
      externalAccountName: names.length === 1
        ? `Google Ads · ${bareCustomerId(names[0])}`
        : 'Google Ads',
    };
  },

  /**
   * Lists accessible ad accounts, enriching each with its descriptive name where the
   * account permits that read. An account that refuses the detail query is still
   * listed by id rather than dropped.
   */
  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const body = await providerRequest<{ resourceNames?: string[] }>(
      `${API}/customers:listAccessibleCustomers`,
      { providerName: NAME, bearer: ctx.credential, headers: { 'developer-token': developerToken() } },
    );

    const ids = (body.resourceNames ?? []).map(bareCustomerId);
    const accounts: ProviderAccount[] = [];

    for (const id of ids.slice(0, 50)) {
      let name = id;
      let manager = false;
      try {
        const rows = await search(ctx, id,
          'SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code FROM customer LIMIT 1');
        const customer = (rows[0] as unknown as { customer?: { descriptiveName?: string; manager?: boolean } })?.customer;
        if (customer?.descriptiveName) name = customer.descriptiveName;
        manager = customer?.manager === true;
      } catch {
        // Name lookup is best-effort; the account is still selectable by id.
      }
      accounts.push({
        id,
        name,
        // Manager accounts hold no campaigns of their own — worth flagging in the picker.
        accessLevel: manager ? 'Manager account' : undefined,
      });
    }

    return accounts;
  },

  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const accounts = await this.listAccounts(ctx);
    const match = accounts.find(a => a.id === bareCustomerId(resourceId));
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That Google Ads account is no longer accessible to this Google account. Choose a different account or reconnect.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await providerRequest(`${API}/customers:listAccessibleCustomers`, {
        providerName: NAME, bearer: ctx.credential, headers: { 'developer-token': developerToken() },
      });
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
    const config = getOAuthProviderConfig('google_ads');
    if (!config) {
      throw new ProviderError('NEEDS_REAUTH', 'Google Ads is not configured for automatic refresh. Reconnect to continue.');
    }
    const refreshToken = (ctx.config?.refresh_token as string) ?? ctx.credential;
    const tokens = await refreshAccessToken({ config, refreshToken });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
    };
  },

  /**
   * Imports campaign, keyword, and search-term performance.
   *
   * Every query is a plain GAQL SELECT verified by assertReadOnlyQuery. Nothing here
   * constructs a mutate request; Google's mutate endpoints are never referenced.
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await providerRequest(`${API}/customers:listAccessibleCustomers`, {
      providerName: NAME, bearer: ctx.credential, headers: { 'developer-token': developerToken() },
    });
    await emit(10, SYNC_STEPS[0]);

    const customerId = ctx.selectedResourceId;
    if (!customerId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No Google Ads account is selected for this connection. Choose the account LaunchMind should learn from.',
      );
    }
    await emit(20, SYNC_STEPS[1]);

    const since = isoDaysAgo(WINDOW_DAYS);
    const until = isoDaysAgo(1);
    const dateClause = `segments.date BETWEEN '${since}' AND '${until}'`;
    const unavailable: string[] = [];

    // Campaigns.
    let campaigns: GaqlRow[] = [];
    try {
      campaigns = await search(ctx, customerId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ` +
        `metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ` +
        `FROM campaign WHERE ${dateClause}`);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('campaign performance');
    }
    await emit(40, SYNC_STEPS[2]);

    // Search terms — where the money actually went.
    let searchTerms: GaqlRow[] = [];
    try {
      searchTerms = await search(ctx, customerId,
        `SELECT search_term_view.search_term, metrics.impressions, metrics.clicks, ` +
        `metrics.cost_micros, metrics.conversions ` +
        `FROM search_term_view WHERE ${dateClause} ORDER BY metrics.cost_micros DESC LIMIT 200`);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('search terms');
    }
    await emit(58, SYNC_STEPS[3]);

    // Keywords.
    let keywords: GaqlRow[] = [];
    try {
      keywords = await search(ctx, customerId,
        `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ` +
        `metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ` +
        `FROM keyword_view WHERE ${dateClause} ORDER BY metrics.cost_micros DESC LIMIT 200`);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('keyword performance');
    }
    await emit(72, SYNC_STEPS[4]);

    if (campaigns.length === 0 && searchTerms.length === 0 && keywords.length === 0) {
      await emit(100, SYNC_STEPS[6]);
      return { signals: [], noHistory: true };
    }

    const signals: ProviderSignal[] = [];
    const base = { source: 'Google Ads API searchStream', customer_id: bareCustomerId(customerId), window_days: WINDOW_DAYS };

    const sumMetric = (rows: GaqlRow[], key: keyof NonNullable<GaqlRow['metrics']>) =>
      rows.reduce((a, r) => a + (toNum(r.metrics?.[key]) ?? 0), 0);

    if (campaigns.length > 0) {
      const impressions = sumMetric(campaigns, 'impressions');
      const clicks      = sumMetric(campaigns, 'clicks');
      const costMicros  = sumMetric(campaigns, 'costMicros');
      const conversions = sumMetric(campaigns, 'conversions');
      const spend       = costMicros / MICROS;

      signals.push({
        signalType: 'spend',
        signalData: {
          ...base,
          value_usd: spend,
          impressions, clicks,
          ctr: impressions > 0 ? clicks / impressions : null,
          cpc_usd: clicks > 0 ? spend / clicks : null,
          campaigns: campaigns.length,
          computed_from: 'sum of campaign metrics over the window; cost converted from micros',
        },
        periodStart: since, periodEnd: until,
      });

      if (conversions > 0) {
        signals.push({
          signalType: 'cac',
          signalData: {
            ...base,
            cost_per_conversion_usd: spend / conversions,
            conversions,
            spend_usd: spend,
            conversion_rate: clicks > 0 ? conversions / clicks : null,
            computed_from: 'spend ÷ conversions',
          },
          periodStart: since, periodEnd: until,
        });
      }

      const byCampaign = campaigns
        .map(r => ({
          name: r.campaign?.name ?? r.campaign?.id ?? 'unnamed',
          status: r.campaign?.status ?? 'UNKNOWN',
          spend_usd: (toNum(r.metrics?.costMicros) ?? 0) / MICROS,
          clicks: toNum(r.metrics?.clicks) ?? 0,
          conversions: toNum(r.metrics?.conversions) ?? 0,
        }))
        .sort((a, b) => b.spend_usd - a.spend_usd);

      signals.push({
        signalType: 'campaign_performance',
        signalData: {
          ...base,
          campaigns: byCampaign.slice(0, 20),
          total_spend_usd: spend,
          // Campaigns burning budget with nothing to show — the actionable subset.
          zero_conversion_spend_usd: byCampaign
            .filter(c => c.conversions === 0 && c.spend_usd > 0)
            .reduce((a, c) => a + c.spend_usd, 0),
        },
        periodStart: since, periodEnd: until,
      });
    }

    if (searchTerms.length > 0) {
      const terms = searchTerms.map(r => ({
        term: r.searchTermView?.searchTerm ?? '',
        spend_usd: (toNum(r.metrics?.costMicros) ?? 0) / MICROS,
        clicks: toNum(r.metrics?.clicks) ?? 0,
        conversions: toNum(r.metrics?.conversions) ?? 0,
      }));

      const wasted = terms.filter(t => t.conversions === 0 && t.spend_usd > 0);
      const buckets = groupAndSum(terms, t => t.term || null, t => t.spend_usd);

      signals.push({
        signalType: 'source_quality',
        signalData: {
          ...breakdownPayload('search_term', buckets, 'Google Ads API') ?? {},
          ...base,
          dimension: 'search_term',
          zero_conversion_terms: wasted
            .sort((a, b) => b.spend_usd - a.spend_usd)
            .slice(0, 15),
          zero_conversion_spend_usd: wasted.reduce((a, t) => a + t.spend_usd, 0),
          terms_analyzed: terms.length,
        },
        periodStart: since, periodEnd: until,
      });
    }

    if (keywords.length > 0) {
      const kws = keywords.map(r => ({
        keyword: r.adGroupCriterion?.keyword?.text ?? '',
        match_type: r.adGroupCriterion?.keyword?.matchType ?? '',
        spend_usd: (toNum(r.metrics?.costMicros) ?? 0) / MICROS,
        clicks: toNum(r.metrics?.clicks) ?? 0,
        conversions: toNum(r.metrics?.conversions) ?? 0,
      }));

      signals.push({
        signalType: 'audience',
        signalData: {
          ...base,
          dimension: 'keyword',
          keywords: kws.slice(0, 20),
          keywords_analyzed: kws.length,
          zero_conversion_spend_usd: kws
            .filter(k => k.conversions === 0 && k.spend_usd > 0)
            .reduce((a, k) => a + k.spend_usd, 0),
        },
        periodStart: since, periodEnd: until,
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
        ? `Google Ads did not return ${unavailable.join(', ')} for this account, so that part of the picture is missing.`
        : undefined,
    };
  },

  async revokeAtProvider(ctx: AdapterContext): Promise<boolean> {
    const { getRevocationUrl, getOAuthProviderConfig } = await import('./oauthConfig');
    const { revokeAtProvider } = await import('../oauthService');
    const url = getRevocationUrl('google_ads');
    const config = getOAuthProviderConfig('google_ads');
    if (!url || !config) return false;
    return revokeAtProvider({
      revocationUrl: url, token: ctx.credential,
      clientId: config.clientId, clientSecret: config.clientSecret,
    });
  },

  // NO execute_* METHODS.
  // connectionExecutionGuard duck-types for `execute_<action>` and refuses when absent,
  // so this adapter cannot change a campaign, publish an ad, or move a budget even if
  // an owner explicitly granted CHANGE, PUBLISH, or SPEND. Adding one here would be a
  // deliberate, reviewable act — not an accident.
};
