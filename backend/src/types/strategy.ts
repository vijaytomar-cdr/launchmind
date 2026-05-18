/**
 * @file strategy.ts
 * @description Zod schemas and TypeScript types for strategy generation output.
 *   Used by strategyService, playbookService, and the products strategy routes.
 * @security All Claude responses validated against these schemas before DB write.
 * @dependencies zod
 */

import { z } from 'zod';

export const ChannelSchema = z.enum(['meta', 'google', 'whatsapp', 'linkedin', 'email']);

export const HookTypeSchema = z.enum(['pain_first', 'social_proof', 'fomo', 'outcome', 'curiosity']);

export const ChannelPlanSchema = z.object({
  channel: ChannelSchema,
  rationale: z.string(),
  projectedPerformance: z.enum(['high', 'medium', 'low']),
  suggestedWeeklySpendUSD: z.number().min(0),
  suggestedWeeklySpendINR: z.number().min(0),
  hookType: HookTypeSchema,
  primaryKPI: z.string(),
});

export const MarketStrategySchema = z.object({
  positioning: z.string(),
  primaryChannels: z.array(ChannelSchema),
  messagingAngle: z.string(),
  pricingAngle: z.string(),
  topObjection: z.string(),
  objectiveFocus: z.string(),
});

export const StrategySchema = z.object({
  thirtyDay: z.array(ChannelPlanSchema),
  sixtyDay: z.array(ChannelPlanSchema),
  ninetyDay: z.array(ChannelPlanSchema),
  usa: MarketStrategySchema,
  india: MarketStrategySchema,
  executiveSummary: z.string(),
  generatedAt: z.string(),
});

export const WhatsAppTemplateSchema = z.object({
  hookType: HookTypeSchema,
  headline: z.string().max(60),
  body: z.string().max(200),
  cta: z.string().max(20),
});

export const AppStoreListingSchema = z.object({
  title: z.string().max(30),
  subtitle: z.string().max(30),
  description: z.string().max(4000),
  keywords: z.array(z.string()),
});

export const EmailSequenceItemSchema = z.object({
  day: z.number(),
  subject: z.string(),
  preview: z.string(),
  body: z.string(),
});

export const MetaAdVariantSchema = z.object({
  headline: z.string(),
  bodyText: z.string(),
  cta: z.string(),
});

export const ContentAssetsSchema = z.object({
  channel: ChannelSchema,
  market: z.enum(['usa', 'india']),
  whatsapp: z.array(WhatsAppTemplateSchema).optional(),
  appStoreListing: AppStoreListingSchema.optional(),
  emailSequence: z.array(EmailSequenceItemSchema).optional(),
  metaAds: z.array(MetaAdVariantSchema).optional(),
  generatedAt: z.string(),
});

export const AssetsRequestSchema = z.object({
  channel: ChannelSchema,
  market: z.enum(['usa', 'india']),
});

export type HookType = z.infer<typeof HookTypeSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type ChannelPlan = z.infer<typeof ChannelPlanSchema>;
export type MarketStrategy = z.infer<typeof MarketStrategySchema>;
export type Strategy = z.infer<typeof StrategySchema>;
export type ContentAssets = z.infer<typeof ContentAssetsSchema>;
export type AssetsRequest = z.infer<typeof AssetsRequestSchema>;
export type WhatsAppTemplate = z.infer<typeof WhatsAppTemplateSchema>;
export type AppStoreListing = z.infer<typeof AppStoreListingSchema>;
