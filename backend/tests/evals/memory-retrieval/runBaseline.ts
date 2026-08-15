/**
 * @file runBaseline.ts
 * @description Measures LaunchMind's CURRENT retrieval against the labelled
 *   dataset and writes docs/evals/memory-retrieval-baseline.md.
 *
 *   Runs the REAL production functions — marketingMemoryService.searchMemories and
 *   contextEngine.buildContextPackage — against a real Supabase/PostgREST/Postgres
 *   stack. It does not reimplement their queries. A harness that mirrored the SQL
 *   would measure the mirror, and PostgREST's translation of `.or(...ilike...)` is
 *   precisely the behaviour under test.
 *
 *   TWO ARMS are measured because LaunchMind has two distinct retrieval paths and
 *   only one of them is query-aware:
 *
 *     Arm A  searchMemories()      — lexical ILIKE, reachable via GET /memory/search
 *     Arm B  buildContextPackage() — what actually feeds the model on Ask/brief/
 *                                    recommendation paths, and which ignores the
 *                                    question entirely
 *
 *   Reporting only Arm A would flatter the system: the path owners actually hit is
 *   Arm B.
 *
 * @security Seeds and deletes ONLY its own fixture founders, and only on a local
 *   Supabase (fixtures.assertLocalTarget). Refuses to touch a hosted project.
 * @dependencies marketingMemoryService, contextEngine, fixtures, dataset, metrics
 *
 * Usage:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx tests/evals/memory-retrieval/runBaseline.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { searchMemories } from '../../../src/services/marketingMemoryService';
import { buildContextPackage } from '../../../src/lib/contextEngine';
import { retrieveMemories } from '../../../src/services/memory/retrievalService';
import { runBatchGrouped } from '../../../src/services/memory/embeddingPipeline';
import {
  MEMORIES, LEARNING_EVENTS, EVIDENCE, ID_TO_FIXTURE,
  FOUNDER_A, PRODUCT_A, WORKSPACE_A, evalClient, seedCorpus, clearCorpus,
} from './fixtures';
import { DATASET, CATEGORY_COUNTS } from './dataset';
import {
  scoreQuery, percentile, mean, type RetrievedItem, type QueryScore, type ClassifyContext,
} from './metrics';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const REPORT = join(ROOT, 'docs', 'evals', 'memory-retrieval-baseline.md');

const CTX_BASE: Omit<ClassifyContext, 'queryAgnostic'> = {
  titles:   Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.title])),
  statuses: Object.fromEntries(MEMORIES.map(m => [m.fixture_id, m.status])),
  reachable: Object.fromEntries([
    ...MEMORIES.map(m => [m.fixture_id, true]),
    ...LEARNING_EVENTS.map(e => [e.fixture_id, false]),
    ...EVIDENCE.map(e => [e.fixture_id, false]),
  ]),
};

/** Arm B returns titles only (MemoryEntry has no id), so titles must resolve back. */
const TITLE_TO_FIXTURE_A: Record<string, string> = Object.fromEntries(
  MEMORIES.filter(m => m.founder_id === FOUNDER_A).map(m => [m.title, m.fixture_id]),
);

interface ArmResult { name: string; scores: QueryScore[]; }

async function runArmA(): Promise<ArmResult> {
  const scores: QueryScore[] = [];
  for (const q of DATASET) {
    const t0 = performance.now();
    const rows = await searchMemories(FOUNDER_A, q.query, { productId: PRODUCT_A, limit: 10 });
    const latency = performance.now() - t0;
    const returned: RetrievedItem[] = rows.map(r => ({
      fixture_id: ID_TO_FIXTURE[(r as { id: string }).id] ?? null,
      title: (r as { title: string }).title,
    }));
    // searchMemories swallows the Postgres error and returns []. An empty result
    // is therefore evidence the filter never ran, not evidence of a ranking miss.
    scores.push(scoreQuery(q, returned, latency, {
      ...CTX_BASE,
      queryAgnostic: false,
      forcedFailure: returned.length === 0 ? 'query_error' : undefined,
    }));
  }
  return { name: 'Arm A — searchMemories (shipped implementation)', scores };
}

/**
 * Diagnostic arm: the title-only ILIKE that searchMemories was evidently meant to
 * perform, with the malformed `content.cs.{...}` disjunct omitted.
 *
 * This does NOT run in production and changes nothing. It exists so the report can
 * separate two very different statements — "lexical retrieval is weak" and
 * "lexical retrieval is broken" — which Arm A alone conflates into a single 0%.
 * Without it, 3.1D could claim credit for fixing a bug and call it semantic uplift.
 */
async function runArmADiagnostic(db = evalClient()): Promise<ArmResult> {
  const scores: QueryScore[] = [];
  for (const q of DATASET) {
    const t0 = performance.now();
    const { data } = await db
      .from('marketing_memories')
      .select('id, title')
      .eq('founder_id', FOUNDER_A)
      .eq('status', 'active')
      .ilike('title', `%${q.query}%`)
      .order('confidence', { ascending: false })
      .limit(10);
    const latency = performance.now() - t0;
    const returned: RetrievedItem[] = (data ?? []).map(r => ({
      fixture_id: ID_TO_FIXTURE[(r as { id: string }).id] ?? null,
      title: (r as { title: string }).title,
    }));
    scores.push(scoreQuery(q, returned, latency, { ...CTX_BASE, queryAgnostic: false }));
  }
  return { name: "Arm A′ — title-only ILIKE (diagnostic: searchMemories with the malformed clause removed)", scores };
}

/**
 * Arm H — the Phase 3.1D hybrid RetrievalService.
 *
 * Uses the SAME 32 labelled queries and the SAME fixture ids as every other arm.
 * No label was changed to accommodate it (Step 3.1D §14); if hybrid misses a
 * required record, that is recorded as a miss.
 */
const endToEnd: number[] = [];

async function runArmHybrid(): Promise<ArmResult> {
  const scores: QueryScore[] = [];
  for (const q of DATASET) {
    const t0 = performance.now();
    const res = await retrieveMemories({
      workspaceId: WORKSPACE_A,
      productId: PRODUCT_A,
      query: q.query,
      limit: 10,
    });
    endToEnd.push(performance.now() - t0);
    // Scored on RETRIEVAL latency, excluding query embedding. The provider call
    // on this account is paced to 3 req/min, so including it would measure a
    // free-tier rate limit rather than the system under test. The end-to-end
    // figure is reported separately and honestly alongside it.
    const latency = res.timings.totalMs - res.timings.queryEmbeddingMs;
    const returned: RetrievedItem[] = res.results.map(r => ({
      fixture_id: ID_TO_FIXTURE[r.id] ?? null,
      title: r.title,
    }));
    scores.push(scoreQuery(q, returned, latency, { ...CTX_BASE, queryAgnostic: false }));
  }
  return { name: 'Arm H — hybrid RetrievalService (structured + full-text + exact vector, RRF)', scores };
}

/** Embeds the fixture corpus through the real pipeline before Arm H runs. */
async function embedCorpus(db = evalClient()): Promise<{ embedded: number; requests: number }> {
  await db.from('embedding_contract').update({
    provider: process.env.EMBEDDING_PROVIDER ?? 'voyage',
    model: process.env.EMBEDDING_MODEL ?? 'voyage-4',
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 1024),
    generation_enabled: true,
  }).eq('id', 1);

  let requests = 0;
  for (let i = 0; i < 6; i++) {
    const out = await runBatchGrouped(`eval-${i}`, 30);
    if (!out.length) break;
    requests++;
  }
  const { data } = await db.from('memory_embeddings').select('id').eq('status', 'current');
  return { embedded: data?.length ?? 0, requests };
}

async function runArmB(): Promise<ArmResult> {
  const scores: QueryScore[] = [];
  for (const q of DATASET) {
    const t0 = performance.now();
    const ctx = await buildContextPackage(FOUNDER_A, PRODUCT_A, { maxMemories: 5 });
    const latency = performance.now() - t0;
    const returned: RetrievedItem[] = ctx.memories.map(m => ({
      fixture_id: TITLE_TO_FIXTURE_A[m.title] ?? null,
      title: m.title,
    }));
    scores.push(scoreQuery(q, returned, latency, { ...CTX_BASE, queryAgnostic: true }));
  }
  return { name: 'Arm B — buildContextPackage (query-agnostic top-N by confidence)', scores };
}

function summarize(scores: QueryScore[]) {
  const lat = scores.map(s => s.latencyMs);
  return {
    queries:        scores.length,
    recallAt1:      mean(scores.map(s => s.recallAt1)),
    recallAt3:      mean(scores.map(s => s.recallAt3)),
    recallAt5:      mean(scores.map(s => s.recallAt5)),
    mrr:            mean(scores.map(s => s.reciprocalRank)),
    hitAt5:         scores.filter(s => s.recallAt5 > 0).length / scores.length,
    perfect:        scores.filter(s => s.recallAt5 === 1 && s.leakage === 0).length,
    noResultRate:   scores.filter(s => s.returned === 0).length / scores.length,
    irrelevantRate: mean(scores.map(s => s.irrelevantRate)),
    leakage:        scores.reduce((a, s) => a + s.leakage, 0),
    latAvg:         mean(lat),
    latP50:         percentile(lat, 50),
    latP95:         percentile(lat, 95),
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ms  = (n: number) => `${n.toFixed(1)} ms`;

function failureTable(scores: QueryScore[]): string {
  const counts: Record<string, number> = {};
  for (const s of scores) if (s.failure) counts[s.failure] = (counts[s.failure] ?? 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return '_No failures._\n';
  return ['| Failure category | Queries |', '|---|---|',
    ...rows.map(([k, v]) => `| \`${k}\` | ${v} |`)].join('\n') + '\n';
}

function armSection(arm: ArmResult): string {
  const s = summarize(arm.scores);
  return `
### ${arm.name}

| Metric | Value |
|---|---|
| Queries | ${s.queries} |
| Recall@1 | ${pct(s.recallAt1)} |
| Recall@3 | ${pct(s.recallAt3)} |
| Recall@5 | ${pct(s.recallAt5)} |
| MRR | ${s.mrr.toFixed(3)} |
| Hit@5 (≥1 required in top 5) | ${pct(s.hitAt5)} |
| Fully-correct queries | ${s.perfect} / ${s.queries} |
| No-result rate | ${pct(s.noResultRate)} |
| Irrelevant-result rate | ${pct(s.irrelevantRate)} |
| **Cross-workspace leakage** | **${s.leakage}** |
| Latency avg | ${ms(s.latAvg)} |
| Latency p50 | ${ms(s.latP50)} |
| Latency p95 | ${ms(s.latP95)} |

${failureTable(arm.scores)}
<details><summary>Per-query results</summary>

| Query | Category | Predicted | R@5 | RR | Failure | Missing |
|---|---|---|---|---|---|---|
${arm.scores.map(x => `| \`${x.id}\` | ${x.category} | ${x.expected_baseline} | ${pct(x.recallAt5)} | ${x.reciprocalRank.toFixed(2)} | ${x.failure ?? '—'} | ${x.missing.join(', ') || '—'} |`).join('\n')}

</details>
`;
}

function predictionAccuracy(scores: QueryScore[]): string {
  let right = 0;
  for (const s of scores) {
    const actual = s.recallAt5 === 1 ? 'hit' : s.recallAt5 === 0 ? 'miss' : 'partial';
    if (actual === s.expected_baseline) right++;
  }
  return `${right}/${scores.length}`;
}

async function main(): Promise<void> {
  const db = evalClient();               // throws unless the target is local
  console.log('Seeding corpus…');
  await seedCorpus(db);

  try {
    console.log('Arm A — searchMemories…');
    const armA = await runArmA();
    console.log("Arm A′ — title-only ILIKE (diagnostic)…");
    const armAd = await runArmADiagnostic(db);
    console.log('Arm B — buildContextPackage…');
    const armB = await runArmB();

    console.log('Embedding fixture corpus through the real pipeline…');
    const emb = await embedCorpus(db);
    console.log(`  ${emb.embedded} current embeddings in ${emb.requests} batched request(s)`);

    console.log('Arm H — hybrid RetrievalService…');
    const armH = await runArmHybrid();

    const a  = summarize(armA.scores);
    const ad = summarize(armAd.scores);
    const b  = summarize(armB.scores);
    const h  = summarize(armH.scores);

    const md = `# Memory retrieval — lexical baseline

> Generated by \`backend/tests/evals/memory-retrieval/runBaseline.ts\`.
> Regenerate with \`npm run eval:retrieval\` (backend, local Supabase required).
> **Do not hand-edit the metric tables** — they are overwritten on every run.

This is the pre-semantic baseline for Phase 3.1, recorded before any embedding or
hybrid retrieval exists. ADR-066 requires 3.1D to be compared against these exact
numbers using this exact dataset.

## Corpus

| | |
|---|---|
| Marketing memories | ${MEMORIES.length} (${MEMORIES.filter(m => m.founder_id === FOUNDER_A).length} in the tenant under test, ${MEMORIES.length - MEMORIES.filter(m => m.founder_id === FOUNDER_A).length} cross-tenant canaries) |
| Learning events | ${LEARNING_EVENTS.length} |
| Evidence rows | ${EVIDENCE.length} |
| Labelled queries | ${DATASET.length} |
| Categories | ${Object.entries(CATEGORY_COUNTS).map(([k, v]) => `${k} (${v})`).join(', ')} |

Labels name canonical \`fixture_id\`s, never generated prose, so the same dataset
scores a lexical and a hybrid retriever on identical terms.

## DEFECT FOUND — \`searchMemories\` returns zero rows for every query

Measuring the baseline surfaced a live defect rather than a weak score.

\`searchMemories\` builds its filter as:

\`\`\`ts
.or(\`title.ilike.%\${query}%,content.cs.{"\${query}"}\`)
\`\`\`

\`content.cs.{"…"}\` is PostgREST **array-literal** syntax applied to a \`jsonb\`
column. \`{"messaging"}\` is not valid JSON, so Postgres rejects the entire
disjunction — including the \`title.ilike\` half, which works perfectly on its own:

\`\`\`
or()    "messaging" -> rows=0  err=invalid input syntax for type json
ilike   "messaging" -> rows=2
service "messaging" -> rows=0
\`\`\`

The service catches the error, reports it to Sentry, and \`return []\`. The caller
receives a normal empty array, indistinguishable from "nothing matched". So
\`GET /memory/search\` has been answering **every** query with zero results, and
the failure is invisible at the API boundary.

Arm A below therefore measures the defect, not the algorithm. Arm A′ measures what
the intended lexical retrieval scores once the malformed disjunct is removed.
Both are reported so that a later hybrid retriever cannot bank a bug-fix as
semantic improvement.

Not fixed here: Step 3.1A is measurement and architecture only, and changing
retrieval would invalidate the baseline it exists to record. Scheduled in the gap
analysis (rule 16, step 3.1D).

## Results
${armSection(armA)}
${armSection(armAd)}
${armSection(armB)}
${armSection(armH)}

### Category breakdown — Arm A′ (lexical ceiling) vs Arm H (hybrid)

| Category | Queries | A′ Recall@5 | H Recall@5 | A′ MRR | H MRR |
|---|---|---|---|---|---|
${[...new Set(DATASET.map(q => q.category))].map(cat => {
  const pick = (ss: QueryScore[]) => ss.filter(s => s.category === cat);
  const A = pick(armAd.scores), H = pick(armH.scores);
  return `| ${cat} | ${A.length} | ${pct(mean(A.map(s => s.recallAt5)))} | ${pct(mean(H.map(s => s.recallAt5)))} | ${mean(A.map(s => s.reciprocalRank)).toFixed(3)} | ${mean(H.map(s => s.reciprocalRank)).toFixed(3)} |`;
}).join('\n')}

### Acceptance targets (Step 3.1D §15)

| Target | Required | Measured | |
|---|---|---|---|
| Recall@5 | ≥ 65% | ${pct(h.recallAt5)} | ${h.recallAt5 >= 0.65 ? '**PASS**' : '**FAIL**'} |
| MRR | ≥ 0.45 | ${h.mrr.toFixed(3)} | ${h.mrr >= 0.45 ? '**PASS**' : '**FAIL**'} |
| Paraphrase Recall@5 | ≥ 70% | ${pct(mean(armH.scores.filter(s => s.category === 'paraphrase').map(s => s.recallAt5)))} | ${mean(armH.scores.filter(s => s.category === 'paraphrase').map(s => s.recallAt5)) >= 0.70 ? '**PASS**' : '**FAIL**'} |
| Cross-workspace leakage | 0 | ${h.leakage} | ${h.leakage === 0 ? '**PASS**' : '**FAIL**'} |
| p95 retrieval (excl. query embedding) | < 200 ms | ${ms(h.latP95)} | ${h.latP95 < 200 ? '**PASS**' : '**FAIL**'} |
| p95 end-to-end (incl. provider call + free-tier pacing) | — | ${ms(percentile(endToEnd, 95))} | context |
| No regression vs A′ | R@5 ≥ ${pct(ad.recallAt5)} | ${pct(h.recallAt5)} | ${h.recallAt5 >= ad.recallAt5 ? '**PASS**' : '**FAIL**'} |

## Reading these numbers

**Arm A** is the only query-aware retrieval LaunchMind has, and it currently
returns nothing at all — see the defect above. Recall@5 ${pct(a.recallAt5)},
no-result rate ${pct(a.noResultRate)}.

**Arm A′** shows the honest lexical ceiling: ${pct(ad.recallAt5)} Recall@5,
MRR ${ad.mrr.toFixed(3)}. It matches a single \`ILIKE '%<entire query>%'\` against
\`title\`, so a natural-language question is tested as one literal phrase.
\`retrieval_002\` ("messaging") succeeds; \`retrieval_001\` ("What positioning has
historically worked best?") cannot, because no title contains that sentence. This
is a property of substring matching, not a tuning problem — which is the argument
for full-text search plus embeddings in 3.1D.

**Arm B** is what actually reaches the model on the Ask, Morning Brief and
recommendation paths. \`buildContextPackage(founderId, productId, opts)\` takes no
query parameter at all — it returns the top \`maxMemories\` rows ordered by
\`confidence\`, identically for every question asked. Its scores are therefore a
property of the corpus, not of the question: whichever memories happen to hold the
highest confidence are returned to all ${b.queries} queries. Every failure is
classified \`no_targeted_retrieval\`, which is the accurate diagnosis.

Pre-run predictions were recorded in the dataset. Arm A matched
${predictionAccuracy(armA.scores)} of them.

### Metrics that could not be measured cleanly

| Metric | Why not |
|---|---|
| Semantic recall | No embeddings exist; nothing to measure. |
| ANN index latency | No HNSW/IVFFlat index exists (ADR-066 rule 13 defers this deliberately). |
| Provenance precision | \`MemoryEntry\` carries \`memory_type, title, confidence, content\` and **no record id or version**, so Arm B results can only be matched back by title. Titles are unique inside this corpus, but that is a property of the fixture set, not a guarantee the schema provides. |
| Arm B cross-tenant leakage | Structurally zero: the query filters \`founder_id\` server-side. Recorded as 0 measured, not 0 proven — the adversarial proof belongs in the 3.1G suite against a live RLS session. |

## Headline

| | Arm A (searchMemories) | Arm A′ (old lexical ceiling) | Arm B (context engine) | **Arm H (hybrid)** |
|---|---|---|---|---|
| Recall@1 | ${pct(a.recallAt1)} | ${pct(ad.recallAt1)} | ${pct(b.recallAt1)} | **${pct(h.recallAt1)}** |
| Recall@3 | ${pct(a.recallAt3)} | ${pct(ad.recallAt3)} | ${pct(b.recallAt3)} | **${pct(h.recallAt3)}** |
| Recall@5 | ${pct(a.recallAt5)} | ${pct(ad.recallAt5)} | ${pct(b.recallAt5)} | **${pct(h.recallAt5)}** |
| MRR | ${a.mrr.toFixed(3)} | ${ad.mrr.toFixed(3)} | ${b.mrr.toFixed(3)} | **${h.mrr.toFixed(3)}** |
| No-result rate | ${pct(a.noResultRate)} | ${pct(ad.noResultRate)} | ${pct(b.noResultRate)} | **${pct(h.noResultRate)}** |
| Irrelevant-result rate | ${pct(a.irrelevantRate)} | ${pct(ad.irrelevantRate)} | ${pct(b.irrelevantRate)} | **${pct(h.irrelevantRate)}** |
| Leakage | ${a.leakage} | ${ad.leakage} | ${b.leakage} | **${h.leakage}** |
| p50 latency | ${ms(a.latP50)} | ${ms(ad.latP50)} | ${ms(b.latP50)} | **${ms(h.latP50)}** |
| p95 latency | ${ms(a.latP95)} | ${ms(ad.latP95)} | ${ms(b.latP95)} | **${ms(h.latP95)}** |

Arm A was **0.0% / MRR 0.000 / 100% no-result** when 3.1A measured it, because of
the malformed \`content.cs.{…}\` filter. Migration 094 and the \`searchMemories\` fix
replaced that with full-text; the column above is its value NOW. Arm A′ remains
the honest ceiling of the OLD lexical approach and is the comparison 3.1D must
beat, so that a bug-fix cannot be banked as semantic uplift.

_Generated ${new Date().toISOString()} against a local Supabase stack._
`;

    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, md);
    console.log(`\nWrote ${REPORT}`);
    console.log(`Arm A Recall@5 ${pct(a.recallAt5)} | MRR ${a.mrr.toFixed(3)} | leakage ${a.leakage}`);
    console.log(`Arm B Recall@5 ${pct(b.recallAt5)} | MRR ${b.mrr.toFixed(3)} | leakage ${b.leakage}`);
  } finally {
    console.log('Clearing corpus…');
    await clearCorpus(db);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
