-- ============================================================================
-- Migration: Phase 1–5 Enterprise Gap Closure
-- Description: Trigger for immutable audit logs, device timestamp offset tracking,
--              condonation credit tracking, and key rotation state persistence.
-- ============================================================================

-- 1. Immutable Audit Log Enforcement Trigger
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CRITICAL: audit_log table is append-only. UPDATE and DELETE operations are strictly prohibited for compliance reasons.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger if audit_log table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'audit_log') THEN
    IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgname = 'trg_prevent_audit_log_modification') THEN
      CREATE TRIGGER trg_prevent_audit_log_modification
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH STATEMENT
      EXECUTE FUNCTION prevent_audit_log_modification();
    END IF;
  END IF;
END $$;

-- 2. Device Timestamp Offset Column for Attendance Events
ALTER TABLE IF EXISTS attendance_events 
ADD COLUMN IF NOT EXISTS device_timestamp_offset_ms INTEGER DEFAULT 0;

-- 3. Condonation Credits Table for Medical/Sports Leave Attendance Offsets
CREATE TABLE IF NOT EXISTS condonation_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  credited_classes INTEGER NOT NULL DEFAULT 1 CHECK (credited_classes > 0),
  reason TEXT NOT NULL,
  approved_by UUID REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for condonation_credits
ALTER TABLE condonation_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "condonation_credits_select_policy" ON condonation_credits
  FOR SELECT USING (
    auth.uid() = student_id OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

CREATE POLICY "condonation_credits_admin_insert_policy" ON condonation_credits
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

-- 4. Teacher Substitute Delegations Table
CREATE TABLE IF NOT EXISTS teacher_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_teacher_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  substitute_teacher_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_range_check CHECK (valid_until > valid_from)
);

ALTER TABLE teacher_delegations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_delegations_read" ON teacher_delegations
  FOR SELECT USING (
    auth.uid() IN (primary_teacher_id, substitute_teacher_id) OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "teacher_delegations_write" ON teacher_delegations
  FOR INSERT WITH CHECK (
    auth.uid() = primary_teacher_id OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 5. Add Checkpoint Column to Key Rotation Jobs for Batch Resume
ALTER TABLE IF EXISTS key_rotation_jobs
ADD COLUMN IF NOT EXISTS last_processed_id UUID DEFAULT NULL;
