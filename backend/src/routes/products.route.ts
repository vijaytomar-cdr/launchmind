/**
 * @file products.route.ts
 * @description Fastify routes for product scraping, confirmation, retrieval, and strategy.
 *   Implements the Discover, Confirm, and Execute steps of the LaunchMind core loop.
 * @security
 *   - All routes require a valid JWT (Supabase auth). founderId extracted from token.
 *   - Scrape does NOT save to DB — confirmation requires explicit founder action.
 *   - Plan limits enforced server-side (free/solo=1, builder=3, studio=10).
 *   - Free tier: GET /products/:id/strategy omits fullStrategy from response body.
 *   - All writes go to audit_logs.
 *   - encrypted_token / service role key NEVER in any response.
 * @dependencies scraperWorker, reviewAnalysis, icpService, strategyService, supabaseAdmin, tokens, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { detectPlatform, scrapeAppStore, scrapePlayStore, scrapeCompetitors } from '../workers/scraperWorker';
import { analyseReviews } from '../services/reviewAnalysis';
import { buildICPBrief } from '../services/icpService';
import { generateStrategy, generateContentAssets, getProductStrategy } from '../services/strategyService';
import { AssetsRequestSchema } from '../types/strategy';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { consumeTokens } from '../lib/tokens';
import { getProductMetrics } from '../services/metricsService';
import { previewBrandVoice } from '../services/brandVoiceService';
import { InsufficientTokensError } from '../types/errors';
import {
  ScrapedAppDataSchema,
  ICPBriefSchema,
  CompetitorAppSchema,
  ConfirmProductBodySchema,
} from '../types/scraper';

const ScrapeBodySchema = z.object({
  url: z.string().url(),
});

const PLAN_PRODUCT_LIMITS: Record<string, number> = {
  free: 1,
  solo: 1,
  builder: 3,
  studio: 10,
};

// Numeric rank: higher = higher tier. Used for >= comparisons.
const PLAN_RANK: Record<string, number> = { free: 0, solo: 1, builder: 2, studio: 3 };

/**
 * Returns 403 and false if the founder's plan is below minPlan.
 * Returns true if the plan gate passes (caller may continue).
 * @security Fetches plan from DB every time — cannot be spoofed by JWT claims.
 */
async function requireMinPlan(
  founderId: string,
  minPlan: string,
  reply: FastifyReply
): Promise<boolean> {
  const { data: founder } = await getSupabaseAdmin()
    .from('founders')
    .select('plan')
    .eq('id', founderId)
    .single();

  const currentRank = PLAN_RANK[founder?.plan ?? 'free'] ?? 0;
  const requiredRank = PLAN_RANK[minPlan] ?? 0;

  if (currentRank < requiredRank) {
    reply.status(403).send({
      error: `This feature requires a ${minPlan} plan or higher. Upgrade to access.`,
      code: 'PLAN_FEATURE_RESTRICTED',
      currentPlan: founder?.plan ?? 'free',
      requiredPlan: minPlan,
    });
    return false;
  }
  return true;
}

const SCRAPE_TIMEOUT_MS = 60_000; // Play Store needs two Playwright passes; 60s covers both

/**
 * Extracts the verified founder UUID from the JWT attached to the request.
 * @param request - Authenticated Fastify request
 * @returns       Founder UUID string
 * @throws        {Error} If JWT payload does not contain a sub claim
 * @security      Uses @fastify/jwt verify — token signature checked by plugin.
 */
function getFounderId(request: FastifyRequest): string {
  const payload = request.user as { sub?: string };
  if (!payload?.sub) throw new Error('Invalid JWT: missing sub claim');
  return payload.sub;
}

/**
 * Registers all /products routes on the Fastify instance.
 * @param server - Fastify instance with JWT plugin registered
 */
export async function productsRoutes(server: FastifyInstance): Promise<void> {
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * POST /products/scrape
   * Scrapes a store URL and returns metadata + ICP brief. Does NOT save to DB.
   * Returns within 30 seconds or times out with 504.
   */
  server.post<{ Body: { url: string } }>(
    '/products/scrape',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string', format: 'uri' } },
        },
      },
    },
    async (request, reply) => {
      const founderId = getFounderId(request);

      const { url } = ScrapeBodySchema.parse(request.body);
      const platform = detectPlatform(url);

      if (!platform) {
        return reply.status(422).send({
          error: 'URL must be an App Store or Play Store URL',
        });
      }

      const scrapeWithTimeout = <T>(fn: () => Promise<T>): Promise<T> =>
        Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Scrape timeout')), SCRAPE_TIMEOUT_MS)
          ),
        ]);

      try {
        const scraped =
          platform === 'app_store'
            ? await scrapeWithTimeout(() => scrapeAppStore(url))
            : await scrapeWithTimeout(() => scrapePlayStore(url));

        const [reviewAnalysis, competitors] = await Promise.all([
          analyseReviews(scraped.reviews, founderId),
          scrapeCompetitors(scraped.category, platform).catch(() => []), // non-fatal
        ]);

        const icpBrief = buildICPBrief(scraped, reviewAnalysis);

        await getSupabaseAdmin().from('audit_logs').insert({
          founder_id: founderId,
          action: 'product_scraped',
          resource_type: 'product',
          metadata: { url, platform, name: scraped.name },
        });

        return reply.send({ scraped, icpBrief, competitors });
      } catch (err) {
        if (err instanceof Error && err.message === 'Scrape timeout') {
          return reply.status(504).send({ error: 'Scrape timed out — try again' });
        }
        Sentry.captureException(err, { tags: { route: 'POST /products/scrape' } });
        return reply.status(500).send({ error: 'Scrape failed' });
      }
    }
  );

  /**
   * POST /products/confirm
   * Validates and saves the ICP brief to the DB. Enforces plan product limits.
   * Returns 422 if the founder is at their plan limit.
   */
  server.post(
    '/products/confirm',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const supabase = getSupabaseAdmin();

      let body;
      try {
        body = ConfirmProductBodySchema.parse(request.body);
      } catch (err) {
        return reply.status(400).send({ error: 'Invalid request body', detail: String(err) });
      }

      const { data: founder, error: founderError } = await supabase
        .from('founders')
        .select('plan')
        .eq('id', founderId)
        .single();

      if (founderError || !founder) {
        return reply.status(404).send({ error: 'Founder not found' });
      }

      const { count: productCount } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('founder_id', founderId);

      const limit = PLAN_PRODUCT_LIMITS[founder.plan] ?? 1;
      if ((productCount ?? 0) >= limit) {
        return reply.status(422).send({
          error: `Your ${founder.plan} plan allows ${limit} product${limit === 1 ? '' : 's'}. Upgrade to add more.`,
          code: 'PLAN_LIMIT_REACHED',
        });
      }

      await consumeTokens(founderId, 'icp_structuring', 10);

      const { data: product, error: insertError } = await supabase
        .from('products')
        .insert({
          founder_id: founderId,
          name: body.scraped.name,
          store_url: body.url,
          platform: body.platform,
          category: body.scraped.category,
          markets: body.icpBrief.suggestedMarkets,
          price_tier: body.scraped.priceTier,
          confirmed_icp: body.icpBrief,
          competitor_set: body.competitors,
          scraped_meta: body.scraped,
          last_scraped_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError || !product) {
        Sentry.captureException(insertError, { tags: { route: 'POST /products/confirm' } });
        return reply.status(500).send({ error: 'Failed to save product' });
      }

      await getSupabaseAdmin().from('audit_logs').insert({
        founder_id: founderId,
        action: 'product_confirmed',
        resource_type: 'product',
        resource_id: product.id,
        metadata: { name: product.name, platform: product.platform },
      });

      // Advance onboarding step to 1 (icp_confirmed) if not already further along
      await getSupabaseAdmin()
        .from('founders')
        .update({ onboarding_step: 1, updated_at: new Date().toISOString() })
        .eq('id', founderId)
        .lt('onboarding_step', 1);

      return reply.status(201).send(product);
    }
  );

  /**
   * GET /products
   * Lists all products for the authenticated founder.
   * RLS on Supabase enforces founder_id scoping.
   */
  server.get('/products', async (request, reply) => {
    const founderId = getFounderId(request);

    const { data, error } = await getSupabaseAdmin()
      .from('products')
      .select('*')
      .eq('founder_id', founderId)
      .order('created_at', { ascending: false });

    if (error) {
      Sentry.captureException(error, { tags: { route: 'GET /products' } });
      return reply.status(500).send({ error: 'Failed to fetch products' });
    }

    return reply.send(data ?? []);
  });

  /**
   * GET /products/:id
   * Returns a single product. Returns 404 if the product belongs to a different founder.
   */
  server.get<{ Params: { id: string } }>(
    '/products/:id',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      const { data, error } = await getSupabaseAdmin()
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('founder_id', founderId)
        .single();

      if (error || !data) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      return reply.send(data);
    }
  );

  /**
   * POST /products/:id/strategy
   * Generates a 30/60/90-day strategy + saves campaign draft rows.
   * Requires solo plan or higher — free tier gets 403.
   * Calls Claude Sonnet (50 tokens). Returns full strategy JSON.
   * @security Plan verified server-side from DB. JWT plan claim not trusted.
   */
  server.post<{ Params: { id: string } }>(
    '/products/:id/strategy',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      if (!(await requireMinPlan(founderId, 'solo', reply))) return;

      try {
        const strategy = await generateStrategy(id, founderId);

        // Advance to step 2 (strategy_generated)
        await getSupabaseAdmin()
          .from('founders')
          .update({ onboarding_step: 2, updated_at: new Date().toISOString() })
          .eq('id', founderId)
          .lt('onboarding_step', 2);

        return reply.status(201).send(strategy);
      } catch (err) {
        if (err instanceof InsufficientTokensError || (err as Error).name === 'InsufficientTokensError') {
          const te = err as unknown as { balance?: number; required?: number };
          return reply.status(402).send({ error: 'Insufficient tokens', code: 'INSUFFICIENT_TOKENS', balance: te.balance ?? 0, required: te.required ?? 0 });
        }
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({ error: err.message });
        }
        Sentry.captureException(err, { tags: { route: 'POST /products/:id/strategy' } });
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Strategy generation failed' });
      }
    }
  );

  /**
   * POST /products/:id/strategy/assets
   * Generates content assets for a specific channel + market.
   * Requires builder plan or higher — free and solo get 403.
   * Calls Claude Sonnet (20 tokens). Body: { channel, market }.
   * @security Plan verified server-side from DB. JWT plan claim not trusted.
   */
  server.post<{ Params: { id: string }; Body: { channel: string; market: string } }>(
    '/products/:id/strategy/assets',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      if (!(await requireMinPlan(founderId, 'builder', reply))) return;

      const parsed = AssetsRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
      }

      try {
        const assets = await generateContentAssets(id, parsed.data.channel, parsed.data.market, founderId);
        return reply.status(201).send(assets);
      } catch (err) {
        if (err instanceof InsufficientTokensError || (err as Error).name === 'InsufficientTokensError') {
          const te = err as unknown as { balance?: number; required?: number };
          return reply.status(402).send({ error: 'Insufficient tokens', code: 'INSUFFICIENT_TOKENS', balance: te.balance ?? 0, required: te.required ?? 0 });
        }
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({ error: err.message });
        }
        Sentry.captureException(err, { tags: { route: 'POST /products/:id/strategy/assets' } });
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Asset generation failed' });
      }
    }
  );

  /**
   * GET /products/:id/metrics
   * Returns aggregated campaign metrics for a product: weekly summaries, channel breakdown, top performers.
   * Requires solo plan or higher — free tier gets 403.
   * @param weekCount - Optional query param, default 8, max 52.
   * @security founderId verified against product.founder_id. No cross-founder data returned.
   */
  server.get<{ Params: { id: string }; Querystring: { weekCount?: string } }>(
    '/products/:id/metrics',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      if (!(await requireMinPlan(founderId, 'solo', reply))) return;

      const weekCount = Math.min(parseInt(request.query.weekCount ?? '8', 10) || 8, 52);

      try {
        const metrics = await getProductMetrics(id, founderId, weekCount);
        return reply.send(metrics);
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({ error: err.message });
        }
        Sentry.captureException(err, { tags: { route: 'GET /products/:id/metrics' } });
        return reply.status(500).send({ error: 'Failed to fetch metrics' });
      }
    }
  );

  /**
   * GET /products/:id/strategy
   * Returns campaign drafts for a product.
   * Free tier: fullStrategy is absent from response body (not just hidden in UI).
   */
  server.get<{ Params: { id: string } }>(
    '/products/:id/strategy',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      try {
        const { campaigns, fullStrategy } = await getProductStrategy(id, founderId);

        const { data: founder } = await getSupabaseAdmin()
          .from('founders')
          .select('plan')
          .eq('id', founderId)
          .single();

        const isPremium = founder && ['solo', 'builder', 'studio'].includes(founder.plan);

        return reply.send({
          campaigns,
          ...(isPremium && fullStrategy ? { fullStrategy } : {}),
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({ error: err.message });
        }
        Sentry.captureException(err, { tags: { route: 'GET /products/:id/strategy' } });
        return reply.status(500).send({ error: 'Failed to fetch strategy' });
      }
    }
  );

  /**
   * GET /campaigns
   * Returns all campaigns for the authenticated founder, joined with product name.
   * Ordered by created_at DESC.
   */
  server.get('/campaigns', async (request, reply) => {
    const founderId = getFounderId(request);
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('campaigns')
        .select(`
          id, product_id, channel, market, status, hook_type, copy_text,
          spend_cap, external_campaign_id, ai_tokens_consumed,
          approved_at, launched_at, created_at, updated_at,
          products ( name )
        `)
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const campaigns = (data ?? []).map((c) => {
        const prod = c.products as unknown as { name: string } | { name: string }[] | null;
        const productName = Array.isArray(prod) ? (prod[0]?.name ?? null) : (prod?.name ?? null);
        const { products: _p, ...rest } = c;
        void _p;
        return { ...rest, productName };
      });

      return reply.send({ campaigns });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /campaigns' } });
      return reply.status(500).send({ error: 'Failed to fetch campaigns' });
    }
  });

  /**
   * GET /briefs
   * Returns all weekly briefs for the authenticated founder, joined with product name.
   * Ordered by week_of DESC.
   */
  server.get('/briefs', async (request, reply) => {
    const founderId = getFounderId(request);
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('weekly_briefs')
        .select(`
          id, product_id, week_of, what_worked, what_to_kill,
          next_actions, generated_assets, ai_tokens_consumed, status, sent_at, created_at,
          products ( name )
        `)
        .eq('founder_id', founderId)
        .order('week_of', { ascending: false });

      if (error) throw error;

      const briefs = (data ?? []).map((b) => {
        const prod = b.products as unknown as { name: string } | { name: string }[] | null;
        const productName = Array.isArray(prod) ? (prod[0]?.name ?? null) : (prod?.name ?? null);
        const { products: _p, ...rest } = b;
        void _p;
        return { ...rest, productName };
      });

      return reply.send({ briefs });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /briefs' } });
      return reply.status(500).send({ error: 'Failed to fetch briefs' });
    }
  });

  /**
   * PATCH /campaigns/:id/approve
   * Approves a campaign draft — sets approved_at and advances status to 'approved'.
   * Enforce-before-post gate: approved_at checked in channels.route before any send.
   * @security founderId verified against campaign.founder_id. Only draft/pending_approval can be approved.
   */
  server.patch<{ Params: { id: string } }>(
    '/campaigns/:id/approve',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid campaign ID' });
      }

      const { data: campaign, error: fetchError } = await getSupabaseAdmin()
        .from('campaigns')
        .select('id, founder_id, status')
        .eq('id', id)
        .eq('founder_id', founderId)
        .single();

      if (fetchError || !campaign) {
        return reply.status(404).send({ error: 'Campaign not found' });
      }

      if (!['draft', 'pending_approval'].includes(campaign.status)) {
        return reply.status(409).send({ error: `Campaign already ${campaign.status} — cannot approve again` });
      }

      const { data: updated, error: updateError } = await getSupabaseAdmin()
        .from('campaigns')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (updateError || !updated) {
        Sentry.captureException(updateError, { tags: { route: 'PATCH /campaigns/:id/approve' } });
        return reply.status(500).send({ error: 'Failed to approve campaign' });
      }

      await getSupabaseAdmin().from('audit_logs').insert({
        founder_id: founderId,
        action: 'campaign_approved',
        resource_type: 'campaign',
        resource_id: id,
        metadata: { status: 'approved' },
      });

      return reply.send(updated);
    }
  );

  /**
   * POST /feedback
   * Submits founder feedback with an optional 1-5 star rating and text body.
   * Advances onboarding_step to 5 if not already.
   */
  server.post<{
    Body: { rating: number; body?: string; context?: string; productId?: string };
  }>('/feedback', async (request, reply) => {
    const founderId = getFounderId(request);
    const FeedbackBodySchema = z.object({
      rating: z.number().int().min(1).max(5),
      body: z.string().max(2000).optional(),
      context: z.enum(['general', 'after_brief', 'after_strategy', 'after_campaign']).default('general'),
      productId: z.string().uuid().optional(),
    });

    const parsed = FeedbackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid feedback body' });
    }

    const { rating, body, context, productId } = parsed.data;

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('founder_feedback')
        .insert({
          founder_id: founderId,
          product_id: productId ?? null,
          rating,
          body: body ?? null,
          context,
        })
        .select('id, rating, context, created_at')
        .single();

      if (error) throw error;

      // Advance to step 5 (feedback_submitted)
      await getSupabaseAdmin()
        .from('founders')
        .update({ onboarding_step: 5, updated_at: new Date().toISOString() })
        .eq('id', founderId)
        .lt('onboarding_step', 5);

      return reply.status(201).send(data);
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /feedback' } });
      return reply.status(500).send({ error: 'Failed to save feedback' });
    }
  });

  /**
   * POST /products/:id/brand-voice/preview
   * Adjusts the provided copy to match this product's brand voice.
   * Extracts brand voice from reviews if not cached (10 tokens), then applies it (5 tokens).
   * Target: responds within 15 seconds using Claude Haiku.
   * Body: { copy: string }
   * Returns: { original, adjusted, tone, adjectives }
   */
  server.post<{ Params: { id: string }; Body: { copy: string } }>(
    '/products/:id/brand-voice/preview',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      const copy = (request.body as { copy?: unknown })?.copy;
      if (typeof copy !== 'string' || !copy.trim()) {
        return reply.status(400).send({ error: 'Body must include a non-empty "copy" string' });
      }
      if (copy.length > 2000) {
        return reply.status(400).send({ error: 'Copy must be 2000 characters or fewer' });
      }

      try {
        const result = await previewBrandVoice(request.params.id, founderId, copy.trim());
        return reply.send(result);
      } catch (err) {
        if (err instanceof Error && err.message === 'Product not found') {
          return reply.status(404).send({ error: 'Product not found' });
        }
        Sentry.captureException(err, { tags: { route: 'POST /products/:id/brand-voice/preview' } });
        return reply.status(500).send({ error: 'Brand voice preview failed' });
      }
    }
  );
}
