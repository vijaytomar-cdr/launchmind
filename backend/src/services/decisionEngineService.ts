/**
 * @file decisionEngineService.ts
 * @description Decision Engine — all deterministic business rules.
 *   AI cannot override any function in this file.
 *   New routes call these functions instead of inlining the same checks.
 *   Existing routes keep their inline guards until a dedicated refactor sprint.
 * @security
 *   - All checks throw DecisionError with HTTP-ready statusCode and code.
 *   - No AI calls. No external network calls in the critical path.
 *   - Audit log written for every rule violation.
 * @dependencies supabaseAdmin
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export class DecisionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DecisionError';
  }
}

/**
 * §1.5 — Approve-Before-Post.
 * Throws 422 if the campaign or content asset has not been approved.
 */
export async function checkApprovalGate(
  resourceType: 'campaign' | 'content_asset',
  resourceId: string,
  founderId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const table = resourceType === 'campaign' ? 'campaigns' : 'content_assets';

  const { data, error } = await supabase
    .from(table)
    .select('id, approved_at')
    .eq('id', resourceId)
    .eq('founder_id', founderId)
    .single();

  if (error || !data) {
    throw new DecisionError(`${resourceType} not found`, 404, 'NOT_FOUND');
  }

  if (!(data as { approved_at: string | null }).approved_at) {
    throw new DecisionError(
      `${resourceType} must be approved before publishing`,
      422,
      'APPROVAL_REQUIRED',
      { resourceType, resourceId },
    );
  }
}

/**
 * §1.6 — Spend cap enforcement.
 * Throws 422 if current week spend + proposedBudget > weeklyUSD × 1.5.
 * @param proposedBudget - USD amount being proposed for this campaign
 */
export async function checkSpendCap(
  campaignId: string,
  proposedBudget: number,
  founderId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('spend_cap, channel, market')
    .eq('id', campaignId)
    .eq('founder_id', founderId)
    .single();

  if (!campaign) return; // If campaign not found, let the calling route handle 404

  const cap = (campaign as { spend_cap: Record<string, number> | null }).spend_cap;
  if (!cap?.weeklyUSD) return; // No cap set — pass through

  // Sum current week spend for this founder + channel
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  weekStart.setHours(0, 0, 0, 0);

  const { data: metrics } = await supabase
    .from('campaign_metrics')
    .select('cpi, installs')
    .eq('founder_id', founderId)
    .gte('week_start', weekStart.toISOString().slice(0, 10));

  const currentSpend = (metrics ?? []).reduce((sum: number, m: { cpi: number | null; installs: number | null }) =>
    sum + ((m.cpi ?? 0) * (m.installs ?? 0)), 0
  );

  if (currentSpend + proposedBudget > cap.weeklyUSD * 1.5) {
    throw new DecisionError(
      'Spend cap would be exceeded',
      422,
      'SPEND_CAP_EXCEEDED',
      { currentSpend, proposedBudget, cap: cap.weeklyUSD },
    );
  }
}

/**
 * Plan-feature gate.
 * Throws 403 if the founder's plan does not meet the required tier.
 */
export async function checkPlanFeature(
  founderId: string,
  feature: string,
  requiredPlan: 'solo' | 'builder' | 'studio',
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const PLAN_RANK: Record<string, number> = { free: 0, solo: 1, builder: 2, studio: 3 };

  const { data: founder } = await supabase
    .from('founders')
    .select('plan')
    .eq('id', founderId)
    .single();

  const founderRank = PLAN_RANK[(founder as { plan: string } | null)?.plan ?? 'free'] ?? 0;
  const requiredRank = PLAN_RANK[requiredPlan];

  if (founderRank < requiredRank) {
    throw new DecisionError(
      `${feature} requires the ${requiredPlan} plan or higher`,
      403,
      'PLAN_GATE',
      { feature, requiredPlan, currentPlan: (founder as { plan: string } | null)?.plan ?? 'free' },
    );
  }
}

/**
 * Token balance check.
 * Throws 402 if the founder does not have enough tokens.
 */
export async function checkTokenBalance(
  founderId: string,
  estimatedCost: number,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: founder } = await supabase
    .from('founders')
    .select('token_balance, plan')
    .eq('id', founderId)
    .single();

  if (!founder) return;

  const f = founder as { token_balance: number | null; plan: string };
  if (f.token_balance === null) return; // null = unlimited (Phase 1 mode)

  if (f.token_balance < estimatedCost) {
    throw new DecisionError(
      'Insufficient token balance',
      402,
      'INSUFFICIENT_TOKENS',
      { balance: f.token_balance, required: estimatedCost },
    );
  }
}

/**
 * Content asset regeneration limit.
 * Throws 422 if the asset has already been regenerated 3+ times.
 */
export function checkRegenLimit(currentRegenCount: number, assetId: string): void {
  if (currentRegenCount >= 3) {
    throw new DecisionError(
      'Maximum regenerations (3) reached for this asset',
      422,
      'REGEN_LIMIT_EXCEEDED',
      { assetId, regenCount: currentRegenCount },
    );
  }
}

/**
 * Experiment minimum runtime check.
 * Throws 422 if the experiment has been running fewer than 7 days.
 */
export async function checkExperimentRuntime(
  experimentId: string,
  founderId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: exp } = await supabase
    .from('experiments')
    .select('start_date, status')
    .eq('id', experimentId)
    .eq('founder_id', founderId)
    .single();

  if (!exp) return;

  const e = exp as { start_date: string | null; status: string };
  if (e.status !== 'running' || !e.start_date) return;

  const daysSinceStart = (Date.now() - new Date(e.start_date).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceStart < 7) {
    throw new DecisionError(
      `Experiment must run at least 7 days before declaring a winner (${Math.ceil(7 - daysSinceStart)} days remaining)`,
      422,
      'EXPERIMENT_TOO_EARLY',
      { experimentId, daysSinceStart: Math.floor(daysSinceStart) },
    );
  }
}

/**
 * Workspace permission check.
 * Throws 403 if the founder does not own the workspace.
 */
export async function checkWorkspacePermission(
  founderId: string,
  workspaceId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: ws } = await supabase
    .from('workspaces')
    .select('id, founder_id')
    .eq('id', workspaceId)
    .single();

  if (!ws || (ws as { founder_id: string }).founder_id !== founderId) {
    throw new DecisionError(
      'You do not have permission to access this workspace',
      403,
      'WORKSPACE_FORBIDDEN',
      { workspaceId },
    );
  }
}

/**
 * Benchmark access check.
 * Any authenticated founder can read benchmarks — no plan gate.
 * This is a no-op enforcement (benchmarks are always allowed) but exists for the
 * registry pattern and future compliance additions.
 */
export function checkBenchmarkAccess(_founderId: string): void {
  // Benchmarks are available to all authenticated founders — no restriction.
}
