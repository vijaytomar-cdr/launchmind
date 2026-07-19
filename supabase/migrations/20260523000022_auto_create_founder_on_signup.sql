-- Migration: 20260523_000022_auto_create_founder_on_signup.sql
-- Creates a Postgres trigger on auth.users so that every new Supabase Auth
-- sign-up automatically gets a corresponding founders row.
-- Idempotent: DROP IF EXISTS + CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.founders (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
