/**
 * @file mailchimpAdapter.ts
 * @description Mailchimp observation adapter (owned-channel intelligence). READ ONLY.
 *
 *   Authentication: Mailchimp OAuth 2.0 through the canonical oauthService.
 *
 *   Mailchimp's quirk: the API host is per-account. After the token exchange the
 *   caller must ask the metadata endpoint which data centre the account lives in, and
 *   send every later request to that host. That lookup happens at call time rather
 *   than being cached in connection_config, so a migrated account cannot leave a
 *   stale host behind.
 *
 *   Mailchimp has no scope system — a token can technically send campaigns. LaunchMind
 *   therefore enforces the narrower boundary itself:
 *     STRUCTURAL  no execute_* method → connectionExecutionGuard can never permit it
 *     PROTOCOL    only GET requests are issued; no send, publish, or list-write
 *                 endpoint is ever constructed
 *     AUTHORITY   granted READ + RECOMMEND; anything more needs an audited upgrade
 *
 *   Data path (real Marketing API 3.0):
 *     GET login.mailchimp.com/oauth2/metadata  data centre + account identity
 *     GET /3.0/lists                           audiences with engagement stats
 *     GET /3.0/campaigns?status=sent           sent campaigns
 *     GET /3.0/reports                         opens, clicks, bounces per campaign
 *     GET /3.0/lists/{id}/segments             segments
 *
 * @security Only GET requests. The token is never placed in a query string, where it
 *   would end up in provider access logs.
 * @dependencies providers/http, providers/types
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

const METADATA_URL = 'https://login.mailchimp.com/oauth2/metadata';
const NAME = 'Mailchimp';
const WINDOW_DAYS = 90;

const SYNC_STEPS = [
  'Authorization verified',
  'Audience selected',
  'Reading campaigns',
  'Mapping audience segments',
  'Analysing engagement',
  'Detecting winning and weak patterns',
  'Updating Growth Brain',
] as const;

interface McMetadata {
  dc?: string;
  api_endpoint?: string;
  login?: { login_name?: string; email?: string };
  accountname?: string;
}

interface McList {
  id?: string; name?: string;
  stats?: {
    member_count?: number; unsubscribe_count?: number;
    open_rate?: number; click_rate?: number;
    campaign_count?: number; avg_sub_rate?: number;
  };
}

interface _McCampaign {
  id?: string; status?: string; send_time?: string;
  emails_sent?: number;
  settings?: { title?: string; subject_line?: string };
  recipients?: { list_id?: string; list_name?: string; recipient_count?: number };
}

interface McReport {
  id?: string; campaign_title?: string; emails_sent?: number; send_time?: string;
  list_id?: string;
  opens?: { opens_total?: number; unique_opens?: number; open_rate?: number };
  clicks?: { clicks_total?: number; unique_clicks?: number; click_rate?: number };
  bounces?: { hard_bounces?: number; soft_bounces?: number };
  unsubscribed?: number;
}

interface McSegment { id?: number; name?: string; member_count?: number }

/**
 * Resolves the account's API host.
 *
 * Mailchimp's metadata endpoint expects the `OAuth <token>` auth scheme rather than
 * `Bearer`, which is why this call does not go through the shared bearer helper.
 *
 * @throws {ProviderError} NEEDS_REAUTH when the token no longer resolves an account
 */
async function resolveEndpoint(credential: string): Promise<{ base: string; meta: McMetadata }> {
  const meta = await providerRequest<McMetadata>(METADATA_URL, {
    providerName: NAME,
    headers: { Authorization: `OAuth ${credential}` },
  });

  const base = meta.api_endpoint ?? (meta.dc ? `https://${meta.dc}.api.mailchimp.com` : null);
  if (!base) {
    throw new ProviderError(
      'NEEDS_REAUTH',
      'Mailchimp did not identify an account for this authorization. Reconnect to continue.',
    );
  }

  return { base: base.replace(/\/+$/, ''), meta };
}

function get<T>(base: string, path: string, credential: string): Promise<T> {
  // Token in the Authorization header, never the query string.
  return providerRequest<T>(`${base}/3.0${path}`, { providerName: NAME, bearer: credential });
}

export const mailchimpAdapter: ProviderAdapter = {
  key:           'mailchimp',
  displayName:   NAME,
  authMechanism: 'oauth2',
  resourceNoun:  'audience',
  // Mailchimp issues no granular scopes. The read-only guarantee is LaunchMind's,
  // enforced by the three layers described at the top of this file.
  readScopes:    ['mailchimp.read'],
  syncSteps:     SYNC_STEPS,

  async verifyCredential(ctx: AdapterContext) {
    const { base, meta } = await resolveEndpoint(ctx.credential);

    // Prove the resolved host actually answers for this token.
    const account = await get<{ account_id?: string; account_name?: string; total_subscribers?: number }>(
      base, '/', ctx.credential,
    );

    if (!account.account_id) {
      throw new ProviderError(
        'NEEDS_REAUTH',
        'Mailchimp did not return an account for this authorization. Reconnect to continue.',
      );
    }

    return {
      externalAccountId:   account.account_id,
      externalAccountName: `Mailchimp · ${account.account_name ?? meta.accountname ?? account.account_id}`,
    };
  },

  /**
   * Audiences (lists) are the selectable resource. Most accounts have several, so the
   * owner chooses; an account with exactly one is auto-selected upstream.
   */
  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const { base } = await resolveEndpoint(ctx.credential);
    const body = await get<{ lists?: McList[] }>(base, '/lists?count=100', ctx.credential);

    return (body.lists ?? [])
      .filter(l => l.id)
      .map(l => ({
        id:   l.id as string,
        name: l.name ?? (l.id as string),
        accessLevel: typeof l.stats?.member_count === 'number'
          ? `${l.stats.member_count.toLocaleString()} contacts`
          : undefined,
      }));
  },

  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const audiences = await this.listAccounts(ctx);
    const match = audiences.find(a => a.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That Mailchimp audience no longer exists in this account. Choose a different audience or reconnect.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const { base } = await resolveEndpoint(ctx.credential);
      await get(base, '/', ctx.credential);
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
   * Mailchimp OAuth tokens do not expire and no refresh token is issued, so there is
   * nothing to refresh. Saying so plainly beats a no-op that looks like success.
   */
  async refreshAuthorization(): Promise<never> {
    throw new ProviderError(
      'NEEDS_REAUTH',
      'Mailchimp access does not renew automatically. Reconnect to restore it.',
    );
  },

  /**
   * Imports campaign and audience engagement.
   *
   * Reports are the authoritative source for opens and clicks; the campaign list adds
   * titles and send times. Each is fetched independently so one unavailable collection
   * degrades to PARTIAL rather than failing the sync.
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    const { base } = await resolveEndpoint(ctx.credential);
    await get(base, '/', ctx.credential);
    await emit(10, SYNC_STEPS[0]);

    const listId = ctx.selectedResourceId;
    if (!listId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No Mailchimp audience is selected for this connection. Choose the audience LaunchMind should learn from.',
      );
    }
    await this.validateSelection?.(ctx, listId);
    await emit(20, SYNC_STEPS[1]);

    const periodStart = isoDaysAgo(WINDOW_DAYS);
    const periodEnd   = isoToday();
    const cutoff      = isoDaysAgo(WINDOW_DAYS);
    const signals: ProviderSignal[] = [];
    const base_ = { source: 'Mailchimp Marketing API 3.0', list_id: listId, window_days: WINDOW_DAYS };
    const unavailable: string[] = [];

    // Reports carry the engagement numbers.
    let reports: McReport[] = [];
    try {
      const body = await get<{ reports?: McReport[] }>(base, '/reports?count=100', ctx.credential);
      reports = (body.reports ?? [])
        .filter(r => r.list_id === listId)
        .filter(r => !r.send_time || r.send_time.slice(0, 10) >= cutoff);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('campaign reports');
    }
    await emit(40, SYNC_STEPS[2]);

    // Audience-level stats.
    let list: McList | null = null;
    try {
      list = await get<McList>(base, `/lists/${encodeURIComponent(listId)}`, ctx.credential);
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('audience stats');
    }

    let segments: McSegment[] = [];
    try {
      const body = await get<{ segments?: McSegment[] }>(
        base, `/lists/${encodeURIComponent(listId)}/segments?count=100`, ctx.credential,
      );
      segments = body.segments ?? [];
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('segments');
    }
    await emit(58, SYNC_STEPS[3]);

    if (reports.length > 0) {
      const sent   = reports.reduce((a, r) => a + (toNum(r.emails_sent) ?? 0), 0);
      const opens  = reports.reduce((a, r) => a + (toNum(r.opens?.unique_opens) ?? 0), 0);
      const clicks = reports.reduce((a, r) => a + (toNum(r.clicks?.unique_clicks) ?? 0), 0);
      const unsubs = reports.reduce((a, r) => a + (toNum(r.unsubscribed) ?? 0), 0);
      const bounces = reports.reduce(
        (a, r) => a + (toNum(r.bounces?.hard_bounces) ?? 0) + (toNum(r.bounces?.soft_bounces) ?? 0), 0,
      );

      if (sent > 0) {
        signals.push({
          signalType: 'email_engagement',
          signalData: {
            ...base_,
            emails_sent: sent,
            unique_opens: opens,
            unique_clicks: clicks,
            open_rate: opens / sent,
            click_rate: clicks / sent,
            // Click-to-open says whether the content delivers on the subject line.
            click_to_open_rate: opens > 0 ? clicks / opens : null,
            unsubscribes: unsubs,
            unsubscribe_rate: unsubs / sent,
            bounces,
            campaigns_analyzed: reports.length,
            computed_from: 'unique opens and clicks ÷ emails sent, summed across campaigns in the window',
          },
          periodStart, periodEnd,
        });
      }

      const perCampaign = reports
        .map(r => ({
          campaign: r.campaign_title ?? r.id ?? 'untitled',
          sent: toNum(r.emails_sent) ?? 0,
          open_rate: toNum(r.opens?.open_rate) ?? 0,
          click_rate: toNum(r.clicks?.click_rate) ?? 0,
          unique_clicks: toNum(r.clicks?.unique_clicks) ?? 0,
          send_time: r.send_time ?? null,
        }))
        .filter(c => c.sent > 0)
        .sort((a, b) => b.click_rate - a.click_rate);

      if (perCampaign.length > 0) {
        signals.push({
          signalType: 'campaign_performance',
          signalData: {
            ...base_,
            campaigns: perCampaign.slice(0, 20),
            best: perCampaign[0],
            worst: perCampaign[perCampaign.length - 1],
            campaigns_analyzed: perCampaign.length,
            computed_from: 'per-campaign report metrics, ranked by click rate',
          },
          periodStart, periodEnd,
        });
      }
    }
    await emit(74, SYNC_STEPS[4]);

    if (list?.stats || segments.length > 0) {
      const segmentBuckets = groupAndSum(
        segments,
        s => s.name ?? null,
        s => toNum(s.member_count) ?? 0,
      );

      signals.push({
        signalType: 'audience',
        signalData: {
          ...(breakdownPayload('segment', segmentBuckets, 'Mailchimp Marketing API 3.0') ?? {}),
          ...base_,
          dimension: 'audience',
          audience_name: list?.name ?? null,
          member_count: toNum(list?.stats?.member_count),
          unsubscribe_count: toNum(list?.stats?.unsubscribe_count),
          list_open_rate: toNum(list?.stats?.open_rate),
          list_click_rate: toNum(list?.stats?.click_rate),
          segments: segments.length,
          computed_from: 'audience stats with segment member counts',
        },
        periodStart, periodEnd,
      });
    }
    await emit(88, SYNC_STEPS[5]);
    await emit(96, SYNC_STEPS[6]);

    // A real audience that has never been mailed is healthy with nothing to learn yet.
    if (signals.length === 0) return { signals: [], noHistory: true };

    const partial = unavailable.length > 0;
    return {
      signals,
      partial,
      partialReason: partial
        ? `Mailchimp did not return ${unavailable.join(', ')} for this audience, so that part of the picture is missing.`
        : undefined,
    };
  },

  /** Mailchimp tokens are revoked from the account's connected-apps settings. */
  async revokeAtProvider(): Promise<boolean> {
    return false;
  },

  // NO execute_* METHODS. No campaign send, no publish, no list or content mutation.
  // Mailchimp's token would technically permit those; LaunchMind's boundary does not.
};
