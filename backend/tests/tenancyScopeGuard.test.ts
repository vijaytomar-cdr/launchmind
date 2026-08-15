/**
 * @file tenancyScopeGuard.test.ts
 * @description Structural guard — business-context tables must never be read by
 *   founder_id alone.
 *
 *   THIS DEFECT CLASS RECURRED IN FOUR FILES INDEPENDENTLY: contextEngine,
 *   owner.route, contextPackageV2 and intelligenceService each read
 *   founder_context with `founder_id` + "newest row wins". Every one was
 *   individually reasonable — a founder HAS one context, until they have two
 *   businesses — and none of them failed, threw, or logged. They just answered
 *   about the wrong business.
 *
 *   A fix without a guard would be re-broken by the fifth reader. TypeScript
 *   cannot see inside a PostgREST query chain, so the check is textual, but it
 *   is anchored on the real table names rather than on a naming convention.
 *
 *   ALLOW-LIST, NOT SUPPRESSION. Founder-wide reads are sometimes CORRECT —
 *   GDPR export and erasure must span every business a founder owns, and
 *   narrowing them would be a compliance failure. Those sites are named
 *   explicitly with a reason, so an exemption is a decision on the record
 *   rather than a silent `// eslint-disable`.
 *
 * @security Prevents cross-business context leakage from reappearing.
 * @dependencies none — reads source text only
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', 'src');

/**
 * Tables holding state that belongs to ONE business, not to a founder.
 * founder_context and approval_boundary_policies gained tenancy in migration
 * 103; the other two always had product_id and were merely read too broadly.
 */
const BUSINESS_SCOPED_TABLES = [
  'founder_context',
  'approval_boundary_policies',
  'business_goals',
  'competitor_relationships',
  'strategy_directions',
];

/** Any of these in the same query chain constitutes a real scope. */
const SCOPE_MARKERS = [
  "'workspace_id'", "'product_id'", "'session_id'", "'id'",
];

/**
 * Sites where a founder-wide read is the CORRECT behaviour.
 * Each entry must say why, because "it was already like that" is not a reason.
 */
const FOUNDER_WIDE_BY_DESIGN: Array<{ file: string; why: string }> = [
  { file: 'routes/founders.route.ts',
    why: 'GDPR export and erasure are account-wide by law. Scoping them to one ' +
         'business would under-disclose on a right-to-access request and leave ' +
         'data behind on a right-to-erasure request.' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Extracts each `.from('<table>')` chain, bounded at the NEXT query.
 *
 * The bound matters more than it looks. A first version cut only at `;` or a
 * blank line, reasoning that over-reading could "only cause a false pass" —
 * but these reads live inside big `Promise.all([...])` arrays, so the chain ran
 * on into sibling queries and inherited THEIR `product_id` filters. A mutation
 * check caught it: reverting contextPackageV2 to a founder-wide read left the
 * guard green. A guard that cannot fail is worse than none, because it is
 * counted as coverage.
 *
 * Cutting at the next `.from(` is what makes each chain exactly one query.
 */
function chainsFor(source: string, table: string): string[] {
  const chains: string[] = [];
  const needle = `.from('${table}')`;
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    const rest = source.slice(idx + needle.length);
    const bounds = [
      rest.indexOf('.from('),        // the next query in the same batch
      rest.search(/;/),              // end of statement
      rest.search(/\n\s*\n/),        // blank line
    ].filter(i => i !== -1);
    const end = bounds.length ? Math.min(...bounds) : rest.length;
    chains.push(needle + rest.slice(0, end));
    idx = source.indexOf(needle, idx + needle.length);
  }
  return chains;
}

describe('business-context tables are never read by founder_id alone', () => {
  const files = walk(SRC);

  it('scans a meaningful amount of source (the guard is not silently empty)', () => {
    // A guard that finds nothing because its path is wrong reports success.
    expect(files.length).toBeGreaterThan(50);
    const anyHit = files.some(f =>
      BUSINESS_SCOPED_TABLES.some(t => readFileSync(f, 'utf-8').includes(`.from('${t}')`)));
    expect(anyHit).toBe(true);
  });

  for (const table of BUSINESS_SCOPED_TABLES) {
    it(`${table} is always scoped to a business`, () => {
      const violations: string[] = [];

      for (const file of files) {
        const rel = relative(SRC, file);
        const exempt = FOUNDER_WIDE_BY_DESIGN.find(e => rel.endsWith(e.file));
        const source = readFileSync(file, 'utf-8');

        for (const chain of chainsFor(source, table)) {
          // READS only. A write carries its tenancy in the payload object
          // (`session_id: sessionId`), not in a filter, so applying this rule to
          // inserts and upserts would flag every correct writer — noise that
          // teaches people to ignore the guard. Writers are proven instead by
          // multiProductContextIsolation's "alignment writes carry tenancy".
          if (!/\.select\(/.test(chain)) continue;
          const scoped = SCOPE_MARKERS.some(m => chain.includes(m));
          if (scoped) continue;
          // Unscoped. Only an explicitly reasoned exemption may stand.
          if (exempt) continue;
          violations.push(
            `${rel}: reads ${table} with no workspace/product/session scope.\n` +
            `    ${chain.split('\n').slice(0, 4).join('\n    ')}`);
        }
      }

      expect(violations, violations.length
        ? `\n\nUNSCOPED BUSINESS-CONTEXT READ — this returns another business's ` +
          `state for a founder who owns two.\n\n${violations.join('\n\n')}\n\n` +
          `Add .eq('workspace_id', …) or .eq('product_id', …). If the read is ` +
          `genuinely account-wide (GDPR), add it to FOUNDER_WIDE_BY_DESIGN with ` +
          `a reason.\n`
        : undefined).toEqual([]);
    });
  }

  it('every exemption states a reason', () => {
    // An allow-list without reasons decays into a suppression list.
    for (const e of FOUNDER_WIDE_BY_DESIGN) {
      expect(e.why.length).toBeGreaterThan(40);
    }
  });
});
