/**
 * @file icpService.ts
 * @description Builds a structured ICP (Ideal Customer Profile) brief from scraped app metadata
 *   and review analysis results. Also provides website scraping, screenshot analysis (Claude Haiku
 *   vision), and buildStrategyContext() for enriched strategy generation.
 * @security No PII stored. Claude Haiku responses validated before use. External URLs validated
 *   to prevent SSRF (website scraper restricted to https only).
 * @dependencies types/scraper, services/reviewAnalysis, @anthropic-ai/sdk, cheerio
 */

import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import type { ScrapedAppData, ICPBrief, WebsiteMeta, ScreenshotAnalysis } from '../types/scraper';
import type { ReviewAnalysis } from './reviewAnalysis';

const anthropicClient = new Anthropic();

/**
 * Derives an ICP brief from scraped app data and review analysis.
 * @param scraped        - Validated app store metadata
 * @param reviewAnalysis - Output from analyseReviews()
 * @returns              Structured ICPBrief ready to store in products.confirmed_icp
 * @security             Pure transformation — no DB or network calls.
 */
export function buildICPBrief(
  scraped: ScrapedAppData,
  reviewAnalysis: ReviewAnalysis
): ICPBrief {
  const suggestedMarkets = inferMarkets(scraped);

  return {
    targetUser: inferTargetUser(scraped),
    geography: suggestedMarkets,
    priceTier: scraped.priceTier,
    painPoints: [
      ...reviewAnalysis.painPoints,
      ...inferPainPointsFromDescription(scraped.description),
    ]
      .filter(Boolean)
      .slice(0, 8),
    competitorGaps: reviewAnalysis.marketingOpportunities.slice(0, 5),
    suggestedMarkets,
  };
}

function inferTargetUser(scraped: ScrapedAppData): string {
  const category = scraped.category.toLowerCase();
  const desc = scraped.description.toLowerCase();

  if (category.includes('business') || desc.includes('enterprise')) {
    return 'Small business owners and solo professionals';
  }
  if (category.includes('education') || desc.includes('learning')) {
    return 'Students and lifelong learners';
  }
  if (category.includes('health') || category.includes('fitness')) {
    return 'Health-conscious individuals aged 25–45';
  }
  if (category.includes('finance') || desc.includes('budget')) {
    return 'Young professionals managing personal finances';
  }
  if (category.includes('productivity') || desc.includes('productivity')) {
    return 'Professionals and entrepreneurs seeking efficiency';
  }
  return `Mobile app users interested in ${scraped.category}`;
}

function inferMarkets(scraped: ScrapedAppData): Array<'usa' | 'india'> {
  const desc = scraped.description.toLowerCase();
  const name = scraped.name.toLowerCase();

  const usaSignals = ['usd', '$', 'us dollars', 'american', 'usa'];
  const indiaSignals = ['inr', '₹', 'rupee', 'india', 'bharat', 'upi'];

  const hasUSA = usaSignals.some((s) => desc.includes(s) || name.includes(s));
  const hasIndia = indiaSignals.some((s) => desc.includes(s) || name.includes(s));

  if (hasIndia && !hasUSA) return ['india'];
  if (hasUSA && !hasIndia) return ['usa'];
  return ['usa', 'india'];
}

function inferPainPointsFromDescription(description: string): string[] {
  const painKeywords: Record<string, string> = {
    'hard to': 'Difficulty with manual processes',
    'time consuming': 'Too much time spent on repetitive tasks',
    'forget': 'Forgetting important tasks or deadlines',
    'overwhelm': 'Feeling overwhelmed by complexity',
    'expensive': 'High cost of existing solutions',
    'complicated': 'Existing tools are too complicated',
    'manual': 'Manual effort required for routine tasks',
  };

  const desc = description.toLowerCase();
  return Object.entries(painKeywords)
    .filter(([keyword]) => desc.includes(keyword))
    .map(([, painPoint]) => painPoint)
    .slice(0, 3);
}

// ── Phase 5 intake enrichment ─────────────────────────────────────────────────

/**
 * Scrapes public website metadata using Cheerio.
 * @param websiteUrl - HTTPS URL of the product's marketing website
 * @returns          Title, description, keywords, and og:image if found
 * @throws           {Error} If fetch fails or URL is not HTTPS
 * @security         Only HTTPS URLs accepted. Fetched content treated as untrusted.
 */
export async function scrapeWebsite(websiteUrl: string): Promise<WebsiteMeta> {
  const parsed = new URL(websiteUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Website URL must use HTTPS');
  }

  const response = await fetch(websiteUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchMind/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new Error('This website blocks automated scraping. Try pasting their App Store or Play Store URL instead.');
    }
    if (response.status === 429) {
      throw new Error('Rate limited by this website. Try again in a moment or use their App Store URL.');
    }
    throw new Error(`Could not fetch this website (${response.status}). Try their App Store or Play Store URL instead.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title =
    $('title').text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    '';

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    '';

  const keywords = ($('meta[name="keywords"]').attr('content') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 20);

  const ogImage = $('meta[property="og:image"]').attr('content')?.trim();

  // Logo detection — priority: apple-touch-icon → png icon link → og:image fallback
  const rawLogo =
    $('link[rel="apple-touch-icon"]').first().attr('href') ||
    $('link[rel="apple-touch-icon-precomposed"]').first().attr('href') ||
    $('link[rel="icon"][type="image/png"]').first().attr('href') ||
    $('link[rel="shortcut icon"][type="image/png"]').first().attr('href') ||
    ogImage;

  let logoUrl: string | undefined;
  if (rawLogo) {
    try { logoUrl = new URL(rawLogo, websiteUrl).toString(); } catch { /* ignore */ }
  }

  return {
    title,
    description,
    keywords,
    ...(ogImage  ? { ogImage }  : {}),
    ...(logoUrl  ? { logoUrl }  : {}),
  };
}

/**
 * Analyses up to 3 app screenshots using Claude Haiku vision.
 * Screenshots may be public URLs or base64 data URIs (data:image/...).
 * @param screenshots - Array of screenshot URLs or data URIs
 * @param _founderId  - Reserved for future audit logging
 * @returns           Summary, tone, primary colour, and count of screenshots analysed
 * @security          Screenshots treated as untrusted; only Claude's text output is stored.
 */
export async function analyseScreenshots(
  screenshots: string[],
  _founderId: string
): Promise<ScreenshotAnalysis> {
  if (screenshots.length === 0) {
    return { summary: 'No screenshots provided', tone: 'Unknown', screenshots_analysed: 0 };
  }

  const sample = screenshots.slice(0, 3);

  const imageBlocks: Anthropic.ImageBlockParam[] = sample.map((src) => {
    if (src.startsWith('data:')) {
      const [header, data] = src.split(',');
      const mediaType = (header.match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data,
        },
      };
    }
    return {
      type: 'image',
      source: { type: 'url', url: src },
    };
  });

  const message = await anthropicClient.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: 'Analyse these app screenshots. Return ONLY valid JSON (no markdown): { "summary": "2-sentence UI/UX and messaging analysis", "tone": "one adjective", "primaryColor": "#hex or null", "screenshots_analysed": number }',
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    return { summary: 'Analysis unavailable', tone: 'Unknown', screenshots_analysed: sample.length };
  }

  try {
    const cleaned = content.text.replace(/```(?:json)?\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: String(parsed.summary ?? ''),
      tone: String(parsed.tone ?? ''),
      primaryColor: parsed.primaryColor ?? undefined,
      screenshots_analysed: sample.length,
    };
  } catch {
    return {
      summary: content.text.slice(0, 300),
      tone: 'Unknown',
      screenshots_analysed: sample.length,
    };
  }
}

/**
 * Builds a rich strategy context string by combining all intake enrichment data.
 * Injected into the Claude Sonnet system prompt to produce dramatically more specific strategies.
 * @param product - Partial product record with optional enrichment fields
 * @returns       Multi-line context block, or empty string if no enrichment data present
 * @security      Pure text transformation — no DB or network calls.
 */
export function buildStrategyContext(product: {
  confirmed_icp?: Record<string, unknown> | null;
  founder_context?: Record<string, unknown> | null;
  website_meta?: Record<string, unknown> | null;
  screenshot_analysis?: Record<string, unknown> | null;
}): string {
  const lines: string[] = [];

  const fc = product.founder_context;
  if (fc) {
    if (fc.budget) lines.push(`Monthly ad budget: ${fc.budget}`);
    if (fc.moat) lines.push(`Product moat / unfair advantage: ${fc.moat}`);
    if (fc.bestCustomerQuote) lines.push(`Best customer outcome: "${fc.bestCustomerQuote}"`);
    if (Array.isArray(fc.channelsTried) && fc.channelsTried.length > 0) {
      lines.push(`Channels already tried (avoid repeating failures): ${(fc.channelsTried as string[]).join(', ')}`);
    }
    if (fc.dropOffPoint) lines.push(`Known drop-off / conversion blocker: ${fc.dropOffPoint}`);
    if (fc.language) lines.push(`Primary audience language: ${fc.language}`);
    if (fc.peakSeason) lines.push(`Peak season: ${fc.peakSeason}`);
  }

  const wm = product.website_meta;
  if (wm) {
    if (wm.title) lines.push(`Website headline: ${wm.title}`);
    if (wm.description) lines.push(`Website sub-headline: ${wm.description}`);
    if (Array.isArray(wm.keywords) && wm.keywords.length > 0) {
      lines.push(`Website SEO keywords: ${(wm.keywords as string[]).slice(0, 8).join(', ')}`);
    }
  }

  const sa = product.screenshot_analysis;
  if (sa?.summary) lines.push(`App screenshot analysis: ${sa.summary}`);
  if (sa?.tone) lines.push(`Visual tone: ${sa.tone}`);

  if (lines.length === 0) return '';

  return `\n## Enriched Founder Context (use this to make strategy highly specific)\n${lines.map((l) => `- ${l}`).join('\n')}`;
}
