/**
 * @file scraperWorker.ts
 * @description App Store (Cheerio) and Play Store (Playwright) scraper functions.
 *   Designed to run in a sandboxed Docker container via BullMQ job queue.
 *   A scraper crash CANNOT crash the Fastify API — communication is via Redis only.
 *   Platform detection handles both store URLs before dispatching.
 * @security
 *   - Never executes shell commands with user-supplied content.
 *   - Scraped URLs are validated against known store hostname patterns before fetch.
 *   - All output validated through ScrapedAppDataSchema before returning.
 *   - Playwright runs headless with no filesystem access to host.
 * @dependencies cheerio, playwright, zod
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

    const name = await page
      .locator('h1[itemprop="name"], h1.q78ml')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '');

    const developer = await page
      .locator('a[href*="/store/apps/developer"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '');

    const description = await page
      .locator('div[data-g-id="description"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '');

    const category = await page
      .locator('a[itemprop="genre"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => 'Productivity');

    const ratingText = await page
      .locator('div[itemprop="starRating"] div')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => '0');

    const rating = parseFloat(ratingText ?? '0') || 0;

    const ratingCountText = await page
      .locator('div[aria-label*="ratings"]')
      .first()
      .getAttribute('aria-label', { timeout: 5_000 })
      .catch(() => '0 ratings');

    const ratingCount =
      parseInt((ratingCountText ?? '').replace(/[^0-9]/g, ''), 10) || 0;

    const screenshots: string[] = await page
      .locator('img[src*="play-lh.googleusercontent.com"]')
      .evaluateAll((els) =>
        (els as Array<{ src: string }>)
          .map((el) => el.src)
          .filter(Boolean)
          .slice(0, 10)
      );

    const reviews: ScrapedAppData['reviews'] = [];
    const reviewEls = await page.locator('div[jsname="fk8dgd"]').all();
    for (const el of reviewEls.slice(0, 10)) {
      const text = await el.locator('span[jsname="bN97Pc"]').textContent().catch(() => null);
      const ratingEl = await el.locator('div[role="img"]').getAttribute('aria-label').catch(() => '3 stars');
      const rating = parseInt((ratingEl ?? '3').replace(/[^0-9]/g, '')[0] ?? '3', 10);
      if (text) {
        reviews.push({
          rating: Math.min(5, Math.max(1, rating)),
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

/**
 * Scrapes the top 5 competitor apps in the same category and platform.
 * @param category - App category (from scraped data)
 * @param platform - 'app_store' | 'play_store'
 * @returns        Array of up to 5 competitor apps
 * @throws         {Error} If the search fetch fails
 * @security       Category string is URL-encoded before use in fetch calls.
 */
export async function scrapeCompetitors(
  category: string,
  platform: 'app_store' | 'play_store'
): Promise<CompetitorApp[]> {
  const encoded = encodeURIComponent(category);

  if (platform === 'app_store') {
    const searchUrl = `https://itunes.apple.com/search?term=${encoded}&entity=software&limit=6`;
    const resp = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];

    const data = await resp.json() as {
      results: Array<{
        trackName: string;
        artistName: string;
        averageUserRating: number;
        primaryGenreName: string;
        formattedPrice: string;
        trackViewUrl: string;
      }>;
    };

    return (data.results ?? []).slice(0, 5).map((r) => ({
      name: r.trackName,
      developer: r.artistName,
      rating: r.averageUserRating ?? 0,
      category: r.primaryGenreName,
      priceTier: r.formattedPrice === 'Free' ? 'free' : 'paid',
      platform: 'app_store' as const,
      storeUrl: r.trackViewUrl,
    }));
  }

  const searchUrl = `https://play.google.com/store/search?q=${encoded}&c=apps`;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    const results: CompetitorApp[] = [];
    const cards = await page.locator('div[role="listitem"]').all();

    for (const card of cards.slice(0, 5)) {
      const name = await card.locator('div[class*="nnK0zc"]').textContent().catch(() => null);
      const developer = await card.locator('div[class*="b8cIId"]').textContent().catch(() => '');
      const ratingText = await card.locator('span[class*="w2kbF"]').textContent().catch(() => '0');
      const href = await card.locator('a').first().getAttribute('href').catch(() => null);

      if (name) {
        results.push({
          name: name.trim(),
          developer: developer?.trim() ?? '',
          rating: parseFloat(ratingText ?? '0') || 0,
          category,
          priceTier: 'free',
          platform: 'play_store',
          storeUrl: href ? `https://play.google.com${href}` : undefined,
        });
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}
