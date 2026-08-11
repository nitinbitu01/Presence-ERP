-- =========================
-- HR / Payroll
-- =========================

CREATE TYPE public.employment_type AS ENUM ('full_time', 'part_time', 'contract');
CREATE TYPE public.payroll_run_status AS ENUM ('draft', 'finalized', 'paid');
CREATE TYPE public.payslip_status AS ENUM ('pending', 'paid');
CREATE TYPE public.staff_leave_type AS ENUM ('casual', 'sick', 'earned', 'unpaid');

-- Employees are a distinct concept from students: any authenticated account
-- (a teacher, an admin, or a newly invited non-teaching staff member) can
-- have an employees row. Update the signup trigger with a third branch.
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
  ELSIF COALESCE(NEW.raw_user_meta_data ->> 'is_employee', 'false') = 'true' THEN
    INSERT INTO public.employees (id, employee_code, display_name, designation, employment_type, date_joined)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'employee_code', 'EMP-' || substr(NEW.id::text, 1, 8)),
      COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data ->> 'designation', 'Staff'),
      COALESCE((NEW.raw_user_meta_data ->> 'employment_type')::public.employment_type, 'full_time'),
      CURRENT_DATE
    )
    ON CONFLICT (id) DO NOTHING;
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

CREATE TABLE public.employees (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  designation text NOT NULL DEFAULT 'Staff',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  employment_type public.employment_type NOT NULL DEFAULT 'full_time',
  date_joined date NOT NULL DEFAULT CURRENT_DATE,
  date_left date,
  base_salary numeric(10, 2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_self_read" ON public.employees FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "employees_admin_all" ON public.employees
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year smallint NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  status public.payroll_run_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (period_month, period_year)
);
GRANT SELECT ON public.payroll_runs TO authenticated;
GRANT ALL ON public.payroll_runs TO service_role;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_runs_admin_all" ON public.payroll_runs
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  basic_salary numeric(10, 2) NOT NULL,
  allowances numeric(10, 2) NOT NULL DEFAULT 0,
  deductions numeric(10, 2) NOT NULL DEFAULT 0,
  gross_pay numeric(10, 2) NOT NULL,
  net_pay numeric(10, 2) NOT NULL,
  status public.payslip_status NOT NULL DEFAULT 'pending',
  notes text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);
GRANT SELECT ON public.payslips TO authenticated;
GRANT ALL ON public.payslips TO service_role;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payslips_self_read" ON public.payslips
  FOR SELECT TO authenticated USING (auth.uid() = employee_id);
CREATE POLICY "payslips_admin_all" ON public.payslips
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.staff_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type public.staff_leave_type NOT NULL DEFAULT 'casual',
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
GRANT SELECT ON public.staff_leave_requests TO authenticated;
GRANT ALL ON public.staff_leave_requests TO service_role;
ALTER TABLE public.staff_leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_leave_self_read" ON public.staff_leave_requests
  FOR SELECT TO authenticated USING (auth.uid() = employee_id);
CREATE POLICY "staff_leave_self_insert" ON public.staff_leave_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = employee_id);
CREATE POLICY "staff_leave_admin_all" ON public.staff_leave_requests
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Payslips are a financial record: block client-side UPDATE/DELETE the same
-- way fee_payments does. Corrections are new payroll runs, not edits.
REVOKE UPDATE, DELETE ON public.payslips FROM authenticated;
