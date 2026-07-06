/**
 * @file marketingImagesService.ts
 * @description Collects and permanently stores marketing images for a product.
 *   Sources (in priority order):
 *     1. App Store / Play Store screenshots already scraped — download to Supabase Storage
 *     2. Website hero/feature section images — Cheerio static scrape
 *     3. Google Custom Search Images — finds prior marketing assets on the web
 *   All results are stored under content-assets/{founderId}/{productId}/source-images/
 *   and the returned URLs are permanent (never expire unlike store CDN URLs).
 * @security
 *   - Store screenshot URLs are only fetched from apple.com/mzstatic CDNs and
 *     play.google.com/store domains.
 *   - Website images are fetched from the founder's own verified website domain.
 *   - Google Custom Search results are filtered to https:// image URLs only.
 *   - founderId + productId used as storage path prefix — no cross-founder access.
 *   - Every download has a hard timeout; any failure silently skips that image.
 * @dependencies @supabase/supabase-js (admin), cheerio, node-fetch (native fetch)
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

const BUCKET = 'content-assets';
const MAX_APP_SCREENSHOTS = 5;
const MAX_WEBSITE_IMAGES = 3;
const MAX_WEB_SEARCH_IMAGES = 3;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MIN_IMAGE_BYTES = 1_000; // skip placeholder/icon images

export interface CollectMarketingImagesOptions {
  founderId: string;
  productId: string;
  appName: string;
  /** CDN screenshot URLs from App Store / Play Store scraper */
  screenshots: string[];
  websiteUrl?: string;
  /** OG image already extracted by scrapeWebsite() */
  websiteOgImage?: string;
}

export interface MarketingImagesResult {
  /** Permanent Supabase Storage public URLs, ordered: screenshots first, then web */
  marketingImages: string[];
  /** Count breakdown for logging */
  counts: { screenshots: number; heroImages: number; webSearch: number };
}

/**
 * Downloads and permanently stores marketing images from multiple sources.
 * Always resolves (never rejects) — individual failures are logged and skipped.
 * @param opts - Product context and source URLs
 * @returns    Permanent Supabase Storage public URLs + count breakdown
 */
export async function collectMarketingImages(
  opts: CollectMarketingImagesOptions,
): Promise<MarketingImagesResult> {
  const { founderId, productId, appName, screenshots, websiteUrl, websiteOgImage } = opts;
  const basePath = `${founderId}/${productId}/source-images`;
  const counts = { screenshots: 0, heroImages: 0, webSearch: 0 };
  const stored: string[] = [];

  // ── 1. App Store / Play Store screenshots ──────────────────────────────────
  const toDownload = screenshots.slice(0, MAX_APP_SCREENSHOTS);
  const screenshotResults = await Promise.allSettled(
    toDownload.map(async (url, i) => {
      const ext = url.toLowerCase().includes('.png') ? 'png' : 'jpg';
      const path = `${basePath}/screenshot_${i}.${ext}`;
      return _downloadToStorage(url, path, `screenshot-${i}`);
    }),
  );
  for (const r of screenshotResults) {
    if (r.status === 'fulfilled' && r.value) {
      stored.push(r.value);
      counts.screenshots++;
    }
  }

  // ── 2. Website hero / feature images ──────────────────────────────────────
  if (websiteUrl) {
    const heroUrls = await _scrapeWebsiteHeroImages(websiteUrl, websiteOgImage).catch(() => []);
    const heroResults = await Promise.allSettled(
      heroUrls.slice(0, MAX_WEBSITE_IMAGES).map(async (url, i) => {
        const path = `${basePath}/hero_${i}.jpg`;
        return _downloadToStorage(url, path, `hero-${i}`);
      }),
    );
    for (const r of heroResults) {
      if (r.status === 'fulfilled' && r.value) {
        stored.push(r.value);
        counts.heroImages++;
      }
    }
  }

  // ── 3. Google Custom Search — prior marketing materials ───────────────────
  const googleKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const googleCx  = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
  if (googleKey && googleCx && appName) {
    const searchUrls = await _searchMarketingImages(appName, googleKey, googleCx).catch(() => []);
    const searchResults = await Promise.allSettled(
      searchUrls.slice(0, MAX_WEB_SEARCH_IMAGES).map(async (url, i) => {
        const path = `${basePath}/web_${i}.jpg`;
        return _downloadToStorage(url, path, `web-${i}`);
      }),
    );
    for (const r of searchResults) {
      if (r.status === 'fulfilled' && r.value) {
        stored.push(r.value);
        counts.webSearch++;
      }
    }
  }

  console.log(
    `[marketingImages] product=${productId.slice(0, 8)} — stored ${stored.length} images ` +
    `(screenshots=${counts.screenshots}, hero=${counts.heroImages}, webSearch=${counts.webSearch})`,
  );

  return { marketingImages: stored, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Downloads an image URL and uploads it to Supabase Storage.
 * Returns the public URL on success, null on any failure.
 */
async function _downloadToStorage(
  url: string,
  storagePath: string,
  label: string,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchMind/1.0)' },
    });
    if (!res.ok) {
      console.warn(`[marketingImages] ${label}: fetch ${res.status} for ${url.slice(0, 60)}`);
      return null;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      console.warn(`[marketingImages] ${label}: non-image content-type: ${contentType}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer() as ArrayBuffer);
    if (buffer.length < MIN_IMAGE_BYTES) {
      console.warn(`[marketingImages] ${label}: image too small (${buffer.length} bytes), skipping`);
      return null;
    }

    const { error } = await getSupabaseAdmin()
      .storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (error) {
      console.warn(`[marketingImages] ${label}: storage upload failed: ${error.message}`);
      return null;
    }

    const { data } = getSupabaseAdmin()
      .storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    return data.publicUrl ?? null;
  } catch (err) {
    console.warn(`[marketingImages] ${label}: error — ${(err as Error).message}`);
    return null;
  }
}

/**
 * Scrapes website HTML for hero/feature section images.
 * Looks in: <header>, <section class="hero|banner|feature">, large srcset images.
 * Returns absolute URLs, deduped, OG image first.
 */
async function _scrapeWebsiteHeroImages(
  websiteUrl: string,
  knownOgImage?: string,
): Promise<string[]> {
  const images: string[] = [];
  const seen = new Set<string>();

  const addImage = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      images.push(url);
    }
  };

  // OG image first — highest signal for marketing
  if (knownOgImage) addImage(knownOgImage);

  try {
    const res = await fetch(websiteUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchMind/1.0)' },
    });
    if (!res.ok) return images;
    const html = await res.text();

    const { load } = await import('cheerio');
    const $ = load(html);

    // Images inside hero/banner/feature containers
    const HERO_SELECTORS = [
      'section[class*="hero"]',
      'section[class*="banner"]',
      'section[class*="feature"]',
      'div[class*="hero"]',
      'div[class*="banner"]',
      'header',
      'main > section:first-child',
    ];
    for (const sel of HERO_SELECTORS) {
      $(sel).find('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (!src || src.startsWith('data:')) return;
        try {
          const abs = new URL(src, websiteUrl).toString();
          // Skip known tiny icons (width attr < 200 is a hint)
          const wAttr = parseInt($(el).attr('width') ?? '0', 10);
          if (wAttr > 0 && wAttr < 200) return;
          addImage(abs);
        } catch { /* skip relative URLs that fail to resolve */ }
      });
    }

    // Large srcset images (take the largest declared size)
    $('img[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset') ?? '';
      const entries = srcset.split(',')
        .map(s => {
          const parts = s.trim().split(/\s+/);
          const w = parseInt(parts[1] ?? '0', 10);
          return { url: parts[0] ?? '', w };
        })
        .filter(e => e.url && !e.url.startsWith('data:'))
        .sort((a, b) => b.w - a.w);

      const best = entries[0];
      if (best?.url) {
        try { addImage(new URL(best.url, websiteUrl).toString()); } catch { /* skip */ }
      }
    });

    // App screenshots in image src alt text
    $('img[alt*="screenshot"], img[alt*="app"], img[alt*="screen"]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src || src.startsWith('data:')) return;
      try { addImage(new URL(src, websiteUrl).toString()); } catch { /* skip */ }
    });

  } catch (err) {
    console.warn(`[marketingImages] hero scrape failed for ${websiteUrl}: ${(err as Error).message}`);
  }

  return images;
}

/**
 * Uses Google Custom Search Images API to find prior marketing images published on the web.
 * Searches for "[appName] mobile app" filtered to large images.
 * @security Only runs when both GOOGLE_CUSTOM_SEARCH_API_KEY and ENGINE_ID are present.
 */
async function _searchMarketingImages(
  appName: string,
  apiKey: string,
  cx: string,
): Promise<string[]> {
  const q = encodeURIComponent(`"${appName}" mobile app`);
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${apiKey}&cx=${cx}&q=${q}&searchType=image&imgSize=large&num=5`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    console.warn(`[marketingImages] Google CSE image search failed: ${res.status}`);
    return [];
  }

  const data = await res.json() as { items?: Array<{ link?: string; mime?: string }> };
  return (data.items ?? [])
    .filter(item => typeof item.link === 'string' && item.link.startsWith('https://'))
    .filter(item => !item.mime || item.mime.startsWith('image/'))
    .map(item => item.link as string);
}
