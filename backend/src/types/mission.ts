/**
 * @file types/mission.ts
 * @description Canonical types for the Agent Platform (Milestone 06).
 *   Mission — the unit of AI work.
 *   MissionStep — one agent execution within a mission.
 *   MissionLog — append-only audit trail.
 *   MissionApproval — human-in-the-loop gate.
 *   AgentContext — injected into every agent at execution time.
 * @security founderId is always verified against the mission before any access.
 * @dependencies contextEngine, aiPlatform
 */

import { z } from 'zod';
import type { ContextPackage } from '../lib/contextEngine';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const MISSION_TYPES = [
  'research', 'strategy', 'planning', 'content', 'creative',
  'campaign', 'publishing', 'optimization', 'learning',
  'reporting', 'memory', 'benchmark',
] as const;

export type MissionType = typeof MISSION_TYPES[number];

export const MISSION_STATUSES = [
  'draft', 'queued', 'running', 'waiting_approval',
  'completed', 'failed', 'cancelled',
] as const;

export type MissionStatus = typeof MISSION_STATUSES[number];

export const AGENT_TYPES = MISSION_TYPES; // 1:1 mapping
export type AgentType = MissionType;

export const STEP_STATUSES = [
  'pending', 'running', 'completed', 'failed', 'skipped', 'waiting_approval',
] as const;

export type StepStatus = typeof STEP_STATUSES[number];

export const TRIGGER_TYPES = ['manual', 'cron', 'event', 'api'] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

// ── DB Row interfaces ─────────────────────────────────────────────────────────

export interface Mission {
  id:                 string;
  founder_id:         string;
  product_id:         string | null;
  workspace_id:       string | null;
  type:               MissionType;
  title:              string;
  status:             MissionStatus;
  priority:           number;
  trigger_type:       TriggerType;
  input:              Record<string, unknown> | null;
  output:             Record<string, unknown> | null;
  error:              string | null;
  idempotency_key:    string | null;
  scheduled_at:       string | null;
  started_at:         string | null;
  completed_at:       string | null;
  failed_at:          string | null;
  cancelled_at:       string | null;
  retry_count:        number;
  max_retries:        number;
  ai_tokens_consumed: number;
  created_at:         string;
  updated_at:         string;
}

export interface MissionStep {
  id:                string;
  mission_id:        string;
  founder_id:        string;
  step_order:        number;
  step_name:         string;
  agent_type:        AgentType;
  status:            StepStatus;
  requires_approval: boolean;
  input:             Record<string, unknown> | null;
  output:            Record<string, unknown> | null;
  error:             string | null;
  retry_count:       number;
  max_retries:       number;
  ai_request_id:     string | null;
  started_at:        string | null;
  completed_at:      string | null;
  created_at:        string;
}

export interface MissionLog {
  id:         string;
  mission_id: string;
  founder_id: string;
  step_id:    string | null;
  level:      'debug' | 'info' | 'warn' | 'error';
  message:    string;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

export interface MissionApproval {
  id:            string;
  mission_id:    string;
  step_id:       string;
  founder_id:    string;
  status:        'pending' | 'approved' | 'rejected';
  title:         string;
  description:   string | null;
  preview_data:  Record<string, unknown> | null;
  requested_at:  string;
  responded_at:  string | null;
  response_note: string | null;
}

// ── Mission template (step definitions) ──────────────────────────────────────

export interface MissionStepTemplate {
  stepName:         string;
  agentType:        AgentType;
  requiresApproval: boolean;
  maxRetries?:      number;
}

// ── Agent context (injected into every agent) ─────────────────────────────────

export interface AgentContext {
  founderId:  string;
  productId:  string | null;
  missionId:  string;
  stepId:     string;
  contextPkg: ContextPackage;
  log:        (message: string, level?: MissionLog['level'], meta?: Record<string, unknown>) => Promise<void>;
}

// ── Agent function type ───────────────────────────────────────────────────────

export type AgentFn = (
  input:   Record<string, unknown>,
  context: AgentContext,
) => Promise<Record<string, unknown>>;

// ── Approval request (emitted by approval-gate agents) ───────────────────────

export interface ApprovalRequest {
  title:       string;
  description: string;
  previewData: Record<string, unknown>;
}

// ── Zod schemas for API validation ───────────────────────────────────────────

export const CreateMissionSchema = z.object({
  type:            z.enum(MISSION_TYPES),
  title:           z.string().min(1).max(200),
  productId:       z.string().uuid().optional(),
  workspaceId:     z.string().uuid().optional(),
  input:           z.record(z.unknown()).optional(),
  triggerType:     z.enum(TRIGGER_TYPES).default('manual'),
  scheduledAt:     z.string().datetime().optional(),
  priority:        z.number().int().min(0).max(100).optional(),
  idempotencyKey:  z.string().max(200).optional(),
});

export const RespondToApprovalSchema = z.object({
  response:      z.enum(['approved', 'rejected']),
  responseNote:  z.string().max(1000).optional(),
});

export type CreateMissionInput = z.infer<typeof CreateMissionSchema>;

// ── BullMQ job payload ────────────────────────────────────────────────────────

export interface MissionJobPayload {
  missionId:  string;
  founderId:  string;
  productId:  string | null;
}
