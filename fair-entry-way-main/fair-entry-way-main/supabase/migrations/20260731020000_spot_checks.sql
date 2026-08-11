-- Migration for Mid-Session Spot Check Re-Verification
CREATE TABLE IF NOT EXISTS public.spot_check_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  session_id_token text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'passed' | 'failed' | 'timeout'
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.spot_check_requests TO service_role;
GRANT SELECT ON public.spot_check_requests TO authenticated;

ALTER TABLE public.spot_check_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spot_checks_self_read" ON public.spot_check_requests;
CREATE POLICY "spot_checks_self_read" ON public.spot_check_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id OR public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin'));
