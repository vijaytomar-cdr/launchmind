/**
 * @file runHeldOut.ts
 * @description Scores the frozen hybrid retriever on the 84-query HELD-OUT set —
 *   Phase 3.1G §2/§3.
 *
 *   Runs ONE arm. The lexical baseline arms in runBaseline.ts exist to show what
 *   3.1D improved on; re-running them here would only re-report a settled
 *   comparison. What is open is whether the hybrid retriever generalises to
 *   queries it was never developed against.
 *
 *   RULE OBSERVED: no retrieval parameter is touched after this run. If any is,
 *   this file must be re-run and the previous numbers discarded — a metric from
 *   a configuration that no longer exists is worse than no metric.
 *
 *   `out_of_scope` queries are scored SEPARATELY. Recall over an empty required
 *   set is trivially 1, so folding them into the headline would inflate it by
 *   construction. They are reported on noise instead.
 *
 * @security Local/disposable Supabase only — evalClient() refuses anything else.
 *   Synthetic corpus; no founder data.
 * @dependencies heldout.ts, fixtures.ts, metrics.ts, retrievalService
 */

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { retrieveMemories } from '../../../src/services/memory/retrievalService';
import { acquireCorpusVectors, certifyCorpusCoverage, assertCorpusCoverage } from '../corpusEmbeddingCertification';
import {
  PRODUCT_A, WORKSPACE_A, WORKSPACE_B, evalClient, seedCorpus, MEMORIES, ID_TO_FIXTURE,
} from './fixtures';
import { HELD_OUT, HELD_OUT_COUNTS, type HeldOutQuery } from './heldout';
import { DATASET } from './dataset';
import { getSupabaseAdmin } from '../../../src/lib/supabaseAdmin';
import { resolveEmbeddingProvider } from '../../../src/services/memory/providers/index';
import { primeFromCache, assertSemanticCoverage } from '../evalEmbeddingCache';
import {
  scoreQuery, percentile, mean, type RetrievedItem, type QueryScore, type ClassifyContext,
} from './metrics';
import type { EvalQuery } from './dataset';

const CTX_BASE: Omit<ClassifyContext, 'queryAgnostic'> = {
  titles: Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.title])),
  statuses: Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.status])),
  reachable: Object.fromEntries(MEMORIES.map(m => [m.fixture_id, true])),
};

/**
 * CORPUS COVERAGE — the guard that was missing.
 *
 * This used to drain the outbox live and return a global count of `current`
 * rows, which told a caller nothing about whether THIS corpus was embedded. A
 * 26-memory corpus with 0 vectors passed straight through and every metric below
 * was published as HYBRID.
 *
 * Now: acquire from the shared vector cache (0 provider calls when warm), then
 * ASSERT full coverage against the active contract. There is no bypass flag.
 */
async function embedCorpus(db = evalClient()): Promise<number> {
  await db.from('embedding_contract').update({
    provider: process.env.EMBEDDING_PROVIDER || 'voyage',
    model: process.env.EMBEDDING_MODEL || 'voyage-4',
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS || 1024),
    generation_enabled: true,
  }).eq('id', 1);

  const acq = await acquireCorpusVectors(db, [WORKSPACE_A, WORKSPACE_B]);
  console.log(`  corpus vectors: ${acq.fromCache} cached + ${acq.embedded} embedded ` +
              `(${acq.providerRequests} provider request(s)), ${acq.written} written`);

  const cov = await certifyCorpusCoverage(db, [WORKSPACE_A, WORKSPACE_B]);
  assertCorpusCoverage(cov);   // throws CORPUS_SEMANTIC_COVERAGE_INCOMPLETE
  console.log(`  CORPUS_COVERAGE certified ${cov.current}/${cov.expected} ` +
              `(${cov.contract.provider}/${cov.contract.model}/${cov.contract.dimensions}d/v${cov.contract.embedding_version})`);
  return cov.current;
}

interface Row {
  q: HeldOutQuery; score: QueryScore; endToEndMs: number; mode: string; semanticRan: boolean;
  /** Recall over the full returned list (limit 10) — how much reranking could recover. */
  recallAt10: number;
  returned: number;
}

/**
 * STAGE B — zero provider calls.
 *
 * Voyage's free tier allows ~3 requests/minute. Pacing one live call per query
 * made this file take 30+ minutes and still stall, and an UNPACED run degraded
 * silently to LEXICAL_ONLY and published a lexical score under a hybrid heading.
 * Wall-clock sleeping was never a viable evaluation strategy.
 *
 * The queries are FIXED, so their real Voyage vectors are acquired once by
 * Stage A (`npm run eval:acquire-embeddings`) and primed from disk here. These
 * are real Voyage vectors — never the deterministic provider — so the retrieval
 * measured is the production retrieval.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function primeAll(queries: HeldOutQuery[]): Promise<void> {
  const { provider, live } = resolveEmbeddingProvider();
  if (!live) {
    throw new Error(
      `refusing to run: provider resolved to ${provider.capabilities.provider}/` +
      `${provider.capabilities.dimensions}d, not live Voyage. The corpus and the ` +
      'cached query vectors would not share a contract and every query would ' +
      'degrade to LEXICAL_ONLY without raising.');
  }
  // The retrieval cache key is keyed on the ACTIVE contract, not on the provider
  // defaults, so it is read from the same row retrieval itself reads.
  const { data: c } = await getSupabaseAdmin()
    .from('embedding_contract').select('provider, model, embedding_version, dimensions')
    .eq('id', 1).maybeSingle();
  const contract = c as { provider: string; model: string; embedding_version: number; dimensions: number } | null;
  if (!contract) throw new Error('no embedding contract; retrieval would be lexical-only');

  const report = primeFromCache(queries.map(q => q.query), {
    provider: contract.provider, model: contract.model,
    dimensions: contract.dimensions, version: contract.embedding_version,
  });
  assertSemanticCoverage(report);   // throws unless X/X
  console.log(`  primed ${report.primed}/${report.requested} real Voyage query vectors ` +
              `(${report.identity.model}/${report.identity.dimensions}d, 0 provider calls)`);
}

async function run(queries: HeldOutQuery[], label: string): Promise<Row[]> {
  const rows: Row[] = [];
  let i = 0;
  for (const q of queries) {
    i++;
    if (i % 25 === 0) console.log(`    ${label} ${i}/${queries.length}…`);

    // A 429 costs the semantic arm for that query only. Retrying the QUERY (not
    // changing the retriever) is what keeps the measurement honest — the
    // alternative is publishing a lexical row inside a hybrid average, which is
    // precisely the defect this file was rewritten to prevent.
    let t0 = performance.now();
    let res = await retrieveMemories({
      workspaceId: WORKSPACE_A, productId: PRODUCT_A, query: q.query, limit: 10,
    });
    // No retry loop: with vectors primed from cache there is no provider call to
    // rate-limit, so a degraded arm here is a real defect and must not be papered
    // over by a back-off. `assertSemanticArm` fails the run instead.
    const endToEndMs = performance.now() - t0;
    // Retrieval-only, excluding the query-embedding provider call. That call is
    // paced by a free-tier rate limit on this account; including it would report
    // the limiter, not the system. End-to-end is reported separately.
    const latency = res.timings.totalMs - res.timings.queryEmbeddingMs;
    const returned: RetrievedItem[] = res.results.map(r => ({
      fixture_id: ID_TO_FIXTURE[r.id] ?? null, title: r.title,
    }));
    rows.push({
      q,
      score: scoreQuery(q as unknown as EvalQuery, returned, latency, { ...CTX_BASE, queryAgnostic: false }),
      endToEndMs,
      mode: res.mode,
      semanticRan: res.arms.find(a => a.arm === 'semantic')?.ran === true,
      recallAt10: q.expected.required.length === 0 ? 1
        : q.expected.required.filter(r => returned.slice(0, 10).some(x => x.fixture_id === r)).length
          / q.expected.required.length,
      returned: returned.length,
    });
  }
  return rows;
}

/**
 * Refuses to report a hybrid metric that was not produced by a hybrid retriever.
 *
 * The absent guard is what let the first run of this file publish a LEXICAL_ONLY
 * measurement as a headline hybrid number.
 */
function assertSemanticRan(rows: Row[], label: string): void {
  const ran = rows.filter(r => r.semanticRan).length;
  const modes = rows.reduce<Record<string, number>>((a, r) => { a[r.mode] = (a[r.mode] ?? 0) + 1; return a; }, {});
  console.log(`  ${label}: semantic arm ran on ${ran}/${rows.length}. modes = ${JSON.stringify(modes)}`);
  if (ran < rows.length) {
    console.error(`\n  BLOCKED: ${rows.length - ran} query/queries ran without the semantic arm. ` +
      `Publishing this as a hybrid result would misattribute a lexical score.\n`);
    process.exit(2);
  }
}

function fmt(n: number, d = 3): string { return n.toFixed(d); }

async function main(): Promise<void> {
  const db = evalClient();
  console.log('Seeding corpus…');
  await seedCorpus(db);
  console.log('Embedding through the real pipeline…');
  const embedded = await embedCorpus(db);
  console.log(`  ${embedded} current embeddings\n`);

  if (embedded === 0) {
    console.error('BLOCKED: no embeddings were produced. The semantic arm would be silently absent, ' +
                  'and a hybrid score without it would be a lexical score under another name.');
    process.exit(2);
  }

  // ── Re-measure the 3.1D dataset with a VERIFIED semantic arm ───────────────
  // The 71.9% Recall@5 recorded for "Arm H — hybrid" in
  // docs/evals/memory-retrieval-baseline.md was produced by an unpaced runner.
  // At 3 requests/minute that run could not have embedded 32 distinct queries,
  // so it is unknown whether that figure ever had a semantic arm behind it.
  // Re-running it here settles the question instead of leaving a headline number
  // in the record that may be mislabelled.
  const dev = DATASET.map(d => ({ ...d, category: d.category as HeldOutQuery['category'] }));
  console.log(`Re-measuring the ${dev.length}-query 3.1D dataset (cached real Voyage vectors)…`);
  await primeAll(dev);
  const devRows = await run(dev, '3.1D');
  assertSemanticRan(devRows, '3.1D dataset');
  const devScores = devRows.map(r => r.score);
  const dev31d = {
    r1: mean(devScores.map(x => x.recallAt1)), r3: mean(devScores.map(x => x.recallAt3)),
    r5: mean(devScores.map(x => x.recallAt5)), mrr: mean(devScores.map(x => x.reciprocalRank)),
    leak: devScores.reduce((a, x) => a + x.leakage, 0),
  };
  console.log(`  3.1D re-measured: R@1=${fmt(dev31d.r1)} R@3=${fmt(dev31d.r3)} R@5=${fmt(dev31d.r5)} ` +
              `MRR=${fmt(dev31d.mrr)} leakage=${dev31d.leak}`);
  console.log(`  (record claims R@5=0.719, MRR=0.563)\n`);

  console.log(`Running ${HELD_OUT.length} held-out queries (cached real Voyage vectors)…\n`);
  await primeAll(HELD_OUT);
  const rows = await run(HELD_OUT, 'held-out');
  assertSemanticRan(rows, 'held-out set');

  const scored = rows.filter(r => r.q.category !== 'out_of_scope');
  const oos    = rows.filter(r => r.q.category === 'out_of_scope');

  const s = scored.map(r => r.score);
  const agg = {
    n: s.length,
    r1: mean(s.map(x => x.recallAt1)),
    r3: mean(s.map(x => x.recallAt3)),
    r5: mean(s.map(x => x.recallAt5)),
    r10: mean(scored.map(x => x.recallAt10)),
    // A query that returns NOTHING is a different failure from one that returns
    // the wrong thing, and recall cannot tell them apart.
    noResult: scored.filter(x => x.returned === 0).length / Math.max(scored.length, 1),
    mrr: mean(s.map(x => x.reciprocalRank)),
    irr: mean(s.map(x => x.irrelevantRate)),
    leak: s.reduce((a, x) => a + x.leakage, 0),
    p50: percentile(s.map(x => x.latencyMs), 50),
    p95: percentile(s.map(x => x.latencyMs), 95),
    e2eP95: percentile(rows.map(r => r.endToEndMs), 95),
  };

  console.log(`\nHEADLINE (${rows.length} queries: ${scored.length} recall-scored + ${oos.length} out-of-scope reported separately)\n`);
  console.log(`  Recall@1       ${fmt(agg.r1)}`);
  console.log(`  Recall@3       ${fmt(agg.r3)}`);
  console.log(`  Recall@5       ${fmt(agg.r5)}`);
  console.log(`  Recall@10      ${fmt(agg.r10)}`);
  console.log(`  No-result rate ${fmt(agg.noResult)}`);
  console.log(`  MRR            ${fmt(agg.mrr)}`);
  console.log(`  Irrelevant     ${fmt(agg.irr)}`);
  console.log(`  Leakage        ${agg.leak}   <-- must be 0`);
  console.log(`  Latency p50/p95 (retrieval only)  ${fmt(agg.p50, 1)}ms / ${fmt(agg.p95, 1)}ms`);
  console.log(`  Latency p95 (end-to-end, incl. provider) ${fmt(agg.e2eP95, 1)}ms\n`);

  console.log('BY CATEGORY\n');
  console.log('  category               n   R@1    R@3    R@5    MRR    irrelevant');
  console.log('  ' + '-'.repeat(66));
  const cats = [...new Set(scored.map(r => r.q.category))];
  const byCat: Record<string, { n: number; r1: number; r3: number; r5: number; mrr: number; irr: number }> = {};
  for (const c of cats) {
    const cs = scored.filter(r => r.q.category === c).map(r => r.score);
    byCat[c] = {
      n: cs.length, r1: mean(cs.map(x => x.recallAt1)), r3: mean(cs.map(x => x.recallAt3)),
      r5: mean(cs.map(x => x.recallAt5)), mrr: mean(cs.map(x => x.reciprocalRank)),
      irr: mean(cs.map(x => x.irrelevantRate)),
    };
    const b = byCat[c];
    console.log(`  ${c.padEnd(20)} ${String(b.n).padStart(3)}  ${fmt(b.r1)}  ${fmt(b.r3)}  ${fmt(b.r5)}  ${fmt(b.mrr)}  ${fmt(b.irr)}`);
  }

  // ── Out of scope ───────────────────────────────────────────────────────────
  const oosReturned = oos.map(r => r.score.returned);
  console.log(`\nOUT OF SCOPE (${oos.length} queries where the corpus knows nothing)\n`);
  console.log('  A high count here is not a recall failure — it is the retriever offering');
  console.log('  marketing memories as an answer to a question they do not answer.\n');
  for (const r of oos) {
    console.log(`  ${r.q.id}  returned ${String(r.score.returned).padStart(2)}  "${r.q.query}"`);
  }
  console.log(`\n  mean rows returned: ${fmt(mean(oosReturned), 2)} of a possible 10`);

  // ── Misses, in full ────────────────────────────────────────────────────────
  const misses = scored.filter(r => r.score.recallAt5 < 1);
  console.log(`\nMISSES AT 5 — ${misses.length}/${scored.length} queries did not return every required record\n`);
  for (const m of misses) {
    console.log(`  ${m.q.id} [${m.q.category}] R@5=${fmt(m.score.recallAt5, 2)} failure=${m.score.failure ?? 'none'}`);
    console.log(`    "${m.q.query}"`);
    console.log(`    missing: ${m.score.missing.join(', ')}`);
    if (m.q.note) console.log(`    note: ${m.q.note}`);
  }

  // ── Prediction calibration ─────────────────────────────────────────────────
  // Predictions were recorded before the run. Where the retriever beat the
  // prediction that is a real gain; where it underperformed a "hit" prediction
  // the model of the system was wrong, which is worth more than the metric.
  const predHit = scored.filter(r => r.q.expected_baseline === 'hit');
  const predMiss = scored.filter(r => r.q.expected_baseline === 'miss');
  console.log(`\nPREDICTION CALIBRATION (recorded before the run)\n`);
  console.log(`  predicted 'miss'  : ${predMiss.length} queries, actual R@5 = ${fmt(mean(predMiss.map(r => r.score.recallAt5)))}`);
  console.log(`  predicted 'partial': ${scored.length - predHit.length - predMiss.length} queries, actual R@5 = ` +
    `${fmt(mean(scored.filter(r => r.q.expected_baseline === 'partial').map(r => r.score.recallAt5)))}`);

  const md = [
    '# Memory retrieval — held-out evaluation (Phase 3.1G)',
    '',
    '> Generated by `backend/tests/evals/memory-retrieval/runHeldOut.ts`.',
    '> **Do not hand-edit the tables** — they are overwritten on every run.',
    '',
    `${HELD_OUT.length} queries that appear in no other dataset, scored against the retriever as`,
    'frozen at the end of Phase 3.1F. No retrieval parameter was changed after this',
    'run; if one is, these numbers are void and the file must be regenerated.',
    '',
    '**Held out from tuning, not from authorship.** The queries were written by',
    'someone who knows the corpus. That is weaker than queries collected from real',
    'owners and is the main caveat on every number below.',
    '',
    '## Composition',
    '',
    '| Category | Queries |',
    '|---|---|',
    ...Object.entries(HELD_OUT_COUNTS).map(([k, v]) => `| ${k} | ${v} |`),
    `| **Total** | **${HELD_OUT.length}** |`,
    '',
    '## Semantic arm verification',
    '',
    'Voyage\'s free tier permits 3 requests/minute. An unpaced run 429s on nearly every',
    'query and the retriever degrades to `LEXICAL_ONLY` — which is what the first run of',
    'this file did, producing a lexical score under a hybrid heading. Every query below',
    `ran in \`HYBRID\` mode with the semantic arm confirmed active; the runner exits 2`,
    'rather than publish otherwise.',
    '',
    '## Re-measurement of the 3.1D dataset',
    '',
    'The 71.9% Recall@5 in `memory-retrieval-baseline.md` came from that same unpaced',
    'runner, so it was re-measured here with the semantic arm verified.',
    '',
    '| Metric | Recorded in 3.1D | Re-measured with verified semantic arm |',
    '|---|---|---|',
    `| Recall@1 | 0.359 | ${fmt(dev31d.r1)} |`,
    `| Recall@3 | 0.578 | ${fmt(dev31d.r3)} |`,
    `| Recall@5 | 0.719 | ${fmt(dev31d.r5)} |`,
    `| MRR | 0.563 | ${fmt(dev31d.mrr)} |`,
    `| Leakage | 0 | ${dev31d.leak} |`,
    '',
    `## Headline (${scored.length} recall-scored queries; ${oos.length} out-of-scope excluded by construction)`,
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Recall@1 | ${fmt(agg.r1)} |`,
    `| Recall@3 | ${fmt(agg.r3)} |`,
    `| Recall@5 | ${fmt(agg.r5)} |`,
    `| Recall@10 | ${fmt(agg.r10)} |`,
    `| No-result rate | ${fmt(agg.noResult)} |`,
    `| MRR | ${fmt(agg.mrr)} |`,
    `| Irrelevant rate | ${fmt(agg.irr)} |`,
    `| Cross-tenant leakage | ${agg.leak} |`,
    `| Latency p50 / p95 (retrieval only) | ${fmt(agg.p50, 1)} ms / ${fmt(agg.p95, 1)} ms |`,
    `| Latency p95 (end-to-end incl. provider) | ${fmt(agg.e2eP95, 1)} ms |`,
    '',
    '## By category',
    '',
    '| Category | n | R@1 | R@3 | R@5 | MRR | Irrelevant |',
    '|---|---|---|---|---|---|---|',
    ...cats.map(c => {
      const b = byCat[c];
      return `| ${c} | ${b.n} | ${fmt(b.r1)} | ${fmt(b.r3)} | ${fmt(b.r5)} | ${fmt(b.mrr)} | ${fmt(b.irr)} |`;
    }),
    '',
    '## Out-of-scope behaviour',
    '',
    'Recall cannot see this failure mode: with an empty required set every retriever',
    'scores 1.0. What is measured instead is how many marketing memories come back for',
    'a question the corpus cannot answer.',
    '',
    '| Query | Rows returned |',
    '|---|---|',
    ...oos.map(r => `| ${r.q.query} | ${r.score.returned} |`),
    '',
    `Mean rows returned: **${fmt(mean(oosReturned), 2)}** of a possible 10.`,
    '',
    '## Misses',
    '',
    `${misses.length} of ${scored.length} recall-scored queries did not return every required record at rank 5.`,
    '',
    '| Query | Category | R@5 | Missing | Classified failure |',
    '|---|---|---|---|---|',
    ...misses.map(m => `| ${m.q.query} | ${m.q.category} | ${fmt(m.score.recallAt5, 2)} | ${m.score.missing.join(', ')} | ${m.score.failure ?? '—'} |`),
    '',
  ].join('\n');

  const out = join(__dirname, '..', '..', '..', '..', 'docs', 'evals', 'memory-retrieval-heldout.md');
  writeFileSync(out, md);
  console.log(`\nWrote ${out}\n`);

  if (agg.leak > 0) {
    console.error('FAIL: cross-tenant leakage is non-zero.');
    process.exit(1);
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
