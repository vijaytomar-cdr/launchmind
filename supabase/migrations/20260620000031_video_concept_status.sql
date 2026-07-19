/**
 * @migration 20260620_000031_video_concept_status
 * @description Adds 'concept' status to content_assets for video scripts awaiting
 *   owner selection before Creatomate render. Adds render_started_at to track
 *   when a concept transitions to active rendering.
 */

-- Drop the existing inline status check (auto-named by Postgres)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_name = 'content_assets'
    AND tc.constraint_type = 'CHECK'
    AND ccu.column_name = 'status'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE content_assets DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

-- Re-add with 'concept' included
ALTER TABLE content_assets
  ADD CONSTRAINT content_assets_status_check
  CHECK (status IN ('pending','approved','rejected','auto_approved','held','concept'));

-- Track when owner triggers Creatomate render for a concept
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS render_started_at TIMESTAMPTZ;
