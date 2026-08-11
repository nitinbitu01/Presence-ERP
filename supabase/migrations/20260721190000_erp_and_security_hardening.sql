-- 1. role_requests
CREATE TABLE public.role_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role public.app_role NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.role_requests TO authenticated;
GRANT ALL ON public.role_requests TO service_role;

ALTER TABLE public.role_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_insert_own_role_requests" ON public.role_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "students_select_own_role_requests" ON public.role_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admins_all_role_requests" ON public.role_requests
  FOR ALL TO authenticated
  USING (private.has_role('admin'));

-- 2. fallback_requests
CREATE TABLE public.fallback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, student_id)
);

GRANT SELECT, INSERT ON public.fallback_requests TO authenticated;
GRANT ALL ON public.fallback_requests TO service_role;

ALTER TABLE public.fallback_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_insert_own_fallback_requests" ON public.fallback_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "student_select_own_fallback_requests" ON public.fallback_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

CREATE POLICY "teacher_select_own_fallback_requests" ON public.fallback_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_sessions cs
      JOIN public.courses c ON cs.course_id = c.id
      WHERE cs.id = fallback_requests.session_id AND c.teacher_id = auth.uid()
    )
  );

CREATE POLICY "admin_all_fallback_requests" ON public.fallback_requests
  FOR ALL TO authenticated
  USING (private.has_role('admin'));

-- 3. timetable
CREATE TABLE public.timetable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  room text,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.timetable TO authenticated;
GRANT ALL ON public.timetable TO service_role;

ALTER TABLE public.timetable ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_timetable_updated_at
  BEFORE UPDATE ON public.timetable
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "teacher_crud_own_timetable" ON public.timetable
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = timetable.course_id AND c.teacher_id = auth.uid()
    )
  );

CREATE POLICY "student_select_enrolled_timetable" ON public.timetable
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.course_id = timetable.course_id AND e.student_id = auth.uid()
    )
  );

CREATE POLICY "admin_all_timetable" ON public.timetable
  FOR ALL TO authenticated
  USING (private.has_role('admin'));

-- 4. leave_requests
CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  request_type text NOT NULL DEFAULT 'leave' CHECK (request_type IN ('leave','od')),
  document_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

GRANT SELECT, INSERT ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_insert_own_leave_requests" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "student_select_own_leave_requests" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

CREATE POLICY "admin_all_leave_requests" ON public.leave_requests
  FOR ALL TO authenticated
  USING (private.has_role('admin'));

-- 5. notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','success','error')),
  read boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_select_own_notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_update_own_notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6. rate_limit_attempts
CREATE TABLE public.rate_limit_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_attempts_key_time ON public.rate_limit_attempts(key, attempted_at DESC);

GRANT ALL ON public.rate_limit_attempts TO service_role;

ALTER TABLE public.rate_limit_attempts ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated, meaning it's blocked from client side queries

-- 7. class_sessions update
ALTER TABLE public.class_sessions
  ADD COLUMN IF NOT EXISTS session_otp text,
  ADD COLUMN IF NOT EXISTS otp_generated_at timestamptz;

-- 8. attendance_events check constraint update
ALTER TABLE public.attendance_events DROP CONSTRAINT IF EXISTS attendance_events_event_type_check;
ALTER TABLE public.attendance_events ADD CONSTRAINT attendance_events_event_type_check
  CHECK (event_type IN ('submit_attempt','liveness_fail','geofence_fail','time_window_fail','identity_fail','device_lock_fail','accepted','review','withdraw','rate_limited','verification_unavailable','otp_fail','fallback_requested','multi_student_flag'));

-- 9. Indexes
CREATE INDEX IF NOT EXISTS role_requests_user_id_idx ON public.role_requests(user_id);
CREATE INDEX IF NOT EXISTS fallback_requests_session_id_idx ON public.fallback_requests(session_id);
CREATE INDEX IF NOT EXISTS leave_requests_student_id_idx ON public.leave_requests(student_id);
CREATE INDEX IF NOT EXISTS notifications_user_id_read_idx ON public.notifications(user_id, read);
