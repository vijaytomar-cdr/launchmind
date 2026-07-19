/**
 * @file strategyService.ts
 * @description Generates 30/60/90-day marketing strategy + content assets using Claude Sonnet.
 *   generateStrategy: fetches product, builds playbook context, calls Sonnet, saves campaign drafts.
 *   generateContentAssets: generates channel-specific copy assets (WhatsApp, App Store, Email, Meta).
 * @security
 *   - founderId verified against product.founder_id before any generation.
 *   - consumeTokens() called before every Claude API call.
 *   - Claude responses validated against Zod schemas; malformed → Sentry + throw.
 *   - Free tier: strategy response returned but campaign drafts not launched.
 * @dependencies @anthropic-ai/sdk, playbookService, supabaseAdmin, tokens, Sentry
 */

import * as Sentry from '@sentry/node';
import { callSonnet } from '../lib/aiPlatform';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { consumeTokens } from '../lib/tokens';
import { buildPlaybookContext } from './playbookService';
import { buildStrategyContext } from './icpService';
import {
  StrategySchema,
  ContentAssetsSchema,
  type Strategy,
  type ContentAssets,
  type Channel,
} from '../types/strategy';
import type { ICPBrief } from '../types/scraper';

const CHANNELS: Channel[] = ['meta', 'google', 'whatsapp', 'linkedin', 'email'];

// ── Strategy generation ───────────────────────────────────────────────────────

const HOOK_TYPES = ['pain_first', 'social_proof', 'fomo', 'outcome', 'curiosity'] as const;

const STRATEGY_SYSTEM = `You are a fractional CMO with deep expertise in mobile app marketing for both the USA and India markets.
You understand how user behaviour, payment methods, pricing sensitivity, and platform preferences differ between these markets.
You always recommend pain-first copy hooks, not feature-first. Pain points drive downloads; features drive churn.
hookType MUST be exactly one of: ${HOOK_TYPES.join(', ')}. No other values are accepted.
Return ONLY valid JSON — no markdown, no explanation, no code blocks.`;

function buildStrategyPrompt(
  appName: string,
  category: string,
  icp: ICPBrief,
  playbookContext: string,
  founderContext = ''
): string {
  return `Generate a 30/60/90-day marketing strategy for this app:

App: ${appName}
Category: ${category}
Target user: ${icp.targetUser}
Pain points: ${icp.painPoints.join(', ')}
Competitor gaps: ${icp.competitorGaps.join(', ')}
Suggested markets: ${icp.suggestedMarkets.join(', ')}
Price tier: ${icp.priceTier}
${founderContext}
${playbookContext}

Return JSON matching EXACTLY this schema (no markdown, no explanation, raw JSON only):
{
  "thirtyDay": [{ "channel": "meta"|"google"|"whatsapp"|"linkedin"|"email", "rationale": "string", "projectedPerformance": "high"|"medium"|"low", "suggestedWeeklySpendUSD": number, "suggestedWeeklySpendINR": number, "hookType": "string", "primaryKPI": "string" }],
  "sixtyDay": [same structure],
  "ninetyDay": [same structure],
  "usa": { "positioning": "string", "primaryChannels": ["channel",...], "messagingAngle": "string", "pricingAngle": "string", "topObjection": "string", "objectiveFocus": "string" },
  "india": { same as usa },
  "executiveSummary": "string",
  "generatedAt": "ISO timestamp",
  "budgetReality": {
    "currentTier": "seed",
    "currentMonthlyUSD": 150,
    "assessment": "This is a learning budget. Focus on zero-cost channels first.",
    "seed": {
      "rangeLabel": "$50–200/mo",
      "name": "Seed",
      "channels": ["WhatsApp organic", "Email outreach", "Meta 1-city test"],
      "lockedChannels": [],
      "projectedInstalls": "20–40/mo"
    },
    "growth": {
      "rangeLabel": "$500–1k/mo",
      "name": "Growth",
      "channels": ["WhatsApp broadcast", "Email automation", "Meta 3-city radius"],
      "lockedChannels": ["Google UAC", "Retargeting loops"],
      "planRequiredForLocked": "Builder plan",
      "projectedInstalls": "150–250/mo",
      "projectedInstallsWithPlan": "400+/mo with Builder plan"
    },
    "scale": {
      "rangeLabel": "$2k+/mo",
      "name": "Scale",
      "channels": ["Meta multi-city", "Google UAC scaled", "Email sequences", "WhatsApp broadcast"],
      "lockedChannels": ["LinkedIn for B2B", "Lookalike audiences", "Simultaneous multi-market"],
      "planRequiredForLocked": "Studio plan",
      "projectedInstalls": "500–800/mo",
      "projectedInstallsWithPlan": "1,000+/mo with Studio plan"
    }
  }
}

IMPORTANT RULES:
- budgetReality is REQUIRED — always include it. Replace the example values above with real values for this app.
- currentTier must be "seed", "growth", or "scale" based on the Monthly ad budget in the Enriched Founder Context (default "seed" if not specified). Tier thresholds: seed = $0–499/mo, growth = $500–1,999/mo, scale = $2,000+/mo.
- currentMonthlyUSD must be a plain number (no quotes, no currency symbols).
- channels and lockedChannels must be arrays of plain strings.
- Do NOT include null values anywhere — omit optional fields entirely if not applicable.
- thirtyDay = top 3 channels to start. sixtyDay = optimise + expand. ninetyDay = scale winners.
- USA messaging should be outcome-focused. India messaging should be value + social proof focused.`;
}

/**
 * Generates a 30/60/90-day strategy and saves campaign draft rows for the product.
 * @param productId     - UUID of the product to strategise
 * @param founderId     - UUID of the requesting founder (ownership check)
 * @param budgetOverride - Optional new monthly budget string (e.g. "$500-$1,000/mo").
 *                        When provided, updates products.founder_context.budget before
 *                        generating so the new strategy reflects the chosen budget tier.
 * @returns             Generated Strategy object
 * @throws              {Error} If product not found, ownership fails, or Claude returns invalid JSON
 * @security            founderId verified against product.founder_id. consumeTokens() called first.
 */
export async function generateStrategy(
  productId: string,
  founderId: string,
  budgetOverride?: string
): Promise<Strategy> {
  const supabase = getSupabaseAdmin();

  // Apply budget override before fetching product — updates founder_context.budget in DB
  if (budgetOverride) {
    const { data: current } = await supabase
      .from('products')
      .select('founder_context')
      .eq('id', productId)
      .eq('founder_id', founderId)
      .single();
    if (current) {
      const updatedContext = { ...(current.founder_context ?? {}), budget: budgetOverride };
      await supabase
        .from('products')
        .update({ founder_context: updatedContext, updated_at: new Date().toISOString() })
        .eq('id', productId);
    }
  }

  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .is('archived_at', null)
    .single();

  if (error || !product) throw new Error('Product not found or access denied');

  const icp = product.confirmed_icp as ICPBrief | null;
  if (!icp) throw new Error('Product has no confirmed ICP brief — complete the Discover step first');

  const markets = (product.markets ?? ['usa']) as Array<'usa' | 'india'>;
  const primaryMarket = markets.includes('usa') ? 'usa' : 'india';

  const playbookContext = await buildPlaybookContext(
    product.category ?? 'Productivity',
    primaryMarket,
    product.icp_embedding ?? null
  );

  await consumeTokens(founderId, 'strategy_generation', 50);

  const founderContext = buildStrategyContext(product);

  // Strip markdown code fences if Claude wraps the JSON despite the system prompt
  const rawText = (await callSonnet(STRATEGY_SYSTEM, buildStrategyPrompt(
    product.name,
    product.category ?? 'Productivity',
    icp,
    playbookContext,
    founderContext
  ), 4096, { founderId, productId: product.id, promptId: 'strategy_generation', action: 'strategy_generation' }))
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let strategy: Strategy;
  try {
    const parsed = JSON.parse(rawText);
    parsed.generatedAt = new Date().toISOString();
    strategy = StrategySchema.parse(parsed);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { service: 'strategyService', productId },
      extra: { rawResponse: rawText.slice(0, 500) },
    });
    throw new Error('Strategy generation returned invalid JSON — please retry');
  }

  // Save campaign draft rows — one per channel per market
  const allChannels = [
    ...strategy.thirtyDay.map((c) => ({ ...c, phase: '30d' })),
  ];

  const campaignInserts = allChannels.flatMap((cp) =>
    markets.map((market) => ({
      product_id: productId,
      founder_id: founderId,
      channel: cp.channel,
      market,
      status: 'draft',
      hook_type: cp.hookType,
      audience_config: { projectedPerformance: cp.projectedPerformance, primaryKPI: cp.primaryKPI },
      spend_cap: {
        weeklyUSD: cp.suggestedWeeklySpendUSD,
        weeklyINR: cp.suggestedWeeklySpendINR,
      },
      ai_tokens_consumed: 0,
    }))
  );

  if (campaignInserts.length > 0) {
    await supabase.from('campaigns').upsert(campaignInserts, {
      onConflict: 'product_id,channel,market',
      ignoreDuplicates: false,
    });
  }

  // Persist full strategy JSON so GET /products/:id/strategy can return it without re-generating
  await supabase
    .from('products')
    .update({ full_strategy: strategy, updated_at: new Date().toISOString() })
    .eq('id', productId);

  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action: 'strategy_generated',
    resource_type: 'product',
    resource_id: productId,
    metadata: { campaignDrafts: campaignInserts.length },
  });

  // Kick off content pipeline — enqueue via BullMQ so it survives backend restarts.
  // Falls back to fire-and-forget if Redis is not reachable.
  const redisUrl = process.env.REDIS_URL ?? '';
  const redisReady = Boolean(redisUrl) && !redisUrl.includes('your_upstash');
  if (redisReady) {
    try {
      const { enqueueContentGeneration } = await import('../lib/scheduler');
      const { jobId } = await enqueueContentGeneration(productId, founderId, null);
      console.log(`[contentPipeline] Enqueued as BullMQ job ${jobId} for product ${productId.substring(0, 8)}…`);
    } catch (err) {
      console.error(`[contentPipeline] Failed to enqueue, falling back to fire-and-forget:`, err);
      void runContentPipelineInline(productId, founderId);
    }
  } else {
    void runContentPipelineInline(productId, founderId);
  }

  return strategy;
}

async function runContentPipelineInline(productId: string, founderId: string): Promise<void> {
  try {
    console.log(`[contentPipeline] Starting (fire-and-forget) for product ${productId.substring(0, 8)}…`);
    const { generateContentAssets: runContentPipeline } = await import('./contentService');
    await runContentPipeline(productId, founderId, null);
    console.log(`[contentPipeline] Completed for product ${productId.substring(0, 8)}…`);
  } catch (err) {
    console.error(`[contentPipeline] Failed for product ${productId.substring(0, 8)}…:`, err);
    Sentry.captureException(err, { tags: { service: 'strategyService', step: 'contentPipeline' } });
  }
}

// ── Content asset generation ──────────────────────────────────────────────────

const ASSETS_SYSTEM = `You are a world-class mobile app copywriter. Write pain-first, outcome-focused copy.
Never feature-first. Mirror the language real users use in reviews. Pain points drive downloads.
For WhatsApp: hookType MUST be exactly one of: ${HOOK_TYPES.join(', ')}. At least one variant must use "pain_first".
Return ONLY valid JSON — no markdown, no explanation.`;

function buildAssetsPrompt(
  channel: Channel,
  market: 'usa' | 'india',
  appName: string,
  icp: ICPBrief,
  playbookContext: string
): string {
  const marketContext =
    market === 'india'
      ? 'India audience: value-conscious, responds to social proof and "X people use this", prefers WhatsApp for discovery.'
      : 'USA audience: outcome-focused, ROI-driven, responds to time savings and productivity gains.';

  const channelSchemas: Record<Channel, string> = {
    whatsapp: `{ "channel": "whatsapp", "market": "${market}", "whatsapp": [{ "hookType": "pain_first|social_proof|fomo", "headline": "string (max 60 chars)", "body": "string (max 200 chars)", "cta": "string (max 20 chars)" }] (3 variants), "generatedAt": "ISO" }`,
    email: `{ "channel": "email", "market": "${market}", "emailSequence": [{ "day": number, "subject": "string", "preview": "string (max 90 chars)", "body": "string (HTML ok, max 500 chars)" }] (3 items: day 0, 3, 7), "generatedAt": "ISO" }`,
    meta: `{ "channel": "meta", "market": "${market}", "metaAds": [{ "headline": "string (max 40 chars)", "bodyText": "string (max 125 chars)", "cta": "string (max 20 chars)" }] (5 headlines + 3 body variants = 8 items), "generatedAt": "ISO" }`,
    google: `{ "channel": "google", "market": "${market}", "metaAds": [{ "headline": "string (max 30 chars)", "bodyText": "string (max 90 chars)", "cta": "string" }] (5 headline variants), "generatedAt": "ISO" }`,
    linkedin: `{ "channel": "linkedin", "market": "${market}", "metaAds": [{ "headline": "string (max 70 chars)", "bodyText": "string (max 600 chars)", "cta": "string" }] (3 variants), "generatedAt": "ISO" }`,
  };

  if (channel === 'email' || channel === 'whatsapp') {
    const schema = channelSchemas[channel];
    return `Write ${channel} copy for this app:

App: ${appName}
Pain points: ${icp.painPoints.join(', ')}
Target user: ${icp.targetUser}
${marketContext}
${playbookContext}

Return JSON: ${schema}`;
  }

  if (channel === 'meta' || channel === 'google' || channel === 'linkedin') {
    return `Write ${channel} ad copy for this app:

App: ${appName}
Pain points: ${icp.painPoints.join(', ')}
Target user: ${icp.targetUser}
${marketContext}
${playbookContext}

Return JSON: ${channelSchemas[channel]}`;
  }

  // app_store channel (always USA focused)
  return `Rewrite the App Store listing for this app to maximise conversion:

App: ${appName}
Category: Productivity
Pain points: ${icp.painPoints.join(', ')}
Target user: ${icp.targetUser}

Return JSON: { "channel": "meta", "market": "${market}", "appStoreListing": { "title": "string (max 30 chars)", "subtitle": "string (max 30 chars)", "description": "string (max 4000 chars)", "keywords": ["string",...] (max 100 chars total) }, "generatedAt": "ISO" }`;
}

/**
 * Generates content assets for a specific channel + market combination.
 * @param productId - UUID of the product
 * @param channel   - Target channel ('meta'|'google'|'whatsapp'|'linkedin'|'email')
 * @param market    - Target market ('usa'|'india')
 * @param founderId - UUID of the requesting founder (ownership check)
 * @returns         Validated ContentAssets object
 * @throws          {Error} If product not found, ownership fails, or Claude returns invalid JSON
 * @security        founderId verified against product. consumeTokens() called before API call.
 */
export async function generateContentAssets(
  productId: string,
  channel: Channel,
  market: 'usa' | 'india',
  founderId: string
): Promise<ContentAssets> {
  const supabase = getSupabaseAdmin();

  const { data: product, error } = await supabase
    .from('products')
    .select('name, category, confirmed_icp, icp_embedding, founder_id')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .is('archived_at', null)
    .single();

  if (error || !product) throw new Error('Product not found or access denied');

  const icp = product.confirmed_icp as ICPBrief | null;
  if (!icp) throw new Error('Product has no confirmed ICP brief');

  const playbookContext = await buildPlaybookContext(
    product.category ?? 'Productivity',
    market,
    product.icp_embedding ?? null
  );

  await consumeTokens(founderId, 'content_generation', 20);

  // Strip markdown code fences if Claude wraps the JSON
  const rawAssets = (await callSonnet(ASSETS_SYSTEM, buildAssetsPrompt(channel, market, product.name, icp, playbookContext), 2048,
    { founderId, productId, promptId: 'content_assets', action: 'content_assets' }))
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let assets: ContentAssets;
  try {
    const parsed = JSON.parse(rawAssets);
    parsed.channel = channel;
    parsed.market = market;
    parsed.generatedAt = new Date().toISOString();
    assets = ContentAssetsSchema.parse(parsed);
  } catch (err) {
    console.error('[strategyService] assets parse error:', (err as Error).message, '\nraw:', rawAssets.slice(0, 400));
    Sentry.captureException(err, {
      tags: { service: 'strategyService', productId, channel, market },
      extra: { rawResponse: rawAssets.slice(0, 500) },
    });
    throw new Error('Content generation returned invalid JSON — please retry');
  }

  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action: 'content_assets_generated',
    resource_type: 'product',
    resource_id: productId,
    metadata: { channel, market },
  });

  return assets;
}

/**
 * Returns the latest strategy + campaign drafts for a product.
 * Free tier: fullStrategy is omitted from the response (campaigns list only).
 * @param productId - UUID of the product
 * @param founderId - UUID of the requesting founder
 * @returns         { campaigns, fullStrategy? }
 * @security        founderId verified via DB query. Free plan gate applied in route layer.
 */
export async function getProductStrategy(
  productId: string,
  founderId: string
): Promise<{ campaigns: unknown[]; fullStrategy: Strategy | null }> {
  const supabase = getSupabaseAdmin();

  const [{ data: product }, { data: campaigns }] = await Promise.all([
    supabase.from('products').select('founder_id, full_strategy').eq('id', productId).single(),
    supabase
      .from('campaigns')
      .select('*')
      .eq('product_id', productId)
      .eq('founder_id', founderId)
      .order('created_at', { ascending: false }),
  ]);

  if (!product || product.founder_id !== founderId) throw new Error('Product not found');

  let fullStrategy: Strategy | null = null;
  if (product.full_strategy) {
    try {
      fullStrategy = StrategySchema.parse(product.full_strategy);
    } catch {
      // Stored strategy doesn't match current schema — treat as no strategy
      fullStrategy = null;
    }
  }

  return { campaigns: campaigns ?? [], fullStrategy };
}
