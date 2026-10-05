/**
 * @file dualDbGuards.test.ts
 * @description P1-45 negative controls — M1..M7, as guard decisions.
 *
 *   Every one of these is a refusal that must happen BEFORE a database is
 *   touched, so the decision logic is a pure function and these tests need no
 *   database at all. That is not a convenience: the environment this was written
 *   in could not start a second Supabase stack (host disk exhausted), and a
 *   guard verifiable only by the thing it protects is a guard nobody has checked.
 *
 *   What these tests DO prove: given a described environment, the guard refuses.
 *   What they do NOT prove: that two isolated databases exist and that PG
 *   certification passes against one. That requires the environment and is
 *   reported as blocked, not as passed.
 *
 * @security No network, no database, no Docker.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs guard shared with the certification scripts
import { evaluateDatabaseGeneration, DB_GENERATIONS } from '../../scripts/cert-env-guard.mjs';

const PG_URL = 'http://127.0.0.1:54421';
const BROWSER_URL = 'http://127.0.0.1:54321';

type Args = Parameters<typeof evaluateDatabaseGeneration>[0];
const evaluate = (o: Partial<Args>) => evaluateDatabaseGeneration({
  workflow: 'PG_INTEGRATION', targetUrl: PG_URL, marker: 'PG_INTEGRATION',
  browserFixturePresent: false, ...o,
} as Args) as { allowed: boolean; refusals: string[] };

const refusedFor = (o: Partial<Args>, pattern: RegExp) => {
  const r = evaluate(o);
  expect(r.allowed, `guard allowed it: ${JSON.stringify(o)}`).toBe(false);
  expect(r.refusals.join(' | ')).toMatch(pattern);
};

describe('P1-45 dual database generation guard', () => {
  it('baseline: each workflow is allowed on its own generation', () => {
    expect(evaluate({}).allowed).toBe(true);
    expect(evaluate({
      workflow: 'BROWSER_CERT', targetUrl: BROWSER_URL,
      marker: 'BROWSER_CERT', browserFixturePresent: true,
    }).allowed).toBe(true);
  });

  it('M1 — PG certification pointed at the BROWSER database is refused', () => {
    refusedFor({ targetUrl: BROWSER_URL, marker: 'BROWSER_CERT', browserFixturePresent: true },
      /marked BROWSER_CERT/);
  });

  it('M2 — browser certification pointed at the PG database is refused', () => {
    refusedFor({ workflow: 'BROWSER_CERT', targetUrl: PG_URL, marker: 'PG_INTEGRATION' },
      /marked PG_INTEGRATION/);
  });

  it('M3 — a non-loopback target is refused', () => {
    refusedFor({ targetUrl: 'https://gseqtbwdenjkwysregpp.supabase.co' }, /not loopback/);
    // And the substring shape that the old per-script guards would have passed.
    refusedFor({ targetUrl: 'https://gseqtbwdenjkwysregpp.supabase.co/rest/v1/localhost' },
      /not loopback/);
  });

  it('M4 — the browser fixture present in the PG database is refused', () => {
    // Independent of the marker: seeding the browser identity into the PG
    // database is caught even if the marker still says PG_INTEGRATION.
    refusedFor({ browserFixturePresent: true }, /canonical browser fixture is present/);
  });

  it('M5 — a missing generation marker is refused, never defaulted', () => {
    refusedFor({ marker: null }, /no generation marker/);
    refusedFor({ marker: 'SOMETHING_ELSE' }, /unrecognised generation marker/);
  });

  it('M6 — browser certification without its fixture identity is refused', () => {
    refusedFor({
      workflow: 'BROWSER_CERT', targetUrl: BROWSER_URL,
      marker: 'BROWSER_CERT', browserFixturePresent: false,
    }, /fixture is absent/);
  });

  it('M7 — both generations resolving to ONE database is refused', () => {
    refusedFor({ otherUrl: PG_URL }, /SAME database/);
    // Different host, same intent — still isolated, so not refused for this.
    expect(evaluate({ otherUrl: BROWSER_URL }).allowed).toBe(true);
  });

  it('a hosted project reference anywhere in the environment is refused', () => {
    refusedFor({ hostedRefVars: ['SUPABASE_URL'] }, /hosted project reference/);
  });

  it('refusals accumulate — the first problem does not mask the rest', () => {
    const r = evaluate({
      targetUrl: 'https://example.com', marker: null,
      browserFixturePresent: true, hostedRefVars: ['NEXT_PUBLIC_SUPABASE_URL'],
    });
    expect(r.allowed).toBe(false);
    expect(r.refusals.length).toBeGreaterThanOrEqual(4);
  });

  it('the generation vocabulary is exactly two values', () => {
    expect(DB_GENERATIONS).toEqual(['PG_INTEGRATION', 'BROWSER_CERT']);
  });
});
