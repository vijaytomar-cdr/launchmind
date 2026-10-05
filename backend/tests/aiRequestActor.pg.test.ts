/**
 * @file aiRequestActor.pg.test.ts
 * @description P1-43 — system AI calls are audited, and audit identity never
 *   becomes founder authority.
 *
 *   Drives REAL Postgres, because the defect was code that looked correct sitting
 *   in front of a database that rejected every row. A test with a mocked client
 *   would have passed against the broken version.
 *
 * @security The CHECK constraints in migration 115 are the structural half; the
 *   grep test is the architectural half. Neither alone is sufficient: a constraint
 *   stops a bad row, and only the grep stops a future reader treating a row as
 *   permission.
 * @dependencies aiPlatform, migration 115, local Postgres
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { requirePostgres } from './helpers/requirePostgres';
import { resolveAiActor } from '../src/lib/aiPlatform';

const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RUN = `${Date.now()}-${process.pid}`;
const FOUNDER = uuidFrom(`aia-founder-${RUN}`);
const WSA = uuidFrom(`aia-ws-a-${RUN}`);
const WSB = uuidFrom(`aia-ws-b-${RUN}`);

const db = () => createClient(pg.url, pg.serviceKey, { auth: { persistSession: false } });

const base = {
  prompt_id: 'aia_probe', model: 'claude-haiku-4-5-20251001',
  action: 'aia_probe', latency_ms: 5, retries: 0, status: 'success' as const,
};

d('AI request actor — the split between call provenance and authority', () => {
  beforeAll(async () => {
    const c = db();
    await c.from('founders').insert({ id: FOUNDER, email: `aia-${RUN}@staging.test`, plan: 'solo' });
    await c.from('workspaces').insert([
      { id: WSA, founder_id: FOUNDER, name: 'A' },
      { id: WSB, founder_id: FOUNDER, name: 'B' },
    ]);
  });

  it('resolveAiActor: a UUID is a founder, anything else is the system', () => {
    expect(resolveAiActor(FOUNDER)).toEqual({ actorType: 'founder', founderId: FOUNDER });
    for (const notAFounder of ['system', 'worker', '', null, undefined, 'system-1', 'SYSTEM']) {
      const r = resolveAiActor(notAFounder as string | null | undefined);
      expect(r.actorType, `${String(notAFounder)} was treated as a founder`).toBe('system');
      expect(r.founderId).toBeNull();
    }
  });

  it('NO synthetic founder is minted to represent the system', async () => {
    // The rejected alternative, asserted so it cannot quietly return: a fake
    // founder row would make every authority surface see a person who does not
    // exist. resolveAiActor must produce NULL, not an id.
    expect(resolveAiActor('system').founderId).toBeNull();
    const { data } = await db().from('founders')
      .select('id, email').or('email.ilike.%system%,email.ilike.%launchmind-system%');
    expect((data ?? []).length, 'a synthetic system founder exists').toBe(0);
  });

  it('a system audit row persists with real usage and no founder identity', async () => {
    const { data, error } = await db().from('ai_requests').insert({
      ...base, actor_type: 'system', founder_id: null, workspace_id: WSA,
      input_tokens: 14, output_tokens: 4, total_tokens: 18, cost_usd: 0.000009,
    }).select('id, actor_type, founder_id, workspace_id, total_tokens, cost_usd').single();
    expect(error).toBeNull();
    expect(data!.actor_type).toBe('system');
    expect(data!.founder_id).toBeNull();
    expect(Number(data!.total_tokens)).toBe(18);
    expect(Number(data!.cost_usd)).toBeGreaterThan(0);
  });

  it('STRUCTURAL: a system row cannot carry founder identity', async () => {
    const { error } = await db().from('ai_requests')
      .insert({ ...base, actor_type: 'system', founder_id: FOUNDER });
    expect(error, 'a system row was allowed to carry a founder').not.toBeNull();
    expect(error!.message).toContain('ai_requests_system_has_no_founder');
  });

  it('STRUCTURAL: an unknown actor type is rejected', async () => {
    const { error } = await db().from('ai_requests')
      .insert({ ...base, actor_type: 'superuser', founder_id: null });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('ai_requests_actor_type_check');
  });

  it('a founder-initiated row still records the founder, unchanged', async () => {
    const { data, error } = await db().from('ai_requests')
      .insert({ ...base, actor_type: 'founder', founder_id: FOUNDER })
      .select('actor_type, founder_id').single();
    expect(error).toBeNull();
    expect(data!.founder_id).toBe(FOUNDER);
  });

  it('SCOPE: a system call for workspace A does not appear under workspace B', async () => {
    await db().from('ai_requests').insert({
      ...base, actor_type: 'system', founder_id: null, workspace_id: WSA, prompt_id: `scope_${RUN}`,
    });
    const inA = await db().from('ai_requests').select('id').eq('workspace_id', WSA).eq('prompt_id', `scope_${RUN}`);
    const inB = await db().from('ai_requests').select('id').eq('workspace_id', WSB).eq('prompt_id', `scope_${RUN}`);
    expect((inA.data ?? []).length).toBeGreaterThan(0);
    expect((inB.data ?? []).length, 'a workspace-A call leaked into workspace B').toBe(0);
  });

  it('SCOPE: a global call is NULL, not attached to an arbitrary workspace', async () => {
    const { data } = await db().from('ai_requests').insert({
      ...base, actor_type: 'system', founder_id: null, workspace_id: null, prompt_id: `global_${RUN}`,
    }).select('workspace_id').single();
    // NULL records "not workspace-scoped". Guessing a workspace would make an
    // unscoped call look like it belonged to whichever one was nearby.
    expect(data!.workspace_id).toBeNull();
  });

  it('AUTHORITY: writing a system audit row creates no evidence, memory or approval', async () => {
    const c = db();
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const t of ['marketing_memories', 'marketing_memory_versions', 'evidence',
                       'growth_brain_recommendations', 'asset_approvals', 'publishing_targets']) {
        const { count } = await c.from(t).select('*', { count: 'exact', head: true });
        out[t] = count ?? -1;
      }
      return out;
    };
    const before = await counts();
    await c.from('ai_requests').insert({
      ...base, actor_type: 'system', founder_id: null, workspace_id: WSA, prompt_id: `auth_${RUN}`,
    });
    expect(await counts()).toEqual(before);
  });

  it('AUTHORITY: nothing under src/services reads the AI audit trail', async () => {
    // The constraint stops a bad row. This stops the next reader deciding that
    // "the system initiated it" is a kind of permission.
    //
    // MEASURED GAP: the first version filtered filenames by
    // /authority|evidence|approval|.../ and therefore did not cover
    // beliefPolicy.ts — mutation M3 planted an ai_requests read there and
    // SURVIVED. Scanning every service with a named allow-list is both wider
    // and self-maintaining: a new authority module is covered on the day it is
    // written, without anyone remembering to extend a regex.
    const root = join(__dirname, '../src/services');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length, 'the walk found nothing — it is broken').toBeGreaterThan(40);

    // Only the audit WRITER and the audit-reading route may name the table.
    // Neither lives under src/services, so the allow-list here is empty by
    // design; it exists so a future exception has to be written down.
    const ALLOWED: string[] = [];
    for (const f of files) {
      if (ALLOWED.some(a => f.endsWith(a))) continue;
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} reads the ai_requests table`).not.toContain('ai_requests');
      expect(src, `${f} imports the AI actor helper`).not.toContain('resolveAiActor');
      expect(src, `${f} reads AI audit counters`).not.toContain('aiAuditCounters');
    }
  });
});
