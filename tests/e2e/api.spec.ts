/**
 * @file api.spec.ts
 * @description API-only smoke tests — use Playwright's request fixture (no browser).
 *   Can run whenever the Fastify API is up, regardless of Next.js or Supabase state.
 *   Run: npx playwright test tests/e2e/api.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

// ── Health ────────────────────────────────────────────────────────────────────

test('GET /health returns 200 with status:ok + timestamp', async ({ request }) => {
  const res = await request.get(`${API_URL}/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok' });
  expect(body).toHaveProperty('timestamp');
});

// ── Auth gates (no token → 401) ───────────────────────────────────────────────

test('GET /billing/subscription without token → 401', async ({ request }) => {
  const res = await request.get(`${API_URL}/billing/subscription`);
  expect(res.status()).toBe(401);
});

test('POST /billing/checkout without token → 401', async ({ request }) => {
  const res = await request.post(`${API_URL}/billing/checkout`, {
    data: { plan: 'solo', currency: 'usd' },
  });
  expect(res.status()).toBe(401);
});

test('POST /billing/cancel without token → 401', async ({ request }) => {
  const res = await request.post(`${API_URL}/billing/cancel`);
  expect(res.status()).toBe(401);
});

// ── Webhook signature gates ───────────────────────────────────────────────────

test('POST /billing/webhooks/stripe — missing stripe-signature → 400', async ({ request }) => {
  const res = await request.post(`${API_URL}/billing/webhooks/stripe`, {
    data: { type: 'checkout.session.completed', data: { object: {} } },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/missing stripe-signature/i);
});

test('POST /billing/webhooks/stripe — wrong signature → 401 with descriptive error', async ({ request }) => {
  const res = await request.post(`${API_URL}/billing/webhooks/stripe`, {
    data: { type: 'checkout.session.completed', data: { object: {} } },
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1234,v1=wrong_signature_value',
    },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toMatch(/invalid stripe/i);
});

test('POST /billing/webhooks/razorpay — missing x-razorpay-signature → 400', async ({ request }) => {
  const res = await request.post(`${API_URL}/billing/webhooks/razorpay`, {
    data: { event: 'payment.captured', payload: {} },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/missing x-razorpay/i);
});

test('POST /billing/webhooks/razorpay — wrong HMAC → 401 with descriptive error', async ({ request }) => {
  const res = await request.post(`${API_URL}/billing/webhooks/razorpay`, {
    data: { event: 'payment.captured', payload: {} },
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': 'deadbeef00000000000000000000000000000000000000000000000000000000',
    },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toMatch(/invalid razorpay/i);
});

// ── Plan gates (no token) ─────────────────────────────────────────────────────

test('POST /products/:id/strategy without token → 401', async ({ request }) => {
  const res = await request.post(
    `${API_URL}/products/00000000-0000-0000-0000-000000000001/strategy`
  );
  expect(res.status()).toBe(401);
});

test('POST /products/:id/strategy/assets without token → 401', async ({ request }) => {
  const res = await request.post(
    `${API_URL}/products/00000000-0000-0000-0000-000000000001/strategy/assets`,
    { data: { channel: 'whatsapp', market: 'india' } }
  );
  expect(res.status()).toBe(401);
});

// ── Channels auth gates (no token → 401) ─────────────────────────────────────

test('GET /channels without token → 401', async ({ request }) => {
  const res = await request.get(`${API_URL}/channels`);
  expect(res.status()).toBe(401);
});

test('GET /channels/whatsapp/oauth/init without token → 401', async ({ request }) => {
  const res = await request.get(`${API_URL}/channels/whatsapp/oauth/init`);
  expect(res.status()).toBe(401);
});

test('POST /channels/whatsapp/send without token → 401', async ({ request }) => {
  const res = await request.post(`${API_URL}/channels/whatsapp/send`, {
    data: {
      campaignId: '00000000-0000-0000-0000-000000000001',
      phoneNumberId: '111',
      recipientPhone: '+1234567890',
      templateName: 'hello',
      languageCode: 'en_US',
    },
  });
  expect(res.status()).toBe(401);
});

test('DELETE /channels/whatsapp without token → 401', async ({ request }) => {
  const res = await request.delete(`${API_URL}/channels/whatsapp`);
  expect(res.status()).toBe(401);
});

// ── Channels webhook signature gates ─────────────────────────────────────────

test('POST /channels/whatsapp/webhook — missing x-hub-signature-256 → 401', async ({ request }) => {
  const res = await request.post(`${API_URL}/channels/whatsapp/webhook`, {
    data: { entry: [] },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('POST /channels/whatsapp/webhook — wrong signature → 401', async ({ request }) => {
  const res = await request.post(`${API_URL}/channels/whatsapp/webhook`, {
    data: { entry: [] },
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': 'sha256=wrongsignaturevalue00000000000000000000000000000000000000000000',
    },
  });
  expect(res.status()).toBe(401);
});

test('GET /channels/whatsapp/webhook — wrong verify_token → 403', async ({ request }) => {
  const res = await request.get(
    `${API_URL}/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=abc`
  );
  expect(res.status()).toBe(403);
});

test('DELETE /channels/invalidplatform without token → 401', async ({ request }) => {
  const res = await request.delete(`${API_URL}/channels/invalidplatform`);
  expect(res.status()).toBe(401);
});
