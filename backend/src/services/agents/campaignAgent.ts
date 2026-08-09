/**
 * @file agents/campaignAgent.ts
 * @description Campaign agent — drafts campaign objects and validates budget against spend caps.
 *   Enforces the spend guardrail rule (§1.6 of CLAUDE.md) before creating any paid campaign.
 * @security spend_cap is always fetched fresh from DB; platform spend is verified server-side.
 *   No campaign is created without Founder approval (requires_approval=true in MISSION_TEMPLATES).
 * @dependencies aiPlatform, supabaseAdmin
 */

import { callHaiku } from '../../lib/aiPlatform';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { AgentFn } from '../../types/mission';

const _CAMPAIGN_DRAFT_SYSTEM = `You are a mobile app campaign strategist.
Given content assets and strategy, draft campaign configuration objects.
Return a JSON array of campaign drafts, each with:
  channel (string), market (string), hookType (string), copyText (string),
  audienceConfig (object), proposedBudget (number, USD/day), rationale (string).`;

/**
 * Campaign agent — drafts campaign objects from content assets + validates budget.
 * Returns draft campaign configs for founder approval before any platform API call.
 */
export const campaignAgent: AgentFn = async (input, context) => {
  const { contextPkg: _contextPkg, founderId, productId } = context;

  await context.log('Campaign agent starting', 'info', { founderId });

  const contentOut  = JSON.stringify(input.assets ?? input, null, 2);
  const strategyOut = JSON.stringify(input.strategy ?? {});

  const prompt = `Draft campaign configurations from these content assets:
${contentOut}

Strategy context: ${strategyOut}

Create platform-ready campaign drafts.`;

  let rawDrafts: string;
  try {
    rawDrafts = await callHaiku(prompt, 1024, { founderId, productId, promptId: 'agent_campaign_draft', action: 'agent_campaign_draft' });
  } catch (err) {
    await context.log(`Campaign draft AI call failed: ${(err as Error).message}`, 'error');
    throw err;
  }

  let drafts: Record<string, unknown>[] = [];
  try {
    const jsonMatch = rawDrafts.match(/\[[\s\S]*\]/);
    drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    drafts = [];
  }

  // §1.6 — Validate each draft against spend_cap
  if (productId) {
    const supabase = getSupabaseAdmin();
    const validatedDrafts: Record<string, unknown>[] = [];

    for (const draft of drafts) {
      const channel       = draft.channel as string;
      const proposedBudget = (draft.proposedBudget as number) ?? 0;

      // Fetch spend_cap for this founder + channel
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('spend_cap')
        .eq('founder_id', founderId)
        .eq('channel', channel)
        .not('spend_cap', 'is', null)
        .limit(1)
        .maybeSingle();

      const spendCap = (campaigns?.spend_cap as { daily_usd?: number })?.daily_usd ?? Infinity;

      if (proposedBudget > spendCap) {
        await context.log(
          `Budget guardrail: draft for ${channel} exceeds cap (${proposedBudget} > ${spendCap})`,
          'warn', { channel, proposedBudget, spendCap },
        );
        validatedDrafts.push({ ...draft, guardrailBlocked: true, spendCapUsd: spendCap });
      } else {
        validatedDrafts.push({ ...draft, guardrailBlocked: false, spendCapUsd: spendCap });
      }
    }

    drafts = validatedDrafts;
  }

  const eligibleCount = drafts.filter(d => !d.guardrailBlocked).length;
  await context.log(`Campaign drafts ready: ${drafts.length} total, ${eligibleCount} eligible`, 'info');

  return {
    drafts,
    totalDrafts:   drafts.length,
    eligibleDrafts: eligibleCount,
    requiresApproval: true, // Always — enforced by MISSION_TEMPLATES step
    generatedAt:   new Date().toISOString(),
  };
};
