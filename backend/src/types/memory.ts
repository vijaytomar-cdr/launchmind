/**
 * @file memory.ts
 * @description Zod schemas and TypeScript types for Marketing Memory and Knowledge Graph.
 *   Covers all 11 memory types, 13 node types, evidence, and learning events.
 * @dependencies zod
 */

import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const MEMORY_TYPES = [
  'founder','brand','product','customer','campaign',
  'creative','review','competitor','experiment','market','seasonality',
] as const;

export const MEMORY_SOURCES = [
  'intake','growth_brain','campaign_performance','review',
  'analytics','founder_feedback','ai_conversation','experiment',
] as const;

export const MEMORY_STATUSES = ['draft','active','archived'] as const;

export const LEARNING_EVENT_TYPES = [
  'intake_completed','growth_brain_approved','campaign_result',
  'review_ingested','analytics_synced','founder_feedback',
  'ai_conversation','experiment_result',
] as const;

export const NODE_TYPES = [
  'product','feature','persona','icp','competitor','campaign',
  'creative','channel','review','market','goal','opportunity','risk',
] as const;

export const EDGE_RELATIONSHIPS = [
  'targets','competes_with','belongs_to','influenced_by',
  'validated_by','generated_from','has_feature','serves_persona',
  'appears_in','measured_by','leads_to','blocks',
] as const;

export const EVIDENCE_TYPES = [
  'playbook_signal','campaign_metric','review',
  'user_feedback','ab_test','analytics','external',
] as const;

// ── TypeScript types ──────────────────────────────────────────────────────────

export type MemoryType      = typeof MEMORY_TYPES[number];
export type MemorySource    = typeof MEMORY_SOURCES[number];
export type MemoryStatus    = typeof MEMORY_STATUSES[number];
export type LearningEventType = typeof LEARNING_EVENT_TYPES[number];
export type NodeType        = typeof NODE_TYPES[number];
export type EdgeRelationship = typeof EDGE_RELATIONSHIPS[number];
export type EvidenceType    = typeof EVIDENCE_TYPES[number];

export interface MarketingMemory {
  id: string;
  founder_id: string;
  product_id: string | null;
  memory_type: MemoryType;
  title: string;
  content: Record<string, unknown>;
  source: MemorySource;
  confidence: number;
  evidence_ids: string[];
  status: MemoryStatus;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface MarketingMemoryWithVersions extends MarketingMemory {
  versions: MarketingMemoryVersion[];
}

export interface MarketingMemoryVersion {
  id: string;
  memory_id: string;
  founder_id: string;
  version: number;
  content: Record<string, unknown>;
  source: MemorySource;
  confidence: number;
  changed_by: 'ai' | 'founder' | 'system';
  change_note: string | null;
  created_at: string;
}

export interface KnowledgeNode {
  id: string;
  founder_id: string;
  product_id: string | null;
  node_type: NodeType;
  label: string;
  properties: Record<string, unknown>;
  source_id: string | null;
  source_type: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeNodeWithEdges extends KnowledgeNode {
  outgoing: KnowledgeEdge[];
  incoming: KnowledgeEdge[];
}

export interface KnowledgeEdge {
  id: string;
  founder_id: string;
  source_id: string;
  target_id: string;
  relationship: EdgeRelationship;
  weight: number;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface Evidence {
  id: string;
  founder_id: string;
  product_id: string | null;
  evidence_type: EvidenceType;
  source_id: string | null;
  source_table: string | null;
  data: Record<string, unknown>;
  confidence_boost: number;
  created_at: string;
}

export interface LearningEvent {
  id: string;
  founder_id: string;
  product_id: string | null;
  event_type: LearningEventType;
  payload: Record<string, unknown>;
  memories_created: number;
  memories_updated: number;
  nodes_created: number;
  edges_created: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error: string | null;
  processed_at: string | null;
  created_at: string;
}

// ── Zod schemas (for Fastify route validation) ────────────────────────────────

export const CreateMemoryBodySchema = z.object({
  product_id:  z.string().uuid().optional(),
  memory_type: z.enum(MEMORY_TYPES),
  title:       z.string().min(1).max(280),
  content:     z.record(z.unknown()),
  source:      z.enum(MEMORY_SOURCES),
  confidence:  z.number().min(0).max(1).optional().default(0.5),
});

export const UpdateMemoryBodySchema = z.object({
  title:       z.string().min(1).max(280).optional(),
  content:     z.record(z.unknown()).optional(),
  confidence:  z.number().min(0).max(1).optional(),
  change_note: z.string().max(500).optional(),
  changed_by:  z.enum(['ai','founder','system']).optional().default('founder'),
});

export const ListMemoriesQuerySchema = z.object({
  product_id:  z.string().uuid().optional(),
  memory_type: z.enum(MEMORY_TYPES).optional(),
  status:      z.enum(MEMORY_STATUSES).optional().default('active'),
  limit:       z.coerce.number().int().min(1).max(100).optional().default(50),
  offset:      z.coerce.number().int().min(0).optional().default(0),
});

export const SearchMemoriesQuerySchema = z.object({
  q:           z.string().min(1).max(500),
  product_id:  z.string().uuid().optional(),
  memory_type: z.enum(MEMORY_TYPES).optional(),
  limit:       z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const IngestEventBodySchema = z.object({
  product_id:  z.string().uuid().optional(),
  event_type:  z.enum(LEARNING_EVENT_TYPES),
  payload:     z.record(z.unknown()),
});

export const CreateNodeBodySchema = z.object({
  product_id:  z.string().uuid().optional(),
  node_type:   z.enum(NODE_TYPES),
  label:       z.string().min(1).max(280),
  properties:  z.record(z.unknown()).optional().default({}),
  source_id:   z.string().optional(),
  source_type: z.string().optional(),
  confidence:  z.number().min(0).max(1).optional().default(0.5),
});

export const CreateEdgeBodySchema = z.object({
  source_id:    z.string().uuid(),
  target_id:    z.string().uuid(),
  relationship: z.enum(EDGE_RELATIONSHIPS),
  weight:       z.number().min(0).max(1).optional().default(0.5),
  properties:   z.record(z.unknown()).optional().default({}),
});

export const GetGraphQuerySchema = z.object({
  product_id: z.string().uuid().optional(),
});

export type CreateMemoryBody   = z.infer<typeof CreateMemoryBodySchema>;
export type UpdateMemoryBody   = z.infer<typeof UpdateMemoryBodySchema>;
export type ListMemoriesQuery  = z.infer<typeof ListMemoriesQuerySchema>;
export type SearchMemoriesQuery = z.infer<typeof SearchMemoriesQuerySchema>;
export type IngestEventBody    = z.infer<typeof IngestEventBodySchema>;
export type CreateNodeBody     = z.infer<typeof CreateNodeBodySchema>;
export type CreateEdgeBody     = z.infer<typeof CreateEdgeBodySchema>;
export type GetGraphQuery      = z.infer<typeof GetGraphQuerySchema>;
