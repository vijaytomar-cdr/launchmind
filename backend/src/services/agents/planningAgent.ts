/**
 * @file agents/planningAgent.ts
 * @description Planning agent — converts strategy into an ordered task list.
 *   Stub: returns a placeholder task list pending full implementation in Milestone 07.
 * @dependencies aiPlatform
 */

import type { AgentFn } from '../../types/mission';

export const planningAgent: AgentFn = async (input, context) => {
  await context.log('Planning agent (stub) running', 'info');
  return {
    tasks:       [{ title: 'Implement planning agent', priority: 'high', dueDate: null }],
    generatedAt: new Date().toISOString(),
    stub:        true,
  };
};
