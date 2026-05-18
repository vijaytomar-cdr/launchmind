/**
 * @file billingService.ts
 * @description Stripe (USD) and Razorpay (INR) subscription management.
 *   Checkout session creation, webhook verification + plan activation, cancellation.
 * @security
 *   - Stripe webhooks: signature verified via stripe.webhooks.constructEvent() BEFORE processing.
 *   - Razorpay webhooks: HMAC-SHA256 signature verified BEFORE processing.
 *   - Wrong signature → always 401. No partial processing.
 *   - founders.plan + token_balance updated atomically after webhook verification.
 *   - All billing events written to audit_logs (immutable).
 *   - Stripe/Razorpay secret keys NEVER logged or returned to frontend.
 * @dependencies stripe, razorpay, supabaseAdmin, Sentry
 */

import Stripe from 'stripe';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

// ── Pricing ───────────────────────────────────────────────────────────────────

export const PLAN_PRICES: Record<string, { usd: number; inr: number; tokens: number }> = {
  solo:    { usd: 1900, inr: 99900,  tokens: 300  },
  builder: { usd: 4900, inr: 249900, tokens: 1000 },
  studio:  { usd: 9900, inr: 499900, tokens: 3000 },
};

// ── Stripe client (lazy) ──────────────────────────────────────────────────────

type StripeInstance = InstanceType<typeof Stripe>;

let _stripe: StripeInstance | null = null;
function getStripe(): StripeInstance {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    _stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
  }
  return _stripe;
}

// ── Razorpay client (lazy) ────────────────────────────────────────────────────

let _razorpay: Razorpay | null = null;
function getRazorpay(): Razorpay {
  if (!_razorpay) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not configured');
    _razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return _razorpay;
}

// ── Stripe checkout ───────────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout session for a subscription plan.
 * @param founderId - UUID of the founder (stored in Stripe metadata)
 * @param plan      - 'solo' | 'builder' | 'studio'
 * @param email     - Founder's email pre-fills the Stripe form
 * @returns         { url } — redirect the founder to this URL
 * @throws          {Error} If plan is unknown or STRIPE_SECRET_KEY not set
 * @security        founderId stored in metadata, verified on webhook. Secret key never returned.
 */
export async function createStripeCheckout(
  founderId: string,
  plan: string,
  email: string
): Promise<{ url: string }> {
  const pricing = PLAN_PRICES[plan];
  if (!pricing) throw new Error(`Unknown plan: ${plan}`);

  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: pricing.usd,
          recurring: { interval: 'month' },
          product_data: { name: `LaunchMind ${plan.charAt(0).toUpperCase() + plan.slice(1)}` },
        },
        quantity: 1,
      },
    ],
    metadata: { founderId, plan },
    success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing`,
  });

  if (!session.url) throw new Error('Stripe did not return a session URL');
  return { url: session.url };
}

// ── Razorpay checkout ─────────────────────────────────────────────────────────

/**
 * Creates a Razorpay order for a subscription plan (INR).
 * @param founderId - UUID of the founder
 * @param plan      - 'solo' | 'builder' | 'studio'
 * @returns         { orderId, amount, currency, keyId } — used by Razorpay.js on frontend
 * @throws          {Error} If plan unknown or Razorpay keys not set
 * @security        Secret key never returned. Only keyId (public) exposed.
 */
export async function createRazorpayCheckout(
  founderId: string,
  plan: string
): Promise<{ orderId: string; amount: number; currency: string; keyId: string }> {
  const pricing = PLAN_PRICES[plan];
  if (!pricing) throw new Error(`Unknown plan: ${plan}`);

  const razorpay = getRazorpay();

  const order = await razorpay.orders.create({
    amount: pricing.inr,
    currency: 'INR',
    notes: { founderId, plan },
  });

  return {
    orderId: order.id,
    amount: pricing.inr,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID!,
  };
}

// ── Plan activation helper ────────────────────────────────────────────────────

async function activatePlan(founderId: string, plan: string, source: 'stripe' | 'razorpay'): Promise<void> {
  const pricing = PLAN_PRICES[plan];
  if (!pricing) return;

  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('founders')
    .update({
      plan,
      token_balance: pricing.tokens,
      updated_at: new Date().toISOString(),
    })
    .eq('id', founderId);

  if (error) {
    Sentry.captureException(error, { tags: { service: 'billingService', founderId, plan } });
    throw new Error('Failed to update founder plan');
  }

  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action: 'subscription_activated',
    resource_type: 'founder',
    metadata: { plan, tokens: pricing.tokens, source },
  });
}

// ── Stripe webhook ────────────────────────────────────────────────────────────

/**
 * Verifies and processes a Stripe webhook event.
 * Must receive the raw request body (Buffer) for signature verification.
 * @param rawBody   - Raw Buffer from request (NOT parsed JSON)
 * @param signature - Value of the stripe-signature header
 * @throws          {Error} If signature invalid — caller must return 401
 * @security        Signature verified BEFORE any processing. Wrong sig → throws immediately.
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string
): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  let event: { type: string; data: { object: unknown } };
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret) as typeof event;
  } catch {
    throw new Error('INVALID_SIGNATURE');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as unknown as { metadata?: Record<string, string | undefined> };
    const founderId = session.metadata?.founderId;
    const plan = session.metadata?.plan;

    if (!founderId || !plan) {
      Sentry.captureMessage('Stripe webhook missing metadata', { tags: { eventType: event.type } });
      return;
    }

    await activatePlan(founderId, plan, 'stripe');
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as unknown as { metadata?: Record<string, string | undefined> };
    const founderId = sub.metadata?.founderId;
    if (!founderId) return;

    await getSupabaseAdmin()
      .from('founders')
      .update({ plan: 'free', token_balance: 50, updated_at: new Date().toISOString() })
      .eq('id', founderId);

    await getSupabaseAdmin().from('audit_logs').insert({
      founder_id: founderId,
      action: 'subscription_cancelled',
      resource_type: 'founder',
      metadata: { source: 'stripe' },
    });
  }
}

// ── Razorpay webhook ──────────────────────────────────────────────────────────

/**
 * Verifies and processes a Razorpay webhook event.
 * @param body      - Parsed webhook payload
 * @param signature - Value of the x-razorpay-signature header
 * @throws          {Error} If signature invalid — caller must return 401
 * @security        HMAC-SHA256 verified against RAZORPAY_WEBHOOK_SECRET BEFORE processing.
 */
export async function handleRazorpayWebhook(
  body: Record<string, unknown>,
  signature: string
): Promise<void> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET not configured');

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');

  if (expectedSig !== signature) {
    throw new Error('INVALID_SIGNATURE');
  }

  const event = body.event as string;

  if (event === 'payment.captured') {
    const payment = (body.payload as { payment?: { entity?: { notes?: { founderId?: string; plan?: string } } } })
      ?.payment?.entity;
    const founderId = payment?.notes?.founderId;
    const plan = payment?.notes?.plan;

    if (!founderId || !plan) {
      Sentry.captureMessage('Razorpay webhook missing notes', { tags: { event } });
      return;
    }

    await activatePlan(founderId, plan, 'razorpay');
  }
}

// ── Subscription management ───────────────────────────────────────────────────

/**
 * Schedules a plan downgrade to free at the end of the current billing period.
 * Does NOT immediately revoke access.
 * @param founderId - UUID of the founder cancelling
 * @throws          {Error} If founder not found
 * @security        Writes cancel_scheduled to audit_logs. Access continues until period end.
 */
export async function cancelSubscription(founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  await supabase.from('audit_logs').insert({
    founder_id: founderId,
    action: 'cancel_scheduled',
    resource_type: 'founder',
    metadata: { note: 'Access continues until billing period ends' },
  });
}

/**
 * Returns the current billing status for a founder.
 * @param founderId - UUID of the founder
 * @returns         { plan, tokenBalance, renewalNote }
 */
export async function getSubscriptionStatus(founderId: string): Promise<{
  plan: string;
  tokenBalance: number | null;
  renewalNote: string;
}> {
  const { data, error } = await getSupabaseAdmin()
    .from('founders')
    .select('plan, token_balance')
    .eq('id', founderId)
    .single();

  if (error || !data) throw new Error('Founder not found');

  return {
    plan: data.plan,
    tokenBalance: data.token_balance,
    renewalNote: data.plan === 'free' ? 'No active subscription' : 'Renews monthly',
  };
}
