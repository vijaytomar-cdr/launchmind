-- Migration: 20260725_000070_fix_handle_new_user_email_conflict.sql
-- Fixes the on_auth_user_created trigger to handle re-signup after account deletion.
-- When auth.users is deleted via Supabase dashboard, the founders row is NOT cascaded
-- (no FK relationship). Re-signup with the same email hits a UNIQUE email constraint.
-- Fix: delete any stale founders row with matching email before inserting the new one.
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove any orphaned founders row left over from a deleted auth user with the same email.
  -- Auth itself enforces email uniqueness, so this only fires for genuinely new signups.
  -- FK ON DELETE CASCADE on child tables handles associated records automatically.
  DELETE FROM public.founders WHERE email = NEW.email AND id != NEW.id;

  INSERT INTO public.founders (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
