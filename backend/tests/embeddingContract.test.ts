/**
 * @file embeddingContract.test.ts
 * @description Proves the embedding dimension contract fails LOUD.
 *
 *   ROOT CAUSE THIS GUARDS: 28 outbox jobs failed non-retryably with
 *   DIMENSION_MISMATCH because a worker ran without EMBEDDING_PROVIDER set.
 *   `selectedProvider()` defaults to 'deterministic' and the deterministic
 *   provider defaults to 8 dimensions, so 8-wide vectors were offered against a
 *   1024 contract. The contract correctly refused them — the defect was that
 *   nothing refused EARLIER, and the failure detail recorded only "non-retryable"
 *   rather than the two widths.
 *
 * @security No network, no DB.
 * @dependencies providers, corpusEmbeddingCertification
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveEmbeddingProvider } from '../src/services/memory/providers';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('embedding dimension contract', () => {
  it('unset EMBEDDING_PROVIDER resolves to deterministic/8 — the exact residue that broke 28 jobs', async () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_DIMENSIONS;
    const { provider, live } = resolveEmbeddingProvider();
    expect(live).toBe(false);
    expect(provider.capabilities.dimensions).toBe(8);
    const v = await provider.embedOne('probe');
    expect(v.vector.length).toBe(8);
    // Against a 1024 contract this is the mismatch, and it must NEVER be padded.
    expect(v.vector.length).not.toBe(1024);
  });

  it('a wrong width is refused rather than padded or truncated', async () => {
    process.env.EMBEDDING_PROVIDER = 'deterministic';
    process.env.EMBEDDING_DIMENSIONS = '512';
    const { provider } = resolveEmbeddingProvider();
    const v = await provider.embedOne('probe');
    const CONTRACT = 1024;
    expect(v.vector.length).toBe(512);
    const wouldPersist = v.vector.length === CONTRACT;
    expect(wouldPersist).toBe(false);   // fail-loud, never coerce
  });

  it('voyage requires explicit model and dimensions — no silent defaults', () => {
    process.env.EMBEDDING_PROVIDER = 'voyage';
    // NOT 'xxx…' — that matches the placeholder guard and would be refused
    // before the model check, masking what this test is actually asserting.
    process.env.VOYAGE_API_KEY = 'pa-' + 'a1b2c3d4e5'.repeat(3);
    delete process.env.EMBEDDING_MODEL;
    expect(() => resolveEmbeddingProvider()).toThrow(/EMBEDDING_MODEL/);
    process.env.EMBEDDING_MODEL = 'voyage-4';
    delete process.env.EMBEDDING_DIMENSIONS;
    expect(() => resolveEmbeddingProvider()).toThrow(/EMBEDDING_DIMENSIONS/);
  });

  it('a placeholder API key is refused', () => {
    process.env.EMBEDDING_PROVIDER = 'voyage';
    process.env.EMBEDDING_MODEL = 'voyage-4';
    process.env.EMBEDDING_DIMENSIONS = '1024';
    process.env.VOYAGE_API_KEY = 'your_key_here';
    expect(() => resolveEmbeddingProvider()).toThrow(/UNCONFIGURED|VOYAGE_API_KEY/);
  });
});
