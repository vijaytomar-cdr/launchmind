/**
 * @file marketingMemoryService.ts
 * @description Persistent Marketing Memory — CRUD, versioning, search, and deduplication.
 *   Every update creates a new version record before mutating the memory row.
 *   Search uses full-text (immediate) with vector similarity available once embeddings exist.
 *   Dedup checks exact-match on (founder_id, product_id, memory_type, title) to avoid
 *   writing the same learning twice.
 * @security founderId is always the authenticated user — never accept it from the request body.
 * @dependencies supabaseAdmin, Sentry
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { resolveMemoryWorkspace } from './memory/workspaceResolver';
import { marketingMemoryRenderer } from './memory/embeddingRenderer';

/**
 * Canonical content hash for a memory, using the SAME renderer the embedding
 * pipeline uses.
 *
 * Sharing the renderer is the point: a version snapshot whose hash came from a
 * different rendering could not be compared against what retrieval indexed, and
 * reconstruction would report spurious drift.
 *
 * @returns sha256 hex, or null when the record renders to nothing.
 */
function renderMemoryHash(mem: { memory_type: string; title: string; content: Record<string, unknown> | null }): string | null {
  return marketingMemoryRenderer.render({
    memory_type: mem.memory_type, title: mem.title, content: mem.content,
  })?.contentHash ?? null;
}
import type {
  MarketingMemory,
  MarketingMemoryWithVersions,
  MarketingMemoryVersion,
  MemoryType,
  MemorySource,
  MemoryStatus,
} from '../types/memory';

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Creates a new marketing memory.
 * @param founderId - Authenticated founder's ID.
 * @param productId - Product scope (null for founder/brand-level memories).
 * @param memoryType - One of the 11 memory types.
 * @param title - Human-readable title for the memory.
 * @param content - Structured content JSONB.
 * @param source - Where this learning originated.
 * @param confidence - Initial confidence score (0.0–1.0).
 * @returns The created MarketingMemory row.
 * @throws On Supabase insert error.
 */
export async function createMemory(
  founderId: string,
  productId: string | null,
  memoryType: MemoryType,
  title: string,
  content: Record<string, unknown>,
  source: MemorySource,
  confidence = 0.5,
): Promise<MarketingMemory> {
  const supabase = getSupabaseAdmin();
  // Migration 088: tenancy is the workspace; founder_id is retained as attribution.
  const workspaceId = await resolveMemoryWorkspace(founderId, productId ?? null);

  const { data, error } = await supabase
    .from('marketing_memories')
    .insert({
      founder_id:   founderId,
      workspace_id: workspaceId,
      product_id:  productId ?? null,
      memory_type: memoryType,
      title,
      content,
      source,
      confidence,
      status:  'active',
      version: 1,
    })
    .select('*')
    .single();

  if (error || !data) {
    Sentry.captureException(error, { tags: { service: 'marketingMemoryService', fn: 'createMemory' } });
    throw error ?? new Error('createMemory returned no data');
  }

  return data as MarketingMemory;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns a single memory with its full version history.
 * @throws If the memory does not exist or does not belong to founderId.
 */
export async function getMemory(
  id: string,
  founderId: string,
): Promise<MarketingMemoryWithVersions> {
  const supabase = getSupabaseAdmin();

  const [memRes, verRes] = await Promise.all([
    supabase
      .from('marketing_memories')
      .select('*')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single(),
    supabase
      .from('marketing_memory_versions')
      .select('*')
      .eq('memory_id', id)
      .eq('founder_id', founderId)
      .order('version', { ascending: false }),
  ]);

  if (memRes.error || !memRes.data) throw new Error('Memory not found');

  return {
    ...(memRes.data as MarketingMemory),
    versions: (verRes.data ?? []) as MarketingMemoryVersion[],
  };
}

/**
 * Lists memories with optional filters. Excludes archived by default.
 */
export async function listMemories(
  founderId: string,
  opts: {
    productId?: string;
    memoryType?: MemoryType;
    status?: MemoryStatus;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ memories: MarketingMemory[]; total: number }> {
  const supabase = getSupabaseAdmin();
  const { productId, memoryType, status = 'active', limit = 50, offset = 0 } = opts;

  let query = supabase
    .from('marketing_memories')
    .select('*', { count: 'exact' })
    .eq('founder_id', founderId)
    .eq('status', status)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (productId) query = query.eq('product_id', productId);
  if (memoryType) query = query.eq('memory_type', memoryType);

  const { data, error, count } = await query;
  if (error) throw error;

  return { memories: (data ?? []) as MarketingMemory[], total: count ?? 0 };
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Updates memory content — always writes a version record of the PREVIOUS state first.
 * @param changedBy - 'ai' | 'founder' | 'system' — required for audit trail.
 * @returns Updated memory row.
 * @throws If memory not found or owner mismatch.
 */
export async function updateMemory(
  id: string,
  founderId: string,
  updates: {
    title?: string;
    content?: Record<string, unknown>;
    confidence?: number;
    change_note?: string;
    changed_by?: 'ai' | 'founder' | 'system';
  },
): Promise<MarketingMemory> {
  const supabase = getSupabaseAdmin();

  // Fetch current state to write version record
  const { data: current, error: fetchErr } = await supabase
    .from('marketing_memories')
    .select('*')
    .eq('id', id)
    .eq('founder_id', founderId)
    .single();

  if (fetchErr || !current) throw new Error('Memory not found');

  const mem = current as MarketingMemory;

  // Write version record (snapshot of current state before change)
  await supabase
    .from('marketing_memory_versions')
    .insert({
      memory_id:  id,
      founder_id: founderId,
      // Derived child: inherits its parent's tenancy (migration 088, backfill rule 2).
      workspace_id: (mem as unknown as { workspace_id: string }).workspace_id,
      version:    mem.version,
      // Gate 0.5 (3.1F). The snapshot previously omitted title, memory_type,
      // status and evidence_ids — so a historical version could not reproduce
      // what a model was actually shown, since title is weight A in search_tsv
      // and the first line of the embedding rendering. Reconstruction was
      // therefore forced to report `changed` for every updated memory.
      title:        mem.title,
      memory_type:  mem.memory_type,
      status:       mem.status,
      evidence_ids: (mem as unknown as { evidence_ids?: string[] }).evidence_ids ?? [],
      content_hash: renderMemoryHash(mem),
      rendering_version: marketingMemoryRenderer.renderingVersion,
      content:    mem.content,
      source:     mem.source,
      confidence: mem.confidence,
      changed_by: updates.changed_by ?? 'founder',
      change_note: updates.change_note ?? null,
      change_reason: updates.change_note ?? 'updated',
      valid_from: (mem as unknown as { updated_at?: string }).updated_at ?? null,
      valid_until: new Date().toISOString(),
    });

  // Apply update
  const patch: Record<string, unknown> = { version: mem.version + 1, updated_at: new Date().toISOString() };
  if (updates.title !== undefined)      patch.title = updates.title;
  if (updates.content !== undefined)    patch.content = updates.content;
  if (updates.confidence !== undefined) patch.confidence = updates.confidence;

  const { data, error } = await supabase
    .from('marketing_memories')
    .update(patch)
    .eq('id', id)
    .eq('founder_id', founderId)
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Update returned no data');
  return data as MarketingMemory;
}

// ── Archive ───────────────────────────────────────────────────────────────────

/**
 * Soft-deletes a memory by setting status = 'archived' and archived_at.
 * Data is never hard-deleted — full audit trail is preserved.
 */
export async function archiveMemory(
  id: string,
  founderId: string,
  archiveReason?: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const patch: Record<string, unknown> = {
    status:      'archived',
    archived_at: new Date().toISOString(),
  };

  if (archiveReason) {
    // Store reason in content metadata without overwriting main content
    const { data: current } = await supabase
      .from('marketing_memories')
      .select('content')
      .eq('id', id)
      .eq('founder_id', founderId)
      .single();

    if (current) {
      patch.content = { ...(current.content as Record<string, unknown>), _archiveReason: archiveReason };
    }
  }

  const { error } = await supabase
    .from('marketing_memories')
    .update(patch)
    .eq('id', id)
    .eq('founder_id', founderId);

  if (error) throw error;
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Full-text search across memory titles and content.
 * Falls back to ilike pattern when pg full-text is unavailable.
 * @returns Matching active memories, ordered by relevance.
 */
export async function searchMemories(
  founderId: string,
  query: string,
  opts: { productId?: string; memoryType?: MemoryType; limit?: number } = {},
): Promise<MarketingMemory[]> {
  const supabase = getSupabaseAdmin();
  const { productId, memoryType, limit = 20 } = opts;

  // ── THE 3.1A DEFECT, AND THE FIX ─────────────────────────────────────────
  //
  // This previously read:
  //     .or(`title.ilike.%${query}%,content.cs.{"${query}"}`)
  //
  // `content.cs.{"…"}` is PostgREST ARRAY-LITERAL syntax applied to a `jsonb`
  // column. `{"messaging"}` is not valid JSON, so Postgres rejected the WHOLE
  // disjunction — including the `title.ilike` half, which worked on its own —
  // with `invalid input syntax for type json`. The error was caught below and
  // turned into `return []`, indistinguishable from "no matches". Every
  // GET /memory/search call returned nothing, silently, since the feature
  // shipped.
  //
  // The fix is NOT a repaired ILIKE. Measured in 3.1A, title-only ILIKE reaches
  // just 9.4% Recall@5, because it tests the entire question as one literal
  // substring: "What positioning has historically worked best?" matches no
  // title. This now uses the `search_tsv` generated column from migration 094
  // (title A / claim B / scope C, English stemming) via PostgREST's `websearch`
  // operator, which parses owner input safely and cannot raise on punctuation.
  let q = supabase
    .from('marketing_memories')
    .select('*')
    .eq('founder_id', founderId)
    .eq('status', 'active')
    .textSearch('search_tsv', query, { type: 'websearch', config: 'english' })
    .order('confidence', { ascending: false })
    .limit(limit);

  if (productId) q = q.eq('product_id', productId);
  if (memoryType) q = q.eq('memory_type', memoryType);

  const { data, error } = await q;
  if (error) {
    Sentry.captureException(error, { tags: { service: 'marketingMemoryService', fn: 'searchMemories' } });
    // Explicit, justified fallback (ADR-066 rule 16 permits ILIKE only here):
    // a database that has not yet run migration 094 has no `search_tsv`. Weak
    // retrieval is better than none, and unlike the original this cannot mask a
    // query error as an empty result — the fallback is a different query, and
    // its own failure returns [] only after both paths have failed.
    let fb = supabase
      .from('marketing_memories')
      .select('*')
      .eq('founder_id', founderId)
      .eq('status', 'active')
      .ilike('title', `%${query}%`)
      .order('confidence', { ascending: false })
      .limit(limit);
    if (productId) fb = fb.eq('product_id', productId);
    if (memoryType) fb = fb.eq('memory_type', memoryType);

    const { data: fbData } = await fb;
    return (fbData ?? []) as MarketingMemory[];
  }

  return (data ?? []) as MarketingMemory[];
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Checks if an identical or very similar memory already exists.
 * Exact match: same (founder_id, product_id, memory_type, title).
 * Returns the existing memory ID if found, null otherwise.
 */
export async function findDuplicateMemory(
  founderId: string,
  productId: string | null,
  memoryType: MemoryType,
  title: string,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  let q = supabase
    .from('marketing_memories')
    .select('id')
    .eq('founder_id', founderId)
    .eq('memory_type', memoryType)
    .eq('status', 'active')
    .ilike('title', title);

  if (productId) {
    q = q.eq('product_id', productId);
  } else {
    q = q.is('product_id', null);
  }

  const { data } = await q.limit(1).single();
  return data?.id ?? null;
}

/**
 * Merges two memories: keeps keepId, archives discardId.
 * Unions evidence_ids, takes the higher confidence, updates knowledge graph edges.
 * @throws If either memory is not found or not owned by founderId.
 */
export async function mergeMemories(
  founderId: string,
  keepId: string,
  discardId: string,
): Promise<MarketingMemory> {
  const supabase = getSupabaseAdmin();

  const [keepRes, discardRes] = await Promise.all([
    supabase.from('marketing_memories').select('*').eq('id', keepId).eq('founder_id', founderId).single(),
    supabase.from('marketing_memories').select('*').eq('id', discardId).eq('founder_id', founderId).single(),
  ]);

  if (keepRes.error || !keepRes.data) throw new Error('Keep memory not found');
  if (discardRes.error || !discardRes.data) throw new Error('Discard memory not found');

  const keep    = keepRes.data as MarketingMemory;
  const discard = discardRes.data as MarketingMemory;

  // Union evidence, take higher confidence
  const mergedEvidenceIds = Array.from(new Set([...keep.evidence_ids, ...discard.evidence_ids]));
  const mergedConfidence  = Math.min(1.0, Math.max(keep.confidence, discard.confidence) + 0.05);

  // Update the kept memory
  await updateMemory(keepId, founderId, {
    content:     { ...discard.content, ...keep.content, _mergedFrom: discardId },
    confidence:  mergedConfidence,
    change_note: `Merged from ${discardId}`,
    changed_by:  'system',
  });

  // Union evidence_ids on kept memory
  await supabase
    .from('marketing_memories')
    .update({ evidence_ids: mergedEvidenceIds })
    .eq('id', keepId);

  // Archive the discarded memory
  await archiveMemory(discardId, founderId, `merged_into:${keepId}`);

  // Redirect knowledge graph edges from discard node to keep node
  // (edges reference memory IDs indirectly via source_id on nodes — handled in knowledgeGraphService)

  const { data: updated } = await supabase
    .from('marketing_memories')
    .select('*')
    .eq('id', keepId)
    .single();

  return updated as MarketingMemory;
}

// ── Evidence linking ──────────────────────────────────────────────────────────

/**
 * Creates an evidence record and links it to a memory, updating memory confidence.
 */
export async function addEvidence(
  founderId: string,
  productId: string | null,
  memoryId: string,
  evidenceType: import('../types/memory').EvidenceType,
  data: Record<string, unknown>,
  confidenceBoost: number,
  sourceId?: string,
  sourceTable?: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const workspaceId = await resolveMemoryWorkspace(founderId, productId ?? null);

  // Insert evidence record
  const { data: ev, error: evErr } = await supabase
    .from('evidence')
    .insert({
      founder_id:      founderId,
      workspace_id:    workspaceId,
      product_id:      productId ?? null,
      evidence_type:   evidenceType,
      source_id:       sourceId ?? null,
      source_table:    sourceTable ?? null,
      data,
      confidence_boost: confidenceBoost,
    })
    .select('id')
    .single();

  if (evErr || !ev) throw evErr ?? new Error('Evidence insert failed');

  // Append evidence ID to memory and adjust confidence
  const { data: mem } = await supabase
    .from('marketing_memories')
    .select('evidence_ids, confidence')
    .eq('id', memoryId)
    .eq('founder_id', founderId)
    .single();

  if (!mem) return;

  const newIds = [...((mem.evidence_ids as string[]) ?? []), ev.id];
  const newConf = Math.min(1.0, Math.max(0.0, (mem.confidence as number) + confidenceBoost));

  await supabase
    .from('marketing_memories')
    .update({ evidence_ids: newIds, confidence: newConf, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
}
