/**
 * @file aiAuditObservability.test.ts
 * @description P1-43 — the audit write is honest about its own failures.
 *
 *   The defect was invisible for months because the only signal was a
 *   console.error nobody counted, and the writer read only `data` — so a
 *   rejected insert was indistinguishable from a successful one with no id.
 *   These tests pin the two properties that would have surfaced it: the payload
 *   actually sent, and a counter that moves when a write fails.
 *
 * @security No network, no database. The Supabase client is a spy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertSpy = vi.fn();
let insertError: { code: string; message: string } | null = null;

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        insertSpy(payload);
        return { select: () => ({ single: async () => ({
          data: insertError ? null : { id: 'aud-1' }, error: insertError,
        }) }) };
      },
    }),
  }),
}));

vi.mock('../src/lib/aiClient', () => ({
  callSonnet: vi.fn(async () => 'text'),
  callHaiku: vi.fn(async () => 'text'),
  callSonnetWithUsage: vi.fn(async () => ({ text: 'sonnet', inputTokens: 120, outputTokens: 40 })),
  callHaikuWithUsage: vi.fn(async () => ({ text: 'haiku', inputTokens: 30, outputTokens: 12 })),
  callMessages: vi.fn(async () => ({ text: 'multimodal', inputTokens: 5, outputTokens: 5 })),
}));

const FOUNDER = '11111111-2222-4333-8444-555555555555';

describe('system AI audit — payload', () => {
  beforeEach(() => { insertSpy.mockClear(); insertError = null; });

  it('a system call writes actor_type=system with NO founder identity', async () => {
    const { callHaiku } = await import('../src/lib/aiPlatform');
    await callHaiku('hello', 32, { founderId: 'system', promptId: 'p', action: 'a' });
    await new Promise(r => setTimeout(r, 20));
    const payload = insertSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.actor_type).toBe('system');
    expect(payload.founder_id).toBeNull();
  });

  it('a founder call is unchanged', async () => {
    const { callHaiku } = await import('../src/lib/aiPlatform');
    await callHaiku('hello', 32, { founderId: FOUNDER, promptId: 'p', action: 'a' });
    await new Promise(r => setTimeout(r, 20));
    const payload = insertSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.actor_type).toBe('founder');
    expect(payload.founder_id).toBe(FOUNDER);
  });

  it('token usage, cost and latency are recorded from the provider result', async () => {
    const { callHaiku } = await import('../src/lib/aiPlatform');
    await callHaiku('hello', 32, { founderId: 'system', promptId: 'p', action: 'a' });
    await new Promise(r => setTimeout(r, 20));
    const p = insertSpy.mock.calls.at(-1)![0] as Record<string, number>;
    expect(p.input_tokens).toBe(30);
    expect(p.output_tokens).toBe(12);
    expect(p.total_tokens).toBe(42);
    // Cost comes from COST_TABLE, never invented per call.
    expect(p.cost_usd).toBeGreaterThan(0);
    expect(p.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('a global system call records NULL workspace rather than guessing one', async () => {
    const { callHaiku } = await import('../src/lib/aiPlatform');
    await callHaiku('hello', 32, { founderId: 'system', promptId: 'p', action: 'a' });
    await new Promise(r => setTimeout(r, 20));
    expect((insertSpy.mock.calls.at(-1)![0] as Record<string, unknown>).workspace_id).toBeNull();
  });

  it('a workspace-scoped system call records that workspace', async () => {
    const { callHaiku } = await import('../src/lib/aiPlatform');
    await callHaiku('hello', 32, {
      founderId: 'system', promptId: 'p', action: 'a', workspaceId: 'ws-1',
    });
    await new Promise(r => setTimeout(r, 20));
    expect((insertSpy.mock.calls.at(-1)![0] as Record<string, unknown>).workspace_id).toBe('ws-1');
  });
});

describe('audit failure — non-fatal, never silent, never fabricated', () => {
  beforeEach(() => { insertSpy.mockClear(); insertError = null; });

  it('a rejected insert increments the failure counter and logs structurally', async () => {
    const { callHaiku, aiAuditCounters } = await import('../src/lib/aiPlatform');
    const before = { ...aiAuditCounters };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertError = { code: '22P02', message: 'invalid input syntax for type uuid: "system"' };

    const text = await callHaiku('hello', 32, { founderId: 'system', promptId: 'p', action: 'a' });
    await new Promise(r => setTimeout(r, 20));

    // Non-fatal: the owner still gets their generation.
    expect(text).toBe('haiku');
    // Observable: this is what would have surfaced P1-43.
    expect(aiAuditCounters.failed).toBe(before.failed + 1);
    expect(aiAuditCounters.written).toBe(before.written);
    expect(aiAuditCounters.lastError).toContain('22P02');
    // Structured, so it can be alerted on rather than read by a human.
    const logged = err.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('ai_audit_write_failed');
    err.mockRestore();
  });

  it('a successful insert increments written, not failed', async () => {
    const { callHaiku, aiAuditCounters } = await import('../src/lib/aiPlatform');
    const before = { ...aiAuditCounters };
    await callHaiku('hello', 32, { founderId: 'system', promptId: 'p', action: 'a' });
    await new Promise(r => setTimeout(r, 20));
    expect(aiAuditCounters.written).toBe(before.written + 1);
    expect(aiAuditCounters.failed).toBe(before.failed);
  });
});
