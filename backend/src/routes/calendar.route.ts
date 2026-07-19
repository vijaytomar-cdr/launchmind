/**
 * @file calendar.route.ts
 * @description Execution calendar — authored events + derived events merged.
 *   GET /calendar returns a unified view of: authored events, campaign scheduled_at,
 *   experiment windows, and weekly brief dates.
 *   POST/PUT/DELETE manage authored execution_calendar_events.
 * @security JWT required. Founder ownership enforced.
 * @dependencies supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  'campaign_launch', 'experiment_window', 'content_publish', 'aso_update',
  'review_push', 'brief_sent', 'product_launch', 'holiday_campaign', 'custom',
] as const;

const CreateEventSchema = z.object({
  productId:    z.string().uuid().optional(),
  campaignId:   z.string().uuid().optional(),
  experimentId: z.string().uuid().optional(),
  type:         z.enum(EVENT_TYPES),
  title:        z.string().min(1).max(200),
  description:  z.string().max(1000).optional(),
  startDate:    z.string().datetime(),
  endDate:      z.string().datetime().optional(),
  allDay:       z.boolean().optional().default(false),
  timezone:     z.string().optional().default('UTC'),
  metadata:     z.record(z.unknown()).optional(),
});

const UpdateEventSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  startDate:   z.string().datetime().optional(),
  endDate:     z.string().datetime().optional().nullable(),
  allDay:      z.boolean().optional(),
  status:      z.enum(['scheduled', 'completed', 'missed', 'cancelled']).optional(),
  metadata:    z.record(z.unknown()).optional(),
});

const RangeQuerySchema = z.object({
  from:      z.string().optional(),
  to:        z.string().optional(),
  productId: z.string().uuid().optional(),
  type:      z.string().optional(),
  limit:     z.coerce.number().min(1).max(500).optional().default(100),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

async function calendarPlugin(server: FastifyInstance): Promise<void> {

  /**
   * GET /calendar
   * Returns a merged view: authored events + derived events from campaigns/experiments/briefs.
   */
  server.get('/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = RangeQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query' });

    const supabase = getSupabaseAdmin();

    try {
      const from = parsed.data.from ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const to   = parsed.data.to   ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

      // Fetch in parallel: authored events, campaigns, experiments, briefs
      const [eventsRes, campaignsRes, experimentsRes, briefsRes] = await Promise.all([
        supabase.from('execution_calendar_events')
          .select('id, type, title, description, start_date, end_date, all_day, status, campaign_id, experiment_id, metadata')
          .eq('founder_id', founderId)
          .gte('start_date', from)
          .lte('start_date', to)
          .order('start_date'),

        supabase.from('campaigns')
          .select('id, type, channel, market, status, scheduled_at, launched_at')
          .eq('founder_id', founderId)
          .not('scheduled_at', 'is', null)
          .gte('scheduled_at', from)
          .lte('scheduled_at', to),

        supabase.from('experiments')
          .select('id, title, experiment_type, status, start_date, end_date')
          .eq('founder_id', founderId)
          .not('start_date', 'is', null)
          .gte('start_date', from.slice(0, 10))
          .lte('start_date', to.slice(0, 10))
          .is('archived_at', null),

        supabase.from('weekly_briefs')
          .select('id, week_of, status, sent_at')
          .eq('founder_id', founderId)
          .gte('week_of', from.slice(0, 10))
          .lte('week_of', to.slice(0, 10))
          .order('week_of'),
      ]);

      // Normalize to unified CalendarEvent shape
      const events: Array<Record<string, unknown>> = [];

      for (const e of eventsRes.data ?? []) {
        events.push({ id: e.id, source: 'authored', type: e.type, title: e.title, description: e.description, startDate: e.start_date, endDate: e.end_date, allDay: e.all_day, status: e.status, campaignId: e.campaign_id, experimentId: e.experiment_id, metadata: e.metadata });
      }

      for (const c of campaignsRes.data ?? []) {
        events.push({ id: `campaign-${c.id}`, source: 'campaign', type: 'campaign_launch', title: `Campaign: ${c.type ?? c.channel} (${c.market})`, startDate: c.scheduled_at, allDay: false, status: c.status, campaignId: c.id });
      }

      for (const e of experimentsRes.data ?? []) {
        events.push({ id: `exp-${e.id}`, source: 'experiment', type: 'experiment_window', title: `Experiment: ${e.title}`, startDate: e.start_date, endDate: e.end_date, allDay: true, status: e.status, experimentId: e.id });
      }

      for (const b of briefsRes.data ?? []) {
        events.push({ id: `brief-${b.id}`, source: 'brief', type: 'brief_sent', title: `Weekly Brief (${b.week_of})`, startDate: b.sent_at ?? b.week_of, allDay: !b.sent_at, status: b.status === 'sent' ? 'completed' : 'scheduled', briefId: b.id });
      }

      // Sort by startDate
      events.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

      return reply.send({ events, from, to, total: events.length });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to load calendar' });
    }
  });

  /**
   * POST /calendar
   * Create an authored calendar event.
   */
  server.post('/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const { data: event, error } = await supabase
        .from('execution_calendar_events')
        .insert({
          founder_id:    founderId,
          product_id:    parsed.data.productId ?? null,
          campaign_id:   parsed.data.campaignId ?? null,
          experiment_id: parsed.data.experimentId ?? null,
          type:          parsed.data.type,
          title:         parsed.data.title,
          description:   parsed.data.description ?? null,
          start_date:    parsed.data.startDate,
          end_date:      parsed.data.endDate ?? null,
          all_day:       parsed.data.allDay,
          timezone:      parsed.data.timezone,
          metadata:      parsed.data.metadata ?? null,
          status:        'scheduled',
        })
        .select()
        .single();

      if (error) throw error;

      return reply.status(201).send({ event });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to create event' });
    }
  });

  /**
   * PUT /calendar/:id
   * Update an authored calendar event.
   */
  server.put('/calendar/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const eventId = (request.params as { id: string }).id;

    const parsed = UpdateEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });

    const supabase = getSupabaseAdmin();

    try {
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.title !== undefined)       updatePayload.title = parsed.data.title;
      if (parsed.data.description !== undefined) updatePayload.description = parsed.data.description;
      if (parsed.data.startDate !== undefined)   updatePayload.start_date = parsed.data.startDate;
      if (parsed.data.endDate !== undefined)     updatePayload.end_date = parsed.data.endDate;
      if (parsed.data.allDay !== undefined)      updatePayload.all_day = parsed.data.allDay;
      if (parsed.data.status !== undefined)      updatePayload.status = parsed.data.status;
      if (parsed.data.metadata !== undefined)    updatePayload.metadata = parsed.data.metadata;

      const { data, error } = await supabase
        .from('execution_calendar_events')
        .update(updatePayload)
        .eq('id', eventId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Event not found' });

      return reply.send({ event: data });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to update event' });
    }
  });

  /**
   * DELETE /calendar/:id
   * Delete an authored calendar event.
   */
  server.delete('/calendar/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const eventId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { error } = await supabase
        .from('execution_calendar_events')
        .delete()
        .eq('id', eventId)
        .eq('founder_id', founderId);

      if (error) throw error;

      return reply.status(204).send();
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to delete event' });
    }
  });
}

export const calendarRoutes = fp(calendarPlugin);
