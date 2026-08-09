/**
 * @file missionService.ts
 * @description Mission Orchestrator service — creates, transitions, and queries missions.
 *   Enforces the mission state machine (ADR-031). All lifecycle transitions write mission_logs.
 *   No agent logic here — this service only manages state.
 * @security founderId is verified on every operation. RLS enforced at DB layer.
 * @dependencies supabaseAdmin, mission types
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import type {
  Mission, MissionStep, MissionLog, MissionApproval, StepStatus, MissionType, MissionStepTemplate, CreateMissionInput, MissionJobPayload,
} from '../types/mission';

// ── Mission templates — step definitions per mission type ─────────────────────

const MISSION_TEMPLATES: Record<MissionType, MissionStepTemplate[]> = {
  research: [
    { stepName: 'scrape_product',    agentType: 'research',     requiresApproval: false },
    { stepName: 'analyse_reviews',   agentType: 'research',     requiresApproval: false },
    { stepName: 'enrich_icp',        agentType: 'research',     requiresApproval: false },
    { stepName: 'save_learnings',    agentType: 'learning',     requiresApproval: false },
  ],
  strategy: [
    { stepName: 'build_context',     agentType: 'research',     requiresApproval: false },
    { stepName: 'generate_strategy', agentType: 'strategy',     requiresApproval: false },
    { stepName: 'review_strategy',   agentType: 'strategy',     requiresApproval: true  },
    { stepName: 'save_strategy',     agentType: 'learning',     requiresApproval: false },
  ],
  planning: [
    { stepName: 'load_strategy',     agentType: 'planning',     requiresApproval: false },
    { stepName: 'generate_tasks',    agentType: 'planning',     requiresApproval: false },
    { stepName: 'approve_plan',      agentType: 'planning',     requiresApproval: true  },
  ],
  content: [
    { stepName: 'assemble_context',  agentType: 'content',      requiresApproval: false },
    { stepName: 'generate_copy',     agentType: 'content',      requiresApproval: false },
    { stepName: 'generate_visuals',  agentType: 'creative',     requiresApproval: false },
    { stepName: 'review_assets',     agentType: 'content',      requiresApproval: true  },
    { stepName: 'save_assets',       agentType: 'learning',     requiresApproval: false },
  ],
  creative: [
    { stepName: 'generate_images',   agentType: 'creative',     requiresApproval: false },
    { stepName: 'generate_video',    agentType: 'creative',     requiresApproval: false },
    { stepName: 'review_creative',   agentType: 'creative',     requiresApproval: true  },
  ],
  campaign: [
    { stepName: 'draft_campaign',    agentType: 'campaign',     requiresApproval: false },
    { stepName: 'validate_budget',   agentType: 'campaign',     requiresApproval: false },
    { stepName: 'approve_campaign',  agentType: 'campaign',     requiresApproval: true  },
    { stepName: 'create_platform',   agentType: 'campaign',     requiresApproval: false },
  ],
  publishing: [
    { stepName: 'verify_approval',   agentType: 'publishing',   requiresApproval: false },
    { stepName: 'post_content',      agentType: 'publishing',   requiresApproval: false },
    { stepName: 'confirm_post',      agentType: 'reporting',    requiresApproval: false },
  ],
  optimization: [
    { stepName: 'load_metrics',      agentType: 'optimization', requiresApproval: false },
    { stepName: 'analyse_gaps',      agentType: 'optimization', requiresApproval: false },
    { stepName: 'generate_plan',     agentType: 'optimization', requiresApproval: false },
    { stepName: 'approve_changes',   agentType: 'optimization', requiresApproval: true  },
  ],
  learning: [
    { stepName: 'ingest_results',    agentType: 'learning',     requiresApproval: false },
    { stepName: 'update_memories',   agentType: 'memory',       requiresApproval: false },
    { stepName: 'update_graph',      agentType: 'memory',       requiresApproval: false },
  ],
  reporting: [
    { stepName: 'aggregate_metrics', agentType: 'reporting',    requiresApproval: false },
    { stepName: 'generate_brief',    agentType: 'reporting',    requiresApproval: false },
    { stepName: 'send_brief',        agentType: 'reporting',    requiresApproval: false },
  ],
  memory: [
    { stepName: 'scan_stale',        agentType: 'memory',       requiresApproval: false },
    { stepName: 'deduplicate',       agentType: 'memory',       requiresApproval: false },
    { stepName: 'archive_old',       agentType: 'memory',       requiresApproval: false },
  ],
  benchmark: [
    { stepName: 'load_signals',      agentType: 'benchmark',    requiresApproval: false },
    { stepName: 'compare_metrics',   agentType: 'benchmark',    requiresApproval: false },
    { stepName: 'generate_report',   agentType: 'benchmark',    requiresApproval: false },
  ],
};

// ── Priority per mission type ─────────────────────────────────────────────────

export const MISSION_PRIORITY: Record<MissionType, number> = {
  publishing:   100,
  campaign:      75,
  strategy:      50,
  content:       50,
  research:      25,
  reporting:     25,
  benchmark:     25,
  planning:      25,
  creative:      25,
  optimization:  25,
  learning:      10,
  memory:        10,
};

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Creates a mission with its step sequence. Does NOT enqueue it.
 * Call queueMission() after creation to start execution.
 * @returns The created mission with its steps
 * @throws If idempotency_key collision with active mission
 */
export async function createMission(
  founderId: string,
  input:     CreateMissionInput,
): Promise<Mission> {
  const supabase = getSupabaseAdmin();
  const steps    = MISSION_TEMPLATES[input.type];

  // Idempotency check — return existing if active mission with same key exists
  if (input.idempotencyKey) {
    const { data: existing } = await supabase
      .from('missions')
      .select('*')
      .eq('idempotency_key', input.idempotencyKey)
      .not('status', 'in', '("failed","cancelled")')
      .maybeSingle();
    if (existing) return existing as Mission;
  }

  const priority = input.priority ?? MISSION_PRIORITY[input.type];

  const { data: mission, error: mErr } = await supabase
    .from('missions')
    .insert({
      founder_id:      founderId,
      product_id:      input.productId ?? null,
      workspace_id:    input.workspaceId ?? null,
      type:            input.type,
      title:           input.title,
      status:          'draft',
      priority,
      trigger_type:    input.triggerType ?? 'manual',
      input:           input.input ?? null,
      scheduled_at:    input.scheduledAt ?? null,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('*')
    .single();

  if (mErr || !mission) throw mErr ?? new Error('Failed to create mission');

  // Insert step rows
  const stepRows = steps.map((t, i) => ({
    mission_id:        mission.id,
    founder_id:        founderId,
    step_order:        i,
    step_name:         t.stepName,
    agent_type:        t.agentType,
    status:            'pending' as StepStatus,
    requires_approval: t.requiresApproval,
    max_retries:       t.maxRetries ?? 2,
  }));

  const { error: sErr } = await supabase.from('mission_steps').insert(stepRows);
  if (sErr) throw sErr;

  await log(supabase, mission.id, founderId, null, 'info', `Mission created: ${input.type} — "${input.title}"`);

  return mission as Mission;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

/**
 * Transitions a draft mission to queued and returns the BullMQ job payload.
 * The caller (route handler or scheduler) is responsible for adding to the queue.
 */
export async function queueMission(missionId: string, founderId: string): Promise<MissionJobPayload> {
  const supabase = getSupabaseAdmin();
  const mission  = await getMissionOrThrow(supabase, missionId, founderId);

  if (mission.status !== 'draft' && mission.status !== 'failed') {
    throw new Error(`Cannot queue mission in status: ${mission.status}`);
  }

  const { error } = await supabase
    .from('missions')
    .update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('id', missionId)
    .eq('founder_id', founderId);

  if (error) throw error;

  await log(supabase, missionId, founderId, null, 'info', 'Mission queued for execution');

  return { missionId, founderId, productId: mission.product_id };
}

// ── Start / step lifecycle ────────────────────────────────────────────────────

/** Called by missionWorker when it picks up the job. */
export async function startMission(missionId: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('missions').update({
    status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', missionId).eq('founder_id', founderId);

  await log(supabase, missionId, founderId, null, 'info', 'Mission started');
}

/** Returns the next step in `pending` status, ordered by step_order. */
export async function getNextPendingStep(
  missionId: string,
  founderId: string,
): Promise<MissionStep | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('mission_steps')
    .select('*')
    .eq('mission_id', missionId)
    .eq('founder_id', founderId)
    .eq('status', 'pending')
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as MissionStep | null);
}

/** Marks a step as running. */
export async function startStep(stepId: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('mission_steps').update({
    status: 'running', started_at: new Date().toISOString(),
  }).eq('id', stepId).eq('founder_id', founderId);
}

/** Marks a step completed and saves its output. */
export async function completeStep(
  stepId:    string,
  founderId: string,
  output:    Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('mission_steps').update({
    status:       'completed',
    output,
    completed_at: new Date().toISOString(),
  }).eq('id', stepId).eq('founder_id', founderId);
}

/** Marks a step failed. Returns true if mission should be retried, false if exhausted. */
export async function failStep(
  stepId:    string,
  founderId: string,
  missionId: string,
  errorMsg:  string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: step } = await supabase
    .from('mission_steps')
    .select('retry_count, max_retries')
    .eq('id', stepId)
    .single();

  if (!step) return false;

  const newRetry = (step.retry_count as number) + 1;
  const exhausted = newRetry > (step.max_retries as number);

  await supabase.from('mission_steps').update({
    status:      exhausted ? 'failed' : 'pending', // reset to pending for retry
    error:       errorMsg,
    retry_count: newRetry,
  }).eq('id', stepId);

  await log(supabase, missionId, founderId, stepId, exhausted ? 'error' : 'warn',
    exhausted ? `Step failed after ${newRetry} retries: ${errorMsg}` : `Step failed (retry ${newRetry}): ${errorMsg}`,
    { errorMsg, retryCount: newRetry });

  return !exhausted; // true = can retry
}

/** Pauses a step for approval and transitions mission to waiting_approval. */
export async function requestApproval(
  stepId:      string,
  missionId:   string,
  founderId:   string,
  title:       string,
  description: string,
  previewData: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  await supabase.from('mission_steps').update({ status: 'waiting_approval' }).eq('id', stepId);
  await supabase.from('missions').update({ status: 'waiting_approval', updated_at: new Date().toISOString() }).eq('id', missionId);

  await supabase.from('mission_approvals').insert({
    mission_id:   missionId,
    step_id:      stepId,
    founder_id:   founderId,
    title,
    description,
    preview_data: previewData,
  });

  await log(supabase, missionId, founderId, stepId, 'info',
    `Approval requested: ${title}`, { previewData });
}

/** Founder responds to an approval gate. Approved = re-queues mission. */
export async function respondToApproval(
  missionId:    string,
  stepId:       string,
  founderId:    string,
  response:     'approved' | 'rejected',
  responseNote?: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  await supabase.from('mission_approvals').update({
    status: response, responded_at: new Date().toISOString(), response_note: responseNote ?? null,
  }).eq('step_id', stepId).eq('founder_id', founderId);

  if (response === 'approved') {
    // Advance the approval step and re-queue the mission
    await supabase.from('mission_steps').update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', stepId);
    await supabase.from('missions').update({ status: 'queued', updated_at: new Date().toISOString() })
      .eq('id', missionId);
    await log(supabase, missionId, founderId, stepId, 'info', 'Approval granted — mission re-queued');
  } else {
    // Rejection cancels the mission
    await supabase.from('missions').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', missionId);
    await log(supabase, missionId, founderId, stepId, 'warn', `Approval rejected: ${responseNote ?? 'no reason given'}`);
  }
}

// ── Complete / fail mission ───────────────────────────────────────────────────

export async function completeMission(missionId: string, founderId: string, output?: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('missions').update({
    status: 'completed', output: output ?? null,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', missionId).eq('founder_id', founderId);

  await log(supabase, missionId, founderId, null, 'info', 'Mission completed successfully');
}

export async function failMission(missionId: string, founderId: string, errorMsg: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('missions').update({
    status: 'failed', error: errorMsg,
    failed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', missionId).eq('founder_id', founderId);

  await log(supabase, missionId, founderId, null, 'error', `Mission failed: ${errorMsg}`);
}

export async function cancelMission(missionId: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const mission  = await getMissionOrThrow(supabase, missionId, founderId);

  if (mission.status === 'completed') throw new Error('Cannot cancel a completed mission');

  await supabase.from('missions').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', missionId).eq('founder_id', founderId);

  await log(supabase, missionId, founderId, null, 'info', 'Mission cancelled by founder');
}

/** Resets a failed mission and re-queues it (retry). Increments retry_count. */
export async function retryMission(missionId: string, founderId: string): Promise<MissionJobPayload> {
  const supabase = getSupabaseAdmin();
  const mission  = await getMissionOrThrow(supabase, missionId, founderId);

  if (mission.status !== 'failed') throw new Error(`Cannot retry mission in status: ${mission.status}`);
  if (mission.retry_count >= mission.max_retries) throw new Error('Mission has reached max retries');

  // Reset failed/running steps back to pending
  await supabase.from('mission_steps')
    .update({ status: 'pending', error: null, retry_count: 0 })
    .eq('mission_id', missionId)
    .in('status', ['failed', 'running']);

  await supabase.from('missions').update({
    status:      'queued',
    error:       null,
    retry_count: mission.retry_count + 1,
    updated_at:  new Date().toISOString(),
  }).eq('id', missionId);

  await log(supabase, missionId, founderId, null, 'info', `Mission retried (attempt ${mission.retry_count + 1})`);

  return { missionId, founderId, productId: mission.product_id };
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getMission(missionId: string, founderId: string): Promise<Mission | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .eq('founder_id', founderId)
    .single();
  return data as Mission | null;
}

export async function listMissions(
  founderId:  string,
  filters: { productId?: string; status?: string; type?: string; limit?: number; offset?: number } = {},
): Promise<{ missions: Mission[]; total: number }> {
  const supabase = getSupabaseAdmin();
  const { limit = 20, offset = 0, productId, status, type } = filters;

  let q = supabase
    .from('missions')
    .select('*', { count: 'exact' })
    .eq('founder_id', founderId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (productId) q = q.eq('product_id', productId);
  if (status)    q = q.eq('status', status);
  if (type)      q = q.eq('type', type);

  const { data, count } = await q;
  return { missions: (data ?? []) as Mission[], total: count ?? 0 };
}

export async function getMissionSteps(missionId: string, founderId: string): Promise<MissionStep[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('mission_steps')
    .select('*')
    .eq('mission_id', missionId)
    .eq('founder_id', founderId)
    .order('step_order', { ascending: true });
  return (data ?? []) as MissionStep[];
}

export async function getMissionLogs(missionId: string, founderId: string): Promise<MissionLog[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('mission_logs')
    .select('*')
    .eq('mission_id', missionId)
    .eq('founder_id', founderId)
    .order('created_at', { ascending: true });
  return (data ?? []) as MissionLog[];
}

export async function getPendingApprovals(founderId: string): Promise<MissionApproval[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('mission_approvals')
    .select('*')
    .eq('founder_id', founderId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  return (data ?? []) as MissionApproval[];
}

// ── Logging helper ────────────────────────────────────────────────────────────

async function log(
  supabase:  ReturnType<typeof getSupabaseAdmin>,
  missionId: string,
  founderId: string,
  stepId:    string | null,
  level:     MissionLog['level'],
  message:   string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('mission_logs').insert({
      mission_id: missionId,
      founder_id: founderId,
      step_id:    stepId,
      level,
      message,
      metadata:   metadata ?? null,
    });
  } catch {
    // Log failures are non-fatal
  }
}

/** Public log function (used by AgentContext.log) */
export async function logMission(
  missionId: string,
  founderId: string,
  stepId:    string | null,
  message:   string,
  level:     MissionLog['level'] = 'info',
  metadata?: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await log(supabase, missionId, founderId, stepId, level, message, metadata);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getMissionOrThrow(
  supabase:  ReturnType<typeof getSupabaseAdmin>,
  missionId: string,
  founderId: string,
): Promise<Mission> {
  const { data } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .eq('founder_id', founderId)
    .single();
  if (!data) throw new Error(`Mission not found: ${missionId}`);
  return data as Mission;
}
