/**
 * @file hostedHybridProof.ts
 * @description Proves hosted retrieval actually runs HYBRID — 3.1G remediation §9.
 *
 *   Every earlier hosted claim about retrieval was inferred from counts
 *   (`current_embeddings = 33`, therefore semantic works). That inference is
 *   exactly what failed in this phase: the held-out evaluation reported a
 *   "hybrid" number that had been produced entirely lexically, because the
 *   service degraded per request and nobody read the per-request mode.
 *
 *   So this asks the service directly, on the real project, and refuses to report
 *   success unless every certification query returns `HYBRID` with the semantic
 *   arm confirmed active, the right model, the right width, correct workspace
 *   scoping and zero cross-tenant leakage.
 *
 *   Queries are paced: Voyage's tier allows 3 requests/minute and a 429 would
 *   degrade the very arm under test, turning a real failure into a false one.
 *
 * @security Read-only. Runs retrieval; writes nothing. No memory content is
 *   printed beyond a truncated title needed to show the result is real.
 * @dependencies retrievalService, marketing_memories (hosted)
 */

import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { retrieveMemories } from '../src/services/memory/retrievalService';

const PACE_MS = Number(process.env.PROOF_PACE_MS || 25_000);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Deliberately paraphrased: a lexical-only arm would struggle, so a good result is evidence the semantic arm contributed. */
const QUERIES = [
  'what messaging has worked best for us',
  'which channel gives the best cost per booking',
  'who are our customers',
  'what do reviews complain about',
];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? '';
  if (/127\.0\.0\.1|localhost/.test(url)) {
    console.error('BLOCKED: this proof is about the HOSTED project; it is pointed at a local stack.');
    process.exit(2);
  }
  console.log(`\nHosted HYBRID proof — ${url.replace(/^https?:\/\//, '').split('.')[0]}\n`);

  const db = getSupabaseAdmin();

  // Which workspace actually holds memories on hosted.
  const { data: mems } = await db.from('marketing_memories')
    .select('workspace_id, product_id').limit(500);
  const counts = new Map<string, number>();
  for (const m of (mems ?? []) as Array<{ workspace_id: string }>) {
    counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1);
  }
  const [workspaceId, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!workspaceId) { console.error('BLOCKED: no memories on hosted to retrieve.'); process.exit(2); }
  console.log(`  workspace under test: ${workspaceId} (${n} memories)`);
  console.log(`  other workspaces present: ${counts.size - 1}\n`);

  const { data: contract } = await db.from('embedding_contract')
    .select('provider, model, dimensions, embedding_version, generation_enabled').eq('id', 1).maybeSingle();
  const ct = contract as { provider: string; model: string; dimensions: number; embedding_version: number; generation_enabled: boolean } | null;
  console.log(`  contract: ${ct?.provider}/${ct?.model}/${ct?.dimensions}d v${ct?.embedding_version} ` +
              `generation=${ct?.generation_enabled}\n`);

  const failures: string[] = [];
  let i = 0;

  for (const q of QUERIES) {
    if (i++ > 0) await sleep(PACE_MS);
    const r = await retrieveMemories({ workspaceId, query: q, limit: 5 });
    const sem = r.arms.find(a => a.arm === 'semantic');
    const lex = r.arms.find(a => a.arm === 'lexical');

    console.log(`  "${q}"`);
    console.log(`     mode=${r.mode} degraded=${r.degraded} ${r.degradedReasons.join(',') || ''}`);
    console.log(`     semantic: ran=${sem?.ran} candidates=${sem?.candidates} ${sem?.unavailableReason ?? ''}` +
                `  lexical: ran=${lex?.ran} candidates=${lex?.candidates}`);
    console.log(`     returned=${r.results.length}` +
                (r.results[0] ? `  top="${r.results[0].title.slice(0, 52)}" semRank=${r.results[0].semanticRank} ` +
                                `dist=${r.results[0].semanticDistance?.toFixed(4) ?? '—'}` : ''));

    if (r.mode !== 'HYBRID') failures.push(`${q}: mode=${r.mode}`);
    if (sem?.ran !== true) failures.push(`${q}: semantic arm did not run (${sem?.unavailableReason})`);
    if ((sem?.candidates ?? 0) === 0) failures.push(`${q}: semantic contributed no candidates`);

    // Tenancy: every returned record must belong to the workspace asked for.
    const foreign = r.results.filter(x => x.workspaceId !== workspaceId);
    if (foreign.length) failures.push(`${q}: ${foreign.length} cross-workspace result(s)`);

    // Every result must be backed by a CURRENT vector or be honestly labelled.
    const badVector = r.results.filter(x => x.semanticRank !== null && x.embeddingStatus !== 'current');
    if (badVector.length) failures.push(`${q}: semantic hit on a non-current vector`);
  }

  // Contract assertions — the model and width the vectors were actually built at.
  const { data: sample } = await db.from('memory_embeddings')
    .select('embedding_model, dimensions, embedding_version, status')
    .eq('status', 'current').limit(1).maybeSingle();
  const s = sample as { embedding_model: string; dimensions: number; embedding_version: number } | null;
  console.log(`\n  stored vectors: model=${s?.embedding_model} dims=${s?.dimensions} v${s?.embedding_version}`);
  if (s?.embedding_model !== ct?.model) failures.push(`stored model ${s?.embedding_model} ≠ contract ${ct?.model}`);
  if (Number(s?.dimensions) !== 1024) failures.push(`stored dimensions ${s?.dimensions} ≠ 1024`);

  console.log(`\n  HOSTED HYBRID: ${failures.length === 0 ? 'PROVEN' : 'FAILED'}`);
  for (const f of failures) console.log(`     ${f}`);
  console.log('');
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
