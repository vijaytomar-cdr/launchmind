/**
 * @file health.test.ts
 * @description Unit tests for the GET /health endpoint.
 *   Uses Fastify's inject() — no real network binding required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';

describe('GET /health', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('returns status: ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    const body = res.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe('ok');
  });

  it('returns a valid ISO timestamp', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    const body = res.json<{ status: string; timestamp: string }>();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
