/**
 * @file voyageProvider.ts
 * @description Voyage AI implementation of EmbeddingProvider — the selected
 *   initial production provider for Phase 3.1C.
 *
 *   THIS IS THE ONLY FILE PERMITTED TO KNOW A PROVIDER'S WIRE FORMAT.
 *   No memory service, retrieval service, Context Engine or worker imports
 *   anything from it directly; they see `EmbeddingProvider` and nothing else.
 *   `providerAbstraction.test.ts` asserts that structurally.
 *
 *   WHY VOYAGE (see docs/roadmap/phase-3.1-gap-analysis.md §7 for the full
 *   comparison):
 *     · Anthropic's documented embedding recommendation, and this backend is
 *       already an Anthropic shop — one vendor relationship, one DPA, one place
 *       to reason about data handling.
 *     · Retrieval-tuned models. The corpus here is short domain assertions
 *       ("Search converts worse than Meta for enterprise customers"), which is
 *       the case general-purpose models handle least well.
 *     · Matryoshka-trained output, so narrowing dimensions later is principled
 *       truncation rather than information loss. That matters because ADR-066
 *       rule 13 mandates EXACT scan, where vector width is a direct linear cost.
 *
 *   MODEL AND DIMENSIONS ARE CONFIGURATION, NOT CODE. `EMBEDDING_MODEL` and
 *   `EMBEDDING_DIMENSIONS` are read from the environment and recorded per row.
 *   No default was hard-coded from the retired 1536-wide columns; the canonical
 *   table is dimension-flexible precisely so this stays a decision we can revise.
 *
 *   VERIFIED LIVE (3.1D Gate 1): voyage-4 returns exactly 1024 unit-normalised
 *   dimensions. The adapter still validates the returned width against the
 *   contract and FAILS on mismatch rather than adapting to it, so a future model
 *   change surfaces immediately as DIMENSION_MISMATCH instead of silently
 *   poisoning the index.
 *
 * @security The API key is read at call time and never logged, never returned,
 *   and never placed in a URL. Provider error BODIES are discarded — they echo
 *   the submitted text, which here is founder memory.
 * @dependencies fetch (no SDK, no new dependency)
 */

import type {
  EmbeddingProvider, EmbeddingProviderCapabilities, EmbeddingVector,
} from '../../../types/embedding';
import { EmbeddingError, kindFromStatus } from './embeddingErrors';

const API_BASE = 'https://api.voyageai.com/v1/embeddings';
const TIMEOUT_MS = 30_000;

/**
 * Proactive request pacing.
 *
 * Reacting to 429s is correct but wasteful: a backfill fires its whole batch,
 * collects rate-limit errors, and re-queues everything with back-off. Measured
 * on this account, 3 of 33 succeeded and 30 bounced. Spacing requests to the
 * known ceiling turns that into steady progress and, more importantly, stops a
 * backfill from starving live single-memory work behind a wall of retries.
 *
 * Module-level because the limit is per API key, not per caller, and the worker
 * runs at concurrency 1. Set VOYAGE_REQUESTS_PER_MINUTE to the account's real
 * limit (free tier is 3); 0 or unset disables pacing and leaves only reactive
 * back-off.
 */
let _lastRequestAt = 0;

async function paceRequest(): Promise<void> {
  const rpm = Number(process.env.VOYAGE_REQUESTS_PER_MINUTE ?? 0);
  if (!Number.isFinite(rpm) || rpm <= 0) return;

  const minGapMs = 60_000 / rpm;
  const waitMs = _lastRequestAt + minGapMs - Date.now();
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  _lastRequestAt = Date.now();
}

export interface VoyageConfig {
  apiKey: string;
  model: string;
  dimensions: number;
  maxBatchSize?: number;
  maxInputTokens?: number;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly capabilities: EmbeddingProviderCapabilities;
  readonly #apiKey: string;

  constructor(cfg: VoyageConfig) {
    this.#apiKey = cfg.apiKey;
    this.capabilities = {
      provider: 'voyage',
      model: cfg.model,
      dimensions: cfg.dimensions,
      maxBatchSize: cfg.maxBatchSize ?? 128,
      maxInputTokens: cfg.maxInputTokens ?? 32_000,
    };
  }

  async embedOne(text: string): Promise<EmbeddingVector> {
    const [v] = await this.embedBatch([text]);
    return v;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];
    if (texts.length > this.capabilities.maxBatchSize) {
      throw new EmbeddingError('INVALID_INPUT',
        `batch of ${texts.length} exceeds maxBatchSize ${this.capabilities.maxBatchSize}`);
    }
    if (texts.some(t => t.trim().length === 0)) {
      // An empty string yields a vector that is equidistant nonsense. Refuse it
      // here rather than storing a row that matches everything badly.
      throw new EmbeddingError('INVALID_INPUT', 'one or more inputs are empty after trimming');
    }

    const body = {
      input: texts,
      model: this.capabilities.model,
      input_type: 'document' as const,
      output_dimension: this.capabilities.dimensions,
    };

    await paceRequest();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(API_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new EmbeddingError(
        aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        aborted ? `no response within ${TIMEOUT_MS}ms` : 'network error reaching the provider',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // The body is deliberately NOT read. Voyage echoes the submitted input on
      // 400s, and the input is founder memory; putting it in a log or a stored
      // last_error would move tenant content somewhere it does not belong.
      const retryAfter = Number(res.headers.get('retry-after')) || undefined;
      throw new EmbeddingError(kindFromStatus(res.status),
        `provider returned HTTP ${res.status}`, retryAfter);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new EmbeddingError('MALFORMED_OUTPUT', 'response was not valid JSON');
    }

    return this.#parse(json, texts.length);
  }

  /** Validates shape and width. Never pads, never truncates. */
  #parse(json: unknown, expectedCount: number): EmbeddingVector[] {
    const data = (json as { data?: Array<{ embedding?: unknown; index?: number }> }).data;
    if (!Array.isArray(data) || data.length !== expectedCount) {
      throw new EmbeddingError('MALFORMED_OUTPUT',
        `expected ${expectedCount} embeddings, received ${Array.isArray(data) ? data.length : 'none'}`);
    }

    // Voyage returns an `index` per item. Ordering is contractual, so it is
    // restored explicitly rather than assumed — a silently reordered batch would
    // attach every vector to the wrong memory, and nothing downstream could tell.
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    return ordered.map((item, i) => {
      const vec = item.embedding;
      if (!Array.isArray(vec) || vec.length === 0 || !vec.every(n => typeof n === 'number' && Number.isFinite(n))) {
        throw new EmbeddingError('MALFORMED_OUTPUT', `embedding ${i} is not a finite numeric array`);
      }
      if (vec.length !== this.capabilities.dimensions) {
        throw new EmbeddingError('DIMENSION_MISMATCH',
          `provider returned ${vec.length} dimensions, contract expects ${this.capabilities.dimensions}`);
      }
      return { vector: vec as number[], dimensions: vec.length };
    });
  }

  /**
   * Liveness probe.
   *
   * Embeds a fixed neutral token rather than any real record: a health check
   * must never send tenant content to a provider, and must be safe to run on a
   * schedule.
   */
  async healthCheck(): Promise<{ healthy: boolean; detail: string }> {
    try {
      const [v] = await this.embedBatch(['healthcheck']);
      return { healthy: true, detail: `${this.capabilities.model} responded with ${v.dimensions} dimensions` };
    } catch (e) {
      const kind = e instanceof EmbeddingError ? e.kind : 'PROVIDER_UNAVAILABLE';
      return { healthy: false, detail: kind };
    }
  }
}
