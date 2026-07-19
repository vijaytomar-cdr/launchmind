/**
 * @file channels.route.ts
 * @description Fastify routes for platform channel management: OAuth connect/disconnect,
 *   WhatsApp message sending, and Meta webhook ingestion.
 * @security
 *   - All routes except /channels/whatsapp/oauth/callback and /channels/whatsapp/webhook require JWT.
 *   - OAuth callback uses a short-lived `state` param (founderId) to associate the token;
 *     in production this must be a CSRF-proof signed state token — founderId here is a stub.
 *   - POST /channels/whatsapp/send checks campaigns.approved_at at route level;
 *     whatsappService.sendBroadcast() verifies it again as defence-in-depth.
 *   - POST /channels/whatsapp/webhook verifies X-Hub-Signature-256 BEFORE any processing.
 *   - GET /channels NEVER returns encrypted_token or kms_key_id.
 *   - DELETE /channels/:platform sets revoked_at (row preserved); does NOT DELETE DB row.
 * @dependencies platformTokenService, whatsappService, supabaseAdmin, Sentry
 */

import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import {
  storeToken,
  revokeToken,
  listConnectedPlatforms,
  SupportedPlatform,
} from '../services/platformTokenService';
import { sendBroadcast, handleReadReceipt } from '../services/whatsappService';
import { createUTMLink, getUTMLinks, trackClick } from '../services/utmService';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

const META_API_VERSION = 'v20.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const SendBroadcastBodySchema = z.object({
  campaignId: z.string().uuid(),
  phoneNumberId: z.string().min(1),
  recipientPhone: z.string().min(7),
  templateName: z.string().min(1),
  languageCode: z.string().default('en_US'),
  templateParams: z.array(z.string()).optional(),
});

const SUPPORTED_PLATFORMS = ['meta', 'google', 'whatsapp', 'linkedin', 'email'] as const;
const PlatformParamSchema = z.enum(SUPPORTED_PLATFORMS);

function getFounderId(request: FastifyRequest): string {
  const payload = request.user as { sub?: string };
  if (!payload?.sub) throw new Error('Invalid JWT: missing sub claim');
  return payload.sub;
}

/**
 * Verifies a Meta X-Hub-Signature-256 header against the raw request body.
 * @param rawBody     - Raw Buffer of the request body
 * @param signatureHeader - Value of x-hub-signature-256 header
 * @returns true if valid, false if missing or invalid
 * @security Uses timing-safe comparison to prevent timing attacks
 */
function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error('[channels] WHATSAPP_APP_SECRET not configured — webhook verification skipped');
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expectedSig = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

/**
 * Registers all /channels routes on the Fastify instance.
 * @param server - Fastify instance with JWT plugin registered
 */
export async function channelsRoutes(server: FastifyInstance): Promise<void> {
  // ── Raw body capture for webhook HMAC verification ────────────────────────
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 1_048_576 },
    function (_req, body, done) {
      (_req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        const parsed = JSON.parse((body as Buffer).toString());
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // ── JWT gate (skip OAuth callback and webhook — they use their own auth) ────
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0];
    const skipAuth =
      path === '/channels/whatsapp/oauth/callback' ||
      path === '/channels/whatsapp/webhook' ||
      path.startsWith('/r/');
    if (skipAuth) return;

    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * GET /channels/whatsapp/oauth/init
   * Returns the Meta OAuth URL for the founder to connect WhatsApp Business.
   * The `state` param encodes the founderId so the callback can associate the token.
   */
  server.get('/channels/whatsapp/oauth/init', async (request, reply) => {
    const founderId = getFounderId(request);
    const appId = process.env.WHATSAPP_APP_ID;
    const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

    if (!appId) return reply.status(503).send({ error: 'WhatsApp not configured' });

    const redirectUri = encodeURIComponent(`${apiBaseUrl}/channels/whatsapp/oauth/callback`);
    // state = founderId (production: use signed JWT state token for CSRF protection)
    const state = Buffer.from(founderId).toString('base64');
    const scope = 'whatsapp_business_messaging,whatsapp_business_management';

    const oauthUrl =
      `https://www.facebook.com/${META_API_VERSION}/dialog/oauth` +
      `?client_id=${appId}` +
      `&redirect_uri=${redirectUri}` +
      `&scope=${scope}` +
      `&state=${state}` +
      `&response_type=code`;

    return reply.send({ url: oauthUrl });
  });

  /**
   * GET /channels/whatsapp/oauth/callback
   * No JWT — Meta redirects here with an authorization code.
   * Exchanges the code for an access token, stores it encrypted, then redirects to dashboard.
   */
  server.get(
    '/channels/whatsapp/oauth/callback',
    async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply) => {
      const { code, state, error: oauthError } = request.query;

      if (oauthError) {
        return reply.redirect(
          `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/dashboard/channels?error=oauth_denied`
        );
      }

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state parameter' });
      }

      let founderId: string;
      try {
        founderId = Buffer.from(state, 'base64').toString('utf-8');
        if (!founderId || founderId.length < 10) throw new Error('Invalid state');
      } catch {
        return reply.status(400).send({ error: 'Invalid state parameter' });
      }

      const appId = process.env.WHATSAPP_APP_ID;
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

      if (!appId || !appSecret) {
        return reply.status(503).send({ error: 'WhatsApp not configured' });
      }

      try {
        const redirectUri = `${apiBaseUrl}/channels/whatsapp/oauth/callback`;
        const tokenRes = await fetch(
          `${META_GRAPH_BASE}/oauth/access_token` +
            `?client_id=${appId}` +
            `&client_secret=${appSecret}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&code=${code}`
        );

        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          throw new Error(`Meta token exchange failed: ${err}`);
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          token_type: string;
          expires_in?: number;
        };

        const expiresAt = tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          : undefined;

        await storeToken(
          founderId,
          'whatsapp',
          tokenData.access_token,
          ['whatsapp_business_messaging', 'whatsapp_business_management'],
          expiresAt
        );

        // Advance to step 3 (channel_connected)
        await getSupabaseAdmin()
          .from('founders')
          .update({ onboarding_step: 3, updated_at: new Date().toISOString() })
          .eq('id', founderId)
          .lt('onboarding_step', 3);

        return reply.redirect(
          `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/dashboard/channels?connected=whatsapp`
        );
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /channels/whatsapp/oauth/callback' } });
        return reply.redirect(
          `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/dashboard/channels?error=oauth_failed`
        );
      }
    }
  );

  /**
   * POST /channels/whatsapp/send
   * Sends a WhatsApp template broadcast for an approved campaign.
   * PRE-CHECK: campaigns.approved_at must be non-null — verified here AND in whatsappService.
   */
  server.post('/channels/whatsapp/send', async (request, reply) => {
    const founderId = getFounderId(request);

    const parsed = SendBroadcastBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
    }

    const { campaignId, phoneNumberId, recipientPhone, templateName, languageCode, templateParams } =
      parsed.data;

    // Route-level approved_at check (defence-in-depth: whatsappService checks again)
    const { data: campaign } = await getSupabaseAdmin()
      .from('campaigns')
      .select('approved_at, founder_id')
      .eq('id', campaignId)
      .single();

    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });
    if (campaign.founder_id !== founderId) return reply.status(403).send({ error: 'Forbidden' });
    if (!campaign.approved_at) {
      return reply.status(422).send({
        error: 'Campaign must be approved before sending',
        code: 'CAMPAIGN_NOT_APPROVED',
      });
    }

    try {
      const result = await sendBroadcast({
        campaignId,
        founderId,
        phoneNumberId,
        recipientPhone,
        templateName,
        languageCode,
        templateParams,
      });
      return reply.send({ success: true, messageId: result.messageId });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /channels/whatsapp/send' } });
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  /**
   * GET /channels/whatsapp/webhook
   * Meta webhook verification endpoint (hub challenge).
   * No JWT — Meta sends this during webhook registration.
   */
  server.get(
    '/channels/whatsapp/webhook',
    async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply) => {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      if (mode === 'subscribe' && token === verifyToken) {
        return reply.status(200).send(challenge);
      }
      return reply.status(403).send({ error: 'Verification failed' });
    }
  );

  /**
   * POST /channels/whatsapp/webhook
   * Receives Meta webhook events (messages, status updates, read receipts).
   * X-Hub-Signature-256 verified BEFORE any processing.
   */
  server.post('/channels/whatsapp/webhook', async (request, reply) => {
    const sig = request.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;

    if (!rawBody) return reply.status(400).send({ error: 'Missing raw body' });
    if (!verifyMetaSignature(rawBody, sig)) {
      return reply.status(401).send({ error: 'Invalid webhook signature' });
    }

    try {
      const payload = request.body as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              statuses?: Array<{
                id: string;
                status: string;
                timestamp: string;
                recipient_id: string;
                conversation?: { id: string };
              }>;
            };
          }>;
        }>;
      };

      // Process read receipts
      const statuses = payload.entry?.[0]?.changes?.[0]?.value?.statuses ?? [];
      for (const status of statuses) {
        if (status.status === 'read' && status.conversation?.id) {
          // Look up campaign by external_campaign_id (conversation.id mapped at send time)
          const { data: campaign } = await getSupabaseAdmin()
            .from('campaigns')
            .select('id')
            .eq('external_campaign_id', status.conversation.id)
            .single();

          if (campaign) {
            await handleReadReceipt({
              campaignId: campaign.id,
              messageId: status.id,
              recipientPhone: status.recipient_id,
              timestamp: status.timestamp,
            });
          }
        }
      }

      return reply.send({ received: true });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /channels/whatsapp/webhook' } });
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }
  });

  /**
   * GET /channels
   * Lists all connected platforms for the authenticated founder.
   * NEVER returns encrypted_token or kms_key_id.
   */
  server.get('/channels', async (request, reply) => {
    const founderId = getFounderId(request);

    try {
      const platforms = await listConnectedPlatforms(founderId);
      return reply.send({ channels: platforms });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /channels' } });
      return reply.status(500).send({ error: 'Failed to list channels' });
    }
  });

  /**
   * DELETE /channels/:platform
   * Revokes a platform token by setting revoked_at. Row is preserved for audit.
   * Callers should disconnect the platform on their end before calling this endpoint.
   */
  server.delete(
    '/channels/:platform',
    async (request: FastifyRequest<{ Params: { platform: string } }>, reply) => {
      const founderId = getFounderId(request);

      const parsed = PlatformParamSchema.safeParse(request.params.platform);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid platform', validPlatforms: SUPPORTED_PLATFORMS });
      }

      try {
        await revokeToken(founderId, parsed.data as SupportedPlatform);
        return reply.send({ success: true, platform: parsed.data, revokedAt: new Date().toISOString() });
      } catch (err) {
        if (err instanceof Error && err.message.includes('No') && err.message.includes('found')) {
          return reply.status(404).send({ error: err.message });
        }
        Sentry.captureException(err, { tags: { route: 'DELETE /channels/:platform' } });
        return reply.status(500).send({ error: 'Failed to revoke channel' });
      }
    }
  );

  // ── UTM Tracking Routes ────────────────────────────────────────────────────

  const CreateUTMLinkBodySchema = z.object({
    baseUrl: z.string().url(),
    utmSource: z.string().min(1).max(100),
    utmMedium: z.string().min(1).max(100),
    utmCampaign: z.string().min(1).max(100),
    utmContent: z.string().max(200).optional(),
    utmTerm: z.string().max(200).optional(),
  });

  /**
   * POST /campaigns/:id/utm-link
   * Creates a UTM-tagged tracking link for a campaign.
   * Returns the link record including the short redirect URL.
   * @security JWT required. Campaign ownership verified in utmService.createUTMLink.
   */
  server.post<{ Params: { id: string } }>(
    '/campaigns/:id/utm-link',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id: campaignId } = request.params;

      if (!z.string().uuid().safeParse(campaignId).success) {
        return reply.status(400).send({ error: 'Invalid campaign ID' });
      }

      const parsed = CreateUTMLinkBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', detail: parsed.error.message });
      }

      try {
        const link = await createUTMLink(campaignId, founderId, parsed.data.baseUrl, {
          source: parsed.data.utmSource,
          medium: parsed.data.utmMedium,
          campaign: parsed.data.utmCampaign,
          content: parsed.data.utmContent,
          term: parsed.data.utmTerm,
        });
        const baseApiUrl = process.env.API_URL ?? 'http://localhost:3001';
        return reply.status(201).send({
          ...link,
          shortUrl: `${baseApiUrl}/r/${link.shortCode}`,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({ error: err.message });
        }
        Sentry.captureException(err, { tags: { route: 'POST /campaigns/:id/utm-link' } });
        return reply.status(500).send({ error: 'Failed to create UTM link' });
      }
    }
  );

  /**
   * GET /campaigns/:id/utm-links
   * Lists all UTM tracking links for a campaign.
   * @security JWT required. Only returns links belonging to the authenticated founder.
   */
  server.get<{ Params: { id: string } }>(
    '/campaigns/:id/utm-links',
    async (request, reply) => {
      const founderId = getFounderId(request);
      const { id: campaignId } = request.params;

      if (!z.string().uuid().safeParse(campaignId).success) {
        return reply.status(400).send({ error: 'Invalid campaign ID' });
      }

      try {
        const links = await getUTMLinks(campaignId, founderId);
        const baseApiUrl = process.env.API_URL ?? 'http://localhost:3001';
        return reply.send({
          links: links.map((l) => ({ ...l, shortUrl: `${baseApiUrl}/r/${l.shortCode}` })),
        });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /campaigns/:id/utm-links' } });
        return reply.status(500).send({ error: 'Failed to fetch UTM links' });
      }
    }
  );

  /**
   * GET /r/:code
   * Public redirect endpoint. Increments click count and redirects to the full UTM URL.
   * Returns 404 if the short code is not found.
   * @security Public — no auth required. Only increments click_count; no PII stored.
   */
  server.get<{ Params: { code: string } }>(
    '/r/:code',
    async (request, reply) => {
      const { code } = request.params;

      if (!/^[A-Za-z0-9_-]{6,12}$/.test(code)) {
        return reply.status(400).send({ error: 'Invalid short code' });
      }

      try {
        const destination = await trackClick(code);
        if (!destination) {
          return reply.status(404).send({ error: 'Short link not found' });
        }
        return reply.redirect(destination, 302);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /r/:code' } });
        return reply.status(500).send({ error: 'Redirect failed' });
      }
    }
  );

  // ── Integration framework: GA4, Firebase, Search Console, Website (ADR-014) ──

  const ConnectApiKeySchema = z.object({
    api_key:            z.string().min(1),
    integration_config: z.record(z.unknown()).default({}),
  });

  const ConnectWebsiteSchema = z.object({
    url: z.string().url(),
  });

  /**
   * POST /integrations/ga4
   * Connects a Google Analytics 4 property via API key.
   * Body: { api_key: string, integration_config: { propertyId: string, measurementId?: string } }
   */
  server.post(
    '/integrations/ga4',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      const parsed = ConnectApiKeySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }

      try {
        const { connectApiKeyIntegration } = await import('../services/integrationService');
        const result = await connectApiKeyIntegration({
          founderId,
          platform:          'ga4',
          apiKey:            parsed.data.api_key,
          integrationConfig: parsed.data.integration_config,
        });
        return reply.status(201).send({ integration: { id: result.id, platform: 'ga4' } });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /integrations/ga4' } });
        return reply.status(500).send({ error: 'Failed to connect GA4' });
      }
    }
  );

  /**
   * POST /integrations/firebase
   * Connects a Firebase project via service account key.
   * Body: { api_key: string, integration_config: { projectId: string, appId?: string } }
   */
  server.post(
    '/integrations/firebase',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      const parsed = ConnectApiKeySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }

      try {
        const { connectApiKeyIntegration } = await import('../services/integrationService');
        const result = await connectApiKeyIntegration({
          founderId,
          platform:          'firebase',
          apiKey:            parsed.data.api_key,
          integrationConfig: parsed.data.integration_config,
          scopes:            ['firebase.read'],
        });
        return reply.status(201).send({ integration: { id: result.id, platform: 'firebase' } });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /integrations/firebase' } });
        return reply.status(500).send({ error: 'Failed to connect Firebase' });
      }
    }
  );

  /**
   * POST /integrations/website
   * Connects a website URL (url_only — no credentials needed).
   * Body: { url: string }
   */
  server.post(
    '/integrations/website',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      const parsed = ConnectWebsiteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }

      try {
        const { connectUrlIntegration } = await import('../services/integrationService');
        const result = await connectUrlIntegration({ founderId, url: parsed.data.url });
        return reply.status(201).send({ integration: { id: result.id, platform: 'website' } });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /integrations/website' } });
        return reply.status(500).send({ error: 'Failed to connect website' });
      }
    }
  );

  /**
   * GET /integrations
   * Lists all integration statuses for the authenticated founder.
   * NEVER returns encrypted_token or kms_key_id.
   */
  server.get(
    '/integrations',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      try {
        const { listIntegrations } = await import('../services/integrationService');
        const integrations = await listIntegrations(founderId);
        return reply.send({ integrations });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /integrations' } });
        return reply.status(500).send({ error: 'Failed to list integrations' });
      }
    }
  );

  /**
   * DELETE /integrations/:platform
   * Disconnects an integration (sets revoked_at — row preserved for audit).
   */
  server.delete<{ Params: { platform: string } }>(
    '/integrations/:platform',
    async (request: FastifyRequest<{ Params: { platform: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      const validPlatforms = ['ga4', 'firebase', 'search_console', 'website', 'meta', 'google', 'whatsapp', 'linkedin', 'email'];
      if (!validPlatforms.includes(request.params.platform)) {
        return reply.status(400).send({ error: 'Invalid platform' });
      }

      try {
        const { disconnectIntegration } = await import('../services/integrationService');
        await disconnectIntegration(founderId, request.params.platform as Parameters<typeof disconnectIntegration>[1]);
        return reply.status(204).send();
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'DELETE /integrations/:platform' } });
        return reply.status(500).send({ error: 'Failed to disconnect integration' });
      }
    }
  );
}
