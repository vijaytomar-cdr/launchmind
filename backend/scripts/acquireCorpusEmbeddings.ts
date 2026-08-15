/**
 * @file acquireCorpusEmbeddings.ts
 * @description Stage A for the CORPUS side: acquire eval-corpus vectors once,
 *   into the shared JSONL cache, in a single batched provider request.
 *
 *   Pair with `eval:acquire-embeddings` (queries). Together they make a
 *   certification run cost ZERO provider calls, which is what makes it
 *   repeatable under a 3 req/min limit.
 *
 * @security Certification only; refuses a non-live provider and a contract mismatch.
 * @dependencies corpusEmbeddingCertification, memory-retrieval fixtures
 */
import { evalClient, seedCorpus, WORKSPACE_A, WORKSPACE_B } from '../tests/evals/memory-retrieval/fixtures';
import { acquireCorpusVectors, certifyCorpusCoverage } from '../tests/evals/corpusEmbeddingCertification';

(async () => {
  const db = evalClient();
  const ws = [WORKSPACE_A, WORKSPACE_B];

  if (process.argv.includes('--seed')) {
    console.log('seeding frozen fixture corpus…');
    await seedCorpus(db);
  }

  const before = await certifyCorpusCoverage(db, ws);
  console.log(`before: ${before.current}/${before.expected} current, missing=${before.missing.length} ` +
              `stale=${before.stale.length} mismatched=${before.mismatched.length} ` +
              `failed=${before.failedJobs} pending=${before.pendingJobs}`);

  const r = await acquireCorpusVectors(db, ws);
  console.log(`acquired: expected=${r.expected} fromCache=${r.fromCache} embedded=${r.embedded} ` +
              `providerRequests=${r.providerRequests} written=${r.written}`);

  const after = await certifyCorpusCoverage(db, ws);
  console.log(`after : ${after.current}/${after.expected} current, missing=${after.missing.length} ` +
              `stale=${after.stale.length} mismatched=${after.mismatched.length} ` +
              `failed=${after.failedJobs} pending=${after.pendingJobs}`);
  console.log(after.complete ? 'CORPUS_COVERAGE_COMPLETE' : 'CORPUS_SEMANTIC_COVERAGE_INCOMPLETE');
  process.exit(after.complete ? 0 : 2);
})();
