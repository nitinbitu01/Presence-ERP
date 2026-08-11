-- Single active session enforcement column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_session_id text;

COMMENT ON COLUMN public.profiles.active_session_id IS 'Unique token of the active session. When a new login occurs, this token updates and invalidates prior sessions.';
