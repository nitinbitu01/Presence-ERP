-- Enrollment photos table with locked-down RLS pattern
-- Service-role-only writes, student reads only their own row.
-- Automatically erased on the same retention schedule as face_embeddings.

CREATE TABLE IF NOT EXISTS public.enrollment_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  algo text NOT NULL DEFAULT 'AES-GCM-256',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrollment_photos_student_id_idx ON public.enrollment_photos(student_id);

ALTER TABLE public.enrollment_photos ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.enrollment_photos TO service_role;
GRANT SELECT ON public.enrollment_photos TO authenticated;

DROP POLICY IF EXISTS "enrollment_photos_read_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_read_own" ON public.enrollment_photos
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

-- Update retention enforcement function to clean up enrollment_photos as well
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
      AND withdrawn_at IS NULL;

  DELETE FROM public.face_embeddings
  WHERE student_id IN (SELECT student_id FROM _expired_consent);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.enrollment_photos
  WHERE student_id IN (SELECT student_id FROM _expired_consent);

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
