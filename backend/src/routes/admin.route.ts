/**
 * @file admin.route.ts
 * @description Admin-only routes for internal operations.
 *   POST /admin/trigger-brief — manually triggers the weekly brief pipeline for a product.
 *   POST /admin/schedule-brief — (re)registers the weekly BullMQ repeatable job.
 * @security
 *   - All admin routes require an X-Admin-Secret header matching ADMIN_SECRET env var.
 *   - No JWT needed — these routes are called by internal cron orchestrators or ops.
 *   - ADMIN_SECRET must be a high-entropy random string (min 32 chars).
 *   - If ADMIN_SECRET is not set, all admin routes return 503.
 *   - These routes should be behind Cloudflare WAF IP allowlist in production.
 * @dependencies scheduler, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { triggerBriefNow, scheduleWeeklyBrief } from '../lib/scheduler';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { PLAN_PRICES } from '../services/billingService';

const TriggerBriefBodySchema = z.object({
  productId: z.string().uuid(),
  founderId: z.string().uuid(),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Verifies the X-Admin-Secret header against the ADMIN_SECRET env var.
 * Returns false and sends 401 if the header is missing or invalid.
 * Returns false and sends 503 if ADMIN_SECRET is not configured.
 * @security Timing-safe comparison via Buffer.compare to prevent timing attacks.
 */
function verifyAdminSecret(request: FastifyRequest, reply: FastifyReply): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 32) {
    reply.status(503).send({ error: 'Admin secret not configured' });
    return false;
  }

  const provided = request.headers['x-admin-secret'] as string | undefined;
  if (!provided) {
    reply.status(401).send({ error: 'Missing X-Admin-Secret header' });
    return false;
  }

  try {
    const expected = Buffer.from(secret, 'utf-8');
    const actual = Buffer.from(provided, 'utf-8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      reply.status(401).send({ error: 'Invalid admin secret' });
      return false;
    }
  } catch {
    reply.status(401).send({ error: 'Invalid admin secret' });
    return false;
  }

  return true;
}

/**
 * Registers all /admin routes on the Fastify instance.
 * @param server - Fastify instance
 */
export async function adminRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /admin/trigger-brief
   * Enqueues an immediate one-off brief generation for a specific product.
   * Body: { productId: uuid, founderId: uuid, weekOf?: 'YYYY-MM-DD' }
   * Returns: { jobId: string, queued: true }
   */
  server.post(
    '/admin/trigger-brief',
    async (request, reply) => {
      if (!verifyAdminSecret(request, reply)) return;

      const parsed = TriggerBriefBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
      }

      const { productId, founderId, weekOf } = parsed.data;

      try {
        const { jobId } = await triggerBriefNow(productId, founderId, weekOf);
        return reply.send({ jobId, queued: true, productId, weekOf: weekOf ?? 'current week' });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /admin/trigger-brief' } });
        return reply.status(500).send({ error: 'Failed to queue brief job' });
      }
    }
  );

  /**
   * POST /admin/schedule-brief
   * Re-registers the weekly repeatable BullMQ cron job.
   * Idempotent — safe to call multiple times (removes old job first).
   * Returns: { scheduled: true, cron: '0 17 * * 0 UTC' }
   */
  server.post(
    '/admin/schedule-brief',
    async (request, reply) => {
      if (!verifyAdminSecret(request, reply)) return;

      try {
        await scheduleWeeklyBrief();
        return reply.send({ scheduled: true, cron: '0 17 * * 0 UTC' });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /admin/schedule-brief' } });
        return reply.status(500).send({ error: 'Failed to schedule brief' });
      }
    }
  );

  /**
   * GET /admin/health
   * Internal health check — verifies admin secret but no payload.
   * Used by ops to confirm the admin secret is correctly configured.
   */
  server.get(
    '/admin/health',
    async (request, reply) => {
      if (!verifyAdminSecret(request, reply)) return;
      return reply.send({ ok: true });
    }
  );

  /**
   * GET /admin/stats
   * Returns waitlist count, active founder count, and onboarding funnel step counts.
   * @security X-Admin-Secret required.
   */
  server.get('/admin/stats', async (request, reply) => {
    if (!verifyAdminSecret(request, reply)) return;
    try {
      const db = getSupabaseAdmin();

      const [waitlistResult, foundersResult, onboardingResult] = await Promise.all([
        db.from('waitlist').select('*', { count: 'exact', head: true }),
        db.from('founders').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        db.from('founders')
          .select('onboarding_step')
          .is('deleted_at', null),
      ]);

      const stepCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const row of onboardingResult.data ?? []) {
        const step = row.onboarding_step as number;
        if (step in stepCounts) stepCounts[step]++;
      }

      return reply.send({
        waitlistCount: waitlistResult.count ?? 0,
        founderCount: foundersResult.count ?? 0,
        onboardingFunnel: {
          registered: stepCounts[0] + stepCounts[1] + stepCounts[2] + stepCounts[3] + stepCounts[4] + stepCounts[5],
          icpConfirmed: stepCounts[1] + stepCounts[2] + stepCounts[3] + stepCounts[4] + stepCounts[5],
          strategyGenerated: stepCounts[2] + stepCounts[3] + stepCounts[4] + stepCounts[5],
          channelConnected: stepCounts[3] + stepCounts[4] + stepCounts[5],
          briefReceived: stepCounts[4] + stepCounts[5],
          feedbackSubmitted: stepCounts[5],
        },
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /admin/stats' } });
      return reply.status(500).send({ error: 'Failed to fetch stats' });
    }
  });

  /**
   * GET /admin/feedback
   * Returns recent founder feedback with founder email and product name.
   * @security X-Admin-Secret required.
   */
  server.get('/admin/feedback', async (request, reply) => {
    if (!verifyAdminSecret(request, reply)) return;
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('founder_feedback')
        .select(`
          id, rating, body, context, created_at,
          founders ( email ),
          products ( name )
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      // Table may not exist yet on hosted Supabase — return empty list gracefully
      if (error) {
        server.log.warn({ err: error }, 'founder_feedback query failed — table may not exist yet');
        return reply.send({ feedback: [], total: 0 });
      }
      return reply.send({ feedback: data ?? [], total: data?.length ?? 0 });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /admin/feedback' } });
      return reply.status(500).send({ error: 'Failed to fetch feedback' });
    }
  });

  /**
   * GET /admin/mrr
   * Returns MRR aggregation derived from active founder plan distribution.
   * - totalMrrUSD: estimated total MRR in USD (USD subscribers + INR converted at ₹83/$)
   * - mrrByTier: MRR broken down by plan
   * - mrrByMarket: split between USD (Stripe) and INR (Razorpay) based on subscription_activated audit logs
   * - foundersByTier: count of paying founders per plan
   * @security X-Admin-Secret required.
   */
  server.get('/admin/mrr', async (request, reply) => {
    if (!verifyAdminSecret(request, reply)) return;
    try {
      const db = getSupabaseAdmin();

      // Count paying founders by plan
      const { data: founders } = await db
        .from('founders')
        .select('plan')
        .neq('plan', 'free')
        .is('deleted_at', null);

      const tierCounts: Record<string, number> = { solo: 0, builder: 0, studio: 0 };
      for (const f of founders ?? []) {
        if (f.plan in tierCounts) tierCounts[f.plan]++;
      }

      // Query audit_logs for source (stripe vs razorpay) distribution per plan
      const { data: activations } = await db
        .from('audit_logs')
        .select('metadata')
        .eq('action', 'subscription_activated');

      const sourceByPlan: Record<string, { stripe: number; razorpay: number }> = {
        solo: { stripe: 0, razorpay: 0 },
        builder: { stripe: 0, razorpay: 0 },
        studio: { stripe: 0, razorpay: 0 },
      };
      for (const log of activations ?? []) {
        const meta = log.metadata as { plan?: string; source?: string } | null;
        const plan = meta?.plan ?? '';
        const source = meta?.source ?? 'stripe';
        if (plan in sourceByPlan) {
          if (source === 'razorpay') sourceByPlan[plan].razorpay++;
          else sourceByPlan[plan].stripe++;
        }
      }

      const INR_TO_USD = 1 / 83; // approximate conversion rate
      const mrrByTier: Record<string, { usdMrr: number; inrMrr: number; founders: number }> = {};
      let totalMrrUSD = 0;
      let totalMrrStripeUSD = 0;
      let totalMrrRazorpayUSD = 0;

      for (const [plan, count] of Object.entries(tierCounts)) {
        if (count === 0) continue;
        const pricing = PLAN_PRICES[plan];
        if (!pricing) continue;

        const total = sourceByPlan[plan].stripe + sourceByPlan[plan].razorpay;
        const razorpayRatio = total > 0 ? sourceByPlan[plan].razorpay / total : 0;
        const stripeCount = Math.round(count * (1 - razorpayRatio));
        const razorpayCount = count - stripeCount;

        const usdFromStripe = stripeCount * (pricing.usd / 100);
        const usdFromRazorpay = razorpayCount * (pricing.inr / 100) * INR_TO_USD;
        const tierUSD = usdFromStripe + usdFromRazorpay;

        mrrByTier[plan] = {
          usdMrr: Math.round(tierUSD * 100) / 100,
          inrMrr: razorpayCount * (pricing.inr / 100),
          founders: count,
        };
        totalMrrUSD += tierUSD;
        totalMrrStripeUSD += usdFromStripe;
        totalMrrRazorpayUSD += usdFromRazorpay;
      }

      return reply.send({
        totalMrrUSD: Math.round(totalMrrUSD * 100) / 100,
        totalPayingFounders: Object.values(tierCounts).reduce((a, b) => a + b, 0),
        mrrByTier,
        mrrByMarket: {
          usd: Math.round(totalMrrStripeUSD * 100) / 100,
          inr: Math.round(totalMrrRazorpayUSD * 100) / 100,
        },
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /admin/mrr' } });
      return reply.status(500).send({ error: 'Failed to fetch MRR data' });
    }
  });
}
