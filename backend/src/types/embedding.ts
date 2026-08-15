/**
 * @file embedding.ts
 * @description Canonical embedding domain contract — Phase 3.1B.
 *
 *   Types and interfaces only. NOTHING here calls an embedding provider, and no
 *   implementation in this milestone produces a vector. The purpose is to fix
 *   the contract so 3.1C can build the pipeline against a stable surface, and so
 *   the provider remains replaceable (ADR-066 §7).
 *
 * @security EmbeddingProvider implementations must never receive founder-
 *   identifying text for global/playbook sources — see playbookGeneralizer.ts
 *   and ADR-066 rule 45.
 * @dependencies none (deliberately — this file must not import service code)
 */

/**
 * Records eligible for embedding.
 *
 * A governed union rather than a free-text table name (Step 3.1B §6): a typo in
 * a string column would create a silently unreadable partition of the index that
 * no query would ever match and no error would ever report.
 *
 * Mirrors the CHECK constraint on `memory_embeddings.source_type` (migration
 * 089). `embeddingTaxonomy.test.ts` asserts the two stay in step.
 */
export const EMBEDDING_SOURCE_TYPES = [
  'marketing_memory',
  'marketing_memory_version',
  'evidence',
  'playbook_signal',
  'product_icp',
] as const;
export type EmbeddingSourceType = typeof EMBEDDING_SOURCE_TYPES[number];

/** Tenant-owned sources. `playbook_signal` is global and is the sole exception. */
export const TENANT_SCOPED_SOURCE_TYPES: readonly EmbeddingSourceType[] = [
  'marketing_memory', 'marketing_memory_version', 'evidence', 'product_icp',
];

/**
 * Lifecycle of one embedding row. Mirrors the CHECK on `memory_embeddings.status`.
 *
 * `pending`    queued or awaiting first generation; no vector yet
 * `current`    vector matches the source's current content_hash
 * `stale`      source changed; the vector is of superseded text (rule 11)
 * `failed`     generation failed; last_error explains why
 * `ineligible` deliberately never embedded — e.g. a playbook signal that cannot
 *              be safely generalized (rule 45). Distinct from `failed`: nothing
 *              went wrong, and retrying would be incorrect.
 */
export const EMBEDDING_STATUSES = ['pending', 'current', 'stale', 'failed', 'ineligible'] as const;
export type EmbeddingStatus = typeof EMBEDDING_STATUSES[number];

/** One row of the canonical store. */
export interface MemoryEmbedding {
  id: string;
  workspace_id: string | null;
  source_type: EmbeddingSourceType;
  source_id: string;
  source_field: string;
  embedding_provider: string;
  embedding_model: string;
  dimensions: number;
  embedding_version: number;
  rendering_version: number;
  content_hash: string;
  status: EmbeddingStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Rendering contract (Step 3.1B §7) ────────────────────────────────────────

/**
 * The canonical text for one source record, plus everything needed to detect
 * later that it is out of date.
 */
export interface RenderedEmbeddingText {
  /** Natural-language rendering. Never `JSON.stringify` of a JSONB column. */
  text: string;
  /** Bumped whenever renderer OUTPUT changes for unchanged input (rule 10). */
  renderingVersion: number;
  /** sha256 of `${renderingVersion}\n${text}` — see contentHash(). */
  contentHash: string;
}

/**
 * A source-type-specific renderer.
 *
 * Deterministic and pure: the same record must always produce the same text and
 * therefore the same hash, or staleness detection (rule 11) becomes noise and
 * every record re-embeds on every pass.
 */
export interface EmbeddingRenderer<TSource> {
  sourceType: EmbeddingSourceType;
  renderingVersion: number;
  /** @returns null when the record must not be embedded at all (rule 45). */
  render(source: TSource): RenderedEmbeddingText | null;
}

// ── Provider contract (Step 3.1B §14) ────────────────────────────────────────

export interface EmbeddingProviderCapabilities {
  provider: string;
  model: string;
  dimensions: number;
  /** Largest batch `embedBatch` accepts in one call. */
  maxBatchSize: number;
  /** Provider-side input limit; the caller must not exceed it. */
  maxInputTokens: number;
}

export interface EmbeddingVector {
  vector: number[];
  dimensions: number;
}

/**
 * LaunchMind-owned provider abstraction (ADR-066 §7: vendor independence).
 *
 * Deliberately narrow. Retrieval, ranking, tenancy and confidence are LaunchMind
 * business rules and are NOT part of this interface — a provider supplies
 * vectors and nothing else. That is what keeps the provider swappable, and what
 * stops provider semantics leaking into the parts of the system that must remain
 * ours.
 *
 * No implementation is selected in 3.1B. Choosing one belongs to 3.1C.
 */
export interface EmbeddingProvider {
  readonly capabilities: EmbeddingProviderCapabilities;
  embedOne(text: string): Promise<EmbeddingVector>;
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;
  /** Cheap liveness/credential probe. Must not embed real content. */
  healthCheck(): Promise<{ healthy: boolean; detail: string }>;
}
