-- Phase 2 item 2 (hardening work order): "retention_until already exists -- wire
-- up an actual deletion job that respects it." Until now, biometric_consent.
-- retention_until was collected at consent time but nothing ever read it back --
-- the only working erasure path was withdrawBiometric() in admin.functions.ts,
-- which is student-initiated (the "right to erasure" workflow), not automatic
-- time-based retention enforcement.
--
-- This adds a SECURITY DEFINER function that erases biometric data for any
-- consent row whose retention window has passed, and schedules it via pg_cron
-- (Supabase's supported extension for this) to run daily. A matching
-- admin-callable server function (runBiometricRetentionSweep in
-- admin.functions.ts) calls the same function directly, so retention enforcement
-- still works even on a Supabase plan/self-host setup where pg_cron isn't
-- available -- wire that up to an external scheduler (e.g. a scheduled GitHub
-- Action or Vercel Cron hitting an admin endpoint) as a fallback.

CREATE OR REPLACE FUNCTION public.enforce_biometric_retention()
RETURNS TABLE(erased_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  CREATE TEMP TABLE _expired_consent ON COMMIT DROP AS
    SELECT student_id
    FROM public.biometric_consent
    WHERE retention_until IS NOT NULL
      AND retention_until < now()
      AND withdrawn_at IS NULL; -- already-withdrawn students are already erased

  DELETE FROM public.face_embeddings
  WHERE student_id IN (SELECT student_id FROM _expired_consent);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.biometric_consent
  SET withdrawn_at = now()
  WHERE student_id IN (SELECT student_id FROM _expired_consent);

  INSERT INTO public.biometric_withdrawals (student_id, reason)
  SELECT student_id, 'retention_period_expired' FROM _expired_consent;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_biometric_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_biometric_retention() TO service_role;

-- Schedule via pg_cron, if available. Wrapped in exception handling so this
-- migration still applies cleanly on a project where pg_cron hasn't been
-- enabled (e.g. some self-hosted setups, or before enabling it in the Supabase
-- dashboard's Database > Extensions page) -- the function above still works via
-- the admin-callable fallback either way.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'biometric-retention-sweep';

  PERFORM cron.schedule(
    'biometric-retention-sweep',
    '0 3 * * *', -- daily at 03:00 UTC
    $sql$SELECT public.enforce_biometric_retention();$sql$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (% ). Enable the pg_cron extension in the Supabase dashboard, or call runBiometricRetentionSweep via an external scheduler instead.', SQLERRM;
END;
$$;
