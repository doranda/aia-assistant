-- 019_fix_user_triggers.sql
-- Fix handle_new_user and handle_user_login triggers.
--
-- Root cause (2026-04-02 incident): two teammates (Alvin, Philip) registered
-- but never appeared on team dashboard. auth.users rows existed; profiles rows
-- did not. The trigger from 003_team_roles.sql fails silently because:
--   1. SECURITY DEFINER without SET search_path — runs with the auth-admin
--      role's minimal search_path, which doesn't reliably include `public`.
--   2. `ON CONFLICT (id) DO NOTHING` + NULL email (SSO edge cases) can raise
--      NOT NULL on profiles.email which then propagates up and is swallowed
--      by Supabase's auth-service error handler.
--
-- Fix: pin search_path, COALESCE NULLable columns, keep conflict-safe insert.
-- The application POST /api/team handler also now explicitly upserts the
-- profile row (belt-and-suspenders).

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_login()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles SET last_login = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- Triggers themselves are fine (from 003); no need to drop/recreate.

COMMIT;
