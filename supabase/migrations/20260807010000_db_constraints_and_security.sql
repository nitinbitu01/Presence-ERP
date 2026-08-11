-- Migration 20260807010000_db_constraints_and_security.sql

-- 1. Check constraints on core tables (Tier 4A)
ALTER TABLE public.class_sessions 
  ADD CONSTRAINT sessions_geo_lat CHECK (geo_lat BETWEEN -90 AND 90),
  ADD CONSTRAINT sessions_geo_lng CHECK (geo_lng BETWEEN -180 AND 180),
  ADD CONSTRAINT sessions_radius_positive CHECK (radius_m > 0),
  ADD CONSTRAINT sessions_time_order CHECK (ends_at > starts_at);

ALTER TABLE public.attendance_ledger
  ADD CONSTRAINT ledger_similarity_range CHECK (similarity IS NULL OR (similarity >= -1 AND similarity <= 1)),
  ADD CONSTRAINT ledger_trust_range CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 100)),
  ADD CONSTRAINT ledger_no_self_reference CHECK (previous_entry_id IS DISTINCT FROM id);

ALTER TABLE public.webauthn_credentials
  ADD CONSTRAINT webauthn_counter_positive CHECK (counter >= 0);

-- 2. Index on previous_entry_id for ledger hash chain traversal (Tier 4B)
CREATE INDEX CONCURRENTLY IF NOT EXISTS 
  attendance_ledger_previous_entry_id_idx 
  ON public.attendance_ledger (previous_entry_id)
  WHERE previous_entry_id IS NOT NULL;

-- 3. Lockdown feature_flags RLS (Tier 3C)
DROP POLICY IF EXISTS anyone_read_feature_flags ON public.feature_flags;
CREATE POLICY ff_admin_read ON public.feature_flags
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- 4. Update ledger compute hash trigger to resolve previous_entry_id automatically (Tier 3B) and use UTC timestamp (Tier 4C)
CREATE OR REPLACE FUNCTION public.attendance_ledger_compute_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev_id uuid;
  prev_hash text;
BEGIN
  -- Automatically resolve the true latest entry in the database (resolves application-side race condition)
  SELECT id, record_hash INTO prev_id, prev_hash
  FROM public.attendance_ledger
  WHERE session_id = NEW.session_id AND student_id = NEW.student_id
  ORDER BY created_at DESC LIMIT 1;

  NEW.previous_entry_id := prev_id;

  NEW.record_hash := encode(
    digest(
      coalesce(prev_hash, 'GENESIS') || '|' ||
      NEW.session_id::text || '|' ||
      NEW.student_id::text || '|' ||
      NEW.decision::text || '|' ||
      coalesce(NEW.similarity::text, '') || '|' ||
      coalesce(NEW.geo_lat::text, '') || '|' ||
      coalesce(NEW.geo_lng::text, '') || '|' ||
      coalesce(NEW.ip::text, '') || '|' ||
      coalesce(NEW.device_fp_hash, '') || '|' ||
      coalesce(NEW.gate_reasons::text, '') || '|' ||
      coalesce(NEW.trust_score::text, '') || '|' ||
      (NEW.created_at AT TIME ZONE 'UTC')::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;
