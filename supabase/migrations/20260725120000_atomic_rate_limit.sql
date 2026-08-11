-- Phase 0 fix #2: checkRateLimit() in attendance-crypto.server.ts did a count
-- SELECT and an INSERT as two separate round trips. Concurrent requests for the
-- same key could all read the same (under-limit) count before any of their inserts
-- committed, so more than maxAttempts could get through -- a classic
-- check-then-insert race (TOCTOU).
--
-- Fix: do the count check and the insert inside a single Postgres function call,
-- serialized per-key with a transaction-scoped advisory lock
-- (pg_advisory_xact_lock). rate_limit_attempts is a row-per-attempt table (no
-- natural single row to SELECT ... FOR UPDATE before the first attempt for a key
-- exists), so an advisory lock keyed on hashtext(key) gives the same "only one
-- caller evaluates count+insert for this key at a time" guarantee that
-- SELECT ... FOR UPDATE would give for a single-row counter design, without
-- changing the existing table shape (which nothing else in the schema depends on
-- being row-per-attempt, so this is the smaller, safer change).
--
-- The lock is released automatically at the end of the calling transaction; each
-- RPC call from supabase-js runs in its own implicit transaction, so no explicit
-- release is needed.

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key text,
  p_max_attempts integer,
  p_window_ms bigint
)
RETURNS TABLE(allowed boolean, current_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_window_ms || ' milliseconds')::interval;
  v_count integer;
BEGIN
  -- Serialize concurrent callers for the same key so the count below and the
  -- insert it gates on can't race against another call for the same key.
  PERFORM pg_advisory_xact_lock(hashtext(p_key)::bigint);

  -- Global housekeeping delete of stale rows (same behavior as before: not
  -- scoped to this key, just a periodic sweep).
  DELETE FROM public.rate_limit_attempts WHERE attempted_at < v_cutoff;

  SELECT count(*) INTO v_count
  FROM public.rate_limit_attempts
  WHERE key = p_key AND attempted_at >= v_cutoff;

  IF v_count >= p_max_attempts THEN
    RETURN QUERY SELECT false, v_count;
  ELSE
    INSERT INTO public.rate_limit_attempts (key, attempted_at) VALUES (p_key, now());
    RETURN QUERY SELECT true, v_count + 1;
  END IF;
END;
$$;

-- Only the server (service_role) calls this, same as the rest of the rate
-- limiter's storage.
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, bigint) TO service_role;
