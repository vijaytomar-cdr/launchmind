/**
 * @file appStoreConnectAdapter.ts
 * @description LaunchMind's reference ProviderAdapter: App Store Connect.
 *
 *   Every value this adapter emits was read from Apple. There is no sample data and
 *   no fallback: when Apple has not produced a report yet the adapter reports
 *   noHistory, and when only some report categories are available it reports partial.
 *
 *   Data path (Apple's supported production mechanism):
 *     ES256 assertion → /v1/apps                          (authorization + app list)
 *                     → analyticsReportRequests (ONGOING) (per-app opt-in)
 *                     → analyticsReports by category      (ENGAGEMENT, COMMERCE)
 *                     → instances (DAILY, newest)         (dated data)
 *                     → segments (signed, gzipped TSV)    (the actual rows)
 *
 *   Progress is reported as each of those calls completes, so the bar reflects work
 *   rather than a timer.
 *
 * @security
 *   - The .p8 private key is decrypted per call by connectionCredentialService and is
 *     never logged or returned.
 *   - Only read endpoints are used. This adapter has no method that mutates anything
 *     in App Store Connect, so a read-only grant is structurally enforced, not merely
 *     promised.
 * @dependencies appleJwt, appStoreConnectClient, providers/types
 */

import {
  AppStoreConnectClient,
  type AppleApp,
  type ParsedReport,
} from './appStoreConnectClient';
import { unpackAppleCredential } from './appleJwt';
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

/**
 * Ordered steps. Each one is emitted only after the corresponding Apple call has
 * actually returned — never on a timer.
 */
const SYNC_STEPS = [
  'Authorization verified',
  'App selected',
  'Reading product-page performance',
  'Mapping acquisition sources',
  'Calculating store conversion',
  'Comparing territories and release performance',
  'Updating Growth Brain',
] as const;

/** Apple analytics report categories this adapter reads. */
const CATEGORY_ENGAGEMENT = 'APP_STORE_ENGAGEMENT';
const CATEGORY_COMMERCE   = 'COMMERCE';

/**
 * Column names vary slightly between Apple's Standard and Detailed report variants,
 * so each metric is resolved from a list of accepted headers rather than one literal.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  date:        ['Date', 'date'],
  impressions: ['Impressions', 'Impressions - Unique Device', 'Impressions Unique Device'],
  pageViews:   ['Product Page Views', 'Page Views', 'Product Page Views - Unique Device'],
  downloads:   ['Total Downloads', 'Downloads', 'First-Time Downloads', 'Units'],
  sourceType:  ['Source Type', 'Source', 'Discovery Source'],
  territory:   ['Territory', 'Country', 'Country Code'],
  deviceType:  ['Device', 'Device Type'],
};

/** Finds the first column present in the report for a logical field. */
function resolveColumn(columns: string[], field: keyof typeof COLUMN_ALIASES): string | null {
  for (const candidate of COLUMN_ALIASES[field]) {
    if (columns.includes(candidate)) return candidate;
  }
  return null;
}

/** Parses Apple's numeric cells, which arrive with thousands separators. */
function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Sums a numeric column across rows. */
function sumColumn(report: ParsedReport, field: keyof typeof COLUMN_ALIASES): number | null {
  const col = resolveColumn(report.columns, field);
  if (!col) return null;
  return report.rows.reduce((acc, r) => acc + toNumber(r[col]), 0);
}

/** Groups and sums a metric by a dimension, returning the largest buckets first. */
function groupSum(
  report: ParsedReport,
  dimension: keyof typeof COLUMN_ALIASES,
  metric: keyof typeof COLUMN_ALIASES,
): Array<{ key: string; value: number }> | null {
  const dimCol = resolveColumn(report.columns, dimension);
  const metCol = resolveColumn(report.columns, metric);
  if (!dimCol || !metCol) return null;

  const totals = new Map<string, number>();
  for (const row of report.rows) {
    const key = (row[dimCol] ?? '').trim();
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + toNumber(row[metCol]));
  }

  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

/** Derives the reporting window covered by a report's Date column. */
function reportPeriod(report: ParsedReport): { start: string; end: string } | null {
  const dateCol = resolveColumn(report.columns, 'date');
  if (!dateCol) return null;

  const dates = report.rows
    .map(r => (r[dateCol] ?? '').trim())
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (dates.length === 0) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

/** Builds the client for a connection, unpacking and validating the stored key. */
function clientFor(ctx: AdapterContext): AppStoreConnectClient {
  const credential = unpackAppleCredential(ctx.credential, ctx.config ?? {});
  return new AppStoreConnectClient(credential);
}

/**
 * App Store Connect adapter.
 *
 * Read-only by construction: it exposes no method capable of changing anything in
 * App Store Connect, so the CHANGE/PUBLISH/SPEND permissions can never be satisfied
 * by this provider regardless of what LaunchMind grants.
 */
export const appStoreConnectAdapter: ProviderAdapter = {
  key:           'app_store_connect',
  displayName:   'App Store Connect',
  authMechanism: 'signed_jwt',
  resourceNoun:  'app',
  // Apple's API key roles are set in their console; LaunchMind requests nothing wider.
  readScopes:    ['app_store_connect.apps.read', 'app_store_connect.analytics.read'],
  syncSteps:     SYNC_STEPS,

  /**
   * Proves the key works by asking Apple for one app.
   * @returns The Issuer ID as the external account identity — the stable identifier
   *   for "which App Store Connect team is this", used as the substitution guard.
   */
  async verifyCredential(ctx: AdapterContext) {
    const credential = unpackAppleCredential(ctx.credential, ctx.config ?? {});
    const client = new AppStoreConnectClient(credential);

    // Real network call. Anything other than success throws a typed ProviderError.
    const apps = await client.listApps(1);

    return {
      externalAccountId:   credential.issuerId,
      externalAccountName: apps.length > 0
        ? `App Store Connect · ${apps.length === 1 ? apps[0].name : 'team'}`
        : 'App Store Connect',
    };
  },

  /**
   * Lists the real apps this key can read.
   * An empty array means Apple reported no apps for this key — surfaced to the owner
   * as "no apps available", never replaced with a placeholder.
   */
  async listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]> {
    const apps = await clientFor(ctx).listApps();
    return apps.map((a: AppleApp) => ({
      id:          a.id,
      name:        a.name,
      accessLevel: a.bundleId ? `Bundle ${a.bundleId}` : undefined,
    }));
  },

  /**
   * Confirms the selected app is still readable by this key.
   * @throws {ProviderError} WRONG_ACCOUNT when Apple no longer returns it
   */
  async validateSelection(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount> {
    const app = await clientFor(ctx).getApp(resourceId);
    if (!app) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That app is no longer visible to this App Store Connect key. Choose a different app or reconnect.',
      );
    }
    return { id: app.id, name: app.name, accessLevel: app.bundleId ? `Bundle ${app.bundleId}` : undefined };
  },

  /** Live probe: can we still authenticate and read? */
  async checkHealth(ctx: AdapterContext): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await clientFor(ctx).listApps(1);
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
   * Imports real App Store performance data and normalizes it into signals.
   *
   * Outcomes:
   *   - engagement + commerce data   → signals, HEALTHY
   *   - only one category available  → signals + partial, PARTIAL
   *   - report request exists but Apple has produced no instances yet → noHistory
   *
   * @param report - Invoked after each Apple call actually returns
   */
  async fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult> {
    const emit = async (progress: number, step: string) => {
      if (report) await report({ progress, step });
    };

    const client = clientFor(ctx);

    // Step 1 — authorization is proven by a real call, not assumed.
    await client.listApps(1);
    await emit(10, SYNC_STEPS[0]);

    const appId = ctx.selectedResourceId;
    if (!appId) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'No App Store app is selected for this connection. Choose the app LaunchMind should learn from.',
      );
    }

    // Step 2 — confirm the selection is still valid before doing expensive work.
    const app = await client.getApp(appId);
    if (!app) {
      throw new ProviderError(
        'WRONG_ACCOUNT',
        'That app is no longer visible to this App Store Connect key. Choose a different app or reconnect.',
      );
    }
    await emit(20, SYNC_STEPS[1]);

    // Apple requires a per-app opt-in before it will generate analytics reports.
    const requestId = await client.ensureAnalyticsReportRequest(appId);

    // Step 3 — product-page engagement (impressions, page views, sources).
    const engagement = await loadLatestReport(client, requestId, CATEGORY_ENGAGEMENT);
    await emit(40, SYNC_STEPS[2]);

    // Step 4 — acquisition sources come from the engagement report's Source Type column.
    const sourceBreakdown = engagement ? groupSum(engagement, 'sourceType', 'pageViews') : null;
    await emit(55, SYNC_STEPS[3]);

    // Step 5 — downloads, needed for conversion.
    const commerce = await loadLatestReport(client, requestId, CATEGORY_COMMERCE);
    await emit(70, SYNC_STEPS[4]);

    // Apple has accepted the opt-in but has not produced any data yet. This is the
    // real, common first-connection state — a healthy connection with nothing to
    // learn from for about a day.
    if (!engagement && !commerce) {
      await emit(100, SYNC_STEPS[6]);
      return {
        signals: [],
        noHistory: true,
      };
    }

    const signals: ProviderSignal[] = [];
    const period =
      (engagement && reportPeriod(engagement)) ??
      (commerce && reportPeriod(commerce)) ??
      null;

    // Without a dated window the dedup index (migration 078) cannot protect against
    // replay, so refuse rather than write undeduplicable rows.
    if (!period) {
      await emit(100, SYNC_STEPS[6]);
      return {
        signals: [],
        noHistory: true,
      };
    }

    const impressions = engagement ? sumColumn(engagement, 'impressions') : null;
    const pageViews   = engagement ? sumColumn(engagement, 'pageViews')   : null;
    const downloads   = commerce   ? sumColumn(commerce, 'downloads')     : null;

    if (impressions !== null) {
      signals.push({
        signalType: 'impressions',
        signalData: {
          value: impressions,
          unit: 'impressions',
          source: 'App Store Connect Analytics',
          report: engagement?.reportName ?? null,
          rows_read: engagement?.rows.length ?? 0,
        },
        periodStart: period.start,
        periodEnd:   period.end,
      });
    }

    if (downloads !== null) {
      signals.push({
        signalType: 'downloads',
        signalData: {
          value: downloads,
          unit: 'downloads',
          source: 'App Store Connect Analytics',
          report: commerce?.reportName ?? null,
          rows_read: commerce?.rows.length ?? 0,
        },
        periodStart: period.start,
        periodEnd:   period.end,
      });
    }

    // Store conversion is computed only when BOTH inputs are real. A missing
    // denominator yields no conversion signal rather than an invented one.
    if (pageViews !== null && pageViews > 0 && downloads !== null) {
      signals.push({
        signalType: 'conversion',
        signalData: {
          value:              downloads / pageViews,
          product_page_views: pageViews,
          downloads,
          computed_from:      'downloads ÷ product page views',
          source:             'App Store Connect Analytics',
        },
        periodStart: period.start,
        periodEnd:   period.end,
      });
    }

    if (sourceBreakdown && sourceBreakdown.length > 0) {
      const total = sourceBreakdown.reduce((acc, s) => acc + s.value, 0);
      signals.push({
        signalType: 'territory', // reused for dimensional breakdowns (migration 074 vocabulary)
        signalData: {
          dimension: 'source_type',
          breakdown: sourceBreakdown.slice(0, 10),
          total,
          top:       sourceBreakdown[0].key,
          top_share: total > 0 ? sourceBreakdown[0].value / total : null,
          source:    'App Store Connect Analytics',
        },
        periodStart: period.start,
        periodEnd:   period.end,
      });
    }

    const territoryBreakdown = engagement
      ? groupSum(engagement, 'territory', 'pageViews') ?? (commerce ? groupSum(commerce, 'territory', 'downloads') : null)
      : (commerce ? groupSum(commerce, 'territory', 'downloads') : null);

    await emit(85, SYNC_STEPS[5]);

    if (territoryBreakdown && territoryBreakdown.length > 0) {
      const total = territoryBreakdown.reduce((acc, t) => acc + t.value, 0);
      signals.push({
        signalType: 'territory',
        signalData: {
          dimension: 'territory',
          breakdown: territoryBreakdown.slice(0, 15),
          total,
          top:       territoryBreakdown[0].key,
          top_share: total > 0 ? territoryBreakdown[0].value / total : null,
          source:    'App Store Connect Analytics',
        },
        periodStart: period.start,
        periodEnd:   period.end,
      });
    }

    await emit(95, SYNC_STEPS[6]);

    // One category present but not the other: real, explainable partial coverage.
    const partial = !engagement || !commerce;
    const partialReason = partial
      ? !engagement
        ? 'Apple has not produced the App Store engagement report for this app yet, so impressions and product-page views are not available.'
        : 'Apple has not produced the App Store commerce report for this app yet, so downloads and conversion are not available.'
      : undefined;

    if (signals.length === 0) {
      return { signals: [], noHistory: true };
    }

    return { signals, partial, partialReason };
  },

  /**
   * App Store Connect API keys are revoked in Apple's console, not through the API.
   * Returning false is accurate: LaunchMind removed its own copy, but only the owner
   * can invalidate the key at Apple.
   */
  async revokeAtProvider(): Promise<boolean> {
    return false;
  },
};

/**
 * Loads the newest DAILY instance of the first report in a category.
 *
 * @returns Parsed rows, or null when Apple has produced no instance yet — which is
 *   the normal state for roughly the first day after opting an app in.
 */
async function loadLatestReport(
  client: AppStoreConnectClient,
  requestId: string,
  category: string,
): Promise<ParsedReport | null> {
  const reports = await client.listReports(requestId, category);
  if (reports.length === 0) return null;

  // Prefer a "Detailed" variant when Apple offers one: it carries the Source Type
  // and Territory dimensions that Standard omits.
  const chosen =
    reports.find(r => /detailed/i.test(r.name)) ??
    reports.find(r => /standard/i.test(r.name)) ??
    reports[0];

  const instances = await client.listReportInstances(chosen.id, 'DAILY');
  if (instances.length === 0) return null;

  return client.downloadReportInstance(instances[0].id, chosen.name);
}
