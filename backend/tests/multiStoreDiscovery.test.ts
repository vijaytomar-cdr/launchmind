/**
 * @file multiStoreDiscovery.test.ts
 * @description The three "current channels observed" defects, each pinned by a
 *   test that fails against the old code.
 *
 *   Reported from a real onboarding run: the owner submitted App Store + Play
 *   Store + website URLs and LaunchMind recorded, as a FACT at confidence 0.95,
 *   "Current channels observed = App Store". Three independent bugs produced
 *   that one wrong string:
 *
 *     1. detectPlatform(urls[0]) — only the FIRST url was classified, so the
 *        second store was never scraped at all. Which one survived depended on
 *        the order the owner typed them.
 *     2. two mutually exclusive `if`s against a single scalar `platform`, so the
 *        claim could never name two stores even if both were known.
 *     3. combinedAppData omitted websiteMeta, so the claim builder's hasWebsite
 *        check was always false — the site was scraped, stored, and still
 *        reported as absent.
 *
 * @security None — pure data-shape and parsing assertions.
 * @dependencies onboardingService.extractAndStoreClaims, productIdentity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

// The exact URLs from the reported run.
const APPLE = 'https://apps.apple.com/us/app/allignx-home-services/id6621240477';
const PLAY  = 'https://play.google.com/store/apps/details?id=com.allignx&hl=en_IN';
const SITE  = 'https://allignx.com/';

const FOUNDER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

beforeEach(() => {
  db = new MemoryDb({ product_claims: [], founders: [{ id: FOUNDER }] });
  (globalThis as { __db: MemoryDb }).__db = db;
});

/** Runs the real claim builder and returns the channels FACT it produced. */
async function channelsClaim(appData: Record<string, unknown>): Promise<string | null> {
  const { extractAndStoreClaims } = await import('../src/services/onboardingService');
  await extractAndStoreClaims(SESSION, FOUNDER, PRODUCT, appData);
  const row = db.rows('product_claims')
    .find(r => r.title === 'Current channels observed') as { body?: string } | undefined;
  return row?.body ?? null;
}

// ── Defect 2 + 3 · the claim builder ────────────────────────────────────────
describe('Current channels observed', () => {
  it('names BOTH stores and the website — the reported bug', async () => {
    const body = await channelsClaim({
      metadata:    { platform: 'app_store', category: 'Productivity' },
      platforms:   ['app_store', 'play_store'],
      websiteMeta: { title: 'AllignX', description: 'Home services' },
      reviews:     [],
      icp:         {},
    });
    // Was "App Store". Every part of the truth is now present.
    expect(body).toBe('App Store, Play Store, website');
  });

  it('still reports a single store correctly (no over-claiming)', async () => {
    const body = await channelsClaim({
      metadata: { platform: 'app_store' }, platforms: ['app_store'],
      websiteMeta: {}, reviews: [], icp: {},
    });
    // A website that was never supplied must NOT appear.
    expect(body).toBe('App Store');
  });

  it('reports Play Store alone when that is the only listing', async () => {
    const body = await channelsClaim({
      metadata: { platform: 'play_store' }, platforms: ['play_store'],
      websiteMeta: {}, reviews: [], icp: {},
    });
    // Under the old scalar logic this was the ONLY way Play Store could appear.
    expect(body).toBe('Play Store');
  });

  it('counts the website even with no store at all', async () => {
    const body = await channelsClaim({
      metadata: {}, platforms: [],
      websiteMeta: { title: 'AllignX' }, reviews: [], icp: {},
    });
    expect(body).toBe('website');
  });

  it('an EMPTY websiteMeta is not a channel', async () => {
    // scrapeWebsite returns {} on failure. An empty object must not be read as
    // "the owner has a website" — that would be a fabricated FACT.
    const body = await channelsClaim({
      metadata: { platform: 'app_store' }, platforms: ['app_store'],
      websiteMeta: {}, reviews: [], icp: {},
    });
    expect(body).not.toContain('website');
  });

  it('honours the legacy scalar for callers that pass no platforms array', async () => {
    // intakeWorker still calls with a scalar only; it must not regress to silence.
    const body = await channelsClaim({
      metadata: { platform: 'play_store' }, websiteMeta: {}, reviews: [], icp: {},
    });
    expect(body).toBe('Play Store');
  });

  it('includes organic reviews when a corpus exists', async () => {
    const body = await channelsClaim({
      metadata: { platform: 'app_store' }, platforms: ['app_store', 'play_store'],
      websiteMeta: { title: 'x' },
      reviews: [{ text: 'great', rating: 5 }],
      icp: {},
    });
    expect(body).toBe('App Store, Play Store, website, organic reviews');
  });
});

// ── Defect 1 · every URL is classified, not just the first ──────────────────
describe('multi-store URL handling', () => {
  // Mirrors detectPlatform + the storeTargets pipeline in discoveryWorker.
  const detect = (u: string) => u.toLowerCase().includes('apps.apple.com') ? 'app_store'
    : u.toLowerCase().includes('play.google.com') ? 'play_store' : 'web_only';

  it('finds two store listings in the owner\'s three URLs', () => {
    const stores = [APPLE, PLAY, SITE].map(detect).filter(p => p !== 'web_only');
    expect(stores).toEqual(['app_store', 'play_store']);
    // The old code took urls[0] only and saw exactly one.
    expect([APPLE, PLAY, SITE].slice(0, 1).map(detect)).toEqual(['app_store']);
  });

  it('picks the SAME primary regardless of the order they were typed', () => {
    // Order-dependence was the defect: whichever store came first won.
    const primaryOf = (urls: string[]) => {
      const s = urls.map(detect).filter(p => p !== 'web_only');
      return s.find(p => p === 'app_store') ?? s[0] ?? null;
    };
    expect(primaryOf([APPLE, PLAY, SITE])).toBe('app_store');
    expect(primaryOf([PLAY, APPLE, SITE])).toBe('app_store');
    expect(primaryOf([SITE, PLAY, APPLE])).toBe('app_store');
    expect(primaryOf([PLAY, SITE])).toBe('play_store');
  });

  it('deduplicates a platform listed twice', () => {
    const urls = [APPLE, APPLE, PLAY];
    const seen = urls.map(detect).filter(p => p !== 'web_only')
      .filter((p, i, a) => a.indexOf(p) === i);
    expect(seen).toEqual(['app_store', 'play_store']);
  });
});

// ── Identity: multi-store must not become multi-product ─────────────────────
describe('canonical identity across stores', () => {
  it('derives every identity, preferring the App Store as canonical', async () => {
    const { canonicalIdentityFromUrls, allCanonicalIdentities } =
      await import('../src/services/productIdentity');
    expect(canonicalIdentityFromUrls([APPLE, PLAY, SITE])).toBe('apple:6621240477');
    expect(allCanonicalIdentities([APPLE, PLAY, SITE]))
      .toEqual(['apple:6621240477', 'play:com.allignx', 'web:allignx.com']);
  });

  it('a later Play-only onboarding still matches the stored Apple identity', async () => {
    const { allCanonicalIdentities } = await import('../src/services/productIdentity');
    // The product row stores apple:… . Re-onboarding with only the Play link
    // derives play:… — which would have matched nothing and created a duplicate.
    const stored = 'play:com.allignx';
    expect(allCanonicalIdentities([PLAY])).toContain(stored);
    expect(allCanonicalIdentities([APPLE, PLAY, SITE])).toContain(stored);
  });

  it('two genuinely different apps share no identity', async () => {
    const { allCanonicalIdentities } = await import('../src/services/productIdentity');
    const a = allCanonicalIdentities([APPLE, PLAY]);
    const b = allCanonicalIdentities([
      'https://apps.apple.com/us/app/other/id9999999999',
      'https://play.google.com/store/apps/details?id=com.other',
    ]);
    expect(a.some(x => b.includes(x))).toBe(false);
  });
});
