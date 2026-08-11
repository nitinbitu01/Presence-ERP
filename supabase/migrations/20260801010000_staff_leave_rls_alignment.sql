-- Phase 2.2: Staff leave RLS alignment with student leave
-- Ensure authenticated employees can INSERT staff_leave_requests with status='pending'
GRANT INSERT ON public.staff_leave_requests TO authenticated;

DROP POLICY IF EXISTS "staff_leave_self_insert" ON public.staff_leave_requests;
CREATE POLICY "staff_leave_self_insert" ON public.staff_leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = employee_id AND
    status = 'pending' AND
    approved_by IS NULL AND
    reviewed_at IS NULL
  );
