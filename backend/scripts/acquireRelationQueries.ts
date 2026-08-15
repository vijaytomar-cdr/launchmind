/** Stage A for the relation probe's fixed query set. One batched acquisition. */
import { acquireQueryEmbeddings } from '../tests/evals/evalEmbeddingCache';
import { RELATION_QUERIES } from './fairRelationProbe';
(async () => {
  const r = await acquireQueryEmbeddings(RELATION_QUERIES, {});
  console.log(`acquired ${r.acquired ?? 0}, cached ${r.cached ?? 0}, total ${RELATION_QUERIES.length}`);
})();
