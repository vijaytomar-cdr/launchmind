/**
 * @file agents/benchmarkAgent.ts
 * @description Benchmark agent — compares product metrics to playbook_signals industry benchmarks.
 *   Stub: returns placeholder comparison pending full implementation in Milestone 07.
 * @dependencies supabaseAdmin (playbook_signals)
 */

import type { AgentFn } from '../../types/mission';

export const benchmarkAgent: AgentFn = async (input, context) => {
  await context.log('Benchmark agent (stub) running', 'info');
  return {
    benchmarks:  [],
    comparison:  null,
    generatedAt: new Date().toISOString(),
    stub:        true,
  };
};
