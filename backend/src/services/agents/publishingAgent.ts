/**
 * @file agents/publishingAgent.ts
 * @description Publishing agent — posts approved campaigns to platforms.
 *   SECURITY: verifies campaigns.approved_at is non-null before any platform API call (§1.5 CLAUDE.md).
 *   Stub: enforce approval check now; platform API integration in Milestone 07.
 * @dependencies supabaseAdmin, platformTokenService
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { AgentFn } from '../../types/mission';

export const publishingAgent: AgentFn = async (input, context) => {
  const { founderId } = context;
  await context.log('Publishing agent running — verifying approval', 'info');

  const campaignId = input.campaignId as string | undefined;

  if (campaignId) {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('campaigns')
      .select('approved_at, status')
      .eq('id', campaignId)
      .eq('founder_id', founderId)
      .single();

    if (!data?.approved_at) {
      await context.log('Publishing blocked: campaign not approved', 'error', { campaignId });
      throw new Error('Campaign must be approved before publishing (campaigns.approved_at is null)');
    }
  }

  await context.log('Publishing agent (stub) — approval check passed, platform post deferred', 'info');
  return {
    published:   false,
    stub:        true,
    generatedAt: new Date().toISOString(),
  };
};
