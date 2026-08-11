
-- ============ attendance_events (immutable audit log) ============
CREATE TABLE public.attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('submit_attempt','liveness_fail','geofence_fail','time_window_fail','identity_fail','device_lock_fail','accepted','review','withdraw')),
  reason_code text,
  similarity double precision,
  ip text,
  user_agent text,
  gate_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.attendance_events TO authenticated;
GRANT ALL ON public.attendance_events TO service_role;
ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_events_admin_read ON public.attendance_events
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY attendance_events_teacher_read ON public.attendance_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.class_sessions s
    JOIN public.courses c ON c.id = s.course_id
    WHERE s.id = attendance_events.session_id AND c.teacher_id = auth.uid()
  ));

CREATE POLICY attendance_events_student_read ON public.attendance_events
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- Block updates/deletes at trigger level (append-only)
CREATE OR REPLACE FUNCTION public.attendance_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'attendance_events is append-only';
END;
$$;
CREATE TRIGGER attendance_events_no_update BEFORE UPDATE ON public.attendance_events
  FOR EACH ROW EXECUTE FUNCTION public.attendance_events_append_only();
CREATE TRIGGER attendance_events_no_delete BEFORE DELETE ON public.attendance_events
  FOR EACH ROW EXECUTE FUNCTION public.attendance_events_append_only();

CREATE INDEX attendance_events_session_idx ON public.attendance_events(session_id, created_at DESC);
CREATE INDEX attendance_events_student_idx ON public.attendance_events(student_id, created_at DESC);

-- ============ biometric_withdrawals ============
CREATE TABLE public.biometric_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.biometric_withdrawals TO authenticated;
GRANT ALL ON public.biometric_withdrawals TO service_role;
ALTER TABLE public.biometric_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY biometric_withdrawals_own_read ON public.biometric_withdrawals
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY biometric_withdrawals_admin_read ON public.biometric_withdrawals
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.biometric_withdrawals_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'biometric_withdrawals is append-only';
END;
$$;
CREATE TRIGGER biometric_withdrawals_no_update BEFORE UPDATE ON public.biometric_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.biometric_withdrawals_append_only();
CREATE TRIGGER biometric_withdrawals_no_delete BEFORE DELETE ON public.biometric_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.biometric_withdrawals_append_only();

-- ============ attendance_review_actions ============
CREATE TABLE public.attendance_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id uuid NOT NULL REFERENCES public.attendance_ledger(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('approved','rejected')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id)
);
GRANT SELECT, INSERT ON public.attendance_review_actions TO authenticated;
GRANT ALL ON public.attendance_review_actions TO service_role;
ALTER TABLE public.attendance_review_actions ENABLE ROW LEVEL SECURITY;

-- Reviewer must be teacher of the course OR admin
CREATE POLICY attendance_review_actions_insert ON public.attendance_review_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid() AND (
      private.has_role(auth.uid(), 'admin') OR
      EXISTS (
        SELECT 1 FROM public.attendance_ledger l
        JOIN public.class_sessions s ON s.id = l.session_id
        JOIN public.courses c ON c.id = s.course_id
        WHERE l.id = attendance_review_actions.ledger_id AND c.teacher_id = auth.uid()
      )
    )
  );

CREATE POLICY attendance_review_actions_read ON public.attendance_review_actions
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin') OR
    reviewer_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.attendance_ledger l
      WHERE l.id = attendance_review_actions.ledger_id AND l.student_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM public.attendance_ledger l
      JOIN public.class_sessions s ON s.id = l.session_id
      JOIN public.courses c ON c.id = s.course_id
      WHERE l.id = attendance_review_actions.ledger_id AND c.teacher_id = auth.uid()
    )
  );

CREATE INDEX attendance_review_actions_ledger_idx ON public.attendance_review_actions(ledger_id);

-- ============ Bootstrap first admin (only if no admin exists) ============
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be signed in';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO has_admin;
  IF has_admin THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'admin')
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;
