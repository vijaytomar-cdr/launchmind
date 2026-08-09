/**
 * @migration 20260708_000055_execution_calendar
 * @description Authored calendar events for the execution calendar.
 *   Merged with derived events (from campaigns.scheduled_at, experiments.start_date,
 *   weekly_briefs.sent_at) at the API layer — only authored events live here.
 * @security RLS founder-scoped.
 */

CREATE TABLE IF NOT EXISTS execution_calendar_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id     UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id) ON DELETE CASCADE,
  campaign_id    UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  experiment_id  UUID REFERENCES experiments(id) ON DELETE SET NULL,

  type           TEXT NOT NULL CHECK (type IN (
                   'campaign_launch', 'experiment_window', 'content_publish',
                   'aso_update', 'review_push', 'brief_sent', 'product_launch',
                   'holiday_campaign', 'custom'
                 )),
  title          TEXT NOT NULL,
  description    TEXT,
  start_date     TIMESTAMPTZ NOT NULL,
  end_date       TIMESTAMPTZ,
  all_day        BOOLEAN NOT NULL DEFAULT false,
  timezone       TEXT NOT NULL DEFAULT 'UTC',

  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),

  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE execution_calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calendar_events_owner" ON execution_calendar_events;
CREATE POLICY "calendar_events_owner" ON execution_calendar_events USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS calendar_events_range ON execution_calendar_events(founder_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS calendar_events_campaign ON execution_calendar_events(campaign_id)
  WHERE campaign_id IS NOT NULL;
