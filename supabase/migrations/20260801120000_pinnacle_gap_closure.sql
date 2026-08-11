-- ============================================================================
-- Migration: Pinnacle Enterprise Gap Closure (Selected 4 Features)
-- Description: Attendance policy grace periods, student disputes table,
--              and spatial polygon/beacon tables.
-- ============================================================================

-- 1. Add Grace Period Columns to class_sessions
ALTER TABLE IF EXISTS class_sessions
ADD COLUMN IF NOT EXISTS grace_period_mins INTEGER DEFAULT 10 CHECK (grace_period_mins >= 0),
ADD COLUMN IF NOT EXISTS late_cutoff_mins INTEGER DEFAULT 20 CHECK (late_cutoff_mins >= grace_period_mins);

-- 2. Create Attendance Disputes Table
CREATE TABLE IF NOT EXISTS attendance_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  proof_attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  resolved_by UUID REFERENCES profiles(user_id),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attendance_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_disputes_read" ON attendance_disputes
  FOR SELECT USING (
    auth.uid() = student_id OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

CREATE POLICY "attendance_disputes_insert" ON attendance_disputes
  FOR INSERT WITH CHECK (
    auth.uid() = student_id
  );

CREATE POLICY "attendance_disputes_update" ON attendance_disputes
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );
