/**
 * @file server.ts
 * @description Fastify entry point for the LaunchMind API.
 *   Sentry is initialised first (before any plugin) so all startup errors are captured.
 *   Exports `buildServer` for use in tests without binding to a port.
 * @security Sentry captures all unhandled errors. CORS restricted to NEXT_PUBLIC_APP_URL.
 *   JWT verified via Supabase JWKS endpoint (ES256 / ECC P-256). Rate-limited to 100 req/min per IP.
 * @dependencies @sentry/node, @fastify/cors, jose, @fastify/rate-limit
 */

// Load .env.dev from project root before anything else (local dev only — no-op in prod).
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname_compat = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname_compat, '..', '..', '.env.dev');
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
import { InsufficientTokensError } from './types/errors';
import { checkAnomaly, extractFounderIdFromHeader } from './middleware/auth.middleware';
import { startBriefWorker } from './workers/weeklyBriefWorker';
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
    const checks: Record<string, 'ok' | 'error'> = {};
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

    return reply
      .status(allOk ? 200 : 503)
      .send({ status: allOk ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() });
  });

  await server.register(productsRoutes);
  await server.register(billingRoutes);
  await server.register(channelsRoutes);
  await server.register(adminRoutes);
  await server.register(waitlistRoutes);
  await server.register(workspacesRoutes);
  await server.register(apiKeysRoutes);
  await server.register(foundersRoutes);

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

    // Start BullMQ worker and register weekly cron (only in production process)
    startBriefWorker();
    await scheduleWeeklyBrief();
  } catch (err) {
    Sentry.captureException(err);
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
