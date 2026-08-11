-- Task 2: Voice enrollment columns for the review-queue secondary check.
-- Extends biometric_consent with an optional voice passphrase enrollment.
-- When a student's face-match similarity lands in [THRESHOLD_REVIEW, THRESHOLD_MATCH)
-- (0.75–0.82), they can verify by voice instead of waiting for manual teacher approval.
--
-- HONEST SCOPE NOTE: This is transcript correctness + basic liveness (duration, amplitude
-- variance), NOT true speaker-verification (no embedding model). Full voiceprint/speaker-id
-- needs a real ML model (e.g. TensorFlow.js speaker-id or resemblyzer-style embeddings),
-- which is heavier than this codebase's current client-side ML footprint (face-api.js only).
-- That is a documented future upgrade path, not a shipped feature.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'biometric_consent'
      AND column_name  = 'voice_enrolled'
  ) THEN
    ALTER TABLE public.biometric_consent
      ADD COLUMN voice_enrolled BOOLEAN NOT NULL DEFAULT FALSE;
    COMMENT ON COLUMN public.biometric_consent.voice_enrolled IS
      'Whether the student enrolled a voice passphrase for the review-queue secondary check.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'biometric_consent'
      AND column_name  = 'voice_passphrase_hash'
  ) THEN
    ALTER TABLE public.biometric_consent
      ADD COLUMN voice_passphrase_hash TEXT NULL;
    COMMENT ON COLUMN public.biometric_consent.voice_passphrase_hash IS
      'HMAC-SHA256 hash of the enrollment passphrase. Never store the plaintext passphrase.';
  END IF;
END
$$;