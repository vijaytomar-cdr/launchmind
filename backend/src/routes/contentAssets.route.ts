/**
 * @file contentAssets.route.ts
 * @description Content asset CRUD and approval routes.
 *   POST   /products/:id/content         — manual trigger (Builder+ only)
 *   GET    /products/:id/content-assets  — list assets with optional ?status=&channel= filters
 *   POST   /content-assets/:id/approve   — approve a single asset
 *   POST   /content-assets/:id/hold      — hold a single asset (pause from posting)
 *   POST   /content-assets/:id/regenerate — regen with reason (max 3 regens)
 *   POST   /content-assets/:id/approve-all — approve all text assets for a product
 * @security JWT required. Asset ownership verified against founder_id on every write.
 * @dependencies contentService, supabaseAdmin
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { generateContentAssets, regenerateAsset } from '../services/contentService';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

const RegenerateBodySchema = z.object({
  reason:         z.string().min(1).max(500),
  additionalNote: z.string().max(500).optional(),
});

const ListQuerySchema = z.object({
  status:  z.string().optional(),
  channel: z.string().optional(),
  limit:   z.coerce.number().min(1).max(100).optional().default(50),
  offset:  z.coerce.number().min(0).optional().default(0),
});

export async function contentAssetsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /products/:id/content
   * Manually triggers the full content generation pipeline for a product.
   * Restricted to Builder and Studio plans.
   * @security founderId verified against product. Plan gate enforced.
   */
  server.post('/products/:id/content', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const productId = (request.params as { id: string }).id;

    const supabase = getSupabaseAdmin();

    // Plan gate — Builder+ only
    const { data: founder } = await supabase
      .from('founders')
      .select('plan')
      .eq('id', founderId)
      .single();

    if (!founder || !['builder', 'studio'].includes(founder.plan ?? '')) {
      return reply.status(403).send({ error: 'Content generation requires Builder or Studio plan' });
    }

    // Ownership check
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('founder_id', founderId)
      .single();

    if (!product) return reply.status(404).send({ error: 'Product not found' });

    try {
      // Fire-and-forget — returns 202 immediately; pipeline runs in background
      void generateContentAssets(productId, founderId, null).catch((err) =>
        Sentry.captureException(err, { tags: { route: 'POST /products/:id/content' } })
      );
      return reply.status(202).send({ message: 'Content generation started' });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /products/:id/content' } });
      return reply.status(500).send({ error: 'Failed to start content generation' });
    }
  });

  /**
   * GET /products/:id/content-assets
   * Lists content assets for a product with optional status/channel filters.
   */
  server.get('/products/:id/content-assets', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const productId = (request.params as { id: string }).id;

    const queryResult = ListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({ error: 'Invalid query params', detail: queryResult.error.message });
    }
    const { status, channel, limit, offset } = queryResult.data;

    try {
      let query = getSupabaseAdmin()
        .from('content_assets')
        .select('id, product_id, brief_id, asset_type, channel, market, language, text_content, media_url, media_type, duration_seconds, thumbnail_url, quality_score, quality_flags, generation_week, hook_angle, status, auto_approved, approved_at, regen_count, regen_reasons, installs, impressions, cpi, created_at, updated_at', { count: 'exact' })
        .eq('product_id', productId)
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (channel) query = query.eq('channel', channel);

      const { data, count, error } = await query;
      if (error) throw error;

      return reply.send({ assets: data ?? [], total: count ?? 0 });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /products/:id/content-assets' } });
      return reply.status(500).send({ error: 'Failed to fetch content assets' });
    }
  });

  /**
   * POST /content-assets/:id/approve
   * Approves a single content asset. Sets status → 'approved'.
   * @security Ownership verified via founder_id.
   */
  server.post('/content-assets/:id/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('content_assets')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .select('id, status')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Asset not found' });
      return reply.send({ asset: data });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /content-assets/:id/approve' } });
      return reply.status(500).send({ error: 'Failed to approve asset' });
    }
  });

  /**
   * POST /content-assets/:id/hold
   * Holds a content asset — prevents it from being posted. Sets status → 'held'.
   * @security Ownership verified via founder_id.
   */
  server.post('/content-assets/:id/hold', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('content_assets')
        .update({ status: 'held', updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .select('id, status')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Asset not found' });
      return reply.send({ asset: data });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /content-assets/:id/hold' } });
      return reply.status(500).send({ error: 'Failed to hold asset' });
    }
  });

  /**
   * POST /content-assets/:id/regenerate
   * Regenerates a content asset with a reason. Max 3 regens per asset.
   * Body: { reason: string, additionalNote?: string }
   * Returns 422 if regen_count >= 3.
   * @security Ownership verified in regenerateAsset().
   */
  server.post('/content-assets/:id/regenerate', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = RegenerateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
    }

    // Check regen_count before calling service (returns 422 early)
    const { data: asset } = await getSupabaseAdmin()
      .from('content_assets')
      .select('regen_count, founder_id')
      .eq('id', assetId)
      .single();

    if (!asset || asset.founder_id !== founderId) {
      return reply.status(404).send({ error: 'Asset not found' });
    }
    if ((asset.regen_count ?? 0) >= 3) {
      return reply.status(422).send({ error: 'Maximum regenerations (3) reached for this asset' });
    }

    try {
      await regenerateAsset(assetId, founderId, parsed.data.reason, parsed.data.additionalNote);
      return reply.status(202).send({ message: 'Regeneration started' });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /content-assets/:id/regenerate' } });
      const msg = err instanceof Error ? err.message : 'Failed to regenerate asset';
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * POST /content-assets/:id/approve-all
   * Approves all pending text assets for a product (skips video assets).
   * The :id here is the product_id.
   * @security Ownership verified via founder_id.
   */
  server.post('/products/:id/content-assets/approve-all', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const productId = (request.params as { id: string }).id;

    const VIDEO_ASSET_TYPES = ['video_reels_30s', 'video_shorts_60s', 'video_app_preview', 'whatsapp_voice_note'];

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('content_assets')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('product_id', productId)
        .eq('founder_id', founderId)
        .eq('status', 'pending')
        .not('asset_type', 'in', `(${VIDEO_ASSET_TYPES.map((t) => `"${t}"`).join(',')})`)
        .select('id');

      if (error) throw error;
      return reply.send({ approved: data?.length ?? 0 });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /products/:id/content-assets/approve-all' } });
      return reply.status(500).send({ error: 'Failed to approve assets' });
    }
  });
}
