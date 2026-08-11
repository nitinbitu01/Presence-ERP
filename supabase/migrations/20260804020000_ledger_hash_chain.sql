-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add hash chain column
ALTER TABLE public.attendance_ledger
  ADD COLUMN IF NOT EXISTS record_hash text;

COMMENT ON COLUMN public.attendance_ledger.record_hash IS 'SHA-256 hash chaining this row to the previous entry for tamper-evident verification';

-- Trigger to compute hash on insert
CREATE OR REPLACE FUNCTION public.attendance_ledger_compute_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev_hash text;
BEGIN
  -- Look up the hash of the previous entry in the chain
  IF new.previous_entry_id IS NOT NULL THEN
    SELECT record_hash INTO prev_hash
    FROM public.attendance_ledger
    WHERE id = new.previous_entry_id;
  END IF;

  new.record_hash := encode(
    digest(
      coalesce(prev_hash, 'GENESIS') || '|' ||
      new.session_id::text || '|' ||
      new.student_id::text || '|' ||
      new.decision::text || '|' ||
      coalesce(new.similarity::text, '') || '|' ||
      coalesce(new.trust_score::text, '') || '|' ||
      new.created_at::text,
      'sha256'
    ),
    'hex'
  );
  RETURN new;
END;
$$;

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS attendance_ledger_hash_before_insert ON public.attendance_ledger;

CREATE TRIGGER attendance_ledger_hash_before_insert
  BEFORE INSERT ON public.attendance_ledger
  FOR EACH ROW EXECUTE FUNCTION public.attendance_ledger_compute_hash();
