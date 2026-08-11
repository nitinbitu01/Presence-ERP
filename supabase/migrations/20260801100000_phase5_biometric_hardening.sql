-- Phase 5: Biometric & Anti-Proxy Hardening
-- 5.1 Liveness attestation session log
-- 5.2 Key rotation job tracking
-- 5.3 Hardware biometric adapter tables

-- ── 5.1  liveness_sessions ─────────────────────────────────────────────────
-- Records every server-side liveness check outcome.
-- Session IDs are vendor-issued (AWS Rekognition / fallback HMAC token) and
-- short-lived (3 min AWS TTL). We never store the raw SDK session token;
-- only the outcome (confidence, method, pass/fail) flows here.
CREATE TABLE IF NOT EXISTS public.liveness_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  vendor_session_id TEXT      NOT NULL,               -- opaque AWS / FaceTec token
  method          TEXT        NOT NULL DEFAULT 'rekognition'
                              CHECK (method IN ('rekognition','webauthn_bypass','hmac_fallback')),
  outcome         TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (outcome IN ('pending','passed','failed','error')),
  confidence      REAL        NULL,                   -- 0–100, NULL for non-SDK paths
  error_detail    TEXT        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ NULL
);

ALTER TABLE public.liveness_sessions ENABLE ROW LEVEL SECURITY;

-- Students may only see their own liveness records; server inserts via service role.
CREATE POLICY "liveness_sessions: students read own"
  ON public.liveness_sessions FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "liveness_sessions: service role full access"
  ON public.liveness_sessions FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_liveness_sessions_student ON public.liveness_sessions(student_id, created_at DESC);
CREATE INDEX idx_liveness_sessions_vendor  ON public.liveness_sessions(vendor_session_id);

-- ── 5.2a  key_rotation_jobs ────────────────────────────────────────────────
-- Tracks progress of the AES-GCM re-encryption background job.
-- The job is idempotent: rows with key_version = CURRENT_VERSION are skipped.
CREATE TABLE IF NOT EXISTS public.key_rotation_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID        REFERENCES public.profiles(user_id),
  target_version  INT         NOT NULL,               -- desired key version after job
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ NULL,
  rows_processed  INT         NOT NULL DEFAULT 0,
  rows_remaining  INT         NOT NULL DEFAULT 0,
  error_count     INT         NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','completed','failed','partial'))
);

ALTER TABLE public.key_rotation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "key_rotation_jobs: admins only"
  ON public.key_rotation_jobs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ── 5.2b  Add key_version to face_embeddings if missing ───────────────────
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'face_embeddings'
      AND column_name  = 'key_version'
  ) THEN
    ALTER TABLE public.face_embeddings ADD COLUMN key_version INT NOT NULL DEFAULT 0;
    COMMENT ON COLUMN public.face_embeddings.key_version IS
      'Biometric encryption key version. 0 = legacy (BIOMETRIC_ENC_KEY), N = BIOMETRIC_ENC_KEY_VN. '
      'Re-encryption job advances this to BIOMETRIC_ENC_KEY_CURRENT_VERSION.';
  END IF;
END
$$;

-- ── 5.3  hardware_checkins ─────────────────────────────────────────────────
-- Optional hardware biometric adapter output (fingerprint / RFID).
-- Reconciled with attendance_ledger by the same append-only logic.
CREATE TABLE IF NOT EXISTS public.hardware_checkins (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  session_id      UUID        REFERENCES public.class_sessions(id),
  hardware_type   TEXT        NOT NULL CHECK (hardware_type IN ('fingerprint','rfid','nfc')),
  reader_id       TEXT        NOT NULL,               -- physical device identifier
  checkin_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload     JSONB       NOT NULL DEFAULT '{}',  -- vendor-specific verification data
  verified        BOOLEAN     NOT NULL DEFAULT FALSE,
  error_detail    TEXT        NULL
);

ALTER TABLE public.hardware_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hardware_checkins: service role full access"
  ON public.hardware_checkins FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "hardware_checkins: students read own"
  ON public.hardware_checkins FOR SELECT
  USING (auth.uid() = student_id);

CREATE INDEX idx_hardware_checkins_student ON public.hardware_checkins(student_id, checkin_at DESC);
CREATE INDEX idx_hardware_checkins_session ON public.hardware_checkins(session_id);

-- ── 5.1b  Add liveness_method to attendance_events ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'attendance_events'
      AND column_name  = 'liveness_method'
  ) THEN
    ALTER TABLE public.attendance_events
      ADD COLUMN liveness_method TEXT NULL
      CHECK (liveness_method IN ('rekognition','webauthn_bypass','hmac_fallback','hardware'));
    COMMENT ON COLUMN public.attendance_events.liveness_method IS
      'Which liveness verification path was used for this event. NULL = legacy (pre-Phase 5).';
  END IF;
END
$$;

-- ── 5.1c  Add hardware_checkin to event_type allowed values ───────────────
DO $$
BEGIN
  -- attendance_events.event_type is TEXT (no enum), so just document allowed values in comment.
  COMMENT ON COLUMN public.attendance_events.event_type IS
    'Values: check_in | check_out | manual_correction | spot_check | hardware_checkin';
END
$$;
