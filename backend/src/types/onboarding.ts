/**
 * @file types/onboarding.ts
 * @description TypeScript types and Zod schemas for Phase 1 onboarding.
 *   Covers the state machine, discovery jobs, product claims, and strategy directions.
 * @security No sensitive tokens or auth data stored here — data types only.
 * @dependencies zod
 */

import { z } from 'zod';

// ── State Machine ──────────────────────────────────────────────────────────

export const ONBOARDING_STATES = [
  'WORKSPACE_SETUP',
  'DISCOVERY_PENDING',
  'DISCOVERY_IN_PROGRESS',
  'DISCOVERY_MATCH_NEEDED',
  'DISCOVERY_FAILED',
  'PRELIMINARY_REPORT',
  'BELIEF_REVIEW',
  'ALIGNMENT_AUDIENCE',
  'ALIGNMENT_CONTEXT',
  'ALIGNMENT_GOAL',
  'ALIGNMENT_COMPETITORS',
  'BOUNDARIES_SETUP',
  'FINAL_REVIEW',
  'DIRECTION_GENERATING',
  'DIRECTION_COMPLETE',
  'PHASE_1_COMPLETE',
] as const;

export type OnboardingState = typeof ONBOARDING_STATES[number];

/** Maps each state to the route slug for navigation */
export const STATE_TO_ROUTE: Record<OnboardingState, string> = {
  WORKSPACE_SETUP:          '/onboarding/workspace',
  DISCOVERY_PENDING:        '/onboarding/discovery',
  DISCOVERY_IN_PROGRESS:    '/onboarding/discovery/progress',
  DISCOVERY_MATCH_NEEDED:   '/onboarding/discovery/progress',
  DISCOVERY_FAILED:         '/onboarding/discovery/recovery',
  PRELIMINARY_REPORT:       '/onboarding/report',
  BELIEF_REVIEW:            '/onboarding/beliefs',
  ALIGNMENT_AUDIENCE:       '/onboarding/audience',
  ALIGNMENT_CONTEXT:        '/onboarding/context-delta',
  ALIGNMENT_GOAL:           '/onboarding/goal',
  ALIGNMENT_COMPETITORS:    '/onboarding/competitors',
  BOUNDARIES_SETUP:         '/onboarding/boundaries',
  FINAL_REVIEW:             '/onboarding/review',
  DIRECTION_GENERATING:     '/onboarding/generating',
  DIRECTION_COMPLETE:       '/onboarding/direction',
  PHASE_1_COMPLETE:         '/onboarding/complete',
};

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<OnboardingState, OnboardingState[]> = {
  WORKSPACE_SETUP:          ['DISCOVERY_PENDING'],
  DISCOVERY_PENDING:        ['DISCOVERY_IN_PROGRESS'],
  DISCOVERY_IN_PROGRESS:    ['PRELIMINARY_REPORT','DISCOVERY_MATCH_NEEDED','DISCOVERY_FAILED'],
  DISCOVERY_MATCH_NEEDED:   ['DISCOVERY_IN_PROGRESS'],
  DISCOVERY_FAILED:         ['DISCOVERY_IN_PROGRESS'],
  PRELIMINARY_REPORT:       ['BELIEF_REVIEW'],
  BELIEF_REVIEW:            ['ALIGNMENT_AUDIENCE'],
  ALIGNMENT_AUDIENCE:       ['ALIGNMENT_CONTEXT'],
  ALIGNMENT_CONTEXT:        ['ALIGNMENT_GOAL'],
  ALIGNMENT_GOAL:           ['ALIGNMENT_COMPETITORS'],
  ALIGNMENT_COMPETITORS:    ['BOUNDARIES_SETUP'],
  BOUNDARIES_SETUP:         ['FINAL_REVIEW'],
  FINAL_REVIEW:             ['DIRECTION_GENERATING'],
  DIRECTION_GENERATING:     ['DIRECTION_COMPLETE'],
  DIRECTION_COMPLETE:       ['PHASE_1_COMPLETE'],
  PHASE_1_COMPLETE:         [],
};

// ── DB Interfaces ──────────────────────────────────────────────────────────

export interface OnboardingSession {
  id:                  string;
  founder_id:          string;
  workspace_id:        string | null;
  product_id:          string | null;
  current_state:       OnboardingState;
  lock_version:        number;
  step_completed:      number;
  workspace_name:      string | null;
  urls_submitted:      string[] | null;
  private_description: string | null;
  completed_at:        string | null;
  created_at:          string;
  updated_at:          string;
}

export interface DiscoveryJob {
  id:                  string;
  session_id:          string;
  founder_id:          string;
  queue_job_id:        string | null;
  status:              'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress:            number;
  progress_stage:      number;
  progress_message:    string | null;
  urls_submitted:      string[];
  private_description: string | null;
  detected_platform:   string | null;
  store_url:           string | null;
  website_url:         string | null;
  candidate_matches:   CandidateMatch[] | null;
  selected_match_id:   string | null;
  app_metadata:        Record<string, unknown> | null;
  icp_data:            Record<string, unknown> | null;
  competitor_data:     Record<string, unknown> | null;
  website_meta:        Record<string, unknown> | null;
  report_data:         PreliminaryReport | null;
  report_acknowledged: boolean;
  error_code:          string | null;
  error_message:       string | null;
  retry_count:         number;
  max_retries:         number;
  last_attempted_at:   string | null;
  ai_tokens_consumed:  number;
  created_at:          string;
  updated_at:          string;
}

export interface CandidateMatch {
  id:           string;
  name:         string;
  url:          string;
  icon:         string | null;
  rating:       number | null;
  review_count: number | null;
  description:  string | null;
}

export interface PreliminaryReport {
  headline:     string;
  summary:      string;
  topInsights:  string[];
  opportunities: Array<{ title: string; description: string; confidence: number }>;
  risks:         Array<{ title: string; description: string }>;
}

export interface ProductClaim {
  id:               string;
  session_id:       string;
  founder_id:       string;
  product_id:       string | null;
  claim_type:       'FACT' | 'INFERENCE' | 'FOUNDER_PROVIDED';
  category:         string;
  title:            string;
  body:             string;
  confidence:       number;
  evidence_sources: EvidenceSource[];
  status:           'UNREVIEWED' | 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  original_value:   string | null;
  corrected_value:  string | null;
  founder_note:     string | null;
  display_order:    number;
  created_at:       string;
  updated_at:       string;
}

export interface EvidenceSource {
  type:    string;
  count:   number;
  excerpt: string;
}

export interface StrategyDirection {
  id:                   string;
  session_id:           string;
  founder_id:           string;
  product_id:           string | null;
  prompt_version:       string;
  input_snapshot:       Record<string, unknown> | null;
  ai_model:             string | null;
  headline:             string;
  rationale:            string;
  primary_channel:      string | null;
  primary_market:       string | null;
  week_1:               WeekPlan | null;
  week_2:               WeekPlan | null;
  week_3:               WeekPlan | null;
  week_4:               WeekPlan | null;
  evidence_claim_ids:   string[];
  key_assumptions:      string[] | null;
  risk_flags:           string[] | null;
  acknowledged_at:      string | null;
  edited_at:            string | null;
  edit_notes:           string | null;
  ai_tokens_consumed:   number;
  status:               'draft' | 'generating' | 'ready' | 'acknowledged';
  direction_meta:       DirectionMeta | null;
  created_at:           string;
  updated_at:           string;
}

export interface DirectionMeta {
  primaryObjective?:  string;
  biggestConstraint?: string;
  firstMission?:      string;
  immediateAction?:   string;
  successSignal?:     string;
  confidenceLevel?:   number;
}

export interface WeekPlan {
  focus:           string;
  tasks:           string[];
  expectedOutcome: string;
}

// ── Zod Schemas for Route Validation ─────────────────────────────────────

export const SaveWorkspaceBodySchema = z.object({
  workspaceName: z.string().min(2).max(80),
});

export const StartDiscoveryBodySchema = z.object({
  urls:               z.array(z.string().url()).min(1).max(3),
  privateDescription: z.string().max(2000).optional(),
});

export const SelectMatchBodySchema = z.object({
  matchId: z.string().min(1),
});

export const AcknowledgeReportBodySchema = z.object({
  acknowledged: z.literal(true),
});

export const ReviewClaimBodySchema = z.object({
  status:         z.enum(['CONFIRMED','CORRECTED','REJECTED']),
  correctedValue: z.string().max(2000).optional(),
  founderNote:    z.string().max(500).optional(),
});

export const SaveAudienceBodySchema = z.object({
  audienceConfirmed: z.string().min(10).max(1000),
  audienceAdditions: z.string().max(1000).optional(),
  audienceSegments:  z.array(z.object({
    label:         z.string(),
    size_estimate: z.string().optional(),
    priority:      z.number().min(1).max(3),
  })).optional(),
});

export const SaveContextDeltaBodySchema = z.object({
  contextDelta:     z.string().min(10).max(2000).optional(),
  hiddenStrengths:  z.array(z.string().max(200)).max(10).optional(),
  recentWins:       z.array(z.string().max(200)).max(10).optional(),
});

export const SaveGoalBodySchema = z.object({
  goalType:          z.enum(['installs','dau','mau','revenue','paying_users','retention_d7','retention_d30','nps','custom']),
  customMetric:      z.string().max(100).optional(),
  baselineValue:     z.number().min(0).optional(),
  targetValue:       z.number().min(0),           // 0 = "use AI benchmark"
  unit:              z.string().min(1).max(60),
  timeHorizonDays:   z.number().int().min(7).max(365).default(30),  // allow 6 months (180d)
  motivation:        z.string().max(500).optional(),
  currentBlockers:   z.string().max(500).optional(),
});

export const SaveCompetitorsBodySchema = z.object({
  competitors: z.array(z.object({
    name:              z.string().min(1).max(100),
    storeUrl:          z.string().url().optional(),
    websiteUrl:        z.string().url().optional(),
    platform:          z.enum(['app_store','play_store','web_only','both']).optional(),
    relationship:      z.enum(['CONFIRMED','REJECTED','MANUALLY_ADDED']),
    keyDifferentiator: z.string().max(500).optional(),
    discoveredBy:      z.enum(['AI','FOUNDER']).default('AI'),
  })).min(0).max(20),
});

export const SaveBoundariesBodySchema = z.object({
  workingStyle:         z.enum(['hands_on','balanced','hands_off']),
  notificationCadence:  z.enum(['daily','weekly','only_critical']).default('weekly'),
  timeCommitmentHrs:    z.number().int().min(1).max(40).optional(),
  weeklySpendCapUsd:    z.number().min(0).max(10000).default(0),
  weeklySpendCapInr:    z.number().min(0).max(500000).default(0),
  // Server enforces: button cannot be enabled until founderAcknowledged = true
  founderAcknowledged:  z.literal(true),
});

export const CompletePhase1BodySchema = z.object({
  directionId:          z.string().uuid(),
  acknowledgedDirection: z.literal(true),
});
