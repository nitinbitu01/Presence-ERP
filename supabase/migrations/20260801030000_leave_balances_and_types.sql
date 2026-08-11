-- Phase 3.1: Leave Balances & Quota Tracking
-- 1. Create leave_type enum if not exists
DO $$ BEGIN
  CREATE TYPE public.leave_type AS ENUM ('casual', 'medical', 'duty', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add leave_type column to leave_requests table
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS leave_type public.leave_type NOT NULL DEFAULT 'casual';

-- 3. Create leave_balances table
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  leave_type public.leave_type NOT NULL DEFAULT 'casual',
  allocated integer NOT NULL DEFAULT 10 CHECK (allocated >= 0),
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  academic_year text NOT NULL DEFAULT '2025-2026',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, leave_type, academic_year)
);

GRANT SELECT ON public.leave_balances TO authenticated;
GRANT ALL ON public.leave_balances TO service_role;

ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_select_own_leave_balances" ON public.leave_balances;
CREATE POLICY "student_select_own_leave_balances" ON public.leave_balances
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "admin_all_leave_balances" ON public.leave_balances;
CREATE POLICY "admin_all_leave_balances" ON public.leave_balances
  FOR ALL TO authenticated
  USING (private.has_role('admin'));
