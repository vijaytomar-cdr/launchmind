/**
 * @file scraper.ts
 * @description Zod schemas and TypeScript types for scraped app data.
 *   Used by scraperWorker, reviewAnalysis, icpService, and products.route.
 *   All external scraper output is validated against ScrapedAppDataSchema before use.
 * @security Scraped content may include arbitrary user text — always treat as untrusted input.
 *   Never pass raw scraped content to shell commands or SQL directly.
 * @dependencies zod
 */

import { z } from 'zod';

export const ReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string(),
  date: z.string(),
});

export const ScrapedAppDataSchema = z.object({
  name: z.string().min(1),
  developer: z.string(),
  description: z.string(),
  category: z.string(),
  rating: z.number().min(0).max(5),
  ratingCount: z.number().int().min(0),
  priceTier: z.string(),
  screenshots: z.array(z.string().url()).max(10),
  reviews: z.array(ReviewSchema).max(50),
  platform: z.enum(['app_store', 'play_store']),
  storeUrl: z.string().url(),
});

export const CompetitorAppSchema = z.object({
  name: z.string(),
  developer: z.string(),
  rating: z.number().min(0).max(5),
  category: z.string(),
  priceTier: z.string(),
  platform: z.enum(['app_store', 'play_store']),
  storeUrl: z.string().url().optional(),
});

export const ICPBriefSchema = z.object({
  targetUser: z.string(),
  geography: z.array(z.string()),
  priceTier: z.string(),
  painPoints: z.array(z.string()),
  competitorGaps: z.array(z.string()),
  suggestedMarkets: z.array(z.enum(['usa', 'india'])),
});

export const ScrapeResultSchema = z.object({
  scraped: ScrapedAppDataSchema,
  icpBrief: ICPBriefSchema,
  competitors: z.array(CompetitorAppSchema),
});

export const ConfirmProductBodySchema = z.object({
  // v2 async path: UPDATE an existing product instead of INSERT
  productId: z.string().uuid().optional(),
  url: z.string().url().optional(),
  platform: z.enum(['app_store', 'play_store']).optional(),
  scraped: ScrapedAppDataSchema.optional(),
  icpBrief: ICPBriefSchema,
  competitors: z.array(CompetitorAppSchema).optional().default([]),
  // Intake v2 enrichment fields
  selectedMarkets: z.array(z.enum(['usa', 'india'])).optional(),
  primaryChannel: z.string().optional(),
  excludedChannels: z.array(z.string()).optional(),
});

export const FounderContextSchema = z.object({
  // Conv 1
  stage:        z.string().optional(),
  primaryGoal:  z.string().optional(),
  budget:       z.string().optional(),
  // Conv 2
  audienceSize: z.string().optional(),
  warmNetwork:  z.array(z.string()).optional(),
  geography:    z.string().optional(),
  language:     z.union([z.string(), z.array(z.string())]).optional(),
  // Conv 3
  channelsTried:    z.array(z.string()).optional(),
  channelsToAvoid:  z.array(z.string()).optional(),
  monetization:     z.string().optional(),
  dropOffPoint:     z.string().optional(),
  firstUserAction:  z.string().optional(),
  // Conv 4
  moat:        z.string().optional(),
  peakSeason:  z.string().optional(),
  // Conv 5
  bestCustomerQuote: z.string().optional(),
});

export const WebsiteMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  ogImage: z.string().optional(),
});

export const ScreenshotAnalysisSchema = z.object({
  summary: z.string(),
  tone: z.string(),
  primaryColor: z.string().optional(),
  screenshots_analysed: z.number().int().min(0),
});

// Multi-URL intake body — at least one store URL required
export const IntakeScrapeBodySchema = z.object({
  appStoreUrl: z.string().url().optional(),
  playStoreUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  // Backward compat: legacy clients send `url` or `storeUrl`
  url: z.string().url().optional(),
  storeUrl: z.string().url().optional(),
}).refine(
  (d) => d.url || d.storeUrl || d.appStoreUrl || d.playStoreUrl,
  { message: 'At least one app store URL is required' }
);

export type Review = z.infer<typeof ReviewSchema>;
export type ScrapedAppData = z.infer<typeof ScrapedAppDataSchema>;
export type CompetitorApp = z.infer<typeof CompetitorAppSchema>;
export type ICPBrief = z.infer<typeof ICPBriefSchema>;
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;
export type ConfirmProductBody = z.infer<typeof ConfirmProductBodySchema>;
export type FounderContext = z.infer<typeof FounderContextSchema>;
export type WebsiteMeta = z.infer<typeof WebsiteMetaSchema>;
export type ScreenshotAnalysis = z.infer<typeof ScreenshotAnalysisSchema>;
export type IntakeScrapeBody = z.infer<typeof IntakeScrapeBodySchema>;
