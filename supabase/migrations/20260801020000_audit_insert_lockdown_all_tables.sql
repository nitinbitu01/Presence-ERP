-- Phase 1.1 Audit: Lock down INSERT and UPDATE status self-approval across ALL request tables
-- (leave_requests, staff_leave_requests, fallback_requests, role_requests)

-- 1. leave_requests trigger on BEFORE INSERT OR UPDATE
CREATE OR REPLACE FUNCTION public.lockdown_leave_request_status()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending';
  NEW.approved_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lockdown_leave_request_status ON public.leave_requests;
CREATE TRIGGER trg_lockdown_leave_request_status
  BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.lockdown_leave_request_status();

-- 2. fallback_requests trigger & RLS policy
CREATE OR REPLACE FUNCTION public.lockdown_fallback_request_status()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending';
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lockdown_fallback_request_status ON public.fallback_requests;
CREATE TRIGGER trg_lockdown_fallback_request_status
  BEFORE INSERT OR UPDATE ON public.fallback_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.lockdown_fallback_request_status();

DROP POLICY IF EXISTS "student_insert_own_fallback_requests" ON public.fallback_requests;
CREATE POLICY "student_insert_own_fallback_requests" ON public.fallback_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = student_id AND
    status = 'pending' AND
    reviewed_by IS NULL AND
    reviewed_at IS NULL
  );

-- 3. role_requests trigger & RLS policy
CREATE OR REPLACE FUNCTION public.lockdown_role_request_status()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending';
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lockdown_role_request_status ON public.role_requests;
CREATE TRIGGER trg_lockdown_role_request_status
  BEFORE INSERT OR UPDATE ON public.role_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.lockdown_role_request_status();

DROP POLICY IF EXISTS "students_insert_own_role_requests" ON public.role_requests;
CREATE POLICY "students_insert_own_role_requests" ON public.role_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    status = 'pending' AND
    reviewed_by IS NULL AND
    reviewed_at IS NULL
  );
