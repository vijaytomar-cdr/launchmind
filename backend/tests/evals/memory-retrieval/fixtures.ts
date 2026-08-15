/**
 * @file fixtures.ts
 * @description Deterministic memory corpus for the retrieval evaluation harness.
 *
 *   Every record has a stable `fixture_id` and a stable UUID, so the labelled
 *   dataset in dataset.ts can name expected results without depending on
 *   generated ids, insertion order, or wall-clock time. Re-seeding produces byte
 *   -identical rows, which is what makes the baseline comparable across runs and
 *   against the hybrid retriever measured later in 3.1D.
 *
 *   The corpus deliberately contains cases the current lexical implementation is
 *   expected to FAIL: paraphrased queries that share no keyword with the stored
 *   title, and two memories that contradict each other. A baseline that only
 *   contained winnable cases would understate the gap it exists to measure.
 *
 *   Workspace B exists purely as a leakage canary. Its memories are deliberate
 *   near-duplicates of Workspace A's wording, so any retrieval path that forgets
 *   its tenant filter surfaces them and fails loudly rather than silently.
 *
 * @security Seeds only into a local/disposable Supabase. seedCorpus() refuses to
 *   run against a hosted project (see assertLocalTarget). Contains no real
 *   founder data — all names, products and quotes are invented for this harness.
 * @dependencies founders, workspaces, products, marketing_memories,
 *   learning_events, evidence
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Tenants ───────────────────────────────────────────────────────────────────
// Fixed UUIDs: the dataset references these directly.
export const FOUNDER_A   = 'e0000001-0000-4000-8000-000000000001';
export const FOUNDER_B   = 'e0000002-0000-4000-8000-000000000002';
export const WORKSPACE_A = 'e0000011-0000-4000-8000-000000000011';
export const WORKSPACE_B = 'e0000012-0000-4000-8000-000000000012';
export const PRODUCT_A   = 'e0000021-0000-4000-8000-000000000021';
export const PRODUCT_B   = 'e0000022-0000-4000-8000-000000000022';

export type FixtureKind = 'marketing_memory' | 'learning_event' | 'evidence';

export interface MemoryFixture {
  fixture_id: string;
  id: string;
  founder_id: string;
  /** Added by migration 088; stamped at seed time from the tenant map below. */
  workspace_id?: string;
  product_id: string;
  memory_type: string;
  title: string;
  /** JSONB body. `claim` is the natural-language assertion a reader would quote. */
  content: Record<string, unknown>;
  source: string;
  confidence: number;
  status: 'draft' | 'active' | 'archived';
  version: number;
}

const u = (n: number) => `e0001${String(n).padStart(3, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Workspace A corpus — the realistic LaunchMind domain for a home-services app.
 *
 * Confidence values are spread deliberately: the current Context Engine orders by
 * confidence alone, so a flat corpus would make its top-N look arbitrary rather
 * than measurably wrong.
 */
export const MEMORIES: MemoryFixture[] = [
  // ── A. Positioning ──────────────────────────────────────────────────────────
  {
    fixture_id: 'memory_outcome_positioning', id: u(1),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'Outcome-led messaging increased conversion',
    content: {
      claim: 'Messaging that leads with the finished result outperformed feature-led messaging by 41% on install conversion.',
      metric: 'install_conversion', delta_pct: 41, window: '2026-05-01..2026-06-01',
    },
    source: 'campaign_performance', confidence: 0.88, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_feature_positioning_rejected', id: u(2),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'founder',
    title: 'Founder rejected feature-list positioning',
    content: {
      claim: 'Founder explicitly rejected positioning the product as a feature list; wants the outcome stated first.',
      rejected_recommendation: 'feature_grid_landing_page',
    },
    source: 'founder_feedback', confidence: 0.95, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_reliability_emphasis', id: u(3),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'brand',
    title: 'Reliability is the core brand promise',
    content: {
      claim: 'Reliability is emphasised because review analysis showed cancelled and late appointments are the top complaint.',
      derived_from: 'review_theme_analysis',
    },
    source: 'review', confidence: 0.79, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_discount_underperformed', id: u(4),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'Discount-led messaging underperformed',
    content: {
      claim: 'Price-discount creative produced more clicks but 34% fewer completed bookings than outcome-led creative.',
      metric: 'completed_bookings', delta_pct: -34,
    },
    source: 'campaign_performance', confidence: 0.72, status: 'active', version: 1,
  },

  // ── B. Audience / ICP ───────────────────────────────────────────────────────
  {
    fixture_id: 'memory_icp_primary', id: u(5),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'customer',
    title: 'Primary audience is time-poor homeowners aged 30-55',
    content: {
      claim: 'The primary audience is homeowners aged 30-55 who lack time for household maintenance and will pay for reliability.',
    },
    source: 'intake', confidence: 0.86, status: 'active', version: 2,
  },
  {
    fixture_id: 'memory_icp_changed', id: u(6),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'founder',
    title: 'Founder changed target audience from renters to homeowners',
    content: {
      claim: 'The founder corrected the original renter-focused audience to homeowners after early bookings skewed to owners.',
      previous_value: 'urban renters 22-35', new_value: 'homeowners 30-55',
    },
    source: 'founder_feedback', confidence: 0.93, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_enterprise_segment', id: u(7),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'customer',
    title: 'Property-manager segment has higher lifetime value',
    content: {
      claim: 'Property managers book 4.2x more jobs per account than individual homeowners, though they take longer to close.',
      segment: 'enterprise',
    },
    source: 'analytics', confidence: 0.74, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_retention_signal', id: u(8),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'customer',
    title: 'Repeat booking within 30 days predicts retention',
    content: {
      claim: 'Accounts that book a second job within 30 days retain at 3.1x the rate of single-job accounts.',
    },
    source: 'analytics', confidence: 0.81, status: 'active', version: 1,
  },

  // ── C. Channel performance (contains the contradiction pair) ────────────────
  {
    fixture_id: 'memory_search_beats_meta', id: u(9),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'Search converts better than Meta',
    content: {
      claim: 'Search converts better than Meta overall, at roughly half the cost per booking.',
      channels: ['google_ads', 'meta'],
    },
    source: 'campaign_performance', confidence: 0.83, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_search_worse_enterprise', id: u(10),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'Search converts worse than Meta for enterprise customers',
    content: {
      claim: 'For property-manager accounts Search converts worse than Meta; Meta retargeting closes the longer enterprise cycle.',
      channels: ['google_ads', 'meta'], segment: 'enterprise',
    },
    source: 'campaign_performance', confidence: 0.69, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_paid_social_low_quality', id: u(11),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'Paid social produces lower-quality signups',
    content: {
      claim: 'Paid social signups complete a first booking 2.4x less often than search signups.',
      channel: 'meta',
    },
    source: 'analytics', confidence: 0.77, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_search_high_intent', id: u(12),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'High-intent search keywords produce the best cost per booking',
    content: {
      claim: 'Keywords containing "emergency" or "same day" produce the lowest cost per completed booking.',
      channel: 'google_ads',
    },
    source: 'campaign_performance', confidence: 0.85, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_meta_creative_fatigue', id: u(13),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'creative',
    title: 'Meta creative fatigues above frequency 3',
    content: {
      claim: 'Meta creative stops converting once frequency passes 3.0; spend continues without attributed bookings.',
      channel: 'meta', threshold: 3.0,
    },
    source: 'campaign_performance', confidence: 0.8, status: 'active', version: 1,
  },

  // ── D. Campaign learning ────────────────────────────────────────────────────
  {
    fixture_id: 'memory_campaign_b_winner', id: u(14),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'Campaign B outperformed Campaign A on completed bookings',
    content: {
      claim: 'Campaign B (outcome-led, homeowner audience) beat Campaign A on completed bookings at equal spend.',
    },
    source: 'campaign_performance', confidence: 0.84, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_experiment_cta', id: u(15),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'experiment',
    title: 'CTA experiment changed the recommended landing flow',
    content: {
      claim: 'A "Book a visit" CTA beat "Get a quote" by 22%, which changed the recommended landing flow.',
      changed_recommendation: true,
    },
    source: 'experiment', confidence: 0.87, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_belief_superseded_whatsapp', id: u(16),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'campaign',
    title: 'WhatsApp was believed to be the primary channel',
    content: {
      claim: 'WhatsApp was previously believed to be the primary acquisition channel; superseded once search data arrived.',
      superseded_by: 'memory_search_high_intent',
    },
    source: 'growth_brain', confidence: 0.35, status: 'archived', version: 3,
  },

  // ── E. Founder preferences ──────────────────────────────────────────────────
  {
    fixture_id: 'memory_approval_preference', id: u(17),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'founder',
    title: 'Founder requires approval before any paid spend',
    content: {
      claim: 'All paid campaigns require explicit founder approval before launch; no autonomous spend under any condition.',
    },
    source: 'founder_feedback', confidence: 0.99, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_no_autonomous_budget', id: u(18),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'founder',
    title: 'LaunchMind must not change budgets automatically',
    content: {
      claim: 'Budget changes must never be applied automatically; LaunchMind may only propose them.',
    },
    source: 'founder_feedback', confidence: 0.97, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_direction_confirmed', id: u(19),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'founder',
    title: 'Founder confirmed retention over acquisition for this quarter',
    content: {
      claim: 'The founder confirmed the strategic direction: prioritise retention of existing accounts over new acquisition.',
    },
    source: 'founder_feedback', confidence: 0.96, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_founder_rejected_india', id: u(20),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'founder',
    title: 'Founder rejected the India market recommendation',
    content: {
      claim: 'The founder rejected launching in India this year: no local operations capacity to fulfil bookings.',
      rejected_recommendation: 'launch_india',
    },
    source: 'founder_feedback', confidence: 0.94, status: 'active', version: 1,
  },

  // ── F/G. Supporting corpus ──────────────────────────────────────────────────
  {
    fixture_id: 'memory_review_theme_reliability', id: u(21),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'review',
    title: 'Reviews cluster around late and cancelled appointments',
    content: {
      claim: 'The largest negative review theme is late or cancelled appointments, ahead of price.',
    },
    source: 'review', confidence: 0.82, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_competitor_pricing', id: u(22),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'competitor',
    title: 'Main competitor undercuts on headline price',
    content: {
      claim: 'The main competitor advertises a lower headline price but charges call-out fees at booking.',
    },
    source: 'intake', confidence: 0.66, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_seasonality_summer', id: u(23),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'seasonality',
    title: 'Demand spikes in early summer',
    content: { claim: 'Booking demand rises sharply in May and June, driven by outdoor and cooling jobs.' },
    source: 'analytics', confidence: 0.7, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_low_confidence_market', id: u(24),
    founder_id: FOUNDER_A, product_id: PRODUCT_A, memory_type: 'market',
    title: 'Market may be shifting to subscription maintenance plans',
    content: { claim: 'Weak signal that competitors are testing subscription maintenance plans. Not yet corroborated.' },
    source: 'growth_brain', confidence: 0.21, status: 'active', version: 1,
  },

  // ── Workspace B — leakage canaries (deliberate near-duplicates) ──────────────
  {
    fixture_id: 'memory_other_workspace_positioning', id: u(90),
    founder_id: FOUNDER_B, product_id: PRODUCT_B, memory_type: 'campaign',
    title: 'Outcome-led messaging increased conversion',
    content: { claim: 'A different tenant. Retrieving this for Founder A is a tenancy failure.' },
    source: 'campaign_performance', confidence: 0.99, status: 'active', version: 1,
  },
  {
    fixture_id: 'memory_other_workspace_search', id: u(91),
    founder_id: FOUNDER_B, product_id: PRODUCT_B, memory_type: 'campaign',
    title: 'Search converts better than Meta',
    content: { claim: 'A different tenant. Retrieving this for Founder A is a tenancy failure.' },
    source: 'campaign_performance', confidence: 0.99, status: 'active', version: 1,
  },
];

/** Learning events — the "why did the belief change" surface. */
export const LEARNING_EVENTS = [
  {
    fixture_id: 'learning_channel_belief_change', id: u(50),
    founder_id: FOUNDER_A, product_id: PRODUCT_A,
    event_type: 'campaign_result', status: 'completed',
    payload: {
      summary: 'Search outperformed WhatsApp on cost per booking, superseding the WhatsApp-primary belief.',
      prior_belief: 'memory_belief_superseded_whatsapp',
      new_belief: 'memory_search_high_intent',
    },
  },
  {
    fixture_id: 'learning_experiment_cta', id: u(51),
    founder_id: FOUNDER_A, product_id: PRODUCT_A,
    event_type: 'experiment_result', status: 'completed',
    payload: {
      summary: 'CTA experiment concluded; recommended landing flow changed to "Book a visit".',
      new_belief: 'memory_experiment_cta',
    },
  },
];

/** Evidence rows backing two memories, used to test provenance retrieval. */
export const EVIDENCE = [
  {
    fixture_id: 'evidence_outcome_positioning', id: u(60),
    founder_id: FOUNDER_A, product_id: PRODUCT_A,
    evidence_type: 'campaign_metric', source_table: 'campaign_metrics',
    data: { metric: 'install_conversion', control: 0.031, variant: 0.0437, n: 5820 },
    confidence_boost: 0.15,
  },
];

/** fixture_id → uuid, for the dataset's expected-result labels. */
export const FIXTURE_IDS: Record<string, string> = Object.fromEntries([
  ...MEMORIES.map(m => [m.fixture_id, m.id]),
  ...LEARNING_EVENTS.map(e => [e.fixture_id, e.id]),
  ...EVIDENCE.map(e => [e.fixture_id, e.id]),
]);

/** uuid → fixture_id, for turning retrieval output back into readable labels. */
export const ID_TO_FIXTURE: Record<string, string> = Object.fromEntries(
  Object.entries(FIXTURE_IDS).map(([k, v]) => [v, k]),
);

// ── Seeding ───────────────────────────────────────────────────────────────────

/**
 * Refuses to seed anywhere that is not a local, disposable Supabase.
 *
 * The corpus contains rows that would be indistinguishable from real memories in
 * a production Growth Brain, so the guard is a hard failure rather than a warning.
 *
 * @throws {Error} When the target URL is not loopback.
 */
export function assertLocalTarget(url: string): void {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) {
    throw new Error(
      `Retrieval eval refuses to seed a non-local Supabase (${url}). ` +
      'Point SUPABASE_URL at the local stack (http://127.0.0.1:54321).',
    );
  }
}

export function evalClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  assertLocalTarget(url);
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Inserts the corpus. Idempotent: deletes the fixture rows first, so a re-run
 * after a partial failure produces the same state rather than duplicates.
 */
export async function seedCorpus(db: SupabaseClient): Promise<void> {
  await clearCorpus(db);

  await db.from('founders').upsert([
    { id: FOUNDER_A, email: 'eval-a@retrieval.local', name: 'Eval Founder A' },
    { id: FOUNDER_B, email: 'eval-b@retrieval.local', name: 'Eval Founder B' },
  ]);
  await db.from('workspaces').upsert([
    { id: WORKSPACE_A, founder_id: FOUNDER_A, name: 'Eval Workspace A' },
    { id: WORKSPACE_B, founder_id: FOUNDER_B, name: 'Eval Workspace B' },
  ]);
  await db.from('products').upsert([
    { id: PRODUCT_A, founder_id: FOUNDER_A, workspace_id: WORKSPACE_A, name: 'HomeFix', store_url: 'https://apps.apple.com/app/id000000001', platform: 'app_store' },
    { id: PRODUCT_B, founder_id: FOUNDER_B, workspace_id: WORKSPACE_B, name: 'OtherCo', store_url: 'https://apps.apple.com/app/id000000002', platform: 'app_store' },
  ]);

  // Migration 088 made these tables workspace-owned. founder_id is retained as
  // attribution, so both are written.
  const workspaceFor = (founderId: string) => (founderId === FOUNDER_A ? WORKSPACE_A : WORKSPACE_B);

  const { error } = await db.from('marketing_memories').insert(
    MEMORIES.map(({ fixture_id: _fixture_id, ...row }) => ({
      ...row, workspace_id: workspaceFor(row.founder_id),
    })),
  );
  if (error) throw new Error(`seed marketing_memories failed: ${error.message}`);

  await db.from('learning_events').insert(
    LEARNING_EVENTS.map(({ fixture_id: _f, ...row }) => ({
      ...row, workspace_id: workspaceFor(row.founder_id),
    })),
  );
  await db.from('evidence').insert(
    EVIDENCE.map(({ fixture_id: _f, ...row }) => ({
      ...row, workspace_id: workspaceFor(row.founder_id),
    })),
  );
}

/**
 * Removes every fixture row. Scoped to the two eval founders only.
 *
 * Append-only history (migration 091) refuses ordinary DELETEs, and deleting a
 * product CASCADES into `evidence` — so a plain delete fails with
 * "append-only: evidence rows cannot be deleted". The sanctioned erasure RPC is
 * used instead, exactly as the account-deletion path does. Working around the
 * trigger here would have meant weakening it for everyone.
 */
/**
 * LOGICAL corpus reset. Does NOT invalidate the embedding cache.
 *
 * This used to delete every eval vector on every run, forcing a full live
 * re-embed under a 3 req/min limit that could never complete — which is how the
 * corpus ended up at 0/26 while benchmarks still published HYBRID scores.
 *
 * Vectors are keyed by (source_type, source_id, source_field, model, version)
 * and content-hashed, so a re-seed of identical fixture content reuses them and
 * ANY change to content, model or rendering produces a different identity and
 * re-embeds naturally. Deleting them wholesale was never what made the reset
 * correct; it only made it expensive.
 *
 * Use `invalidateEmbeddingCache()` when the contract itself must change.
 */
export async function clearCorpus(db: SupabaseClient): Promise<void> {
  const founders = [FOUNDER_A, FOUNDER_B];

  // Outbox rows ARE cleared: they are transient work, not reusable artifacts.
  await db.from('embedding_outbox').delete().in('workspace_id', [WORKSPACE_A, WORKSPACE_B]);
  // Outbox rows for products carry the workspace, but product_icp jobs created
  // before a workspace existed would not; clear by source id as well.
  await db.from('embedding_outbox').delete().in('source_id', [PRODUCT_A, PRODUCT_B]);

  for (const founderId of founders) {
    // Deletes evidence, learning_events, versions and memories in one flagged
    // transaction. Tolerated if absent so the harness still runs on a database
    // predating migration 091.
    await db.rpc('lm_erase_founder_history', { p_founder_id: founderId });
  }

  for (const table of ['products', 'workspaces']) {
    await db.from(table).delete().in('founder_id', founders);
  }
  await db.from('founders').delete().in('id', founders);
}

/**
 * Destroys eval vectors. Separate from `clearCorpus` on purpose: this is the
 * only operation that should cost provider quota, and it must be a deliberate
 * act taken when the embedding CONTRACT changes — never a side effect of
 * re-seeding fixture rows.
 */
export async function invalidateEmbeddingCache(db: SupabaseClient): Promise<void> {
  await db.from('memory_embeddings').delete().in('workspace_id', [WORKSPACE_A, WORKSPACE_B]);
}
