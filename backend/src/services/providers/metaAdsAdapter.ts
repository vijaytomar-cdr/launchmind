/**
 * @file metaAdsAdapter.ts
 * @description Meta Ads observation adapter. READ AND RECOMMEND ONLY.
 *
 *   Meta is action-capable, so this is a trust boundary rather than just another
 *   data source. Unlike Google Ads, Meta DOES publish a genuine read-only scope pair:
 *
 *     ads_read      read campaigns, ad sets, ads, and insights
 *     read_insights read performance reporting
 *
 *   LaunchMind requests exactly those and never `ads_management`, which is the scope
 *   that would permit creating, editing, pausing, or funding anything. So for Meta the
 *   read-only guarantee holds at three levels:
 *     1. SCOPE       Meta itself will refuse a write with this token
 *     2. STRUCTURAL  this adapter implements no execute_* method
 *     3. AUTHORITY   the grant is READ + RECOMMEND; execution needs an audited upgrade
 *
 *   Data path (real Graph API v20):
 *     GET /v20.0/me/adaccounts                     account enumeration
 *     GET /v20.0/{account}/insights?level=campaign campaign performance
 *     GET /v20.0/{account}/insights?level=ad       creative performance
 *     GET /v20.0/{account}/insights?breakdowns=…   audience signals
 *
 * @security Only GET requests are issued. Meta returns its errors with a `code` and
 *   `error_subcode`; those are read for classification and the message body is
 *   discarded, since Meta echoes request parameters into it.
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

const GRAPH = 'https://graph.facebook.com/v20.0';
const NAME  = 'Meta';
const WINDOW_DAYS = 30;

const SYNC_STEPS = [
  'Authorization verified',
  'Ad account selected',
  'Reading campaign performance',
  'Comparing creative performance',
  'Reading audience and placement signals',
  'Detecting fatigue and inefficient spend',
  'Updating Growth Brain',
] as const;

interface MetaInsight {
  campaign_id?: string; campaign_name?: string;
  ad_id?: string; ad_name?: string;
  adset_name?: string;
  impressions?: string; clicks?: string; spend?: string;
  ctr?: string; cpc?: string; frequency?: string; reach?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
  age?: string; gender?: string; publisher_platform?: string;
}

interface MetaAdAccount {
  id?: string; account_id?: string; name?: string;
  account_status?: number; currency?: string;
}

/**
 * Meta signals an invalid or expired token with code 190, and a missing permission
 * with 200/10. Mapping those precisely is what lets the owner see "reconnect" versus
 * "grant this permission" instead of a generic failure.
 */
function classifyMeta(status: number, body: unknown): 'NEEDS_REAUTH' | 'PERMISSION_DENIED' | null {
  const error = (body as { error?: { code?: number; error_subcode?: number } } | null)?.error;
  if (!error) return null;
  if (error.code === 190) return 'NEEDS_REAUTH';
  if (error.code === 200 || error.code === 10 || error.code === 3) return 'PERMISSION_DENIED';
  void status;
  return null;
}

function graph<T>(path: string, credential: string): Promise<T> {
  return providerRequest<T>(`${GRAPH}${path}`, {
    providerName: NAME,
    bearer: credential,
    classifyError: classifyMeta,
  });
}

/** Extracts a named conversion action from Meta's `actions` array. */
function actionValue(insight: MetaInsight, ...types: string[]): number {
  for (const type of types) {
    const hit = (insight.actions ?? []).find(a => a.action_type === type);
    const value = toNum(hit?.value);
    if (value !== null) return value;
  }
  return 0;
}

/** Meta returns `act_<id>`; some endpoints want it with the prefix, some without. */
function withActPrefix(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

const INSIGHT_FIELDS = 'impressions,clicks,spend,ctr,cpc,frequency,reach,actions';

export const metaAdsAdapter: ProviderAdapter = {
  key:           'meta_ads',
  displayName:   NAME,
  authMechanism: 'oauth2',
  resourceNoun:  'ad account',
  // Read-only by scope. `ads_management` is deliberately NOT requested.
  readScopes:    ['ads_read', 'read_insights'],
  syncSteps:     SYNC_STEPS,

  async verifyCredential(ctx: AdapterContext) {
    const body = await graph<{ data?: MetaAdAccount[] }>(
      '/me/adaccounts?fields=account_id,name,account_status,currency&limit=100',
      ctx.credential,
    );

    const accounts = body.data ?? [];
    if (accounts.length === 0) {
      throw new ProviderError(
        'PERMISSION_DENIED',
        'This Meta account cannot see any ad accounts. Grant it access in Meta Business Manager, then reconnect.',
      );
    }

    const first = accounts[0];
    return {
      externalAccountId:   first.account_id ?? first.id ?? 'meta-account',
      externalAccountName: accounts.length === 1
        ? `Meta · ${first.name ?? first.account_id}`
        : 'Meta Ads',
    };
  },

  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const body = await graph<{ data?: MetaAdAccount[] }>(
      '/me/adaccounts?fields=account_id,name,account_status,currency&limit=200',
      ctx.credential,
    );

    return (body.data ?? [])
      .filter(a => a.account_id ?? a.id)
      .map(a => ({
        id:   (a.account_id ?? a.id) as string,
        name: a.name ?? (a.account_id ?? a.id) as string,
        // account_status 1 is active; anything else is worth showing in the picker.
        accessLevel: a.account_status === 1
          ? (a.currency ? `Active · ${a.currency}` : 'Active')
          : 'Inactive',
      }));
  },

  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const accounts = await this.listAccounts(ctx);
    const bare = resourceId.replace(/^act_/, '');
    const match = accounts.find(a => a.id === bare || a.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That Meta ad account is no longer available to this login. Choose a different account or reconnect.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await graph('/me/adaccounts?limit=1', ctx.credential);
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
   * Meta long-lived tokens last ~60 days and are exchanged rather than refreshed via
   * a refresh token. The exchange uses the same token endpoint with
   * grant_type=fb_exchange_token, which oauthService's refresh call does not model,
   * so LaunchMind asks the owner to reconnect instead of silently half-refreshing.
   */
  async refreshAuthorization(): Promise<never> {
    throw new ProviderError(
      'NEEDS_REAUTH',
      'Meta access expires periodically and must be renewed by signing in again. Reconnect to continue.',
    );
  },

  /**
   * Imports campaign, creative, and audience performance.
   *
   * Every call is a GET against an insights endpoint. Nothing here can create, edit,
   * pause, or fund anything — and the token could not do so anyway, because
   * `ads_management` was never requested.
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await graph('/me/adaccounts?limit=1', ctx.credential);
    await emit(10, SYNC_STEPS[0]);

    const accountId = ctx.selectedResourceId;
    if (!accountId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No Meta ad account is selected for this connection. Choose the account LaunchMind should learn from.',
      );
    }
    await emit(20, SYNC_STEPS[1]);

    const act   = withActPrefix(accountId);
    const since = isoDaysAgo(WINDOW_DAYS);
    const until = isoDaysAgo(1);
    const range = `time_range={"since":"${since}","until":"${until}"}`;
    const unavailable: string[] = [];

    const fetchInsights = async (level: string, extra = ''): Promise<MetaInsight[]> => {
      const body = await graph<{ data?: MetaInsight[] }>(
        `/${act}/insights?level=${level}&fields=${INSIGHT_FIELDS}${level === 'campaign' ? ',campaign_name' : ''}` +
        `${level === 'ad' ? ',ad_name,adset_name' : ''}&${range}${extra}&limit=200`,
        ctx.credential,
      );
      return body.data ?? [];
    };

    let campaignRows: MetaInsight[] = [];
    try {
      campaignRows = await fetchInsights('campaign');
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('campaign performance');
    }
    await emit(40, SYNC_STEPS[2]);

    let adRows: MetaInsight[] = [];
    try {
      adRows = await fetchInsights('ad');
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('creative performance');
    }
    await emit(58, SYNC_STEPS[3]);

    let audienceRows: MetaInsight[] = [];
    try {
      audienceRows = await fetchInsights('account', '&breakdowns=publisher_platform');
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('audience breakdown');
    }
    await emit(72, SYNC_STEPS[4]);

    if (campaignRows.length === 0 && adRows.length === 0 && audienceRows.length === 0) {
      await emit(100, SYNC_STEPS[6]);
      return { signals: [], noHistory: true };
    }

    const signals: ProviderSignal[] = [];
    const base = { source: 'Meta Graph API insights', account_id: accountId, window_days: WINDOW_DAYS };

    const sum = (rows: MetaInsight[], key: 'impressions' | 'clicks' | 'spend') =>
      rows.reduce((a, r) => a + (toNum(r[key]) ?? 0), 0);

    if (campaignRows.length > 0) {
      const impressions = sum(campaignRows, 'impressions');
      const clicks      = sum(campaignRows, 'clicks');
      const spend       = sum(campaignRows, 'spend');
      const conversions = campaignRows.reduce(
        (a, r) => a + actionValue(r, 'purchase', 'offsite_conversion.fb_pixel_purchase', 'lead', 'complete_registration'), 0,
      );

      signals.push({
        signalType: 'spend',
        signalData: {
          ...base,
          value_usd: spend,
          impressions, clicks,
          ctr: impressions > 0 ? clicks / impressions : null,
          cpc_usd: clicks > 0 ? spend / clicks : null,
          campaigns: campaignRows.length,
          computed_from: 'sum of campaign-level insights over the window',
        },
        periodStart: since, periodEnd: until,
      });

      if (conversions > 0) {
        signals.push({
          signalType: 'cac',
          signalData: {
            ...base,
            cost_per_conversion_usd: spend / conversions,
            conversions, spend_usd: spend,
            conversion_rate: clicks > 0 ? conversions / clicks : null,
            computed_from: 'spend ÷ attributed conversion actions',
          },
          periodStart: since, periodEnd: until,
        });
      }

      const byCampaign = campaignRows
        .map(r => ({
          name: r.campaign_name ?? r.campaign_id ?? 'unnamed',
          spend_usd: toNum(r.spend) ?? 0,
          clicks: toNum(r.clicks) ?? 0,
          conversions: actionValue(r, 'purchase', 'offsite_conversion.fb_pixel_purchase', 'lead'),
        }))
        .sort((a, b) => b.spend_usd - a.spend_usd);

      signals.push({
        signalType: 'campaign_performance',
        signalData: {
          ...base,
          campaigns: byCampaign.slice(0, 20),
          total_spend_usd: spend,
          zero_conversion_spend_usd: byCampaign
            .filter(c => c.conversions === 0 && c.spend_usd > 0)
            .reduce((a, c) => a + c.spend_usd, 0),
        },
        periodStart: since, periodEnd: until,
      });
    }

    if (adRows.length > 0) {
      const creatives = adRows
        .map(r => ({
          ad: r.ad_name ?? r.ad_id ?? 'unnamed',
          adset: r.adset_name ?? null,
          spend_usd: toNum(r.spend) ?? 0,
          impressions: toNum(r.impressions) ?? 0,
          clicks: toNum(r.clicks) ?? 0,
          ctr: toNum(r.ctr) ?? 0,
          // Frequency is Meta's own fatigue indicator: average views per person.
          frequency: toNum(r.frequency) ?? 0,
          conversions: actionValue(r, 'purchase', 'offsite_conversion.fb_pixel_purchase', 'lead'),
        }))
        .sort((a, b) => b.spend_usd - a.spend_usd);

      // Fatigue: seen repeatedly and still not converting, with real money behind it.
      const fatigued = creatives.filter(c => c.frequency >= 3 && c.spend_usd > 0 && c.conversions === 0);

      signals.push({
        signalType: 'creative_performance',
        signalData: {
          ...base,
          creatives: creatives.slice(0, 20),
          creatives_analyzed: creatives.length,
          fatigued_creatives: fatigued.slice(0, 10),
          fatigued_spend_usd: fatigued.reduce((a, c) => a + c.spend_usd, 0),
          best_ctr: creatives.length > 0
            ? [...creatives].sort((a, b) => b.ctr - a.ctr)[0]
            : null,
          fatigue_rule: 'frequency ≥ 3 with spend and no attributed conversion',
        },
        periodStart: since, periodEnd: until,
      });
    }

    if (audienceRows.length > 0) {
      const buckets = groupAndSum(
        audienceRows,
        r => r.publisher_platform ?? null,
        r => toNum(r.spend) ?? 0,
      );
      const payload = breakdownPayload('publisher_platform', buckets, 'Meta Graph API insights');
      if (payload) {
        signals.push({
          signalType: 'audience',
          signalData: {
            ...payload,
            ...base,
            per_platform: audienceRows.map(r => ({
              platform: r.publisher_platform ?? 'unknown',
              spend_usd: toNum(r.spend) ?? 0,
              impressions: toNum(r.impressions) ?? 0,
              clicks: toNum(r.clicks) ?? 0,
              conversions: actionValue(r, 'purchase', 'offsite_conversion.fb_pixel_purchase', 'lead'),
            })),
          },
          periodStart: since, periodEnd: until,
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
        ? `Meta did not return ${unavailable.join(', ')} for this account, so that part of the picture is missing.`
        : undefined,
    };
  },

  async revokeAtProvider(ctx: AdapterContext): Promise<boolean> {
    // Meta revokes by DELETE on the permissions edge. Best effort: local revocation is
    // authoritative and already done by the time this runs.
    try {
      const res = await fetch(`${GRAPH}/me/permissions`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.credential}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // NO execute_* METHODS.
  // Meta's token is read-only by scope, and connectionExecutionGuard additionally
  // duck-types for `execute_<action>`. Publishing, editing, and spending therefore
  // fail at the provider AND at LaunchMind's own boundary.
};
