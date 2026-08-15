/**
 * @file embeddingProvider.test.ts
 * @description Provider adapters, the registry, and the vendor-independence
 *   guarantee.
 *
 *   The most important test here is the STRUCTURAL one: no domain module may
 *   import a provider adapter. Vendor independence enforced by convention lasts
 *   until the first deadline; enforced by a failing test, it lasts.
 *
 * @security Asserts the credential never appears in a URL, a log, capabilities,
 *   or an error — and that provider error BODIES are never read, because they
 *   echo the submitted text, which here is founder memory.
 * @dependencies providers/*, fetch stubbing
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { DeterministicEmbeddingProvider } from '../src/services/memory/providers/deterministicProvider';
import { VoyageEmbeddingProvider } from '../src/services/memory/providers/voyageProvider';
import { resolveEmbeddingProvider, describeConfiguredProvider } from '../src/services/memory/providers';
import { EmbeddingError, kindFromStatus } from '../src/services/memory/providers/embeddingErrors';

const SRC = join(__dirname, '..', 'src');
const KEY = 'sk-test-abcdefghijklmnop';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// ── Vendor independence ──────────────────────────────────────────────────────
describe('vendor independence (ADR-066 §7)', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  }

  it('ONLY the providers directory imports a concrete provider adapter', () => {
    const offenders = walk(SRC)
      .filter(p => !p.includes(join('services', 'memory', 'providers')))
      .filter(p => /from\s+['"].*(voyageProvider|deterministicProvider)['"]/.test(readFileSync(p, 'utf-8')))
      .map(p => p.replace(SRC, 'src'));
    expect(offenders).toEqual([]);
  });

  it('no domain service imports an embedding vendor SDK', () => {
    const offenders = walk(SRC)
      .filter(p => /require\(['"](openai|voyageai|cohere-ai|@huggingface)|from ['"](openai|voyageai|cohere-ai|@huggingface)/.test(readFileSync(p, 'utf-8')))
      .map(p => p.replace(SRC, 'src'));
    expect(offenders).toEqual([]);
  });

  it('the pipeline depends on the interface, not on a vendor', () => {
    const src = readFileSync(join(SRC, 'services', 'memory', 'embeddingPipeline.ts'), 'utf-8');
    expect(src).not.toMatch(/voyage/i);
    expect(src).toMatch(/EmbeddingProvider/);
  });
});

// ── Deterministic provider ───────────────────────────────────────────────────
describe('deterministic provider', () => {
  const p = new DeterministicEmbeddingProvider(8);

  it('is deterministic and unit-norm', async () => {
    const a = await p.embedOne('hello');
    const b = await p.embedOne('hello');
    expect(a.vector).toEqual(b.vector);
    const norm = Math.sqrt(a.vector.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('gives different text a different vector', async () => {
    const a = await p.embedOne('hello');
    const b = await p.embedOne('goodbye');
    expect(a.vector).not.toEqual(b.vector);
  });

  it('carries NO semantic meaning — near-identical text is unrelated', async () => {
    // Guards against anyone mistaking a green suite for evidence of retrieval
    // quality. Only a real provider measured in 3.1D can show that.
    const a = await p.embedOne('Search converts better than Meta');
    const b = await p.embedOne('Search converts better than Meta.');
    const cos = a.vector.reduce((s, x, i) => s + x * b.vector[i], 0);
    expect(Math.abs(cos)).toBeLessThan(0.9);
  });

  it('honours the requested width and rejects empty input', async () => {
    expect((await new DeterministicEmbeddingProvider(1024).embedOne('x')).dimensions).toBe(1024);
    await expect(p.embedOne('   ')).rejects.toThrow(/INVALID_INPUT/);
  });
});

// ── Voyage adapter ───────────────────────────────────────────────────────────
describe('voyage adapter', () => {
  const provider = () => new VoyageEmbeddingProvider({ apiKey: KEY, model: 'test-model', dimensions: 4 });

  function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
    const spy = vi.fn(impl as never);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  const ok = (vectors: number[][]) => new Response(
    JSON.stringify({ data: vectors.map((v, i) => ({ embedding: v, index: i })) }),
    { status: 200, headers: { 'content-type': 'application/json' } });

  it('sends the credential as a header, never in the URL', async () => {
    const spy = stubFetch(() => ok([[1, 0, 0, 0]]));
    await provider().embedOne('hello');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('maps HTTP status to the right failure kind', async () => {
    const cases: Array<[number, string]> = [
      [401, 'AUTH_FAILED'], [403, 'AUTH_FAILED'], [429, 'RATE_LIMITED'],
      [408, 'TIMEOUT'], [400, 'INVALID_INPUT'], [422, 'INVALID_INPUT'],
      [500, 'PROVIDER_UNAVAILABLE'], [503, 'PROVIDER_UNAVAILABLE'],
    ];
    for (const [status, kind] of cases) {
      expect(kindFromStatus(status), `${status}`).toBe(kind);
      stubFetch(() => new Response('{}', { status }));
      await expect(provider().embedOne('x')).rejects.toThrow(new RegExp(kind));
    }
  });

  it('never reads or echoes the provider error body', async () => {
    // The body would contain the submitted memory text on a 400.
    let bodyRead = false;
    stubFetch(() => {
      const r = new Response(JSON.stringify({ detail: 'input was: SECRET MEMORY TEXT' }), { status: 400 });
      const orig = r.json.bind(r);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).json = async () => { bodyRead = true; return orig(); };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).text = async () => { bodyRead = true; return ''; };
      return r;
    });
    await expect(provider().embedOne('x')).rejects.toThrow(/INVALID_INPUT/);
    expect(bodyRead).toBe(false);
  });

  it('surfaces the credential in no error message', async () => {
    stubFetch(() => new Response('{}', { status: 401 }));
    await provider().embedOne('x').catch((e: Error) => {
      expect(e.message).not.toContain(KEY);
    });
  });

  it('honours Retry-After on a rate limit', async () => {
    stubFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '42' } }));
    await provider().embedOne('x').catch((e: EmbeddingError) => {
      expect(e.kind).toBe('RATE_LIMITED');
      expect(e.retryAfterSeconds).toBe(42);
    });
  });

  it('rejects a width that differs from the contract', async () => {
    stubFetch(() => ok([[1, 0, 0]]));            // 3 wide, contract says 4
    await expect(provider().embedOne('x')).rejects.toThrow(/DIMENSION_MISMATCH/);
  });

  it('rejects a malformed payload rather than coercing it', async () => {
    stubFetch(() => new Response(JSON.stringify({ data: [{ embedding: 'not-an-array', index: 0 }] }), { status: 200 }));
    await expect(provider().embedOne('x')).rejects.toThrow(/MALFORMED_OUTPUT/);

    stubFetch(() => new Response('not json', { status: 200 }));
    await expect(provider().embedOne('x')).rejects.toThrow(/MALFORMED_OUTPUT/);

    stubFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(provider().embedOne('x')).rejects.toThrow(/MALFORMED_OUTPUT/);
  });

  it('restores batch order from the provider index', async () => {
    // A silently reordered batch would attach every vector to the wrong memory,
    // and nothing downstream could detect it.
    stubFetch(() => new Response(JSON.stringify({
      data: [
        { embedding: [0, 0, 0, 2], index: 1 },
        { embedding: [1, 0, 0, 0], index: 0 },
      ],
    }), { status: 200 }));
    const [first, second] = await provider().embedBatch(['a', 'b']);
    expect(first.vector).toEqual([1, 0, 0, 0]);
    expect(second.vector).toEqual([0, 0, 0, 2]);
  });

  it('refuses an oversized batch and empty inputs before any network call', async () => {
    const spy = stubFetch(() => ok([[1, 0, 0, 0]]));
    const p = new VoyageEmbeddingProvider({ apiKey: KEY, model: 'm', dimensions: 4, maxBatchSize: 2 });
    await expect(p.embedBatch(['a', 'b', 'c'])).rejects.toThrow(/INVALID_INPUT/);
    await expect(p.embedBatch(['a', '  '])).rejects.toThrow(/INVALID_INPUT/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('classifies an abort as TIMEOUT, not as a provider outage', async () => {
    stubFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    await expect(provider().embedOne('x')).rejects.toThrow(/TIMEOUT/);
  });

  it('exposes no credential through capabilities', () => {
    expect(JSON.stringify(provider().capabilities)).not.toContain(KEY);
  });
});

// ── Registry ─────────────────────────────────────────────────────────────────
describe('provider registry', () => {
  it('defaults to the OFFLINE provider so tests cannot reach a paid API', () => {
    vi.stubEnv('EMBEDDING_PROVIDER', '');
    const r = resolveEmbeddingProvider();
    expect(r.live).toBe(false);
    expect(r.provider.capabilities.provider).toBe('deterministic');
  });

  it('refuses a live provider without a credential', () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'voyage');
    vi.stubEnv('VOYAGE_API_KEY', '');
    expect(() => resolveEmbeddingProvider()).toThrow(/UNCONFIGURED/);
  });

  it('treats a placeholder credential as missing', () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'voyage');
    vi.stubEnv('VOYAGE_API_KEY', 'your_key_here');
    expect(() => resolveEmbeddingProvider()).toThrow(/UNCONFIGURED/);
  });

  it('requires model and dimensions to be stated EXPLICITLY', () => {
    // No default is inherited from the retired 1536-wide columns.
    vi.stubEnv('EMBEDDING_PROVIDER', 'voyage');
    vi.stubEnv('VOYAGE_API_KEY', KEY);
    vi.stubEnv('EMBEDDING_MODEL', '');
    expect(() => resolveEmbeddingProvider()).toThrow(/EMBEDDING_MODEL/);

    vi.stubEnv('EMBEDDING_MODEL', 'some-model');
    vi.stubEnv('EMBEDDING_DIMENSIONS', '');
    expect(() => resolveEmbeddingProvider()).toThrow(/EMBEDDING_DIMENSIONS/);
  });

  it('rejects an unknown provider name', () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'acme-embeddings');
    expect(() => resolveEmbeddingProvider()).toThrow(/unknown EMBEDDING_PROVIDER/);
  });

  it('describes configuration without constructing a client or touching a key', () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'voyage');
    vi.stubEnv('VOYAGE_API_KEY', '');
    const d = describeConfiguredProvider();
    expect(d.configured).toBe(false);
    expect(JSON.stringify(d)).not.toContain(KEY);
  });
});
