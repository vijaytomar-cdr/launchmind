/**
 * @file agents/contentAgent.ts
 * @description Content agent — generates copy for ads, emails, and ASO from strategy context.
 *   Produces structured content assets (hook, body, CTA) per channel.
 * @security No direct DB access. Input comes from AgentContext only.
 * @dependencies aiPlatform (callSonnet + callHaiku)
 */

import { callSonnet, callHaiku } from '../../lib/aiPlatform';
import type { AgentFn } from '../../types/mission';

const CONTENT_SYSTEM = `You are a performance copywriter for mobile app marketing.
Generate channel-specific ad copy: hook (≤12 words), body (2-3 sentences), CTA (≤6 words).
Return a JSON array of content assets, each with:
  channel (string), market (string), hook (string), body (string), cta (string),
  charCount (number), hookType (string: question|stat|story|social_proof).`;

const SCORE_SYSTEM = `You are a marketing copy evaluator. Score each content asset:
  relevanceScore (0-100), clarityScore (0-100), urgencyScore (0-100), overallScore (0-100).
  Return JSON array with the same items plus scores. Keep all original fields.`;

/**
 * Content agent — generates and scores channel-specific copy.
 * @param input  Should include strategy output and target channels/markets
 * @returns Array of scored content assets
 */
export const contentAgent: AgentFn = async (input, context) => {
  const { contextPkg, founderId, productId } = context;

  await context.log('Content agent starting', 'info');

  const productName  = contextPkg.product?.name ?? 'Unknown product';
  const brandVoice   = JSON.stringify(contextPkg.product?.brandVoiceProfile ?? {});
  const strategyOut  = JSON.stringify(input.strategy ?? input, null, 2);
  const channels     = (input.channels as string[]) ?? ['meta', 'email'];
  const markets      = (input.markets as string[]) ?? contextPkg.product?.markets ?? ['usa'];

  const prompt = `Product: ${productName}
Brand voice: ${brandVoice}
Strategy: ${strategyOut}
Generate copy for channels: ${channels.join(', ')} and markets: ${markets.join(', ')}.
Create 2 variations per channel per market.`;

  await context.log('Generating copy', 'debug');

  let rawCopy: string;
  try {
    rawCopy = await callSonnet(CONTENT_SYSTEM, prompt, 2048, { founderId, productId, promptId: 'agent_content_copy', action: 'agent_content_copy' });
  } catch (err) {
    await context.log(`Copy generation failed: ${(err as Error).message}`, 'error');
    throw err;
  }

  let assets: Record<string, unknown>[] = [];
  try {
    const jsonMatch = rawCopy.match(/\[[\s\S]*\]/);
    assets = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    assets = [{ rawCopy }];
  }

  // Score each asset with Haiku
  let scoredAssets = assets;
  if (assets.length > 0) {
    try {
      const scorePrompt = `Score these content assets:\n${JSON.stringify(assets, null, 2)}`;
      const scored = await callHaiku(scorePrompt, 1024, { founderId, productId, promptId: 'agent_content_score', action: 'agent_content_score' });
      const jsonMatch = scored.match(/\[[\s\S]*\]/);
      if (jsonMatch) scoredAssets = JSON.parse(jsonMatch[0]);
    } catch {
      // Non-fatal — return unscored assets
      await context.log('Scoring step failed; returning unscored assets', 'warn');
    }
  }

  await context.log(`Content generated: ${scoredAssets.length} assets`, 'info');

  return {
    productName,
    assets:      scoredAssets,
    channels,
    markets,
    assetCount:  scoredAssets.length,
    generatedAt: new Date().toISOString(),
  };
};
