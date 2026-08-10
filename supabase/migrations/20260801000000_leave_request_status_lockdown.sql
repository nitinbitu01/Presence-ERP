-- Phase 1.1: Fix OD/Leave self-approval RLS hole
-- 1. Create BEFORE INSERT trigger to force status := 'pending', approved_by := NULL, reviewed_at := NULL for student leave requests
CREATE OR REPLACE FUNCTION public.lockdown_leave_request_status()
RETURNS TRIGGER AS $$
BEGIN
  -- If invoked by service_role or admin role, preserve review fields
  IF current_setting('role', true) = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  -- For student / regular user insert, force pending status and wipe approval fields
  NEW.status := 'pending';
  NEW.approved_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lockdown_leave_request_status ON public.leave_requests;
CREATE TRIGGER trg_lockdown_leave_request_status
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.lockdown_leave_request_status();

-- 2. Tighten RLS Policy on leave_requests FOR INSERT
DROP POLICY IF EXISTS "student_insert_own_leave_requests" ON public.leave_requests;
CREATE POLICY "student_insert_own_leave_requests" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = student_id AND
    status = 'pending' AND
    approved_by IS NULL AND
    reviewed_at IS NULL
  );

-- 3. Also lockdown staff_leave_requests FOR INSERT
DROP POLICY IF EXISTS "staff_leave_self_insert" ON public.staff_leave_requests;
CREATE POLICY "staff_leave_self_insert" ON public.staff_leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = employee_id AND
    status = 'pending' AND
    approved_by IS NULL AND
    reviewed_at IS NULL
  );
