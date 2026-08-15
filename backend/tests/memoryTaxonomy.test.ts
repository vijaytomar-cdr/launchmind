/**
 * @file memoryTaxonomy.test.ts
 * @description Governance, rendering and privacy contracts for Phase 3.1B.
 *
 *   Three things are guarded here, all of which fail SILENTLY in production if
 *   left to code review:
 *
 *   1. TAXONOMY DRIFT. `memory_type` is enforced twice — a CHECK constraint in
 *      migration 035 and a TypeScript union in types/memory.ts. Both are correct
 *      today. Nothing notices when they diverge, and the symptom of divergence
 *      is not an error: it is a type-filtered query that quietly returns fewer
 *      rows than it should. These tests parse the real SQL and compare.
 *
 *   2. RENDERER DETERMINISM. If a renderer is not deterministic, content_hash
 *      changes for unchanged input, every record looks stale on every pass, and
 *      the 3.1C worker re-embeds the corpus forever while reporting success.
 *
 *   3. PLAYBOOK PRIVACY. The generalizer is the boundary between per-founder
 *      data and a corpus every tenant can read. A leak here is not a bug in a
 *      feature; it is a cross-founder disclosure.
 *
 * @security Contains no real founder data.
 * @dependencies migrations 035/089, types/memory, types/embedding, renderers
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { MEMORY_TYPES, MEMORY_SOURCES } from '../src/types/memory';
import { EMBEDDING_SOURCE_TYPES, EMBEDDING_STATUSES } from '../src/types/embedding';
import {
  marketingMemoryRenderer, evidenceRenderer, productIcpRenderer, contentHash,
} from '../src/services/memory/embeddingRenderer';
import {
  generalizePlaybookSignal, playbookSignalRenderer,
} from '../src/services/memory/playbookGeneralizer';

const MIGRATIONS = join(__dirname, '..', 'migrations');

function migration(id: number): string {
  const padded = String(id).padStart(6, '0');
  const file = readdirSync(MIGRATIONS).find(f => f.includes(`_${padded}_`));
  if (!file) throw new Error(`Migration ${id} not found`);
  return readFileSync(join(MIGRATIONS, file), 'utf-8');
}

/** Extracts the quoted values of `CHECK (<column> IN ( 'a','b' ))` from SQL. */
function checkValues(sql: string, column: string): string[] {
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i');
  const m = sql.match(re);
  if (!m) throw new Error(`No CHECK ... IN found for ${column}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
}

describe('taxonomy governance — database and TypeScript must agree', () => {
  it('memory_type: CHECK constraint matches MEMORY_TYPES exactly', () => {
    expect(checkValues(migration(35), 'memory_type')).toEqual([...MEMORY_TYPES].sort());
  });

  it('source: CHECK constraint matches MEMORY_SOURCES exactly', () => {
    expect(checkValues(migration(35), 'source')).toEqual([...MEMORY_SOURCES].sort());
  });

  it('embedding source_type: CHECK matches EMBEDDING_SOURCE_TYPES exactly', () => {
    expect(checkValues(migration(89), 'source_type')).toEqual([...EMBEDDING_SOURCE_TYPES].sort());
  });

  it('embedding status: CHECK matches EMBEDDING_STATUSES exactly', () => {
    expect(checkValues(migration(89), 'status')).toEqual([...EMBEDDING_STATUSES].sort());
  });

  it('migration 091 names the memory_type constraint so the drift test can find it', () => {
    expect(migration(91)).toContain('marketing_memories_memory_type_governed');
  });
});

describe('ADR-066 rule 13 — no ANN index anywhere', () => {
  it('no migration creates an HNSW or IVFFlat index', () => {
    const offenders = readdirSync(MIGRATIONS)
      .filter(f => f.endsWith('.sql'))
      .filter(f => /USING\s+(hnsw|ivfflat)/i.test(readFileSync(join(MIGRATIONS, f), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});

describe('rule 5 — exactly one table declares a vector column', () => {
  it('only migration 089 introduces a live vector column', () => {
    // Migrations that CREATE a vector column, minus the one that retires them.
    const creators = readdirSync(MIGRATIONS)
      .filter(f => f.endsWith('.sql'))
      .filter(f => {
        const sql = readFileSync(join(MIGRATIONS, f), 'utf-8');
        // Two simple patterns rather than one with nested optional quantifiers,
        // which the security linter flags as potentially catastrophic backtracking.
        // Only COLUMN declarations count. Migration 094 contains
        // `p_query_vector vector,` — a FUNCTION PARAMETER, not a stored column —
        // and matching it would report a second vector table that does not exist.
        const columnDecls = sql.match(/^\s*[a-z_]+\s+vector(\(\d+\))?\s*[,)]?\s*$/gim) ?? [];
        const declaresColumn = columnDecls.some(d => !/^\s*p_/i.test(d));
        return declaresColumn && !/DROP COLUMN/i.test(sql);
      });
    // 007/009/035/037 created the legacy columns; 090 drops them. What matters is
    // that no migration AFTER 090 adds one back.
    const after090 = creators.filter(f => Number(f.match(/_(\d{6})_/)?.[1] ?? 0) > 90);
    expect(after090).toEqual([]);
  });
});

describe('canonical rendering — determinism and meaning preservation', () => {
  const memory = {
    memory_type: 'campaign',
    title: 'Search converts worse than Meta for enterprise customers',
    content: {
      claim: 'For property-manager accounts Search converts worse than Meta.',
      segment: 'enterprise', channels: ['google_ads', 'meta'], delta_pct: -34,
    },
    source: 'campaign_performance',
  };

  it('is deterministic — same input, same hash', () => {
    const a = marketingMemoryRenderer.render(memory)!;
    const b = marketingMemoryRenderer.render(memory)!;
    expect(a.text).toBe(b.text);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('is insensitive to JSONB key ORDER', () => {
    // Postgres does not guarantee jsonb key order across writes. If the renderer
    // were order-sensitive, the "same" memory would re-embed at random.
    const reordered = { ...memory, content: {
      delta_pct: -34, channels: ['google_ads', 'meta'], segment: 'enterprise',
      claim: memory.content.claim,
    } };
    expect(marketingMemoryRenderer.render(reordered)!.contentHash)
      .toBe(marketingMemoryRenderer.render(memory)!.contentHash);
  });

  it('PRESERVES negation — "worse" must survive rendering', () => {
    // The contradiction pair in the retrieval eval differs by this one word.
    const t = marketingMemoryRenderer.render(memory)!.text;
    expect(t).toContain('worse');
    expect(t).not.toContain('better');
  });

  it('PRESERVES scope — the enterprise qualifier is not dropped', () => {
    expect(marketingMemoryRenderer.render(memory)!.text).toMatch(/enterprise/i);
  });

  it('a semantic change produces a DIFFERENT hash', () => {
    const flipped = { ...memory, content: { ...memory.content, claim: 'Search converts BETTER than Meta.' } };
    expect(marketingMemoryRenderer.render(flipped)!.contentHash)
      .not.toBe(marketingMemoryRenderer.render(memory)!.contentHash);
  });

  it('never emits raw JSON punctuation', () => {
    const t = marketingMemoryRenderer.render(memory)!.text;
    expect(t).not.toMatch(/[{}"]|\bclaim":/);
  });

  it('a rendering-version bump invalidates an identical text', () => {
    expect(contentHash('same text', 1)).not.toBe(contentHash('same text', 2));
  });

  it('produces a sha256 hex digest matching the DB constraint', () => {
    expect(marketingMemoryRenderer.render(memory)!.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses to render an empty record', () => {
    expect(marketingMemoryRenderer.render({ memory_type: 'campaign', title: '', content: {} })).toBeNull();
  });

  it('evidence and product renderers are deterministic too', () => {
    const e = { evidence_type: 'campaign_metric', data: { control: 0.031, variant: 0.0437, n: 5820 } };
    expect(evidenceRenderer.render(e)!.contentHash).toBe(evidenceRenderer.render(e)!.contentHash);

    const p = { name: 'HomeFix', category: 'Utilities', confirmed_icp: { audience: 'homeowners' } };
    expect(productIcpRenderer.render(p)!.text).toContain('homeowners');
  });

  it('evidence rendering is insensitive to key order', () => {
    const a = { evidence_type: 'm', data: { alpha: 1, beta: 2 } };
    const b = { evidence_type: 'm', data: { beta: 2, alpha: 1 } };
    expect(evidenceRenderer.render(a)!.contentHash).toBe(evidenceRenderer.render(b)!.contentHash);
  });
});

describe('playbook generalization — ADR-066 rule 45', () => {
  const safe = {
    category: 'home services', market: 'usa', channel: 'meta',
    hook_type: 'outcome', price_tier: 'mid',
    install_delta_pct: 41.7, conversion_rate: 0.043, retention_d7: 0.21,
  };

  it('generalizes a well-formed signal', () => {
    const r = generalizePlaybookSignal(safe);
    expect(r.eligible).toBe(true);
    expect(r.rendered!.text).toContain('home services');
  });

  it('BUCKETS exact numbers rather than emitting them', () => {
    // 41.7 combined with category+market is close to a unique key. The band is
    // the reusable lesson; the exact figure is the fingerprint.
    const t = generalizePlaybookSignal(safe).rendered!.text;
    expect(t).not.toContain('41.7');
    expect(t).toContain('25-50%');
  });

  it('two signals differing only in exact magnitude generalize identically', () => {
    const a = generalizePlaybookSignal({ ...safe, install_delta_pct: 41.7 });
    const b = generalizePlaybookSignal({ ...safe, install_delta_pct: 44.2 });
    expect(a.rendered!.contentHash).toBe(b.rendered!.contentHash);
  });

  it('refuses a category long enough to be a description', () => {
    const r = generalizePlaybookSignal({
      ...safe,
      category: 'on-demand plumbing for luxury waterfront properties in the Pacific Northwest',
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/too long|specific/i);
  });

  it('refuses values outside the closed vocabularies', () => {
    expect(generalizePlaybookSignal({ ...safe, market: 'atlantis' }).eligible).toBe(false);
    expect(generalizePlaybookSignal({ ...safe, channel: 'carrier-pigeon' }).eligible).toBe(false);
  });

  it('refuses a signal with no measurable outcome', () => {
    const r = generalizePlaybookSignal({
      ...safe, install_delta_pct: null, conversion_rate: null, retention_d7: null,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no measurable outcome/i);
  });

  it('drops unrecognised optional fields instead of failing the whole signal', () => {
    const r = generalizePlaybookSignal({ ...safe, price_tier: 'platinum-unlimited', hook_type: null });
    expect(r.eligible).toBe(true);
    expect(r.rendered!.text).not.toContain('platinum');
  });

  it('is ALLOW-LIST: an injected free-text field cannot reach the output', () => {
    // The property that makes a future column addition safe by default. A
    // redaction approach would have to be updated for every new field; this one
    // ignores anything it was not told to emit.
    const withExtra = {
      ...safe,
      founder_note: 'Acme Plumbing Co, contact Dave on 555-0100',
      raw_copy: 'Our unique tagline nobody else uses',
    } as unknown as typeof safe;
    const t = generalizePlaybookSignal(withExtra).rendered!.text;
    expect(t).not.toMatch(/acme|dave|555|tagline/i);
  });

  it('the renderer wrapper returns null for an ineligible signal', () => {
    expect(playbookSignalRenderer.render({ ...safe, market: 'atlantis' })).toBeNull();
  });

  it('is deterministic', () => {
    expect(generalizePlaybookSignal(safe).rendered!.contentHash)
      .toBe(generalizePlaybookSignal(safe).rendered!.contentHash);
  });
});
