/**
 * @file billing.route.ts
 * @description Fastify routes for Stripe + Razorpay billing.
 *   Checkout creation, webhook processing, subscription management.
 * @security
 *   - Webhook routes have NO JWT auth — verified by payment provider signature instead.
 *   - Stripe webhook: raw body required for signature verification (addContentTypeParser).
 *   - Razorpay webhook: x-razorpay-signature header verified before any processing.
 *   - Wrong signature on either webhook → 401 immediately.
 *   - Checkout + subscription routes: JWT required.
 *   - Plan check middleware enforced on all product creation (registered in server.ts).
 * @dependencies billingService, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import {
  createStripeCheckout,
  createRazorpayCheckout,
  handleStripeWebhook,
  handleRazorpayWebhook,
  cancelSubscription,
  getSubscriptionStatus,
  createTokenTopupCheckout,
} from '../services/billingService';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

const CheckoutBodySchema = z.object({
  plan: z.enum(['solo', 'builder', 'studio']),
  currency: z.enum(['usd', 'inr']),
});

const TopupBodySchema = z.object({
  packSize: z.union([z.literal(500), z.literal(1500), z.literal(5000)]),
  currency: z.enum(['usd', 'inr']),
});

function getFounderId(request: FastifyRequest): string {
  const payload = request.user as { sub?: string };
  if (!payload?.sub) throw new Error('Invalid JWT: missing sub claim');
  return payload.sub;
}

/**
 * Registers all /billing routes on the Fastify instance.
 * @param server - Fastify instance with JWT and raw body parser registered
 */
export async function billingRoutes(server: FastifyInstance): Promise<void> {
  // ── Webhook: Stripe (raw body required for signature verification) ─────────
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 1_048_576 },
    function (req, body, done) {
      try {
        // Store raw buffer on request for Stripe webhook, parse normally for others
        (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
        const parsed = JSON.parse((body as Buffer).toString());
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  /**
   * POST /billing/webhooks/stripe
   * No JWT auth — Stripe signature verified instead.
   * Raw body required for stripe.webhooks.constructEvent().
   */
  server.post(
    '/billing/webhooks/stripe',
    async (request, reply) => {
      const sig = request.headers['stripe-signature'] as string | undefined;
      if (!sig) return reply.status(400).send({ error: 'Missing stripe-signature header' });

      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      if (!rawBody) return reply.status(400).send({ error: 'Missing raw body' });

      try {
        await handleStripeWebhook(rawBody, sig);
        return reply.send({ received: true });
      } catch (err) {
        if (err instanceof Error && err.message === 'INVALID_SIGNATURE') {
          return reply.status(401).send({ error: 'Invalid Stripe signature' });
        }
        Sentry.captureException(err, { tags: { route: 'POST /billing/webhooks/stripe' } });
        return reply.status(500).send({ error: 'Webhook processing failed' });
      }
    }
  );

  /**
   * POST /billing/webhooks/razorpay
   * No JWT auth — x-razorpay-signature verified instead.
   */
  server.post(
    '/billing/webhooks/razorpay',
    async (request, reply) => {
      const sig = request.headers['x-razorpay-signature'] as string | undefined;
      if (!sig) return reply.status(400).send({ error: 'Missing x-razorpay-signature header' });

      try {
        await handleRazorpayWebhook(request.body as Record<string, unknown>, sig);
        return reply.send({ received: true });
      } catch (err) {
        if (err instanceof Error && err.message === 'INVALID_SIGNATURE') {
          return reply.status(401).send({ error: 'Invalid Razorpay signature' });
        }
        Sentry.captureException(err, { tags: { route: 'POST /billing/webhooks/razorpay' } });
        return reply.status(500).send({ error: 'Webhook processing failed' });
      }
    }
  );

  // ── Authenticated routes ──────────────────────────────────────────────────

  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const isWebhook =
      request.url === '/billing/webhooks/stripe' ||
      request.url === '/billing/webhooks/razorpay';
    if (isWebhook) return;

    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * POST /billing/checkout
   * Creates a Stripe or Razorpay checkout session.
   * Body: { plan: 'solo'|'builder'|'studio', currency: 'usd'|'inr' }
   */
  server.post(
    '/billing/checkout',
    async (request, reply) => {
      const founderId = getFounderId(request);

      const parsed = CheckoutBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
      }

      const { plan, currency } = parsed.data;

      try {
        const { data: founder } = await getSupabaseAdmin()
          .from('founders')
          .select('email')
          .eq('id', founderId)
          .single();

        if (!founder) return reply.status(404).send({ error: 'Founder not found' });

        if (currency === 'usd') {
          const result = await createStripeCheckout(founderId, plan, founder.email);
          return reply.send(result);
        } else {
          const result = await createRazorpayCheckout(founderId, plan);
          return reply.send(result);
        }
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /billing/checkout' } });
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Checkout creation failed' });
      }
    }
  );

  /**
   * GET /billing/subscription
   * Returns current plan, token balance, and renewal note for the authenticated founder.
   */
  server.get(
    '/billing/subscription',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        const status = await getSubscriptionStatus(founderId);
        return reply.send(status);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /billing/subscription' } });
        return reply.status(500).send({ error: 'Failed to fetch subscription' });
      }
    }
  );

  /**
   * POST /billing/cancel
   * Schedules a downgrade to free at end of billing period.
   * Access is NOT revoked immediately.
   */
  server.post(
    '/billing/cancel',
    async (request, reply) => {
      const founderId = getFounderId(request);
      try {
        await cancelSubscription(founderId);
        return reply.send({ message: 'Cancellation scheduled. Access continues until end of billing period.' });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /billing/cancel' } });
        return reply.status(500).send({ error: 'Cancellation failed' });
      }
    }
  );

  /**
   * POST /billing/topup
   * Creates a one-time Stripe or Razorpay checkout for a token top-up pack.
   * Body: { packSize: 500|1500|5000, currency: 'usd'|'inr' }
   * Returns: { url } for Stripe, or { orderId, amount, keyId } for Razorpay.
   */
  server.post(
    '/billing/topup',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const parsed = TopupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }
      const { packSize, currency } = parsed.data;
      try {
        const result = await createTokenTopupCheckout(founderId, packSize, currency);
        return reply.send(result);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /billing/topup' } });
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Topup creation failed' });
      }
    }
  );

  /**
   * GET /founders/me/token-usage
   * Returns tokens_consumed audit_log entries for past 30 days, grouped by action type.
   * Sorted by total cost descending.
   */
  server.get(
    '/founders/me/token-usage',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const { data, error } = await getSupabaseAdmin()
          .from('audit_logs')
          .select('action, metadata, created_at')
          .eq('founder_id', founderId)
          .eq('action', 'tokens_consumed')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(200);

        if (error) throw error;

        const grouped: Record<string, { count: number; totalCost: number; lastUsed: string }> = {};
        for (const entry of data ?? []) {
          const meta = entry.metadata as { action?: string; cost?: number } | null;
          const key = meta?.action ?? 'unknown';
          if (!grouped[key]) grouped[key] = { count: 0, totalCost: 0, lastUsed: entry.created_at };
          grouped[key].count += 1;
          grouped[key].totalCost += meta?.cost ?? 0;
          if (entry.created_at > grouped[key].lastUsed) grouped[key].lastUsed = entry.created_at;
        }

        const breakdown = Object.entries(grouped)
          .map(([action, stats]) => ({ action, ...stats }))
          .sort((a, b) => b.totalCost - a.totalCost);

        return reply.send({
          since,
          breakdown,
          totalConsumed: breakdown.reduce((s, r) => s + r.totalCost, 0),
        });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /founders/me/token-usage' } });
        return reply.status(500).send({ error: 'Failed to fetch token usage' });
      }
    }
  );
}
