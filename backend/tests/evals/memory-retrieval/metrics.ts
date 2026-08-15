/**
 * @file metrics.ts
 * @description Ranking metrics and deterministic failure classification for the
 *   retrieval evaluation.
 *
 *   Kept separate from the runner so the same functions score the current lexical
 *   baseline and the later hybrid retriever without either being able to redefine
 *   what "recall" means in its own favour.
 *
 * @security No I/O, no secrets.
 * @dependencies dataset.ts
 */

import type { EvalQuery } from './dataset';

/** One retrieved item, reduced to what scoring needs. */
export interface RetrievedItem {
  /** fixture_id when resolvable, otherwise a stable label for reporting. */
  fixture_id: string | null;
  title: string;
}

export interface QueryScore {
  id: string;
  category: string;
  expected_baseline: string;
  returned: number;
  /** required ∩ returned, over |required| */
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  /** 1/rank of the first required hit, else 0 */
  reciprocalRank: number;
  /** returned items that are neither required nor acceptable, over returned */
  irrelevantRate: number;
  /** count of must_not_include items returned */
  leakage: number;
  latencyMs: number;
  failure: FailureCategory | null;
  missing: string[];
}

export type FailureCategory =
  | 'query_error'
  | 'wording_mismatch'
  | 'jsonb_structure_mismatch'
  | 'stale_memory'
  | 'confidence_ordering'
  | 'taxonomy_mismatch'
  | 'workspace_filter'
  | 'contradictory_claims'
  | 'no_targeted_retrieval'
  | 'missing_index'
  | 'other';

const STOP = new Set([
  'what','who','why','when','how','the','a','an','is','are','do','does','did','has','have',
  'we','our','us','it','to','for','of','in','on','and','or','about','before','best','better',
  'that','this','they','them','with','from','been','was','were','be','can','should','would',
  'launchmind','any','more','most','you','your','their','there','here','than','then','into',
]);

/** Lowercased content words, used only for failure classification. */
export function terms(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter(t => t.length > 2 && !STOP.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** Recall@k where recall is over the REQUIRED set, not over everything relevant. */
function recallAt(required: string[], returned: RetrievedItem[], k: number): number {
  if (required.length === 0) return 1;
  const top = new Set(returned.slice(0, k).map(r => r.fixture_id).filter(Boolean) as string[]);
  return required.filter(r => top.has(r)).length / required.length;
}

export interface ClassifyContext {
  /** fixture_id → the stored title, for wording-overlap analysis. */
  titles: Record<string, string>;
  /** fixture_id → status, to detect archived-but-required records. */
  statuses: Record<string, string>;
  /** fixture_id → whether the record lives in a table this arm can reach at all. */
  reachable: Record<string, boolean>;
  /** True when the arm ignores the query entirely (Context Engine). */
  queryAgnostic: boolean;
  /**
   * Set when the retrieval call itself failed rather than returning a poor
   * ranking. Attributing a query that never executed to "wording_mismatch" would
   * name a cause that was never reached, and would hide a defect inside a
   * plausible-looking relevance statistic.
   */
  forcedFailure?: FailureCategory;
}

/**
 * Assigns one failure category per failing query.
 *
 * Deterministic and ordered by specificity: a tenancy breach outranks a ranking
 * complaint, because reporting a leak as "confidence_ordering" would bury it.
 */
export function classifyFailure(
  q: EvalQuery,
  returned: RetrievedItem[],
  missing: string[],
  ctx: ClassifyContext,
): FailureCategory {
  const canaries = new Set(q.expected.must_not_include ?? []);
  if (returned.some(r => r.fixture_id && canaries.has(r.fixture_id))) return 'workspace_filter';

  if (ctx.forcedFailure) return ctx.forcedFailure;
  if (ctx.queryAgnostic) return 'no_targeted_retrieval';

  // A required record in a table this retrieval arm never reads.
  if (missing.some(m => ctx.reachable[m] === false)) return 'taxonomy_mismatch';

  // A required record excluded by a status filter rather than by relevance.
  if (missing.some(m => ctx.statuses[m] && ctx.statuses[m] !== 'active')) return 'stale_memory';

  // Returned somewhere, just not high enough.
  const returnedIds = new Set(returned.map(r => r.fixture_id).filter(Boolean) as string[]);
  if (missing.every(m => returnedIds.has(m))) return 'confidence_ordering';

  // Both halves of a contradiction were required and only one came back.
  if (q.category === 'contradiction' && missing.length < q.expected.required.length) {
    return 'contradictory_claims';
  }

  const qTerms = terms(q.query);
  const anyTitleOverlap = missing.some(m => overlap(qTerms, terms(ctx.titles[m] ?? '')) > 0);
  // No token shared with the stored title is the paraphrase case the whole
  // semantic upgrade exists to fix.
  if (!anyTitleOverlap) return 'wording_mismatch';

  // Terms exist in the title but the query as a single ILIKE pattern cannot match
  // them, because the pattern is the whole phrase rather than its terms.
  return 'jsonb_structure_mismatch';
}

export function scoreQuery(
  q: EvalQuery,
  returned: RetrievedItem[],
  latencyMs: number,
  ctx: ClassifyContext,
): QueryScore {
  const required   = q.expected.required;
  const acceptable = new Set([...(q.expected.acceptable ?? []), ...required]);
  const canaries   = new Set(q.expected.must_not_include ?? []);

  const ids = returned.map(r => r.fixture_id);
  const firstHit = ids.findIndex(id => id && required.includes(id));

  const returnedIds = new Set(ids.filter(Boolean) as string[]);
  const missing = required.filter(r => !returnedIds.has(r));

  const irrelevant = returned.filter(r => !r.fixture_id || !acceptable.has(r.fixture_id)).length;
  const leakage = returned.filter(r => r.fixture_id && canaries.has(r.fixture_id)).length;

  const recall5 = recallAt(required, returned, 5);

  return {
    id: q.id,
    category: q.category,
    expected_baseline: q.expected_baseline,
    returned: returned.length,
    recallAt1: recallAt(required, returned, 1),
    recallAt3: recallAt(required, returned, 3),
    recallAt5: recall5,
    reciprocalRank: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
    irrelevantRate: returned.length ? irrelevant / returned.length : 0,
    leakage,
    latencyMs,
    failure: recall5 === 1 && leakage === 0 ? null : classifyFailure(q, returned, missing, ctx),
    missing,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: for p95 of 32 samples this is the 31st, which is the honest
  // "worst but one" rather than an interpolated value no query actually saw.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
