/**
 * @file jwtPlugin.ts
 * @description Fastify plugin for verifying Supabase JWTs.
 *   Validates the Bearer token by calling supabase.auth.getUser(token),
 *   which works regardless of signing algorithm (HS256, ES256, etc.) and
 *   requires no JWKS endpoint access from inside Docker.
 *   Adds request.jwtVerify() and request.user to every request.
 * @security Never logs the raw token. Throws 401 for any verification failure.
 *   Uses the admin client for validation — token itself comes from the caller.
 * @dependencies supabaseAdmin, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getSupabaseAdmin } from './supabaseAdmin';

declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify: () => Promise<void>;
    user: Record<string, unknown>;
  }
}

// fp() is required so decorations are visible to sibling/child route plugins
export const jwtPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorateRequest('user', null);

  fastify.decorateRequest('jwtVerify', async function (this: FastifyRequest) {
    const auth = this.headers.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    }
    const token = auth.slice(7);

    const supabase = getSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    }

    // Expose user as a JWT-payload-like object so getFounderId() (reads .sub) keeps working
    this.user = { sub: user.id, email: user.email };
  });
});
