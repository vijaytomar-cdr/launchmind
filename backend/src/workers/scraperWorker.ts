/**
 * @file scraperWorker.ts
 * @description App Store (Cheerio + app-store-scraper) and Play Store (google-play-scraper) scraper functions.
 *   Designed to run in a sandboxed Docker container via BullMQ job queue.
 *   A scraper crash CANNOT crash the Fastify API — communication is via Redis only.
 *   Platform detection handles both store URLs before dispatching.
 * @security
 *   - Never executes shell commands with user-supplied content.
 *   - Scraped URLs are validated against known store hostname patterns before fetch.
 *   - All output validated through ScrapedAppDataSchema before returning.
 * @dependencies cheerio, app-store-scraper, google-play-scraper, zod
 */

import * as cheerio from 'cheerio';
import { ScrapedAppData, CompetitorApp, ScrapedAppDataSchema } from '../types/scraper';

const APP_STORE_HOST = 'apps.apple.com';
const PLAY_STORE_HOST = 'play.google.com';

/**
 * Detects whether a URL points to the App Store or Play Store.
 * @param url - Raw URL string from the founder
 * @returns   Platform identifier, or null if not recognised
 * @security  Does NOT fetch the URL — only inspects the hostname.
 */
export function detectPlatform(url: string): 'app_store' | 'play_store' | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes(APP_STORE_HOST)) return 'app_store';
    if (parsed.hostname.includes(PLAY_STORE_HOST)) return 'play_store';
    return null;
  } catch {
    return null;
  }
}

/**
 * Scrapes App Store metadata using Cheerio (static HTML fetch).
 * @param url - Validated App Store URL
 * @returns   Structured app metadata including reviews
 * @throws    {Error} If fetch fails, HTML parse fails, or validation fails
 * @security  URL validated to apps.apple.com domain before fetch.
 */
export async function scrapeAppStore(url: string): Promise<ScrapedAppData> {
  if (!new URL(url).hostname.includes(APP_STORE_HOST)) {
    throw new Error('URL is not an App Store URL');
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchMind/1.0)' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`App Store fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const name =
    $('h1.product-header__title').text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    '';

  const description =
    $('div.we-truncate--multi-line').text().trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    '';

  const developer =
    $('span.product-header__subtitle a').first().text().trim() ||
    $('h2.product-header__identity a').text().trim() ||
    '';

  const category =
    $('a[href*="/genre/"]').first().text().trim() ||
    $('li.inline-list__item--bulleted').first().text().trim() ||
    'Productivity';

  const ratingText = $('span.we-rating-count').first().text().trim() || '0';
  const rating = parseFloat(ratingText) || 0;

  const ratingCountText =
    $('figcaption.we-rating-count').text().trim() ||
    $('span.rating-count').text().trim() ||
    '0';
  const ratingCount =
    parseInt(ratingCountText.replace(/[^0-9]/g, ''), 10) || 0;

  const screenshots: string[] = [];
  $('source[srcset*="png"]').each((_, el) => {
    const src = $(el).attr('srcset')?.split(',')[0]?.trim().split(' ')[0];
    if (src) screenshots.push(src);
  });

  const reviews: ScrapedAppData['reviews'] = [];
  $('div.we-customer-review').each((i, el) => {
    if (i >= 10) return false;
    const rating = parseInt($(el).find('span[class*="rating"]').attr('aria-label') ?? '3', 10);
    const text = $(el).find('p.we-customer-review__body').text().trim();
    const date = $(el).find('time').attr('datetime') ?? new Date().toISOString();
    if (text) reviews.push({ rating: Math.min(5, Math.max(1, rating)), text, date });
  });

  const raw = {
    name,
    developer,
    description,
    category,
    rating: Math.min(5, Math.max(0, rating)),
    ratingCount,
    priceTier: 'free',
    screenshots: screenshots.slice(0, 10),
    reviews,
    platform: 'app_store' as const,
    storeUrl: url,
  };

  return ScrapedAppDataSchema.parse(raw);
}

/**
 * Scrapes Play Store metadata using Playwright (headless Chromium).
 * @param url - Validated Play Store URL
 * @returns   Structured app metadata including reviews
 * @throws    {Error} If browser launch fails, navigation fails, or validation fails
 * @security  URL validated to play.google.com domain before launch.
 *             Playwright runs in isolated sandbox — no host filesystem access.
 */
export async function scrapePlayStore(url: string): Promise<ScrapedAppData> {
  if (!new URL(url).hostname.includes(PLAY_STORE_HOST)) {
    throw new Error('URL is not a Play Store URL');
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    // h1 is the app name in current Play Store HTML (2026)
    const name = await page
      .locator('h1')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '');

    const developer = await page
      .locator('a[href*="/store/apps/developer"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '');

    // itemprop="description" (last occurrence is the full description block)
    const description = await page
      .locator('[itemprop="description"]')
      .last()
      .textContent({ timeout: 5_000 })
      .catch(() => '');

    // itemprop="genre" is a DIV in current Play Store HTML
    const category = await page
      .locator('[itemprop="genre"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => 'Productivity');

    // aria-label="Rated X.X stars out of five stars"
    const ratingAriaLabel = await page
      .locator('[aria-label*="stars out of five"]')
      .first()
      .getAttribute('aria-label', { timeout: 5_000 })
      .catch(() => '');
    const rating = parseFloat(ratingAriaLabel?.match(/[\d.]+/)?.[0] ?? '0') || 0;

    // Rating count embedded in the rating block text: "4.3star35.6M reviews..."
    const ratingBlockText = await page
      .locator('[itemprop="starRating"]')
      .locator('../../..')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '');
    const countMatch = ratingBlockText?.match(/([\d,.]+[KkMmBb]?)\s*reviews?/i);
    const ratingCount = countMatch
      ? parseMillified(countMatch[1])
      : 0;

    const screenshots: string[] = await page
      .locator('img[src*="play-lh.googleusercontent.com"]')
      .evaluateAll((els) =>
        (els as Array<{ src: string }>)
          .map((el) => el.src)
          .filter(Boolean)
          .slice(0, 10)
      );

    // Reviews: try both old jsname selectors and new aria-based ones
    const reviews: ScrapedAppData['reviews'] = [];
    const reviewEls = await page
      .locator('div[jsname="fk8dgd"], [data-reviewid]')
      .all()
      .catch(() => []);
    for (const el of reviewEls.slice(0, 10)) {
      const text = await el
        .locator('span[jsname="bN97Pc"], [class*="review-body"]')
        .textContent()
        .catch(() => null);
      const ratingEl = await el
        .locator('div[role="img"]')
        .getAttribute('aria-label')
        .catch(() => '3 stars');
      const r = parseInt((ratingEl ?? '3').replace(/[^0-9]/g, '')[0] ?? '3', 10);
      if (text) {
        reviews.push({
          rating: Math.min(5, Math.max(1, r)),
          text,
          date: new Date().toISOString(),
        });
      }
    }

    const raw = {
      name: name?.trim() ?? '',
      developer: developer?.trim() ?? '',
      description: description?.trim() ?? '',
      category: category?.trim() ?? 'Productivity',
      rating: Math.min(5, Math.max(0, rating)),
      ratingCount,
      priceTier: 'free',
      screenshots,
      reviews,
      platform: 'play_store' as const,
      storeUrl: url,
    };

    return ScrapedAppDataSchema.parse(raw);
  } finally {
    await browser.close();
  }
}

/** Converts "35.6M" → 35600000, "1.2K" → 1200, plain numbers pass through. */
function parseMillified(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''));
  if (isNaN(n)) return 0;
  const suffix = s.trim().slice(-1).toUpperCase();
  if (suffix === 'B') return Math.round(n * 1_000_000_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'K') return Math.round(n * 1_000);
  return Math.round(n);
}

/**
/**
 * Maps a human-readable app category string to a google-play-scraper category ID.
 * Falls back to APPLICATION (general) for unrecognised categories.
 */
const PLAY_CATEGORY_MAP: Record<string, string> = {
  'house & home':       'HOUSE_AND_HOME',
  'house and home':     'HOUSE_AND_HOME',
  'health & fitness':   'HEALTH_AND_FITNESS',
  'health and fitness': 'HEALTH_AND_FITNESS',
  'food & drink':       'FOOD_AND_DRINK',
  'food and drink':     'FOOD_AND_DRINK',
  'travel & local':     'TRAVEL_AND_LOCAL',
  'travel and local':   'TRAVEL_AND_LOCAL',
  'news & magazines':   'NEWS_AND_MAGAZINES',
  'maps & navigation':  'MAPS_AND_NAVIGATION',
  'music & audio':      'MUSIC_AND_AUDIO',
  'art & design':       'ART_AND_DESIGN',
  'books & reference':  'BOOKS_AND_REFERENCE',
  'auto & vehicles':    'AUTO_AND_VEHICLES',
  'business':           'BUSINESS',
  'education':          'EDUCATION',
  'finance':            'FINANCE',
  'productivity':       'PRODUCTIVITY',
  'tools':              'TOOLS',
  'utilities':          'TOOLS',
  'lifestyle':          'LIFESTYLE',
  'shopping':           'SHOPPING',
  'social':             'SOCIAL',
  'social networking':  'SOCIAL',
  'entertainment':      'ENTERTAINMENT',
  'sports':             'SPORTS',
  'medical':            'MEDICAL',
  'communication':      'COMMUNICATION',
  'photography':        'PHOTOGRAPHY',
  'dating':             'DATING',
  'games':              'GAME',
  'game':               'GAME',
  'weather':            'WEATHER',
  'parenting':          'PARENTING',
};

function mapToPlayCategory(category: string): string {
  return PLAY_CATEGORY_MAP[category.toLowerCase().trim()] ?? 'APPLICATION';
}

/**
 * Finds the top 5 competitor apps in the same category using store-native APIs.
 * App Store: app-store-scraper keyword search (iTunes Search API — no auth required).
 * Play Store: google-play-scraper category list (TOP_FREE) — avoids bot-detection
 *   that blocks Play Store keyword search from server environments.
 * @param category - App category string from scraped metadata
 * @param platform - 'app_store' | 'play_store'
 * @returns        Up to 5 competitor apps; empty array on any failure
 * @security       Category string never executed as code or shell command.
 */
export async function scrapeCompetitors(
  category: string,
  platform: 'app_store' | 'play_store'
): Promise<CompetitorApp[]> {

  if (platform === 'app_store') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asScraper = (await import('app-store-scraper')) as any;
    const search: (opts: Record<string, unknown>) => Promise<Array<{
      title: string; developer: string; score: number; free: boolean; url: string;
    }>> = asScraper.search ?? asScraper.default?.search;

    const results = await search({ term: category, num: 6, country: 'us' });
    return (results ?? []).slice(0, 5).map((r) => ({
      name:      r.title,
      developer: r.developer,
      rating:    r.score ?? 0,
      category,
      priceTier: r.free ? 'free' : 'paid',
      platform:  'app_store' as const,
      storeUrl:  r.url,
    }));
  }

  // Play Store: browse TOP_FREE by category — reliable on server, no bot detection
  const gp = (await import('google-play-scraper')).default;
  const gpCategory = mapToPlayCategory(category);

  const results = await (gp.list as (opts: Record<string, unknown>) => Promise<Array<{
    title: string; developer: string; score: number; free: boolean; url: string;
  }>>)({
    category:   gpCategory,
    collection: gp.collection.TOP_FREE,
    num:        6,
    throttle:   5,
  });

  return (results ?? []).slice(0, 5).map((r) => ({
    name:      r.title,
    developer: r.developer,
    rating:    r.score ?? 0,
    category,
    priceTier: r.free ? 'free' : 'paid',
    platform:  'play_store' as const,
    storeUrl:  r.url,
  }));
}

/**
 * Discovers web-based competitors via Google Custom Search API.
 * Gap 1 placeholder — requires GOOGLE_CUSTOM_SEARCH_API_KEY +
 * GOOGLE_CUSTOM_SEARCH_ENGINE_ID in environment before enabling.
 * @param appName  - Name of the founder's app (search seed term)
 * @param category - App category for query refinement
 * @returns        Up to 5 competitor website entries; empty array until API key is provisioned
 */
export async function discoverWebCompetitors(
  appName: string,
  category: string
): Promise<CompetitorApp[]> {
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    // Gap 1: not yet provisioned — return empty, competitors page still works with store results
    return [];
  }

  // TODO (Gap 1 — prod): call Google Custom Search API, parse results, return CompetitorApp[]
  // Endpoint: https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${appName}+${category}+app
  void appName; void category;
  return [];
}
