/**
 * @file agents/strategyAgent.ts
 * @description Strategy agent — generates 30/60/90-day marketing strategy from research output.
 *   Used in 'strategy' missions after the research step.
 * @security No direct DB access. Reads from AgentContext.contextPkg only.
 * @dependencies aiPlatform (callSonnet)
 */

import { callSonnet } from '../../lib/aiPlatform';
import type { AgentFn } from '../../types/mission';

const STRATEGY_SYSTEM = `You are a growth marketing strategist specialising in mobile app user acquisition.
Given research findings, product context, and market data, generate a structured 30/60/90-day marketing
strategy. Return a JSON object with keys:
  day30 (object: goals, channels, tactics, budget_pct),
  day60 (object: goals, channels, tactics, budget_pct),
  day90 (object: goals, channels, tactics, budget_pct),
  primaryChannel (string),
  targetCpi (number),
  keyMessages (array of 3 strings),
  marketFocus (array of market names).
Be specific, actionable, and aligned with the ICP.`;

/**
 * Strategy agent — produces a 30/60/90-day strategy document.
 * @param input  Should include research output from the previous step
 * @returns Structured strategy with day30/60/90 plans and key messages
 */
export const strategyAgent: AgentFn = async (input, context) => {
  const { contextPkg, founderId, productId } = context;

  await context.log('Strategy agent starting', 'info');

  const productName  = contextPkg.product?.name ?? 'Unknown product';
  const markets      = contextPkg.product?.markets ?? ['usa'];
  const icpSummary   = JSON.stringify(contextPkg.product?.confirmedIcp ?? {}, null, 2);
  const researchOut  = JSON.stringify(input.researchOutput ?? input, null, 2);
  const playbookData = JSON.stringify(contextPkg.knowledgeNodes?.slice(0, 5) ?? [], null, 2);

  const prompt = `Product: ${productName}
Markets: ${markets.join(', ')}
ICP: ${icpSummary}
Research findings: ${researchOut}
Playbook benchmarks: ${playbookData}

Generate a comprehensive 30/60/90-day marketing strategy.`;

  await context.log('Calling AI for strategy generation', 'debug');

  let result: string;
  try {
    result = await callSonnet(STRATEGY_SYSTEM, prompt, 3000, { founderId, productId, promptId: 'agent_strategy_generation', action: 'agent_strategy_generation' });
  } catch (err) {
    await context.log(`Strategy AI call failed: ${(err as Error).message}`, 'error');
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { rawStrategy: result };
  } catch {
    parsed = { rawStrategy: result };
  }

  await context.log('Strategy generated', 'info', { hasDay30: !!parsed.day30, hasDay60: !!parsed.day60 });

  return {
    productName,
    markets,
    strategy:    parsed,
    generatedAt: new Date().toISOString(),
  };
};
