/**
 * @file fairRelationProbe.ts
 * @description The FAIR comparator probe — run only after corpus coverage is certified.
 *
 *   The previous probe scored 0/8 and that number meant nothing: incumbents were
 *   inserted in the same run, their vectors were still queued, and 7 of 8
 *   retrieved nothing. This version follows the required order:
 *
 *     1. dedicated certification workspace
 *     2. seed governed incumbents
 *     3. acquire vectors (cache-first, batched)
 *     4. assert 100% corpus coverage against the active contract
 *     5. PROVE each incumbent is semantically retrievable by a known query
 *     6. only then submit challengers
 *
 *   If step 4 or 5 fails the probe refuses to report comparison numbers.
 *
 * @security Disposable certification workspace under a lab founder. No owner data.
 * @dependencies corpusEmbeddingCertification, marketingMemoryEngine, retrievalService
 */

import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { processCandidate, type MemoryCandidate } from '../src/services/memory/marketingMemoryEngine';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';
import { retrieveMemories } from '../src/services/memory/retrievalService';
import { acquireCorpusVectors, certifyCorpusCoverage, assertCorpusCoverage, readActiveContract } from '../tests/evals/corpusEmbeddingCertification';
import { primeFromCache, assertSemanticCoverage } from '../tests/evals/evalEmbeddingCache';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const FOUNDER   = uuidFrom('relprobe-founder');
const WORKSPACE = uuidFrom('relprobe-workspace');
const PRODUCT   = uuidFrom('relprobe-product');
const db = () => getSupabaseAdmin();

type Rel = 'DUPLICATE' | 'REINFORCEMENT' | 'CONTRADICTION' | 'UNRELATED' | 'SCOPED_EXCEPTION'
  | 'DIFFERENT_SEGMENT' | 'DIFFERENT_CHANNEL' | 'DIFFERENT_TIMEFRAME' | 'PARAPHRASE' | 'AMBIGUOUS_MODEL_DEFERRAL';

interface Pair {
  id: string;
  relation: Rel;
  incumbent: string;
  incumbentScope: Record<string, string>;
  challenger: string;
  challengerScope: Record<string, string>;
  /** The query that must retrieve the incumbent before the probe may proceed. */
  probeQuery: string;
}

/**
 * FROZEN relation set. Wording is deliberate: the CONTRADICTION and
 * AMBIGUOUS cases reuse the adversarial predicate shape from the B1 defect
 * ("fatigues above X" vs "performs better above X"), where both sides share a
 * direction word and only the verb disagrees.
 */
const PAIRS: Pair[] = [
  { id: 'r01', relation: 'DUPLICATE',
    incumbent: 'Paid search delivers our lowest cost per install in the United States',
    challenger: 'Paid search delivers our lowest cost per install in the United States',
    incumbentScope: { channel: 'search', geography: 'usa' }, challengerScope: { channel: 'search', geography: 'usa' },
    probeQuery: 'which channel has the lowest cost per install' },

  { id: 'r02', relation: 'REINFORCEMENT',
    incumbent: 'Email re-engagement recovers lapsed subscribers more cheaply than paid retargeting',
    challenger: 'Email re-engagement recovers lapsed subscribers more cheaply than paid retargeting, especially after 30 days',
    incumbentScope: { channel: 'email' }, challengerScope: { channel: 'email' },
    probeQuery: 'how do we win back lapsed subscribers' },

  { id: 'r03', relation: 'CONTRADICTION',
    incumbent: 'Meta creative fatigues above frequency 3',
    challenger: 'Meta creative performs better above frequency 3',
    incumbentScope: { channel: 'meta' }, challengerScope: { channel: 'meta' },
    probeQuery: 'what happens to Meta creative at high frequency' },

  { id: 'r04', relation: 'UNRELATED',
    incumbent: 'Onboarding completion improves when the first screen asks for one thing',
    challenger: 'Wholesale pricing enquiries arrive mostly through the contact form',
    incumbentScope: { funnel_stage: 'activation' }, challengerScope: { channel: 'website' },
    probeQuery: 'what improves onboarding completion' },

  { id: 'r05', relation: 'SCOPED_EXCEPTION',
    incumbent: 'Discount codes increase first purchase conversion',
    challenger: 'Discount codes reduce first purchase conversion for enterprise buyers',
    incumbentScope: { funnel_stage: 'purchase' },
    challengerScope: { funnel_stage: 'purchase', audience_segment: 'enterprise' },
    probeQuery: 'do discount codes help first purchase conversion' },

  { id: 'r06', relation: 'DIFFERENT_SEGMENT',
    incumbent: 'Weekend campaigns outperform weekday campaigns for consumers',
    challenger: 'Weekend campaigns outperform weekday campaigns for small business buyers',
    incumbentScope: { audience_segment: 'consumer' }, challengerScope: { audience_segment: 'smb' },
    probeQuery: 'do weekend campaigns outperform weekday campaigns' },

  { id: 'r07', relation: 'DIFFERENT_CHANNEL',
    incumbent: 'Short video creative outperforms static creative on Meta',
    challenger: 'Short video creative outperforms static creative on LinkedIn',
    incumbentScope: { channel: 'meta' }, challengerScope: { channel: 'linkedin' },
    probeQuery: 'does short video beat static creative' },

  { id: 'r08', relation: 'DIFFERENT_TIMEFRAME',
    incumbent: 'Referral signups peak during the summer months',
    challenger: 'Referral signups peak during the winter holiday period',
    incumbentScope: { timeframe: 'summer' }, challengerScope: { timeframe: 'winter' },
    probeQuery: 'when do referral signups peak' },

  { id: 'r09', relation: 'PARAPHRASE',
    incumbent: 'Customers who complete the guided tour retain longer than those who skip it',
    challenger: 'Retention is higher among users who finish the guided walkthrough than among those who bypass it',
    incumbentScope: { funnel_stage: 'retention' }, challengerScope: { funnel_stage: 'retention' },
    probeQuery: 'does the guided tour affect retention' },

  { id: 'r10', relation: 'AMBIGUOUS_MODEL_DEFERRAL',
    incumbent: 'Push notifications sent before 9am produce higher open rates',
    challenger: 'Push notifications sent before 9am produce higher unsubscribe rates',
    incumbentScope: { channel: 'push' }, challengerScope: { channel: 'push' },
    probeQuery: 'what is the effect of early morning push notifications' },
];

/** Exported so Stage A can acquire exactly these vectors, once. */
export const RELATION_QUERIES: string[] =
  PAIRS.map(p => p.probeQuery).concat(PAIRS.map(p => p.challenger));

async function seedLab() {
  await db().from('founders').upsert({ id: FOUNDER, email: 'relprobe@validation.launchmind.invalid', name: 'RELATION PROBE LAB', plan: 'studio' }, { onConflict: 'id' });
  await db().from('workspaces').upsert({ id: WORKSPACE, founder_id: FOUNDER, name: 'Relation Probe Lab' }, { onConflict: 'id' });
  await db().from('products').upsert({ id: PRODUCT, founder_id: FOUNDER, workspace_id: WORKSPACE, name: 'RelProbe', store_url: 'https://example.invalid', platform: 'app_store', markets: ['usa'] }, { onConflict: 'id' });

  const rows = PAIRS.map(p => {
    const norm = normalizeMemoryScope(p.incumbentScope);
    return {
      id: uuidFrom(`relprobe-incumbent-${p.id}`),
      founder_id: FOUNDER, product_id: PRODUCT, workspace_id: WORKSPACE,
      memory_type: 'product', title: p.incumbent.slice(0, 120), content: { claim: p.incumbent },
      source: 'growth_brain', confidence: 0.5, status: 'active', version: 1, evidence_ids: [],
      memory_class: 'LEARNING', authority_tier: 'OBSERVED_FIRST_PARTY', authority_policy_version: 1,
      scope: norm.scope, scope_key: norm.scopeKey,
      scope_specificity: norm.specificity, scope_completeness: norm.completeness,
    };
  });
  const { data: have } = await db().from('marketing_memories').select('id').in('id', rows.map(r => r.id));
  const seen = new Set(((have ?? []) as { id: string }[]).map(r => r.id));
  const missing = rows.filter(r => !seen.has(r.id));
  if (missing.length) {
    const { error } = await db().from('marketing_memories').insert(missing);
    if (error) throw new Error(`incumbent seed failed: ${error.message}`);
  }
  console.log(`incumbents: ${seen.size} existing, ${missing.length} inserted`);
  return new Map(PAIRS.map(p => [p.id, uuidFrom(`relprobe-incumbent-${p.id}`)]));
}

async function main() {
  console.log('MODE =', process.env.CONTINUOUS_LEARNING_INGESTION_MODE ?? '(default → shadow)');
  const incumbentIds = await seedLab();

  // ── Steps 3–4: acquire + ASSERT coverage ────────────────────────────────
  const acq = await acquireCorpusVectors(db() as never, [WORKSPACE]);
  console.log(`vectors: ${acq.fromCache} cached + ${acq.embedded} embedded (${acq.providerRequests} request(s))`);
  const cov = await certifyCorpusCoverage(db() as never, [WORKSPACE]);
  assertCorpusCoverage(cov);
  console.log(`CORPUS_COVERAGE certified ${cov.current}/${cov.expected}`);

  // A1 — QUERY COVERAGE. The previous run certified the corpus and then ran
  // LEXICAL_ONLY because the query vectors were never primed: the mirror image
  // of the original defect. Both coverages are required, exactly as runHeldOut
  // requires them.
  const probeQueries = PAIRS.map(p => p.probeQuery).concat(PAIRS.map(p => p.challenger));
  const contract = await readActiveContract(db() as never);
  const primed = primeFromCache(probeQueries, {
    provider: contract.provider, model: contract.model,
    dimensions: contract.dimensions, version: contract.embedding_version,
  });
  if (primed.primed < primed.requested) {
    console.error(`QUERY_SEMANTIC_COVERAGE_INCOMPLETE — ${primed.primed}/${primed.requested} query vectors. ` +
                  `Run \`npm run eval:acquire-relation-queries\` first.`);
    process.exit(2);
  }
  assertSemanticCoverage(primed);
  console.log(`QUERY_COVERAGE certified ${primed.primed}/${primed.requested}`);

  // ── Step 5: prove each incumbent is actually retrievable ────────────────
  console.log('\n--- semantic reachability (must be 10/10 before comparison) ---');
  let reachable = 0;
  for (const p of PAIRS) {
    const res = await retrieveMemories({ workspaceId: WORKSPACE, productId: PRODUCT, query: p.probeQuery, limit: 10 });
    const rank = res.results.findIndex(r => r.id === incumbentIds.get(p.id)!) + 1;
    // A certified fair probe may not accept a degraded search.
    if (rank > 0 && !res.degraded) reachable++;
    console.log(`  ${p.id} ${String(p.relation).padEnd(24)} rank=${rank || 'NOT FOUND'} mode=${res.mode} degraded=${res.degraded}`);
  }
  if (reachable < PAIRS.length) {
    console.log(`\nREFUSING to report comparison: only ${reachable}/${PAIRS.length} incumbents retrievable.`);
    process.exit(2);
  }

  // ── Step 6: challengers ─────────────────────────────────────────────────
  console.log('\n--- comparison ---');
  let deterministic = 0, modelAssisted = 0, totalModelCalls = 0, maxModelCalls = 0;
  const results: Array<{ p: Pair; outcome: string; belief: string; review: boolean; related: number; model: number; scopeRel: string }> = [];
  for (const p of PAIRS) {
    const c: MemoryCandidate = {
      workspaceId: WORKSPACE, productId: PRODUCT,
      claimText: p.challenger, memoryClass: 'LEARNING', source: 'growth_brain',
      scope: p.challengerScope,
      provenance: { kind: 'connection_insight', sourceId: `relprobe:${p.id}` },
      actorType: 'system',
      evidenceIds: [uuidFrom(`relprobe-ev-${p.id}`)],
      evidenceIndependenceKeys: [`relprobe:${p.id}`],
      sampleSize: 500, claimIsRuleGenerated: true, domainRef: null,
    };
    const res = await processCandidate(c, { allowModel: true });
    totalModelCalls += res.modelCalls;
    maxModelCalls = Math.max(maxModelCalls, res.modelCalls);
    if (res.modelCalls > 0) modelAssisted++; else deterministic++;
    results.push({
      p, outcome: res.promotion?.outcome ?? 'NO_DECISION',
      belief: res.promotion?.beliefAction ?? 'none',
      review: Boolean(res.promotion?.requiresFounderReview),
      related: res.relatedRetrieved, model: res.modelCalls,
      scopeRel: String(res.promotion?.scopeRelation ?? '-'),
    });
    console.log(`  ${p.id} ${String(p.relation).padEnd(24)} outcome=${String(res.promotion?.outcome ?? 'NO_DECISION').padEnd(22)} ` +
                `belief=${String(res.promotion?.beliefAction ?? 'none').padEnd(10)} scope=${String(res.promotion?.scopeRelation ?? '-').padEnd(14)} ` +
                `review=${res.promotion?.requiresFounderReview} related=${res.relatedRetrieved} model=${res.modelCalls} ` +
                `gateA=${res.eligibility.result}/${res.eligibility.reason}`);
  }

  // ── Scoring against the frozen expectations ─────────────────────────────
  const expected: Record<Rel, (r: typeof results[number]) => boolean> = {
    DUPLICATE:                r => r.outcome === 'DUPLICATE' || r.belief === 'reinforce',
    REINFORCEMENT:            r => r.belief === 'reinforce',
    CONTRADICTION:            r => r.belief === 'challenge' || r.review,
    UNRELATED:                r => r.outcome === 'CREATE_NEW' && r.belief === 'none',
    SCOPED_EXCEPTION:         r => r.outcome === 'CREATE_SCOPED_EXCEPTION' || r.scopeRel === 'NARROWER',
    DIFFERENT_SEGMENT:        r => r.outcome === 'CREATE_NEW' || r.scopeRel === 'DISJOINT',
    DIFFERENT_CHANNEL:        r => r.outcome === 'CREATE_NEW' || r.scopeRel === 'DISJOINT',
    DIFFERENT_TIMEFRAME:      r => r.outcome === 'CREATE_NEW' || r.scopeRel === 'DISJOINT',
    PARAPHRASE:               r => r.belief === 'reinforce' || r.outcome === 'DUPLICATE',
    // A2 — DEFERRAL MUST BE DEFERRAL. The old criterion accepted `model > 0`,
    // which passed while the engine actually returned CREATE_NEW with no review.
    // A safe ambiguous outcome is one that does NOT mint a durable memory:
    // evidence-only, or a challenge that a founder must resolve.
    AMBIGUOUS_MODEL_DEFERRAL: r =>
      r.outcome === 'KEEP_AS_EVIDENCE_ONLY' || r.review === true || r.belief === 'challenge',
  };
  let correct = 0;
  const wrong: string[] = [];
  for (const r of results) {
    if (expected[r.p.relation](r)) correct++; else wrong.push(`${r.p.id}/${r.p.relation}→${r.outcome}/${r.belief}`);
  }

  const falseReinforce = results.filter(r =>
    r.belief === 'reinforce' && ['CONTRADICTION', 'UNRELATED', 'DIFFERENT_SEGMENT', 'DIFFERENT_CHANNEL', 'DIFFERENT_TIMEFRAME'].includes(r.p.relation)).length;
  const falseContradict = results.filter(r =>
    r.belief === 'challenge' && ['DUPLICATE', 'REINFORCEMENT', 'PARAPHRASE'].includes(r.p.relation)).length;
  const falseUnrelated = results.filter(r =>
    r.outcome === 'CREATE_NEW' && r.belief === 'none' &&
    ['DUPLICATE', 'REINFORCEMENT', 'CONTRADICTION', 'PARAPHRASE', 'SCOPED_EXCEPTION'].includes(r.p.relation)).length;
  const scoped = results.filter(r => r.p.relation === 'SCOPED_EXCEPTION');
  const scopedOk = scoped.filter(r => expected.SCOPED_EXCEPTION(r)).length;

  console.log('\n================ SUMMARY ================');
  console.log(`  accuracy               ${correct}/${results.length}`);
  console.log(`  deterministic          ${deterministic}`);
  console.log(`  model-assisted         ${modelAssisted}`);
  console.log(`  model calls total/max  ${totalModelCalls}/${maxModelCalls}`);
  console.log(`  FALSE reinforcement    ${falseReinforce}`);
  console.log(`  FALSE contradiction    ${falseContradict}`);
  console.log(`  FALSE unrelated        ${falseUnrelated}`);
  console.log(`  deferred (review)      ${results.filter(r => r.review).length}`);
  console.log(`  scoped-exception acc.  ${scopedOk}/${scoped.length}`);
  if (wrong.length) console.log(`  misses: ${wrong.join(' | ')}`);
}

// Guarded: Stage A imports RELATION_QUERIES from this module, and an unguarded
// main() would run the whole probe as an import side effect.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message ?? e); process.exit(1); });
}
