/**
 * @file appStoreConnectClient.ts
 * @description Thin HTTP client for the App Store Connect API (api.appstoreconnect.apple.com).
 *
 *   Covers the two surfaces LaunchMind needs:
 *     - /v1/apps — the apps this API key may read
 *     - the Analytics Reports API — Apple's supported way to get product-page
 *       impressions, page views, downloads, sources, and territories:
 *         analyticsReportRequests → analyticsReports → instances → segments
 *       Segments are signed URLs to gzipped CSV, which this client downloads and parses.
 *
 *   Apple's analytics pipeline is genuinely asynchronous: a newly created report
 *   request has no instances for roughly a day. That is surfaced as "no history yet",
 *   not as an error, because the connection really is healthy.
 *
 * @security
 *   - Every request carries a freshly minted, ~15-minute ES256 assertion.
 *   - Apple error bodies are parsed for the machine-readable `code` only. Their
 *     `detail` strings are not echoed to owners: they can contain request context.
 *   - Segment URLs are pre-signed and short-lived; they are used immediately and
 *     never persisted.
 * @dependencies node:zlib, appleJwt, providers/types
 */

import { gunzipSync } from 'zlib';
import { signAppleAssertion, type AppleApiKeyCredential } from './appleJwt';
import { ProviderError } from './types';

const ASC_BASE = 'https://api.appstoreconnect.apple.com';

/** Apple caps most collections at 200 per page. */
const PAGE_LIMIT = 200;

/** Wall-clock ceiling for a single Apple call. */
const REQUEST_TIMEOUT_MS = 30_000;

/** An app visible to the authorized API key. */
export interface AppleApp {
  id:       string;
  name:     string;
  bundleId: string;
  sku:      string | null;
  primaryLocale: string | null;
}

/** One Analytics Reports API report. */
export interface AppleAnalyticsReport {
  id:       string;
  name:     string;
  category: string;
}

/** One dated instance of a report. */
export interface AppleReportInstance {
  id:             string;
  granularity:    string;
  processingDate: string;
}

/** A parsed report segment: header row plus data rows. */
export interface ParsedReport {
  reportName: string;
  columns:    string[];
  rows:       Array<Record<string, string>>;
}

/**
 * Maps an Apple HTTP failure onto a typed ProviderError.
 *
 * @param status - HTTP status from Apple
 * @param codes  - Machine-readable `errors[].code` values, when present
 * @security Apple's `detail` text is deliberately not used — it can echo request
 *   parameters. Owners get a stable message chosen from the code instead.
 */
function mapAppleError(status: number, codes: string[]): ProviderError {
  const code = codes[0] ?? '';

  if (status === 401 || code.startsWith('NOT_AUTHORIZED')) {
    return new ProviderError(
      'NEEDS_REAUTH',
      'App Store Connect rejected the stored key. It may have been revoked in Apple’s console — reconnect with a fresh key.',
    );
  }
  if (status === 403) {
    return new ProviderError(
      'PERMISSION_DENIED',
      'This App Store Connect key does not have permission to read analytics. Give the key the Admin, Finance, or Sales role in Apple’s console, then try again.',
    );
  }
  if (status === 404) {
    return new ProviderError(
      'WRONG_ACCOUNT',
      'That app is no longer visible to this App Store Connect key. Choose a different app, or reconnect with a key that can see it.',
    );
  }
  if (status === 429) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'App Store Connect is rate-limiting requests right now. LaunchMind will try again shortly — nothing was changed.',
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'App Store Connect is temporarily unavailable. Your connection and existing data are unchanged.',
    );
  }
  return new ProviderError(
    'SYNC_FAILED',
    'App Store Connect refused the request. Nothing was changed in your account.',
  );
}

/** Client bound to one App Store Connect API key. */
export class AppStoreConnectClient {
  constructor(private readonly credential: AppleApiKeyCredential) {}

  /**
   * Performs an authenticated JSON request against the App Store Connect API.
   * @throws {ProviderError} Typed by HTTP status / Apple error code
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await signAppleAssertion(this.credential);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(path.startsWith('http') ? path : `${ASC_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        aborted
          ? 'App Store Connect did not respond in time. Nothing was changed.'
          : 'Could not reach App Store Connect. Your connection and existing data are unchanged.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let codes: string[] = [];
      try {
        const body = (await res.json()) as { errors?: Array<{ code?: string }> };
        codes = (body.errors ?? []).map(e => e.code ?? '').filter(Boolean);
      } catch {
        // Non-JSON error body — status alone drives the mapping.
      }
      throw mapAppleError(res.status, codes);
    }

    return (await res.json()) as T;
  }

  /**
   * Lists every app this key can read, following pagination.
   *
   * This is also the cheapest proof that the credential works, so verifyCredential
   * uses the same endpoint with a limit of 1.
   *
   * @param limit - Page size (Apple caps at 200)
   * @returns Real apps. An empty array means Apple genuinely reported none.
   */
  async listApps(limit = PAGE_LIMIT): Promise<AppleApp[]> {
    const apps: AppleApp[] = [];
    let next: string | null =
      `/v1/apps?limit=${limit}&fields[apps]=name,bundleId,sku,primaryLocale`;

    // Bounded so a malformed paging cursor cannot loop forever.
    for (let page = 0; next && page < 20; page++) {
      const body: {
        data: Array<{ id: string; attributes: Record<string, string | null> }>;
        links?: { next?: string };
      } = await this.request(next);

      for (const row of body.data ?? []) {
        apps.push({
          id:            row.id,
          name:          (row.attributes?.name as string) ?? row.id,
          bundleId:      (row.attributes?.bundleId as string) ?? '',
          sku:           (row.attributes?.sku as string | null) ?? null,
          primaryLocale: (row.attributes?.primaryLocale as string | null) ?? null,
        });
      }
      next = body.links?.next ?? null;
    }

    return apps;
  }

  /** Fetches one app, or null when this key cannot see it. */
  async getApp(appId: string): Promise<AppleApp | null> {
    try {
      const body: { data: { id: string; attributes: Record<string, string | null> } } =
        await this.request(`/v1/apps/${encodeURIComponent(appId)}?fields[apps]=name,bundleId,sku,primaryLocale`);
      return {
        id:            body.data.id,
        name:          (body.data.attributes?.name as string) ?? body.data.id,
        bundleId:      (body.data.attributes?.bundleId as string) ?? '',
        sku:           (body.data.attributes?.sku as string | null) ?? null,
        primaryLocale: (body.data.attributes?.primaryLocale as string | null) ?? null,
      };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'WRONG_ACCOUNT') return null;
      throw err;
    }
  }

  /**
   * Returns the ONGOING analytics report request for an app, creating one if needed.
   *
   * Apple requires an explicit opt-in per app before it will generate analytics
   * reports, and returns 409 if a request of the same access type already exists —
   * so a conflict is a success path, not an error.
   *
   * @returns The report request id
   */
  async ensureAnalyticsReportRequest(appId: string): Promise<string> {
    const existing = await this.findAnalyticsReportRequest(appId);
    if (existing) return existing;

    try {
      const body: { data: { id: string } } = await this.request('/v1/analyticsReportRequests', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'analyticsReportRequests',
            attributes: { accessType: 'ONGOING' },
            relationships: { app: { data: { type: 'apps', id: appId } } },
          },
        }),
      });
      return body.data.id;
    } catch (err) {
      // 409 → someone (or a previous sync) already created it. Re-read.
      const again = await this.findAnalyticsReportRequest(appId);
      if (again) return again;
      throw err;
    }
  }

  /** @returns The id of an existing non-stopped ONGOING request, or null. */
  private async findAnalyticsReportRequest(appId: string): Promise<string | null> {
    const body: {
      data: Array<{ id: string; attributes?: { accessType?: string; stoppedDueToInactivity?: boolean } }>;
    } = await this.request(
      `/v1/apps/${encodeURIComponent(appId)}/analyticsReportRequests?limit=50`,
    );

    const match = (body.data ?? []).find(
      r => r.attributes?.accessType === 'ONGOING' && r.attributes?.stoppedDueToInactivity !== true,
    );
    return match?.id ?? null;
  }

  /**
   * Lists the reports available under a request, optionally filtered by category.
   * @param category - e.g. 'APP_STORE_ENGAGEMENT', 'COMMERCE', 'APP_USAGE'
   */
  async listReports(requestId: string, category?: string): Promise<AppleAnalyticsReport[]> {
    const filter = category ? `&filter[category]=${encodeURIComponent(category)}` : '';
    const body: {
      data: Array<{ id: string; attributes?: { name?: string; category?: string } }>;
    } = await this.request(
      `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?limit=${PAGE_LIMIT}${filter}`,
    );

    return (body.data ?? []).map(r => ({
      id:       r.id,
      name:     r.attributes?.name ?? '',
      category: r.attributes?.category ?? category ?? '',
    }));
  }

  /**
   * Lists dated instances of a report, newest first.
   * An empty array means Apple has not produced data for this report yet.
   */
  async listReportInstances(reportId: string, granularity = 'DAILY'): Promise<AppleReportInstance[]> {
    const body: {
      data: Array<{ id: string; attributes?: { granularity?: string; processingDate?: string } }>;
    } = await this.request(
      `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances` +
      `?limit=${PAGE_LIMIT}&filter[granularity]=${encodeURIComponent(granularity)}`,
    );

    return (body.data ?? [])
      .map(i => ({
        id:             i.id,
        granularity:    i.attributes?.granularity ?? granularity,
        processingDate: i.attributes?.processingDate ?? '',
      }))
      .sort((a, b) => b.processingDate.localeCompare(a.processingDate));
  }

  /**
   * Downloads and parses every segment of a report instance.
   *
   * Segments are pre-signed URLs to gzipped, tab-separated files. They are fetched
   * WITHOUT the Authorization header — the signature is the authorization, and
   * attaching a bearer token to a third-party storage URL would leak it.
   *
   * @returns Parsed rows across all segments, or null when the instance has none
   */
  async downloadReportInstance(instanceId: string, reportName: string): Promise<ParsedReport | null> {
    const body: {
      data: Array<{ attributes?: { url?: string; sizeInBytes?: number } }>;
    } = await this.request(
      `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments?limit=${PAGE_LIMIT}`,
    );

    const segments = (body.data ?? [])
      .map(s => s.attributes?.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    if (segments.length === 0) return null;

    let columns: string[] = [];
    const rows: Array<Record<string, string>> = [];

    for (const url of segments) {
      const parsed = await this.downloadSegment(url);
      if (!parsed) continue;
      if (columns.length === 0) columns = parsed.columns;
      rows.push(...parsed.rows);
    }

    if (columns.length === 0) return null;
    return { reportName, columns, rows };
  }

  /**
   * Fetches one pre-signed segment URL and parses the gzipped TSV inside.
   * @security No Authorization header is sent — the URL is already signed, and
   *   forwarding a bearer token to Apple's CDN host would expose it.
   */
  private async downloadSegment(url: string): Promise<{ columns: string[]; rows: Array<Record<string, string>> } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'A report file from App Store Connect could not be downloaded. Nothing was changed.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'A report file from App Store Connect could not be downloaded. Nothing was changed.',
      );
    }

    const raw = Buffer.from(await res.arrayBuffer());
    let text: string;
    try {
      // Apple gzips these; tolerate an already-decompressed body too.
      text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf-8');
    } catch {
      throw new ProviderError('SYNC_FAILED', 'A report file from App Store Connect could not be read.');
    }

    return parseDelimited(text);
  }
}

/**
 * Parses Apple's analytics report format: a header line then data lines, tab
 * separated. Falls back to comma separation if no tabs are present.
 *
 * @param text - Decompressed report contents
 * @returns Column names and row objects, or null when there is no data line
 */
export function parseDelimited(text: string): { columns: string[]; rows: Array<Record<string, string>> } | null {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
  if (lines.length < 2) return null;

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const columns = lines[0].split(delimiter).map(c => c.trim());

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter);
    const row: Record<string, string> = {};
    columns.forEach((col, idx) => { row[col] = (cells[idx] ?? '').trim(); });
    rows.push(row);
  }

  return { columns, rows };
}
