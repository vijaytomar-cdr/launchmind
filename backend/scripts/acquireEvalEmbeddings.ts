/**
 * @file acquireEvalEmbeddings.ts
 * @description STAGE A — acquires real Voyage vectors for every fixed evaluation
 *   query, once, and caches them — 3.2A Observation §3, §4, §5, §7.
 *
 *   Run this when the query text changes, the model changes, or the cache is
 *   empty. It is resumable: already-cached queries are skipped and each vector
 *   is persisted as it arrives, so an interrupted run continues where it stopped
 *   rather than starting over.
 *
 *   Every subsequent evaluation (Stage B) reads from the cache and makes ZERO
 *   provider calls, which is what turns an hour-long rate-limited measurement
 *   into a seconds-long one that can be repeated after every code fix.
 *
 * @security Real provider calls. Reads the API key through the normal provider
 *   resolution; never prints it.
 * @dependencies evalEmbeddingCache, the three fixed datasets
 */

import { acquireQueryEmbeddings, loadCache, cacheKey, CACHE_PATH } from '../tests/evals/evalEmbeddingCache';
import { OBSERVATION_CASES } from '../tests/fixtures/shadowObservationDataset';
import { DATASET } from '../tests/evals/memory-retrieval/dataset';
import { HELD_OUT } from '../tests/evals/memory-retrieval/heldout';

/** Every fixed query the evaluation suite will ever ask for. */
function allEvaluationQueries(): { label: string; queries: string[] }[] {
  return [
    { label: 'observation candidates (89)', queries: OBSERVATION_CASES.map(c => c.claimText) },
    { label: '3.1D benchmark (32)',          queries: DATASET.map(q => q.query) },
    { label: 'held-out benchmark (110)',     queries: HELD_OUT.map(q => q.query) },
  ];
}

async function main(): Promise<void> {
  const groups = allEvaluationQueries();
  const all = groups.flatMap(g => g.queries);

  console.log('\nSTAGE A — acquire real Voyage query embeddings\n');
  for (const g of groups) {
    console.log(`  ${g.label.padEnd(30)} ${g.queries.length} queries`);
  }

  const unique = [...new Set(all.map(q => q.trim().replace(/\s+/g, ' ')))].filter(Boolean);
  console.log(`  ${'unique across all datasets'.padEnd(30)} ${unique.length}\n`);

  const before = loadCache();
  console.log(`  cache: ${CACHE_PATH.replace(process.cwd(), '.')}`);
  console.log(`  entries already cached: ${before.size}\n`);

  const report = await acquireQueryEmbeddings(unique, {
    requestsPerMinute: Number(process.env.VOYAGE_REQUESTS_PER_MINUTE ?? 3),
    onProgress: (done, total) => {
      if (total) process.stdout.write(`    acquiring ${done}/${total}\n`);
    },
  });

  console.log(`\n  provider   : ${report.identity.provider}/${report.identity.model}/${report.identity.dimensions}d`);
  console.log(`  batch size : ${report.batchSize} texts per request`);
  console.log(`  unique     : ${report.uniqueQueries}`);
  console.log(`  cache hits : ${report.cacheHits}`);
  console.log(`  acquired   : ${report.acquired}`);
  console.log(`  requests   : ${report.providerRequests}`);
  console.log(`  elapsed    : ${(report.elapsedMs / 1000).toFixed(1)}s`);

  if (report.failures.length) {
    console.log(`\n  FAILURES (${report.failures.length}) — rerun to resume:`);
    for (const f of report.failures.slice(0, 5)) {
      console.log(`    ${JSON.stringify(f.query.slice(0, 60))} → ${f.reason.slice(0, 70)}`);
    }
  }

  // Coverage is verified against the cache on disk, not against the in-memory
  // result, so a partially-written run reports honestly.
  const after = loadCache();
  const covered = unique.filter(q => after.has(cacheKey(report.identity, q))).length;
  console.log(`\n  semantic coverage: ${covered}/${unique.length}`);
  if (covered < unique.length) {
    console.log('  INCOMPLETE — rerun to resume. Stage B will refuse to publish until this is X/X.\n');
    process.exit(1);
  }
  console.log('  COMPLETE — Stage B can now run offline with real Voyage vectors.\n');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
