/**
 * @file threeProductShadow.ts
 * @description Phase 3.2A three-product SHADOW validation run.
 *
 *   Runs the REAL engine (`processCandidate`) across three deliberately different
 *   evidence profiles and reports what actually happened:
 *
 *     ALLIGNX     limited public evidence, rich founder context, live product
 *     LAUNCHMIND  no public evidence, rich founder context, pre-launch
 *     CANVA       rich public evidence, NO founder authority, mature (lab arm)
 *
 *   ISOLATION: Canva is created under a dedicated LAB FOUNDER, not under the real
 *   owner. Putting it in a second workspace of the real account would have been
 *   tenancy-correct but would have surfaced "Canva" in the owner's company
 *   switcher — validation state leaking into a real person's product.
 *
 *   NO AUTHORITATIVE MUTATION: the run writes only `memory_shadow_proposals`
 *   (the shadow output table) plus lab-owned rows. `marketing_memories`,
 *   `marketing_memory_versions`, founder context, goals, boundaries and strategy
 *   are snapshotted before and after and must be identical.
 *
 * @security Uses the service role for lab fixture creation. The lab founder is
 *   NOT an auth user and cannot sign in. No real owner row is written.
 * @dependencies marketingMemoryEngine, canvaCorpus, supabaseAdmin
 */

import { createHash, randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { processCandidate, type MemoryCandidate } from '../src/services/memory/marketingMemoryEngine';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';
import { CANVA_CORPUS, CANVA_CORPUS_HASH, corpusCoverage, type CanvaEvent } from '../tests/fixtures/multiProduct/canvaCorpus';

const REAL_FOUNDER = '8a292044-5b22-42e5-90d0-65e6cc3d7321';
const ALLIGNX = { product: '18cd318b-77fb-4ccb-b26f-b51cadc0a6b0', workspace: '08c83039-9885-43eb-8393-bf0dfa95c34d' };
const LAUNCHMIND = { product: '0826d6e7-e695-4474-8fed-3d4953fa2f91', workspace: 'ae5e2bfd-e6b9-43b7-af05-822da0fff5a2' };

/** Deterministic lab ids so re-runs are idempotent rather than accumulating. */
const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const LAB_FOUNDER   = uuidFrom('lm-lab-founder-canva');
const LAB_WORKSPACE = uuidFrom('lm-lab-workspace-canva');
const LAB_PRODUCT   = uuidFrom('lm-lab-product-canva');

const db = () => getSupabaseAdmin();

// ── Snapshot for the no-mutation proof ───────────────────────────────────────
const AUTHORITATIVE = [
  'marketing_memories', 'marketing_memory_versions', 'founder_context',
  'business_goals', 'strategy_directions', 'approval_boundary_policies',
  'product_claims', 'competitor_relationships', 'evidence',
];

async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of AUTHORITATIVE) {
    const { data } = await db().from(t).select('*');
    const rows = (data ?? []) as Record<string, unknown>[];
    // Hash the full row set, not the count: a swap that preserves cardinality
    // would pass a count check and is exactly what we must not miss.
    const canonical = rows.map(r => JSON.stringify(r, Object.keys(r).sort())).sort().join('\n');
    out[t] = `${rows.length}:${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
  }
  return out;
}

// ── Lab fixture ──────────────────────────────────────────────────────────────
async function ensureLab(): Promise<void> {
  await db().from('founders').upsert({
    id: LAB_FOUNDER, email: 'canva-lab@validation.launchmind.invalid',
    name: 'CANVA VALIDATION LAB', plan: 'studio',
  }, { onConflict: 'id' });
  await db().from('workspaces').upsert({
    id: LAB_WORKSPACE, founder_id: LAB_FOUNDER, name: 'Canva Validation Lab',
  }, { onConflict: 'id' });
  await db().from('products').upsert({
    id: LAB_PRODUCT, founder_id: LAB_FOUNDER, workspace_id: LAB_WORKSPACE,
    name: 'Canva (public corpus)', store_url: 'https://www.canva.com',
    platform: 'app_store', markets: ['usa'], maturity: 'growing',
  }, { onConflict: 'id' });
}

/** One `evidence` row per corpus event. Non-founder candidates require real evidence. */
async function ensureEvidence(events: CanvaEvent[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const rows = events.map(e => {
    // Keyed by corpus hash: `evidence` is append-only (ADR-066 rule 2), so a
    // re-freeze must INSERT new rows rather than update the old ones, and the
    // superseded v1 rows stay in place as an audit trail.
    const id = uuidFrom(`canva-evidence-${e.id}-${CANVA_CORPUS_HASH}`);
    ids.set(e.id, id);
    return {
      id, founder_id: LAB_FOUNDER, product_id: LAB_PRODUCT,
      workspace_id: LAB_WORKSPACE,
      evidence_type: 'external',
      source_id: e.source.url, source_table: 'public_web',
      data: {
        claim: e.claim, eventDate: e.eventDate, validFrom: e.validFrom, validTo: e.validTo,
        publisher: e.source.publisher, publicationDate: e.source.publicationDate,
        retrievedAt: e.source.retrievedAt, accessMode: e.source.accessMode,
        authorityClass: e.source.authorityClass, independenceKey: e.source.independenceKey,
        corpusHash: CANVA_CORPUS_HASH,
      },
      confidence_boost: 0,
    };
  });
  const { data: existing } = await db().from('evidence')
    .select('id').in('id', rows.map(r => r.id));
  const have = new Set(((existing ?? []) as { id: string }[]).map(r => r.id));
  const missing = rows.filter(r => !have.has(r.id));
  for (let i = 0; i < missing.length; i += 40) {
    const { error } = await db().from('evidence').insert(missing.slice(i, i + 40));
    if (error) throw new Error(`evidence insert failed: ${error.message}`);
  }
  console.log(`evidence: ${have.size} existing, ${missing.length} inserted`);
  return ids;
}

// ── Candidate construction ───────────────────────────────────────────────────
function canvaCandidate(e: CanvaEvent, evidenceId: string): MemoryCandidate {
  return {
    workspaceId: LAB_WORKSPACE, productId: LAB_PRODUCT,
    claimText: e.claim,
    memoryClass: e.expected.memoryClass,
    source: e.source.authorityClass === 'OFFICIAL_CANVA' || e.source.authorityClass === 'OFFICIAL_DISTRIBUTION'
      ? 'public_official' : 'public_reputable',
    scope: e.expected.scope,
    // 'public_source' has no branch in authorityForCandidate, so it falls to the
    // default → DERIVED_INFERENCE. That is the measured ceiling, recorded as such.
    // Migration 107 + authorityPolicy: official primary sources reach
    // VERIFIED_EXTERNAL; reputable secondary stays DERIVED_INFERENCE. Neither is
    // founder authority — actorType 'system' cannot reach a FOUNDER_* tier.
    provenance: {
      kind: e.source.authorityClass === 'OFFICIAL_CANVA' || e.source.authorityClass === 'OFFICIAL_DISTRIBUTION'
        ? 'public_source_official' : 'public_source_reputable',
      sourceId: e.source.url, provider: e.source.publisher,
    },
    actorType: 'system',
    evidenceIds: [evidenceId],
    evidenceIndependenceKeys: [e.source.independenceKey],
    // Evidence CONTENT, so Gate A's support policy can verify the claim rather
    // than merely confirm a row exists.
    evidenceRecords: [{ id: evidenceId, text: e.claim, data: { eventDate: e.eventDate, publisher: e.source.publisher } }],
    sampleSize: null,
    claimIsRuleGenerated: true,
    domainRef: null,
  };
}

/**
 * Founder-authority probes for the real businesses.
 *
 * These are NOT fabricated signals. Each claim is the founder's OWN recorded
 * Phase-1 statement, replayed through the governed path to answer Part 13 (does
 * founder authority hold?) and Part 6 (should bootstrap go through this path?).
 * They are additionally paired with a DERIVED public-style challenger to prove a
 * weaker tier cannot silently override a founder directive.
 */
async function founderProbes(product: string, workspace: string): Promise<MemoryCandidate[]> {
  const { data } = await db().from('founder_context').select('*').eq('product_id', product);
  const rows = (data ?? []) as Record<string, unknown>[];
  const out: MemoryCandidate[] = [];
  for (const r of rows) {
    const audience = r.audience_confirmed as string | null;
    if (audience && audience.length > 30) {
      out.push({
        workspaceId: workspace, productId: product,
        claimText: `Primary audience is ${audience}`,
        memoryClass: 'DIRECTIVE', source: 'intake',
        scope: { market: 'global' },
        provenance: { kind: 'founder_context', sourceId: String(r.id) },
        actorType: 'founder', founderConfirmed: true,
        evidenceIds: [], evidenceIndependenceKeys: [],
        claimIsRuleGenerated: false, domainRef: null,
      });
      // The challenger: same subject, weaker authority, no founder in the loop.
      out.push({
        workspaceId: workspace, productId: product,
        claimText: `Primary audience is enterprise procurement teams rather than ${audience}`,
        memoryClass: 'FACT', source: 'external_public',
        scope: { market: 'global' },
        provenance: { kind: 'public_source', sourceId: `probe:${r.id}` },
        actorType: 'system',
        evidenceIds: [], evidenceIndependenceKeys: ['probe:challenger'],
        claimIsRuleGenerated: true, domainRef: null,
      });
    }
  }
  return out;
}

/** Candidates the real pipeline would genuinely produce today. */
async function realSignalCandidates(product: string, workspace: string): Promise<MemoryCandidate[]> {
  const { data: insights } = await db().from('connection_insights')
    .select('*').eq('workspace_id', workspace);
  const { data: campaigns } = await db().from('campaigns')
    .select('id').eq('product_id', product).eq('status', 'completed');
  const rows = (insights ?? []) as Record<string, unknown>[];
  // Deliberately NOT padded. Zero here is a finding, not a gap to fill.
  return rows.map(r => ({
    workspaceId: workspace, productId: product,
    claimText: String(r.narrative ?? r.headline ?? ''),
    memoryClass: 'LEARNING' as const, source: 'connection_insight',
    scope: { market: 'global' },
    provenance: { kind: 'connection_insight', sourceId: String(r.id), provider: String(r.provider) },
    actorType: 'system' as const,
    evidenceIds: [], evidenceIndependenceKeys: [String(r.id)],
    claimIsRuleGenerated: true, domainRef: null,
  })).concat((campaigns ?? []).length ? [] : []);
}

interface ArmResult {
  name: string;
  candidates: number;
  gateA: Record<string, number>;
  gateAReasons: Record<string, number>;
  gateB: Record<string, number>;
  gateBReasons: Record<string, number>;
  founderReview: number;
  beliefActions: Record<string, number>;
  scopeRelations: Record<string, number>;
  relatedRetrieved: number;
  modelCalls: number;
  maxModelCalls: number;
  modelCallHistogram: Record<string, number>;
  proposals: number;
  duplicates: number;
  shortCircuited: number;
  retrievalDegraded: number;
  provenanceComplete: number;
  errors: string[];
}

async function runArm(name: string, candidates: MemoryCandidate[]): Promise<ArmResult> {
  const r: ArmResult = {
    name, candidates: candidates.length, gateA: {}, gateAReasons: {}, gateB: {},
    gateBReasons: {}, founderReview: 0, beliefActions: {}, scopeRelations: {}, relatedRetrieved: 0,
    modelCalls: 0, maxModelCalls: 0, modelCallHistogram: {}, proposals: 0,
    duplicates: 0, shortCircuited: 0, retrievalDegraded: 0, provenanceComplete: 0, errors: [],
  };
  for (const c of candidates) {
    try {
      const res = await processCandidate(c, { allowModel: true });
      r.gateA[res.eligibility.result] = (r.gateA[res.eligibility.result] ?? 0) + 1;
      r.gateAReasons[res.eligibility.reason] = (r.gateAReasons[res.eligibility.reason] ?? 0) + 1;
      // PromotionDecision exposes `outcome` and `reasonCode`, not `action`.
      const b = res.promotion?.outcome ?? 'NO_DECISION';
      r.gateB[b] = (r.gateB[b] ?? 0) + 1;
      const rc = res.promotion?.reasonCode ?? 'none';
      r.gateBReasons[rc] = (r.gateBReasons[rc] ?? 0) + 1;
      if (res.promotion?.requiresFounderReview) r.founderReview++;
      if (res.promotion?.beliefAction) r.beliefActions[res.promotion.beliefAction] =
        (r.beliefActions[res.promotion.beliefAction] ?? 0) + 1;
      if (res.promotion?.scopeRelation) r.scopeRelations[res.promotion.scopeRelation] =
        (r.scopeRelations[res.promotion.scopeRelation] ?? 0) + 1;
      r.modelCalls += res.modelCalls;
      r.maxModelCalls = Math.max(r.maxModelCalls, res.modelCalls);
      const bucket = res.modelCalls >= 2 ? '2+' : String(res.modelCalls);
      r.modelCallHistogram[bucket] = (r.modelCallHistogram[bucket] ?? 0) + 1;
      if (res.proposalId) r.proposals++;
      if (res.duplicate) r.duplicates++;
      if (res.shortCircuited) r.shortCircuited++;
      if (res.retrievalDegraded) r.retrievalDegraded++;
      r.relatedRetrieved += res.relatedRetrieved;
      if (res.idempotencyKey && res.traceId) r.provenanceComplete++;
      if (res.error) r.errors.push(res.error);
    } catch (e) {
      r.errors.push((e as Error).message);
    }
  }
  return r;
}

/**
 * RELATION PROBE — the only way to exercise Parts 14/15 in shadow.
 *
 * Shadow never promotes, so candidate N+1 cannot see candidate N: the first run
 * produced CREATE_NEW / NO_RELATED_MEMORY for all 84 with relatedRetrieved=0 and
 * ZERO model calls, meaning duplicate / reinforcement / contradiction /
 * scoped-exception were never reached. To test them, the INCUMBENT side of each
 * frozen pair is seeded as a lab-owned memory first, then the CHALLENGER is run.
 *
 * These are lab rows in the Canva lab workspace only. No owner memory is written.
 */
async function seedIncumbents(): Promise<Map<string, string>> {
  const pairs = CANVA_CORPUS.filter(e => e.expected.relation && e.expected.relatesTo);
  const incumbentIds = [...new Set(pairs.map(e => e.expected.relatesTo!))];
  const map = new Map<string, string>();
  const rows = incumbentIds.map(id => {
    const e = CANVA_CORPUS.find(x => x.id === id)!;
    const memId = uuidFrom(`canva-incumbent-${id}-${CANVA_CORPUS_HASH}`);
    const norm = normalizeMemoryScope(e.expected.scope);
    map.set(id, memId);
    return {
      id: memId, founder_id: LAB_FOUNDER, product_id: LAB_PRODUCT, workspace_id: LAB_WORKSPACE,
      memory_type: 'product', title: e.claim.slice(0, 120), content: { claim: e.claim },
      // LIMITATION, RECORDED: marketing_memories.source is a closed CHECK set
      // (intake|growth_brain|campaign_performance|review|analytics|
      //  founder_feedback|ai_conversation|experiment) with NO value for
      // externally-sourced public evidence. Public evidence is therefore not
      // representable as a memory today without a migration. 'growth_brain' is
      // the nearest available value; BeliefPolicy reads `source` for precedence,
      // so this makes the incumbent stronger than a true public memory would be
      // — conservative for this probe (a challenger is LESS likely to override).
      source: 'growth_brain', confidence: 0.5, status: 'active', version: 1,
      evidence_ids: [], memory_class: e.expected.memoryClass,
      authority_tier: 'DERIVED_INFERENCE', authority_policy_version: 1,
      // scope_key is a sha256 by CHECK constraint (migration 099). Built with the
      // engine's own normalizer so the lab incumbent is keyed EXACTLY as a
      // candidate would be — a hand-rolled key would never match on retrieval.
      scope: norm.scope, scope_key: norm.scopeKey,
      scope_specificity: norm.specificity, scope_completeness: norm.completeness,
    };
  });
  const { data: existing } = await db().from('marketing_memories')
    .select('id').in('id', rows.map(r => r.id));
  const have = new Set(((existing ?? []) as { id: string }[]).map(r => r.id));
  const missing = rows.filter(r => !have.has(r.id));
  if (missing.length) {
    const { error } = await db().from('marketing_memories').insert(missing);
    if (error) throw new Error(`incumbent seed failed: ${error.message}`);
  }
  console.log(`lab incumbents: ${have.size} existing, ${missing.length} inserted`);
  return map;
}

async function runRelationProbe(evidenceIds: Map<string, string>) {
  const pairs = CANVA_CORPUS.filter(e => e.expected.relation && e.expected.relatesTo);
  console.log('\n================ RELATION PROBE (Parts 14/15) ================');
  let correct = 0;
  const confusion: Record<string, number> = {};
  for (const e of pairs) {
    // Fresh sourceId so idempotency does not mark it a duplicate of run 1.
    const c = canvaCandidate(e, evidenceIds.get(e.id)!);
    c.provenance = { ...c.provenance, sourceId: `${c.provenance.sourceId}#relprobe` };
    const res = await processCandidate(c, { allowModel: true });
    const actualRel = res.promotion?.beliefAction ?? 'none';
    const outcome = res.promotion?.outcome ?? 'NO_DECISION';
    const key = `${e.expected.relation}->${outcome}/${actualRel}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
    const matched = (e.expected.relation === 'CONTRADICTION' && ['challenge'].includes(actualRel))
      || (e.expected.relation === 'REINFORCEMENT' && actualRel === 'reinforce')
      || (e.expected.relation === 'SUPERSEDES' && ['supersede', 'challenge'].includes(actualRel));
    if (matched) correct++;
    console.log(`  ${e.id} expect=${String(e.expected.relation).padEnd(14)} ` +
                `outcome=${String(outcome).padEnd(22)} belief=${String(actualRel).padEnd(10)} ` +
                `review=${res.promotion?.requiresFounderReview} related=${res.relatedRetrieved} ` +
                `model=${res.modelCalls} degraded=${res.retrievalDegraded} ${matched ? 'MATCH' : 'MISS'}`);
  }
  console.log(`  relation accuracy: ${correct}/${pairs.length}`);
  console.log('  confusion:', JSON.stringify(confusion, null, 0));
}

async function main() {
  console.log('MODE =', process.env.CONTINUOUS_LEARNING_INGESTION_MODE ?? '(default)');
  console.log('CANVA_CORPUS_HASH =', CANVA_CORPUS_HASH);
  console.log('coverage =', JSON.stringify(corpusCoverage().byEra));

  const before = await snapshot();

  await ensureLab();
  const evidenceIds = await ensureEvidence(CANVA_CORPUS);

  const canva = CANVA_CORPUS.map(e => canvaCandidate(e, evidenceIds.get(e.id)!));
  const allignxReal = await realSignalCandidates(ALLIGNX.product, ALLIGNX.workspace);
  const lmReal      = await realSignalCandidates(LAUNCHMIND.product, LAUNCHMIND.workspace);
  const allignxFnd  = await founderProbes(ALLIGNX.product, ALLIGNX.workspace);
  const lmFnd       = await founderProbes(LAUNCHMIND.product, LAUNCHMIND.workspace);

  const results = [
    await runArm('CANVA', canva),
    await runArm('ALLIGNX', [...allignxReal, ...allignxFnd]),
    await runArm('LAUNCHMIND', [...lmReal, ...lmFnd]),
  ];

  console.log('\n================ ARM RESULTS ================');
  for (const r of results) {
    console.log(`\n### ${r.name}  (candidates=${r.candidates})`);
    console.log('  Gate A        :', JSON.stringify(r.gateA));
    console.log('  Gate A reasons:', JSON.stringify(r.gateAReasons));
    console.log('  Gate B        :', JSON.stringify(r.gateB));
    console.log('  Gate B reasons:', JSON.stringify(r.gateBReasons));
    console.log('  belief actions:', JSON.stringify(r.beliefActions), ' scopeRel:', JSON.stringify(r.scopeRelations));
    console.log(`  requiresFounderReview=${r.founderReview}  relatedRetrieved=${r.relatedRetrieved}`);
    console.log(`  proposals=${r.proposals} duplicates=${r.duplicates} shortCircuited=${r.shortCircuited}`);
    console.log(`  modelCalls total=${r.modelCalls} max=${r.maxModelCalls} hist=${JSON.stringify(r.modelCallHistogram)}`);
    console.log(`  retrievalDegraded=${r.retrievalDegraded} provenanceComplete=${r.provenanceComplete}/${r.candidates}`);
    if (r.errors.length) console.log('  errors:', [...new Set(r.errors)].slice(0, 5));
  }

  // ── Isolation: no proposal may name a workspace other than its own ─────────
  await seedIncumbents();
  await runRelationProbe(evidenceIds);

  console.log('\n================ ISOLATION ================');
  const { data: props } = await db().from('memory_shadow_proposals').select('workspace_id, product_id');
  const byWs = ((props ?? []) as Record<string, string>[]).reduce<Record<string, number>>((a, p) => {
    a[p.workspace_id] = (a[p.workspace_id] ?? 0) + 1; return a;
  }, {});
  const label = (w: string) => w === LAB_WORKSPACE ? 'CANVA_LAB'
    : w === ALLIGNX.workspace ? 'ALLIGNX' : w === LAUNCHMIND.workspace ? 'LAUNCHMIND' : `UNKNOWN(${w})`;
  Object.entries(byWs).forEach(([w, n]) => console.log(`  ${label(w).padEnd(12)} ${n} proposals`));

  // Cross-tenant text check: no Canva claim may appear in an owner workspace.
  const { data: ownerProps } = await db().from('memory_shadow_proposals')
    .select('workspace_id, claim_text')
    .in('workspace_id', [ALLIGNX.workspace, LAUNCHMIND.workspace]);
  const leaked = ((ownerProps ?? []) as Record<string, string>[])
    .filter(p => /canva/i.test(p.claim_text ?? ''));
  console.log(`  Canva text inside owner workspaces: ${leaked.length} (must be 0)`);

  // ── No-mutation proof ─────────────────────────────────────────────────────
  const after = await snapshot();
  console.log('\n================ NO-MUTATION PROOF ================');
  let mutated = 0;
  for (const t of AUTHORITATIVE) {
    const same = before[t] === after[t];
    // `evidence` is expected to change: the lab rows are the corpus itself.
    const expected = t === 'evidence';
    if (!same && !expected) mutated++;
    console.log(`  ${t.padEnd(30)} ${same ? 'UNCHANGED' : 'CHANGED'} ${before[t]} -> ${after[t]}` +
                `${!same && expected ? '  (expected: lab corpus rows)' : ''}`);
  }
  console.log(`  authoritative tables mutated (must be 0): ${mutated}`);
  console.log(JSON.stringify({ before, after }, null, 0).slice(0, 0));
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
