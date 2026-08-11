-- Phase 0 fix #1: session_otp / otp_generated_at were added to public.class_sessions
-- by 20260721190000_erp_and_security_hardening.sql with no column-level restriction.
-- class_sessions has RLS policy "class_sessions_read_enrolled" (from
-- 20260709143622_...sql) granting full-ROW select to enrolled students. Postgres RLS
-- filters rows, not columns, so any enrolled student could read session_otp directly
-- via the Supabase client (`.from('class_sessions').select('session_otp')`) without
-- ever seeing the teacher's screen -- defeating the whole point of the rotating OTP
-- factor.
--
-- Fix: move both columns to a table that `authenticated`/`anon` have NO grant on at
-- all (not even filtered by RLS -- blocked at the privilege layer), mirroring the
-- pattern already used correctly for rate_limit_attempts
-- (20260721190000_erp_and_security_hardening.sql) and face_embeddings
-- (`using (false)`, 20260709143622_...sql). Only service_role (i.e. server-side code
-- using supabaseAdmin) can read or write it.

CREATE TABLE public.session_otp_secrets (
  session_id uuid PRIMARY KEY REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  session_otp text,
  otp_generated_at timestamptz
);

-- No GRANT to authenticated/anon at all -- unlike class_sessions, which grants
-- select/insert/update/delete to authenticated and relies on RLS alone.
GRANT ALL ON public.session_otp_secrets TO service_role;

ALTER TABLE public.session_otp_secrets ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated: blocked from client-side queries entirely, same as
-- rate_limit_attempts.

-- Carry forward any OTP already generated for an in-progress session so a session
-- mid-flight isn't broken by this migration.
INSERT INTO public.session_otp_secrets (session_id, session_otp, otp_generated_at)
SELECT id, session_otp, otp_generated_at
FROM public.class_sessions
WHERE session_otp IS NOT NULL;

ALTER TABLE public.class_sessions
  DROP COLUMN IF EXISTS session_otp,
  DROP COLUMN IF EXISTS otp_generated_at;
