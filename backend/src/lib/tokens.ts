/**
 * @file tokens.ts
 * @description AI token consumption tracker. Every Claude API call routes through here.
 *   Phase 1–4: logs to console + writes an immutable audit_log entry. Returns void.
 *   Phase 5: enforces founders.token_balance before returning (deducted from balance).
 *   The function signature NEVER changes between phases.
 * @security Writes to the immutable audit_logs table on every call.
 *   founderId is stored with the audit entry — no anonymous consumption allowed.
 * @dependencies supabaseAdmin, audit_logs table
 */

import { getSupabaseAdmin } from './supabaseAdmin';

/**
 * Records AI token consumption for a founder action.
 * Phase 1 behaviour: logs to console + writes audit_log. Does NOT deduct balance.
 * @param founderId     - UUID of the founder consuming tokens
 * @param action        - Action identifier e.g. 'strategy_generation', 'review_analysis'
 * @param estimatedCost - Token cost for this action (see CLAUDE.md §8 for reference values)
 * @returns             void
 * @throws              Never — logs errors internally. Caller is never blocked by audit failure.
 * @security            Audit log entry is immutable (no UPDATE/DELETE on audit_logs).
 */
export async function consumeTokens(
  founderId: string,
  action: string,
  estimatedCost: number
): Promise<void> {
  console.log(`[tokens] consumed action=${action} founderId=${founderId} cost=${estimatedCost}`);

  const { error } = await getSupabaseAdmin()
    .from('audit_logs')
    .insert({
      founder_id: founderId,
      action: `token_consumed:${action}`,
      resource_type: 'ai_token',
      metadata: { action, estimatedCost },
    });

  if (error) {
    console.error(`[tokens] audit_log write failed: ${error.message}`);
  }
}
