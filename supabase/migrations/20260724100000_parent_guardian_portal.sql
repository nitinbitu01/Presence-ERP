-- =========================
-- Parent / Guardian Portal
-- =========================

-- Guardians authenticate via the same Supabase auth as everyone else, but are
-- invited by an admin with raw_user_meta_data.is_guardian = 'true'. Update the
-- signup trigger so guardian accounts don't get a student profile/role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'is_guardian', 'false') = 'true' THEN
    INSERT INTO public.guardians (user_id, display_name, phone)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
      NEW.raw_user_meta_data ->> 'phone'
    )
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)))
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'student')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger already exists (on_auth_user_created); CREATE OR REPLACE above is sufficient.

CREATE TABLE public.guardians (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.guardians TO authenticated;
GRANT ALL ON public.guardians TO service_role;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardians_self_read" ON public.guardians
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "guardians_admin_read" ON public.guardians
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "guardians_admin_write" ON public.guardians
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.guardian_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id uuid NOT NULL REFERENCES public.guardians(user_id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'guardian',
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_id)
);
GRANT SELECT ON public.guardian_students TO authenticated;
GRANT ALL ON public.guardian_students TO service_role;
ALTER TABLE public.guardian_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_students_self_read" ON public.guardian_students
  FOR SELECT TO authenticated USING (auth.uid() = guardian_id OR auth.uid() = student_id);
CREATE POLICY "guardian_students_admin_all" ON public.guardian_students
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Helper used by the read-only guardian policies below.
CREATE OR REPLACE FUNCTION private.is_guardian_of(_guardian_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guardian_students
    WHERE guardian_id = _guardian_id AND student_id = _student_id
  );
$$;

-- ============= Guardian read-only access to their linked students' data =============

CREATE POLICY "ledger_guardian_read" ON public.attendance_ledger
  FOR SELECT TO authenticated USING (private.is_guardian_of(auth.uid(), student_id));

CREATE POLICY "exam_marks_guardian_read" ON public.exam_marks
  FOR SELECT TO authenticated USING (
    private.is_guardian_of(auth.uid(), student_id)
    AND EXISTS (SELECT 1 FROM public.exams ex WHERE ex.id = exam_marks.exam_id AND ex.is_published)
  );

CREATE POLICY "leave_requests_guardian_read" ON public.leave_requests
  FOR SELECT TO authenticated USING (private.is_guardian_of(auth.uid(), student_id));
