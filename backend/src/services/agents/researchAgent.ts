/**
 * @file agents/researchAgent.ts
 * @description Research agent — scrapes product data, analyses reviews, enriches ICP.
 *   Runs as the first step in research, strategy, and content missions.
 * @security Reads only context provided by AgentContext — no direct DB access.
 * @dependencies aiPlatform, contextEngine (via AgentContext)
 */

import { callHaiku } from '../../lib/aiPlatform';
import type { AgentFn } from '../../types/mission';

const RESEARCH_SYSTEM = `You are a mobile app market research analyst. Given product context,
summarise the key findings: core value proposition, target user pain points, main competitors,
market positioning, and top 3 messaging opportunities. Be concise and specific.
Return a JSON object with keys: summary, painPoints (array), competitors (array),
messagingOpportunities (array), marketPosition.`;

/**
 * Research agent — builds a structured research package from existing product context.
 * Does not re-scrape; uses the context package already assembled by the Context Engine.
 * @returns Research output including summary, pain points, competitors, opportunities
 */
export const researchAgent: AgentFn = async (input, context) => {
  const { contextPkg, founderId, productId, missionId, stepId } = context;

  await context.log('Research agent starting', 'info', { founderId, missionId });

  const productName   = contextPkg.product?.name ?? 'Unknown product';
  const icpSummary    = JSON.stringify(contextPkg.product?.confirmedIcp ?? {}, null, 2);
  const recentMemory  = contextPkg.memories?.slice(0, 3).map(m => m.title).join('\n') ?? 'None';
  const competitors   = JSON.stringify(contextPkg.product?.competitorSet ?? [], null, 2);

  const prompt = `Product: ${productName}
ICP: ${icpSummary}
Competitors: ${competitors}
Recent learnings: ${recentMemory}

Additional context: ${JSON.stringify(input)}

Produce a structured research summary.`;

  await context.log('Calling AI for research summary', 'debug');

  let result: string;
  try {
    result = await callHaiku(prompt, 1024, { founderId, productId, promptId: 'agent_research_summary', action: 'agent_research_summary' });
  } catch (err) {
    await context.log(`AI call failed: ${(err as Error).message}`, 'error');
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result };
  } catch {
    parsed = { summary: result };
  }

  await context.log('Research complete', 'info', { outputKeys: Object.keys(parsed) });

  return {
    productName,
    ...parsed,
    generatedAt: new Date().toISOString(),
  };
};
