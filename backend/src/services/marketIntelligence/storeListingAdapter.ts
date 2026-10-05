/**
 * @file storeListingAdapter.ts
 * @description Fetches a public store listing as an UNTRUSTED observation.
 *
 *   WHY THIS IS NOT `scraperWorker.scrapeAppStore`. That function builds a
 *   `ScrapedAppData` for intake: it carries description, screenshots and REVIEW
 *   TEXT, and it carries no dates at all. Market Intelligence needs the opposite
 *   shape — dates are the whole point, and review text is the one thing this
 *   subsystem must never persist. Reusing it would have meant either widening
 *   its schema (a regression risk to intake) or discarding most of it and still
 *   having no `observed_at`.
 *
 *   Uses the same store-native libraries, in the same sandboxed worker process,
 *   over the same egress. No new source class, no new network capability.
 *
 * @security Only apps.apple.com and play.google.com URLs are accepted; the URL
 *   is parsed for a provider id and the id is what is fetched, so a crafted URL
 *   cannot redirect the fetch elsewhere. Output is untrusted and goes through
 *   ingestionBoundary before it can become a record.
 * @dependencies app-store-scraper, google-play-scraper, contract
 */

import { providerIdFromStoreUrl } from './contract';
import type { RawStoreListing } from './ingestionBoundary';

export class StoreListingUnavailable extends Error {
  constructor(public readonly kind: 'UNSUPPORTED_URL' | 'NOT_FOUND' | 'PROVIDER_UNAVAILABLE', msg: string) {
    super(msg);
    this.name = 'StoreListingUnavailable';
  }
}

const TIMEOUT_MS = 15_000;

/**
 * Reads one public listing.
 *
 * @param storeUrl - an App Store or Play Store listing URL
 * @returns the raw listing, still untrusted
 * @throws {StoreListingUnavailable} on an unsupported URL or a provider failure.
 *   A provider outage is reported as unavailability, never as an empty listing —
 *   "no data" and "we could not look" are different answers and only one of them
 *   is about the market.
 */
export async function fetchStoreListing(storeUrl: string): Promise<RawStoreListing> {
  const id = providerIdFromStoreUrl(storeUrl);
  if (!id) {
    throw new StoreListingUnavailable('UNSUPPORTED_URL',
      'Only App Store and Play Store listing URLs are supported in this source class.');
  }

  const retrievedAt = new Date().toISOString();

  if (id.provider === 'app_store') {
    const mod = await import('app-store-scraper');
    const appFn = (mod as unknown as { app?: AppleAppFn; default?: { app?: AppleAppFn } }).app
      ?? (mod as unknown as { default?: { app?: AppleAppFn } }).default?.app;
    if (!appFn) throw new StoreListingUnavailable('PROVIDER_UNAVAILABLE', 'App Store client unavailable');

    const numericId = id.providerId.replace(/^id/, '');
    let r: AppleApp;
    try {
      r = await withTimeout(appFn({ id: numericId, country: id.storefront }));
    } catch (e) {
      throw providerFailure(e);
    }
    return {
      provider: 'app_store',
      storefront: id.storefront,
      providerId: id.providerId,
      sourceRef: r.url ?? storeUrl,
      name: r.title ?? '',
      developer: r.developer ?? '',
      // The short positioning line, NOT the full description.
      summary: firstLine(r.description),
      category: r.primaryGenre ?? null,
      rating: numOrNull(r.score),
      ratingCount: intOrNull(r.reviews),
      free: typeof r.free === 'boolean' ? r.free : null,
      updatedAt: r.updated ?? r.currentVersionReleaseDate ?? null,
      releasedAt: r.released ?? null,
      retrievedAt,
    };
  }

  const gp = (await import('google-play-scraper')).default;
  let r: PlayApp;
  try {
    r = await withTimeout((gp.app as unknown as (o: Record<string, unknown>) => Promise<PlayApp>)({
      appId: id.providerId, lang: 'en', country: id.storefront,
    }));
  } catch (e) {
    throw providerFailure(e);
  }
  return {
    provider: 'play_store',
    storefront: id.storefront,
    providerId: id.providerId,
    sourceRef: r.url ?? storeUrl,
    name: r.title ?? '',
    developer: r.developer ?? '',
    summary: r.summary ?? firstLine(r.description),
    category: r.genre ?? null,
    rating: numOrNull(r.score),
    ratingCount: intOrNull(r.ratings),
    free: typeof r.free === 'boolean' ? r.free : null,
    // Play returns a millisecond epoch.
    updatedAt: typeof r.updated === 'number' ? new Date(r.updated).toISOString() : null,
    releasedAt: r.released ?? null,
    retrievedAt,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

interface AppleApp {
  url?: string; title?: string; developer?: string; description?: string;
  primaryGenre?: string; score?: number; reviews?: number; free?: boolean;
  updated?: string; currentVersionReleaseDate?: string; released?: string;
}
type AppleAppFn = (o: { id: string; country: string }) => Promise<AppleApp>;

interface PlayApp {
  url?: string; title?: string; developer?: string; description?: string;
  summary?: string; genre?: string; score?: number; ratings?: number;
  free?: boolean; updated?: number; released?: string;
}

function providerFailure(e: unknown): StoreListingUnavailable {
  const msg = e instanceof Error ? e.message : String(e);
  if (/404|not found/i.test(msg)) {
    return new StoreListingUnavailable('NOT_FOUND', 'That listing does not exist in this storefront.');
  }
  // The provider's own message is not echoed onward: it can carry request
  // context, and the owner-facing answer is the same either way.
  return new StoreListingUnavailable('PROVIDER_UNAVAILABLE',
    'The store could not be reached right now.');
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error('store listing fetch timed out')), TIMEOUT_MS)),
  ]);
}

/** The lead line of a description — a positioning statement, not the whole page. */
function firstLine(desc: string | undefined): string | null {
  if (!desc) return null;
  const line = desc.split(/\r?\n/).map(s => s.trim()).find(Boolean);
  return line ? line.slice(0, 400) : null;
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
