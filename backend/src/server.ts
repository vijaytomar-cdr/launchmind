/**
 * @file server.ts
 * @description Fastify entry point for the LaunchMind API.
 *   Sentry is initialised first (before any plugin) so all startup errors are captured.
 *   Exports `buildServer` for use in tests without binding to a port.
 * @security Sentry captures all unhandled errors. CORS restricted to NEXT_PUBLIC_APP_URL.
 *   JWT verified via Supabase JWKS endpoint (ES256 / ECC P-256). Rate-limited to 100 req/min per IP.
 * @dependencies @sentry/node, @fastify/cors, jose, @fastify/rate-limit
 */

// Load .env.local from project root before anything else (local dev only — no-op in prod).
import { existsSync, readFileSync } from 'fs';
import { warnOnMetaConfigAtStartup } from './services/providers/metaCredentials';
import { resolve } from 'path';
const envPath = resolve(__dirname, '..', '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { jwtPlugin } from './lib/jwtPlugin';
import { productsRoutes } from './routes/products.route';
import { billingRoutes } from './routes/billing.route';
import { channelsRoutes } from './routes/channels.route';
import { adminRoutes } from './routes/admin.route';
import { waitlistRoutes } from './routes/waitlist.route';
import { workspacesRoutes } from './routes/workspaces.route';
import { apiKeysRoutes } from './routes/apiKeys.route';
import { foundersRoutes } from './routes/founders.route';
import { contentAssetsRoutes } from './routes/contentAssets.route';
import { settingsRoutes } from './routes/settings.route';
import { memoryRoutes } from './routes/memory.route';
import { knowledgeRoutes } from './routes/knowledge.route';
import { aiRoutes }      from './routes/ai.route';
import { missionRoutes } from './routes/missions.route';
import { ownerRoutes }   from './routes/owner.route';
import { studioRoutes }    from './routes/studio.route';
import { campaignRoutes }  from './routes/campaigns.route';
import { experimentRoutes } from './routes/experiments.route';
import { calendarRoutes }         from './routes/calendar.route';
import { recommendationsRoutes }  from './routes/recommendations.route';
import { benchmarksRoutes }       from './routes/benchmarks.route';
import analyticsRoutes            from './routes/analytics.route';
import reportsRoutes              from './routes/reports.route';
import { onboardingRoutes }       from './routes/onboarding.route';
import { InsufficientTokensError } from './types/errors';
import { checkAnomaly, extractFounderIdFromHeader } from './middleware/auth.middleware';
import { startBriefWorker } from './workers/weeklyBriefWorker';
import { startIntakeWorker }  from './workers/intakeWorker';
import { startContentWorker }  from './workers/contentWorker';
import { startMissionWorker }  from './workers/missionWorker';
import { startDiscoveryWorker } from './workers/discoveryWorker';
import { startConnectionSyncWorker } from './workers/connectionSyncWorker';
import { startEmbeddingWorker } from './workers/embeddingWorker';
import { scheduleWeeklyBrief } from './lib/scheduler';

/**
 * Builds and configures the Fastify server instance.
 * Does NOT bind to a port — call server.listen() separately.
 * @returns Configured FastifyInstance ready to listen or inject test requests.
 * @throws  {Error} If required env vars are missing.
 * @security All plugins registered before routes. JWT secret validated at startup.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  await server.register(cors, {
    origin: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  await server.register(jwtPlugin);

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Bypass rate limiting for localhost in development — avoids false 429s from hot reloads
    allowList: process.env.NODE_ENV !== 'production' ? ['127.0.0.1', '::1', '::ffff:127.0.0.1'] : [],
  });

  // Surface a deprecated or half-configured Meta setup at startup, not at the
  // moment an owner tries to connect. Prints variable names and a state only.
  warnOnMetaConfigAtStartup();

  server.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  /**
   * GET /health/detailed
   * Internal health check that probes Redis and Supabase connectivity.
   * Returns 200 if all dependencies are healthy, 503 if any are down.
   * @security Public — no auth required. Returns only status strings, no credentials.
   */
  server.get('/health/detailed', async (_request, reply) => {
    // The embedding pipeline has states that are neither 'ok' nor 'error':
    // 'unconfigured' means nobody has provisioned a provider yet, and
    // 'queue_backlog' means work is late but nothing is broken. Flattening
    // either into 'error' would page someone for a non-incident.
    const checks: Record<string, 'ok' | 'error' | 'degraded' | 'unconfigured' | 'queue_backlog' | 'unknown'> = {};
    let vaultDetail: { status: string; detail: string } | null = null;
    let allOk = true;

    // Supabase probe — simple count query
    try {
      const { error } = await (await import('./lib/supabaseAdmin')).getSupabaseAdmin()
        .from('founders')
        .select('id', { count: 'exact', head: true });
      checks.supabase = error ? 'error' : 'ok';
      if (error) allOk = false;
    } catch {
      checks.supabase = 'error';
      allOk = false;
    }

    // Redis probe — ping via BullMQ queue connection
    try {
      const { getBriefQueue } = await import('./lib/scheduler');
      const queue = getBriefQueue();
      await queue.client;
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      allOk = false;
    }

    // Credential vault probe. Encrypts and decrypts a fixed sentinel — non-
    // destructive, creates nothing, stores nothing. It is checked here because a
    // reachable database and queue with a dead vault still means no provider can be
    // connected, and that failure was previously invisible until an owner tried.
    try {
      const { checkVaultHealth } = await import('./lib/tokenVault');
      const vault = await checkVaultHealth();
      // Distinguishes the operator-actionable cases without exposing OCIDs,
      // endpoints, or SDK text.
      checks.credential_vault = vault.status === 'healthy' ? 'ok' : 'error';
      vaultDetail = { status: vault.status, detail: vault.detail };
      if (vault.status !== 'healthy') allOk = false;
    } catch {
      checks.credential_vault = 'error';
      vaultDetail = { status: 'unavailable', detail: 'Credential vault probe failed.' };
      allOk = false;
    }

    // Embedding pipeline (Phase 3.1C). Reported but NOT part of `allOk`: an
    // unconfigured or backed-up embedding queue must never make the API look
    // unhealthy, because canonical writes and lexical retrieval are unaffected
    // by it. Degrading the whole service on a derived index would invert the
    // dependency the architecture is built on.
    let embeddingDetail: Record<string, unknown> = { status: 'unknown' };
    try {
      const { getEmbeddingHealth } = await import('./services/memory/embeddingBackfill');
      const e = await getEmbeddingHealth();
      checks.embedding_pipeline = e.status === 'healthy' ? 'ok' : e.status;
      embeddingDetail = {
        status: e.status,
        generationEnabled: e.generationEnabled,
        provider: e.provider,
        model: e.model,
        dimensions: e.dimensions,
        pendingJobs: e.pendingJobs,
        processingJobs: e.processingJobs,
        failedJobs: e.failedJobs,
        staleEmbeddings: e.staleEmbeddings,
        currentEmbeddings: e.currentEmbeddings,
        queueAgeSeconds: e.queueAgeSeconds,
      };
    } catch {
      checks.embedding_pipeline = 'unknown';
      embeddingDetail = { status: 'unknown', detail: 'Embedding pipeline probe failed.' };
    }

    return reply
      .status(allOk ? 200 : 503)
      .send({
        status: allOk ? 'ok' : 'degraded',
        checks,
        vault: vaultDetail,
        embedding: embeddingDetail,
        timestamp: new Date().toISOString(),
      });
  });

  await server.register(productsRoutes);
  await server.register(billingRoutes);
  await server.register(channelsRoutes);
  await server.register(adminRoutes);
  await server.register(waitlistRoutes);
  await server.register(workspacesRoutes);
  await server.register(apiKeysRoutes);
  await server.register(foundersRoutes);
  await server.register(contentAssetsRoutes);
  await server.register(settingsRoutes);
  await server.register(memoryRoutes);
  await server.register(knowledgeRoutes);
  await server.register(aiRoutes);
  await server.register(missionRoutes);
  await server.register(ownerRoutes);
  await server.register(studioRoutes);
  await server.register(campaignRoutes);
  await server.register(experimentRoutes);
  await server.register(calendarRoutes);
  await server.register(recommendationsRoutes);
  await server.register(benchmarksRoutes);
  await server.register(analyticsRoutes);
  await server.register(reportsRoutes);
  await server.register(onboardingRoutes);

  // Anomaly detection — fires on every request with an Authorization header.
  // Decodes JWT payload (no re-verification) to extract founderId, then fires
  // checkAnomaly as void (non-blocking). Never delays or rejects the request.
  server.addHook('onRequest', async (request) => {
    const authHeader = request.headers.authorization;
    const founderId = extractFounderIdFromHeader(authHeader);
    if (founderId) {
      const ip =
        (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        request.socket.remoteAddress ??
        'unknown';
      const userAgent = (request.headers['user-agent'] as string | undefined) ?? 'unknown';
      void checkAnomaly(founderId, ip, userAgent);
    }
  });

  server.setErrorHandler((error, _request, reply) => {
    // instanceof check can fail under tsx hot-reload due to class identity mismatch;
    // fall back to name check so 402s are never swallowed as 500s.
    if (error instanceof InsufficientTokensError || error.name === 'InsufficientTokensError') {
      const tokenErr = error as unknown as InsufficientTokensError;
      return reply.status(402).send({
        error: 'Insufficient tokens',
        code: 'INSUFFICIENT_TOKENS',
        balance: tokenErr.balance ?? 0,
        required: tokenErr.required ?? 0,
      });
    }
    Sentry.captureException(error);
    server.log.error(error);
    reply.status(error.statusCode ?? 500).send({
      error: error.message ?? 'Internal Server Error',
    });
  });

  return server;
}

async function start(): Promise<void> {
  const server = await buildServer();
  const port = parseInt(process.env.PORT ?? '3001', 10);
  try {
    await server.listen({ port, host: '0.0.0.0' });

    // Start BullMQ workers only when Redis is properly configured
    const redisUrl = process.env.REDIS_URL ?? '';
    const redisReady = redisUrl && !redisUrl.includes('your_upstash');
    if (redisReady) {
      startBriefWorker();
      startIntakeWorker();
      startContentWorker();
      startMissionWorker();
      startDiscoveryWorker();
      // Canonical execution path for Improve Intelligence provider syncs.
      // Without this, /connections/:id/sync enqueues jobs no consumer ever runs.
      startConnectionSyncWorker();
      // Drains embedding_outbox. Same omission as the connection-sync worker
      // above, with a quieter failure: the outbox is filled by a Postgres
      // TRIGGER, so work accumulates whether or not anything consumes it. With
      // no sweeper, every vector goes stale on the next corpus update and
      // semantic retrieval silently degrades to lexical-only — which is exactly
      // what was measured on hosted (33 stale, 0 current, 33 queued).
      startEmbeddingWorker();
      await scheduleWeeklyBrief();
    } else {
      console.warn('[server] REDIS_URL not configured — BullMQ workers skipped (set a real URL to enable)');
    }
  } catch (err) {
    Sentry.captureException(err);
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
