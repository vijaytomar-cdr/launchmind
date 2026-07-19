/**
 * @file modelRouter.ts
 * @description Model routing table for the AI Platform.
 *   Maps prompt_id → { model, maxTokens }. Used by generateAI() to select the model.
 *   Static for M05; dynamic routing (based on performance data) is planned for M07.
 * @security No auth required — routing decisions are config, not data.
 * @dependencies none
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelChoice {
  model: string;
  maxTokens: number;
}

// ── Routing table ─────────────────────────────────────────────────────────────

/**
 * Maps prompt_id to model + maxTokens.
 * Sonnet: complex multi-step reasoning, long structured JSON output.
 * Haiku:  scoring, quick rewrites, classification, single-turn tasks.
 */
const ROUTING_TABLE: Record<string, ModelChoice> = {
  // ── Sonnet: complex generation ─────────────────────────────────────────────
  strategy_generation: { model: 'claude-sonnet-4-6', maxTokens: 4096 },
  content_assets:      { model: 'claude-sonnet-4-6', maxTokens: 2048 },
  content_generation:  { model: 'claude-sonnet-4-6', maxTokens: 12000 },

  // ── Haiku: fast classification + rewrites ──────────────────────────────────
  weekly_brief:         { model: 'claude-haiku-4-5-20251001', maxTokens: 600 },
  brand_voice_extract:  { model: 'claude-haiku-4-5-20251001', maxTokens: 400 },
  brand_voice_apply:    { model: 'claude-haiku-4-5-20251001', maxTokens: 300 },
  icp_structure:        { model: 'claude-haiku-4-5-20251001', maxTokens: 512 },
  review_analysis:      { model: 'claude-haiku-4-5-20251001', maxTokens: 1024 },
  content_score:        { model: 'claude-haiku-4-5-20251001', maxTokens: 600 },
  char_limit_rewrite:   { model: 'claude-haiku-4-5-20251001', maxTokens: 300 },
  screenshot_analysis:  { model: 'claude-haiku-4-5-20251001', maxTokens: 512 },
};

/** Fallback for unknown prompt IDs */
const DEFAULT_CHOICE: ModelChoice = { model: 'claude-haiku-4-5-20251001', maxTokens: 600 };

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Returns the model + maxTokens for a given prompt_id.
 * Falls back to Haiku/600 for unknown prompt IDs.
 * @param promptId   - Registered prompt identifier
 * @param maxOverride - Caller may override maxTokens (e.g., for large contexts)
 */
export function routeModel(promptId: string, maxOverride?: number): ModelChoice {
  const choice = ROUTING_TABLE[promptId] ?? DEFAULT_CHOICE;
  return maxOverride ? { ...choice, maxTokens: maxOverride } : choice;
}

/**
 * Returns true if the given prompt_id routes to Sonnet.
 * Useful for callers that need to pre-flight token costs.
 */
export function isSonnet(promptId: string): boolean {
  return (ROUTING_TABLE[promptId]?.model ?? DEFAULT_CHOICE.model).includes('sonnet');
}

/**
 * Returns the full routing table (for inspection / tests).
 */
export function getRoutingTable(): Record<string, ModelChoice> {
  return { ...ROUTING_TABLE };
}
