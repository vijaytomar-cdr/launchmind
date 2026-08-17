/**
 * @file retrievalTypes.ts
 * @description The RetrievalService contract — Phase 3.1D.
 *
 *   Kept separate from the implementation so callers (and the 3.1E Context
 *   Engine cutover) depend on the SHAPE, not on how the arms happen to work
 *   today. Nothing here mentions a vendor.
 *
 *   The core return type is an evidence-bearing DOMAIN RECORD, deliberately not
 *   a model-ready prose blob (Step 3.1D §4). Prose can only be audited by
 *   reading it; a record carries the canonical id, version and content hash, so
 *   "why did you recommend this?" is answerable by lookup rather than by trust.
 *
 * @security No I/O. `workspaceId` on a request is CONTEXT — the caller is
 *   responsible for having verified membership (ADR-066 rule 43); the service
 *   re-applies it as a hard filter regardless.
 * @dependencies types/memory
 */

/** Which arm produced a candidate. `structured` is the unranked filter pass. */
export const RETRIEVAL_ARMS = ['structured', 'lexical', 'semantic'] as const;
export type RetrievalArm = typeof RETRIEVAL_ARMS[number];

/**
 * What the system was actually able to do for this request.
 *
 * Reported on every response so a caller can tell a thin answer caused by a
 * degraded subsystem from a thin answer caused by a thin corpus. Conflating
 * those two is the exact failure 3.1A found in `searchMemories`, where a
 * Postgres error became `[]` and looked like "no matches".
 */
export const RETRIEVAL_MODES = [
  'HYBRID',        // lexical + semantic both contributed
  'LEXICAL_ONLY',  // semantic unavailable; full-text served the query
  'STRUCTURED_ONLY', // both ranked arms unavailable; filters still returned rows
  'FAILED',        // nothing could run — NOT the same as "nothing found"
] as const;
export type RetrievalMode = typeof RETRIEVAL_MODES[number];

/** Why an arm did not contribute. Surfaced, never swallowed. */
export interface ArmStatus {
  arm: RetrievalArm;
  ran: boolean;
  candidates: number;
  latencyMs: number;
  /** Machine-readable; never a provider payload or raw query text. */
  unavailableReason?:
    | 'QUERY_EMBEDDING_FAILED'
    | 'NO_CURRENT_EMBEDDINGS'
    | 'SEMANTIC_SQL_FAILED'
    | 'LEXICAL_SQL_FAILED'
    | 'PROVIDER_UNCONFIGURED'
    | 'DISABLED_BY_CALLER';
}

/** One retrieved memory, with everything needed to cite it. */
export interface RetrievedMemory {
  id: string;
  workspaceId: string;
  productId: string | null;
  memoryType: string;
  title: string;
  /** content.claim when present — the sentence a reader would quote. */
  claim: string | null;
  content: Record<string, unknown>;
  confidence: number;
  version: number;
  status: string;
  source: string;
  /**
   * GOVERNED authority tier, as persisted. NULL means the row is legacy
   * (pre-3.2A) and its authority is UNKNOWN — not "derived from source".
   * Source is provenance; it is never promoted to authority here.
   */
  authorityTier: string | null;
  /** Governed memory class. NULL on legacy rows, same reasoning as above. */
  memoryClass: string | null;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;

  /** Currentness of the vector backing this result, when there is one. */
  contentHash: string | null;
  embeddingStatus: 'current' | 'stale' | 'missing';

  // ── provenance of the RETRIEVAL itself ─────────────────────────────────────
  arms: RetrievalArm[];
  lexicalRank: number | null;
  semanticRank: number | null;
  /** Cosine distance, 0 = identical. Exposed for debugging, not for ranking. */
  semanticDistance: number | null;
  fusedScore: number;
  fusedRank: number;
  /** Final position after business reranking. */
  finalRank: number;
  /** How reranking moved it, and why. Empty when reranking was neutral. */
  rerankReasons: string[];
}

export interface RetrievalRequest {
  workspaceId: string;
  query: string;
  productId?: string;
  memoryTypes?: string[];
  statuses?: string[];
  limit?: number;
  /** Reserved for 3.1E per-context budgets. */
  contextType?: string;
  tokenBudget?: number;
  /** Escape hatch for the degradation tests and the debug harness. */
  disableSemantic?: boolean;
  disableLexical?: boolean;
}

export interface RetrievalResult {
  mode: RetrievalMode;
  results: RetrievedMemory[];
  arms: ArmStatus[];

  /** Candidates dropped by the result/token budget, and why they were dropped. */
  excludedForBudget: number;
  tokensUsed: number;
  tokenBudget: number;

  /** True when at least one arm that should have run did not. */
  degraded: boolean;
  degradedReasons: string[];

  timings: {
    structuredMs: number;
    lexicalMs: number;
    semanticMs: number;
    queryEmbeddingMs: number;
    fusionMs: number;
    rerankMs: number;
    totalMs: number;
  };

  diagnostics: {
    fusedCandidates: number;
    staleVectorsExcluded: number;
    missingVectors: number;
    /** Set when the ADR-066 rule 14 ANN review threshold is met. */
    annReviewDue: boolean;
    annReviewReason: string | null;
  };
}

// ── Budgets (Step 3.1D §7) ───────────────────────────────────────────────────
/**
 * Bounded at every stage so cost stays flat as Marketing Memory grows.
 *
 * Without per-arm caps, an exact vector scan over a large workspace would fuse
 * thousands of candidates to return five — paying the full cost of a ranking
 * nobody reads.
 */
export const RETRIEVAL_BUDGETS = {
  /** Candidates each ranked arm may return. */
  maxCandidatesPerArm: 25,
  /** Candidates surviving fusion into reranking. */
  maxFusedCandidates: 40,
  /** Memories returned by default. */
  maxFinalResults: 10,
  /** Canonical text a caller may consume, for 3.1E ContextPackage assembly. */
  defaultTokenBudget: 2_000,
} as const;

/**
 * ADR-066 rule 14, as amended by Amendment 3 (3.1G).
 *
 * The trigger is MEASURED SEMANTIC PRESSURE, not raw volume. Scale testing found
 * exact vector scan at 5 ms p95 over 25,000 vectors — about 40× under the latency
 * threshold the old 10,000-row trigger was standing in for. Row count is still
 * emitted as an early-warning signal but no longer fires a review on its own.
 *
 * ANN is never added automatically; these only surface the condition.
 */
export const ANN_REVIEW_THRESHOLDS = {
  /** p95 for the semantic arm alone. The primary trigger. */
  semanticP95Ms: 200,
  /** Semantic as a share of total ContextPackage build time. */
  semanticShareOfPackage: 0.40,
  /** Emitted for visibility only — NOT a trigger (Amendment 3). */
  vectorRowsWarnOnly: 10_000,
} as const;

/** ~4 chars per token. Deliberately crude: it bounds a budget, it does not bill. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
