/**
 * @file agents/learningAgent.ts
 * @description Learning agent — persists mission results as marketing memories via learningPipelineService.
 *   Full wiring in Milestone 07; stub returns confirmation for now.
 * @dependencies learningPipelineService
 */

import type { AgentFn } from '../../types/mission';

export const learningAgent: AgentFn = async (input, context) => {
  await context.log('Learning agent (stub) running', 'info');
  return {
    memoriesCreated: 0,
    graphNodesAdded: 0,
    generatedAt:     new Date().toISOString(),
    stub:            true,
  };
};
