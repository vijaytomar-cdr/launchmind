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
  url: z.string().url(),
  platform: z.enum(['app_store', 'play_store']),
  scraped: ScrapedAppDataSchema,
  icpBrief: ICPBriefSchema,
  competitors: z.array(CompetitorAppSchema),
});

export type Review = z.infer<typeof ReviewSchema>;
export type ScrapedAppData = z.infer<typeof ScrapedAppDataSchema>;
export type CompetitorApp = z.infer<typeof CompetitorAppSchema>;
export type ICPBrief = z.infer<typeof ICPBriefSchema>;
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;
export type ConfirmProductBody = z.infer<typeof ConfirmProductBodySchema>;
