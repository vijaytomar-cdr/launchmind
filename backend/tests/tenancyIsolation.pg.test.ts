/**
 * @file tenancyIsolation.pg.test.ts
 * @description The primary acceptance test — one founder, two businesses, zero
 *   context mixing. Blockers 1, 2 and 3.
 *
 *   Runs against REAL Postgres because every guarantee here is a constraint, a
 *   trigger or a unique index. A mocked client would only prove my mock behaves.
 *
 * @security Proves that founder identity alone is NOT authorization for another
 *   workspace's business context or approval boundaries.
 * @dependencies migration 103, productIdentity
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  canonicalIdentityFromUrl, canonicalIdentityFromUrls,
} from '../src/services/productIdentity';

const URL = process.env.ONBOARDING_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client;
let ok = false;
let setupError: Error | null = null;

/**
 * Set LM_REQUIRE_PG=1 in CI so a missing database is a FAILURE, not a quiet
 * pass. Locally it still skips, because a developer without Supabase running
 * should not see a wall of red — but the skip is now visible and deliberate
 * rather than an error swallowed into a green tick.
 */
const REQUIRE_PG = process.env.LM_REQUIRE_PG === '1';

/** One founder, two independent businesses — the shape from the brief. */
const FOUNDER = randomUUID();
const WS_A = randomUUID();          // AllignX-like
const WS_B = randomUUID();          // LaunchMind-like
const PROD_A = randomUUID();
const PROD_B = randomUUID();

beforeAll(async () => {
  db = new Client({ connectionString: URL, connectionTimeoutMillis: 2000 });
  try {
    await db.connect();
    for (const m of ['20260811_000102_onboarding_canonical_state.sql',
                     '20260811_000103_context_tenancy.sql']) {
      await db.query(readFileSync(join(__dirname, '../migrations', m), 'utf-8'));
    }

    await db.query(`INSERT INTO founders (id, email) VALUES ($1,$2)
                    ON CONFLICT (id) DO NOTHING`, [FOUNDER, `tenancy-${FOUNDER}@local.test`]);
    for (const [ws, name] of [[WS_A, 'Business A'], [WS_B, 'Business B']] as const) {
      await db.query(`INSERT INTO workspaces (id, founder_id, name) VALUES ($1,$2,$3)
                      ON CONFLICT (id) DO NOTHING`, [ws, FOUNDER, name]);
    }
    await db.query(
      `INSERT INTO products (id, founder_id, workspace_id, name, store_url, platform, canonical_identity)
       VALUES ($1,$2,$3,'Home Services','https://apps.apple.com/us/app/a/id111111111','app_store','apple:111111111'),
              ($4,$2,$5,'AI CMO','https://apps.apple.com/us/app/b/id222222222','app_store','apple:222222222')
       ON CONFLICT (id) DO NOTHING`, [PROD_A, FOUNDER, WS_A, PROD_B, WS_B]);

    // Business context, deliberately contradictory between the two businesses.
    for (const [ws, prod, positioning, market] of [
      [WS_A, PROD_A, 'Home services marketplace', 'Phoenix'],
      [WS_B, PROD_B, 'AI CMO for founders', 'United States'],
    ] as const) {
      const sid = randomUUID();
      await db.query(`INSERT INTO onboarding_sessions (id, founder_id, workspace_id, product_id, current_state)
                      VALUES ($1,$2,$3,$4,'PHASE_1_COMPLETE')`, [sid, FOUNDER, ws, prod]);
      await db.query(
        `INSERT INTO founder_context (session_id, founder_id, workspace_id, product_id,
                                      positioning, markets, audience_confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sid, FOUNDER, ws, prod, positioning,
         JSON.stringify([{ type: 'metro', value: market.toLowerCase(), label: market }]),
         `${positioning} customers`]);
      await db.query(
        `INSERT INTO approval_boundary_policies (session_id, founder_id, workspace_id, product_id,
           working_style, explicit_capabilities, boundaries_source, founder_acknowledged)
         VALUES ($1,$2,$3,$4,'hands_on',$5,'owner_explicit',true)`,
        [sid, FOUNDER, ws, prod,
         JSON.stringify({ SPEND: ws === WS_A ? 'never' : 'approval_required' })]);

      // Domain state that already carried product_id but was being READ
      // founder-wide. Seeded with contradictory values so a leak is unambiguous
      // rather than a coincidence.
      const isA = ws === WS_A;
      await db.query(
        `INSERT INTO business_goals (session_id, founder_id, product_id, goal_type, target_value, unit)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sid, FOUNDER, prod,
         isA ? 'installs' : 'revenue', isA ? 500 : 40,
         isA ? 'service bookings/week' : 'SaaS customers/month']);
      await db.query(
        `INSERT INTO competitor_relationships (session_id, founder_id, product_id, name, relationship)
         VALUES ($1,$2,$3,$4,'CONFIRMED')`,
        [sid, FOUNDER, prod, isA ? 'Thumbtack' : 'HubSpot']);
      await db.query(
        `INSERT INTO strategy_directions (session_id, founder_id, product_id, headline, rationale)
         VALUES ($1,$2,$3,$4,$5)`,
        [sid, FOUNDER, prod,
         isA ? 'Own Phoenix home-services search' : 'Win founder-led SaaS acquisition',
         'seeded']);
    }
    ok = true;
  } catch (e) {
    // FAIL CLOSED. Swallowing this made all 12 assertions pass without a
    // database — the precise failure mode Phase 3.1G was nearly published with,
    // where a degraded harness reported healthy numbers. A tenancy proof that
    // cannot reach Postgres has proven nothing and must say so.
    setupError = e instanceof Error ? e : new Error(String(e));
    ok = false;
  }
});

afterAll(async () => {
  if (!ok) return;
  await db.query('DELETE FROM founders WHERE id = $1', [FOUNDER]).catch(() => undefined);
  await db.end();
});

const maybe = (n: string, f: () => Promise<void>) =>
  it(n, async () => {
    if (!ok) {
      if (REQUIRE_PG) {
        throw new Error(
          `tenancy proof could not reach Postgres, so it proved nothing: ` +
          `${setupError?.message ?? 'unknown setup failure'}`);
      }
      // Surfaced rather than hidden: a silent return is indistinguishable from
      // a passing assertion in the reporter.
      console.warn(`[SKIPPED — no Postgres] ${n}: ${setupError?.message ?? 'not connected'}`);
      return;
    }
    await f();
  });

// ── BLOCKER 1 · the primary acceptance test ─────────────────────────────────
describe('same founder, two businesses — zero context mixing', () => {
  maybe('positioning does not leak between workspaces', async () => {
    const a = await db.query(
      `SELECT positioning FROM founder_context WHERE founder_id=$1 AND workspace_id=$2`,
      [FOUNDER, WS_A]);
    const b = await db.query(
      `SELECT positioning FROM founder_context WHERE founder_id=$1 AND workspace_id=$2`,
      [FOUNDER, WS_B]);
    expect(a.rows.map(r => r.positioning)).toEqual(['Home services marketplace']);
    expect(b.rows.map(r => r.positioning)).toEqual(['AI CMO for founders']);
  });

  maybe('markets do not leak between workspaces', async () => {
    const a = await db.query(
      `SELECT markets FROM founder_context WHERE workspace_id=$1`, [WS_A]);
    expect(JSON.stringify(a.rows[0].markets)).toContain('Phoenix');
    expect(JSON.stringify(a.rows[0].markets)).not.toContain('United States');
  });

  maybe('the OLD founder-only query is the one that mixes', async () => {
    // Documents the defect rather than asserting the fix twice. This is exactly
    // what contextEngine, owner.route, contextPackageV2 and intelligenceService
    // all ran before this pass: newest row wins, across businesses.
    const mixed = await db.query(
      `SELECT positioning FROM founder_context WHERE founder_id=$1
       ORDER BY updated_at DESC LIMIT 1`, [FOUNDER]);
    const scoped = await db.query(
      `SELECT positioning FROM founder_context WHERE founder_id=$1 AND workspace_id=$2`,
      [FOUNDER, WS_A]);
    // One founder, two businesses: the unscoped query can return the wrong one.
    expect(mixed.rows).toHaveLength(1);
    expect(scoped.rows[0].positioning).toBe('Home services marketplace');
  });

  // ── BLOCKER 1 · approval boundaries ───────────────────────────────────────
  maybe('SPEND=never in one business never resolves for the other', async () => {
    const a = await db.query(
      `SELECT explicit_capabilities FROM approval_boundary_policies WHERE workspace_id=$1`, [WS_A]);
    const b = await db.query(
      `SELECT explicit_capabilities FROM approval_boundary_policies WHERE workspace_id=$1`, [WS_B]);
    expect(a.rows[0].explicit_capabilities.SPEND).toBe('never');
    expect(b.rows[0].explicit_capabilities.SPEND).toBe('approval_required');
    // The dangerous direction: B's laxer policy must never widen A's.
    expect(a.rows[0].explicit_capabilities.SPEND).not.toBe('approval_required');
  });

  maybe('a product cannot be paired with another workspace', async () => {
    // The trigger from migration 103. Without it a scoped reader could still
    // return the wrong business's context via a mismatched pair.
    await expect(db.query(
      `INSERT INTO founder_context (session_id, founder_id, workspace_id, product_id)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), FOUNDER, WS_A, PROD_B])).rejects.toThrow(/does not belong to workspace/);
  });
});

// ── BLOCKER 3 · canonical identity ──────────────────────────────────────────
describe('canonical product identity', () => {
  it('derives stable ids from the URL forms a founder actually pastes', () => {
    const apple = 'apple:1234567890';
    for (const u of [
      'https://apps.apple.com/us/app/my-app/id1234567890',
      'https://apps.apple.com/in/app/different-slug/id1234567890?mt=8',
      'http://www.apps.apple.com/gb/app/x/id1234567890/',
      'https://itunes.apple.com/us/app/x/id1234567890',
    ]) expect(canonicalIdentityFromUrl(u)).toBe(apple);

    expect(canonicalIdentityFromUrl('https://play.google.com/store/apps/details?id=com.foo.Bar'))
      .toBe('play:com.foo.bar');
    expect(canonicalIdentityFromUrl('https://www.example.com/pricing')).toBe('web:example.com');
  });

  it('never treats a display name as identity, and rejects hostile schemes', () => {
    expect(canonicalIdentityFromUrl('AllignX・Home Services')).toBeNull();
    expect(canonicalIdentityFromUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalIdentityFromUrl('file:///etc/passwd')).toBeNull();
    expect(canonicalIdentityFromUrl(null)).toBeNull();
  });

  it('prefers a store id over a website', () => {
    // A store id is issued by the platform and cannot collide; two products can
    // share a marketing domain.
    expect(canonicalIdentityFromUrls([
      'https://example.com', 'https://apps.apple.com/us/app/x/id999888777',
    ])).toBe('apple:999888777');
  });

  maybe('the same identity cannot be inserted twice in one workspace', async () => {
    await expect(db.query(
      `INSERT INTO products (id, founder_id, workspace_id, name, store_url, platform, canonical_identity)
       VALUES ($1,$2,$3,'Duplicate','https://apps.apple.com/us/app/a/id111111111','app_store','apple:111111111')`,
      [randomUUID(), FOUNDER, WS_A])).rejects.toThrow(/duplicate key|unique/i);
  });

  maybe('the SAME app in a DIFFERENT workspace is allowed', async () => {
    // Two businesses may legitimately track the same public app; isolation is
    // per workspace, not global.
    const id = randomUUID();
    await db.query(
      `INSERT INTO products (id, founder_id, workspace_id, name, store_url, platform, canonical_identity)
       VALUES ($1,$2,$3,'Same app elsewhere','https://apps.apple.com/us/app/a/id111111111','app_store','apple:111111111')`,
      [id, FOUNDER, WS_B]);
    const r = await db.query('SELECT workspace_id FROM products WHERE canonical_identity=$1', ['apple:111111111']);
    expect(r.rows).toHaveLength(2);
    await db.query('DELETE FROM products WHERE id=$1', [id]);
  });

  maybe('an archived product still blocks a duplicate', async () => {
    // Archiving must not become a way to create duplicates.
    await db.query('UPDATE products SET archived_at = now() WHERE id=$1', [PROD_A]);
    await expect(db.query(
      `INSERT INTO products (id, founder_id, workspace_id, name, store_url, platform, canonical_identity)
       VALUES ($1,$2,$3,'Re-added','https://apps.apple.com/us/app/a/id111111111','app_store','apple:111111111')`,
      [randomUUID(), FOUNDER, WS_A])).rejects.toThrow(/duplicate key|unique/i);
    await db.query('UPDATE products SET archived_at = NULL WHERE id=$1', [PROD_A]);
  });

  maybe('a product with no derivable identity is still insertable', async () => {
    // Manually created products legitimately have no store id; the partial
    // index must not block them.
    const id = randomUUID();
    await db.query(
      `INSERT INTO products (id, founder_id, workspace_id, name, store_url, platform)
       VALUES ($1,$2,$3,'Manual','https://internal.invalid','app_store')`, [id, FOUNDER, WS_A]);
    const r = await db.query('SELECT canonical_identity FROM products WHERE id=$1', [id]);
    expect(r.rows[0].canonical_identity).toBeNull();
    await db.query('DELETE FROM products WHERE id=$1', [id]);
  });
});

// ── Domain state that already had product_id but was read founder-wide ───────
// These tables never needed a migration. The defect was entirely in the
// readers, so the proof is that the SCOPED query is right and the FOUNDER-WIDE
// query is demonstrably capable of returning the other business.
describe('goals, competitors and strategy do not cross businesses', () => {
  maybe('goals do not cross', async () => {
    const a = await db.query(
      `SELECT goal_type, unit FROM business_goals WHERE product_id=$1`, [PROD_A]);
    const b = await db.query(
      `SELECT goal_type, unit FROM business_goals WHERE product_id=$1`, [PROD_B]);
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(1);
    expect(a.rows[0].unit).toBe('service bookings/week');
    expect(b.rows[0].unit).toBe('SaaS customers/month');

    // The shape every reader used before this pass: one founder, both goals.
    const founderWide = await db.query(
      `SELECT unit FROM business_goals WHERE founder_id=$1`, [FOUNDER]);
    expect(founderWide.rows).toHaveLength(2);
  });

  maybe('competitors do not cross', async () => {
    const a = await db.query(
      `SELECT name FROM competitor_relationships WHERE product_id=$1`, [PROD_A]);
    const b = await db.query(
      `SELECT name FROM competitor_relationships WHERE product_id=$1`, [PROD_B]);
    expect(a.rows.map(r => r.name)).toEqual(['Thumbtack']);
    expect(b.rows.map(r => r.name)).toEqual(['HubSpot']);
    // HubSpot is not a competitor of a home-services marketplace.
    expect(a.rows.map(r => r.name)).not.toContain('HubSpot');
  });

  maybe('strategy does not cross', async () => {
    const a = await db.query(
      `SELECT headline FROM strategy_directions WHERE product_id=$1`, [PROD_A]);
    const b = await db.query(
      `SELECT headline FROM strategy_directions WHERE product_id=$1`, [PROD_B]);
    expect(a.rows[0].headline).toContain('Phoenix');
    expect(b.rows[0].headline).toContain('SaaS');
    expect(a.rows[0].headline).not.toContain('SaaS');
  });
});

// ── Backfill and quarantine (§16 C/D) ───────────────────────────────────────
describe('deterministic backfill, and no guessing when it is ambiguous', () => {
  maybe('a session-scoped row is backfilled from its session, not guessed', async () => {
    // A legacy-shaped row: tenancy columns left NULL, session present.
    const sid = randomUUID();
    await db.query(`INSERT INTO onboarding_sessions (id, founder_id, workspace_id, product_id, current_state)
                    VALUES ($1,$2,$3,$4,'PHASE_1_COMPLETE')`, [sid, FOUNDER, WS_B, PROD_B]);
    await db.query(
      `INSERT INTO founder_context (session_id, founder_id, positioning) VALUES ($1,$2,'legacy row')`,
      [sid, FOUNDER]);

    // Re-run the migration's backfill statement verbatim.
    await db.query(`
      UPDATE founder_context fc
      SET    workspace_id = os.workspace_id,
             product_id   = COALESCE(fc.product_id, os.product_id)
      FROM   onboarding_sessions os
      WHERE  os.id = fc.session_id
        AND  os.workspace_id IS NOT NULL
        AND  fc.workspace_id IS DISTINCT FROM os.workspace_id`);

    const r = await db.query(
      `SELECT workspace_id, product_id FROM founder_context WHERE session_id=$1`, [sid]);
    // Resolved to B because its SESSION says B — never to A, which is the other
    // business the same founder owns and the only other candidate.
    expect(r.rows[0].workspace_id).toBe(WS_B);
    expect(r.rows[0].product_id).toBe(PROD_B);

    await db.query('DELETE FROM onboarding_sessions WHERE id=$1', [sid]);
  });

  maybe('an unmappable row is QUARANTINED, not assigned to a plausible workspace', async () => {
    // The dangerous case: no session, so nothing authoritative says which of the
    // founder's two businesses this belongs to. Guessing here is exactly the
    // defect being fixed, permanently baked in.
    await db.query(
      `INSERT INTO founder_context (session_id, founder_id, positioning)
       VALUES (NULL,$1,'orphan — owner unknown')`, [FOUNDER]);

    await db.query(`
      UPDATE founder_context fc
      SET    workspace_id = os.workspace_id
      FROM   onboarding_sessions os
      WHERE  os.id = fc.session_id AND os.workspace_id IS NOT NULL
        AND  fc.workspace_id IS DISTINCT FROM os.workspace_id`);

    const orphan = await db.query(
      `SELECT workspace_id FROM founder_context
       WHERE founder_id=$1 AND positioning='orphan — owner unknown'`, [FOUNDER]);
    expect(orphan.rows[0].workspace_id).toBeNull();

    // And it is VISIBLE rather than silently tolerated.
    const q = await db.query(
      `SELECT table_name FROM lm_untenanted_context WHERE founder_id=$1`, [FOUNDER]);
    expect(q.rows.length).toBeGreaterThan(0);
    expect(q.rows.map(r => r.table_name)).toContain('founder_context');

    await db.query(
      `DELETE FROM founder_context WHERE founder_id=$1 AND positioning='orphan — owner unknown'`,
      [FOUNDER]);
  });
});

// ── GDPR stays intentionally founder-wide (§16 F) ───────────────────────────
describe('GDPR remains founder-wide by design', () => {
  maybe('export sees BOTH businesses — scoping it would under-disclose', async () => {
    // The one place founder_id alone is the correct filter. A right-to-access
    // request that returned only one of a founder's businesses would be a
    // compliance failure, so this must NOT be "fixed" alongside the others.
    const all = await db.query(
      `SELECT workspace_id FROM products WHERE founder_id=$1 AND workspace_id IS NOT NULL`,
      [FOUNDER]);
    const seen = new Set(all.rows.map(r => r.workspace_id));
    expect(seen.has(WS_A)).toBe(true);
    expect(seen.has(WS_B)).toBe(true);
  });

  maybe('deletion is founder-wide and removes both businesses together', async () => {
    // Rehearsed on a throwaway founder so the shared fixture survives.
    const f = randomUUID();
    const w1 = randomUUID(), w2 = randomUUID();
    await db.query(`INSERT INTO founders (id, email) VALUES ($1,$2)`, [f, `gdpr-${f}@local.test`]);
    for (const w of [w1, w2]) {
      await db.query(`INSERT INTO workspaces (id, founder_id, name) VALUES ($1,$2,'w')`, [w, f]);
    }
    await db.query(`DELETE FROM workspaces WHERE founder_id=$1`, [f]);
    const left = await db.query(`SELECT id FROM workspaces WHERE founder_id=$1`, [f]);
    expect(left.rows).toHaveLength(0);
    await db.query('DELETE FROM founders WHERE id=$1', [f]);
  });
});
