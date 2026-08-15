/**
 * @file knowledgeGraphService.ts
 * @description Knowledge Graph — nodes, edges, and graph queries.
 *   Nodes represent marketing entities (Product, Persona, ICP, Competitor, etc.).
 *   Edges represent directed relationships (targets, competes_with, validated_by, etc.).
 *   Graph is isolated per founder via RLS + service-level founder_id checks.
 *   Traversal depth limited to direct edges (depth 1) in this milestone.
 * @security founderId must match every node before any mutation.
 * @dependencies supabaseAdmin, Sentry
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { resolveMemoryWorkspace } from './memory/workspaceResolver';
import type {
  KnowledgeNode,
  KnowledgeNodeWithEdges,
  KnowledgeEdge,
  KnowledgeGraph,
  NodeType,
  EdgeRelationship,
} from '../types/memory';

// ── Node operations ───────────────────────────────────────────────────────────

/**
 * Creates a knowledge node. Uses upsert on (founder_id, product_id, node_type, label)
 * to prevent duplicate nodes when the same entity is re-ingested.
 * @returns Created or existing node.
 */
export async function createNode(
  founderId: string,
  productId: string | null,
  nodeType: NodeType,
  label: string,
  properties: Record<string, unknown> = {},
  sourceId?: string,
  sourceType?: string,
  confidence = 0.5,
): Promise<KnowledgeNode> {
  const supabase = getSupabaseAdmin();
  const workspaceId = await resolveMemoryWorkspace(founderId, productId ?? null);

  if (productId) {
    // Upsert — unique index on (founder_id, product_id, node_type, label)
    const { data, error } = await supabase
      .from('knowledge_nodes')
      .upsert(
        {
          founder_id:  founderId,
          workspace_id: workspaceId,
          product_id:  productId,
          node_type:   nodeType,
          label,
          properties,
          source_id:   sourceId ?? null,
          source_type: sourceType ?? null,
          confidence,
          updated_at:  new Date().toISOString(),
        },
        { onConflict: 'founder_id,product_id,node_type,label', ignoreDuplicates: false },
      )
      .select('*')
      .single();

    if (error || !data) {
      Sentry.captureException(error, { tags: { service: 'knowledgeGraphService', fn: 'createNode' } });
      throw error ?? new Error('createNode returned no data');
    }
    return data as KnowledgeNode;
  }

  // Founder-level node (no product_id) — simple insert
  const { data, error } = await supabase
    .from('knowledge_nodes')
    .insert({ founder_id: founderId, workspace_id: workspaceId, product_id: null, node_type: nodeType, label, properties, source_id: sourceId ?? null, source_type: sourceType ?? null, confidence })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('createNode returned no data');
  return data as KnowledgeNode;
}

/**
 * Returns a node with its direct incoming and outgoing edges.
 * @throws If node not found or not owned by founderId.
 */
export async function getNode(
  id: string,
  founderId: string,
): Promise<KnowledgeNodeWithEdges> {
  const supabase = getSupabaseAdmin();

  const [nodeRes, outRes, inRes] = await Promise.all([
    supabase.from('knowledge_nodes').select('*').eq('id', id).eq('founder_id', founderId).single(),
    supabase.from('knowledge_edges').select('*').eq('source_id', id).eq('founder_id', founderId),
    supabase.from('knowledge_edges').select('*').eq('target_id', id).eq('founder_id', founderId),
  ]);

  if (nodeRes.error || !nodeRes.data) throw new Error('Node not found');

  return {
    ...(nodeRes.data as KnowledgeNode),
    outgoing: (outRes.data ?? []) as KnowledgeEdge[],
    incoming: (inRes.data ?? []) as KnowledgeEdge[],
  };
}

/**
 * Deletes a node (edges are cascade-deleted by FK constraint).
 * @throws If node not found or not owned by founderId.
 */
export async function deleteNode(id: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('knowledge_nodes')
    .delete()
    .eq('id', id)
    .eq('founder_id', founderId);
  if (error) throw error;
}

// ── Edge operations ───────────────────────────────────────────────────────────

/**
 * Creates a directed edge between two nodes. Upserts on (source_id, target_id, relationship)
 * to prevent duplicate edges.
 * @security Both source and target nodes must belong to the same founderId.
 * @throws If either node is not owned by founderId or the upsert fails.
 */
export async function createEdge(
  founderId: string,
  sourceId: string,
  targetId: string,
  relationship: EdgeRelationship,
  weight = 0.5,
  properties: Record<string, unknown> = {},
): Promise<KnowledgeEdge> {
  const supabase = getSupabaseAdmin();

  // Verify both nodes belong to this founder
  const { data: nodes, error: nodeErr } = await supabase
    .from('knowledge_nodes')
    .select('id, workspace_id')
    .eq('founder_id', founderId)
    .in('id', [sourceId, targetId]);

  if (nodeErr) throw nodeErr;
  if (!nodes || nodes.length < 2) throw new Error('One or both nodes not found for this founder');

  // An edge belongs to the same tenant as the nodes it joins. Those nodes were
  // just verified to be this founder's, so this cannot straddle two workspaces.
  const edgeWorkspaceId =
    (nodes as unknown as Array<{ workspace_id?: string | null }>)[0]?.workspace_id
    ?? await resolveMemoryWorkspace(founderId, null);

  const { data, error } = await supabase
    .from('knowledge_edges')
    .upsert(
      { founder_id: founderId, workspace_id: edgeWorkspaceId, source_id: sourceId, target_id: targetId, relationship, weight, properties },
      { onConflict: 'source_id,target_id,relationship', ignoreDuplicates: false },
    )
    .select('*')
    .single();

  if (error || !data) {
    Sentry.captureException(error, { tags: { service: 'knowledgeGraphService', fn: 'createEdge' } });
    throw error ?? new Error('createEdge returned no data');
  }
  return data as KnowledgeEdge;
}

/**
 * Deletes an edge by ID, verifying founder ownership.
 */
export async function deleteEdge(id: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('knowledge_edges')
    .delete()
    .eq('id', id)
    .eq('founder_id', founderId);
  if (error) throw error;
}

// ── Graph query ───────────────────────────────────────────────────────────────

/**
 * Returns all nodes and direct edges for a product (or all founder nodes if no productId).
 * Depth-1 graph — suitable for UI rendering without pagination.
 */
export async function getGraph(
  founderId: string,
  productId?: string,
): Promise<KnowledgeGraph> {
  const supabase = getSupabaseAdmin();

  let nodeQuery = supabase
    .from('knowledge_nodes')
    .select('*')
    .eq('founder_id', founderId)
    .order('created_at', { ascending: true });

  if (productId) nodeQuery = nodeQuery.eq('product_id', productId);

  const { data: nodes, error: nodeErr } = await nodeQuery;
  if (nodeErr) throw nodeErr;

  if (!nodes || nodes.length === 0) return { nodes: [], edges: [] };

  const nodeIds = nodes.map((n: { id: string }) => n.id);

  const { data: edges, error: edgeErr } = await supabase
    .from('knowledge_edges')
    .select('*')
    .eq('founder_id', founderId)
    .in('source_id', nodeIds);

  if (edgeErr) throw edgeErr;

  return {
    nodes: nodes as KnowledgeNode[],
    edges: (edges ?? []) as KnowledgeEdge[],
  };
}

// ── Node merge ────────────────────────────────────────────────────────────────

/**
 * Merges two nodes: keeps keepId, deletes discardId.
 * All edges pointing to discardId are redirected to keepId, then discardId is deleted.
 * The unique constraint on (source_id, target_id, relationship) means some redirected edges
 * may be silently discarded if they would create a duplicate — this is acceptable.
 * @throws If either node is not owned by founderId.
 */
export async function mergeNodes(
  founderId: string,
  keepId: string,
  discardId: string,
): Promise<KnowledgeNode> {
  const supabase = getSupabaseAdmin();

  // Verify both nodes
  const [keepRes, discardRes] = await Promise.all([
    supabase.from('knowledge_nodes').select('*').eq('id', keepId).eq('founder_id', founderId).single(),
    supabase.from('knowledge_nodes').select('id').eq('id', discardId).eq('founder_id', founderId).single(),
  ]);

  if (keepRes.error || !keepRes.data) throw new Error('Keep node not found');
  if (discardRes.error || !discardRes.data) throw new Error('Discard node not found');

  // Redirect outgoing edges from discard to keep (ignore duplicates)
  await supabase
    .from('knowledge_edges')
    .update({ source_id: keepId })
    .eq('source_id', discardId)
    .eq('founder_id', founderId);

  // Redirect incoming edges to discard → point to keep (ignore duplicates)
  await supabase
    .from('knowledge_edges')
    .update({ target_id: keepId })
    .eq('target_id', discardId)
    .eq('founder_id', founderId);

  // Delete the discarded node (cascades remaining edges)
  await deleteNode(discardId, founderId);

  // Bump confidence on kept node
  const keep = keepRes.data as KnowledgeNode;
  const newConf = Math.min(1.0, keep.confidence + 0.05);
  await supabase
    .from('knowledge_nodes')
    .update({ confidence: newConf, updated_at: new Date().toISOString() })
    .eq('id', keepId);

  const { data: updated } = await supabase.from('knowledge_nodes').select('*').eq('id', keepId).single();
  return updated as KnowledgeNode;
}
