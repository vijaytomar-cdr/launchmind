/**
 * @file agents/creativeAgent.ts
 * @description Creative agent — generates visual assets (images, video) via Replicate / Creatomate.
 *   Stub: delegates to contentService.generateImageFromBrief(); full pipeline in Milestone 07.
 * @dependencies replicateClient, creatomateClient
 */

import type { AgentFn } from '../../types/mission';

export const creativeAgent: AgentFn = async (input, context) => {
  await context.log('Creative agent (stub) running', 'info');
  return {
    visualAssets: [],
    videoAssets:  [],
    generatedAt:  new Date().toISOString(),
    stub:         true,
  };
};
