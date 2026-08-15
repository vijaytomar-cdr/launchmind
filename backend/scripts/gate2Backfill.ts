/** Gate 2 driver: drains the outbox with pacing until nothing is left. */
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { runBatch } from '../src/services/memory/embeddingPipeline';

async function main() {
  const db = getSupabaseAdmin();
  const lags: number[] = [];
  let completed = 0, skipped = 0, failed = 0, dead = 0;

  for (let i = 0; i < 60; i++) {
    const { data: pend } = await db.from('embedding_outbox').select('id').eq('status', 'pending');
    if (!pend?.length) break;
    const out = await runBatch(`gate2-${i}`, 5);
    for (const o of out) {
      if (o.result === 'completed') completed++;
      else if (o.result === 'skipped') skipped++;
      else if (o.result === 'failed') failed++;
      else if (o.result === 'dead') dead++;
      if (o.providerLatencyMs) lags.push(o.providerLatencyMs);
    }
    if (!out.length) await new Promise(r => setTimeout(r, 20_000));
    console.log(`sweep ${i}: completed=${completed} failed=${failed} dead=${dead} remaining=${(pend?.length ?? 0) - out.length}`);
  }
  const s = [...lags].sort((a, b) => a - b);
  const p = (q: number) => (s.length ? s[Math.max(0, Math.ceil(q / 100 * s.length) - 1)] : 0);
  console.log(`DONE completed=${completed} skipped=${skipped} failed=${failed} dead=${dead} p50=${p(50)}ms p95=${p(95)}ms`);
}
main().catch(e => { console.error(e); process.exit(1); });
