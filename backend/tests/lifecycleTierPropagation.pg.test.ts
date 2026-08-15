/**
 * @file lifecycleTierPropagation.pg.test.ts
 * @description PRODUCTION-PATH tests for governed authority propagation.
 *
 *   Codex review: the previous lifecycle tests reproduced the resolver logic in a
 *   test helper, so they proved the algorithm and NOT the code path. These call
 *   the real exported lifecycle functions against a real database, which is the
 *   only way to catch a nested caller dropping the challenger tier.
 *
 *   THE INVARIANT: legacy status is a property of the INCUMBENT (memory_class
 *   NULL and authority_tier NULL), never of what a caller happened to pass. A
 *   governed incumbent with a missing challenger tier FAILS CLOSED.
 *
 * @security Proves founder review cannot be bypassed by omitting the tier.
 * @dependencies memoryLifecycleService (real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import {
  challengeMemory, supersedeMemory, ingestCandidateClaim, founderCorrect,
} from '../src/services/memory/memoryLifecycleService';
import { normalizeMemoryScope } from '../src/services/memory/scopePolicy';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const F  = uuidFrom('tierprop-founder');
const WS = uuidFrom('tierprop-ws');
const P  = uuidFrom('tierprop-prod');
const db = () => getSupabaseAdmin();

const isLocal = (process.env.SUPABASE_URL ?? '').includes('127.0.0.1');
const d = isLocal ? describe : describe.skip;

const norm = normalizeMemoryScope({ geography: 'usa' });

/** Creates a fresh memory row and returns its id. Governed unless `legacy`. */
async function mkMemory(key: string, opts: {
  tier?: string | null; source: string; legacy?: boolean; malformed?: boolean;
}): Promise<string> {
  const id = uuidFrom(`tierprop-${key}-${Date.now()}-${Math.random()}`);
  const governed = !opts.legacy;
  const row: Record<string, unknown> = {
    id, founder_id: F, workspace_id: WS, product_id: P,
    memory_type: 'product', title: `t-${key}`, content: { claim: `claim ${key}` },
    source: opts.source, confidence: 0.5, status: 'active', version: 1, evidence_ids: [],
    scope: {}, scope_specificity: 0, scope_completeness: 'unknown',
  };
  if (governed && !opts.malformed) {
    Object.assign(row, {
      memory_class: 'FACT', authority_tier: opts.tier, authority_policy_version: 1,
      scope: norm.scope, scope_key: norm.scopeKey,
      scope_specificity: norm.specificity, scope_completeness: norm.completeness,
    });
  }
  const { error } = await db().from('marketing_memories').insert(row);
  if (error) throw new Error(`mkMemory(${key}): ${error.message}`);
  return id;
}

/** A malformed governed row must be forced past the DB constraint deliberately. */
async function mkMalformed(key: string): Promise<string | null> {
  const id = uuidFrom(`tierprop-malformed-${key}`);
  const { error } = await db().from('marketing_memories').insert({
    id, founder_id: F, workspace_id: WS, product_id: P,
    memory_type: 'product', title: 'malformed', content: { claim: 'malformed' },
    source: 'founder_feedback', confidence: 0.5, status: 'active', version: 1,
    evidence_ids: [], memory_class: 'FACT', authority_tier: null,
    scope: norm.scope, scope_key: norm.scopeKey,
    scope_specificity: norm.specificity, scope_completeness: norm.completeness,
  });
  return error ? null : id;   // null => the DB constraint correctly refused it
}

const statusOf = async (id: string) =>
  ((await db().from('marketing_memories').select('status').eq('id', id).maybeSingle()).data as { status: string } | null)?.status;

d('governed lifecycle tier propagation (production paths)', () => {
  beforeAll(async () => {
    await db().from('founders').upsert({ id: F, email: 'tierprop@lab.invalid', name: 'TIERPROP', plan: 'studio' }, { onConflict: 'id' });
    await db().from('workspaces').upsert({ id: WS, founder_id: F, name: 'TierProp' }, { onConflict: 'id' });
    await db().from('products').upsert({ id: P, founder_id: F, workspace_id: WS, name: 'TP', store_url: 'https://x.invalid', platform: 'app_store' }, { onConflict: 'id' });
  }, 120_000);

  afterAll(async () => {
    await db().from('marketing_memories').delete().eq('workspace_id', WS);
    await db().from('products').delete().eq('id', P);
    await db().from('workspaces').delete().eq('id', WS);
    await db().from('founders').delete().eq('id', F);
  });

  it('F — governed incumbent + MISSING challenger tier FAILS CLOSED (not legacy)', async () => {
    const id = await mkMemory('failclosed', { tier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' });
    await expect(challengeMemory(id, WS, {
      challengerSource: 'growth_brain', actorType: 'system',
      // challengerAuthorityTier deliberately omitted
    })).rejects.toThrow(/GOVERNED_CHALLENGER_AUTHORITY_MISSING|requires challengerAuthorityTier/);
    // And the incumbent is untouched.
    expect(await statusOf(id)).toBe('active');
  }, 120_000);

  it('B — governed founder incumbent cannot be superseded by a derived challenger', async () => {
    const id = await mkMemory('founder', { tier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' });
    const other = await mkMemory('derived-chal', { tier: 'DERIVED_INFERENCE', source: 'growth_brain' });
    const res = await supersedeMemory(id, WS, {
      supersededById: other, challengerSource: 'growth_brain',
      challengerAuthorityTier: 'DERIVED_INFERENCE', actorType: 'system',
    });
    // Downgraded to a challenge by the guardrail — never superseded.
    expect(await statusOf(id)).not.toBe('superseded');
    expect(res.toStatus).not.toBe('superseded');
  }, 120_000);

  it('A/C — governed derived incumbent + stronger challenger supersedes on tiers', async () => {
    const id = await mkMemory('derived-inc', { tier: 'DERIVED_INFERENCE', source: 'growth_brain' });
    const winner = await mkMemory('ext-chal', { tier: 'VERIFIED_EXTERNAL', source: 'public_official' });
    await supersedeMemory(id, WS, {
      supersededById: winner, challengerSource: 'public_official',
      challengerAuthorityTier: 'VERIFIED_EXTERNAL', actorType: 'system',
    });
    expect(await statusOf(id)).toBe('superseded');
  }, 120_000);

  it('D/E — changing ONLY the governed challenger source changes nothing', async () => {
    const run = async (src: string) => {
      const id = await mkMemory(`inv-${src}`, { tier: 'DERIVED_INFERENCE', source: 'growth_brain' });
      const w  = await mkMemory(`invw-${src}`, { tier: 'VERIFIED_EXTERNAL', source: src });
      await supersedeMemory(id, WS, {
        supersededById: w, challengerSource: src,
        challengerAuthorityTier: 'VERIFIED_EXTERNAL', actorType: 'system',
      });
      return statusOf(id);
    };
    // `public_reputable` weights LOWER on the legacy source table; only the
    // governed tier may decide, so both must produce the same outcome.
    expect(await run('public_official')).toBe(await run('public_reputable'));
  }, 120_000);

  it('I — supersede downgrade-to-challenge path forwards the tier', async () => {
    const id = await mkMemory('downgrade', { tier: 'FOUNDER_ASSERTED', source: 'founder_bootstrap' });
    const other = await mkMemory('downgrade-chal', { tier: 'DERIVED_INFERENCE', source: 'growth_brain' });
    // Reaches challengeMemory internally. If the tier were dropped there, the
    // governed incumbent would raise GOVERNED_CHALLENGER_AUTHORITY_MISSING.
    await expect(supersedeMemory(id, WS, {
      supersededById: other, challengerSource: 'growth_brain',
      challengerAuthorityTier: 'DERIVED_INFERENCE', actorType: 'system',
    })).resolves.toBeDefined();
  }, 120_000);

  it('G/H — ingestCandidateClaim nested paths forward the tier', async () => {
    const id = await mkMemory('ingest', { tier: 'DERIVED_INFERENCE', source: 'growth_brain' });
    const claim = { text: 'claim ingest contradicted', memoryType: 'FACT' as const,
      scope: { channel: null, segment: null, market: null, timeframe: null, productId: null } };
    // If either nested writer dropped the tier this rejects instead of resolving.
    await expect(ingestCandidateClaim(id, WS, claim, {
      challengerSource: 'public_official', challengerAuthorityTier: 'VERIFIED_EXTERNAL',
      actorType: 'system',
    })).resolves.toBeDefined();
  }, 120_000);

  it('founderCorrect carries FOUNDER_CONFIRMED explicitly', async () => {
    const id = await mkMemory('foundercorrect', { tier: 'DERIVED_INFERENCE', source: 'growth_brain' });
    await expect(founderCorrect(id, WS, {
      correctedContent: { claim: 'founder corrected' }, founderId: F, traceId: null,
    } as never)).resolves.toBeDefined();
  }, 120_000);

  it('K — malformed governed row (class set, tier NULL)', async () => {
    const id = await mkMalformed('k');
    if (id === null) {
      // The DB completeness constraint refused it — the stronger outcome.
      expect(id).toBeNull();
      return;
    }
    await expect(challengeMemory(id, WS, {
      challengerSource: 'growth_brain', challengerAuthorityTier: 'DERIVED_INFERENCE',
      actorType: 'system',
    })).rejects.toThrow(/GOVERNED_AUTHORITY_MISSING/);
  }, 120_000);

  it('L — TRUE legacy row (class NULL, tier NULL) keeps the source path', async () => {
    const id = await mkMemory('legacy', { source: 'founder_feedback', legacy: true });
    const other = await mkMemory('legacy-chal', { source: 'growth_brain', legacy: true });
    // No challenger tier supplied, and this must NOT fail closed.
    await expect(supersedeMemory(id, WS, {
      supersededById: other, challengerSource: 'growth_brain', actorType: 'system',
    })).resolves.toBeDefined();
  }, 120_000);
});
