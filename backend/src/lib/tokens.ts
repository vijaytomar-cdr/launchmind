/**
 * @file tokens.ts
 * @description AI token consumption tracker. Every Claude API call routes through here.
 *   Phase 5: enforces founders.token_balance via consume_tokens() Postgres RPC.
 *   Subscription founders (token_balance IS NULL) are never blocked.
 *   FOR UPDATE row lock in consume_tokens() prevents race conditions on concurrent requests.
 * @security Throws InsufficientTokensError (→ 402) when balance exhausted.
 *   Race condition safe: two concurrent 50-cost requests against balance=50 → exactly one succeeds.
 *   On RPC failure, logs error but does not block the AI call (avoids cascading failures on DB hiccup).
 * @dependencies supabaseAdmin, InsufficientTokensError, audit_logs
 */

import { getSupabaseAdmin } from './supabaseAdmin';
import { InsufficientTokensError } from '../types/errors';

/**
 * Consumes tokens from founder balance for an AI action.
 * Uses consume_tokens() Postgres RPC (atomic FOR UPDATE deduction).
 * @param founderId - UUID of the founder consuming tokens
 * @param action    - Action name for audit log (e.g. 'strategy_generation')
 * @param cost      - Token cost (see CLAUDE.md §8)
 * @throws {InsufficientTokensError} When balance < cost and balance IS NOT NULL
 */
export async function consumeTokens(
  founderId: string,
  action: string,
  cost: number
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: newBalance, error } = await supabase.rpc('consume_tokens', {
    p_founder_id: founderId,
    p_cost: cost,
  });

  if (error) {
    // RPC failure — log but do not block the AI call (avoids cascading failures on DB hiccup)
    console.error(`[tokens] consume_tokens RPC failed for ${founderId}: ${error.message}`);
    return;
  }

  if (newBalance === -1) {
    const { data: founder } = await supabase
      .from('founders')
      .select('token_balance')
      .eq('id', founderId)
      .single();
    throw new InsufficientTokensError(founder?.token_balance ?? 0, cost, action);
  }

  // Write audit log — newBalance === null means subscription (unlimited), otherwise numeric
  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action: newBalance === null ? 'tokens_consumed_subscription' : 'tokens_consumed',
    resource_type: 'ai_token',
    metadata: { action, cost, balance_after: newBalance },
  });
}
