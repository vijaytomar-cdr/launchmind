/** Stage A for the qualitative corpus query set — one batched acquisition. */
import { acquireQueryEmbeddings } from '../tests/evals/evalEmbeddingCache';
import { QUALITATIVE_QUERIES } from './qualitativeEvaluation';
(async () => {
  const r = await acquireQueryEmbeddings(QUALITATIVE_QUERIES, {});
  console.log(`acquired ${r.acquired ?? 0}, total ${QUALITATIVE_QUERIES.length}`);
})();
