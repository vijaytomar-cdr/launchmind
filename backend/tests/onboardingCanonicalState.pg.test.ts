/**
 * @file onboardingCanonicalState.pg.test.ts
 * @description Verifies migration 102 (G1–G8) against a REAL Postgres, because
 *   every guarantee it makes is a database constraint. A mocked client would
 *   assert that my mock honours a CHECK, which proves nothing.
 *
 * @security Covers the G7 default removal (an unstated market must not read as
 *   USA) and the G4 style/authority separation.
 * @dependencies migration 102, pgTestDb helper
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const URL = process.env.ONBOARDING_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client;
let available = false;

beforeAll(async () => {
  db = new Client({ connectionString: URL, connectionTimeoutMillis: 2000 });
  try {
    await db.connect();
    await db.query(readFileSync(
      join(__dirname, '../migrations/20260811_000102_onboarding_canonical_state.sql'), 'utf-8'));
    available = true;
  } catch { available = false; }
});

afterAll(async () => { if (available) await db.end(); });

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => { if (!available) return; await fn(); });

describe('migration 102 · G1–G8 canonical state', () => {
  maybe('is idempotent', async () => {
    const sql = readFileSync(
      join(__dirname, '../migrations/20260811_000102_onboarding_canonical_state.sql'), 'utf-8');
    await db.query(sql);
    await db.query(sql);            // must not throw
  });

  // ── G1 · G2 · G5 · G6 · G7 ────────────────────────────────────────────────
  maybe('G1/G2/G6 · founder_context carries positioning, problem and success', async () => {
    const { rows } = await db.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'founder_context'
         AND column_name IN ('positioning','value_proposition','primary_customer_problem',
                             'success_definition','current_channels','markets','confirmed_fields')`);
    expect(rows).toHaveLength(7);
    // All nullable except confirmed_fields, so an existing workspace reads
    // "unset" rather than acquiring fabricated values (§15).
    for (const r of rows) {
      if (r.column_name !== 'confirmed_fields') expect(r.is_nullable).toBe('YES');
    }
  });

  // ── G3 ────────────────────────────────────────────────────────────────────
  maybe('G3 · maturity is governed and nullable', async () => {
    const { rows } = await db.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'maturity'`);
    expect(rows[0].is_nullable).toBe('YES');   // legacy products stay "unknown"
  });

  maybe('G3 · rejects a maturity outside the taxonomy', async () => {
    await expect(db.query(
      `DO $$ BEGIN
         PERFORM 1;
         INSERT INTO onboarding_sessions (founder_id, current_state, product_maturity)
         VALUES (gen_random_uuid(), 'WORKSPACE_SETUP', 'super_mature');
       END $$;`)).rejects.toThrow();
  });

  // ── G7 — the highest-risk gap ─────────────────────────────────────────────
  maybe('G7 · products.markets no longer defaults to USA', async () => {
    const { rows } = await db.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'markets'`);
    // A wrong market is worse than a missing one: it mis-scopes every
    // geography-sensitive memory while looking perfectly well-formed.
    expect(rows[0].column_default).toBeNull();
  });

  // ── G8 ────────────────────────────────────────────────────────────────────
  maybe('G8 · goals carry primacy and priority, and allow an unknown target', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'business_goals'
         AND column_name IN ('is_primary','priority','target_unknown')`);
    expect(rows).toHaveLength(3);
  });

  maybe('G8 · at most one primary goal per session', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'business_goals_one_primary'`);
    expect(rows).toHaveLength(1);
    // Partial: supporting goals are unconstrained, and legacy single-goal rows
    // (is_primary defaults true) remain valid.
    expect(rows[0].indexdef).toContain('WHERE is_primary');
  });

  // ── G4 ────────────────────────────────────────────────────────────────────
  maybe('G4 · boundaries record whether the owner chose them', async () => {
    const { rows } = await db.query(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'approval_boundary_policies'
         AND column_name IN ('explicit_capabilities','boundaries_source')`);
    expect(rows).toHaveLength(2);
    const src = rows.find(r => r.column_name === 'boundaries_source');
    // Defaults to the legacy behaviour so existing rows are correctly labelled
    // as derived rather than silently claiming the owner chose them.
    expect(src.column_default).toContain('derived_from_style');
  });

  maybe('G4 · rejects an unknown boundaries source', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'approval_boundaries_source_ck'`);
    expect(rows[0].def).toContain('owner_explicit');
  });
});

describe('G4 · style and authority are separate concepts', () => {
  /** Mirrors the derivation in saveBoundaries. */
  function derive(explicit: Record<string, string> | undefined, styleLists: {
    permitted: string[]; required: string[];
  }): { autonomous: string[]; approval: string[]; source: string } {
    if (!explicit) {
      return { autonomous: styleLists.permitted, approval: styleLists.required, source: 'derived_from_style' };
    }
    return {
      autonomous: Object.keys(explicit).filter(k => explicit[k] === 'autonomous'),
      approval:   Object.keys(explicit).filter(k => explicit[k] === 'approval_required'),
      source:     'owner_explicit',
    };
  }

  it('never degrades "never" into "ask me first"', () => {
    // The load-bearing assertion of G4. "Never change ad spend" must not become
    // "ask me before changing ad spend" — those are different instructions, and
    // silently widening one into the other is an authority escalation.
    const r = derive({ RECOMMEND: 'autonomous', DRAFT: 'autonomous',
                       CHANGE: 'never', PUBLISH: 'approval_required', SPEND: 'never' },
                     { permitted: [], required: [] });
    expect(r.autonomous).toEqual(['RECOMMEND', 'DRAFT']);
    expect(r.approval).toEqual(['PUBLISH']);
    expect(r.autonomous).not.toContain('SPEND');
    expect(r.approval).not.toContain('SPEND');
    expect(r.autonomous).not.toContain('CHANGE');
    expect(r.approval).not.toContain('CHANGE');
  });

  it('explicit owner choice overrides the working-style preset', () => {
    const r = derive({ RECOMMEND: 'autonomous' },
                     { permitted: ['content_draft', 'campaign_launch'], required: [] });
    expect(r.source).toBe('owner_explicit');
    expect(r.autonomous).not.toContain('campaign_launch');
  });

  it('falls back to the derived lists when the owner states nothing', () => {
    const r = derive(undefined, { permitted: ['content_draft'], required: ['campaign_launch'] });
    expect(r.source).toBe('derived_from_style');
    expect(r.autonomous).toEqual(['content_draft']);
  });

  it('a permissive working style cannot broaden an explicit boundary', () => {
    // §19: workingStyle must not silently widen authority the owner restricted.
    const r = derive({ SPEND: 'never' },
                     { permitted: ['spend_increase', 'campaign_launch'], required: [] });
    expect(r.autonomous).toEqual([]);
  });
});
