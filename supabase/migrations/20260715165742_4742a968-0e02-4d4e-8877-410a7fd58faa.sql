
-- =========================
-- Departments / Programs / Semesters
-- =========================

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departments_read_authenticated" ON public.departments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "departments_admin_write" ON public.departments
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  duration_semesters int NOT NULL DEFAULT 8,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, code)
);
GRANT SELECT ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "programs_read_authenticated" ON public.programs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "programs_admin_write" ON public.programs
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.semesters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
GRANT SELECT ON public.semesters TO authenticated;
GRANT ALL ON public.semesters TO service_role;
ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "semesters_read_authenticated" ON public.semesters
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "semesters_admin_write" ON public.semesters
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX semesters_single_active
  ON public.semesters (is_active) WHERE is_active;

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_programs_updated BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_semesters_updated BEFORE UPDATE ON public.semesters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- Extend existing tables
-- =========================

ALTER TABLE public.profiles
  ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL,
  ADD COLUMN current_semester int,
  ADD COLUMN roll_no text UNIQUE;

ALTER TABLE public.courses
  ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL;

ALTER TABLE public.enrollments
  ADD COLUMN semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL;

-- =========================
-- Seed
-- =========================

INSERT INTO public.departments (code, name)
VALUES ('GEN', 'General')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.programs (department_id, code, name, duration_semesters)
SELECT d.id, 'GEN-DEFAULT', 'Default Program', 8
FROM public.departments d WHERE d.code = 'GEN'
ON CONFLICT (department_id, code) DO NOTHING;

INSERT INTO public.semesters (code, name, starts_on, ends_on, is_active)
VALUES (
  to_char(now(), 'YYYY') || '-CURRENT',
  'Current Term',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '5 months')::date,
  true
)
ON CONFLICT (code) DO NOTHING;
