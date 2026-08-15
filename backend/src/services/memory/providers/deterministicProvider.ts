/**
 * @file deterministicProvider.ts
 * @description A local, offline EmbeddingProvider used by tests and by the
 *   pipeline's own self-check. Makes NO network call, ever.
 *
 *   WHY THIS EXISTS RATHER THAN A vi.mock: Step 3.1C §15 requires that ordinary
 *   unit and eval runs cannot reach an embedding API. A mock proves the code
 *   under test behaves; it does not prove the *system* is incapable of calling
 *   out. A real provider implementation that is structurally offline does — it
 *   can be selected by configuration, exercised end to end through the worker,
 *   and there is no code path from it to a socket.
 *
 *   It is NOT a semantic model and must never serve retrieval. Vectors are
 *   derived from a hash of the text, so:
 *     · identical text → identical vector      (idempotency is testable)
 *     · different text → different vector      (staleness is testable)
 *     · similar text   → UNRELATED vector      (no semantic meaning whatsoever)
 *
 *   The third property is the important one. It keeps this honest: nobody can
 *   mistake a green test suite here for evidence that retrieval quality works.
 *   That evidence comes only from the 3.1D benchmark against a real provider.
 *
 * @security No network, no credentials, no external state.
 * @dependencies node:crypto
 */

import { createHash } from 'crypto';
import type {
  EmbeddingProvider, EmbeddingProviderCapabilities, EmbeddingVector,
} from '../../../types/embedding';
import { EmbeddingError } from './embeddingErrors';

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly capabilities: EmbeddingProviderCapabilities;

  constructor(dimensions = 8) {
    this.capabilities = {
      provider: 'deterministic',
      model: 'sha256-hash-v1',
      dimensions,
      maxBatchSize: 256,
      maxInputTokens: 1_000_000,
    };
  }

  async embedOne(text: string): Promise<EmbeddingVector> {
    const [v] = await this.embedBatch([text]);
    return v;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.some(t => t.trim().length === 0)) {
      // Mirrors the production adapter, so the worker's handling of this case is
      // exercised offline instead of only in a code path nobody runs.
      throw new EmbeddingError('INVALID_INPUT', 'one or more inputs are empty after trimming');
    }
    return texts.map(t => ({
      vector: this.#vector(t),
      dimensions: this.capabilities.dimensions,
    }));
  }

  /** Unit-norm vector expanded from the digest, so cosine distance is defined. */
  #vector(text: string): number[] {
    const dims = this.capabilities.dimensions;
    const out: number[] = [];
    let counter = 0;
    while (out.length < dims) {
      const digest = createHash('sha256').update(`${counter}:${text}`, 'utf8').digest();
      for (let i = 0; i < digest.length && out.length < dims; i += 2) {
        // Map two bytes into [-1, 1].
        out.push(((digest[i] << 8 | digest[i + 1]) / 32767.5) - 1);
      }
      counter++;
    }
    const norm = Math.sqrt(out.reduce((a, b) => a + b * b, 0)) || 1;
    return out.map(x => x / norm);
  }

  async healthCheck(): Promise<{ healthy: boolean; detail: string }> {
    return { healthy: true, detail: 'deterministic provider — offline, no credential required' };
  }
}
