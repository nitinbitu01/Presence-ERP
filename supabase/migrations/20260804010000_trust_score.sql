-- Add trust score columns to attendance_ledger
ALTER TABLE public.attendance_ledger
  ADD COLUMN IF NOT EXISTS trust_score integer,
  ADD COLUMN IF NOT EXISTS trust_breakdown jsonb;

COMMENT ON COLUMN public.attendance_ledger.trust_score IS 'Composite 0-100 Proof-of-Presence trust score computed from 6 verification signals';
COMMENT ON COLUMN public.attendance_ledger.trust_breakdown IS 'Detailed JSON breakdown of each trust score component (liveness, spatial, device, network, temporal, otp)';
