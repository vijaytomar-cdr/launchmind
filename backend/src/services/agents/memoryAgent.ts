/**
 * @file agents/memoryAgent.ts
 * @description Memory agent — scans for stale memories, deduplicates, and archives old ones.
 *   Runs in 'memory' missions and as a step in 'learning' missions.
 * @security No direct DB access beyond what's passed through AgentContext + admin client.
 * @dependencies marketingMemoryService, knowledgeGraphService
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { AgentFn } from '../../types/mission';

/**
 * Memory agent — deduplicates and archives stale marketing memories.
 * Uses exact-match dedup (vector similarity dedup is async, handled by learningPipelineService).
 */
export const memoryAgent: AgentFn = async (input, context) => {
  const { founderId } = context;

  await context.log('Memory agent starting', 'info', { founderId });

  const supabase  = getSupabaseAdmin();
  const action    = (input.action as string) ?? 'scan';
  const productId = (input.productId as string) ?? context.productId;

  let scanned    = 0;
  let archived   = 0;
  let duplicates = 0;

  if (action === 'scan' || action === 'archive') {
    // Find memories older than 90 days with low confidence
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from('marketing_memories')
      .select('id, title, confidence_score, created_at')
      .eq('founder_id', founderId)
      .eq('status', 'active')
      .lt('confidence_score', 0.3)
      .lt('created_at', cutoff)
      .limit(50);

    if (productId) q = q.eq('product_id', productId);

    const { data: staleMemories } = await q;
    scanned = staleMemories?.length ?? 0;

    if (action === 'archive' && staleMemories && staleMemories.length > 0) {
      const ids = staleMemories.map(m => m.id);
      const { error } = await supabase
        .from('marketing_memories')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .in('id', ids);

      if (!error) archived = ids.length;
    }
  }

  if (action === 'deduplicate') {
    // Find memories with identical titles (exact-match dedup only)
    const { data: allMemories } = await supabase
      .from('marketing_memories')
      .select('id, title, created_at')
      .eq('founder_id', founderId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    const seen = new Map<string, string>(); // title → first id
    const toArchive: string[] = [];

    for (const m of allMemories ?? []) {
      const key = m.title.toLowerCase().trim();
      if (seen.has(key)) {
        toArchive.push(m.id); // archive the later duplicate
      } else {
        seen.set(key, m.id);
      }
    }

    if (toArchive.length > 0) {
      await supabase.from('marketing_memories')
        .update({ status: 'archived', archive_reason: 'duplicate', updated_at: new Date().toISOString() })
        .in('id', toArchive);
      duplicates = toArchive.length;
    }
  }

  await context.log(`Memory agent complete: scanned=${scanned} archived=${archived} duplicates=${duplicates}`, 'info');

  return {
    action,
    scanned,
    archived,
    duplicates,
    completedAt: new Date().toISOString(),
  };
};
