/**
 * @file reports.test.ts
 * @description M11 Reports route tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../src/server';

const FOUNDER_A = 'f1111111-0000-0000-0000-000000000001';
const PRODUCT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const REPORT_ID = 'r0000000-0000-0000-0000-000000000001';

function makeJwt(sub: string = FOUNDER_A) {
  const payload = Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64');
  return `Bearer eyJhbGciOiJFUzI1NiJ9.${payload}.MOCK_SIG`;
}

const mockReport = {
  id:                REPORT_ID,
  founder_id:        FOUNDER_A,
  product_id:        PRODUCT_A,
  report_type:       'weekly',
  period_start:      '2026-07-01',
  period_end:        '2026-07-07',
  title:             'Weekly Report — 2026-07-01',
  summary:           'Strong week for installs.',
  content: {
    headline:    'India installs grew 34%',
    summary:     'Your weekly numbers tell a clear story.',
    whatWorked:  ['WhatsApp India hit CPI of $0.80'],
    whatToFix:   ['Meta USA CTR dropped below 1%'],
    keyInsights: ['WhatsApp 2× ROAS vs Meta'],
    nextActions: ['Increase WhatsApp India budget'],
  },
  metrics_snapshot:  null,
  ai_tokens_consumed: 20,
  export_count:      0,
  status:            'ready',
  created_at:        '2026-07-08T00:00:00Z',
  updated_at:        '2026-07-08T00:00:00Z',
};

vi.mock('../src/services/reportingService', () => ({
  generateReport: vi.fn().mockResolvedValue({
    reportId: 'r0000000-0000-0000-0000-000000000001',
    created: true,
    content: {
      headline:    'India installs grew 34%',
      summary:     'Your weekly numbers tell a clear story.',
      whatWorked:  ['WhatsApp India hit CPI of $0.80'],
      whatToFix:   ['Meta USA CTR dropped below 1%'],
      keyInsights: ['WhatsApp 2× ROAS vs Meta'],
      nextActions: ['Increase WhatsApp India budget'],
    },
    tokensConsumed: 20,
  }),
}));

vi.mock('../src/lib/supabaseAdmin', () => {
  const MOCK_FOUNDER = 'f1111111-0000-0000-0000-000000000001';
  const MOCK_PRODUCT = 'aaaaaaaa-0000-0000-0000-000000000001';
  const MOCK_REPORT  = 'r0000000-0000-0000-0000-000000000001';

  const reportRow = {
    id:                MOCK_REPORT,
    founder_id:        MOCK_FOUNDER,
    product_id:        MOCK_PRODUCT,
    report_type:       'weekly',
    period_start:      '2026-07-01',
    period_end:        '2026-07-07',
    title:             'Weekly Report — 2026-07-01',
    summary:           'Strong week for installs.',
    content: {
      headline:    'India installs grew 34%',
      summary:     'Your weekly numbers tell a clear story.',
      whatWorked:  ['WhatsApp India hit CPI of $0.80'],
      whatToFix:   ['Meta USA CTR dropped below 1%'],
      keyInsights: ['WhatsApp 2× ROAS vs Meta'],
      nextActions: ['Increase WhatsApp India budget'],
    },
    metrics_snapshot:   null,
    ai_tokens_consumed: 20,
    export_count:       0,
    status:             'ready',
    created_at:         '2026-07-08T00:00:00Z',
    updated_at:         '2026-07-08T00:00:00Z',
  };

  function chain(data: unknown) {
    const c: Record<string, unknown> = { data, error: null };
    const methods = ['eq','neq','is','in','not','order','limit','range','gte','lte','select'];
    methods.forEach(m => { c[m] = vi.fn(() => c); });
    (c as { then: unknown }).then = undefined;
    return c;
  }

  return {
    getSupabaseAdmin: vi.fn(() => ({
      auth: {
        getUser: vi.fn().mockImplementation(async (token: string) => {
          try {
            const parts   = (token ?? '').split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { sub: string };
            return { data: { user: { id: payload.sub } }, error: null };
          } catch {
            return { data: { user: { id: MOCK_FOUNDER } }, error: null };
          }
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'reports') {
          const c = chain([reportRow]);
          (c.single as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({ data: reportRow, error: null });
          c.update = vi.fn(() => {
            const u: Record<string, unknown> = { data: reportRow, error: null };
            ['eq','select','single'].forEach(m => { u[m] = vi.fn(() => u); });
            return u;
          });
          return c;
        }
        if (table === 'audit_logs') {
          const c = chain([]);
          (c as { insert: unknown }).insert = vi.fn().mockResolvedValue({ error: null });
          return c;
        }
        return chain([]);
      }),
    })),
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Reports routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    server = await buildServer();
  });

  // ── List ─────────────────────────────────────────────────────────────────────

  it('GET /reports returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/reports' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /reports returns 200 with reports array', async () => {
    const res = await server.inject({
      method: 'GET', url: '/reports',
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { reports: unknown[] } };
    expect(Array.isArray(body.data.reports)).toBe(true);
  });

  it('GET /reports accepts productId filter', async () => {
    const res = await server.inject({
      method: 'GET', url: `/reports?productId=${PRODUCT_A}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Generate ─────────────────────────────────────────────────────────────────

  it('POST /reports/generate returns 401 without token', async () => {
    const res = await server.inject({
      method: 'POST', url: '/reports/generate',
      payload: { productId: PRODUCT_A, reportType: 'weekly', periodStart: '2026-07-01', periodEnd: '2026-07-07' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /reports/generate returns 400 for invalid body', async () => {
    const res = await server.inject({
      method: 'POST', url: '/reports/generate',
      headers: { authorization: makeJwt(FOUNDER_A) },
      payload: { reportType: 'weekly' }, // missing productId
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /reports/generate returns 201 for valid body', async () => {
    const res = await server.inject({
      method: 'POST', url: '/reports/generate',
      headers: { authorization: makeJwt(FOUNDER_A) },
      payload: {
        productId:   PRODUCT_A,
        reportType:  'weekly',
        periodStart: '2026-07-01',
        periodEnd:   '2026-07-07',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { reportId: string; created: boolean } };
    expect(body.data.reportId).toBe(REPORT_ID);
    expect(body.data.created).toBe(true);
  });

  // ── Get ───────────────────────────────────────────────────────────────────────

  it('GET /reports/:id returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/reports/${REPORT_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /reports/:id returns 200 for own report', async () => {
    const res = await server.inject({
      method: 'GET', url: `/reports/${REPORT_ID}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string; report_type: string } };
    expect(body.data.id).toBe(REPORT_ID);
    expect(body.data.report_type).toBe('weekly');
  });

  // ── Export ────────────────────────────────────────────────────────────────────

  it('GET /reports/:id/export returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/reports/${REPORT_ID}/export` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /reports/:id/export returns 200 with exportedAt field', async () => {
    const res = await server.inject({
      method: 'GET', url: `/reports/${REPORT_ID}/export`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { exportedAt: string; reportId: string; period: { start: string } } };
    expect(body.data.exportedAt).toBeDefined();
    expect(body.data.reportId).toBe(REPORT_ID);
    expect(body.data.period.start).toBe('2026-07-01');
  });

  // ── Feedback ──────────────────────────────────────────────────────────────────

  it('POST /reports/:id/feedback returns 401 without token', async () => {
    const res = await server.inject({
      method: 'POST', url: `/reports/${REPORT_ID}/feedback`,
      payload: { rating: 5 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /reports/:id/feedback returns 400 without rating', async () => {
    const res = await server.inject({
      method: 'POST', url: `/reports/${REPORT_ID}/feedback`,
      headers: { authorization: makeJwt(FOUNDER_A) },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /reports/:id/feedback returns 201 with recorded:true', async () => {
    const res = await server.inject({
      method: 'POST', url: `/reports/${REPORT_ID}/feedback`,
      headers: { authorization: makeJwt(FOUNDER_A) },
      payload: { rating: 4, comment: 'Very helpful' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });
});
