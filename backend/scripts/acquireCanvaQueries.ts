/** Stage A for the Canva relation query set — one batched acquisition. */
import { acquireQueryEmbeddings } from '../tests/evals/evalEmbeddingCache';
import { CANVA_RELATION_QUERIES } from './canvaLocalCertification';
import { CANVA_CORPUS } from '../tests/fixtures/multiProduct/canvaCorpus';
(async () => {
  // Every candidate claim is also a retrieval query during the 85-event shadow
  // run. Without these the run degrades and its Gate B distribution is not
  // admissible for adjudication.
  const all = [...new Set([...CANVA_RELATION_QUERIES, ...CANVA_CORPUS.map(e => e.claim)])];
  const r = await acquireQueryEmbeddings(all, {});
  console.log(`acquired ${r.acquired ?? 0}, cached ${r.cached ?? 0}, total ${all.length}`);
})();
