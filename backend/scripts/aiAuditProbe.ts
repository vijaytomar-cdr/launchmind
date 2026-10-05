/**
 * @file aiAuditProbe.ts
 * @description Proves system-initiated AI calls are audited — P1-43 closure.
 *
 *   Runs REAL provider calls against LOCAL Supabase (LOCAL_ISOLATED_CERTIFICATION)
 *   and reads back what was actually persisted. Asserting on the code path would
 *   have proven nothing: the previous behaviour was code that looked correct and
 *   a database that rejected every row.
 *
 *   Also covers §12 — one governed generation call and one semantic claim-audit
 *   call must produce two rows distinguishable by purpose.
 *
 * @security Loopback Supabase only; refuses to run against a non-loopback host.
 *   No owner data. No prompts or credentials persisted.
 */

import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { callHaiku, callSonnet, aiAuditCounters, resolveAiActor } from '../src/lib/aiPlatform';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function guard(): void {
  const url = process.env.SUPABASE_URL ?? '';
  let host: string | null = null;
  try { host = new URL(url).hostname; } catch { /* unparseable */ }
  if (!host || !LOOPBACK.has(host)) {
    console.error(`REFUSING: Supabase target is not loopback (${host ?? 'unparseable'}).`);
    console.error('Run with --env-file=../.env.staging (LOCAL_ISOLATED_CERTIFICATION).');
    process.exit(3);
  }
  console.log(`target: loopback Supabase (${host})`);
}

interface Row {
  id: string; actor_type: string; founder_id: string | null; workspace_id: string | null;
  model: string; action: string; prompt_id: string; status: string;
  input_tokens: number | null; output_tokens: number | null; total_tokens: number | null;
  cost_usd: string | null; latency_ms: number | null; created_at: string;
}

async function main() {
  guard();
  const db = getSupabaseAdmin();
  const started = new Date().toISOString();

  // Unit check first: the split itself, before any network call.
  const a = resolveAiActor('system');
  const b = resolveAiActor('11111111-2222-3333-4444-555555555555');
  console.log(`resolveAiActor('system')  → ${a.actorType} / founderId=${a.founderId}`);
  console.log(`resolveAiActor(uuid)      → ${b.actorType} / founderId=${b.founderId}`);

  console.log('\n1. system-initiated Haiku call…');
  await callHaiku('Reply with the single word: ok', 16, {
    founderId: 'system', promptId: 'ai_audit_probe', action: 'ai_audit_probe',
  });

  console.log('2. governed generation (Sonnet) + semantic claim audit (Haiku)…');
  await callSonnet('Return only raw JSON.', 'Return {"content":{"headline":"Marketing, less scattered"},"declaredClaims":[]}',
    200, { founderId: 'system', promptId: 'governed_content_generation', action: 'governed_content_generation' });
  await callHaiku('Return only raw JSON: {"fields":[],"artifactClaims":[]}', 200, {
    founderId: 'system', promptId: 'copy_claim_classification_batch', action: 'copy_claim_classification',
  });

  await new Promise(r => setTimeout(r, 1500));   // audit writes are fire-and-forget

  const { data } = await db.from('ai_requests')
    .select('id, actor_type, founder_id, workspace_id, model, action, prompt_id, status, ' +
            'input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, created_at')
    .gte('created_at', started)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as unknown as Row[];

  console.log(`\nrows written since probe start: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.actor_type.padEnd(7)} founder=${r.founder_id ?? 'NULL'} ws=${r.workspace_id ?? 'NULL'} ` +
      `${r.action.padEnd(30)} ${r.model} in=${r.input_tokens} out=${r.output_tokens} ` +
      `cost=$${r.cost_usd} ${r.latency_ms}ms ${r.status}`);
  }

  const fail: string[] = [];
  const check = (cond: boolean, msg: string) => { if (!cond) fail.push(msg); };

  check(rows.length === 3, `expected 3 audit rows, got ${rows.length}`);
  check(rows.every(r => r.actor_type === 'system'), 'a probe row was not actor_type=system');
  check(rows.every(r => r.founder_id === null), 'a system row carried founder identity');
  check(rows.every(r => r.total_tokens !== null && r.total_tokens > 0), 'token usage missing');
  check(rows.every(r => r.cost_usd !== null && Number(r.cost_usd) > 0), 'cost missing');
  check(rows.every(r => r.latency_ms !== null && r.latency_ms > 0), 'latency missing');
  check(rows.every(r => r.status === 'success'), 'a probe row was not success');

  // §12 — the two three-signal surfaces must be distinguishable by purpose.
  const gen = rows.filter(r => r.action === 'governed_content_generation');
  const sem = rows.filter(r => r.action === 'copy_claim_classification');
  check(gen.length === 1, `generation requests = ${gen.length}, expected 1`);
  check(sem.length === 1, `semantic claim-audit requests = ${sem.length}, expected 1`);
  check(gen[0]?.model !== sem[0]?.model, 'generation and claim audit used the same model tier');

  console.log(`\naudit counters: written=${aiAuditCounters.written} failed=${aiAuditCounters.failed}` +
    `${aiAuditCounters.lastError ? ` lastError=${aiAuditCounters.lastError}` : ''}`);
  check(aiAuditCounters.failed === 0, 'an audit write failed');

  if (fail.length) { console.log('\nFAIL:'); for (const f of fail) console.log(`  ${f}`); process.exit(2); }
  console.log('\nPASS — system AI calls are audited, scoped honestly, and carry no founder identity.');
}

main().catch(e => { console.error(e); process.exit(1); });
