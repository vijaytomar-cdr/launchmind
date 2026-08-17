/**
 * @file channels.route.ts
 * @description Fastify routes for platform channel management: OAuth connect/disconnect,
 *   WhatsApp message sending, and Meta webhook ingestion.
 * @security
 *   - All routes except /channels/whatsapp/oauth/callback and /channels/whatsapp/webhook require JWT.
 *   - OAuth `state` param is HMAC-SHA256-signed with OAUTH_STATE_SECRET (or SUPABASE_JWT_SECRET
 *     as fallback). verifyOAuthState() validates the signature before trusting the founderId.
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
  listConnections,
  getConnection,
  previewConnection,
  authorizeConnection,
  beginReauthorization,
  listProviderAccounts,
  selectResource,
  triggerSync,
  getSyncRuns,
  getConnectionHealth,
  disconnectConnection,
  getLatestSyncRun,
} from '../services/connectionService';
import { InvalidTransitionError } from '../services/connectionStateMachine';
import { ProviderError } from '../services/providers/types';
import { hasAdapter, isKnownProvider, availableProviders, getAdapter } from '../services/providers/registry';
import { enqueueConnectionSync } from '../workers/connectionSyncWorker';
import { traceIdFromRequest } from '../lib/traceId';
import { resolveMetaAppCredentials } from '../services/providers/metaCredentials';
import { isCredentialVaultUnavailable } from '../lib/vaultError';
import {
  resolveWorkspaceContext,
  assertConnectionInWorkspace,
  requireWorkspaceWrite,
  WorkspaceAccessError,
  WorkspacePermissionError,
  requireWorkspaceRole,
  type WorkspaceContext,
} from '../services/workspaceAuthService';
import {
  getEffectivePermissions,
  getPermissionHistory,
  requestAuthorityUpgrade,
  approveAuthorityUpgrade,
  denyAuthorityUpgrade,
  downgradeAuthority,
  AuthorityError,
  PERMISSION_LEVELS,
  EXECUTION_PERMISSIONS,
} from '../services/connectionPermissionService';
import {
  CredentialError,
  AccountSubstitutionError,
} from '../services/connectionCredentialService';
import {
  assertExecutionAllowed,
  describeExecutionBoundary,
  ExecutionBlockedError,
} from '../services/connectionExecutionGuard';
import {
  createAuthorizationRequest,
  consumeAuthorizationRequest,
  exchangeAuthorizationCode,
  OAuthError,
} from '../services/oauthService';
import { getOAuthProviderConfig } from '../services/providers/oauthConfig';
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

// ── OAuth state helpers (HMAC-signed to prevent CSRF) ──────────────────────────

/**
 * Creates an HMAC-signed OAuth state token embedding the founderId.
 * Format: base64(founderId).HMAC-SHA256(base64(founderId))
 * The HMAC key is OAUTH_STATE_SECRET (falls back to SUPABASE_JWT_SECRET for convenience).
 */
function createOAuthState(founderId: string): string {
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.SUPABASE_JWT_SECRET ?? 'dev-fallback-secret';
  const payload = Buffer.from(founderId).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/**
 * Verifies an HMAC-signed OAuth state token and extracts the founderId.
 * Returns null if the token is invalid, expired, or tampered with.
 */
function verifyOAuthState(state: string): string | null {
  try {
    const [payload, sig] = state.split('.');
    if (!payload || !sig) return null;
    const secret = process.env.OAUTH_STATE_SECRET ?? process.env.SUPABASE_JWT_SECRET ?? 'dev-fallback-secret';
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    const founderId = Buffer.from(payload, 'base64url').toString('utf-8');
    if (!founderId || founderId.length < 10) return null;
    return founderId;
  } catch {
    return null;
  }
}
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
      // Provider OAuth callback: the browser arrives from the provider with no
      // Authorization header. Authorization comes from the single-use server-side
      // state, which also re-verifies workspace membership.
      path === '/connections/oauth/callback' ||
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
    const state = createOAuthState(founderId);
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

      const founderId = verifyOAuthState(state);
      if (!founderId) {
        return reply.status(400).send({ error: 'Invalid or tampered state parameter' });
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
   * GET /integrations/connections
   * Returns Phase 2 Capability Unlock connection status for all sources.
   * Used by the Channels page to show connected/not-connected state per card.
   */
  server.get(
    '/integrations/connections',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      try {
        const { getPhase2Connections } = await import('../services/integrationService');
        const connections = await getPhase2Connections(founderId);
        return reply.send({ connections });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /integrations/connections' } });
        return reply.status(500).send({ error: 'Failed to fetch connections' });
      }
    }
  );

  /**
   * GET /integrations/capability-status
   * Returns full Growth Brain capability status: level, confidence, milestone states,
   * active goal, roadmap statuses, proof checks, and connection state.
   * Single endpoint replaces all hardcoded values on the Capability Unlocks page.
   * Sub-queries use Promise.allSettled — partial DB failures degrade to safe defaults.
   */
  server.get(
    '/integrations/capability-status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      try {
        const { getCapabilityStatus } = await import('../services/integrationService');
        const status = await getCapabilityStatus(founderId);
        return reply.send({ status });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /integrations/capability-status' } });
        return reply.status(500).send({ error: 'Failed to fetch capability status' });
      }
    }
  );

  /**
   * GET /intelligence/coverage
   * Returns Growth Brain dimension scores and recommended next source.
   * Powers the brain-intelligence-card on the Growth Brain page and the
   * recommended-source card on the Improve Intelligence page.
   */
  server.get(
    '/intelligence/coverage',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      try {
        // Coverage reads workspace-scoped connections, so it needs a verified context.
        const header = request.headers['x-launchmind-workspace-id'];
        const hint = Array.isArray(header) ? header[0] : header;
        const ctx = await resolveWorkspaceContext(
          (request.user as { sub: string }).sub,
          typeof hint === 'string' && hint ? hint : undefined,
        );
        const { getGrowthBrainCoverage } = await import('../services/intelligenceService');
        const coverage = await getGrowthBrainCoverage(ctx);
        return reply.send({ ok: true, data: coverage, workspaceId: ctx.workspaceId });
      } catch (err) {
        if (err instanceof WorkspaceAccessError) {
          return reply.status(404).send({ ok: false, error: 'Not found', code: err.code });
        }
        Sentry.captureException(err, { tags: { route: 'GET /intelligence/coverage' } });
        return reply.status(500).send({ ok: false, error: 'Failed to compute coverage' });
      }
    }
  );

  /**
   * GET /intelligence/learning-log
   *
   * The full learning history behind "View learning log →" (spec §4.3). Returns every
   * recorded change to what LaunchMind believes — not just the most recent one, which
   * is all `coverage.lastLearning` ever carried.
   *
   * @query limit     - 1–100, default 20
   * @query before    - ISO timestamp cursor for the next page
   * @query productId - optional filter
   * @returns { entries, nextCursor }
   * @security Workspace-scoped. A workspace header is a hint only; membership is verified.
   */
  /**
   * GET /intelligence/recommendations — Phase 3.3C.
   *
   * 1–3 grounded recommendations for the ACTIVE business, with owner-facing
   * provenance. Uses the same verified workspace context as /coverage, and the
   * product that workspace actually owns — never a client-supplied id and never
   * "the founder's newest product".
   */
  server.get(
    '/intelligence/recommendations',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      try {
        const header = request.headers['x-launchmind-workspace-id'];
        const hint = Array.isArray(header) ? header[0] : header;
        const founderId = (request.user as { sub: string }).sub;
        const ctx = await resolveWorkspaceContext(founderId, typeof hint === 'string' && hint ? hint : undefined);

        // The product is derived FROM the verified workspace.
        const { data: prod } = await getSupabaseAdmin()
          .from('products').select('id, category, markets')
          .eq('workspace_id', ctx.workspaceId)
          .is('archived_at', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        const productId = (prod as { id?: string } | null)?.id ?? null;

        // Market intelligence counts as AVAILABLE only when a real benchmark
        // resolves for this product's own category/market. It is never assumed,
        // and an absent cohort reports false rather than borrowing another's.
        let marketIntelligenceAvailable = false;
        const category = (prod as { category?: string | null } | null)?.category ?? null;
        if (category) {
          try {
            const { getBenchmarks } = await import('../services/intelligenceNetworkService');
            const markets = ((prod as { markets?: string[] | null } | null)?.markets ?? []);
            const market = markets[0]?.includes('india') ? 'india' : 'usa';
            marketIntelligenceAvailable = (await getBenchmarks(category, market)) != null;
          } catch { marketIntelligenceAvailable = false; }
        }

        const { generateGrowthBrainRecommendations } = await import('../services/growthBrainRecommendationService');
        const result = await generateGrowthBrainRecommendations({
          workspaceId: ctx.workspaceId, founderId, productId, marketIntelligenceAvailable,
        });

        // Phase 3.3D: persist so each recommendation has SERVER identity the
        // owner can act on. Upsert by fingerprint, so a refresh reuses the row
        // and any decision already made on it survives.
        const { persistRecommendations, listRecommendationDecisions } =
          await import('../services/growthBrainDecisionService');
        const persisted = await persistRecommendations(
          { workspaceId: ctx.workspaceId, founderId, productId }, result.recommendations);
        const byFingerprint = new Map(persisted.map(p => [`${p.actionType}::${p.what}`, p]));

        // A regenerated snapshot that asks for an already-settled decision must
        // not come back as a fresh card. It carries the SETTLED state instead,
        // so the owner sees "Approved" rather than being asked again — the
        // measured P0. Its own row still exists for audit.
        const decidedById = new Map(
          (await listRecommendationDecisions(
            { workspaceId: ctx.workspaceId, productId }, 50)).map(d => [d.id, d]));

        const withIdentity = result.recommendations.map(r => {
          const row = byFingerprint.get(`${r.actionType}::${r.what}`);
          if (!row) return r;
          const settled = row.supersededByDecisionId
            ? decidedById.get(row.supersededByDecisionId) ?? null
            : null;
          const state = settled ?? row;
          return {
            ...r,
            id: row.id,
            decisionStatus: state.decisionStatus,
            executionStatus: state.executionStatus,
            requiresApproval: row.requiresApproval,
            requiresFounderReview: row.founderReviewRequired,
            // Owner-facing marker: this action was already decided, on an
            // earlier wording of the same recommendation.
            actionAlreadyDecided: settled !== null,
            decidedRecommendationId: settled?.id ?? null,
          };
        });

        return reply.send({
          ok: true,
          data: { ...result, recommendations: withIdentity },
          workspaceId: ctx.workspaceId,
        });
      } catch (err) {
        if (err instanceof WorkspaceAccessError) {
          return reply.status(404).send({ ok: false, error: 'Not found', code: err.code });
        }
        Sentry.captureException(err, { tags: { route: 'GET /intelligence/recommendations' } });
        return reply.status(500).send({ ok: false, error: 'Failed to generate recommendations' });
      }
    },
  );

  /**
   * POST /intelligence/recommendations/:id/decision — Phase 3.3D.
   *
   * The owner decides. The body carries ONLY a verb and an optional
   * acknowledgement/note — never the recommendation's text, action type,
   * approval requirement, authority or provenance. Everything a reader would
   * treat as authority is re-read from the row the server wrote.
   *
   * @security Business scope comes from the verified workspace context. A
   *   recommendation belonging to another workspace resolves to 404, which is
   *   also what a nonexistent id returns — so the response cannot be used to
   *   discover that another business's recommendation exists.
   */
  server.post<{ Params: { id: string } }>(
    '/intelligence/recommendations/:id/decision',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      try {
        const header = request.headers['x-launchmind-workspace-id'];
        const hint = Array.isArray(header) ? header[0] : header;
        const founderId = (request.user as { sub: string }).sub;
        const ctx = await resolveWorkspaceContext(founderId, typeof hint === 'string' && hint ? hint : undefined);

        // AUTHORIZATION. An owner decision is not a generic workspace edit:
        // it authorises future action on the business. Editors and viewers may
        // read Growth Brain but may not decide. Enforced HERE, before any
        // service-role write, using the canonical role utility.
        requireWorkspaceRole(ctx, 'admin');

        // The product is resolved from the VERIFIED workspace, never taken from
        // the client. Workspace alone was insufficient — one workspace can hold
        // several products, so B's recommendation was mutable from A's context.
        const { data: activeProd } = await getSupabaseAdmin()
          .from('products').select('id')
          .eq('workspace_id', ctx.workspaceId)
          .is('archived_at', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        const decisionProductId = (activeProd as { id?: string } | null)?.id ?? null;

        const body = (request.body ?? {}) as Record<string, unknown>;
        const { DECISION_ACTIONS, decideRecommendation, DecisionError } =
          await import('../services/growthBrainDecisionService');
        const action = String(body.action ?? '').toUpperCase();
        if (!(DECISION_ACTIONS as readonly string[]).includes(action)) {
          return reply.status(400).send({ ok: false, error: 'Invalid action', code: 'INVALID_ACTION' });
        }

        try {
          const updated = await decideRecommendation(
            { workspaceId: ctx.workspaceId, founderId, productId: decisionProductId },
            request.params.id,
            action as (typeof DECISION_ACTIONS)[number],
            {
              acknowledgeFounderConflict: body.acknowledgeFounderConflict === true,
              note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined,
            },
          );
          return reply.send({ ok: true, data: updated, workspaceId: ctx.workspaceId });
        } catch (e) {
          if (e instanceof DecisionError) {
            return reply.status(e.statusCode).send({ ok: false, error: e.message, code: e.code });
          }
          throw e;
        }
      } catch (err) {
        if (err instanceof WorkspaceAccessError) {
          return reply.status(404).send({ ok: false, error: 'Not found', code: err.code });
        }
        if (err instanceof WorkspacePermissionError) {
          return reply.status(403).send({ ok: false, error: err.message, code: 'INSUFFICIENT_ROLE' });
        }
        Sentry.captureException(err, { tags: { route: 'POST /intelligence/recommendations/:id/decision' } });
        return reply.status(500).send({ ok: false, error: 'Decision could not be saved' });
      }
    },
  );

  /** GET /intelligence/recommendations/decisions — recent decisions, this business only. */
  server.get(
    '/intelligence/recommendations/decisions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      try {
        const header = request.headers['x-launchmind-workspace-id'];
        const hint = Array.isArray(header) ? header[0] : header;
        const ctx = await resolveWorkspaceContext(
          (request.user as { sub: string }).sub,
          typeof hint === 'string' && hint ? hint : undefined);
        const { listRecommendationDecisions } = await import('../services/growthBrainDecisionService');
        return reply.send({ ok: true, data: await listRecommendationDecisions(ctx), workspaceId: ctx.workspaceId });
      } catch (err) {
        if (err instanceof WorkspaceAccessError) {
          return reply.status(404).send({ ok: false, error: 'Not found', code: err.code });
        }
        Sentry.captureException(err, { tags: { route: 'GET /intelligence/recommendations/decisions' } });
        return reply.status(500).send({ ok: false, error: 'Failed to load decisions' });
      }
    },
  );

  server.get<{ Querystring: { limit?: string; before?: string; productId?: string } }>(
    '/intelligence/learning-log',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; before?: string; productId?: string } }>,
      reply: FastifyReply,
    ) => {
      await request.jwtVerify();

      const QuerySchema = z.object({
        limit:     z.coerce.number().int().min(1).max(100).optional(),
        // Rejected rather than coerced: a malformed cursor silently returning page 1
        // would look like "the log ended" to the owner.
        before:    z.string().datetime({ offset: true }).optional(),
        productId: z.string().uuid().optional(),
      });

      const parsed = QuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid query', code: 'VALIDATION_ERROR' });
      }

      try {
        const header = request.headers['x-launchmind-workspace-id'];
        const hint = Array.isArray(header) ? header[0] : header;
        const ctx = await resolveWorkspaceContext(
          (request.user as { sub: string }).sub,
          typeof hint === 'string' && hint ? hint : undefined,
        );

        const { listLearningEvents } = await import('../services/growthBrainLearningService');
        const result = await listLearningEvents(ctx, {
          limit:     parsed.data.limit,
          before:    parsed.data.before,
          productId: parsed.data.productId,
        });

        return reply.send({ ok: true, data: result });
      } catch (err) {
        if (err instanceof WorkspaceAccessError) {
          return reply.status(404).send({ ok: false, error: 'Not found', code: err.code });
        }
        Sentry.captureException(err, { tags: { route: 'GET /intelligence/learning-log' } });
        return reply.status(500).send({ ok: false, error: 'Failed to read the learning log' });
      }
    },
  );

  const ConnectAppStoreSchema = z.object({
    api_key:     z.string().min(1),
    issuer_id:   z.string().min(1).optional(),
    key_id:      z.string().min(1).optional(),
  });

  /**
   * POST /integrations/app-store-connect
   * Connects App Store Connect via API key (read-only reporting access).
   * Body: { api_key: string, issuer_id?: string, key_id?: string }
   */
  server.post(
    '/integrations/app-store-connect',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      const parsed = ConnectAppStoreSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }

      try {
        const { connectApiKeyIntegration } = await import('../services/integrationService');
        const result = await connectApiKeyIntegration({
          founderId,
          platform:          'app_store_connect',
          apiKey:            parsed.data.api_key,
          integrationConfig: {
            issuer_id: parsed.data.issuer_id ?? null,
            key_id:    parsed.data.key_id ?? null,
          },
          scopes: ['app_store_connect.read'],
        });
        return reply.status(201).send({ integration: { id: result.id, platform: 'app_store_connect' } });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /integrations/app-store-connect' } });
        return reply.status(500).send({ error: 'Failed to connect App Store Connect' });
      }
    }
  );

  const ConnectRevenueCatSchema = z.object({
    api_key: z.string().min(1),
    app_id:  z.string().min(1).optional(),
  });

  /**
   * POST /integrations/revenue-cat
   * Connects RevenueCat via secret API key (read-only revenue and subscription data).
   * Body: { api_key: string, app_id?: string }
   */
  server.post(
    '/integrations/revenue-cat',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = (request.user as { sub: string }).sub;

      const parsed = ConnectRevenueCatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }

      try {
        const { connectApiKeyIntegration } = await import('../services/integrationService');
        const result = await connectApiKeyIntegration({
          founderId,
          platform:          'revenue_cat',
          apiKey:            parsed.data.api_key,
          integrationConfig: { app_id: parsed.data.app_id ?? null },
          scopes: ['revenue_cat.read'],
        });
        return reply.status(201).send({ integration: { id: result.id, platform: 'revenue_cat' } });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /integrations/revenue-cat' } });
        return reply.status(500).send({ error: 'Failed to connect RevenueCat' });
      }
    }
  );

  /**
   * GET /integrations/google-ads/oauth/init
   * Returns the Google Ads OAuth URL. Gated — requires campaign launch setup.
   * Connect at campaign launch, not during Phase 2 Capability Unlocks.
   */
  server.get(
    '/integrations/google-ads/oauth/init',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
      const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

      if (!clientId) {
        return reply.status(503).send({ error: 'Google Ads OAuth not configured', code: 'NOT_CONFIGURED' });
      }

      const redirectUri = encodeURIComponent(`${apiBaseUrl}/integrations/google-ads/oauth/callback`);
      const state = Buffer.from(founderId).toString('base64');
      const scope = encodeURIComponent('https://www.googleapis.com/auth/adwords');

      return reply.send({
        url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}&access_type=offline`,
      });
    }
  );

  /**
   * GET /integrations/google-ads/oauth/callback
   * No JWT — Google redirects here after authorization.
   */
  server.get(
    '/integrations/google-ads/oauth/callback',
    async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply) => {
      const { code, state, error: oauthError } = request.query;
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:3000';

      if (oauthError || !code || !state) {
        return reply.redirect(`${appBase}/dashboard/channels?error=google_ads_oauth_failed`);
      }

      const founderId = verifyOAuthState(state);
      if (!founderId) {
        return reply.status(400).send({ error: 'Invalid or tampered state parameter' });
      }

      const clientId     = process.env.GOOGLE_ADS_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
      const apiBaseUrl   = process.env.API_BASE_URL ?? 'http://localhost:3001';

      if (!clientId || !clientSecret) {
        return reply.redirect(`${appBase}/dashboard/channels?error=google_ads_not_configured`);
      }

      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id:     clientId,
            client_secret: clientSecret,
            redirect_uri:  `${apiBaseUrl}/integrations/google-ads/oauth/callback`,
            grant_type:    'authorization_code',
          }).toString(),
        });

        if (!tokenRes.ok) throw new Error('Token exchange failed');
        const tokenData = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number };

        const { connectApiKeyIntegration } = await import('../services/integrationService');
        await connectApiKeyIntegration({
          founderId,
          platform:          'google_ads',
          apiKey:            tokenData.refresh_token ?? tokenData.access_token,
          integrationConfig: { token_type: 'oauth', has_refresh_token: !!tokenData.refresh_token },
          scopes: ['adwords'],
        });

        return reply.redirect(`${appBase}/dashboard/channels?connected=google_ads`);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /integrations/google-ads/oauth/callback' } });
        return reply.redirect(`${appBase}/dashboard/channels?error=google_ads_oauth_failed`);
      }
    }
  );

  /**
   * GET /integrations/meta-ads/oauth/init
   * Returns the Meta Ads OAuth URL. Gated — requires campaign launch setup.
   */
  server.get(
    '/integrations/meta-ads/oauth/init',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      // Canonical resolution. The previous `META_ADS_APP_ID ?? WHATSAPP_APP_ID`
      // fallback silently ran Meta Ads OAuth against the WhatsApp app — a different
      // Meta app entirely — and could pair one app's id with another's secret.
      const metaCreds = resolveMetaAppCredentials();
      const appId    = metaCreds?.appId;
      const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

      if (!appId) {
        return reply.status(503).send({ error: 'Meta Ads OAuth not configured', code: 'NOT_CONFIGURED' });
      }

      const redirectUri = encodeURIComponent(`${apiBaseUrl}/integrations/meta-ads/oauth/callback`);
      const state = Buffer.from(founderId).toString('base64');
      const scope = 'ads_read,ads_management,business_management';

      return reply.send({
        url: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&response_type=code`,
      });
    }
  );

  /**
   * GET /integrations/meta-ads/oauth/callback
   * No JWT — Meta redirects here after authorization.
   */
  server.get(
    '/integrations/meta-ads/oauth/callback',
    async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply) => {
      const { code, state, error: oauthError } = request.query;
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:3000';

      if (oauthError || !code || !state) {
        return reply.redirect(`${appBase}/dashboard/channels?error=meta_ads_oauth_failed`);
      }

      const founderId = verifyOAuthState(state);
      if (!founderId) {
        return reply.status(400).send({ error: 'Invalid or tampered state parameter' });
      }

      // Same resolver as the init route and as the canonical /connections flow, so
      // all three always use the SAME Meta app. Both halves come from one pair or
      // neither is returned.
      const metaCreds = resolveMetaAppCredentials();
      const appId     = metaCreds?.appId;
      const appSecret = metaCreds?.appSecret;
      const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

      if (!appId || !appSecret) {
        return reply.redirect(`${appBase}/dashboard/channels?error=meta_ads_not_configured`);
      }

      try {
        const redirectUri = `${apiBaseUrl}/integrations/meta-ads/oauth/callback`;
        const tokenRes = await fetch(
          `${META_GRAPH_BASE}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
        );

        if (!tokenRes.ok) throw new Error('Token exchange failed');
        const tokenData = await tokenRes.json() as { access_token: string; expires_in?: number };

        const { connectApiKeyIntegration } = await import('../services/integrationService');
        await connectApiKeyIntegration({
          founderId,
          platform:          'meta_ads',
          apiKey:            tokenData.access_token,
          integrationConfig: { token_type: 'oauth' },
          scopes: ['ads_read', 'ads_management'],
        });

        return reply.redirect(`${appBase}/dashboard/channels?connected=meta_ads`);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /integrations/meta-ads/oauth/callback' } });
        return reply.redirect(`${appBase}/dashboard/channels?error=meta_ads_oauth_failed`);
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

      const validPlatforms = [
        'ga4', 'firebase', 'search_console', 'website',
        'meta', 'google', 'whatsapp', 'linkedin', 'email',
        'app_store_connect', 'revenue_cat', 'google_ads', 'meta_ads',
      ];
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


  // ── Workspace Connections (Improve Intelligence) ──────────────────────────
  //
  // Tenancy: every route resolves a WorkspaceContext before touching data.
  // A workspace id supplied by the client (?workspaceId= or x-launchmind-workspace-id)
  // is CONTEXT ONLY — resolveWorkspaceContext verifies the actor is a member and
  // throws WorkspaceAccessError (404) otherwise. There is no fall-back to the
  // caller's own workspace after a failed check.

  /**
   * A real provider credential is REQUIRED. There is no mock-credential fallback:
   * a connection must never reach AUTHORIZED without the provider itself accepting
   * the credential.
   */
  const ConnectProviderBodySchema = z
    .object({
      api_key:      z.string().min(8).optional(),
      issuer_id:    z.string().optional(),
      key_id:       z.string().optional(),
      app_id:       z.string().optional(),
      oauth_token:  z.string().min(8).optional(),
      workspace_id: z.string().uuid().optional(),
    })
    .refine((b) => Boolean(b.api_key ?? b.oauth_token), {
      message: 'A provider credential (api_key or oauth_token) is required.',
    });

  const SelectResourceBodySchema = z.object({
    resourceId:   z.string().min(1),
    resourceName: z.string().min(1),
    workspace_id: z.string().uuid().optional(),
  });

  const AuthorityUpgradeBodySchema = z.object({
    levels:       z.array(z.string()).min(1),
    reason:       z.string().min(8),
    workspace_id: z.string().uuid().optional(),
  });

  /**
   * Reads the client-supplied workspace hint. This is CONTEXT, not authorization —
   * resolveWorkspaceContext independently verifies membership.
   */
  function workspaceHint(request: FastifyRequest): string | undefined {
    const header = request.headers['x-launchmind-workspace-id'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const q = (request.query as { workspaceId?: string } | undefined)?.workspaceId;
    const b = (request.body as { workspace_id?: string } | undefined)?.workspace_id;
    const candidate = fromHeader ?? q ?? b;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  }

  /** Resolves the verified workspace context for this request. */
  async function contextFor(request: FastifyRequest): Promise<WorkspaceContext> {
    return resolveWorkspaceContext(getFounderId(request), workspaceHint(request));
  }

  /**
   * Maps a service-layer error onto an HTTP response.
   * Only owner-safe text is returned — raw provider payloads, stack traces, and
   * anything credential-shaped never reach the client.
   */
  function sendConnectionError(reply: FastifyReply, err: unknown, route: string) {
    // An infrastructure outage must never reach the owner as an unexplained 500.
    // This is checked FIRST: the vault sits underneath every other failure mode, and
    // classifying it as a provider or permission problem would send the owner to fix
    // something that was never broken.
    if (isCredentialVaultUnavailable(err)) {
      Sentry.captureException(err, {
        tags:  { route, vault_reason: err.reason },
        extra: { traceId: err.traceId },   // never the AWS error itself
      });
      return reply.status(err.statusCode).send({
        ok:    false,
        code:  err.code,
        error: err.message,
        detail: { retryable: true, traceId: err.traceId },
      });
    }
    if (err instanceof WorkspaceAccessError) {
      // Deliberately indistinguishable from "does not exist" — telling a non-member
      // that a workspace exists leaks tenant structure.
      return reply.status(404).send({ ok: false, error: 'Not found', code: err.code });
    }
    if (err instanceof WorkspacePermissionError) {
      return reply.status(403).send({
        ok: false, error: err.message, code: err.code,
        detail: { requiredRole: err.requiredRole, actualRole: err.actualRole },
      });
    }
    if (err instanceof AuthorityError) {
      return reply.status(403).send({
        ok: false, error: err.message, code: err.code,
        detail: { required: err.required, granted: err.granted },
      });
    }
    if (err instanceof AccountSubstitutionError) {
      return reply.status(409).send({ ok: false, error: err.message, code: err.code });
    }
    if (err instanceof CredentialError) {
      return reply.status(err.statusCode).send({ ok: false, error: err.message, code: err.code });
    }
    if (err instanceof OAuthError) {
      return reply.status(err.statusCode).send({ ok: false, error: err.message, code: err.code });
    }
    if (err instanceof ProviderError) {
      const status =
        err.kind === 'ADAPTER_UNAVAILABLE'  ? 501 :
        err.kind === 'PERMISSION_DENIED'    ? 403 :
        err.kind === 'WRONG_ACCOUNT'        ? 409 :
        err.kind === 'NEEDS_REAUTH'         ? 401 :
        err.kind === 'PROVIDER_UNAVAILABLE' ? 503 : 502;
      return reply.status(status).send({ ok: false, error: err.ownerMessage, code: err.kind });
    }
    if (err instanceof InvalidTransitionError) {
      return reply.status(409).send({
        ok: false,
        error: 'This connection is not in a state where that action is available.',
        code: 'INVALID_STATE_TRANSITION',
        detail: { from: err.from, to: err.to },
      });
    }
    if (err instanceof Error && err.message.includes('not found')) {
      return reply.status(404).send({ ok: false, error: 'Connection not found' });
    }
    Sentry.captureException(err, { tags: { route } });
    return reply.status(500).send({ ok: false, error: 'Something went wrong. Nothing in your account was changed.' });
  }

  /**
   * GET /connections
   * Lists all connections in the caller's active (or requested) workspace.
   */
  server.get('/connections', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ctx = await contextFor(request);
      const connections = await listConnections(ctx);
      return reply.send({ ok: true, data: connections, workspaceId: ctx.workspaceId });
    } catch (err) {
      return sendConnectionError(reply, err, 'GET /connections');
    }
  });

  /**
   * GET /connections/providers
   * Reports which intelligence sources can actually be connected right now, so the
   * UI can show an honest "not available yet" instead of a dead Connect button.
   */
  server.get('/connections/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await contextFor(request); // authenticated member of some workspace
      return reply.send({ ok: true, data: { available: availableProviders() } });
    } catch (err) {
      return sendConnectionError(reply, err, 'GET /connections/providers');
    }
  });

  /**
   * GET /connections/:id
   * Returns a single connection. Cross-workspace ids resolve to 404.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        const connection = await getConnection(ctx, id);
        return reply.send({ ok: true, data: connection });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id');
      }
    },
  );

  /**
   * POST /connections/:provider/connect
   * Direct-credential connect (API-key providers). OAuth providers use
   * /connections/:provider/oauth/start instead.
   *
   *   1. Verify the credential against the live provider API
   *   2. Only on success: encrypt + store it in the workspace vault, → AUTHORIZED
   *   3. Grant LEAST PRIVILEGE (READ + RECOMMEND), audited
   *   4. Create the sync run and enqueue the job — returns immediately
   *
   * Returns 501 PROVIDER_ADAPTER_UNAVAILABLE when no real integration exists.
   */
  server.post<{ Params: { provider: string } }>(
    '/connections/:provider/connect',
    async (request: FastifyRequest<{ Params: { provider: string } }>, reply: FastifyReply) => {
      const { provider } = request.params;

      if (!isKnownProvider(provider)) {
        return reply.status(400).send({ ok: false, error: 'Unsupported intelligence source' });
      }

      const parsed = ConnectProviderBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid request body', detail: parsed.error.message });
      }

      let credential = (parsed.data.api_key ?? parsed.data.oauth_token) as string;
      const config: Record<string, unknown> = {};
      if (parsed.data.issuer_id) config.issuer_id = parsed.data.issuer_id;
      if (parsed.data.key_id)    config.key_id    = parsed.data.key_id;
      if (parsed.data.app_id)    config.app_id    = parsed.data.app_id;

      // Whether a provider uses OAuth is decided by its ADAPTER, not by whether an
      // OAuth template happens to exist for it. Stripe has a Connect template on file
      // for a future platform setup, but its adapter authenticates with a restricted
      // key today — gating on the template would wrongly block it.
      let adapterAuth: string | null = null;
      try {
        adapterAuth = getAdapter(provider).authMechanism;
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:provider/connect');
      }

      if (adapterAuth === 'oauth2') {
        return reply.status(400).send({
          ok: false,
          code: 'OAUTH_REQUIRED',
          error: 'This source is connected by signing in with the provider, not by pasting a key. Start the connection from Improve Intelligence.',
        });
      }

      // App Store Connect authenticates with a signed assertion, so the credential is
      // three parts (Issuer ID + Key ID + .p8 private key). Pack them into the single
      // encrypted blob the vault stores. Issuer/Key IDs are not secret but travel with
      // the key so one decrypt yields everything needed to call Apple.
      if (provider === 'app_store_connect') {
        if (!parsed.data.issuer_id || !parsed.data.key_id) {
          return reply.status(400).send({
            ok: false,
            error: 'App Store Connect needs the Issuer ID and Key ID that Apple shows alongside your API key, plus the .p8 key file contents.',
            code: 'MISSING_APPLE_KEY_FIELDS',
          });
        }
        try {
          const { packAppleCredential } = await import('../services/providers/appleJwt');
          credential = packAppleCredential({
            issuerId:   parsed.data.issuer_id,
            keyId:      parsed.data.key_id,
            privateKey: credential,
          });
        } catch (err) {
          return sendConnectionError(reply, err, 'POST /connections/app_store_connect/connect');
        }
      }

      const traceId = traceIdFromRequest(request);

      try {
        const ctx = await contextFor(request);

        // `connection` is reassigned below (auto-select path); the other two are not.
        const authorized = await authorizeConnection(ctx, provider, credential, config, traceId);
        const { accounts, permissions } = authorized;
        let connection = authorized.connection;

        // A sync is only queued once the owner's resource is known. When the provider
        // returned several accounts the owner must choose first — queuing now would
        // start a sync with nothing selected, which the adapter would correctly
        // refuse as WRONG_ACCOUNT. POST /select-resource queues it instead.
        const needsResourceSelection = accounts.length !== 1;
        let syncRunId: string | null = null;

        if (!needsResourceSelection) {
          connection = await selectResource(ctx, connection.id, accounts[0].id, accounts[0].name, traceId);
          const queued = await triggerSync(ctx, connection.id, traceId);
          syncRunId = queued.syncRunId;
          await enqueueConnectionSync({
            connectionId: connection.id,
            syncRunId,
            workspaceId:  ctx.workspaceId,
            founderId:    ctx.actorId,
            provider,
            traceId,
          });
        }

        connection = await getConnection(ctx, connection.id);

        // No insight and no credential material in the response.
        return reply.status(201).send({
          ok: true,
          data: {
            connection,
            accounts,
            syncRunId,
            traceId,
            workspaceId: ctx.workspaceId,
            permissions,
            syncQueued: syncRunId !== null,
            needsResourceSelection,
          },
        });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:provider/connect');
      }
    },
  );

  /**
   * POST /connections/:provider/oauth/start
   * Begins a provider OAuth flow. Persists state/nonce/PKCE server-side and returns
   * only the authorization URL — the browser never receives a token or a signed
   * identifier, just an opaque random state.
   */
  server.post<{ Params: { provider: string } }>(
    '/connections/:provider/oauth/start',
    async (request: FastifyRequest<{ Params: { provider: string } }>, reply: FastifyReply) => {
      const { provider } = request.params;
      if (!isKnownProvider(provider)) {
        return reply.status(400).send({ ok: false, error: 'Unsupported intelligence source' });
      }

      try {
        const ctx = await contextFor(request);
        requireWorkspaceWrite(ctx);

        const config = getOAuthProviderConfig(provider);
        if (!config) {
          return reply.status(501).send({
            ok: false,
            code: 'ADAPTER_UNAVAILABLE',
            error: 'This intelligence source is not available to connect yet. LaunchMind will not show estimated data in its place.',
          });
        }

        const intentRaw = (request.body as { intent?: string } | undefined)?.intent;
        const intent = intentRaw === 'reauthorize' ? 'reauthorize' : 'connect';

        const created = await createAuthorizationRequest({
          config,
          workspaceId: ctx.workspaceId,
          actorId:     ctx.actorId,
          intent,
          connectionId: (request.body as { connectionId?: string } | undefined)?.connectionId ?? null,
          traceId:     traceIdFromRequest(request),
        });

        return reply.status(201).send({
          ok: true,
          data: { authorizationUrl: created.authorizationUrl, expiresAt: created.expiresAt },
        });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:provider/oauth/start');
      }
    },
  );

  /**
   * GET /connections/oauth/callback
   * Single canonical provider callback. No JWT — the provider redirects the browser
   * here, so authorization comes from the single-use server-side state, which also
   * re-verifies workspace membership.
   *
   * Never renders provider errors or tokens; always redirects to the app with a
   * short status code.
   */
  server.get(
    '/connections/oauth/callback',
    async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) => {
      const appBase = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
      const target  = `${appBase}/dashboard/channels`;
      const { code, state, error: providerError } = request.query;

      if (providerError || !code || !state) {
        return reply.redirect(`${target}?connection_error=authorization_declined`);
      }

      try {
        // Validates + single-uses the state, and re-checks workspace membership.
        const authRequest = await consumeAuthorizationRequest(state);

        const config = getOAuthProviderConfig(authRequest.provider);
        if (!config) return reply.redirect(`${target}?connection_error=provider_unavailable`);

        const tokens = await exchangeAuthorizationCode({
          config,
          code,
          redirectUri:  authRequest.redirectUri,
          codeVerifier: authRequest.codeVerifier,
        });

        const ctx: WorkspaceContext = {
          actorId:     authRequest.actorId,
          workspaceId: authRequest.workspaceId,
          role:        'owner',
          isOwner:     true,
        };

        const { connection, accounts } = await authorizeConnection(
          ctx,
          authRequest.provider,
          tokens.accessToken,
          { oauth: true },
          authRequest.traceId,
          {
            refreshToken:     tokens.refreshToken,
            expiresInSeconds: tokens.expiresInSeconds,
            // Least privilege: whatever the provider actually granted, which never
            // widens the LaunchMind permission grant.
            grantedScopes:    tokens.grantedScopes,
          },
        );

        // Exactly one readable resource → auto-select and start the first sync.
        // Several → the owner must choose, so nothing is queued yet: syncing against
        // an unchosen property would import the wrong site's data.
        if (accounts.length === 1) {
          await selectResource(ctx, connection.id, accounts[0].id, accounts[0].name, authRequest.traceId);
          const { syncRunId } = await triggerSync(ctx, connection.id, authRequest.traceId);
          await enqueueConnectionSync({
            connectionId: connection.id,
            syncRunId,
            workspaceId:  ctx.workspaceId,
            founderId:    ctx.actorId,
            provider:     authRequest.provider,
            traceId:      authRequest.traceId,
          });
        }

        const next = accounts.length === 1 ? 'connected' : 'select_resource';
        return reply.redirect(
          `${target}?${next}=${encodeURIComponent(authRequest.provider)}&connection=${encodeURIComponent(connection.id)}`,
        );
      } catch (err) {
        // Never leak the reason to the URL beyond a coarse code.
        const code =
          err instanceof OAuthError ? err.code :
          err instanceof AccountSubstitutionError ? 'wrong_account' : 'authorization_failed';
        Sentry.captureException(err, { tags: { route: 'GET /connections/oauth/callback' } });
        return reply.redirect(`${target}?connection_error=${encodeURIComponent(code)}`);
      }
    },
  );

  /**
   * POST /connections/:provider/preview
   * Records that the owner is previewing a source. Grants nothing, stores nothing.
   */
  server.post<{ Params: { provider: string } }>(
    '/connections/:provider/preview',
    async (request: FastifyRequest<{ Params: { provider: string } }>, reply: FastifyReply) => {
      const { provider } = request.params;
      if (!isKnownProvider(provider)) {
        return reply.status(400).send({ ok: false, error: 'Unsupported intelligence source' });
      }
      try {
        const ctx = await contextFor(request);
        const connection = await previewConnection(ctx, provider, traceIdFromRequest(request));
        return reply.send({ ok: true, data: { connection, adapterAvailable: hasAdapter(provider) } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:provider/preview');
      }
    },
  );

  /**
   * POST /connections/:id/reauthorize
   * Moves a connection needing re-authorization back into the authorization flow.
   * Historical signals are preserved; the permission grant is re-asserted unchanged.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/reauthorize',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        await assertConnectionInWorkspace(ctx, id);
        const connection = await beginReauthorization(ctx, id, traceIdFromRequest(request));
        return reply.send({ ok: true, data: connection });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/reauthorize');
      }
    },
  );

  /**
   * GET /connections/:id/accounts
   * Lists provider-authorized accounts. Live call — never a synthesized list.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id/accounts',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        const accounts = await listProviderAccounts(ctx, id, traceIdFromRequest(request));
        return reply.send({ ok: true, data: accounts });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id/accounts');
      }
    },
  );

  /**
   * POST /connections/:id/select-resource
   * Records the chosen account/property and queues the first sync — selection is the
   * point at which LaunchMind finally knows what to read. Requires workspace write.
   *
   * The adapter validates the choice against the live provider before it is stored,
   * so an id from another account is refused rather than bound.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/select-resource',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const parsed = SelectResourceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }

      const traceId = traceIdFromRequest(request);

      try {
        const ctx = await contextFor(request);
        const existing = await assertConnectionInWorkspace(ctx, id);

        const connection = await selectResource(
          ctx, id, parsed.data.resourceId, parsed.data.resourceName, traceId,
        );

        // Queue the first sync now that the target is known.
        const { syncRunId } = await triggerSync(ctx, id, traceId);
        await enqueueConnectionSync({
          connectionId: id,
          syncRunId,
          workspaceId:  ctx.workspaceId,
          founderId:    ctx.actorId,
          provider:     existing.provider,
          traceId,
        });

        return reply.send({ ok: true, data: { connection, syncRunId, traceId } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/select-resource');
      }
    },
  );

  /**
   * POST /connections/:id/sync
   * Queues a sync and returns immediately. No provider work on this thread.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/sync',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const traceId = traceIdFromRequest(request);
      try {
        const ctx = await contextFor(request);
        const connection = await getConnection(ctx, id);
        const { syncRunId, status } = await triggerSync(ctx, id, traceId);
        await enqueueConnectionSync({
          connectionId: id,
          syncRunId,
          workspaceId:  ctx.workspaceId,
          founderId:    ctx.actorId,
          provider:     connection.provider,
          traceId,
        });
        return reply.status(202).send({ ok: true, data: { syncRunId, status, traceId } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/sync');
      }
    },
  );

  /**
   * POST /connections/:id/refresh
   * Alias for /sync — queues a fresh sync and returns immediately.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/refresh',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const traceId = traceIdFromRequest(request);
      try {
        const ctx = await contextFor(request);
        const connection = await getConnection(ctx, id);
        const { syncRunId, status } = await triggerSync(ctx, id, traceId);
        await enqueueConnectionSync({
          connectionId: id,
          syncRunId,
          workspaceId:  ctx.workspaceId,
          founderId:    ctx.actorId,
          provider:     connection.provider,
          traceId,
        });
        return reply.status(202).send({ ok: true, data: { syncRunId, status, traceId } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/refresh');
      }
    },
  );

  /**
   * GET /connections/:id/sync-runs
   * Last 5 sync runs. Scoped by connection AND workspace.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id/sync-runs',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        const syncRuns = await getSyncRuns(ctx, id);
        return reply.send({ ok: true, data: syncRuns });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id/sync-runs');
      }
    },
  );

  /**
   * GET /connections/:id/health
   * Status, freshness, signal count, granted permissions, and non-secret credential
   * metadata. Never token material.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id/health',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        const health = await getConnectionHealth(ctx, id);
        return reply.send({ ok: true, data: health });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id/health');
      }
    },
  );

  /**
   * GET /connections/:id/insights
   * Current evidence-backed insights derived from this connection's imported data,
   * with the provenance needed to explain each one.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id/insights',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        await assertConnectionInWorkspace(ctx, id);
        const { getLiveInsights } = await import('../services/connectionInsightService');
        const insights = await getLiveInsights(ctx.workspaceId, { connectionId: id, limit: 10 });
        return reply.send({ ok: true, data: insights });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id/insights');
      }
    },
  );

  /**
   * GET /connections/:id/execution-boundary
   * What this connection could and could not do, per action, with the reason.
   *
   * Powers the owner-facing permission panel. Reads the persisted grant and the
   * adapter's real capabilities — never the provider's token scopes, which for
   * Google Ads are broader than anything LaunchMind will use.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id/execution-boundary',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        const boundary = await describeExecutionBoundary(ctx, id);
        return reply.send({ ok: true, data: boundary });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id/execution-boundary');
      }
    },
  );

  /**
   * POST /connections/:id/execute
   *
   * The SINGLE entry point for any action against a connected platform, and therefore
   * the single place the trust boundary is enforced. It exists now, before any
   * execution does, so that the boundary is testable and so a future execution feature
   * has exactly one door to come through.
   *
   * Today every request is refused. connectionExecutionGuard checks, in order:
   *   actor (a person, never the AI) → workspace role → persisted authority →
   *   adapter capability
   * and no adapter implements a capability, so even a workspace owner who explicitly
   * granted SPEND cannot cause an external change.
   *
   * @security Never bypass this route. Anything that mutates a provider must call
   *   assertExecutionAllowed first.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/execute',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }

      const parsed = z.object({
        action: z.string().min(1),
        workspace_id: z.string().uuid().optional(),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'An action is required.' });
      }

      try {
        const ctx = await contextFor(request);

        // A human called this route, so actorType is 'founder'. Nothing that runs on
        // a queue or inside an agent can reach here — those paths call
        // assertExecutionAllowed directly with actorType 'system', which is refused
        // before any other gate.
        await assertExecutionAllowed(ctx, id, parsed.data.action, 'founder');

        // Unreachable today: the capability gate throws for every adapter. Kept
        // explicit so the failure mode is a clear refusal rather than a silent
        // fall-through if an adapter ever gains a capability by accident.
        return reply.status(501).send({
          ok: false,
          code: 'EXECUTION_NOT_IMPLEMENTED',
          error: 'LaunchMind does not perform actions on connected platforms. Nothing was changed.',
        });
      } catch (err) {
        if (err instanceof ExecutionBlockedError) {
          return reply.status(err.statusCode).send({
            ok: false, code: err.code, error: err.message, detail: { gate: err.gate },
          });
        }
        return sendConnectionError(reply, err, 'POST /connections/:id/execute');
      }
    },
  );

  /**
   * GET /connections/:id/permissions
   * Current grant plus the immutable change history.
   */
  server.get<{ Params: { id: string } }>(
    '/connections/:id/permissions',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        await assertConnectionInWorkspace(ctx, id);
        const [granted, history] = await Promise.all([
          getEffectivePermissions(ctx, id),
          getPermissionHistory(ctx, id),
        ]);
        return reply.send({
          ok: true,
          data: {
            granted,
            history,
            levels: PERMISSION_LEVELS,
            executionLevels: EXECUTION_PERMISSIONS,
          },
        });
      } catch (err) {
        return sendConnectionError(reply, err, 'GET /connections/:id/permissions');
      }
    },
  );

  /**
   * POST /connections/:id/permissions/request-upgrade
   * Records a request to widen authority and describes exactly what would change.
   * Grants nothing by itself. Requires workspace admin.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/permissions/request-upgrade',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const parsed = AuthorityUpgradeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }
      try {
        const ctx = await contextFor(request);
        const result = await requestAuthorityUpgrade(
          ctx, id, parsed.data.levels, parsed.data.reason, traceIdFromRequest(request),
        );
        return reply.status(201).send({ ok: true, data: result });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/permissions/request-upgrade');
      }
    },
  );

  /**
   * POST /connections/:id/permissions/approve-upgrade
   * The ONLY path by which CHANGE, PUBLISH, or SPEND can be granted.
   * Requires workspace admin and a written reason. Records, does not execute.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/permissions/approve-upgrade',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const parsed = AuthorityUpgradeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }
      try {
        const ctx = await contextFor(request);
        const granted = await approveAuthorityUpgrade(
          ctx, id, parsed.data.levels, parsed.data.reason, traceIdFromRequest(request),
        );
        return reply.send({ ok: true, data: { granted } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/permissions/approve-upgrade');
      }
    },
  );

  /**
   * POST /connections/:id/permissions/deny-upgrade
   *
   * Records that an admin refused a requested authority upgrade. The grant is left
   * exactly as it was — a denial is an audit fact, not a state change.
   *
   * The service already implemented this; without a route the UI could record a
   * request and an approval but never a refusal, which left the permission history
   * showing only the decisions that widened access.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/permissions/deny-upgrade',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const parsed = AuthorityUpgradeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }
      try {
        const ctx = await contextFor(request);
        const granted = await denyAuthorityUpgrade(
          ctx, id, parsed.data.levels, parsed.data.reason, traceIdFromRequest(request),
        );
        return reply.send({ ok: true, data: { granted } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/permissions/deny-upgrade');
      }
    },
  );

  /**
   * POST /connections/:id/permissions/downgrade
   * Withdraws authority without disconnecting the source. Requires workspace admin.
   */
  server.post<{ Params: { id: string } }>(
    '/connections/:id/permissions/downgrade',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      const parsed = AuthorityUpgradeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid body', detail: parsed.error.message });
      }
      try {
        const ctx = await contextFor(request);
        const granted = await downgradeAuthority(
          ctx, id, parsed.data.levels, parsed.data.reason, traceIdFromRequest(request),
        );
        return reply.send({ ok: true, data: { granted } });
      } catch (err) {
        return sendConnectionError(reply, err, 'POST /connections/:id/permissions/downgrade');
      }
    },
  );

  /**
   * DELETE /connections/:id
   * Revokes the credential, clears all granted authority, sets DISCONNECTED.
   * Previously imported intelligence is retained.
   */
  server.delete<{ Params: { id: string } }>(
    '/connections/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ ok: false, error: 'Invalid connection ID' });
      }
      try {
        const ctx = await contextFor(request);
        await assertConnectionInWorkspace(ctx, id);
        await disconnectConnection(ctx, id, traceIdFromRequest(request));
        return reply.status(204).send();
      } catch (err) {
        return sendConnectionError(reply, err, 'DELETE /connections/:id');
      }
    },
  );

  // Available for future use (per-connection latest-run lookups).
  void getLatestSyncRun;
}
