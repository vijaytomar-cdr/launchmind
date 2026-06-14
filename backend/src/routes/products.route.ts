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
import { buildICPBrief, analyseScreenshots, scrapeWebsite } from '../services/icpService';
import { generateStrategy, generateContentAssets, getProductStrategy } from '../services/strategyService';
import { AssetsRequestSchema } from '../types/strategy';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { consumeTokens } from '../lib/tokens';
import { getProductMetrics } from '../services/metricsService';
import { previewBrandVoice } from '../services/brandVoiceService';
import { InsufficientTokensError } from '../types/errors';
import { enqueueScrapeJob, getScrapeJob } from '../lib/scraperQueue';
import {
  ScrapedAppDataSchema,
  ICPBriefSchema,
  CompetitorAppSchema,
  ConfirmProductBodySchema,
  FounderContextSchema,
  IntakeScrapeBodySchema,
} from '../types/scraper';

// Kept for backward-compatible single-URL scrape (sync path)
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
   * Two paths:
   *   Legacy (url field only): sync scrape → returns { scraped, icpBrief, competitors }.
   *   Multi-URL (appStoreUrl / playStoreUrl / websiteUrl): creates product row, queues BullMQ job
   *     → returns { productId, jobId, status: 'queued' }. Poll GET /products/scrape/:jobId.
   * @security founderId extracted from JWT. No DB save on legacy path.
   */
  server.post<{ Body: Record<string, unknown> }>(
    '/products/scrape',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const body = request.body as Record<string, unknown>;

      // ── Multi-URL async path ────────────────────────────────────────────────
      // Catch all multi-URL variants including legacy storeUrl field and websiteUrl-only
      const hasMultiUrl = body.appStoreUrl || body.playStoreUrl || body.storeUrl || body.websiteUrl;
      if (hasMultiUrl) {
        const parsed = IntakeScrapeBodySchema.safeParse(body);
        if (!parsed.success) {
          // Distinguish between format errors (400) and missing-store-URL refine failures (422)
          const isRefineError = parsed.error.errors.every((e) => e.code === 'custom');
          const status = isRefineError ? 422 : 400;
          return reply.status(status).send({ error: parsed.error.errors[0]?.message ?? 'At least one app store URL is required' });
        }

        // Map legacy storeUrl to the right platform field
        const appStoreUrl  = parsed.data.appStoreUrl;
        const playStoreUrl = parsed.data.playStoreUrl ?? (parsed.data.storeUrl?.includes('play.google') ? parsed.data.storeUrl : undefined);
        const appStoreResolved = appStoreUrl ?? (parsed.data.storeUrl?.includes('apps.apple') ? parsed.data.storeUrl : undefined);
        const websiteUrl   = parsed.data.websiteUrl;
        const storeUrl     = appStoreResolved ?? playStoreUrl ?? '';
        const platform = detectPlatform(storeUrl);

        if (!platform) {
          return reply.status(422).send({ error: 'appStoreUrl or playStoreUrl must be a valid store URL' });
        }

        // Plan limit check — run both queries in parallel
        const [{ data: founder }, { count: productCount }] = await Promise.all([
          getSupabaseAdmin().from('founders').select('plan').eq('id', founderId).single(),
          getSupabaseAdmin().from('products').select('id', { count: 'exact', head: true }).eq('founder_id', founderId).is('archived_at', null),
        ]);

        const limit = PLAN_PRODUCT_LIMITS[founder?.plan ?? 'free'] ?? 1;
        if ((productCount ?? 0) >= limit) {
          return reply.status(422).send({
            error: `Your ${founder?.plan ?? 'free'} plan allows ${limit} product${limit === 1 ? '' : 's'}. Upgrade to add more.`,
            code: 'PLAN_LIMIT_REACHED',
          });
        }

        // Create a product placeholder row (worker fills in name, scraped_meta, etc.)
        const { data: product, error: insertError } = await getSupabaseAdmin()
          .from('products')
          .insert({
            founder_id: founderId,
            name: 'Untitled Product',
            store_url: storeUrl,
            platform,
            app_store_url: appStoreUrl ?? null,
            play_store_url: playStoreUrl ?? null,
            website_url: websiteUrl ?? null,
            intake_step: 1,
          })
          .select('id')
          .single();

        if (insertError || !product) {
          Sentry.captureException(insertError, { tags: { route: 'POST /products/scrape async' } });
          return reply.status(500).send({ error: 'Failed to create product slot' });
        }

        const jobId = await enqueueScrapeJob({
          productId: product.id,
          founderId,
          appStoreUrl,
          playStoreUrl,
          websiteUrl,
        });

        // Audit log is non-critical — fire and forget so it doesn't delay the 202
        void (async () => {
          try {
            await getSupabaseAdmin().from('audit_logs').insert({
              founder_id: founderId,
              action: 'product_scrape_queued',
              resource_type: 'product',
              resource_id: product.id,
              metadata: { platform, appStoreUrl, playStoreUrl, websiteUrl, jobId },
            });
          } catch { /* non-critical */ }
        })();

        return reply.status(202).send({ productId: product.id, jobId, status: 'queued' });
      }

      // ── Legacy single-URL sync path (backward compat) ──────────────────────
      const legacyParsed = ScrapeBodySchema.safeParse(body);
      if (!legacyParsed.success) {
        return reply.status(400).send({ error: 'url is required and must be a valid URL' });
      }

      const { url } = legacyParsed.data;
      const platform = detectPlatform(url);

      if (!platform) {
        return reply.status(422).send({ error: 'URL must be an App Store or Play Store URL' });
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
          scrapeCompetitors(scraped.category, platform).catch(() => []),
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
   * POST /products/competitor/website
   * Scrapes open-graph + meta tags from a competitor's website URL.
   * Used when a competitor has no app store presence — returns name from <title>,
   * developer from domain, rating=0. Store URLs must use POST /products/scrape.
   * @security HTTPS only. Blocks private/loopback addresses. founderId from JWT.
   */
  server.post<{ Body: { url: string } }>(
    '/products/competitor/website',
    async (request, reply) => {
      const BodySchema = z.object({
        url: z.string().url().refine(
          (u) => {
            try {
              const p = new URL(u);
              return (
                p.protocol === 'https:' &&
                !p.hostname.includes('localhost') &&
                !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(p.hostname)
              );
            } catch { return false; }
          },
          { message: 'URL must be a public HTTPS address' }
        ),
      });

      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid URL' });
      }

      const { url } = parsed.data;

      if (detectPlatform(url)) {
        return reply.status(400).send({ error: 'Use POST /products/scrape for App Store or Play Store URLs' });
      }

      try {
        const meta = await scrapeWebsite(url);
        const domain = new URL(url).hostname.replace(/^www\./, '');
        return reply.send({
          scraped: {
            name:        meta.title || domain,
            developer:   domain,
            rating:      0,
            ratingCount: 0,
            priceTier:   '',
            description: meta.description || '',
            category:    '',
            screenshots: [],
            platform:    'website',
            storeUrl:    url,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch website';
        Sentry.captureException(err, { tags: { route: 'POST /products/competitor/website' } });
        return reply.status(422).send({ error: msg });
      }
    }
  );

  /**
   * GET /products/scrape/:jobId
   * Polls a BullMQ scrape job queued by POST /products/scrape (multi-URL path).
   * Returns { status, progress?, result? } — frontend polls until status='completed'|'failed'.
   * @security founderId from JWT. Job data includes founderId for cross-check.
   */
  server.get<{ Params: { jobId: string } }>(
    '/products/scrape/:jobId',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { jobId } = request.params;

      try {
        const job = await getScrapeJob(jobId);
        if (!job) {
          return reply.status(404).send({ error: 'Job not found' });
        }

        // Verify this job belongs to the requesting founder
        if (job.data.founderId !== founderId) {
          return reply.status(404).send({ error: 'Job not found' });
        }

        const state = await job.getState();
        const progress = typeof job.progress === 'number' ? job.progress : 0;

        if (state === 'completed') {
          return reply.send({
            status: 'completed',
            progress: 100,
            productId: job.data.productId,
            result: job.returnvalue,
          });
        }

        if (state === 'failed') {
          return reply.send({
            status: 'failed',
            progress,
            productId: job.data.productId,
            error: job.failedReason ?? 'Scrape failed — please retry',
          });
        }

        return reply.send({
          status: state === 'active' ? 'active' : 'waiting',
          progress,
          productId: job.data.productId,
        });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /products/scrape/:jobId' } });
        return reply.status(500).send({ error: 'Failed to fetch job status' });
      }
    }
  );

  /**
   * POST /products/intake/context
   * Saves the founder's context answers to a product's founder_context JSONB column.
   * Advances intake_step to at least 3.
   * @security founderId verified against product.founder_id before update.
   */
  server.post<{ Body: { productId: string; founderContext: Record<string, unknown> } }>(
    '/products/intake/context',
    async (request, reply) => {
      const founderId = getFounderId(request);

      const BodySchema = z.object({
        productId: z.string().uuid(),
        founderContext: FounderContextSchema,
      });

      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
      }

      const { productId, founderContext } = parsed.data;

      // Verify ownership and fetch existing context for merge
      const { data: existing } = await getSupabaseAdmin()
        .from('products')
        .select('id, intake_step, founder_context')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single();

      if (!existing) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      // Merge incoming fields into existing context (partial saves preserve prior answers)
      const mergedContext = { ...(existing.founder_context ?? {}), ...founderContext };
      const nextStep = Math.max(existing.intake_step ?? 0, 3);

      const { data: updated, error } = await getSupabaseAdmin()
        .from('products')
        .update({
          founder_context: mergedContext,
          intake_step: nextStep,
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId)
        .eq('founder_id', founderId)
        .select('id, intake_step, founder_context')
        .single();

      if (error || !updated) {
        Sentry.captureException(error, { tags: { route: 'POST /products/intake/context' } });
        return reply.status(500).send({ error: 'Failed to save founder context' });
      }

      return reply.send(updated);
    }
  );

  /**
   * POST /products/intake/screenshots
   * Analyses app screenshots using Claude Haiku vision (5 tokens) and saves the result.
   * Accepts public screenshot URLs or base64 data URIs.
   * Advances intake_step to at least 4.
   * @security founderId verified. Screenshots passed to Claude only — never stored raw.
   */
  server.post<{ Body: { productId: string; screenshots: string[] } }>(
    '/products/intake/screenshots',
    async (request, reply) => {
      const founderId = getFounderId(request);

      const BodySchema = z.object({
        productId: z.string().uuid(),
        screenshots: z.array(z.string().min(1)).min(1).max(10),
      });

      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
      }

      const { productId, screenshots } = parsed.data;

      // Verify ownership
      const { data: existing } = await getSupabaseAdmin()
        .from('products')
        .select('id, intake_step')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single();

      if (!existing) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      await consumeTokens(founderId, 'scoring', 5);

      try {
        const analysis = await analyseScreenshots(screenshots, founderId);
        const nextStep = Math.max(existing.intake_step ?? 0, 4);

        const { data: updated, error } = await getSupabaseAdmin()
          .from('products')
          .update({
            screenshot_analysis: analysis,
            intake_step: nextStep,
            updated_at: new Date().toISOString(),
          })
          .eq('id', productId)
          .eq('founder_id', founderId)
          .select('id, intake_step, screenshot_analysis')
          .single();

        if (error || !updated) {
          Sentry.captureException(error, { tags: { route: 'POST /products/intake/screenshots' } });
          return reply.status(500).send({ error: 'Failed to save screenshot analysis' });
        }

        return reply.send(updated);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /products/intake/screenshots' } });
        return reply.status(500).send({ error: 'Screenshot analysis failed' });
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

      // ── v2 async path: UPDATE an existing product ──────────────────────────
      if (body.productId) {
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('id', body.productId)
          .eq('founder_id', founderId)
          .single();

        if (!existing) {
          return reply.status(404).send({ error: 'Product not found' });
        }

        await consumeTokens(founderId, 'icp_structuring', 10);

        const { data: product, error: updateError } = await supabase
          .from('products')
          .update({
            confirmed_icp: body.icpBrief,
            competitor_set: body.competitors.length ? body.competitors : undefined,
            markets: body.selectedMarkets ?? body.icpBrief.suggestedMarkets,
            selected_markets: body.selectedMarkets ?? null,
            primary_channel: body.primaryChannel ?? null,
            excluded_channels: body.excludedChannels ?? null,
            intake_step: 6,
            intake_completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.productId)
          .eq('founder_id', founderId)
          .select()
          .single();

        if (updateError || !product) {
          Sentry.captureException(updateError, { tags: { route: 'POST /products/confirm v2' } });
          return reply.status(500).send({ error: 'Failed to update product' });
        }

        await getSupabaseAdmin().from('audit_logs').insert({
          founder_id: founderId,
          action: 'product_confirmed',
          resource_type: 'product',
          resource_id: product.id,
          metadata: { name: product.name, platform: product.platform },
        });

        await getSupabaseAdmin()
          .from('founders')
          .update({ onboarding_step: 1, updated_at: new Date().toISOString() })
          .eq('id', founderId)
          .lt('onboarding_step', 1);

        return reply.status(200).send(product);
      }

      // ── Legacy path: INSERT a new product ─────────────────────────────────
      if (!body.url || !body.platform || !body.scraped) {
        return reply.status(400).send({ error: 'url, platform, and scraped are required when productId is not provided' });
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
        .eq('founder_id', founderId)
        .is('archived_at', null);

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
          markets: body.selectedMarkets ?? body.icpBrief.suggestedMarkets,
          price_tier: body.scraped.priceTier,
          confirmed_icp: body.icpBrief,
          competitor_set: body.competitors,
          scraped_meta: body.scraped,
          last_scraped_at: new Date().toISOString(),
          selected_markets: body.selectedMarkets ?? null,
          primary_channel: body.primaryChannel ?? null,
          excluded_channels: body.excludedChannels ?? null,
          intake_step: 6,
          intake_completed_at: new Date().toISOString(),
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
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      Sentry.captureException(error, { tags: { route: 'GET /products' } });
      return reply.status(500).send({ error: 'Failed to fetch products' });
    }

    return reply.send(data ?? []);
  });

  /**
   * GET /products/archived
   * Lists all archived products for the authenticated founder.
   * Must be registered BEFORE /products/:id to avoid route conflict.
   */
  server.get('/products/archived', async (request, reply) => {
    const founderId = getFounderId(request);

    const { data, error } = await getSupabaseAdmin()
      .from('products')
      .select('id, name, store_url, platform, category, archived_at, archive_reason, created_at')
      .eq('founder_id', founderId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });

    if (error) {
      Sentry.captureException(error, { tags: { route: 'GET /products/archived' } });
      return reply.status(500).send({ error: 'Failed to fetch archived products' });
    }

    return reply.send(data ?? []);
  });

  /**
   * POST /products/:id/archive
   * Soft-deletes a product (sets archived_at + archive_reason = 'owner_archived').
   * Also pauses any active campaigns for the product.
   * @security founderId verified against product.founder_id.
   */
  server.post<{ Params: { id: string } }>(
    '/products/:id/archive',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      const supabase = getSupabaseAdmin();

      const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('id, name, founder_id, archived_at')
        .eq('id', id)
        .eq('founder_id', founderId)
        .single();

      if (fetchError || !product) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      if (product.archived_at) {
        return reply.status(409).send({ error: 'Product is already archived' });
      }

      // Pause any active campaigns before archiving
      await supabase
        .from('campaigns')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('product_id', id)
        .eq('founder_id', founderId)
        .in('status', ['draft', 'approved', 'launched']);

      const { error: archiveError } = await supabase
        .from('products')
        .update({ archived_at: new Date().toISOString(), archive_reason: 'owner_archived' })
        .eq('id', id)
        .eq('founder_id', founderId);

      if (archiveError) {
        Sentry.captureException(archiveError, { tags: { route: 'POST /products/:id/archive' } });
        return reply.status(500).send({ error: 'Failed to archive product' });
      }

      await supabase.from('audit_logs').insert({
        founder_id: founderId,
        action: 'product_archived',
        resource_type: 'product',
        resource_id: id,
        metadata: { name: product.name },
      });

      return reply.send({ ok: true });
    }
  );

  /**
   * POST /products/:id/restore
   * Restores an archived product (clears archived_at and archive_reason).
   * @security founderId verified against product.founder_id.
   */
  server.post<{ Params: { id: string } }>(
    '/products/:id/restore',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      const supabase = getSupabaseAdmin();

      const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('id, name, founder_id, archived_at')
        .eq('id', id)
        .eq('founder_id', founderId)
        .single();

      if (fetchError || !product) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      if (!product.archived_at) {
        return reply.status(409).send({ error: 'Product is not archived' });
      }

      // Check plan limit before restoring
      const [{ data: founder }, { count: activeCount }] = await Promise.all([
        supabase.from('founders').select('plan').eq('id', founderId).single(),
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('founder_id', founderId).is('archived_at', null),
      ]);

      const limit = PLAN_PRODUCT_LIMITS[founder?.plan ?? 'free'] ?? 1;
      if ((activeCount ?? 0) >= limit) {
        return reply.status(422).send({
          error: `Your ${founder?.plan ?? 'free'} plan allows ${limit} active product${limit === 1 ? '' : 's'}. Archive another product first.`,
          code: 'PLAN_LIMIT_REACHED',
        });
      }

      const { error: restoreError } = await supabase
        .from('products')
        .update({ archived_at: null, archive_reason: null })
        .eq('id', id)
        .eq('founder_id', founderId);

      if (restoreError) {
        Sentry.captureException(restoreError, { tags: { route: 'POST /products/:id/restore' } });
        return reply.status(500).send({ error: 'Failed to restore product' });
      }

      await supabase.from('audit_logs').insert({
        founder_id: founderId,
        action: 'product_restored',
        resource_type: 'product',
        resource_id: id,
        metadata: { name: product.name },
      });

      return reply.send({ ok: true });
    }
  );

  /**
   * DELETE /products/:id
   * Permanently deletes a product and all associated data.
   * Requires the product to be archived first (two-step safety gate).
   * Body: { confirmation: "DELETE" } — must match exactly.
   * @security founderId verified against product.founder_id.
   */
  server.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    '/products/:id',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid product ID' });
      }

      const body = request.body as { confirmation?: unknown };
      if (body?.confirmation !== 'DELETE') {
        return reply.status(400).send({ error: 'Body must include { "confirmation": "DELETE" }' });
      }

      const supabase = getSupabaseAdmin();

      const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('id, name, founder_id, archived_at')
        .eq('id', id)
        .eq('founder_id', founderId)
        .single();

      if (fetchError || !product) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      if (!product.archived_at) {
        return reply.status(422).send({
          error: 'Product must be archived before it can be permanently deleted. Call POST /products/:id/archive first.',
          code: 'MUST_ARCHIVE_FIRST',
        });
      }

      // Stamp archive_reason = 'owner_deleted' for audit trail before hard delete
      await supabase
        .from('products')
        .update({ archive_reason: 'owner_deleted' })
        .eq('id', id)
        .eq('founder_id', founderId);

      await supabase.from('audit_logs').insert({
        founder_id: founderId,
        action: 'product_deleted',
        resource_type: 'product',
        resource_id: id,
        metadata: { name: product.name, permanent: true },
      });

      const { error: deleteError } = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .eq('founder_id', founderId);

      if (deleteError) {
        Sentry.captureException(deleteError, { tags: { route: 'DELETE /products/:id' } });
        return reply.status(500).send({ error: 'Failed to delete product' });
      }

      return reply.status(204).send();
    }
  );

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
