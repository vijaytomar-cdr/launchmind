/**
 * @file relevanceAuthorityMatrix.pg.test.ts
 * @description THE FROZEN 8-CASE MATRIX for the relevance/authority contract.
 *
 *   THE CONTRACT UNDER TEST:
 *     1. Relevance decides which memories participate.
 *     2. Authority may prioritise WITHIN that relevant set.
 *     3. Promotion keeps the full authority hierarchy, separately.
 *     4. A relevant contradiction must never be displaced by loosely-related
 *        higher-authority memories.
 *
 *   MEASURED DEFECT IN CONTROL: authority is an unrestricted multiplier applied
 *   AFTER fusion. RRF (K=60) compresses relevance hard — rank 1 = 1/61, rank 25
 *   = 1/85, a ratio of 1.39 — while the authority spread is 1.60/0.85 = 1.88.
 *   The multiplier is therefore wider than the entire relevance range and can
 *   reverse any gap.
 *
 *   Fixtures and expectations are frozen BEFORE any implementation change.
 *   Raw pre-authority relevance (`fusedRank`) is captured separately from
 *   `finalRank`; final score is never used as a proxy for relevance.
 *
 * @security Case 8 asserts tenant isolation.
 * @dependencies retrievalService (real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { retrieveMemories } from '../src/services/memory/retrievalService';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';
import { RETRIEVAL_BUDGETS } from '../src/services/memory/retrievalTypes';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const F = uuidFrom('ram-founder');
const WSA = uuidFrom('ram-ws-a');
const WSB = uuidFrom('ram-ws-b');
const PA = uuidFrom('ram-prod-a');
const PB = uuidFrom('ram-prod-b');
const db = () => getSupabaseAdmin();
const isLocal = (process.env.SUPABASE_URL ?? '').includes('127.0.0.1');
const d = isLocal ? describe : describe.skip;
const norm = normalizeMemoryScope({ geography: 'usa' });
const idOf = (k: string) => uuidFrom(`ram-mem-${k}`);

/** [key, workspace, product, tier | null (legacy), source, text] */
type Row = readonly [string, string, string, string | null, string, string];

const Q1 = 'Verified provider language increases booking conversion for homeowners in Arizona';
const Q2 = 'Trust messaging improves booking conversion';
const Q5 = 'Emergency plumbing customers prioritise same-day availability over price';

const ROWS: Row[] = [
  // CASE 1 — large relevance gap.
  ['c1-relevant',   WSA, PA, 'DERIVED_INFERENCE', 'growth_brain',      Q1],
  ['c1-weak',       WSA, PA, 'FOUNDER_ASSERTED',  'founder_bootstrap', 'Discount codes drive booking conversion'],
  // CASES 2/3/6 — relevance ties across tiers, identical text.
  ['c2-founder',    WSA, PA, 'FOUNDER_ASSERTED',  'founder_bootstrap', Q2],
  ['c2-derived',    WSA, PA, 'DERIVED_INFERENCE', 'growth_brain',      Q2],
  ['c3-external',   WSA, PA, 'VERIFIED_EXTERNAL', 'public_official',   Q2],
  // CASE 4 — moderate relevance gap.
  ['c4-moderate',   WSA, PA, 'DERIVED_INFERENCE', 'growth_brain',      'Verified provider language increases booking conversion for homeowners'],
  ['c4-lessrel',    WSA, PA, 'FOUNDER_ASSERTED',  'founder_bootstrap', 'Provider language matters in Arizona'],
  // CASE 7 — source invariance: same tier, same text, different governed sources.
  ['c7-official',   WSA, PA, 'VERIFIED_EXTERNAL', 'public_official',   'Availability beats price for emergency plumbing'],
  ['c7-reputable',  WSA, PA, 'VERIFIED_EXTERNAL', 'public_reputable',  'Availability beats price for emergency plumbing'],
  // CASE 8 — tenant isolation: exact high-authority match in another workspace.
  ['c8-otherws',    WSB, PB, 'FOUNDER_ASSERTED',  'founder_bootstrap', Q1],
  // Legacy control row.
  ['legacy',        WSA, PA, null,                'review',            'Legacy review note on booking conversion'],
];

/**
 * CASE 5 — contradiction under REAL pressure. Enough high-authority loosely
 * related rows to exceed maxFinalResults (10), plus one highly relevant
 * lower-authority contradiction.
 */
const PRESSURE: Row[] = Array.from({ length: 14 }, (_, i) =>
  [`p${i}`, WSA, PA, 'FOUNDER_ASSERTED', 'founder_bootstrap',
   `Emergency plumbing note ${i} about customers and pricing`] as const);
const CONTRADICTION: Row =
  ['c5-contra', WSA, PA, 'DERIVED_INFERENCE', 'growth_brain',
   'Emergency plumbing customers prioritise same-day availability over price'];

const ALL: Row[] = [...ROWS, ...PRESSURE, CONTRADICTION];

async function seed() {
  await db().from('founders').upsert({ id: F, email: 'ram@lab.invalid', name: 'RAM LAB', plan: 'studio' }, { onConflict: 'id' });
  for (const [id, name] of [[WSA, 'RAM A'], [WSB, 'RAM B']] as const) {
    await db().from('workspaces').upsert({ id, founder_id: F, name }, { onConflict: 'id' });
  }
  for (const [id, ws] of [[PA, WSA], [PB, WSB]] as const) {
    await db().from('products').upsert({ id, founder_id: F, workspace_id: ws, name: 'RAM', store_url: 'https://x.invalid', platform: 'app_store' }, { onConflict: 'id' });
  }
  const rows = ALL.map(([k, ws, prod, tier, source, text]) => ({
    id: idOf(k), founder_id: F, workspace_id: ws, product_id: prod,
    memory_type: 'product', title: text.slice(0, 110), content: { claim: text },
    source, confidence: 0.5, status: 'active', version: 1, evidence_ids: [],
    scope: {}, scope_specificity: 0, scope_completeness: 'unknown',
    ...(tier ? {
      memory_class: 'FACT', authority_tier: tier, authority_policy_version: 1,
      scope: norm.scope, scope_key: norm.scopeKey,
      scope_specificity: norm.specificity, scope_completeness: norm.completeness,
    } : {}),
  }));
  const { data: have } = await db().from('marketing_memories').select('id').in('id', rows.map(r => r.id));
  const seen = new Set(((have ?? []) as { id: string }[]).map(r => r.id));
  const missing = rows.filter(r => !seen.has(r.id));
  for (let i = 0; i < missing.length; i += 20) {
    const { error } = await db().from('marketing_memories').insert(missing.slice(i, i + 20));
    if (error) throw new Error(`seed: ${error.message}`);
  }
}

interface Probe { fused: number | null; final: number | null; returned: boolean }
async function probe(query: string, keys: string[], limit = RETRIEVAL_BUDGETS.maxFinalResults) {
  const res = await retrieveMemories({ workspaceId: WSA, productId: PA, query, limit });
  const out: Record<string, Probe> = {};
  for (const k of keys) {
    const r = res.results.find(x => x.id === idOf(k)) as
      { fusedRank?: number; finalRank?: number } | undefined;
    out[k] = { fused: r?.fusedRank ?? null, final: r?.finalRank ?? null, returned: Boolean(r) };
  }
  return { out, res };
}
const show = (label: string, p: Record<string, Probe>) =>
  console.log(`    [${label}] ` + Object.entries(p)
    .map(([k, v]) => `${k}: fused=${v.fused ?? '-'} final=${v.final ?? '-'}${v.returned ? '' : ' NOT_RETURNED'}`)
    .join('  |  '));

d('relevance/authority frozen matrix', () => {
  beforeAll(async () => { await seed(); }, 180_000);
  afterAll(async () => {
    await db().from('marketing_memories').delete().eq('workspace_id', WSA);
    await db().from('marketing_memories').delete().eq('workspace_id', WSB);
    await db().from('products').delete().in('id', [PA, PB]);
    await db().from('workspaces').delete().in('id', [WSA, WSB]);
    await db().from('founders').delete().eq('id', F);
  });

  it('CASE 1 — large relevance gap: relevance must win', async () => {
    const { out } = await probe(Q1, ['c1-relevant', 'c1-weak']);
    show('case1', out);
    expect(out['c1-relevant'].returned).toBe(true);
    expect(out['c1-relevant'].final!).toBeLessThan(out['c1-weak'].final ?? 999);
  }, 180_000);

  it('CASE 2 — relevance tie: FOUNDER outranks DERIVED', async () => {
    const { out } = await probe(Q2, ['c2-founder', 'c2-derived']);
    show('case2', out);
    expect(out['c2-founder'].final!).toBeLessThan(out['c2-derived'].final!);
  }, 180_000);

  it('CASE 3 — relevance tie: VERIFIED_EXTERNAL outranks DERIVED', async () => {
    const { out } = await probe(Q2, ['c3-external', 'c2-derived']);
    show('case3', out);
    expect(out['c3-external'].final!).toBeLessThan(out['c2-derived'].final!);
  }, 180_000);

  it('CASE 4 — moderate gap: measured, contract-level only', async () => {
    const { out } = await probe(Q1, ['c4-moderate', 'c4-lessrel']);
    show('case4', out);
    expect(out['c4-moderate'].returned).toBe(true);   // must participate
  }, 180_000);

  it('CASE 5 — contradiction survives real result pressure', async () => {
    const { out, res } = await probe(Q5, ['c5-contra']);
    show('case5', out);
    console.log(`    [case5] returned=${res.results.length} pressureRows=${PRESSURE.length}`);
    expect(out['c5-contra'].returned).toBe(true);      // reaches the comparison set
  }, 180_000);

  it('CASE 6 — both highly relevant: authority still matters', async () => {
    const { out } = await probe(Q2, ['c2-founder', 'c2-derived', 'c3-external']);
    show('case6', out);
    expect(out['c2-founder'].final!).toBeLessThan(out['c2-derived'].final!);
  }, 180_000);

  it('CASE 7 — source invariance: same tier, adjacent ordering', async () => {
    const { out } = await probe('Availability beats price for emergency plumbing', ['c7-official', 'c7-reputable']);
    show('case7', out);
    expect(Math.abs(out['c7-official'].final! - out['c7-reputable'].final!)).toBe(1);
  }, 180_000);

  it('CASE 8 — tenant isolation: Workspace B never returned', async () => {
    const { out } = await probe(Q1, ['c8-otherws']);
    show('case8', out);
    expect(out['c8-otherws'].returned).toBe(false);
  }, 180_000);
});
