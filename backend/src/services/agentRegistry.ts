/**
 * @file agentRegistry.ts
 * @description Maps AgentType to AgentFn. Single dispatch table used by missionWorker.
 *   Add new agents here only — never import agent files elsewhere.
 * @security No auth logic. Auth is handled by missionWorker before dispatch.
 * @dependencies All 12 agent modules
 */

import type { AgentFn, AgentType } from '../types/mission';

import { researchAgent }     from './agents/researchAgent';
import { strategyAgent }     from './agents/strategyAgent';
import { planningAgent }     from './agents/planningAgent';
import { contentAgent }      from './agents/contentAgent';
import { creativeAgent }     from './agents/creativeAgent';
import { campaignAgent }     from './agents/campaignAgent';
import { publishingAgent }   from './agents/publishingAgent';
import { optimizationAgent } from './agents/optimizationAgent';
import { learningAgent }     from './agents/learningAgent';
import { reportingAgent }    from './agents/reportingAgent';
import { memoryAgent }       from './agents/memoryAgent';
import { benchmarkAgent }    from './agents/benchmarkAgent';

export const AGENT_REGISTRY: Record<AgentType, AgentFn> = {
  research:    researchAgent,
  strategy:    strategyAgent,
  planning:    planningAgent,
  content:     contentAgent,
  creative:    creativeAgent,
  campaign:    campaignAgent,
  publishing:  publishingAgent,
  optimization: optimizationAgent,
  learning:    learningAgent,
  reporting:   reportingAgent,
  memory:      memoryAgent,
  benchmark:   benchmarkAgent,
};
