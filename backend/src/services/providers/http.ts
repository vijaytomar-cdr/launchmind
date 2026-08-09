/**
 * @file http.ts
 * @description Shared HTTP layer for provider adapters.
 *
 *   Every provider maps the same HTTP failures onto the same LaunchMind recovery
 *   states, so that mapping lives here once rather than being re-derived (and
 *   re-diverged) in each adapter. App Store Connect keeps its own client because its
 *   error bodies and report pipeline are genuinely provider-shaped; everything from
 *   Step 4 onward uses this.
 *
 * @security
 *   - Provider error BODIES are never surfaced. They routinely echo the request,
 *     including query parameters and sometimes the credential. Only the HTTP status
 *     and a provider-supplied machine code influence the message an owner sees.
 *   - Bearer tokens are attached here and never logged.
 *   - Every request is time-bounded, so a hanging provider cannot pin a worker.
 * @dependencies providers/types
 */

import { ProviderError, type ProviderErrorKind } from './types';

/** Wall-clock ceiling for any single provider call. */
export const PROVIDER_TIMEOUT_MS = 30_000;

/** Owner-facing text per recovery state. Deliberately provider-neutral. */
const DEFAULT_MESSAGES: Record<ProviderErrorKind, (name: string) => string> = {
  NEEDS_REAUTH: n =>
    `${n} rejected the stored credential. It may have been rotated or revoked — reconnect to continue.`,
  PERMISSION_DENIED: n =>
    `This ${n} credential does not have permission to read the data LaunchMind needs. Grant read access and try again.`,
  WRONG_ACCOUNT: n =>
    `That ${n} resource is no longer available to this credential. Choose a different one, or reconnect.`,
  PROVIDER_UNAVAILABLE: n =>
    `${n} is temporarily unavailable. Your connection and existing data are unchanged.`,
  ADAPTER_UNAVAILABLE: n => `${n} is not available to connect yet.`,
  SYNC_FAILED: n =>
    `${n} refused the request. Nothing was changed in your account.`,
};

/**
 * Maps an HTTP status onto a recovery state.
 *
 * 400 is deliberately SYNC_FAILED rather than NEEDS_REAUTH: a malformed request is
 * our bug, and telling the owner to reconnect would send them to fix something that
 * is not broken on their side.
 */
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401) return 'NEEDS_REAUTH';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'WRONG_ACCOUNT';
  if (status === 429) return 'PROVIDER_UNAVAILABLE';
  if (status >= 500)  return 'PROVIDER_UNAVAILABLE';
  return 'SYNC_FAILED';
}

/** Builds a typed error for a provider HTTP failure. */
export function providerHttpError(
  providerName: string,
  status: number,
  overrideKind?: ProviderErrorKind,
): ProviderError {
  const kind = overrideKind ?? kindForStatus(status);
  return new ProviderError(kind, DEFAULT_MESSAGES[kind](providerName));
}

export interface ProviderRequestOptions {
  /** Human provider name used in owner-facing messages. */
  providerName: string;
  method?: 'GET' | 'POST';
  /** Bearer token. Never logged. */
  bearer?: string;
  headers?: Record<string, string>;
  /** JSON body (POST). */
  json?: unknown;
  /** Form-encoded body (POST) — Stripe's API expects this. */
  form?: URLSearchParams;
  /**
   * Reads a machine-readable error code out of the provider's error body so a
   * status alone does not have to carry all the meaning. The BODY ITSELF is
   * discarded; only the returned kind is used.
   */
  classifyError?: (status: number, body: unknown) => ProviderErrorKind | null;
}

/**
 * Performs one authenticated provider request and returns parsed JSON.
 *
 * @throws {ProviderError} Typed by status, or by `classifyError` when supplied
 * @security The provider's error body is parsed only to extract a code and is never
 *   attached to the thrown error, logged, or returned.
 */
export async function providerRequest<T>(
  url: string,
  opts: ProviderRequestOptions,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;

  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = opts.form.toString();
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: controller.signal });
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      aborted
        ? `${opts.providerName} did not respond in time. Nothing was changed.`
        : `Could not reach ${opts.providerName}. Your connection and existing data are unchanged.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let parsed: unknown = null;
    if (opts.classifyError) {
      try { parsed = await res.json(); } catch { /* status alone drives the mapping */ }
    }
    const override = opts.classifyError ? opts.classifyError(res.status, parsed) ?? undefined : undefined;
    throw providerHttpError(opts.providerName, res.status, override);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(
      'SYNC_FAILED',
      `${opts.providerName} returned a response LaunchMind could not read. Nothing was changed.`,
    );
  }
}

// ── Shared derivation helpers ─────────────────────────────────────────────────

/** Coerces a provider's numeric field, which may arrive as a string. */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** ISO date (YYYY-MM-DD) `days` before now, in UTC. */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Today's ISO date in UTC. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Unix seconds `days` before now — Stripe's `created[gte]` filter format. */
export function unixDaysAgo(days: number): number {
  return Math.floor((Date.now() - days * 86_400_000) / 1000);
}

/**
 * Groups rows and sums a metric, largest first.
 * @returns Buckets, or [] when nothing groups
 */
export function groupAndSum<T>(
  rows: T[],
  keyOf: (row: T) => string | null,
  valueOf: (row: T) => number,
): Array<{ key: string; value: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + valueOf(row));
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

/** Builds a share-of-total breakdown signal payload, or null when there is no data. */
export function breakdownPayload(
  dimension: string,
  buckets: Array<{ key: string; value: number }>,
  source: string,
  limit = 15,
): Record<string, unknown> | null {
  if (buckets.length === 0) return null;
  const total = buckets.reduce((acc, b) => acc + b.value, 0);
  if (total <= 0) return null;
  return {
    dimension,
    breakdown: buckets.slice(0, limit),
    total,
    top: buckets[0].key,
    top_share: buckets[0].value / total,
    source,
  };
}
