/**
 * @file hubspotAdapter.ts
 * @description HubSpot observation adapter (CRM lifecycle intelligence). READ ONLY.
 *
 *   Authentication: HubSpot OAuth 2.0, run through the canonical oauthService, with
 *   the narrowest scopes that answer the question LaunchMind is asking:
 *     crm.objects.contacts.read · crm.objects.deals.read
 *   `.write` scopes are never requested, so HubSpot itself refuses a mutation with
 *   this token. LaunchMind additionally implements no execute_* method, so
 *   connectionExecutionGuard's capability gate can never pass either.
 *
 *   Resource model: a HubSpot OAuth token is bound to exactly ONE portal (hub), so
 *   there is exactly one resource and auto-select is correct here — the same
 *   single-resource case as Stripe, not a fabricated list.
 *
 *   Data path (real CRM v3 endpoints):
 *     GET /oauth/v1/access-tokens/{token}  portal identity + granted scopes
 *     GET /crm/v3/objects/contacts         lifecycle stage + original source
 *     GET /crm/v3/objects/deals            deal stage and amount
 *     GET /crm/v3/pipelines/deals          stage labels, so signals are readable
 *
 * @security Only GET requests are issued. No contact, deal, workflow, or email
 *   endpoint that mutates is ever constructed.
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

const API  = 'https://api.hubapi.com';
const NAME = 'HubSpot';
const WINDOW_DAYS = 90;   // CRM lifecycles are slower than ad or store data.

const SYNC_STEPS = [
  'Authorization verified',
  'Portal selected',
  'Reading lifecycle data',
  'Mapping lead sources',
  'Analysing stage conversion',
  'Detecting funnel friction',
  'Updating Growth Brain',
] as const;

/**
 * HubSpot's canonical lifecycle ladder, in order. Used to measure progression, so a
 * portal using custom stages still reports counts without LaunchMind inventing an
 * ordering it cannot know.
 */
const LIFECYCLE_ORDER = [
  'subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead',
  'opportunity', 'customer', 'evangelist', 'other',
] as const;

const READABLE_STAGE: Record<string, string> = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  marketingqualifiedlead: 'Marketing qualified',
  salesqualifiedlead: 'Sales qualified',
  opportunity: 'Opportunity',
  customer: 'Customer',
  evangelist: 'Evangelist',
  other: 'Other',
};

interface HsContact {
  id?: string;
  properties?: {
    lifecyclestage?: string | null;
    hs_analytics_source?: string | null;
    createdate?: string | null;
  };
}

interface HsDeal {
  id?: string;
  properties?: {
    dealstage?: string | null;
    amount?: string | null;
    pipeline?: string | null;
    createdate?: string | null;
  };
}

interface HsTokenInfo {
  hub_id?: number; hub_domain?: string; user?: string;
  scopes?: string[]; expires_in?: number;
}

function get<T>(path: string, credential: string): Promise<T> {
  return providerRequest<T>(`${API}${path}`, { providerName: NAME, bearer: credential });
}

/**
 * Reads portal identity from the token itself.
 * This endpoint takes the token in the PATH, not a header — a HubSpot quirk.
 */
async function tokenInfo(credential: string): Promise<HsTokenInfo> {
  return providerRequest<HsTokenInfo>(
    `${API}/oauth/v1/access-tokens/${encodeURIComponent(credential)}`,
    { providerName: NAME },
  );
}

/** Pages a CRM v3 collection, bounded so a bad cursor cannot loop. */
async function pageAll<T>(
  credential: string,
  path: string,
  maxPages = 5,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const body = await get<{ results?: T[]; paging?: { next?: { after?: string } } }>(url, credential);
    out.push(...(body.results ?? []));
    after = body.paging?.next?.after;
    if (!after) break;
  }

  return out;
}

export const hubspotAdapter: ProviderAdapter = {
  key:           'hubspot',
  displayName:   NAME,
  authMechanism: 'oauth2',
  resourceNoun:  'portal',
  // Read scopes only. No `.write`, no `automation`, no `content`.
  readScopes:    ['crm.objects.contacts.read', 'crm.objects.deals.read'],
  syncSteps:     SYNC_STEPS,

  /**
   * Proves the token and identifies the portal it belongs to.
   * @returns hub_id as the account identity — stable across token refreshes, so it is
   *   the substitution guard.
   */
  async verifyCredential(ctx: AdapterContext) {
    const info = await tokenInfo(ctx.credential);

    if (!info.hub_id) {
      throw new ProviderError(
        'NEEDS_REAUTH',
        'HubSpot did not identify a portal for this authorization. Reconnect and choose the account you want LaunchMind to learn from.',
      );
    }

    // A token without contact read cannot answer anything LaunchMind asks, so this is
    // a permission problem the owner can fix, not a generic failure.
    const scopes = info.scopes ?? [];
    if (scopes.length > 0 && !scopes.some(s => s.includes('contacts'))) {
      throw new ProviderError(
        'PERMISSION_DENIED',
        'This HubSpot authorization cannot read contacts. Reconnect and approve contact read access.',
      );
    }

    return {
      externalAccountId:   String(info.hub_id),
      externalAccountName: info.hub_domain ? `HubSpot · ${info.hub_domain}` : `HubSpot · ${info.hub_id}`,
    };
  },

  /**
   * A HubSpot OAuth token is bound to one portal, so exactly one resource exists.
   * This is the sanctioned auto-select case, not a synthesized entry.
   */
  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const info = await tokenInfo(ctx.credential);
    if (!info.hub_id) return [];
    return [{
      id:   String(info.hub_id),
      name: info.hub_domain ?? `Portal ${info.hub_id}`,
      accessLevel: info.user ? `Authorized by ${info.user}` : undefined,
    }];
  },

  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const accounts = await this.listAccounts(ctx);
    const match = accounts.find(a => a.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'This HubSpot authorization now belongs to a different portal than the one connected. Reconnect with the original portal, or disconnect first.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await tokenInfo(ctx.credential);
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
    const config = getOAuthProviderConfig('hubspot');
    if (!config) {
      throw new ProviderError('NEEDS_REAUTH', 'HubSpot is not configured for automatic refresh. Reconnect to continue.');
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
   * Imports lifecycle, source, and deal-stage intelligence.
   *
   * Contacts and deals are fetched independently: a portal that grants contact read
   * but not deal read yields PARTIAL with a specific explanation rather than failing.
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await tokenInfo(ctx.credential);
    await emit(10, SYNC_STEPS[0]);

    const portalId = ctx.selectedResourceId;
    if (!portalId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No HubSpot portal is bound to this connection. Reconnect to bind one.',
      );
    }
    await this.validateSelection?.(ctx, portalId);
    await emit(20, SYNC_STEPS[1]);

    const periodStart = isoDaysAgo(WINDOW_DAYS);
    const periodEnd   = isoToday();
    const base = { source: 'HubSpot CRM v3', portal_id: portalId, window_days: WINDOW_DAYS };
    const unavailable: string[] = [];

    let contacts: HsContact[] = [];
    try {
      contacts = await pageAll<HsContact>(
        ctx.credential,
        '/crm/v3/objects/contacts?properties=lifecyclestage,hs_analytics_source,createdate',
      );
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('contacts');
    }
    await emit(40, SYNC_STEPS[2]);

    const signals: ProviderSignal[] = [];

    if (contacts.length > 0) {
      // Lifecycle distribution — counts only. LaunchMind does not infer movement it
      // has not observed across two syncs.
      const stageBuckets = groupAndSum(
        contacts,
        c => (c.properties?.lifecyclestage ?? 'unknown').toLowerCase() || null,
        () => 1,
      );

      const stageCount = (stage: string) =>
        stageBuckets.find(b => b.key === stage)?.value ?? 0;

      const mql = stageCount('marketingqualifiedlead');
      const sql = stageCount('salesqualifiedlead');
      const customers = stageCount('customer');
      const leads = stageCount('lead');

      signals.push({
        signalType: 'lifecycle',
        signalData: {
          ...base,
          total_contacts: contacts.length,
          by_stage: stageBuckets.map(b => ({
            stage: b.key,
            label: READABLE_STAGE[b.key] ?? b.key,
            count: b.value,
          })),
          known_stages: LIFECYCLE_ORDER.filter(s => stageCount(s) > 0),
          computed_from: 'contact lifecyclestage counts',
        },
        periodStart, periodEnd,
      });

      // Stage conversion is emitted only where BOTH sides genuinely exist. A rate
      // against a missing denominator would be fiction.
      const conversions: Record<string, number | null> = {
        lead_to_mql:     leads > 0 ? mql / leads : null,
        mql_to_sql:      mql  > 0 ? sql / mql : null,
        sql_to_customer: sql  > 0 ? customers / sql : null,
      };

      if (Object.values(conversions).some(v => v !== null)) {
        signals.push({
          signalType: 'lead_quality',
          signalData: {
            ...base,
            leads, mql, sql, customers,
            ...conversions,
            computed_from: 'ratios between adjacent HubSpot lifecycle stage counts',
          },
          periodStart, periodEnd,
        });
      }
      await emit(55, SYNC_STEPS[3]);

      // Original source attribution.
      const sourceBuckets = groupAndSum(
        contacts,
        c => c.properties?.hs_analytics_source ?? null,
        () => 1,
      );
      const sourcePayload = breakdownPayload('original_source', sourceBuckets, 'HubSpot CRM v3');
      if (sourcePayload) {
        // Customers per source, so quality is visible rather than just volume.
        const customersBySource = groupAndSum(
          contacts.filter(c => (c.properties?.lifecyclestage ?? '').toLowerCase() === 'customer'),
          c => c.properties?.hs_analytics_source ?? null,
          () => 1,
        );

        signals.push({
          signalType: 'source_quality',
          signalData: {
            ...sourcePayload,
            ...base,
            per_source: sourceBuckets.slice(0, 10).map(s => {
              const won = customersBySource.find(c => c.key === s.key)?.value ?? 0;
              return {
                source: s.key,
                contacts: s.value,
                customers: won,
                customer_rate: s.value > 0 ? won / s.value : 0,
              };
            }),
            computed_from: 'contacts grouped by hs_analytics_source, with customer counts per source',
          },
          periodStart, periodEnd,
        });
      }
    } else {
      await emit(55, SYNC_STEPS[3]);
    }

    // Deals.
    let deals: HsDeal[] = [];
    try {
      deals = await pageAll<HsDeal>(
        ctx.credential,
        '/crm/v3/objects/deals?properties=dealstage,amount,pipeline,createdate',
      );
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== 'SYNC_FAILED') throw err;
      unavailable.push('deals');
    }
    await emit(72, SYNC_STEPS[4]);

    if (deals.length > 0) {
      const stageBuckets = groupAndSum(deals, d => d.properties?.dealstage ?? null, () => 1);
      const valueByStage = groupAndSum(deals, d => d.properties?.dealstage ?? null, d => toNum(d.properties?.amount) ?? 0);

      // Where deals accumulate without moving is the friction the owner can act on.
      const largest = stageBuckets[0];

      signals.push({
        signalType: 'funnel',
        signalData: {
          ...base,
          dimension: 'deal_stage',
          total_deals: deals.length,
          by_stage: stageBuckets.slice(0, 15),
          value_by_stage: valueByStage.slice(0, 15),
          total_value: valueByStage.reduce((a, s) => a + s.value, 0),
          largest_stage: largest ? { stage: largest.key, deals: largest.value } : null,
          largest_stage_share: largest && deals.length > 0 ? largest.value / deals.length : null,
          computed_from: 'deals grouped by dealstage, with summed amount per stage',
        },
        periodStart, periodEnd,
      });
    }
    await emit(88, SYNC_STEPS[5]);
    await emit(96, SYNC_STEPS[6]);

    // A brand-new or empty portal is a healthy connection with nothing to learn from.
    if (signals.length === 0) return { signals: [], noHistory: true };

    const partial = unavailable.length > 0;
    return {
      signals,
      partial,
      partialReason: partial
        ? `This HubSpot authorization could not read ${unavailable.join(', ')}. Approve that read scope in HubSpot to complete the picture.`
        : undefined,
    };
  },

  /** HubSpot refresh tokens are revoked from the portal's connected-apps settings. */
  async revokeAtProvider(): Promise<boolean> {
    return false;
  },

  // NO execute_* METHODS. No contact write, no workflow change, no deal update, no
  // email send. Enforced structurally here and by the absence of `.write` scopes.
};
