-- Performance indexes for attendance_ledger
-- Composite index for previous_entry_id resolution (used 3x in submitAttendance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  attendance_ledger_session_student_created
  ON public.attendance_ledger (session_id, student_id, created_at DESC);

-- Index for multi-student device-flag scan (prevents full table scan on every check-in)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  attendance_ledger_device_fp_hash
  ON public.attendance_ledger (device_fp_hash, created_at DESC)
  WHERE device_fp_hash IS NOT NULL;
