/**
 * @file agents/memoryAgent.ts
 * @description Memory agent — scans for stale memories, deduplicates, and archives old ones.
 *   Runs in 'memory' missions and as a step in 'learning' missions.
 * @security Reads directly; every WRITE goes through MemoryLifecycleService,
 *   the one authoritative mutation boundary (ADR-067 C16). This agent formerly
 *   UPDATEd marketing_memories directly, bypassing the state machine, the version
 *   snapshot and the traceability invariant — and two of its three column names
 *   did not exist, so it silently did nothing.
 * @dependencies memoryLifecycleService, workspaceResolver
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { markStale, supersedeMemory } from '../memory/memoryLifecycleService';
import { resolveMemoryWorkspace } from '../memory/workspaceResolver';
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

  // Lifecycle transitions are workspace-scoped. Resolved from canonical records,
  // never assumed from the founder.
  const workspaceId = await resolveMemoryWorkspace(founderId, productId ?? null);
  if (!workspaceId) {
    await context.log('Memory agent: no workspace resolved; nothing to do', 'info');
    return { action, scanned: 0, archived: 0, duplicates: 0, completedAt: new Date().toISOString() };
  }

  if (action === 'scan' || action === 'archive') {
    // Find memories older than 90 days with low confidence
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from('marketing_memories')
      // `confidence` — NOT `confidence_score`, which has never existed. Selecting
      // it made PostgREST error, `data` come back null, and the stale scan
      // silently find nothing on every run (ADR-067 C17 migration).
      .select('id, title, confidence, created_at')
      .eq('founder_id', founderId)
      .eq('status', 'active')
      .lt('confidence', 0.3)
      .lt('created_at', cutoff)
      .limit(50);

    if (productId) q = q.eq('product_id', productId);

    const { data: staleMemories } = await q;
    scanned = staleMemories?.length ?? 0;

    if (action === 'archive' && staleMemories && staleMemories.length > 0) {
      // ADR-067 C16/C17: marketing_memories has exactly ONE writer. This agent
      // used to UPDATE the table directly, which bypassed the state machine, the
      // version snapshot and the traceability invariant.
      //
      // Ageing out a low-confidence memory is `markStale` — not `archived`.
      // `archived` is documented in migration 096 as a legacy synonym for
      // `superseded`, and nothing has superseded these; time has merely passed.
      for (const m of staleMemories) {
        try {
          await markStale(m.id, workspaceId, {
            reason: 'confidence below 0.3 and unreinforced for 90 days',
          });
          archived++;
        } catch (err) {
          Sentry.captureException(err, { tags: { agent: 'memory', op: 'markStale' } });
        }
      }
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

    const seen = new Map<string, string>(); // title → first (surviving) id
    const toArchive: Array<{ id: string; titleKey: string }> = [];

    for (const m of allMemories ?? []) {
      const key = m.title.toLowerCase().trim();
      if (seen.has(key)) {
        // The later duplicate is superseded BY the earlier one, which is what
        // makes the history readable afterwards.
        toArchive.push({ id: m.id, titleKey: key });
      } else {
        seen.set(key, m.id);
      }
    }

    if (toArchive.length > 0) {
      // The `archive_reason` column does not exist on marketing_memories — it is
      // a `products` column (migration 029), so this UPDATE failed with 42703 on
      // every run. The reason belongs in the version history, which the
      // lifecycle transition records, not in a column duplicated onto the row.
      for (const dup of toArchive) {
        try {
          const survivor = seen.get(dup.titleKey);
          if (!survivor) continue;   // no survivor means nothing superseded it
          await supersedeMemory(dup.id, workspaceId, {
            supersededById: survivor,
            challengerSource: 'growth_brain',
            // Explicit: this is a SYSTEM dedup pass, so the challenger carries
            // derived authority. Omitting it would fail closed on a governed
            // incumbent rather than silently taking the legacy source path.
            challengerAuthorityTier: 'DERIVED_INFERENCE',
            reason: 'duplicate title of an earlier memory',
            actorType: 'system',
          });
          duplicates++;
        } catch (err) {
          Sentry.captureException(err, { tags: { agent: 'memory', op: 'supersede' } });
        }
      }
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
