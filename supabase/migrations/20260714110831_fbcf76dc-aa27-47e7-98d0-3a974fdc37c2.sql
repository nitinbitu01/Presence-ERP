
-- Fix 1: Move has_role to a private schema so signed-in users can't RPC it
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO postgres, service_role;

-- Rewrite policies that reference public.has_role to use private.has_role
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE (qual ILIKE '%has_role%' OR with_check ILIKE '%has_role%')
      AND schemaname = 'public'
  LOOP
    -- We'll handle known policies explicitly below; skip generic
    NULL;
  END LOOP;
END $$;

-- Drop and recreate any policies using public.has_role. Find them:
-- (Explicit recreation for each policy referencing has_role)
DO $$
DECLARE r record; new_qual text; new_check text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND (qual ILIKE '%has_role%' OR with_check ILIKE '%has_role%')
  LOOP
    new_qual := replace(coalesce(r.qual,''), 'has_role(', 'private.has_role(');
    -- also handle public.has_role prefix
    new_qual := replace(new_qual, 'public.private.has_role(', 'private.has_role(');
    new_check := replace(coalesce(r.with_check,''), 'has_role(', 'private.has_role(');
    new_check := replace(new_check, 'public.private.has_role(', 'private.has_role(');

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    IF r.cmd = 'ALL' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS %s FOR ALL TO %s USING (%s) WITH CHECK (%s)',
        r.policyname, r.schemaname, r.tablename,
        CASE WHEN r.permissive='PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        array_to_string(r.roles, ','),
        COALESCE(NULLIF(new_qual,''), 'true'),
        COALESCE(NULLIF(new_check,''), 'true'));
    ELSIF r.cmd IN ('SELECT','DELETE') THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s USING (%s)',
        r.policyname, r.schemaname, r.tablename,
        CASE WHEN r.permissive='PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        r.cmd, array_to_string(r.roles, ','),
        COALESCE(NULLIF(new_qual,''), 'true'));
    ELSIF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS %s FOR INSERT TO %s WITH CHECK (%s)',
        r.policyname, r.schemaname, r.tablename,
        CASE WHEN r.permissive='PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        array_to_string(r.roles, ','),
        COALESCE(NULLIF(new_check,''), 'true'));
    ELSIF r.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS %s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        r.policyname, r.schemaname, r.tablename,
        CASE WHEN r.permissive='PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        array_to_string(r.roles, ','),
        COALESCE(NULLIF(new_qual,''), 'true'),
        COALESCE(NULLIF(new_check,''), 'true'));
    END IF;
  END LOOP;
END $$;

-- Now safe to drop the public has_role function
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- Fix 2: Correct the class_sessions_read_enrolled policy tautology
DROP POLICY IF EXISTS class_sessions_read_enrolled ON public.class_sessions;
CREATE POLICY class_sessions_read_enrolled ON public.class_sessions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = class_sessions.course_id AND c.teacher_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id = class_sessions.course_id AND e.student_id = auth.uid()
  )
);
