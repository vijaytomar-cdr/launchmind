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

import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/node';
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

const client = new Anthropic();

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

Return JSON matching EXACTLY this schema:
{
  "thirtyDay": [{ "channel": "meta"|"google"|"whatsapp"|"linkedin"|"email", "rationale": "string", "projectedPerformance": "high"|"medium"|"low", "suggestedWeeklySpendUSD": number, "suggestedWeeklySpendINR": number, "hookType": "string", "primaryKPI": "string" }],
  "sixtyDay": [same structure],
  "ninetyDay": [same structure],
  "usa": { "positioning": "string", "primaryChannels": ["channel",...], "messagingAngle": "string", "pricingAngle": "string", "topObjection": "string", "objectiveFocus": "string" },
  "india": { same as usa },
  "executiveSummary": "string",
  "generatedAt": "ISO timestamp"
}

thirtyDay = top 3 channels to start. sixtyDay = optimise + expand. ninetyDay = scale winners.
USA messaging should be outcome-focused. India messaging should be value + social proof focused.`;
}

/**
 * Generates a 30/60/90-day strategy and saves campaign draft rows for the product.
 * @param productId - UUID of the product to strategise
 * @param founderId - UUID of the requesting founder (ownership check)
 * @returns         Generated Strategy object
 * @throws          {Error} If product not found, ownership fails, or Claude returns invalid JSON
 * @security        founderId verified against product.founder_id. consumeTokens() called first.
 */
export async function generateStrategy(
  productId: string,
  founderId: string
): Promise<Strategy> {
  const supabase = getSupabaseAdmin();

  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('founder_id', founderId)
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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: STRATEGY_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildStrategyPrompt(
          product.name,
          product.category ?? 'Productivity',
          icp,
          playbookContext,
          founderContext
        ),
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude returned non-text response');

  let strategy: Strategy;
  try {
    const parsed = JSON.parse(content.text);
    parsed.generatedAt = new Date().toISOString();
    strategy = StrategySchema.parse(parsed);
  } catch (err) {
    Sentry.captureException(err, { tags: { service: 'strategyService', productId } });
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

  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action: 'strategy_generated',
    resource_type: 'product',
    resource_id: productId,
    metadata: { campaignDrafts: campaignInserts.length },
  });

  return strategy;
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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: ASSETS_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildAssetsPrompt(channel, market, product.name, icp, playbookContext),
      },
    ],
  });

  const msgContent = message.content[0];
  if (msgContent.type !== 'text') throw new Error('Claude returned non-text response');

  let assets: ContentAssets;
  try {
    const parsed = JSON.parse(msgContent.text);
    parsed.channel = channel;
    parsed.market = market;
    parsed.generatedAt = new Date().toISOString();
    assets = ContentAssetsSchema.parse(parsed);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { service: 'strategyService', productId, channel, market },
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
    supabase.from('products').select('founder_id').eq('id', productId).single(),
    supabase
      .from('campaigns')
      .select('*')
      .eq('product_id', productId)
      .eq('founder_id', founderId)
      .order('created_at', { ascending: false }),
  ]);

  if (!product || product.founder_id !== founderId) throw new Error('Product not found');

  return { campaigns: campaigns ?? [], fullStrategy: null };
}
