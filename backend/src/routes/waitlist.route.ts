/**
 * @file waitlist.route.ts
 * @description Public waitlist signup for LaunchMind pre-launch.
 *   POST /waitlist — no auth required, rate-limited by Fastify global rate limiter.
 *   GET /waitlist/count — public, returns total count (no emails).
 * @security
 *   - No auth required — public endpoint.
 *   - Email normalised (lowercased, trimmed) before DB write.
 *   - Duplicate email returns 409 with ALREADY_ON_WAITLIST code (not 500).
 *   - Emails NEVER returned in any response — only count.
 *   - Sentry captures unexpected DB errors only.
 * @dependencies supabaseAdmin, errorCodes
 */

import { FastifyInstance } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { errorBody, ErrorCodes } from '../lib/errorCodes';

const WaitlistBodySchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  name: z.string().max(100).trim().optional(),
  source: z.string().max(50).trim().optional(),
});

/**
 * Registers waitlist routes on the Fastify instance.
 * @param server - Fastify instance
 */
export async function waitlistRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /waitlist
   * Adds an email to the pre-launch waitlist.
   * Returns 201 on success, 409 if already registered, 400 for invalid input.
   */
  server.post(
    '/waitlist',
    async (request, reply) => {
      const parsed = WaitlistBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          errorBody(ErrorCodes.INVALID_BODY, 'Invalid request body', parsed.error.message)
        );
      }

      const { email, name, source } = parsed.data;

      const { error } = await getSupabaseAdmin()
        .from('waitlist')
        .insert({ email, name: name ?? null, source: source ?? null });

      if (error) {
        // Unique constraint violation = already on waitlist
        if (error.code === '23505') {
          return reply.status(409).send(
            errorBody(ErrorCodes.ALREADY_ON_WAITLIST, 'This email is already on the waitlist')
          );
        }
        Sentry.captureException(error, { tags: { route: 'POST /waitlist' } });
        return reply.status(500).send(errorBody(ErrorCodes.INTERNAL, 'Failed to join waitlist'));
      }

      return reply.status(201).send({ message: "You're on the list! We'll be in touch soon." });
    }
  );

  /**
   * GET /waitlist/count
   * Returns total waitlist signup count. Emails are never exposed.
   */
  server.get('/waitlist/count', async (_request, reply) => {
    const { count, error } = await getSupabaseAdmin()
      .from('waitlist')
      .select('*', { count: 'exact', head: true });

    if (error) {
      Sentry.captureException(error, { tags: { route: 'GET /waitlist/count' } });
      return reply.status(500).send(errorBody(ErrorCodes.INTERNAL, 'Failed to fetch count'));
    }

    return reply.send({ count: count ?? 0 });
  });
}
