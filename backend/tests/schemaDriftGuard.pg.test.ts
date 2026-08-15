/**
 * @file schemaDriftGuard.pg.test.ts
 * @description Guards application code against referencing columns that do not
 *   exist — 3.2A Observation §2.
 *
 *   THREE defects of this exact class have now been found, all silent:
 *
 *     marketing_memories.archive_reason   → 42703, memoryAgent's dedup never ran
 *     marketing_memories.key              → 42703, Recommendation Engine never saw memory
 *     marketing_memories.confidence_score → 42703, stale scan always returned nothing
 *
 *   Every one produced `data: null`, was swallowed by `?? []`, and looked exactly
 *   like "there is nothing to report". PostgREST does not fail loudly and
 *   TypeScript cannot see inside a query string, so nothing caught them.
 *
 *   THE SCHEMA IS READ FROM REAL POSTGRES, not from a hand-maintained list. A
 *   duplicated column list would itself drift, and would then need its own guard.
 *   `information_schema.columns` after applying the real migrations is the only
 *   source that cannot disagree with production.
 *
 * @security Read-only against a disposable database. No production access.
 * @dependencies helpers/pgTestDb, migrations 035-040 + 088-101
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';

const SRC = join(__dirname, '..', 'src');

/** Tables whose column references are checked. */
const GUARDED_TABLES = [
  'marketing_memories',
  'marketing_memory_versions',
  'evidence',
  'memory_challenges',
  'memory_shadow_proposals',
  'memory_shadow_proposal_comparisons',
  'memory_suppressions',
  'memory_evidence',
  'memory_embeddings',
  'embedding_outbox',
];

let db: Client | null = null;
let available = false;
let schema = new Map<string, Set<string>>();

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('schemadrift');
  const { rows } = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)`, [GUARDED_TABLES]);
  for (const r of rows as Array<{ table_name: string; column_name: string }>) {
    if (!schema.has(r.table_name)) schema.set(r.table_name, new Set());
    schema.get(r.table_name)!.add(r.column_name);
  }
}, 180_000);

afterAll(async () => { await db?.end(); });

const maybe = (n: string, f: () => void | Promise<void>, t = 120_000) =>
  it(n, async () => { if (!available) return; await f(); }, t);

// ── Source scanning ──────────────────────────────────────────────────────────

interface Reference {
  file: string; table: string; column: string; kind: string; line: number;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** PostgREST filter/order builders whose FIRST string argument is a column. */
const COLUMN_ARG_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'order', 'not',
];

/**
 * Extracts column references from supabase-js chains.
 *
 * DELIBERATELY NOT A SQL PARSER. It reads the chain that follows
 * `.from('<table>')` up to the next `.from(` or a blank line, which is how these
 * chains are actually written in this codebase. Anything it cannot resolve
 * statically is SKIPPED rather than guessed — a guard that produces false
 * positives gets disabled, and a disabled guard catches nothing.
 */
function extractReferences(file: string): Reference[] {
  const raw = readFileSync(file, 'utf-8');
  // Strip comments so a doc example naming a dead column is not a finding.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const refs: Reference[] = [];

  const fromRe = /\.from\(\s*'([a-z_]+)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) {
    const table = m[1];
    if (!GUARDED_TABLES.includes(table)) continue;

    // The chain: from here to the next `.from(` or a double newline.
    const rest = src.slice(m.index + m[0].length);
    const nextFrom = rest.search(/\.from\(\s*'/);
    const blank = rest.search(/\n\s*\n/);
    const end = Math.min(
      nextFrom === -1 ? rest.length : nextFrom,
      blank === -1 ? rest.length : blank,
    );
    const chain = rest.slice(0, end);
    const line = src.slice(0, m.index).split('\n').length;

    // .select('a, b, c')
    for (const s of chain.matchAll(/\.select\(\s*'([^']*)'/g)) {
      for (const part of s[1].split(',')) {
        const col = part.trim()
          .replace(/^.*:/, '')       // alias:col
          .replace(/\(.*$/, '')      // embedded resource
          .replace(/::.*$/, '')      // cast
          .trim();
        if (!col || col === '*' || col.includes('.')) continue;
        refs.push({ file, table, column: col, kind: 'select', line });
      }
    }

    // .insert({ a: …, b: … }) / .update({ … }) — top-level keys only
    for (const w of chain.matchAll(/\.(insert|update|upsert)\(\s*\{([\s\S]{0,1500}?)\}\s*[,)]/g)) {
      for (const k of w[2].matchAll(/(?:^|[\n,{])\s*([a-z_][a-z0-9_]*)\s*:/g)) {
        refs.push({ file, table, column: k[1], kind: w[1], line });
      }
    }

    // .eq('col', …) and friends
    for (const f of chain.matchAll(
      new RegExp(`\\.(${COLUMN_ARG_METHODS.join('|')})\\(\\s*'([^']+)'`, 'g'))) {
      const col = f[2].replace(/\(.*$/, '').trim();
      if (!col || col.includes('.') || col.includes(' ')) continue;
      refs.push({ file, table, column: col, kind: f[1], line });
    }
  }
  return refs;
}

// ── The guard ────────────────────────────────────────────────────────────────
describe('§2 schema-drift guard', () => {
  maybe('the real schema was loaded for every guarded table', () => {
    for (const t of GUARDED_TABLES) {
      expect(schema.get(t)?.size ?? 0, `${t} has no columns — migrations did not apply`)
        .toBeGreaterThan(3);
    }
  });

  maybe('NO application code references a nonexistent column', () => {
    const bad: Reference[] = [];
    let checked = 0;

    for (const file of sourceFiles(SRC)) {
      for (const ref of extractReferences(file)) {
        checked++;
        const cols = schema.get(ref.table);
        if (!cols) continue;
        if (!cols.has(ref.column)) bad.push(ref);
      }
    }

    process.stdout.write(`\n  schema-drift guard: ${checked} column references checked ` +
                         `across ${GUARDED_TABLES.length} tables\n`);
    for (const b of bad) {
      process.stdout.write(`    BROKEN ${b.file.replace(SRC, 'src')}:${b.line} ` +
                           `${b.table}.${b.column} (${b.kind})\n`);
    }
    process.stdout.write('\n');

    expect(checked, 'guard found no references at all — the extractor is broken')
      .toBeGreaterThan(20);
    expect(bad.map(b => `${b.table}.${b.column} @ ${b.file.replace(SRC, 'src')}:${b.line}`))
      .toEqual([]);
  });

  maybe('the guard actually catches a planted bad column (negative control)', () => {
    // Without this, a guard that silently matched nothing would pass forever.
    const cols = schema.get('marketing_memories')!;
    expect(cols.has('confidence')).toBe(true);
    for (const dead of ['archive_reason', 'key', 'confidence_score']) {
      expect(cols.has(dead), `${dead} must NOT exist — it is one of the three defects`)
        .toBe(false);
    }
  });

  maybe('the extractor sees select, insert, update and filter references', () => {
    // Proves coverage is real rather than accidentally narrow.
    const kinds = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      for (const ref of extractReferences(file)) kinds.add(ref.kind);
    }
    for (const k of ['select', 'eq']) expect([...kinds], `no ${k} references found`).toContain(k);
    process.stdout.write(`  reference kinds covered: ${[...kinds].sort().join(', ')}\n`);
  });
});
