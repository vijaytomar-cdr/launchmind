/**
 * @file settings.route.ts
 * @description Founder settings routes for content preferences and voice clone.
 *   POST   /settings/content-preferences — update products.content_preferences
 *   POST   /settings/voice-clone         — accept base64 MP3, create ElevenLabs clone
 *   DELETE /settings/voice-clone         — remove voice clone (set voice_clone_id to null)
 * @security JWT required. All writes scoped to authenticated founder only.
 *   Voice clone: base64 audio in JSON body, max ~10 MB decoded.
 * @dependencies elevenLabsClient, supabaseAdmin
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { createVoiceClone } from '../lib/elevenLabsClient';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

const ContentPreferencesBodySchema = z.object({
  productId:   z.string().uuid(),
  preferences: z.object({
    text: z.object({
      whatsapp:  z.boolean().optional(),
      meta:      z.boolean().optional(),
      google:    z.boolean().optional(),
      linkedin:  z.boolean().optional(),
      email:     z.boolean().optional(),
      aso:       z.boolean().optional(),
    }).optional(),
    video: z.object({
      reels30s:          z.boolean().optional(),
      shorts60s:         z.boolean().optional(),
      appStorePreview:   z.boolean().optional(),
      whatsappVoiceNote: z.boolean().optional(),
    }).optional(),
    visual: z.object({
      carousels: z.boolean().optional(),
      staticAds: z.boolean().optional(),
    }).optional(),
    community: z.object({
      redditPosts:  z.boolean().optional(),
      quoraAnswers: z.boolean().optional(),
    }).optional(),
    socialProof: z.object({
      tweetThreads: z.boolean().optional(),
      g2Reviews:    z.boolean().optional(),
    }).optional(),
  }),
});

const VoiceCloneBodySchema = z.object({
  // base64-encoded MP3 audio (60-second sample). Max ~13 MB base64 ≈ 10 MB decoded.
  audioBase64: z.string().min(100).max(14_000_000),
});

export async function settingsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /settings/content-preferences
   * Updates content_preferences JSONB on a product. Merges with existing prefs.
   * Body: { productId: string, preferences: ContentPreferences }
   * @security founderId verified against product ownership.
   */
  server.post('/settings/content-preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = ContentPreferencesBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
    }
    const { productId, preferences } = parsed.data;

    const supabase = getSupabaseAdmin();

    // Fetch current prefs and verify ownership
    const { data: product } = await supabase
      .from('products')
      .select('founder_id, content_preferences')
      .eq('id', productId)
      .eq('founder_id', founderId)
      .single();

    if (!product) return reply.status(404).send({ error: 'Product not found' });

    // Deep merge with existing preferences
    const merged = { ...(product.content_preferences as object ?? {}), ...preferences };

    try {
      const { error } = await supabase
        .from('products')
        .update({ content_preferences: merged, updated_at: new Date().toISOString() })
        .eq('id', productId);

      if (error) throw error;
      return reply.send({ preferences: merged });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /settings/content-preferences' } });
      return reply.status(500).send({ error: 'Failed to update content preferences' });
    }
  });

  /**
   * POST /settings/voice-clone
   * Decodes a base64 MP3, creates an ElevenLabs voice clone, saves voice_clone_id.
   * Body: { audioBase64: string }
   * @security ELEVENLABS_API_KEY required. voice_clone_id stored on founders row.
   */
  server.post('/settings/voice-clone', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = VoiceCloneBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = Buffer.from(parsed.data.audioBase64, 'base64');
    } catch {
      return reply.status(400).send({ error: 'Invalid base64 audio data' });
    }

    // 10 MB hard limit on decoded size
    if (audioBuffer.length > 10 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Audio file exceeds 10 MB limit' });
    }

    // Fetch founder name for the ElevenLabs clone label
    const { data: founder } = await getSupabaseAdmin()
      .from('founders')
      .select('name')
      .eq('id', founderId)
      .single();

    const founderName = founder?.name ?? 'Founder';

    try {
      const voiceId = await createVoiceClone(audioBuffer, founderName);

      await getSupabaseAdmin()
        .from('founders')
        .update({ voice_clone_id: voiceId })
        .eq('id', founderId);

      await getSupabaseAdmin().from('audit_logs').insert({
        founder_id: founderId,
        action: 'voice_clone_created',
        resource_type: 'founder',
        metadata: { voiceId },
      });

      return reply.status(201).send({ voiceCloneId: voiceId });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /settings/voice-clone' } });
      const msg = err instanceof Error ? err.message : 'Failed to create voice clone';
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * DELETE /settings/voice-clone
   * Sets founders.voice_clone_id to null. Does not delete the clone from ElevenLabs.
   */
  server.delete('/settings/voice-clone', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    try {
      const { error } = await getSupabaseAdmin()
        .from('founders')
        .update({ voice_clone_id: null })
        .eq('id', founderId);

      if (error) throw error;

      await getSupabaseAdmin().from('audit_logs').insert({
        founder_id: founderId,
        action: 'voice_clone_removed',
        resource_type: 'founder',
        metadata: {},
      });

      return reply.status(204).send();
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'DELETE /settings/voice-clone' } });
      return reply.status(500).send({ error: 'Failed to remove voice clone' });
    }
  });
}
