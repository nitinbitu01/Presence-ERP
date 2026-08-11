-- Migration: enrollment_review_queue
-- Borderline-match review queue for face enrollment.
-- Created as part of the enrollment pipeline hardening (multi-frame + quality gate pass).
--
-- When a new enrollee's embedding similarity against an existing enrolled face falls in the
-- borderline range [THRESHOLD_REVIEW=0.70, THRESHOLD_MATCH=0.82), the enrollment is allowed
-- to proceed (student is NOT left in limbo) but a row is inserted here for admin review.
-- An admin can later APPROVE (no action on embeddings) or REJECT (deactivate the embedding
-- and flag the account for re-enrollment).
--
-- RLS design:
--   admins        → full access (SELECT / UPDATE / INSERT via service role insert, UPDATE by admin)
--   students      → SELECT only their own status via the my_enrollment_review_status view;
--                   they cannot see the embedding ciphertext or the matched_student_id.

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enrollment_review_queue (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The student who just enrolled and whose embedding triggered the borderline match.
  student_id                      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- AES-GCM ciphertext of the candidate embedding (same format as face_embeddings.ciphertext:
  -- hex string with \x prefix, versioned layout from attendance-crypto.server.ts).
  -- Stored here so admins can later decrypt and inspect if needed; never exposed to students.
  candidate_embedding_ciphertext  TEXT          NOT NULL,

  -- The existing enrolled student whose face was the closest match.
  -- Nullable because the matched row might be deleted before review completes.
  matched_student_id              UUID          REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Cosine similarity score that triggered the borderline flag (0.70 – <0.82).
  similarity                      NUMERIC(6,5)  NOT NULL CHECK (similarity >= 0 AND similarity <= 1),

  -- Review lifecycle status.
  status                          TEXT          NOT NULL DEFAULT 'pending'
                                                CHECK (status IN ('pending', 'approved', 'rejected')),

  -- Which admin performed the review (NULL until reviewed).
  reviewed_by                     UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at                     TIMESTAMPTZ   NULL,

  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.enrollment_review_queue IS
  'Borderline face-match review queue. Rows are inserted when a new enrollment produces a '
  'cosine similarity in [THRESHOLD_REVIEW=0.70, THRESHOLD_MATCH=0.82) against an existing '
  'enrolled face. Enrollment proceeds; admins approve or reject here.';

COMMENT ON COLUMN public.enrollment_review_queue.candidate_embedding_ciphertext IS
  'AES-GCM-256 ciphertext of the incoming embedding (same hex \x format as face_embeddings). '
  'Service-role and admin access only — never returned to the student via any RLS policy.';

-- ── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.enrollment_review_queue ENABLE ROW LEVEL SECURITY;

-- Admins: full read + write access (update status/reviewed_by/reviewed_at).
-- INSERT is performed by saveEnrollment via service_role (bypasses RLS).
CREATE POLICY "enrollment_review_queue: admins full access"
  ON public.enrollment_review_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- Service role: unrestricted (needed for saveEnrollment inserts and reviewEnrollmentMatch updates).
-- Supabase service_role always bypasses RLS — no explicit policy needed, but documented here
-- for clarity alongside the other policies.

-- Students: deliberately CANNOT query this table directly.
-- They get a restricted view (below) that strips sensitive columns.

-- ── Student-facing status view ─────────────────────────────────────────────
-- Exposes only: id, student_id, similarity, status, created_at.
-- Strips: candidate_embedding_ciphertext, matched_student_id, reviewed_by.
-- Uses auth.uid() filter so each student only sees their own row(s).

CREATE OR REPLACE VIEW public.my_enrollment_review_status AS
  SELECT
    id,
    student_id,
    similarity,
    status,
    created_at
  FROM public.enrollment_review_queue
  WHERE student_id = auth.uid();

-- Allow authenticated users to SELECT from the restricted view only.
GRANT SELECT ON public.my_enrollment_review_status TO authenticated;

-- Full table access for admins (via RLS policy above) and service_role.
GRANT ALL ON public.enrollment_review_queue TO service_role;
GRANT SELECT, UPDATE ON public.enrollment_review_queue TO authenticated;
-- (UPDATE is gated by the admin-only RLS policy above; authenticated users with no admin role
-- will be blocked by RLS even though the GRANT exists at the privilege level.)

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_erq_student_id
  ON public.enrollment_review_queue (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_erq_status
  ON public.enrollment_review_queue (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_erq_matched_student
  ON public.enrollment_review_queue (matched_student_id)
  WHERE matched_student_id IS NOT NULL;
