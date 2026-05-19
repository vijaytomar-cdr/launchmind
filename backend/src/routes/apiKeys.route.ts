/**
 * @file apiKeys.route.ts
 * @description API key management and v1 API endpoints.
 *
 *   Key management (JWT auth):
 *     POST   /api-keys        — generate a new key (returned once, never again)
 *     GET    /api-keys        — list keys (prefix + metadata, never full key)
 *     DELETE /api-keys/:id   — revoke a key
 *
 *   v1 external API (API key auth via X-API-Key header):
 *     GET /v1/me              — founder profile scoped to API key
 *     GET /v1/products        — products scoped to API key owner
 *
 * @security
 *   - Keys are stored as SHA-256 hash only — the raw key is shown ONCE at creation.
 *   - Format: lm_ + 40 hex chars (160 bits entropy).
 *   - X-API-Key header validated by hash lookup; last_used_at updated on each use.
 *   - Revoked and expired keys return 401.
 *   - All v1 responses are founder-scoped — a key cannot access another founder's data.
 * @dependencies supabaseAdmin, crypto
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateKey(): { raw: string; hash: string; prefix: string } {
  const raw = 'lm_' + randomBytes(20).toString('hex'); // lm_ + 40 hex = 43 chars
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 11) }; // "lm_" + 8 chars
}

const CreateKeySchema = z.object({
  name:       z.string().min(1).max(80),
  scopes:     z.array(z.enum(['read', 'write'])).min(1).default(['read']),
  expires_at: z.string().datetime().optional(),
});

// ── Shared API key validator (used by v1 routes) ─────────────────────────────

async function verifyApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const header =
    (request.headers['x-api-key'] as string | undefined) ??
    (request.headers.authorization?.startsWith('Bearer lm_')
      ? request.headers.authorization.slice(7)
      : undefined);

  if (!header?.startsWith('lm_')) {
    reply.status(401).send({ error: 'Missing or invalid API key' });
    return null;
  }

  const hash = hashKey(header);
  const db = getSupabaseAdmin();

  const { data: key } = await db
    .from('api_keys')
    .select('id, founder_id, scopes, revoked_at, expires_at')
    .eq('key_hash', hash)
    .single();

  if (!key) {
    reply.status(401).send({ error: 'Invalid API key' });
    return null;
  }

  if (key.revoked_at) {
    reply.status(401).send({ error: 'API key has been revoked' });
    return null;
  }

  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    reply.status(401).send({ error: 'API key has expired' });
    return null;
  }

  // Update last_used_at asynchronously — don't block the response
  void db.from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);

  return key.founder_id as string;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function apiKeysRoutes(server: FastifyInstance): Promise<void> {

  /**
   * POST /api-keys
   * Generates a new API key. The full key is returned ONCE — it is never retrievable again.
   * Body: { name: string, scopes?: ['read'|'write'], expires_at?: ISO datetime }
   */
  server.post('/api-keys', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
    }

    const { raw, hash, prefix } = generateKey();

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('api_keys')
        .insert({
          founder_id: founderId,
          name:       parsed.data.name,
          key_hash:   hash,
          key_prefix: prefix,
          scopes:     parsed.data.scopes,
          expires_at: parsed.data.expires_at ?? null,
        })
        .select('id, name, key_prefix, scopes, expires_at, created_at')
        .single();

      if (error || !data) throw error ?? new Error('Insert failed');

      // Return the full key ONCE — it is never returned again after this
      return reply.status(201).send({ ...data, key: raw });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /api-keys' } });
      return reply.status(500).send({ error: 'Failed to create API key' });
    }
  });

  /**
   * GET /api-keys
   * Lists the founder's API keys. Never returns the full key — only prefix and metadata.
   */
  server.get('/api-keys', async (request, reply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('api_keys')
        .select('id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return reply.send({ keys: data ?? [] });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /api-keys' } });
      return reply.status(500).send({ error: 'Failed to list API keys' });
    }
  });

  /**
   * DELETE /api-keys/:id
   * Revokes an API key by setting revoked_at. The hash row is kept for audit purposes.
   */
  server.delete<{ Params: { id: string } }>(
    '/api-keys/:id',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      try {
        const { data, error } = await getSupabaseAdmin()
          .from('api_keys')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', request.params.id)
          .eq('founder_id', founderId)
          .is('revoked_at', null)
          .select('id')
          .single();

        if (error || !data) return reply.status(404).send({ error: 'Key not found or already revoked' });
        return reply.send({ revoked: true, id: request.params.id });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'DELETE /api-keys/:id' } });
        return reply.status(500).send({ error: 'Failed to revoke key' });
      }
    }
  );

  // ── v1 external API ──────────────────────────────────────────────────────────

  /**
   * GET /v1/me
   * Returns founder profile for the API key owner.
   * @security API key in X-API-Key header. Returns only the key owner's data.
   */
  server.get('/v1/me', async (request, reply) => {
    const founderId = await verifyApiKey(request, reply);
    if (!founderId) return;

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('founders')
        .select('id, email, name, plan, token_balance, onboarding_step, created_at')
        .eq('id', founderId)
        .is('deleted_at', null)
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Founder not found' });
      return reply.send({ founder: data });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /v1/me' } });
      return reply.status(500).send({ error: 'Failed to fetch founder' });
    }
  });

  /**
   * GET /v1/products
   * Returns products for the API key owner. Supports ?workspace_id= filter.
   * @security API key in X-API-Key header. Returns only the key owner's products.
   */
  server.get<{ Querystring: { workspace_id?: string } }>(
    '/v1/products',
    async (request, reply) => {
      const founderId = await verifyApiKey(request, reply);
      if (!founderId) return;

      try {
        let query = getSupabaseAdmin()
          .from('products')
          .select('id, name, store_url, platform, category, markets, price_tier, confirmed_icp, workspace_id, created_at')
          .eq('founder_id', founderId)
          .order('created_at', { ascending: false });

        if (request.query.workspace_id) {
          query = query.eq('workspace_id', request.query.workspace_id);
        }

        const { data, error } = await query;
        if (error) throw error;
        return reply.send({ products: data ?? [], total: data?.length ?? 0 });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /v1/products' } });
        return reply.status(500).send({ error: 'Failed to fetch products' });
      }
    }
  );
}
