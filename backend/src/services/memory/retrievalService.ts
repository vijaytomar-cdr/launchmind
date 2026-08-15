/**
 * @file retrievalService.ts
 * @description LaunchMind's hybrid Marketing Memory retrieval — Phase 3.1D.
 *
 *   Three independent arms, deterministic rank fusion, then business-aware
 *   reranking:
 *
 *     STRUCTURED  hard filters (workspace, product, type, lifecycle). Always
 *                 runs, is never ranked, and is what remains when both ranked
 *                 arms are unavailable.
 *     LEXICAL     Postgres full-text (`websearch_to_tsquery` + `ts_rank_cd`).
 *     SEMANTIC    exact pgvector scan over CURRENT embeddings only.
 *
 *   THIS SERVICE NEVER WRITES. ADR-066 invariant 3: similarity may nominate and
 *   rank, and may never merge, supersede, mark duplicates or contradictions,
 *   adjust confidence, or emit learning events. There is no mutation import in
 *   this file, and `retrievalNoWrite.test.ts` asserts that structurally rather
 *   than trusting review.
 *
 *   NO VENDOR APPEARS HERE. Query embedding goes through `EmbeddingProvider`
 *   (Step 3.1D §9); this file does not know Voyage exists.
 *
 *   WHY RRF AND NOT A WEIGHTED SCORE SUM: `ts_rank_cd` is an unbounded relevance
 *   score whose scale depends on document length and term frequency; cosine
 *   distance is bounded [0,2] and behaves nothing like it. Adding or weighting
 *   them requires a normalisation constant that is really a hidden tuning
 *   parameter, silently different for every corpus. Reciprocal Rank Fusion uses
 *   only RANK, so the two arms become commensurable by construction and the
 *   result is reproducible.
 *
 * @security Every query is workspace-filtered inside SQL, before ranking and
 *   before any distance operator — never post-filtered in application code,
 *   which would let another tenant's rows occupy the candidate budget even if
 *   they were later dropped.
 * @dependencies marketing_memories, memory_embeddings, lm_search_memory_*,
 *   EmbeddingProvider
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import type { EmbeddingProvider } from '../../types/embedding';
import { resolveEmbeddingProvider } from './providers';
import {
  RETRIEVAL_BUDGETS, ANN_REVIEW_THRESHOLDS, estimateTokens,
  type RetrievalRequest, type RetrievalResult, type RetrievedMemory,
  type ArmStatus, type RetrievalMode, type RetrievalArm,
} from './retrievalTypes';

/**
 * RRF constant. 60 is the value from the original Cormack et al. formulation and
 * is used unchanged: it is deliberately NOT tuned against this benchmark, because
 * a constant fitted to 32 queries would be overfitting dressed as configuration.
 */
import { AUTHORITY_RETRIEVAL_WEIGHT } from './authorityPolicy';

const RRF_K = 60;

/** Weight per arm inside fusion. Equal — neither arm is presumed better a priori. */
const ARM_WEIGHTS: Record<'lexical' | 'semantic', number> = { lexical: 1.0, semantic: 1.0 };

/**
 * Bounded in-process cache of QUERY embeddings (Step 3.1D §9, "caching only if
 * justified").
 *
 * Justified on two counts. Operationally, a query embedding is one provider
 * request on a rate-limited account, and owners ask the same questions —
 * "what's working?", "why did that change?" — repeatedly. Architecturally, the
 * benchmark re-runs 32 fixed queries, and without a cache its measured latency
 * is dominated by client-side rate-limit pacing rather than by retrieval.
 *
 * Keyed by the embedding FAMILY as well as the text, so a model change cannot
 * serve a vector from the previous model. Bounded and TTL'd because the key is
 * owner-typed text: it lives in memory only, is never written to a table, and
 * ages out rather than accumulating (§9 forbids persisting owner queries).
 */
const QUERY_CACHE_MAX = 200;
const QUERY_CACHE_TTL_MS = 15 * 60_000;
const _queryCache = new Map<string, { vector: number[]; at: number }>();

function cacheGet(key: string): number[] | null {
  const hit = _queryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > QUERY_CACHE_TTL_MS) { _queryCache.delete(key); return null; }
  // Refresh recency for the LRU eviction below.
  _queryCache.delete(key); _queryCache.set(key, hit);
  return hit.vector;
}

function cacheSet(key: string, vector: number[]): void {
  if (_queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = _queryCache.keys().next().value;
    if (oldest !== undefined) _queryCache.delete(oldest);
  }
  _queryCache.set(key, { vector, at: Date.now() });
}

/** Test seam: clears the cache so latency measurements start cold. */
export function __clearQueryEmbeddingCache(): void { _queryCache.clear(); }

/**
 * Test/measurement support: seeds the query-embedding cache.
 *
 * Exists because an offline evaluation over N queries otherwise needs N provider
 * calls, and a rate-limited tier (3 req/min) turns that into a rate-limit
 * measurement rather than a retrieval measurement — the semantic arm degrades and
 * the numbers silently become lexical. Priming from ONE batched call lets a
 * harness exercise the real hybrid path without fighting the limiter.
 *
 * Never called by production code; retrieval computes and caches its own vectors.
 *
 * @param key `${model}:${version}:${dimensions}:${query}` — the exact key
 *   `retrieveMemories` composes.
 */
export function __primeQueryEmbeddingCache(key: string, vector: number[]): void {
  cacheSet(key, vector);
}

interface Candidate {
  id: string;
  lexicalRank: number | null;
  semanticRank: number | null;
  semanticDistance: number | null;
}

/** A row as stored, before it becomes a RetrievedMemory. */
interface MemoryRow {
  id: string; workspace_id: string; product_id: string | null;
  memory_type: string; title: string; content: Record<string, unknown> | null;
  confidence: number; version: number; status: string; source: string;
  evidence_ids: string[] | null; created_at: string; updated_at: string;
}

// ── Business reranking (Step 3.1D §6) ────────────────────────────────────────

/**
 * Source precedence from ADR-066 rule 28, as a multiplier.
 *
 * The rule the reranker exists to enforce: a founder saying "we will not launch
 * in India" must not be ranked below an inferred market memory merely because
 * the inference is worded more like the question. Similarity is about phrasing;
 * precedence is about authority, and authority wins.
 */
/**
 * LEGACY source-quality weighting. Applies ONLY to rows with no persisted
 * `authority_tier`.
 *
 * Codex review: this was a THIRD independent authority table. Its unknown-source
 * default of 1.0 silently ranked a governed `public_official` row (VERIFIED_EXTERNAL)
 * BELOW `review` (1.05), because migration-107 sources were never added here.
 * Governed rows now weight on authority tier via AUTHORITY_RETRIEVAL_WEIGHT.
 *
 * Values are unchanged so certified retrieval behaviour for legacy rows is
 * preserved exactly.
 */
const LEGACY_SOURCE_PRECEDENCE: Record<string, number> = {
  founder_feedback:     1.60,   // founder-confirmed
  experiment:           1.25,   // measured, controlled
  campaign_performance: 1.20,   // observed first-party outcome
  analytics:            1.15,
  review:               1.05,   // verified external observation
  intake:               1.00,
  ai_conversation:      0.90,   // derived inference
  growth_brain:         0.85,
};

/** Lifecycle multiplier. Archived rows are excluded upstream; this is defensive. */
const STATUS_WEIGHT: Record<string, number> = { active: 1.0, draft: 0.7, archived: 0.4 };

/**
 * Recency, as a gentle decay rather than a cliff.
 *
 * Marketing truths age, but they do not expire on a birthday. A 180-day
 * half-life keeps a six-month-old finding at ~0.5 of its weight instead of
 * dropping it out of contention, which would silently erase everything learned
 * before the current quarter.
 */
function recencyWeight(updatedAt: string, now: number): number {
  const ageDays = Math.max(0, (now - Date.parse(updatedAt)) / 86_400_000);
  return 0.5 + 0.5 * Math.pow(0.5, ageDays / 180);
}

// ── Arms ─────────────────────────────────────────────────────────────────────

async function structuredArm(
  req: RetrievalRequest,
): Promise<{ rows: MemoryRow[]; status: ArmStatus }> {
  const t0 = Date.now();
  const db = getSupabaseAdmin();

  let q = db.from('marketing_memories')
    .select('id, workspace_id, product_id, memory_type, title, content, confidence, version, status, source, authority_tier, evidence_ids, created_at, updated_at')
    .eq('workspace_id', req.workspaceId);                 // tenancy, in SQL

  if (req.productId)   q = q.eq('product_id', req.productId);
  if (req.memoryTypes?.length) q = q.in('memory_type', req.memoryTypes);
  q = q.in('status', req.statuses?.length ? req.statuses : ['active']);

  const { data, error } = await q;
  const latencyMs = Date.now() - t0;

  if (error) {
    return { rows: [], status: { arm: 'structured', ran: false, candidates: 0, latencyMs } };
  }
  const rows = (data ?? []) as unknown as MemoryRow[];
  return { rows, status: { arm: 'structured', ran: true, candidates: rows.length, latencyMs } };
}

async function lexicalArm(
  req: RetrievalRequest,
): Promise<{ ranked: Array<{ id: string; rank: number }>; status: ArmStatus }> {
  const t0 = Date.now();
  if (req.disableLexical) {
    return { ranked: [], status: { arm: 'lexical', ran: false, candidates: 0, latencyMs: 0, unavailableReason: 'DISABLED_BY_CALLER' } };
  }

  const { data, error } = await getSupabaseAdmin().rpc('lm_search_memory_fulltext', {
    p_workspace_id: req.workspaceId,
    p_query:        req.query,
    p_product_id:   req.productId ?? null,
    p_memory_types: req.memoryTypes?.length ? req.memoryTypes : null,
    p_statuses:     req.statuses?.length ? req.statuses : ['active'],
    p_limit:        RETRIEVAL_BUDGETS.maxCandidatesPerArm,
  });
  const latencyMs = Date.now() - t0;

  if (error) {
    // Surfaced as an unavailable arm, never as an empty success — the 3.1A defect.
    Sentry.captureMessage('retrieval lexical arm failed', { level: 'warning', tags: { code: error.code ?? 'unknown' } });
    return { ranked: [], status: { arm: 'lexical', ran: false, candidates: 0, latencyMs, unavailableReason: 'LEXICAL_SQL_FAILED' } };
  }

  const ranked = ((data ?? []) as Array<{ id: string }>).map((r, i) => ({ id: r.id, rank: i + 1 }));
  return { ranked, status: { arm: 'lexical', ran: true, candidates: ranked.length, latencyMs } };
}

async function semanticArm(
  req: RetrievalRequest,
  provider: EmbeddingProvider | null,
  contract: { model: string; version: number; dimensions: number } | null,
): Promise<{
  ranked: Array<{ id: string; rank: number; distance: number }>;
  status: ArmStatus; queryEmbeddingMs: number;
}> {
  const none = (reason: ArmStatus['unavailableReason'], latencyMs = 0, qMs = 0) => ({
    ranked: [], queryEmbeddingMs: qMs,
    status: { arm: 'semantic' as RetrievalArm, ran: false, candidates: 0, latencyMs, unavailableReason: reason },
  });

  if (req.disableSemantic) return none('DISABLED_BY_CALLER');
  if (!provider || !contract) return none('PROVIDER_UNCONFIGURED');

  // Query embedding goes through the provider abstraction (§9). A failure here
  // must degrade to lexical, never fail the request.
  const qt0 = Date.now();
  const cacheKey = `${contract.model}:${contract.version}:${contract.dimensions}:${req.query}`;
  let vector: number[];
  const cached = cacheGet(cacheKey);
  if (cached) {
    vector = cached;
  } else try {
    const v = await provider.embedOne(req.query);
    if (v.dimensions !== contract.dimensions) {
      // Mismatched width would raise inside Postgres at the distance operator;
      // catching it here keeps the failure legible.
      return none('QUERY_EMBEDDING_FAILED', 0, Date.now() - qt0);
    }
    vector = v.vector;
    cacheSet(cacheKey, vector);
  } catch {
    // Deliberately no detail: the message could carry the owner's query text.
    return none('QUERY_EMBEDDING_FAILED', 0, Date.now() - qt0);
  }
  const queryEmbeddingMs = Date.now() - qt0;

  const t0 = Date.now();
  const { data, error } = await getSupabaseAdmin().rpc('lm_search_memory_embeddings', {
    p_workspace_id: req.workspaceId,
    p_query_vector: `[${vector.join(',')}]`,
    p_model:        contract.model,
    p_version:      contract.version,
    p_dimensions:   contract.dimensions,
    p_limit:        RETRIEVAL_BUDGETS.maxCandidatesPerArm,
  });
  const latencyMs = Date.now() - t0;

  if (error) {
    Sentry.captureMessage('retrieval semantic arm failed', { level: 'warning', tags: { code: error.code ?? 'unknown' } });
    return { ...none('SEMANTIC_SQL_FAILED', latencyMs, queryEmbeddingMs) };
  }

  const rows = (data ?? []) as Array<{ source_id: string; distance: number }>;
  if (rows.length === 0) {
    return { ranked: [], queryEmbeddingMs, status: { arm: 'semantic', ran: true, candidates: 0, latencyMs, unavailableReason: 'NO_CURRENT_EMBEDDINGS' } };
  }

  return {
    ranked: rows.map((r, i) => ({ id: r.source_id, rank: i + 1, distance: r.distance })),
    queryEmbeddingMs,
    status: { arm: 'semantic', ran: true, candidates: rows.length, latencyMs },
  };
}

// ── Fusion ───────────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion: score = Σ weight / (K + rank).
 *
 * Ties break on id so the same inputs always produce the same order — a
 * benchmark whose ordering wobbles between runs cannot detect a regression.
 */
function fuse(
  lexical: Array<{ id: string; rank: number }>,
  semantic: Array<{ id: string; rank: number; distance: number }>,
): Array<Candidate & { score: number }> {
  const by = new Map<string, Candidate & { score: number }>();
  const ensure = (id: string) => {
    let c = by.get(id);
    if (!c) { c = { id, lexicalRank: null, semanticRank: null, semanticDistance: null, score: 0 }; by.set(id, c); }
    return c;
  };

  for (const { id, rank } of lexical) {
    const c = ensure(id);
    c.lexicalRank = rank;
    c.score += ARM_WEIGHTS.lexical / (RRF_K + rank);
  }
  for (const { id, rank, distance } of semantic) {
    const c = ensure(id);
    c.semanticRank = rank;
    c.semanticDistance = distance;
    c.score += ARM_WEIGHTS.semantic / (RRF_K + rank);
  }

  return [...by.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieves Marketing Memory for one workspace.
 *
 * @param req.workspaceId Verified by the caller; re-applied here as a hard filter.
 * @param providerOverride Test seam only.
 * @returns Evidence-bearing records plus full retrieval provenance. Never throws
 *   for a retrieval failure — the failure is reported in `mode`/`degraded` so a
 *   caller can distinguish "nothing relevant" from "subsystem down".
 */
export async function retrieveMemories(
  req: RetrievalRequest,
  providerOverride?: EmbeddingProvider,
): Promise<RetrievalResult> {
  const started = Date.now();
  const db = getSupabaseAdmin();
  const limit = Math.min(req.limit ?? RETRIEVAL_BUDGETS.maxFinalResults, RETRIEVAL_BUDGETS.maxFinalResults);
  const tokenBudget = req.tokenBudget ?? RETRIEVAL_BUDGETS.defaultTokenBudget;

  // Active embedding contract. Absent or disabled ⇒ semantic simply does not run.
  let contract: { model: string; version: number; dimensions: number } | null = null;
  try {
    const { data } = await db.from('embedding_contract')
      .select('model, embedding_version, dimensions, generation_enabled').eq('id', 1).maybeSingle();
    const c = data as { model: string; embedding_version: number; dimensions: number; generation_enabled: boolean } | null;
    if (c && c.model !== 'unconfigured') {
      contract = { model: c.model, version: c.embedding_version, dimensions: c.dimensions };
    }
  } catch { /* treated as no contract */ }

  let provider: EmbeddingProvider | null = providerOverride ?? null;
  if (!provider && contract) {
    try { provider = resolveEmbeddingProvider().provider; } catch { provider = null; }
  }

  // Arms run independently and concurrently: one failing must not delay or
  // prevent the others.
  const [structured, lexical, semantic] = await Promise.all([
    structuredArm(req),
    lexicalArm(req),
    semanticArm(req, provider, contract),
  ]);

  const fusionT0 = Date.now();
  const fused = fuse(lexical.ranked, semantic.ranked).slice(0, RETRIEVAL_BUDGETS.maxFusedCandidates);
  const fusionMs = Date.now() - fusionT0;

  // Structured rows are the authoritative record set; ranked arms only order
  // them. A candidate absent from the structured pass was filtered out by
  // tenancy/product/type/status and must NOT be returned even if an arm ranked
  // it — the arms' own filters and this one could otherwise disagree.
  const byId = new Map(structured.rows.map(r => [r.id, r]));

  // Vector currentness, for provenance on each result.
  const staleSet = new Set<string>();
  const currentSet = new Set<string>();
  const hashById = new Map<string, string>();
  try {
    const { data: embs } = await db.from('memory_embeddings')
      .select('source_id, status, content_hash')
      .eq('workspace_id', req.workspaceId).eq('source_type', 'marketing_memory');
    for (const e of (embs ?? []) as Array<{ source_id: string; status: string; content_hash: string }>) {
      if (e.status === 'current') currentSet.add(e.source_id);
      else if (e.status === 'stale') staleSet.add(e.source_id);
      hashById.set(e.source_id, e.content_hash);
    }
  } catch { /* provenance is best-effort; absence must not fail retrieval */ }

  const rerankT0 = Date.now();
  const now = Date.now();

  // ── TWO-STAGE (Option D1) ────────────────────────────────────────────────
  // STAGE 1 — RELEVANCE SELECTS MEMBERSHIP.
  //
  // MEASURED DEFECT IN THE PREVIOUS SINGLE-STAGE DESIGN: authority was an
  // unrestricted multiplier applied AFTER fusion. RRF (K=60) compresses
  // relevance hard — rank 1 = 1/61, rank 25 = 1/85, a ratio of 1.39 — while the
  // authority spread is 1.60/0.85 = 1.88. The multiplier was therefore wider
  // than the entire relevance range, and it was measured demoting the single
  // most relevant memory from fused rank 1 to final rank 6, and crowding a
  // highly relevant contradiction out of the result set entirely behind 14
  // loosely-related founder rows.
  //
  // `fused` is already ordered by relevance, so taking the head of it fixes
  // MEMBERSHIP before any authority factor is seen. Authority can then reorder
  // freely inside that set (stage 2) without being able to evict a relevant
  // memory in favour of an unselected one.
  //
  // A narrower multiplier was tried first and rejected: it preserved relevance
  // only by shrinking the spread until authority stopped separating genuine
  // relevance ties. Two-stage separates the two axes instead of trading them.
  const eligible = fused.filter(c => byId.has(c.id));
  const selectionSize = Math.max(
    req.limit ?? RETRIEVAL_BUDGETS.maxFinalResults,
    RETRIEVAL_BUDGETS.maxFinalResults,
  );
  const selected = eligible.slice(0, selectionSize);

  // STAGE 2 — AUTHORITY ORDERS WITHIN THE SELECTED SET.
  const scored = selected
    .map(c => {
      const row = byId.get(c.id)!;
      const reasons: string[] = [];

      // Authority tier when governed; legacy source table otherwise.
      const govTier = (row as { authority_tier?: string | null }).authority_tier;
      const precedence = govTier && govTier in AUTHORITY_RETRIEVAL_WEIGHT
        ? AUTHORITY_RETRIEVAL_WEIGHT[govTier as keyof typeof AUTHORITY_RETRIEVAL_WEIGHT]
        : (LEGACY_SOURCE_PRECEDENCE[row.source] ?? 1.0);
      if (precedence > 1.2) reasons.push(`source:${row.source} (precedence ×${precedence})`);
      if (precedence < 1.0) reasons.push(`source:${row.source} (derived, ×${precedence})`);

      const statusW = STATUS_WEIGHT[row.status] ?? 1.0;
      const recency = recencyWeight(row.updated_at, now);
      const conf = 0.5 + 0.5 * Number(row.confidence ?? 0.5);   // never zero out on low confidence

      const finalScore = c.score * precedence * statusW * recency * conf;
      return { c, row, finalScore, reasons };
    })
    .sort((a, b) => b.finalScore - a.finalScore || a.c.id.localeCompare(b.c.id));

  const rerankMs = Date.now() - rerankT0;

  // Budget: result count first, then token budget over canonical text.
  const results: RetrievedMemory[] = [];
  let tokensUsed = 0;
  let excludedForBudget = 0;

  for (let i = 0; i < scored.length; i++) {
    const { c, row, reasons } = scored[i];
    const claim = typeof row.content?.claim === 'string' ? (row.content.claim as string) : null;
    const cost = estimateTokens(`${row.title} ${claim ?? ''}`);

    if (results.length >= limit || tokensUsed + cost > tokenBudget) { excludedForBudget++; continue; }
    tokensUsed += cost;

    const arms: RetrievalArm[] = ['structured'];
    if (c.lexicalRank !== null) arms.push('lexical');
    if (c.semanticRank !== null) arms.push('semantic');

    results.push({
      id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
      memoryType: row.memory_type, title: row.title, claim, content: row.content ?? {},
      confidence: Number(row.confidence), version: row.version, status: row.status,
      source: row.source, evidenceIds: row.evidence_ids ?? [],
      createdAt: row.created_at, updatedAt: row.updated_at,
      contentHash: hashById.get(row.id) ?? null,
      embeddingStatus: currentSet.has(row.id) ? 'current' : staleSet.has(row.id) ? 'stale' : 'missing',
      arms, lexicalRank: c.lexicalRank, semanticRank: c.semanticRank,
      semanticDistance: c.semanticDistance,
      fusedScore: c.score, fusedRank: fused.findIndex(f => f.id === c.id) + 1,
      finalRank: results.length + 1, rerankReasons: reasons,
    });
  }

  // Mode and degradation.
  const degradedReasons: string[] = [];
  for (const s of [lexical.status, semantic.status]) {
    if (!s.ran && s.unavailableReason && s.unavailableReason !== 'DISABLED_BY_CALLER') {
      degradedReasons.push(`${s.arm}:${s.unavailableReason}`);
    }
  }

  let mode: RetrievalMode;
  if (lexical.status.ran && semantic.status.ran) mode = 'HYBRID';
  else if (lexical.status.ran)                   mode = 'LEXICAL_ONLY';
  else if (structured.status.ran)                mode = 'STRUCTURED_ONLY';
  else                                           mode = 'FAILED';

  // STRUCTURED_ONLY must still return something useful rather than an empty
  // list that reads as "no memory": fall back to the highest-confidence rows.
  if (mode === 'STRUCTURED_ONLY' && results.length === 0) {
    const fallback = [...structured.rows]
      .sort((a, b) => Number(b.confidence) - Number(a.confidence) || a.id.localeCompare(b.id))
      .slice(0, limit);
    for (const row of fallback) {
      const claim = typeof row.content?.claim === 'string' ? (row.content.claim as string) : null;
      results.push({
        id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
        memoryType: row.memory_type, title: row.title, claim, content: row.content ?? {},
        confidence: Number(row.confidence), version: row.version, status: row.status,
        source: row.source, evidenceIds: row.evidence_ids ?? [],
        createdAt: row.created_at, updatedAt: row.updated_at,
        contentHash: hashById.get(row.id) ?? null,
        embeddingStatus: currentSet.has(row.id) ? 'current' : staleSet.has(row.id) ? 'stale' : 'missing',
        arms: ['structured'], lexicalRank: null, semanticRank: null, semanticDistance: null,
        fusedScore: 0, fusedRank: 0, finalRank: results.length + 1,
        rerankReasons: ['structured fallback: ranked arms unavailable'],
      });
    }
  }

  // ADR-066 rule 14 — surface the threshold, never act on it.
  let annReviewDue = false;
  let annReviewReason: string | null = null;
  if (semantic.status.latencyMs > ANN_REVIEW_THRESHOLDS.semanticP95Ms) {
    annReviewDue = true;
    annReviewReason = `semantic arm ${semantic.status.latencyMs}ms exceeds ${ANN_REVIEW_THRESHOLDS.semanticP95Ms}ms`;
  }
  // Row count is emitted as an early warning but NO LONGER fires a review on its
  // own (ADR-066 Amendment 3): measured exact scan is ~5 ms at 25,000 vectors,
  // roughly 40× under the latency threshold the old volume trigger stood in for.
  const vectorRowsWarning = currentSet.size > ANN_REVIEW_THRESHOLDS.vectorRowsWarnOnly
    ? `${currentSet.size} vectors in this workspace (informational; not a trigger)`
    : null;
  if (!annReviewDue && vectorRowsWarning) annReviewReason = vectorRowsWarning;

  return {
    mode, results,
    arms: [structured.status, lexical.status, semantic.status],
    excludedForBudget, tokensUsed, tokenBudget,
    degraded: degradedReasons.length > 0,
    degradedReasons,
    timings: {
      structuredMs: structured.status.latencyMs,
      lexicalMs: lexical.status.latencyMs,
      semanticMs: semantic.status.latencyMs,
      queryEmbeddingMs: semantic.queryEmbeddingMs,
      fusionMs, rerankMs,
      totalMs: Date.now() - started,
    },
    diagnostics: {
      fusedCandidates: fused.length,
      staleVectorsExcluded: staleSet.size,
      missingVectors: structured.rows.filter(r => !currentSet.has(r.id) && !staleSet.has(r.id)).length,
      annReviewDue, annReviewReason,
    },
  };
}
