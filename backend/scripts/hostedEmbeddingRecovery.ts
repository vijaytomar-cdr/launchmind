/**
 * @file hostedEmbeddingRecovery.ts
 * @description Drains the hosted embedding outbox through the NORMAL pipeline —
 *   Phase 3.1G remediation §8.
 *
 *   ROOT CAUSE THIS RECOVERS FROM: `startEmbeddingWorker()` was never called in
 *   `server.ts`. Every other worker was started; this one was written, wired to
 *   BullMQ, documented, and then never referenced outside its own file. Because
 *   the outbox is filled by a Postgres TRIGGER rather than by the application,
 *   work accumulated silently whether or not anything consumed it. On the next
 *   bulk update of the corpus every vector went stale, nothing re-embedded them,
 *   and semantic retrieval degraded to lexical-only with no error anywhere.
 *
 *   WHAT THIS SCRIPT DOES NOT DO: it does not write vectors, does not mark
 *   anything `current`, and does not touch `memory_embeddings` directly. It calls
 *   `runBatchGrouped`, the same function the (now-wired) worker calls, so what is
 *   exercised here is the real path — claim from outbox, re-verify tenancy,
 *   render canonical text, call the provider, store with provenance. A recovery
 *   that bypassed the pipeline would prove the pipeline works when it does not.
 *
 *   Provider rate limits are respected, not bypassed: the grouped path sends one
 *   request per batch, and batches are paced.
 *
 * @security Runs as service_role against the configured project. Reads and writes
 *   only pipeline state; no memory content is logged.
 * @dependencies embeddingPipeline (runBatchGrouped), embeddingBackfill (health)
 */

import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { runBatchGrouped } from '../src/services/memory/embeddingPipeline';
import { getEmbeddingHealth } from '../src/services/memory/embeddingBackfill';

const PACE_MS = Number(process.env.RECOVERY_PACE_MS || 25_000);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function snapshot(label: string): Promise<Record<string, number>> {
  const db = getSupabaseAdmin();
  const { data: stats } = await db.from('embedding_pipeline_stats').select('*').maybeSingle();
  const s = Object.fromEntries(Object.entries(stats ?? {}).map(([k, v]) => [k, Number(v)]));
  console.log(`  ${label}: pending=${s.pending_jobs} processing=${s.processing_jobs} ` +
              `failed=${s.failed_jobs} cancelled=${s.cancelled_jobs} completed=${s.completed_jobs} ` +
              `| current=${s.current_embeddings} stale=${s.stale_embeddings}`);
  return s;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? '';
  console.log(`\nHosted embedding recovery — target ${url.replace(/^https?:\/\//, '').split('.')[0]}\n`);

  const before = await snapshot('BEFORE');
  const h0 = await getEmbeddingHealth();
  console.log(`  health BEFORE: ${h0.status} (queueAge=${h0.queueAgeSeconds}s, ` +
              `provider=${h0.provider}/${h0.model}/${h0.dimensions}, generation=${h0.generationEnabled})\n`);

  if (!h0.generationEnabled) {
    console.error('BLOCKED: generation is disabled on the contract. Recovery would produce nothing.');
    process.exit(2);
  }

  let round = 0;
  let totalCompleted = 0, totalFailed = 0, totalCancelled = 0, totalSkipped = 0;

  // Loop until the outbox stops yielding claimable work. Bounded so a pathological
  // requeue loop cannot spin forever against a paid provider.
  while (round < 20) {
    round++;
    const outcomes = await runBatchGrouped(`recovery-${round}`, 25);
    if (outcomes.length === 0) {
      console.log(`  round ${round}: nothing claimable — queue drained`);
      break;
    }
    const by = (r: string) => outcomes.filter(o => o.result === r).length;
    totalCompleted += by('completed'); totalFailed += by('failed');
    totalCancelled += by('cancelled'); totalSkipped += by('skipped');
    console.log(`  round ${round}: claimed=${outcomes.length} completed=${by('completed')} ` +
                `skipped=${by('skipped')} cancelled=${by('cancelled')} failed=${by('failed')} dead=${by('dead')}`);

    // Surface WHY anything failed — a silent failure count is the thing that let
    // this situation develop in the first place.
    for (const o of outcomes.filter(x => x.result === 'failed' || x.result === 'dead' || x.result === 'cancelled')) {
      console.log(`      ${o.result}: ${(o as { errorKind?: string }).errorKind ?? 'unknown'}`);
    }

    await sleep(PACE_MS);
  }

  console.log('');
  const after = await snapshot('AFTER ');
  const h1 = await getEmbeddingHealth();
  console.log(`  health AFTER:  ${h1.status} (queueAge=${h1.queueAgeSeconds}s)\n`);

  // Per-memory reconciliation. The counts above can look right while individual
  // records are missing, so the real check is "which beliefs have no current vector".
  const db = getSupabaseAdmin();
  const { count: memories } = await db.from('marketing_memories')
    .select('id', { count: 'exact', head: true });
  const { data: current } = await db.from('memory_embeddings')
    .select('source_id').eq('status', 'current').eq('source_type', 'marketing_memory');
  const covered = new Set((current ?? []).map(r => (r as { source_id: string }).source_id));
  const { data: all } = await db.from('marketing_memories').select('id, title, status');
  const uncovered = (all ?? []).filter(m => !covered.has((m as { id: string }).id));

  console.log(`  memories=${memories}  with a current vector=${covered.size}  without=${uncovered.length}`);
  for (const u of uncovered.slice(0, 10)) {
    const m = u as { id: string; title: string; status: string };
    console.log(`      uncovered: ${m.id} [${m.status}] ${m.title.slice(0, 60)}`);
  }

  console.log(`\n  totals: completed=${totalCompleted} skipped=${totalSkipped} ` +
              `cancelled=${totalCancelled} failed=${totalFailed}`);

  const pass = after.pending_jobs === 0 && after.processing_jobs === 0 &&
               after.failed_jobs === 0 && after.stale_embeddings === 0 &&
               uncovered.length === 0;
  console.log(`\n  RECOVERY: ${pass ? 'PASS' : 'INCOMPLETE'}` +
              `${pass ? '' : ' — see uncovered records and counts above'}\n`);
  void before;
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
