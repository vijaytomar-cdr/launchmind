/**
 * @file stripeAdapter.ts
 * @description Stripe observation adapter (revenue intelligence). READ ONLY.
 *
 *   Authentication: a Stripe RESTRICTED API key (`rk_live_…` / `rk_test_…`) created in
 *   the Stripe dashboard with read permissions. Stripe Connect OAuth exists but
 *   requires LaunchMind to be a registered Connect platform and is aimed at
 *   acting on behalf of connected accounts — a restricted key is the supported
 *   mechanism for a founder granting read access to their own account, and it is
 *   narrower. oauthConfig retains the Connect template for a future platform setup.
 *
 *   Data path (all GET, all real):
 *     /v1/account              authorization + account identity
 *     /v1/balance_transactions gross revenue and fees actually settled
 *     /v1/charges              payments, including failures
 *     /v1/refunds              refunds
 *     /v1/subscriptions        subscription mix
 *
 * @security
 *   - Every request is a GET. This adapter cannot create a charge, issue a refund,
 *     change a price, or modify a subscription — read-only is structural.
 *   - A key that is not restricted still works, but LaunchMind never uses a write
 *     endpoint, so the granted authority is never exercised.
 *   - Customer-level PII is never imported: only counts and aggregates.
 * @dependencies providers/http, providers/types
 */

import { providerRequest, toNum, isoDaysAgo, isoToday, unixDaysAgo, groupAndSum, breakdownPayload } from './http';
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

const API  = 'https://api.stripe.com/v1';
const NAME = 'Stripe';
const WINDOW_DAYS = 30;

const SYNC_STEPS = [
  'Authorization verified',
  'Account selected',
  'Reading payments and revenue',
  'Mapping subscription behaviour',
  'Analysing failures and refunds',
  'Deriving monetization signals',
  'Updating Growth Brain',
] as const;

interface StripeList<T> { data?: T[]; has_more?: boolean }
interface StripeCharge {
  amount?: number; currency?: string; status?: string; paid?: boolean;
  refunded?: boolean; created?: number;
  failure_code?: string | null;
}
interface StripeBalanceTx { amount?: number; fee?: number; net?: number; type?: string; created?: number }
interface StripeRefund { amount?: number; created?: number; reason?: string | null }
interface StripeSubscription {
  status?: string;
  items?: { data?: Array<{ price?: { id?: string; nickname?: string | null; unit_amount?: number | null; recurring?: { interval?: string } | null } }> };
}

/**
 * Stripe reports a machine-readable error type. `invalid_request_error` on a read
 * endpoint almost always means the restricted key lacks that resource permission,
 * which is a permission problem the owner can fix — not a generic failure.
 */
function classifyStripe(status: number, body: unknown): 'PERMISSION_DENIED' | null {
  const type = (body as { error?: { type?: string } } | null)?.error?.type;
  if (status === 400 && type === 'invalid_request_error') return 'PERMISSION_DENIED';
  return null;
}

function get<T>(path: string, credential: string): Promise<T> {
  return providerRequest<T>(`${API}${path}`, {
    providerName: NAME,
    bearer: credential,
    classifyError: classifyStripe,
  });
}

/** Stripe amounts are in the currency's minor unit. */
function minorToMajor(minor: number): number {
  return minor / 100;
}

export const stripeAdapter: ProviderAdapter = {
  key:           'stripe',
  displayName:   NAME,
  authMechanism: 'api_key',
  resourceNoun:  'account',
  readScopes:    ['stripe.balance.read', 'stripe.charges.read', 'stripe.subscriptions.read'],
  syncSteps:     SYNC_STEPS,

  /** Proves the key and identifies the account it is bound to. */
  async verifyCredential(ctx: AdapterContext) {
    const account = await get<{ id?: string; business_profile?: { name?: string | null }; settings?: { dashboard?: { display_name?: string | null } } }>(
      '/account', ctx.credential,
    );

    if (!account.id) {
      throw new ProviderError('NEEDS_REAUTH', 'Stripe did not identify an account for this key. Reconnect with a restricted key from your Stripe dashboard.');
    }

    const name =
      account.settings?.dashboard?.display_name ??
      account.business_profile?.name ??
      account.id;

    return { externalAccountId: account.id, externalAccountName: `Stripe · ${name}` };
  },

  /**
   * A Stripe API key is bound to exactly one account, so there is exactly one
   * resource. The connect flow auto-selects it — this is the sanctioned
   * single-resource case, not a fabricated list.
   */
  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const account = await get<{ id?: string; business_profile?: { name?: string | null }; settings?: { dashboard?: { display_name?: string | null } }; country?: string }>(
      '/account', ctx.credential,
    );
    if (!account.id) return [];

    const name = account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? account.id;
    return [{ id: account.id, name, accessLevel: account.country ? `Country: ${account.country}` : undefined }];
  },

  /** Confirms the key still resolves to the bound account. */
  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const accounts = await this.listAccounts(ctx);
    const match = accounts.find(a => a.id === resourceId);
    if (!match) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'This Stripe key now belongs to a different account than the one connected. Reconnect with a key for the original account, or disconnect first.',
      );
    }
    return match;
  },

  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await get('/account', ctx.credential);
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
   * Imports realized revenue, payment reliability, and subscription mix.
   *
   * Each resource is fetched independently: a restricted key with charge access but
   * no subscription access yields PARTIAL with a specific explanation rather than a
   * blanket failure.
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => { if (report) await report({ progress, step }); };

    await get('/account', ctx.credential);
    await emit(10, SYNC_STEPS[0]);

    const accountId = ctx.selectedResourceId;
    if (!accountId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No Stripe account is bound to this connection. Reconnect to bind one.',
      );
    }
    await this.validateSelection?.(ctx, accountId);
    await emit(20, SYNC_STEPS[1]);

    const since = unixDaysAgo(WINDOW_DAYS);
    const periodStart = isoDaysAgo(WINDOW_DAYS);
    const periodEnd   = isoToday();
    const signals: ProviderSignal[] = [];
    const unavailable: string[] = [];
    const base = { source: 'Stripe API', account_id: accountId, window_days: WINDOW_DAYS };

    // Realized revenue from settled balance transactions — the honest figure, net of fees.
    let balanceTx: StripeBalanceTx[] | null = null;
    try {
      const res = await get<StripeList<StripeBalanceTx>>(
        `/balance_transactions?limit=100&created[gte]=${since}`, ctx.credential,
      );
      balanceTx = res.data ?? [];
    } catch (err) {
      if (err instanceof ProviderError && (err.kind === 'NEEDS_REAUTH')) throw err;
      unavailable.push('balance transactions');
    }
    await emit(38, SYNC_STEPS[2]);

    let charges: StripeCharge[] | null = null;
    try {
      const res = await get<StripeList<StripeCharge>>(
        `/charges?limit=100&created[gte]=${since}`, ctx.credential,
      );
      charges = res.data ?? [];
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'NEEDS_REAUTH') throw err;
      unavailable.push('charges');
    }

    if (balanceTx && balanceTx.length > 0) {
      const gross = balanceTx.filter(t => t.type === 'charge').reduce((a, t) => a + (toNum(t.amount) ?? 0), 0);
      const fees  = balanceTx.reduce((a, t) => a + (toNum(t.fee) ?? 0), 0);
      const net   = balanceTx.reduce((a, t) => a + (toNum(t.net) ?? 0), 0);

      signals.push({
        signalType: 'revenue',
        signalData: {
          ...base,
          gross_usd: minorToMajor(gross),
          fees_usd:  minorToMajor(fees),
          net_usd:   minorToMajor(net),
          transactions: balanceTx.length,
          computed_from: 'sum of balance_transactions in the window',
        },
        periodStart, periodEnd,
      });
    }

    // Subscription mix and MRR.
    let subscriptions: StripeSubscription[] | null = null;
    try {
      const res = await get<StripeList<StripeSubscription>>(
        '/subscriptions?limit=100&status=all', ctx.credential,
      );
      subscriptions = res.data ?? [];
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'NEEDS_REAUTH') throw err;
      unavailable.push('subscriptions');
    }
    await emit(56, SYNC_STEPS[3]);

    if (subscriptions && subscriptions.length > 0) {
      const active = subscriptions.filter(s => s.status === 'active' || s.status === 'trialing');

      // MRR is summed only from prices whose interval is known, normalizing yearly
      // to monthly. Anything without a resolvable interval is excluded rather than
      // guessed at.
      let mrrMinor = 0;
      let counted = 0;
      for (const sub of active) {
        for (const item of sub.items?.data ?? []) {
          const amount   = toNum(item.price?.unit_amount);
          const interval = item.price?.recurring?.interval;
          if (amount === null || !interval) continue;
          if (interval === 'month') { mrrMinor += amount; counted++; }
          else if (interval === 'year') { mrrMinor += amount / 12; counted++; }
        }
      }

      const planBuckets = groupAndSum(
        active,
        s => s.items?.data?.[0]?.price?.nickname ?? s.items?.data?.[0]?.price?.id ?? null,
        () => 1,
      );
      const planPayload = breakdownPayload('plan', planBuckets, 'Stripe API');

      signals.push({
        signalType: 'plan_movement',
        signalData: {
          ...base,
          total_subscriptions: subscriptions.length,
          active_subscriptions: active.length,
          trialing: subscriptions.filter(s => s.status === 'trialing').length,
          canceled: subscriptions.filter(s => s.status === 'canceled').length,
          past_due: subscriptions.filter(s => s.status === 'past_due').length,
          plans: planPayload,
        },
        periodStart, periodEnd,
      });

      if (counted > 0) {
        signals.push({
          signalType: 'mrr',
          signalData: {
            ...base,
            value_usd: minorToMajor(mrrMinor),
            priced_items_counted: counted,
            active_subscriptions: active.length,
            arpu_usd: active.length > 0 ? minorToMajor(mrrMinor) / active.length : null,
            computed_from: 'sum of active subscription item prices, yearly normalized to monthly',
          },
          periodStart, periodEnd,
        });
      }
    }

    // Payment reliability: failures and refunds.
    let refunds: StripeRefund[] | null = null;
    try {
      const res = await get<StripeList<StripeRefund>>(
        `/refunds?limit=100&created[gte]=${since}`, ctx.credential,
      );
      refunds = res.data ?? [];
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'NEEDS_REAUTH') throw err;
      unavailable.push('refunds');
    }
    await emit(74, SYNC_STEPS[4]);

    if (charges && charges.length > 0) {
      const failed = charges.filter(c => c.status === 'failed');
      const succeeded = charges.filter(c => c.status === 'succeeded');
      const refundedAmount = (refunds ?? []).reduce((a, r) => a + (toNum(r.amount) ?? 0), 0);
      const succeededAmount = succeeded.reduce((a, c) => a + (toNum(c.amount) ?? 0), 0);

      const failureReasons = groupAndSum(
        failed, c => c.failure_code ?? 'unknown', () => 1,
      );

      signals.push({
        signalType: 'conversion',
        signalData: {
          ...base,
          charges: charges.length,
          succeeded: succeeded.length,
          failed: failed.length,
          value: charges.length > 0 ? succeeded.length / charges.length : null,
          failure_rate: charges.length > 0 ? failed.length / charges.length : null,
          top_failure_reasons: failureReasons.slice(0, 5),
          refund_count: refunds ? refunds.length : null,
          refunded_usd: refunds ? minorToMajor(refundedAmount) : null,
          refund_rate_of_revenue: refunds && succeededAmount > 0 ? refundedAmount / succeededAmount : null,
          computed_from: 'succeeded ÷ total charges in the window',
        },
        periodStart, periodEnd,
      });
    }
    await emit(88, SYNC_STEPS[5]);
    await emit(96, SYNC_STEPS[6]);

    // A live account with no activity in the window is a healthy connection with
    // nothing to learn from yet.
    if (signals.length === 0) return { signals: [], noHistory: true };

    const partial = unavailable.length > 0;
    return {
      signals,
      partial,
      partialReason: partial
        ? `This Stripe key could not read ${unavailable.join(', ')}. Add those read permissions in Stripe to complete the picture.`
        : undefined,
    };
  },

  /** Restricted keys are revoked in the Stripe dashboard, not through the API. */
  async revokeAtProvider(): Promise<boolean> {
    return false;
  },
};
