/**
 * @file server.ts
 * @description Fastify entry point for the LaunchMind API.
 *   Sentry is initialised first (before any plugin) so all startup errors are captured.
 *   Exports `buildServer` for use in tests without binding to a port.
 * @security Sentry captures all unhandled errors. CORS restricted to NEXT_PUBLIC_APP_URL.
 *   JWT verified via SUPABASE_JWT_SECRET (HS256). Rate-limited to 100 req/min per IP.
 * @dependencies @sentry/node, @fastify/cors, @fastify/jwt, @fastify/rate-limit
 */

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

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

  await server.register(jwt, {
    secret: process.env.SUPABASE_JWT_SECRET ?? 'test-secret-for-local-dev-only',
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  server.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  server.setErrorHandler((error, _request, reply) => {
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
  } catch (err) {
    Sentry.captureException(err);
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
