/**
 * @file index.ts
 * @description Embedding provider registry — the single seam where a concrete
 *   provider is chosen.
 *
 *   Everything upstream (worker, backfill, health) depends on `EmbeddingProvider`
 *   and on this resolver. Swapping vendors is a change to this file plus one new
 *   adapter, and nothing else. That is the whole point of ADR-066 §7.
 *
 *   DEFAULT IS OFFLINE. With no `EMBEDDING_PROVIDER` set, resolution yields the
 *   deterministic provider, so a developer running the suite, or the eval harness
 *   running the 3.1A benchmark, cannot reach a paid API by accident (Step 3.1C
 *   §15). Selecting `voyage` is an explicit act requiring an explicit credential.
 *
 * @security Reads the credential at resolution time and hands it only to the
 *   adapter. Never logs it, never returns it, never includes it in capabilities.
 * @dependencies types/embedding, voyageProvider, deterministicProvider
 */

import type { EmbeddingProvider } from '../../../types/embedding';
import { VoyageEmbeddingProvider } from './voyageProvider';
import { DeterministicEmbeddingProvider } from './deterministicProvider';
import { EmbeddingError } from './embeddingErrors';

export { EmbeddingError, isRetryable, backoffSeconds } from './embeddingErrors';
export type { EmbeddingErrorKind } from './embeddingErrors';
export { VoyageEmbeddingProvider } from './voyageProvider';
export { DeterministicEmbeddingProvider } from './deterministicProvider';

export interface ResolvedProvider {
  provider: EmbeddingProvider;
  /** True when a real, network-backed provider is configured. */
  live: boolean;
}

/**
 * An env var set to the empty string is NOT nullish, so `?? 'deterministic'`
 * would yield '' and hard-fail. Deployments produce empty values routinely
 * (an unset secret, a blank CI variable), and the safe answer there is the
 * offline provider, not a crash.
 */
function selectedProvider(): string {
  const raw = (process.env.EMBEDDING_PROVIDER ?? '').trim().toLowerCase();
  return raw === '' ? 'deterministic' : raw;
}

function looksLikePlaceholder(v: string | undefined): boolean {
  return !v || /^(your_|<|xxx|placeholder|changeme)/i.test(v.trim()) || v.trim().length < 8;
}

/**
 * Resolves the active provider from configuration.
 *
 * @throws {EmbeddingError} UNCONFIGURED when a live provider is selected but its
 *   credential is missing or still a placeholder. Deliberately fatal: falling
 *   back to the deterministic provider here would write meaningless vectors into
 *   the canonical store and report success.
 */
export function resolveEmbeddingProvider(): ResolvedProvider {
  const selected = selectedProvider();

  if (selected === 'deterministic') {
    const dims = Number(process.env.EMBEDDING_DIMENSIONS ?? 8);
    return { provider: new DeterministicEmbeddingProvider(dims), live: false };
  }

  if (selected === 'voyage') {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (looksLikePlaceholder(apiKey)) {
      throw new EmbeddingError('UNCONFIGURED', 'EMBEDDING_PROVIDER=voyage but VOYAGE_API_KEY is missing or a placeholder');
    }
    const model = process.env.EMBEDDING_MODEL;
    const dimensions = Number(process.env.EMBEDDING_DIMENSIONS);
    if (!model) {
      throw new EmbeddingError('UNCONFIGURED', 'EMBEDDING_MODEL must be set explicitly');
    }
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 16_000) {
      // No default. The retired columns were 1536 wide and that must not become
      // an accidental precedent (Step 3.1C §1).
      throw new EmbeddingError('UNCONFIGURED', 'EMBEDDING_DIMENSIONS must be set explicitly to a value in 1..16000');
    }
    return {
      provider: new VoyageEmbeddingProvider({ apiKey: apiKey!, model, dimensions }),
      live: true,
    };
  }

  throw new EmbeddingError('UNCONFIGURED', `unknown EMBEDDING_PROVIDER "${selected}"`);
}

/** @returns Provider/model/dimensions without constructing a client or touching a credential. */
export function describeConfiguredProvider(): { provider: string; model: string; dimensions: number | null; configured: boolean } {
  const selected = selectedProvider();
  if (selected === 'deterministic') {
    return { provider: 'deterministic', model: 'sha256-hash-v1', dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 8), configured: true };
  }
  const dims = Number(process.env.EMBEDDING_DIMENSIONS);
  return {
    provider: selected,
    model: process.env.EMBEDDING_MODEL ?? 'unset',
    dimensions: Number.isInteger(dims) ? dims : null,
    configured: selected === 'voyage' && !looksLikePlaceholder(process.env.VOYAGE_API_KEY),
  };
}
