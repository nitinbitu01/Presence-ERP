-- =========================
-- Examinations & Gradebook
-- =========================

CREATE TYPE public.exam_type AS ENUM ('quiz', 'midterm', 'end_semester', 'practical', 'assignment');

CREATE TABLE public.exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  semester_id uuid NOT NULL REFERENCES public.semesters(id) ON DELETE RESTRICT,
  name text NOT NULL,
  exam_type public.exam_type NOT NULL DEFAULT 'quiz',
  max_marks numeric(6, 2) NOT NULL CHECK (max_marks > 0),
  weightage_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (weightage_percent >= 0 AND weightage_percent <= 100),
  exam_date date,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exams TO authenticated;
GRANT ALL ON public.exams TO service_role;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

-- Students only see published exams for courses they're enrolled in; teachers
-- see all exams (published or not) for courses they teach; admins see everything.
CREATE POLICY "exams_read" ON public.exams
  FOR SELECT TO authenticated USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.courses c WHERE c.id = exams.course_id AND c.teacher_id = auth.uid()
    )
    OR (
      is_published
      AND EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = exams.course_id AND e.student_id = auth.uid()
      )
    )
  );

CREATE POLICY "exams_teacher_write" ON public.exams
  FOR ALL TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.courses c WHERE c.id = exams.course_id AND c.teacher_id = auth.uid())
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.courses c WHERE c.id = exams.course_id AND c.teacher_id = auth.uid())
  );

-- ============= Grade Scales =============

CREATE TABLE public.grade_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.grade_scales TO authenticated;
GRANT ALL ON public.grade_scales TO service_role;
ALTER TABLE public.grade_scales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grade_scales_read" ON public.grade_scales FOR SELECT TO authenticated USING (true);
CREATE POLICY "grade_scales_admin_write" ON public.grade_scales
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.grade_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_scale_id uuid NOT NULL REFERENCES public.grade_scales(id) ON DELETE CASCADE,
  letter text NOT NULL,
  min_percent numeric(5, 2) NOT NULL CHECK (min_percent >= 0 AND min_percent <= 100),
  max_percent numeric(5, 2) NOT NULL CHECK (max_percent >= 0 AND max_percent <= 100),
  grade_point numeric(3, 1) NOT NULL CHECK (grade_point >= 0),
  is_passing boolean NOT NULL DEFAULT true,
  CHECK (max_percent >= min_percent)
);
GRANT SELECT ON public.grade_bands TO authenticated;
GRANT ALL ON public.grade_bands TO service_role;
ALTER TABLE public.grade_bands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grade_bands_read" ON public.grade_bands FOR SELECT TO authenticated USING (true);
CREATE POLICY "grade_bands_admin_write" ON public.grade_bands
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Seed the standard 10-point Indian GPA scale as the default.
INSERT INTO public.grade_scales (name, is_default) VALUES ('Standard 10-Point Scale', true);

INSERT INTO public.grade_bands (grade_scale_id, letter, min_percent, max_percent, grade_point, is_passing)
SELECT id, letter, min_percent, max_percent, grade_point, is_passing
FROM public.grade_scales,
  (VALUES
    ('O',  90, 100, 10, true),
    ('A+', 80, 89.99, 9, true),
    ('A',  70, 79.99, 8, true),
    ('B+', 60, 69.99, 7, true),
    ('B',  50, 59.99, 6, true),
    ('C',  45, 49.99, 5, true),
    ('P',  40, 44.99, 4, true),
    ('F',  0,  39.99, 0, false)
  ) AS bands(letter, min_percent, max_percent, grade_point, is_passing)
WHERE grade_scales.name = 'Standard 10-Point Scale';

-- ============= Marks =============

CREATE TABLE public.exam_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  marks_obtained numeric(6, 2),
  is_absent boolean NOT NULL DEFAULT false,
  remarks text,
  entered_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id),
  CHECK (is_absent OR marks_obtained IS NOT NULL)
);
GRANT SELECT ON public.exam_marks TO authenticated;
GRANT ALL ON public.exam_marks TO service_role;
ALTER TABLE public.exam_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exam_marks_student_read_own" ON public.exam_marks
  FOR SELECT TO authenticated USING (
    auth.uid() = student_id
    AND EXISTS (SELECT 1 FROM public.exams ex WHERE ex.id = exam_marks.exam_id AND ex.is_published)
  );

CREATE POLICY "exam_marks_teacher_admin_read" ON public.exam_marks
  FOR SELECT TO authenticated USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.exams ex
      JOIN public.courses c ON c.id = ex.course_id
      WHERE ex.id = exam_marks.exam_id AND c.teacher_id = auth.uid()
    )
  );

CREATE POLICY "exam_marks_teacher_admin_write" ON public.exam_marks
  FOR ALL TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.exams ex
      JOIN public.courses c ON c.id = ex.course_id
      WHERE ex.id = exam_marks.exam_id AND c.teacher_id = auth.uid()
    )
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.exams ex
      JOIN public.courses c ON c.id = ex.course_id
      WHERE ex.id = exam_marks.exam_id AND c.teacher_id = auth.uid()
    )
  );
