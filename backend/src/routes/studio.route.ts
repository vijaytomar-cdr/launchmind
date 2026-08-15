/**
 * @file studio.route.ts
 * @description Content Studio — unified AI content generation, asset library, versioning,
 *   editor transforms, publishing targets, and archive/restore.
 *   All endpoints require JWT. Asset ownership enforced on every write.
 * @security JWT required. Ownership check: founder_id = auth.uid() enforced in every handler.
 *   Approval gate: assets must be approved before publish records are created.
 *   Versions are append-only — no UPDATE/DELETE allowed on content_versions.
 * @dependencies aiPlatform, contextEngine, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { callSonnet, callHaiku } from '../lib/aiPlatform';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const VALID_ASSET_TYPES = [
  'whatsapp_broadcast', 'whatsapp_voice_note',
  'meta_headline', 'meta_body', 'meta_image_brief',
  'google_uac_variants', 'aso_subtitle', 'aso_description', 'aso_keywords',
  'email_day1', 'email_day5', 'email_day14',
  'linkedin_founder_story', 'linkedin_data_post',
  'video_reels_30s', 'video_shorts_60s', 'video_app_preview',
  'carousel_brief', 'community_whatsapp_group', 'community_facebook',
  'community_indiehackers', 'community_twitter_thread',
  'social_proof_case_study', 'social_proof_testimonial',
  'social_proof_review_response', 'social_proof_producthunt',
  'blog_post', 'landing_page_copy', 'push_notification', 'release_notes', 'press_release',
] as const;

const GenerateBodySchema = z.object({
  productId:   z.string().uuid(),
  assetType:   z.enum(VALID_ASSET_TYPES),
  channel:     z.string().min(1).max(50),
  market:      z.enum(['usa', 'india', 'both']).default('usa'),
  language:    z.string().optional().default('english'),
  missionId:   z.string().uuid().optional(),
  tone:        z.string().optional(),
  keywords:    z.array(z.string()).optional(),
  context:     z.string().max(2000).optional(),
});

const UpdateBodySchema = z.object({
  textContent:    z.string().optional(),
  structuredData: z.record(z.unknown()).optional(),
  tags:           z.array(z.string().max(50)).max(20).optional(),
  changeSummary:  z.string().max(500).optional(),
});

const TransformBodySchema = z.object({
  transformType: z.enum(['rewrite', 'expand', 'shorten', 'tone', 'translate', 'seo', 'aso']),
  targetTone:    z.enum(['professional', 'casual', 'urgent', 'friendly', 'authoritative']).optional(),
  targetLanguage: z.string().optional(),
  targetLength:  z.number().int().positive().optional(),
  instructions:  z.string().max(500).optional(),
});

const PublishBodySchema = z.object({
  channel:     z.enum(['meta', 'google', 'whatsapp', 'email', 'linkedin', 'web', 'app_store', 'play_store']),
  platformUrl: z.string().url().optional(),
  externalId:  z.string().optional(),
  metadata:    z.record(z.unknown()).optional(),
});

const ListQuerySchema = z.object({
  search:    z.string().optional(),
  type:      z.string().optional(),
  status:    z.string().optional(),
  channel:   z.string().optional(),
  market:    z.string().optional(),
  language:  z.string().optional(),
  missionId: z.string().uuid().optional(),
  tags:      z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  limit:     z.coerce.number().min(1).max(100).optional().default(50),
  offset:    z.coerce.number().min(0).optional().default(0),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a type-specific system prompt for on-demand generation.
 * Uses product context (name, ICP, brand voice) to ground the output.
 */
function buildGeneratePrompt(assetType: string, product: Record<string, unknown>, options: {
  market: string;
  language: string;
  tone?: string;
  keywords?: string[];
  context?: string;
}): { system: string; user: string } {
  const icp = (product.confirmed_icp as Record<string, unknown>) ?? {};
  const brandVoice = (product.brand_voice_profile as Record<string, unknown>) ?? {};
  const productName = String(product.name ?? 'the app');

  const baseContext = `Product: ${productName}
Market: ${options.market.toUpperCase()}
Language: ${options.language}
Target user: ${JSON.stringify(icp)}
Brand voice: ${JSON.stringify(brandVoice)}
${options.context ? `Additional context: ${options.context}` : ''}
${options.tone ? `Tone: ${options.tone}` : ''}
${options.keywords?.length ? `Keywords to include: ${options.keywords.join(', ')}` : ''}`;

  const typePrompts: Record<string, { system: string; user: string }> = {
    blog_post: {
      system: 'You are an expert SEO content writer for mobile apps. Return JSON with keys: title (string), metaDescription (string, max 160 chars), body (string, 600-900 words, markdown), estimatedReadTime (number in minutes).',
      user: `${baseContext}\n\nWrite a high-quality blog post that helps ${productName} acquire organic users through search.`,
    },
    landing_page_copy: {
      system: 'You are a conversion copywriter. Return JSON with keys: headline (string), subheadline (string), heroCtaText (string), features (array of {title, description}), socialProof (string), faqItems (array of {question, answer}), finalCta (string).',
      user: `${baseContext}\n\nWrite high-converting landing page copy for ${productName}.`,
    },
    push_notification: {
      system: 'You are a mobile push notification specialist. Return JSON with keys: title (string, max 50 chars), body (string, max 100 chars), actionLabel (string, max 20 chars), deepLink (string placeholder). Write 3 variants.',
      user: `${baseContext}\n\nWrite re-engagement push notifications for ${productName} users who haven't opened the app in 7 days.`,
    },
    release_notes: {
      system: 'You are an app store release notes writer. Return JSON with keys: version (string placeholder), headline (string, max 60 chars), body (string, max 500 chars, bullet points), highlights (array of strings).',
      user: `${baseContext}\n\nWrite compelling release notes that increase update adoption rates for ${productName}.`,
    },
    press_release: {
      system: 'You are a PR professional. Return JSON with keys: headline (string), subheadline (string), dateline (string), body (string, 3-4 paragraphs), quote (string), boilerplate (string), contactInfo (string placeholder).',
      user: `${baseContext}\n\nWrite a press release announcing a major milestone for ${productName}.`,
    },
    whatsapp_broadcast: {
      system: 'You are a WhatsApp marketing specialist. Return JSON with keys: message (string, max 1000 chars), ctaButton (string, max 25 chars), previewText (string). No markdown — plain text only.',
      user: `${baseContext}\n\nWrite a WhatsApp broadcast for ${productName} targeting ${options.market === 'india' ? 'Indian' : 'US'} users.`,
    },
    meta_headline: {
      system: 'You are a Meta Ads specialist. Return JSON with keys: primary (string, max 40 chars), headlines (array of 5 strings, max 30 chars each), descriptions (array of 3 strings, max 125 chars each).',
      user: `${baseContext}\n\nWrite Meta ad copy for ${productName}.`,
    },
    email_day1: {
      system: 'You are an email marketing specialist. Return JSON with keys: subject (string, max 60 chars), preheader (string, max 90 chars), body (string, markdown), cta (string).',
      user: `${baseContext}\n\nWrite a Day 1 welcome email for new ${productName} users that drives first key action.`,
    },
    linkedin_founder_story: {
      system: 'You are a LinkedIn ghostwriter. Return JSON with keys: hook (string, max 150 chars), body (string, 800-1200 chars, line-spaced), cta (string), hashtags (array of strings).',
      user: `${baseContext}\n\nWrite a founder story post about building ${productName} for the ${options.market === 'india' ? 'Indian' : 'US'} market.`,
    },
    community_twitter_thread: {
      system: 'You are a Twitter/X content strategist. Return JSON with keys: tweets (array of strings, max 280 chars each, 5-7 tweets), threadSummary (string).',
      user: `${baseContext}\n\nWrite a Twitter thread that builds authority for ${productName}.`,
    },
    aso_description: {
      system: 'You are an ASO specialist. Return JSON with keys: shortDescription (string, max 80 chars), fullDescription (string, max 4000 chars, includes keywords naturally), keywordsUsed (array of strings).',
      user: `${baseContext}\n\nWrite ASO-optimised app store description for ${productName}.`,
    },
    social_proof_case_study: {
      system: 'You are a case study writer. Return JSON with keys: headline (string), challenge (string), solution (string), result (string), quote (string), metrics (array of {label, value}).',
      user: `${baseContext}\n\nWrite a customer case study template for ${productName}.`,
    },
  };

  // Default fallback for types without custom prompts
  const defaultPrompt = {
    system: `You are an expert marketing copywriter. Generate high-quality ${assetType} content. Return valid JSON with a "content" key containing the generated text and a "notes" key with any usage guidance.`,
    user: `${baseContext}\n\nGenerate ${assetType} content for ${productName}.`,
  };

  return typePrompts[assetType] ?? defaultPrompt;
}

/**
 * Build transform prompt for AI editor transforms.
 */
function buildTransformPrompt(
  currentText: string,
  transformType: string,
  options: {
    targetTone?: string;
    targetLanguage?: string;
    targetLength?: number;
    instructions?: string;
  }
): string {
  const transforms: Record<string, string> = {
    rewrite: `Rewrite the following content while preserving the core message and key information. Make it cleaner, clearer, and more compelling:\n\n${currentText}`,
    expand: `Expand the following content with more detail, examples, and supporting points${options.targetLength ? ` to approximately ${options.targetLength} characters` : '. Add depth without losing focus'}:\n\n${currentText}`,
    shorten: `Shorten the following content${options.targetLength ? ` to approximately ${options.targetLength} characters` : ' by removing unnecessary words and condensing ideas'}. Preserve the key message:\n\n${currentText}`,
    tone: `Rewrite the following content in a ${options.targetTone ?? 'professional'} tone. Keep the same information but adjust the voice:\n\n${currentText}`,
    translate: `Translate the following content to ${options.targetLanguage ?? 'Hindi'}. Keep marketing punch and cultural relevance for the target audience:\n\n${currentText}`,
    seo: `Optimise the following content for SEO. Improve keyword density, headings, and meta-readability without keyword stuffing:\n\n${currentText}`,
    aso: `Optimise the following content for App Store Optimisation (ASO). Improve keyword placement, natural language, and discoverability within Apple/Google store character limits:\n\n${currentText}`,
  };

  const base = transforms[transformType] ?? `Transform (${transformType}) the following:\n\n${currentText}`;
  return options.instructions ? `${base}\n\nAdditional instructions: ${options.instructions}` : base;
}

// ── Route plugin ──────────────────────────────────────────────────────────────

async function studioPlugin(server: FastifyInstance): Promise<void> {

  /**
   * POST /studio/generate
   * Generate a single content asset on demand.
   * @security JWT required. Product ownership verified.
   */
  server.post('/studio/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = GenerateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { productId, assetType, channel, market, language, missionId, tone, keywords, context } = parsed.data;
    const supabase = getSupabaseAdmin();

    try {
      // Ownership check
      const { data: product } = await supabase
        .from('products')
        .select('id, name, confirmed_icp, brand_voice_profile')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single();

      if (!product) return reply.status(404).send({ error: 'Product not found' });

      const { system, user } = buildGeneratePrompt(assetType, product as Record<string, unknown>, {
        market, language, tone, keywords, context,
      });

      // Use Sonnet for long-form types, Haiku for short copy
      const longFormTypes = ['blog_post', 'landing_page_copy', 'press_release', 'social_proof_case_study'];
      const isLongForm = longFormTypes.includes(assetType);
      const maxTokens = isLongForm ? 2048 : 512;

      let rawOutput: string;
      if (isLongForm) {
        rawOutput = await callSonnet(system, user, maxTokens, {
          founderId,
          promptId: `studio_generate_${assetType}`,
          action: 'studio_generate',
        });
      } else {
        rawOutput = await callHaiku(`${system}\n\n${user}`, maxTokens, {
          founderId,
          promptId: `studio_generate_${assetType}`,
          action: 'studio_generate',
        });
      }

      // Parse JSON output; fall back to raw text
      let textContent: string | null = null;
      let structuredData: Record<string, unknown> | null = null;
      try {
        const cleaned = rawOutput.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        structuredData = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        textContent = rawOutput;
      }

      const { data: asset, error: insertErr } = await supabase
        .from('content_assets')
        .insert({
          product_id:           productId,
          founder_id:           founderId,
          asset_type:           assetType,
          channel,
          market,
          language,
          text_content:         textContent,
          structured_data:      structuredData,
          model_used:           isLongForm ? 'claude-sonnet-4-6' : 'claude-haiku-4-5',
          status:               'pending',
          growth_brain_version: 1,
          mission_id:           missionId ?? null,
          tokens_consumed:      maxTokens,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      return reply.status(201).send({ asset });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Generation failed' });
    }
  });

  /**
   * GET /studio/assets
   * List and search the asset library with filters.
   * @security JWT required. Returns only current founder's assets.
   */
  server.get('/studio/assets', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.errors });
    }

    const { search, type, status, channel, market, language, missionId, tags, includeArchived, limit, offset } = parsed.data;
    const supabase = getSupabaseAdmin();

    try {
      // BUSINESS SCOPE. Was founder-only, so one founder's second business saw
      // the first's content. An unselected business yields an EMPTY list of the
      // same shape — never an unfiltered one.
      const { activeProductId } = await import('../services/activeBusinessService');
      const scopedProductId = await activeProductId(founderId);
      if (!scopedProductId) return reply.send({ assets: [], total: 0, limit, offset });

      let query = supabase
        .from('content_assets')
        .select(`
          id, asset_type, channel, market, language, status,
          text_content, structured_data, media_url, media_type,
          model_used, quality_score, hook_angle, tokens_consumed,
          tags, mission_id, growth_brain_version, archived_at, published_at,
          approved_at, regen_count, installs, impressions, cpi,
          created_at, updated_at
        `, { count: 'exact' })
        .eq('founder_id', founderId)
        .eq('product_id', scopedProductId);

      if (!includeArchived) {
        query = query.is('archived_at', null);
      }
      if (type) query = query.eq('asset_type', type);
      if (status) query = query.eq('status', status);
      if (channel) query = query.eq('channel', channel);
      if (market) query = query.eq('market', market);
      if (language) query = query.eq('language', language);
      if (missionId) query = query.eq('mission_id', missionId);
      if (tags) {
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        if (tagList.length > 0) {
          query = query.overlaps('tags', tagList);
        }
      }
      if (search) {
        query = query.ilike('text_content', `%${search}%`);
      }

      const { data: assets, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return reply.send({ assets: assets ?? [], total: count ?? 0, limit, offset });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to list assets' });
    }
  });

  /**
   * GET /studio/assets/:id
   * Get a single asset with its version count and publishing targets.
   * @security JWT required. Ownership enforced.
   */
  server.get('/studio/assets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data: asset, error } = await supabase
        .from('content_assets')
        .select('*')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (error || !asset) return reply.status(404).send({ error: 'Asset not found' });

      // Count versions
      const { count: versionCount } = await supabase
        .from('content_versions')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', assetId);

      // Get latest publishing target
      const { data: publishTargets } = await supabase
        .from('publishing_targets')
        .select('id, channel, status, platform_url, published_at')
        .eq('asset_id', assetId)
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false })
        .limit(5);

      return reply.send({ asset, versionCount: versionCount ?? 0, publishTargets: publishTargets ?? [] });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to get asset' });
    }
  });

  /**
   * PUT /studio/assets/:id
   * Update asset content. Creates a version record before overwriting.
   * @security JWT required. Ownership enforced.
   */
  server.put('/studio/assets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = UpdateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const supabase = getSupabaseAdmin();

    try {
      // Get current asset (ownership check)
      const { data: asset, error: fetchErr } = await supabase
        .from('content_assets')
        .select('id, founder_id, text_content, structured_data, media_url, growth_brain_version')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !asset) return reply.status(404).send({ error: 'Asset not found' });

      // Get next version number
      const { data: maxVer } = await supabase
        .from('content_versions')
        .select('version_number')
        .eq('asset_id', assetId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVer?.version_number ?? 0) + 1;

      // Snapshot current state
      await supabase.from('content_versions').insert({
        asset_id:             assetId,
        version_number:       nextVersion,
        text_content:         asset.text_content,
        structured_data:      asset.structured_data,
        media_url:            asset.media_url,
        growth_brain_version: asset.growth_brain_version,
        change_type:          'editor_save',
        change_summary:       parsed.data.changeSummary ?? 'Editor save',
        changed_by:           founderId,
      });

      // Build update payload (only include provided fields)
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.textContent !== undefined) updatePayload.text_content = parsed.data.textContent;
      if (parsed.data.structuredData !== undefined) updatePayload.structured_data = parsed.data.structuredData;
      if (parsed.data.tags !== undefined) updatePayload.tags = parsed.data.tags;

      const { data: updated, error: updateErr } = await supabase
        .from('content_assets')
        .update(updatePayload)
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return reply.send({ asset: updated, versionCreated: nextVersion });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to update asset' });
    }
  });

  /**
   * POST /studio/assets/:id/transform
   * AI transform: rewrite, expand, shorten, tone, translate, seo, aso.
   * Saves current version before overwriting.
   * @security JWT required. Ownership enforced. callHaiku for short transforms.
   */
  server.post('/studio/assets/:id/transform', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = TransformBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const supabase = getSupabaseAdmin();

    try {
      const { data: asset, error: fetchErr } = await supabase
        .from('content_assets')
        .select('id, founder_id, text_content, structured_data, growth_brain_version')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !asset) return reply.status(404).send({ error: 'Asset not found' });

      const currentText = asset.text_content
        ?? (asset.structured_data ? JSON.stringify(asset.structured_data, null, 2) : null);

      if (!currentText) {
        return reply.status(400).send({ error: 'Asset has no text content to transform' });
      }

      // Get next version number
      const { data: maxVer } = await supabase
        .from('content_versions')
        .select('version_number')
        .eq('asset_id', assetId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVer?.version_number ?? 0) + 1;

      // Snapshot current state before transform
      await supabase.from('content_versions').insert({
        asset_id:             assetId,
        version_number:       nextVersion,
        text_content:         asset.text_content,
        structured_data:      asset.structured_data,
        growth_brain_version: asset.growth_brain_version,
        change_type:          'ai_transform',
        change_summary:       `${parsed.data.transformType} transform`,
        changed_by:           founderId,
      });

      const transformPrompt = buildTransformPrompt(currentText, parsed.data.transformType, {
        targetTone:     parsed.data.targetTone,
        targetLanguage: parsed.data.targetLanguage,
        targetLength:   parsed.data.targetLength,
        instructions:   parsed.data.instructions,
      });

      // Transforms are always short → Haiku
      const newText = await callHaiku(
        `${transformPrompt}\n\nReturn only the transformed content. No explanation, no preamble.`,
        512,
        { founderId, promptId: `studio_transform_${parsed.data.transformType}`, action: 'studio_transform' },
      );

      const { data: updated, error: updateErr } = await supabase
        .from('content_assets')
        .update({ text_content: newText, updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .select('id, text_content, updated_at')
        .single();

      if (updateErr) throw updateErr;

      return reply.send({
        asset:          updated,
        transformType:  parsed.data.transformType,
        versionCreated: nextVersion,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Transform failed' });
    }
  });

  /**
   * GET /studio/assets/:id/versions
   * List version history for an asset, newest first.
   * @security JWT required. Ownership enforced via changed_by.
   */
  server.get('/studio/assets/:id/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      // Verify asset ownership
      const { data: asset } = await supabase
        .from('content_assets')
        .select('id')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (!asset) return reply.status(404).send({ error: 'Asset not found' });

      const { data: versions, error } = await supabase
        .from('content_versions')
        .select('id, version_number, text_content, structured_data, change_type, change_summary, growth_brain_version, created_at')
        .eq('asset_id', assetId)
        .eq('changed_by', founderId)
        .order('version_number', { ascending: false });

      if (error) throw error;

      return reply.send({ versions: versions ?? [] });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to list versions' });
    }
  });

  /**
   * POST /studio/assets/:id/archive
   * Soft-delete an asset. Sets archived_at timestamp.
   * @security JWT required. Ownership enforced.
   */
  server.post('/studio/assets/:id/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data, error } = await supabase
        .from('content_assets')
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .is('archived_at', null)
        .select('id, archived_at')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Asset not found or already archived' });

      return reply.send({ id: data.id, archivedAt: data.archived_at });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to archive asset' });
    }
  });

  /**
   * POST /studio/assets/:id/restore
   * Restore a soft-deleted asset. Clears archived_at.
   * @security JWT required. Ownership enforced.
   */
  server.post('/studio/assets/:id/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data, error } = await supabase
        .from('content_assets')
        .update({ archived_at: null, updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .not('archived_at', 'is', null)
        .select('id, archived_at')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Asset not found or not archived' });

      return reply.send({ id: data.id, restored: true });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to restore asset' });
    }
  });

  /**
   * POST /studio/assets/:id/publish
   * Record a publishing target for a live channel.
   * Asset must be approved before publishing.
   * @security JWT required. Ownership enforced. Approval gate enforced (§1.5 CLAUDE.md).
   */
  server.post('/studio/assets/:id/publish', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = PublishBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const supabase = getSupabaseAdmin();

    try {
      // Ownership + approval gate
      const { data: asset, error: fetchErr } = await supabase
        .from('content_assets')
        .select('id, founder_id, status, approved_at')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !asset) return reply.status(404).send({ error: 'Asset not found' });

      // §1.5 Approve-Before-Post — hard server-side constraint
      if (!asset.approved_at) {
        return reply.status(422).send({ error: 'Asset must be approved before publishing' });
      }

      const { data: target, error: insertErr } = await supabase
        .from('publishing_targets')
        .insert({
          asset_id:     assetId,
          founder_id:   founderId,
          channel:      parsed.data.channel,
          platform_url: parsed.data.platformUrl ?? null,
          external_id:  parsed.data.externalId ?? null,
          published_by: founderId,
          status:       'live',
          metadata:     parsed.data.metadata ?? null,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Set published_at on the asset (first publish only)
      await supabase
        .from('content_assets')
        .update({ published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .is('published_at', null);

      return reply.status(201).send({ publishTarget: target });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to publish asset' });
    }
  });

  /**
   * GET /studio/stats
   * Generation stats: assets by type, status breakdown, token spend.
   * @security JWT required. Returns only current founder's stats.
   */
  server.get('/studio/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const supabase = getSupabaseAdmin();

    try {
      const [assetsRes, versionsRes, publishRes] = await Promise.all([
        supabase
          .from('content_assets')
          .select('asset_type, status, tokens_consumed, market, channel, archived_at')
          .eq('founder_id', founderId),
        supabase
          .from('content_versions')
          .select('id', { count: 'exact', head: true })
          .eq('changed_by', founderId),
        supabase
          .from('publishing_targets')
          .select('id, channel, status')
          .eq('founder_id', founderId),
      ]);

      const assets = assetsRes.data ?? [];
      const active = assets.filter(a => !a.archived_at);

      const byType = active.reduce<Record<string, number>>((acc, a) => {
        acc[a.asset_type] = (acc[a.asset_type] ?? 0) + 1;
        return acc;
      }, {});

      const byStatus = active.reduce<Record<string, number>>((acc, a) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1;
        return acc;
      }, {});

      const totalTokens = active.reduce((sum, a) => sum + (a.tokens_consumed ?? 0), 0);

      return reply.send({
        totalAssets:       active.length,
        archivedAssets:    assets.filter(a => a.archived_at).length,
        totalVersions:     versionsRes.count ?? 0,
        publishedCount:    (publishRes.data ?? []).filter(p => p.status === 'live').length,
        totalTokens,
        byType,
        byStatus,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });
}

export const studioRoutes = fp(studioPlugin);
