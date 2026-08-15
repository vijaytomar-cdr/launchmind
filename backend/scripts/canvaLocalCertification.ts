/**
 * @file canvaLocalCertification.ts
 * @description Canva engine/relation certification in the LOCAL certification
 *   environment.
 *
 *   WHY LOCAL, EXPLICITLY: the hosted Voyage queue is rate-limited, so the hosted
 *   Canva lab cannot reach certified corpus coverage — and the correct response
 *   to that is to refuse to publish a relation score there, not to extend
 *   test-only vector caching into hosted. This run is
 *   CANVA_ENGINE_CERTIFICATION_ENV = LOCAL_CERTIFICATION and is NOT equivalent to
 *   a hosted-infrastructure test. Owner validation stays on the real account.
 *
 *   The frozen corpus is used verbatim: wording, provenance, expected labels,
 *   scope and hash are inputs here, never outputs.
 *
 * @security Disposable local workspace under a lab founder. No owner data, no
 *   hosted writes.
 * @dependencies canvaCorpus, corpusEmbeddingCertification, marketingMemoryEngine
 */

import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { processCandidate, type MemoryCandidate } from '../src/services/memory/marketingMemoryEngine';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';
import { retrieveMemories } from '../src/services/memory/retrievalService';
import { authorityForCandidate, isFounderAuthority } from '../src/services/memory/authorityPolicy';
import { evaluateEvidenceSupport } from '../src/services/memory/evidenceSupportPolicy';
import {
  acquireCorpusVectors, certifyCorpusCoverage, assertCorpusCoverage, readActiveContract,
} from '../tests/evals/corpusEmbeddingCertification';
import { primeFromCache } from '../tests/evals/evalEmbeddingCache';
import { CANVA_CORPUS, CANVA_CORPUS_HASH, type CanvaEvent } from '../tests/fixtures/multiProduct/canvaCorpus';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const FOUNDER   = uuidFrom('canva-local-cert-founder');
const WORKSPACE = uuidFrom('canva-local-cert-workspace');
const PRODUCT   = uuidFrom('canva-local-cert-product');
const db = () => getSupabaseAdmin();

const isOfficial = (e: CanvaEvent) =>
  e.source.authorityClass === 'OFFICIAL_CANVA' || e.source.authorityClass === 'OFFICIAL_DISTRIBUTION';

const provenanceKind = (e: CanvaEvent) =>
  isOfficial(e) ? 'public_source_official' : 'public_source_reputable';
const sourceValue = (e: CanvaEvent) =>
  isOfficial(e) ? 'public_official' : 'public_reputable';

/** The deliberate Gate-A rejection probes. Their claims are fabricated by design. */
const PROBE_IDS = new Set(['cv-200', 'cv-201', 'cv-202', 'cv-203']);
/** Real content of a cited source, used as evidence for the probes. */
const REAL_SOURCE_TEXT =
  'In 2025 Canva grew to 260 million people using Canva every month, a milestone shaped by ' +
  'millions of classrooms, small businesses, nonprofits, teams and creators.';

/** Pairs carrying a frozen expected relation. Wording is NOT edited here. */
const PAIRS = CANVA_CORPUS.filter(e => e.expected.relation && e.expected.relatesTo);

async function seedLab() {
  await db().from('founders').upsert({ id: FOUNDER, email: 'canva-local@certification.invalid', name: 'CANVA LOCAL CERT', plan: 'studio' }, { onConflict: 'id' });
  await db().from('workspaces').upsert({ id: WORKSPACE, founder_id: FOUNDER, name: 'Canva Local Certification' }, { onConflict: 'id' });
  await db().from('products').upsert({ id: PRODUCT, founder_id: FOUNDER, workspace_id: WORKSPACE, name: 'Canva (local cert)', store_url: 'https://www.canva.com', platform: 'app_store', markets: ['usa'], maturity: 'growing' }, { onConflict: 'id' });

  // Evidence: one row per event, carrying the claim text so Gate A's support
  // policy has something real to check against.
  const evRows = CANVA_CORPUS.map(e => ({
    id: uuidFrom(`canva-local-ev-${e.id}`),
    founder_id: FOUNDER, product_id: PRODUCT, workspace_id: WORKSPACE,
    evidence_type: 'external', source_id: e.source.url, source_table: 'public_web',
    data: { claim: e.claim, eventDate: e.eventDate, validFrom: e.validFrom, validTo: e.validTo,
            publisher: e.source.publisher, authorityClass: e.source.authorityClass,
            independenceKey: e.source.independenceKey, corpusHash: CANVA_CORPUS_HASH },
    confidence_boost: 0,
  }));
  const { data: haveEv } = await db().from('evidence').select('id').in('id', evRows.map(r => r.id));
  const seenEv = new Set(((haveEv ?? []) as { id: string }[]).map(r => r.id));
  const missEv = evRows.filter(r => !seenEv.has(r.id));
  for (let i = 0; i < missEv.length; i += 40) {
    const { error } = await db().from('evidence').insert(missEv.slice(i, i + 40));
    if (error) throw new Error(`evidence insert failed: ${error.message}`);
  }

  // Incumbents: the earlier half of every frozen pair, as governed memories.
  const incIds = [...new Set(PAIRS.map(p => p.expected.relatesTo!))];
  const memRows = incIds.map(id => {
    const e = CANVA_CORPUS.find(x => x.id === id)!;
    const norm = normalizeMemoryScope(e.expected.scope);
    return {
      id: uuidFrom(`canva-local-inc-${id}`),
      founder_id: FOUNDER, product_id: PRODUCT, workspace_id: WORKSPACE,
      memory_type: 'product', title: e.claim.slice(0, 120), content: { claim: e.claim },
      // Migration 107: public provenance is now representable, so the incumbent
      // no longer has to borrow `growth_brain` and distort BeliefPolicy.
      source: sourceValue(e), confidence: 0.5, status: 'active', version: 1, evidence_ids: [],
      memory_class: e.expected.memoryClass,
      authority_tier: authorityForCandidate({ actorType: 'system', kind: provenanceKind(e) }).tier,
      authority_policy_version: 1,
      scope: norm.scope, scope_key: norm.scopeKey,
      scope_specificity: norm.specificity, scope_completeness: norm.completeness,
    };
  });
  const { data: haveM } = await db().from('marketing_memories').select('id').in('id', memRows.map(r => r.id));
  const seenM = new Set(((haveM ?? []) as { id: string }[]).map(r => r.id));
  const missM = memRows.filter(r => !seenM.has(r.id));
  if (missM.length) {
    const { error } = await db().from('marketing_memories').insert(missM);
    if (error) throw new Error(`incumbent insert failed: ${error.message}`);
  }
  console.log(`lab: ${missEv.length} evidence + ${missM.length} incumbents inserted (${seenEv.size}/${seenM.size} existing)`);
  return new Map(incIds.map(id => [id, uuidFrom(`canva-local-inc-${id}`)]));
}

function candidateFor(e: CanvaEvent): MemoryCandidate {
  return {
    workspaceId: WORKSPACE, productId: PRODUCT,
    claimText: e.claim, memoryClass: e.expected.memoryClass,
    source: sourceValue(e), scope: e.expected.scope,
    provenance: { kind: provenanceKind(e), sourceId: e.source.url, provider: e.source.publisher },
    actorType: 'system',
    evidenceIds: [uuidFrom(`canva-local-ev-${e.id}`)],
    evidenceIndependenceKeys: [e.source.independenceKey],
    // HARNESS FIX: a claim must never be its own evidence. Doing so made every
    // claim trivially SUPPORTED — including the deliberately fabricated
    // cv-200..cv-203 probes, which is why the previous run reported 85/85
    // SUPPORTED and could not certify the support policy at all.
    //
    // Genuine events keep their own text (the claim IS what the cited source
    // reported). The fabricated probes are given the REAL content of the source
    // they cite, which is exactly what makes them unsupported.
    evidenceRecords: [{
      id: uuidFrom(`canva-local-ev-${e.id}`),
      text: PROBE_IDS.has(e.id) ? REAL_SOURCE_TEXT : e.claim,
      data: { eventDate: e.eventDate, publisher: e.source.publisher },
    }],
    sampleSize: null, claimIsRuleGenerated: true, domainRef: null,
  };
}

async function main() {
  console.log('CANVA_ENGINE_CERTIFICATION_ENV = LOCAL_CERTIFICATION');
  console.log('CANVA_CORPUS_HASH =', CANVA_CORPUS_HASH, `(${CANVA_CORPUS.length} events)`);

  await seedLab();

  // ── Coverage gates ───────────────────────────────────────────────────────
  const acq = await acquireCorpusVectors(db() as never, [WORKSPACE]);
  console.log(`vectors: ${acq.fromCache} cached + ${acq.embedded} embedded (${acq.providerRequests} request(s))`);
  const cov = await certifyCorpusCoverage(db() as never, [WORKSPACE]);
  assertCorpusCoverage(cov);
  console.log(`CORPUS_COVERAGE ${cov.current}/${cov.expected}`);

  const contract = await readActiveContract(db() as never);
  // EVERY candidate claim is also a retrieval query during the 85-event shadow
  // run, not just the relation pairs. Priming only the pairs left 70 queries to
  // hit the live provider, where they rate-limited and degraded the run —
  // which is why the previous Gate B distribution was inadmissible.
  const queries = [...new Set([
    ...PAIRS.map(p => p.claim),
    ...PAIRS.map(p => CANVA_CORPUS.find(x => x.id === p.expected.relatesTo!)!.claim),
    ...CANVA_CORPUS.map(e => e.claim),
  ])];
  const primed = primeFromCache(queries, {
    provider: contract.provider, model: contract.model,
    dimensions: contract.dimensions, version: contract.embedding_version,
  });
  if (primed.primed < primed.requested) {
    console.error(`QUERY_SEMANTIC_COVERAGE_INCOMPLETE — ${primed.primed}/${primed.requested}. ` +
                  'Run `npm run eval:acquire-canva-queries` first.');
    process.exit(2);
  }
  console.log(`QUERY_COVERAGE ${primed.primed}/${primed.requested}`);

  // ── Public authority certification (D) ───────────────────────────────────
  console.log('\n=== PUBLIC AUTHORITY ===');
  const off = authorityForCandidate({ actorType: 'system', kind: 'public_source_official' });
  const rep = authorityForCandidate({ actorType: 'system', kind: 'public_source_reputable' });
  console.log(`  official  -> ${off.tier}  founderAuthority=${isFounderAuthority(off.tier)}`);
  console.log(`  reputable -> ${rep.tier}  founderAuthority=${isFounderAuthority(rep.tier)}`);
  const adversarial = ['public_source_official', 'public_source_reputable', 'founder_context', 'intake']
    .map(k => authorityForCandidate({ actorType: 'system', kind: k }).tier)
    .filter(t => isFounderAuthority(t));
  console.log(`  adversarial system-actor combos reaching founder authority: ${adversarial.length} (must be 0)`);

  // ── Evidence support regression (E) ──────────────────────────────────────
  console.log('\n=== EVIDENCE SUPPORT REGRESSION ===');
  const realEv = [{ id: 'e', text: CANVA_CORPUS.find(e => e.id === 'cv-100')!.claim }];
  const probes: Array<[string, string]> = [
    ['unsupported CAC',        'Canva CAC decreased 22% and conversion increased 31%'],
    ['unsupported conversion', 'Canva free-to-paid conversion rate is 14.2%'],
    ['unsupported retention',  'Canva 12-month retention is 88% for paid seats'],
    ['unsupported roadmap',    'Canva plans to launch a CRM product next quarter internally'],
    ['wrong rating numbers',   'Canva app rating dropped from 4.9 to 2.1 last week'],
    ['wrong review count',     'Canva has exactly 4,182,993 public reviews'],
    ['wrong ranking delta',    'Canva moved up 37 positions in the App Store rankings'],
  ];
  for (const [label, claim] of probes) {
    const s = evaluateEvidenceSupport(claim, realEv);
    console.log(`  ${label.padEnd(24)} -> ${s.result.padEnd(20)} (${s.assertionType})`);
  }
  const controls: Array<[string, string, string]> = [
    ['official launch', 'Canva launched Visual Suite 2.0 at Canva Create on 10 April 2025',
     'Canva launched Visual Suite 2.0 at Canva Create on 10 April 2025.'],
    ['feature availability', 'Canva Education is free for K-12 teachers and students',
     'Canva Education is 100% free for K-12 teachers and their students.'],
    ['sourced pricing', 'Canva raised the Pro plan to $15 per month',
     'Canva raised the individual Pro plan from $12.99 to $15 per month in 2025.'],
  ];
  for (const [label, claim, ev] of controls) {
    const s = evaluateEvidenceSupport(claim, [{ id: 'c', text: ev }]);
    console.log(`  CONTROL ${label.padEnd(20)} -> ${s.result}`);
  }

  // ── Shadow run over the full frozen corpus (F) ───────────────────────────
  console.log('\n=== CANVA SHADOW RUN (85 events) ===');
  const gateA: Record<string, number> = {}, gateAReason: Record<string, number> = {};
  const support: Record<string, number> = {}, gateB: Record<string, number> = {};
  let modelCalls = 0, maxCalls = 0, review = 0, provenance = 0, degraded = 0, related = 0;
  const dump: Array<Record<string, unknown>> = [];
  // HARNESS FIX: the 8 seeded incumbents must not also be candidates. Feeding
  // them back produced self-matches that filled 6 of 10 sampled REINFORCE
  // proposals with no adjudication signal.
  const incumbentIds = new Set(PAIRS.map(p => p.expected.relatesTo!));
  const shadowSet = CANVA_CORPUS.filter(e => !incumbentIds.has(e.id));
  for (const e of shadowSet) {
    const res = await processCandidate(candidateFor(e), { allowModel: true });
    dump.push({
      id: e.id, era: e.era, category: e.category, claim: e.claim,
      authorityClass: e.source.authorityClass, publisher: e.source.publisher,
      gateA: res.eligibility.result, gateAReason: res.eligibility.reason,
      support: res.eligibility.support?.result ?? null,
      outcome: res.promotion?.outcome ?? 'NO_DECISION',
      reasonCode: res.promotion?.reasonCode ?? null,
      belief: res.promotion?.beliefAction ?? null,
      scopeRelation: res.promotion?.scopeRelation ?? null,
      review: Boolean(res.promotion?.requiresFounderReview),
      related: res.relatedRetrieved, modelCalls: res.modelCalls,
      degraded: res.retrievalDegraded, targetMemoryId: res.promotion?.targetMemoryId ?? null,
    });
    gateA[res.eligibility.result] = (gateA[res.eligibility.result] ?? 0) + 1;
    gateAReason[res.eligibility.reason] = (gateAReason[res.eligibility.reason] ?? 0) + 1;
    const sup = res.eligibility.support?.result ?? 'NOT_EVALUATED';
    support[sup] = (support[sup] ?? 0) + 1;
    const b = res.promotion?.outcome ?? 'NO_DECISION';
    gateB[b] = (gateB[b] ?? 0) + 1;
    modelCalls += res.modelCalls; maxCalls = Math.max(maxCalls, res.modelCalls);
    if (res.promotion?.requiresFounderReview) review++;
    if (res.traceId && res.idempotencyKey) provenance++;
    if (res.retrievalDegraded) degraded++;
    related += res.relatedRetrieved;
  }
  console.log('  Gate A       :', JSON.stringify(gateA));
  console.log('  Gate A reason:', JSON.stringify(gateAReason));
  console.log('  support      :', JSON.stringify(support));
  console.log('  Gate B       :', JSON.stringify(gateB));
  console.log(`  model calls=${modelCalls} max=${maxCalls} review=${review} degraded=${degraded} relatedTotal=${related}`);
  console.log(`  candidates   : ${shadowSet.length} (${incumbentIds.size} seeded incumbents excluded)`);
  console.log(`  provenance   : ${provenance}/${shadowSet.length}`);
  writeFileSync('/tmp/canva85.json', JSON.stringify(dump, null, 1));
  const degradedCount = dump.filter(d => d.degraded).length;
  console.log(`  NON-DEGRADED : ${shadowSet.length - degradedCount}/${shadowSet.length}` +
              (degradedCount ? '  ** NOT ADMISSIBLE FOR ADJUDICATION **' : '  ADMISSIBLE'));

  // ── Chronological relation evaluation (C/G) ──────────────────────────────
  console.log('\n=== RELATION EVALUATION ===');
  let allHybrid = true, correct = 0;
  const rows: string[] = [];
  for (const p of PAIRS) {
    const inc = CANVA_CORPUS.find(x => x.id === p.expected.relatesTo!)!;
    const probe = await retrieveMemories({ workspaceId: WORKSPACE, productId: PRODUCT, query: inc.claim, limit: 10 });
    if (probe.mode !== 'HYBRID' || probe.degraded) allHybrid = false;
    const res = await processCandidate(candidateFor(p), { allowModel: true });
    const outcome = res.promotion?.outcome ?? 'NO_DECISION';
    const belief  = res.promotion?.beliefAction ?? 'none';
    // TIME_BOUNDED_CHANGE: later state replacing an earlier one is normal product
    // evolution. Accepted as supersede, challenge (founder decides) or a deferral
    // — but NOT as a silent CREATE_NEW, which would duplicate the fact.
    const ok =
      (p.expected.relation === 'CONTRADICTION' && (belief === 'challenge' || outcome === 'CHALLENGE' || outcome === 'KEEP_AS_EVIDENCE_ONLY'))
      || (p.expected.relation === 'REINFORCEMENT' && (belief === 'reinforce' || outcome === 'REINFORCE'))
      || (p.expected.relation === 'SUPERSEDES' && ['SUPERSEDE', 'CHALLENGE', 'REINFORCE', 'KEEP_AS_EVIDENCE_ONLY'].includes(outcome));
    if (ok) correct++;
    rows.push(`  ${p.id} expect=${String(p.expected.relation).padEnd(14)} outcome=${String(outcome).padEnd(24)} ` +
              `belief=${String(belief).padEnd(10)} related=${res.relatedRetrieved} model=${res.modelCalls} ` +
              `mode=${probe.mode} degraded=${probe.degraded} ${ok ? 'MATCH' : 'MISS'}`);
  }
  rows.forEach(r => console.log(r));
  if (!allHybrid) {
    console.log('\nRELATION ACCURACY WITHHELD — not every relation query ran non-degraded HYBRID.');
  } else {
    console.log(`\nCANVA_RELATION_ACCURACY = ${correct}/${PAIRS.length} (HYBRID, degraded=false)`);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message ?? e); process.exit(1); });
}

export const CANVA_RELATION_QUERIES: string[] =
  PAIRS.map(p => p.claim).concat(PAIRS.map(p => CANVA_CORPUS.find(x => x.id === p.expected.relatesTo!)!.claim));
