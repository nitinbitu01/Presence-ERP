-- Presence ERP Master Schema Migration Script
-- Generated at 2026-08-04T10:45:48.154Z

-- ==============================================
-- Migration: 20260709143622_d7576edc-5195-4cc6-acbe-979f59a48150.sql
-- ==============================================
-- Roles
create type public.app_role as enum ('admin', 'teacher', 'student');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_self_read" on public.profiles for select to authenticated using (auth.uid() = user_id);
create policy "profiles_self_write" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
create policy "profiles_self_update" on public.profiles for update to authenticated using (auth.uid() = user_id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "user_roles_self_read" on public.user_roles for select to authenticated using (auth.uid() = user_id);

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = _user_id AND role::text = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role::text = _role
  );
$$;

CREATE OR REPLACE FUNCTION private.has_role(_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role::text = _role
  );
$$;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = _user_id AND role::text = _role
  );
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- New users get a profile + default student role
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Courses
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  teacher_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.courses to authenticated;
grant all on public.courses to service_role;
alter table public.courses enable row level security;
create policy "courses_read_all_auth" on public.courses for select to authenticated using (true);
create policy "courses_teacher_write" on public.courses for insert to authenticated
  with check (auth.uid() = teacher_id and public.has_role(auth.uid(), 'teacher'));
create policy "courses_teacher_update" on public.courses for update to authenticated
  using (auth.uid() = teacher_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);
grant select, insert, delete on public.enrollments to authenticated;
grant all on public.enrollments to service_role;
alter table public.enrollments enable row level security;
create policy "enrollments_self_read" on public.enrollments for select to authenticated
  using (auth.uid() = student_id or exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));
create policy "enrollments_teacher_manage" on public.enrollments for insert to authenticated
  with check (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));
create policy "enrollments_teacher_delete" on public.enrollments for delete to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));

-- Sessions
create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  geo_lat double precision not null,
  geo_lng double precision not null,
  radius_m integer not null default 15,
  ip_allowlist text[] not null default '{}',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.class_sessions to authenticated;
grant all on public.class_sessions to service_role;
alter table public.class_sessions enable row level security;
create policy "class_sessions_read_enrolled" on public.class_sessions for select to authenticated
  using (
    exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid())
    or exists (select 1 from public.enrollments e where e.course_id = course_id and e.student_id = auth.uid())
  );
create policy "class_sessions_teacher_write" on public.class_sessions for insert to authenticated
  with check (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));
create policy "class_sessions_teacher_update" on public.class_sessions for update to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));

-- Consent
create table public.biometric_consent (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  retention_until timestamptz,
  policy_version text not null,
  allow_non_biometric_fallback boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, policy_version)
);
grant select, insert, update on public.biometric_consent to authenticated;
grant all on public.biometric_consent to service_role;
alter table public.biometric_consent enable row level security;
create policy "consent_self_read" on public.biometric_consent for select to authenticated
  using (auth.uid() = student_id);
create policy "consent_self_write" on public.biometric_consent for insert to authenticated
  with check (auth.uid() = student_id);
create policy "consent_self_update" on public.biometric_consent for update to authenticated
  using (auth.uid() = student_id);

-- Encrypted embeddings (AES-GCM ciphertext incl. IV+tag). Never raw images.
create table public.face_embeddings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  ciphertext bytea not null,
  algo text not null default 'AES-GCM-256',
  created_at timestamptz not null default now(),
  unique (student_id)
);
grant select, insert, update, delete on public.face_embeddings to authenticated;
grant all on public.face_embeddings to service_role;
alter table public.face_embeddings enable row level security;
-- Reads only via server functions (service_role). Client cannot read the ciphertext.
create policy "embeddings_self_upsert_hint" on public.face_embeddings for select to authenticated
  using (false);

create table public.device_fingerprints (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  fp_hash text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (student_id, fp_hash)
);
grant select, insert, update on public.device_fingerprints to authenticated;
grant all on public.device_fingerprints to service_role;
alter table public.device_fingerprints enable row level security;
create policy "device_fp_self" on public.device_fingerprints for select to authenticated
  using (auth.uid() = student_id);

-- Append-only ledger
create type public.attendance_decision as enum ('present', 'review', 'rejected', 'fallback_present');

create table public.attendance_ledger (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  decision public.attendance_decision not null,
  similarity numeric,
  gate_reasons jsonb not null default '{}'::jsonb,
  device_fp_hash text,
  ip inet,
  geo_lat double precision,
  geo_lng double precision,
  previous_entry_id uuid references public.attendance_ledger(id),
  modified_by uuid references auth.users(id),
  reason_code text,
  created_at timestamptz not null default now()
);
create index on public.attendance_ledger (session_id);
create index on public.attendance_ledger (student_id);
create unique index attendance_ledger_one_device_per_session
  on public.attendance_ledger (session_id, device_fp_hash)
  where decision in ('present', 'review') and device_fp_hash is not null;
create unique index attendance_ledger_one_present_per_student_session
  on public.attendance_ledger (session_id, student_id)
  where decision in ('present', 'fallback_present');

grant select, insert on public.attendance_ledger to authenticated;
grant all on public.attendance_ledger to service_role;
alter table public.attendance_ledger enable row level security;
create policy "ledger_self_read" on public.attendance_ledger for select to authenticated
  using (
    auth.uid() = student_id
    or public.has_role(auth.uid(), 'admin')
    or exists (
      select 1 from public.class_sessions s
      join public.courses c on c.id = s.course_id
      where s.id = session_id and c.teacher_id = auth.uid()
    )
  );
-- Inserts happen via server functions (service_role); block direct client insert
create policy "ledger_no_client_insert" on public.attendance_ledger for insert to authenticated
  with check (false);

-- Append-only enforcement
create or replace function public.attendance_ledger_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'attendance_ledger is append-only; insert a correction row instead';
end;
$$;
create trigger attendance_ledger_no_update before update on public.attendance_ledger
  for each row execute function public.attendance_ledger_append_only();
create trigger attendance_ledger_no_delete before delete on public.attendance_ledger
  for each row execute function public.attendance_ledger_append_only();

-- ==============================================
-- Migration: 20260709143657_cdd2ce70-793a-4b13-af89-bf318d652716.sql
-- ==============================================
-- has_role: only authenticated callers need it (via RLS policies); revoke public/anon
revoke execute on function public.has_role(uuid, public.app_role) from public;
revoke execute on function public.has_role(uuid, public.app_role) from anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- handle_new_user is trigger-only; revoke all callers
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- append-only trigger fn: trigger-only
revoke execute on function public.attendance_ledger_append_only() from public;
revoke execute on function public.attendance_ledger_append_only() from anon;
revoke execute on function public.attendance_ledger_append_only() from authenticated;

-- Ensure search_path is set on all three (harmless if already set)
alter function public.has_role(uuid, public.app_role) set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.attendance_ledger_append_only() set search_path = public;

-- ==============================================
-- Migration: 20260714110831_fbcf76dc-aa27-47e7-98d0-3a974fdc37c2.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260714113829_242aab18-623c-45d8-98c7-5f1b4ed639be.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260715165742_4742a968-0e02-4d4e-8877-410a7fd58faa.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260720130205_f1c6dfef-4bb2-49a6-9e8e-eba35f730848.sql
-- ==============================================
-- Move handle_new_user to private schema (trigger-only)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict do nothing;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

-- Move bootstrap_first_admin to private schema; take user_id explicitly since
-- it will be called via the service-role client which has no auth.uid().
DROP FUNCTION IF EXISTS public.bootstrap_first_admin();

CREATE OR REPLACE FUNCTION private.bootstrap_first_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_admin boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO has_admin;
  IF has_admin THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'admin')
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.bootstrap_first_admin(uuid) FROM PUBLIC, anon, authenticated;

-- ==============================================
-- Migration: 20260721190000_erp_and_security_hardening.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260723193000_role_requests_profiles_fk.sql
-- ==============================================
-- The admin dashboard's listRoleRequests() embeds `profiles:user_id(display_name)`
-- on top of role_requests. PostgREST can only resolve that embed if there is a
-- real foreign key between the two tables (a shared reference to auth.users(id)
-- is not enough). Add it here.
--
-- Every role_requests.user_id is guaranteed to already exist in profiles because
-- a profile row is created for every authenticated user on first sign-in.
ALTER TABLE public.role_requests
  ADD CONSTRAINT role_requests_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- Same reasoning for leave_requests: listLeaveRequests() embeds
-- `profiles:student_id(display_name, roll_no)` for the admin approval UI.
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_student_id_profiles_fkey
  FOREIGN KEY (student_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- Pre-existing bug uncovered by the same fix: exportCourseRegisterCsv() embeds
-- `profiles:student_id(display_name, roll_no)` on top of enrollments, and
-- listFallbackRequests() does the same on top of fallback_requests. Neither
-- had a real FK to profiles, so both embeds would fail at runtime.
ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_student_id_profiles_fkey
  FOREIGN KEY (student_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.fallback_requests
  ADD CONSTRAINT fallback_requests_student_id_profiles_fkey
  FOREIGN KEY (student_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- ==============================================
-- Migration: 20260723200000_institutions_tenancy_foundation.sql
-- ==============================================
-- =========================
-- Tenancy Foundation
-- =========================
-- We are staying single-tenant for now, but scoping at the top of the
-- academic hierarchy (departments) so a future multi-tenant split does not
-- require a schema rewrite: programs, courses, timetable, and profiles all
-- already hang off department_id, so they inherit institution scope
-- transitively. When multi-tenancy is actually needed, denormalize
-- institution_id onto the tables that need it for RLS/index performance and
-- add institution checks to RLS policies — this migration is the seam.

CREATE TABLE public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address text,
  contact_email text,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.institutions TO authenticated;
GRANT ALL ON public.institutions TO service_role;
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "institutions_read_authenticated" ON public.institutions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "institutions_admin_write" ON public.institutions
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Seed the single institution this deployment currently serves.
INSERT INTO public.institutions (code, name)
VALUES ('DEFAULT', 'Default Institution')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.departments
  ADD COLUMN institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;

-- Backfill existing departments to the seeded institution.
UPDATE public.departments
SET institution_id = (SELECT id FROM public.institutions WHERE code = 'DEFAULT')
WHERE institution_id IS NULL;

ALTER TABLE public.departments
  ALTER COLUMN institution_id SET NOT NULL;

-- Postgres column DEFAULTs cannot reference other tables via subquery, so we
-- use a trigger to fall back to the seeded default institution when a new
-- department is inserted without one explicitly specified.
CREATE OR REPLACE FUNCTION public.default_institution_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.institution_id IS NULL THEN
    NEW.institution_id := (SELECT id FROM public.institutions WHERE code = 'DEFAULT');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER departments_default_institution
  BEFORE INSERT ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.default_institution_id();

-- ==============================================
-- Migration: 20260723210000_examinations_gradebook.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260724100000_parent_guardian_portal.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260724150000_fees_finance.sql
-- ==============================================
-- =========================
-- Fees & Finance
-- =========================

CREATE TYPE public.fee_category AS ENUM ('tuition', 'hostel', 'exam', 'library', 'transport', 'misc');
CREATE TYPE public.invoice_status AS ENUM ('pending', 'partial', 'paid', 'overdue', 'waived');
CREATE TYPE public.payment_method AS ENUM ('razorpay', 'cash', 'cheque', 'bank_transfer');
CREATE TYPE public.payment_status AS ENUM ('created', 'success', 'failed', 'refunded');

CREATE TABLE public.fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid REFERENCES public.programs(id) ON DELETE CASCADE,
  semester_id uuid REFERENCES public.semesters(id) ON DELETE RESTRICT,
  name text NOT NULL,
  category public.fee_category NOT NULL DEFAULT 'tuition',
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  due_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fee_structures TO authenticated;
GRANT ALL ON public.fee_structures TO service_role;
ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fee_structures_read" ON public.fee_structures FOR SELECT TO authenticated USING (true);
CREATE POLICY "fee_structures_admin_write" ON public.fee_structures
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fee_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  fee_structure_id uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE RESTRICT,
  amount_due numeric(10, 2) NOT NULL CHECK (amount_due > 0),
  amount_paid numeric(10, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status public.invoice_status NOT NULL DEFAULT 'pending',
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, fee_structure_id)
);
GRANT SELECT ON public.fee_invoices TO authenticated;
GRANT ALL ON public.fee_invoices TO service_role;
ALTER TABLE public.fee_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fee_invoices_student_read_own" ON public.fee_invoices
  FOR SELECT TO authenticated USING (auth.uid() = student_id);
CREATE POLICY "fee_invoices_guardian_read" ON public.fee_invoices
  FOR SELECT TO authenticated USING (private.is_guardian_of(auth.uid(), student_id));
CREATE POLICY "fee_invoices_admin_all" ON public.fee_invoices
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fee_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  method public.payment_method NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'created',
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT, -- set for manual (cash/cheque/bank) entries
  notes text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fee_payments TO authenticated;
GRANT ALL ON public.fee_payments TO service_role;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fee_payments_student_read_own" ON public.fee_payments
  FOR SELECT TO authenticated USING (auth.uid() = student_id);
CREATE POLICY "fee_payments_guardian_read" ON public.fee_payments
  FOR SELECT TO authenticated USING (private.is_guardian_of(auth.uid(), student_id));
CREATE POLICY "fee_payments_admin_all" ON public.fee_payments
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Payments are a financial audit trail: block UPDATE/DELETE from the client
-- entirely. Reconciliation adjustments (refunds, corrections) are modeled as
-- new rows, not edits to existing ones. service_role (server functions) can
-- still update paid_at/status once on confirmation via a narrow trigger-free
-- path since it runs as service_role, which bypasses RLS by design.
REVOKE UPDATE, DELETE ON public.fee_payments FROM authenticated;

-- ==============================================
-- Migration: 20260725100000_hr_payroll.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260725110000_session_otp_privacy_fix.sql
-- ==============================================
-- Phase 0 fix #1: session_otp / otp_generated_at were added to public.class_sessions
-- by 20260721190000_erp_and_security_hardening.sql with no column-level restriction.
-- class_sessions has RLS policy "class_sessions_read_enrolled" (from
-- 20260709143622_...sql) granting full-ROW select to enrolled students. Postgres RLS
-- filters rows, not columns, so any enrolled student could read session_otp directly
-- via the Supabase client (`.from('class_sessions').select('session_otp')`) without
-- ever seeing the teacher's screen -- defeating the whole point of the rotating OTP
-- factor.
--
-- Fix: move both columns to a table that `authenticated`/`anon` have NO grant on at
-- all (not even filtered by RLS -- blocked at the privilege layer), mirroring the
-- pattern already used correctly for rate_limit_attempts
-- (20260721190000_erp_and_security_hardening.sql) and face_embeddings
-- (`using (false)`, 20260709143622_...sql). Only service_role (i.e. server-side code
-- using supabaseAdmin) can read or write it.

CREATE TABLE public.session_otp_secrets (
  session_id uuid PRIMARY KEY REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  session_otp text,
  otp_generated_at timestamptz
);

-- No GRANT to authenticated/anon at all -- unlike class_sessions, which grants
-- select/insert/update/delete to authenticated and relies on RLS alone.
GRANT ALL ON public.session_otp_secrets TO service_role;

ALTER TABLE public.session_otp_secrets ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated: blocked from client-side queries entirely, same as
-- rate_limit_attempts.

-- Carry forward any OTP already generated for an in-progress session so a session
-- mid-flight isn't broken by this migration.
INSERT INTO public.session_otp_secrets (session_id, session_otp, otp_generated_at)
SELECT id, session_otp, otp_generated_at
FROM public.class_sessions
WHERE session_otp IS NOT NULL;

ALTER TABLE public.class_sessions
  DROP COLUMN IF EXISTS session_otp,
  DROP COLUMN IF EXISTS otp_generated_at;

-- ==============================================
-- Migration: 20260725120000_atomic_rate_limit.sql
-- ==============================================
-- Phase 0 fix #2: checkRateLimit() in attendance-crypto.server.ts did a count
-- SELECT and an INSERT as two separate round trips. Concurrent requests for the
-- same key could all read the same (under-limit) count before any of their inserts
-- committed, so more than maxAttempts could get through -- a classic
-- check-then-insert race (TOCTOU).
--
-- Fix: do the count check and the insert inside a single Postgres function call,
-- serialized per-key with a transaction-scoped advisory lock
-- (pg_advisory_xact_lock). rate_limit_attempts is a row-per-attempt table (no
-- natural single row to SELECT ... FOR UPDATE before the first attempt for a key
-- exists), so an advisory lock keyed on hashtext(key) gives the same "only one
-- caller evaluates count+insert for this key at a time" guarantee that
-- SELECT ... FOR UPDATE would give for a single-row counter design, without
-- changing the existing table shape (which nothing else in the schema depends on
-- being row-per-attempt, so this is the smaller, safer change).
--
-- The lock is released automatically at the end of the calling transaction; each
-- RPC call from supabase-js runs in its own implicit transaction, so no explicit
-- release is needed.

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key text,
  p_max_attempts integer,
  p_window_ms bigint
)
RETURNS TABLE(allowed boolean, current_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_window_ms || ' milliseconds')::interval;
  v_count integer;
BEGIN
  -- Serialize concurrent callers for the same key so the count below and the
  -- insert it gates on can't race against another call for the same key.
  PERFORM pg_advisory_xact_lock(hashtext(p_key)::bigint);

  -- Global housekeeping delete of stale rows (same behavior as before: not
  -- scoped to this key, just a periodic sweep).
  DELETE FROM public.rate_limit_attempts WHERE attempted_at < v_cutoff;

  SELECT count(*) INTO v_count
  FROM public.rate_limit_attempts
  WHERE key = p_key AND attempted_at >= v_cutoff;

  IF v_count >= p_max_attempts THEN
    RETURN QUERY SELECT false, v_count;
  ELSE
    INSERT INTO public.rate_limit_attempts (key, attempted_at) VALUES (p_key, now());
    RETURN QUERY SELECT true, v_count + 1;
  END IF;
END;
$$;

-- Only the server (service_role) calls this, same as the rest of the rate
-- limiter's storage.
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, bigint) TO service_role;

-- ==============================================
-- Migration: 20260725130000_webauthn_device_binding.sql
-- ==============================================
-- Phase 1 (hardening work order): liveness trust gap mitigation.
--
-- The 5-gate pipeline's liveness signals (EAR, yaw, pitch, frame embeddings) are
-- computed client-side and submitted as plain numbers. The HMAC in
-- attendance-crypto.server.ts secures the challenge metadata (action/session/TTL),
-- not the claim that the numbers came from a real camera -- a scripted HTTP client
-- could POST fabricated-but-plausible signal sequences straight to submitAttendance
-- without ever opening a camera.
--
-- This migration adds device/app attestation via WebAuthn platform authenticators
-- (Face ID / Touch ID / Windows Hello / Android biometric unlock) as an additional
-- bound factor, per the work order's second listed option (staying browser-only,
-- add WebAuthn as an additional bound factor at enrollment). A student who has
-- registered a platform authenticator must produce a fresh, hardware-backed
-- signature over the same server-issued challenge used for the liveness gate to
-- check in -- something a raw scripted POST cannot forge even with perfectly
-- fabricated liveness numbers, because it doesn't have the private key, which
-- never leaves the authenticator.
--
-- NOTE (residual risk, see also README.md's security section): this is opt-in per
-- student, not yet mandatory. A student who hasn't registered a device is still
-- only protected by the existing client-reported-signal trust model. Making
-- registration mandatory at enrollment is a rollout/policy decision for the
-- institution, not purely a code change (existing enrolled students would need a
-- migration window) -- tracked, not done here.

CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL, -- base64url-encoded COSE public key
  counter bigint NOT NULL DEFAULT 0, -- signature counter; must be strictly increasing (replay defense)
  device_label text,
  transports text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX webauthn_credentials_user_id_idx ON public.webauthn_credentials(user_id);

-- Same pattern as session_otp_secrets and rate_limit_attempts (this session's
-- other two service-role-only tables): registration and verification both happen
-- server-side via supabaseAdmin, so there's no need to reason about RLS policies
-- for a security-critical counter/key table -- it's simply not reachable from any
-- authenticated/anon client call at all.
GRANT ALL ON public.webauthn_credentials TO service_role;

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated: blocked from client-side queries entirely.

-- ==============================================
-- Migration: 20260725140000_webauthn_event_type.sql
-- ==============================================
-- Phase 1: extend attendance_events.event_type to allow logging failures of the
-- new WebAuthn device-attestation gate (see webauthn.server.ts and the
-- submitAttendance gate it's wired into).

ALTER TABLE public.attendance_events DROP CONSTRAINT IF EXISTS attendance_events_event_type_check;
ALTER TABLE public.attendance_events ADD CONSTRAINT attendance_events_event_type_check
  CHECK (event_type IN (
    'submit_attempt','liveness_fail','geofence_fail','time_window_fail','identity_fail',
    'device_lock_fail','accepted','review','withdraw','rate_limited',
    'verification_unavailable','otp_fail','fallback_requested','multi_student_flag',
    'device_attestation_fail'
  ));

-- ==============================================
-- Migration: 20260725150000_biometric_retention_job.sql
-- ==============================================
-- Phase 2 item 2 (hardening work order): "retention_until already exists -- wire
-- up an actual deletion job that respects it." Until now, biometric_consent.
-- retention_until was collected at consent time but nothing ever read it back --
-- the only working erasure path was withdrawBiometric() in admin.functions.ts,
-- which is student-initiated (the "right to erasure" workflow), not automatic
-- time-based retention enforcement.
--
-- This adds a SECURITY DEFINER function that erases biometric data for any
-- consent row whose retention window has passed, and schedules it via pg_cron
-- (Supabase's supported extension for this) to run daily. A matching
-- admin-callable server function (runBiometricRetentionSweep in
-- admin.functions.ts) calls the same function directly, so retention enforcement
-- still works even on a Supabase plan/self-host setup where pg_cron isn't
-- available -- wire that up to an external scheduler (e.g. a scheduled GitHub
-- Action or Vercel Cron hitting an admin endpoint) as a fallback.

CREATE OR REPLACE FUNCTION public.enforce_biometric_retention()
RETURNS TABLE(erased_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  CREATE TEMP TABLE _expired_consent ON COMMIT DROP AS
    SELECT student_id
    FROM public.biometric_consent
    WHERE retention_until IS NOT NULL
      AND retention_until < now()
      AND withdrawn_at IS NULL; -- already-withdrawn students are already erased

  DELETE FROM public.face_embeddings
  WHERE student_id IN (SELECT student_id FROM _expired_consent);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.biometric_consent
  SET withdrawn_at = now()
  WHERE student_id IN (SELECT student_id FROM _expired_consent);

  INSERT INTO public.biometric_withdrawals (student_id, reason)
  SELECT student_id, 'retention_period_expired' FROM _expired_consent;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_biometric_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_biometric_retention() TO service_role;

-- Schedule via pg_cron, if available. Wrapped in exception handling so this
-- migration still applies cleanly on a project where pg_cron hasn't been
-- enabled (e.g. some self-hosted setups, or before enabling it in the Supabase
-- dashboard's Database > Extensions page) -- the function above still works via
-- the admin-callable fallback either way.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'biometric-retention-sweep';

  PERFORM cron.schedule(
    'biometric-retention-sweep',
    '0 3 * * *', -- daily at 03:00 UTC
    $sql$SELECT public.enforce_biometric_retention();$sql$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (% ). Enable the pg_cron extension in the Supabase dashboard, or call runBiometricRetentionSweep via an external scheduler instead.', SQLERRM;
END;
$$;

-- ==============================================
-- Migration: 20260730230000_enrollment_photos.sql
-- ==============================================
-- Enrollment photos table with locked-down RLS pattern
-- Service-role-only writes, student reads only their own row.
-- Automatically erased on the same retention schedule as face_embeddings.

CREATE TABLE IF NOT EXISTS public.enrollment_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  algo text NOT NULL DEFAULT 'AES-GCM-256',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrollment_photos_student_id_idx ON public.enrollment_photos(student_id);

ALTER TABLE public.enrollment_photos ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.enrollment_photos TO service_role;
GRANT SELECT ON public.enrollment_photos TO authenticated;

DROP POLICY IF EXISTS "enrollment_photos_read_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_read_own" ON public.enrollment_photos
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

-- Update retention enforcement function to clean up enrollment_photos as well
CREATE OR REPLACE FUNCTION public.enforce_biometric_retention()
RETURNS TABLE(erased_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  CREATE TEMP TABLE _expired_consent ON COMMIT DROP AS
    SELECT student_id
    FROM public.biometric_consent
    WHERE retention_until IS NOT NULL
      AND retention_until < now()
      AND withdrawn_at IS NULL;

  DELETE FROM public.face_embeddings
  WHERE student_id IN (SELECT student_id FROM _expired_consent);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.enrollment_photos
  WHERE student_id IN (SELECT student_id FROM _expired_consent);

  UPDATE public.biometric_consent
  SET withdrawn_at = now()
  WHERE student_id IN (SELECT student_id FROM _expired_consent);

  INSERT INTO public.biometric_withdrawals (student_id, reason)
  SELECT student_id, 'retention_period_expired' FROM _expired_consent;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_biometric_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_biometric_retention() TO service_role;

-- ==============================================
-- Migration: 20260730233000_face_embeddings_rls_fix.sql
-- ==============================================
-- Fix RLS policies for face_embeddings and enrollment_photos so authenticated users can upsert/delete their own row.
-- This ensures biometric enrollment succeeds seamlessly for students without RLS violations.

DROP POLICY IF EXISTS "embeddings_self_insert" ON public.face_embeddings;
CREATE POLICY "embeddings_self_insert" ON public.face_embeddings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "embeddings_self_update" ON public.face_embeddings;
CREATE POLICY "embeddings_self_update" ON public.face_embeddings
  FOR UPDATE TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "embeddings_self_delete" ON public.face_embeddings;
CREATE POLICY "embeddings_self_delete" ON public.face_embeddings
  FOR DELETE TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollment_photos_insert_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_insert_own" ON public.enrollment_photos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollment_photos_update_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_update_own" ON public.enrollment_photos
  FOR UPDATE TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollment_photos_delete_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_delete_own" ON public.enrollment_photos
  FOR DELETE TO authenticated
  USING (auth.uid() = student_id);

-- ==============================================
-- Migration: 20260731010000_webauthn_exemptions.sql
-- ==============================================
-- Migration for WebAuthn Device Exemptions
-- Allows administrators to grant exemptions to students whose devices lack hardware authenticators.

CREATE TABLE IF NOT EXISTS public.webauthn_exemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT webauthn_exemptions_student_unique UNIQUE (student_id)
);

GRANT ALL ON public.webauthn_exemptions TO service_role;
GRANT SELECT ON public.webauthn_exemptions TO authenticated;

ALTER TABLE public.webauthn_exemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exemptions_self_or_admin_read" ON public.webauthn_exemptions;
CREATE POLICY "exemptions_self_or_admin_read" ON public.webauthn_exemptions
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id OR public.has_role(auth.uid(), 'admin'));

-- ==============================================
-- Migration: 20260731020000_spot_checks.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260731_password_reset_tokens.sql
-- ==============================================
-- Migration: password_reset_tokens
-- Stores cryptographically secure SHA-256 hashed reset tokens with expiry, single-use enforcement, and RLS lockdown.

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT DEFAULT NULL
);

-- Index for fast token validation & cleanup
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON public.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON public.password_reset_tokens(expires_at);

-- RLS Lockdown: Service role only. No direct client grants to anon or authenticated.
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "No public access to password reset tokens" ON public.password_reset_tokens;

-- Service role bypasses RLS automatically; deny access to public roles explicitly
CREATE POLICY "No public access to password reset tokens"
    ON public.password_reset_tokens
    FOR ALL
    TO anon, authenticated
    USING (false);

COMMENT ON TABLE public.password_reset_tokens IS 'Stores SHA-256 hashed password reset tokens with 30-minute expiration and single-use invalidation.';

-- ==============================================
-- Migration: 20260801000000_leave_request_status_lockdown.sql
-- ==============================================
-- Phase 1.1: Fix OD/Leave self-approval RLS hole
-- 1. Create BEFORE INSERT trigger to force status := 'pending', approved_by := NULL, reviewed_at := NULL for student leave requests
CREATE OR REPLACE FUNCTION public.lockdown_leave_request_status()
RETURNS TRIGGER AS $$
BEGIN
  -- If invoked by service_role or admin role, preserve review fields
  IF current_setting('role', true) = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  -- For student / regular user insert, force pending status and wipe approval fields
  NEW.status := 'pending';
  NEW.approved_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lockdown_leave_request_status ON public.leave_requests;
CREATE TRIGGER trg_lockdown_leave_request_status
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.lockdown_leave_request_status();

-- 2. Tighten RLS Policy on leave_requests FOR INSERT
DROP POLICY IF EXISTS "student_insert_own_leave_requests" ON public.leave_requests;
CREATE POLICY "student_insert_own_leave_requests" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = student_id AND
    status = 'pending' AND
    approved_by IS NULL AND
    reviewed_at IS NULL
  );

-- 3. Also lockdown staff_leave_requests FOR INSERT
DROP POLICY IF EXISTS "staff_leave_self_insert" ON public.staff_leave_requests;
CREATE POLICY "staff_leave_self_insert" ON public.staff_leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = employee_id AND
    status = 'pending' AND
    approved_by IS NULL AND
    reviewed_at IS NULL
  );

-- ==============================================
-- Migration: 20260801010000_staff_leave_rls_alignment.sql
-- ==============================================
-- Phase 2.2: Staff leave RLS alignment with student leave
-- Ensure authenticated employees can INSERT staff_leave_requests with status='pending'
GRANT INSERT ON public.staff_leave_requests TO authenticated;

DROP POLICY IF EXISTS "staff_leave_self_insert" ON public.staff_leave_requests;
CREATE POLICY "staff_leave_self_insert" ON public.staff_leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = employee_id AND
    status = 'pending' AND
    approved_by IS NULL AND
    reviewed_at IS NULL
  );

-- ==============================================
-- Migration: 20260801020000_audit_insert_lockdown_all_tables.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260801030000_leave_balances_and_types.sql
-- ==============================================
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

-- ==============================================
-- Migration: 20260801040000_leave_audit_cancellation_rejection.sql
-- ==============================================
-- Phase 1-3 Quality Upgrade: Audit Logging, Rejection Reason & Student Cancellation
-- 1. Add rejection_reason column to leave_requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Create public.audit_logs table for enterprise audit trail
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_audit_logs" ON public.audit_logs;
CREATE POLICY "admin_select_audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (private.has_role('admin'));

-- ==============================================
-- Migration: 20260801050000_extended_phase1_security.sql
-- ==============================================
-- Extended Phase 1: Automated Change Capture Triggers, PII Encryption & MFA Flags

-- 1. Enable pgcrypto extension for field-level encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Add MFA columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret text;

-- 3. Generic Audit Change Capture Trigger Function
CREATE OR REPLACE FUNCTION public.log_table_change()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id uuid;
  v_target_id uuid;
  v_details jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    v_target_id := OLD.id;
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF (TG_OP = 'INSERT') THEN
    v_target_id := NEW.id;
    v_details := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF (TG_OP = 'UPDATE') THEN
    v_target_id := NEW.id;
    v_details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, details)
  VALUES (
    v_actor_id,
    lower(TG_OP) || '_' || TG_TABLE_NAME,
    TG_TABLE_NAME,
    v_target_id,
    v_details
  );

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach triggers to sensitive tables
DROP TRIGGER IF EXISTS trg_audit_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_audit_leave_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS trg_audit_staff_leave ON public.staff_leave_requests;
CREATE TRIGGER trg_audit_staff_leave
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS trg_audit_fee_payments ON public.fee_payments;
CREATE TRIGGER trg_audit_fee_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS trg_audit_role_requests ON public.role_requests;
CREATE TRIGGER trg_audit_role_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.role_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

-- ==============================================
-- Migration: 20260801060000_extended_phase3_erp.sql
-- ==============================================
-- Extended Phase 3: Multi-tier Approvals, Delegations, Document Verification & Notification Preferences

-- 1. Document verification columns on leave_requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS document_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Multi-tier Approval Rules Table
CREATE TABLE IF NOT EXISTS public.leave_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_type text NOT NULL,
  min_days integer NOT NULL DEFAULT 1,
  max_days integer,
  approval_chain text[] NOT NULL DEFAULT ARRAY['advisor'],
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.leave_approval_rules TO authenticated;
GRANT ALL ON public.leave_approval_rules TO service_role;

ALTER TABLE public.leave_approval_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_select_approval_rules" ON public.leave_approval_rules;
CREATE POLICY "authenticated_select_approval_rules" ON public.leave_approval_rules
  FOR SELECT TO authenticated USING (true);

-- 3. Approver Delegations Table
CREATE TABLE IF NOT EXISTS public.approver_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delegate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

GRANT SELECT, INSERT, UPDATE ON public.approver_delegations TO authenticated;
GRANT ALL ON public.approver_delegations TO service_role;

ALTER TABLE public.approver_delegations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_manage_own_delegations" ON public.approver_delegations;
CREATE POLICY "user_manage_own_delegations" ON public.approver_delegations
  FOR ALL TO authenticated USING (auth.uid() = approver_id OR auth.uid() = delegate_id);

-- 4. User Notification Preferences Table
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT false,
  in_app_enabled boolean NOT NULL DEFAULT true,
  phone_number text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_notification_preferences TO authenticated;
GRANT ALL ON public.user_notification_preferences TO service_role;

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_manage_own_notif_prefs" ON public.user_notification_preferences;
CREATE POLICY "user_manage_own_notif_prefs" ON public.user_notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- ==============================================
-- Migration: 20260801070000_extended_phase1_round3.sql
-- ==============================================
-- Extended Phase 1 (Round 3): User Sessions & Device Management

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_info text NOT NULL,
  ip_address text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_sessions TO authenticated;
GRANT ALL ON public.user_sessions TO service_role;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_sessions" ON public.user_sessions;
CREATE POLICY "users_manage_own_sessions" ON public.user_sessions
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- ==============================================
-- Migration: 20260801080000_feature_flags.sql
-- ==============================================
-- Extended Phase 2 (Round 3): Feature Flags Table & Initial Core Flags

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_flags TO authenticated, anon;
GRANT ALL ON public.feature_flags TO service_role;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_read_feature_flags" ON public.feature_flags;
CREATE POLICY "anyone_read_feature_flags" ON public.feature_flags
  FOR SELECT USING (true);

-- Seed initial feature flags
INSERT INTO public.feature_flags (key, is_enabled, description) VALUES
  ('self_approval_lockdown', true, 'Forces status=pending on all leave and role requests'),
  ('biometric_liveness', true, 'Requires liveness check on attendance check-in'),
  ('sso_login_enabled', true, 'Allows Google and Microsoft OIDC SSO login'),
  ('email_one_click_approval', true, 'Embeds 1-click approve/reject action links in emails')
ON CONFLICT (key) DO NOTHING;

-- ==============================================
-- Migration: 20260801090000_analytics_materialized_views.sql
-- ==============================================
-- Extended Phase 4: Analytics Materialized Views, Refresh Procedures & Report Subscriptions

-- 1. Analytics Refresh Metadata Log
CREATE TABLE IF NOT EXISTS public.analytics_refresh_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.analytics_refresh_log (refreshed_at) VALUES (now());

-- 2. Materialized View: mv_attendance_weekly
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_attendance_weekly AS
SELECT
  l.student_id,
  cs.course_id,
  date_trunc('week', l.created_at) AS week_start,
  COUNT(*) AS total_held,
  COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END) AS total_attended,
  ROUND(
    (COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END)::numeric / GREATEST(COUNT(*), 1)::numeric) * 100,
    1
  ) AS attendance_pct
FROM public.attendance_ledger l
LEFT JOIN public.class_sessions cs ON cs.id = l.session_id
GROUP BY l.student_id, cs.course_id, date_trunc('week', l.created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_att_weekly_pk 
  ON public.mv_attendance_weekly (student_id, course_id, week_start);

-- 3. Materialized View: mv_department_summary
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_department_summary AS
SELECT
  p.department_id,
  COUNT(DISTINCT l.student_id) AS student_count,
  COUNT(l.id) AS total_sessions,
  COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END) AS total_present,
  ROUND(
    (COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END)::numeric / GREATEST(COUNT(l.id), 1)::numeric) * 100,
    1
  ) AS overall_attendance_pct
FROM public.attendance_ledger l
JOIN public.profiles p ON p.user_id = l.student_id
WHERE p.department_id IS NOT NULL
GROUP BY p.department_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dept_summary_pk 
  ON public.mv_department_summary (department_id);

-- 4. Composite Indexes for Underlying Ledger Queries
CREATE INDEX IF NOT EXISTS idx_ledger_dept_date 
  ON public.attendance_ledger (session_id, created_at);

-- 5. Refresh Procedure
CREATE OR REPLACE FUNCTION public.refresh_analytics_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_attendance_weekly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_department_summary;
  INSERT INTO public.analytics_refresh_log (refreshed_at) VALUES (now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Report Subscriptions Table
CREATE TABLE IF NOT EXISTS public.report_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  frequency text NOT NULL DEFAULT 'weekly',
  email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_subscriptions TO authenticated;
GRANT ALL ON public.report_subscriptions TO service_role;

ALTER TABLE public.report_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_manage_own_subscriptions" ON public.report_subscriptions;
CREATE POLICY "user_manage_own_subscriptions" ON public.report_subscriptions
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- ==============================================
-- Migration: 20260801100000_phase5_biometric_hardening.sql
-- ==============================================
-- Phase 5: Biometric & Anti-Proxy Hardening
-- 5.1 Liveness attestation session log
-- 5.2 Key rotation job tracking
-- 5.3 Hardware biometric adapter tables

-- ── 5.1  liveness_sessions ─────────────────────────────────────────────────
-- Records every server-side liveness check outcome.
-- Session IDs are vendor-issued (AWS Rekognition / fallback HMAC token) and
-- short-lived (3 min AWS TTL). We never store the raw SDK session token;
-- only the outcome (confidence, method, pass/fail) flows here.
CREATE TABLE IF NOT EXISTS public.liveness_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  vendor_session_id TEXT      NOT NULL,               -- opaque AWS / FaceTec token
  method          TEXT        NOT NULL DEFAULT 'rekognition'
                              CHECK (method IN ('rekognition','webauthn_bypass','hmac_fallback')),
  outcome         TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (outcome IN ('pending','passed','failed','error')),
  confidence      REAL        NULL,                   -- 0–100, NULL for non-SDK paths
  error_detail    TEXT        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ NULL
);

ALTER TABLE public.liveness_sessions ENABLE ROW LEVEL SECURITY;

-- Students may only see their own liveness records; server inserts via service role.
CREATE POLICY "liveness_sessions: students read own"
  ON public.liveness_sessions FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "liveness_sessions: service role full access"
  ON public.liveness_sessions FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_liveness_sessions_student ON public.liveness_sessions(student_id, created_at DESC);
CREATE INDEX idx_liveness_sessions_vendor  ON public.liveness_sessions(vendor_session_id);

-- ── 5.2a  key_rotation_jobs ────────────────────────────────────────────────
-- Tracks progress of the AES-GCM re-encryption background job.
-- The job is idempotent: rows with key_version = CURRENT_VERSION are skipped.
CREATE TABLE IF NOT EXISTS public.key_rotation_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID        REFERENCES public.profiles(user_id),
  target_version  INT         NOT NULL,               -- desired key version after job
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ NULL,
  rows_processed  INT         NOT NULL DEFAULT 0,
  rows_remaining  INT         NOT NULL DEFAULT 0,
  error_count     INT         NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','completed','failed','partial'))
);

ALTER TABLE public.key_rotation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "key_rotation_jobs: admins only"
  ON public.key_rotation_jobs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ── 5.2b  Add key_version to face_embeddings if missing ───────────────────
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'face_embeddings'
      AND column_name  = 'key_version'
  ) THEN
    ALTER TABLE public.face_embeddings ADD COLUMN key_version INT NOT NULL DEFAULT 0;
    COMMENT ON COLUMN public.face_embeddings.key_version IS
      'Biometric encryption key version. 0 = legacy (BIOMETRIC_ENC_KEY), N = BIOMETRIC_ENC_KEY_VN. '
      'Re-encryption job advances this to BIOMETRIC_ENC_KEY_CURRENT_VERSION.';
  END IF;
END
$$;

-- ── 5.3  hardware_checkins ─────────────────────────────────────────────────
-- Optional hardware biometric adapter output (fingerprint / RFID).
-- Reconciled with attendance_ledger by the same append-only logic.
CREATE TABLE IF NOT EXISTS public.hardware_checkins (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  session_id      UUID        REFERENCES public.class_sessions(id),
  hardware_type   TEXT        NOT NULL CHECK (hardware_type IN ('fingerprint','rfid','nfc')),
  reader_id       TEXT        NOT NULL,               -- physical device identifier
  checkin_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload     JSONB       NOT NULL DEFAULT '{}',  -- vendor-specific verification data
  verified        BOOLEAN     NOT NULL DEFAULT FALSE,
  error_detail    TEXT        NULL
);

ALTER TABLE public.hardware_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hardware_checkins: service role full access"
  ON public.hardware_checkins FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "hardware_checkins: students read own"
  ON public.hardware_checkins FOR SELECT
  USING (auth.uid() = student_id);

CREATE INDEX idx_hardware_checkins_student ON public.hardware_checkins(student_id, checkin_at DESC);
CREATE INDEX idx_hardware_checkins_session ON public.hardware_checkins(session_id);

-- ── 5.1b  Add liveness_method to attendance_events ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'attendance_events'
      AND column_name  = 'liveness_method'
  ) THEN
    ALTER TABLE public.attendance_events
      ADD COLUMN liveness_method TEXT NULL
      CHECK (liveness_method IN ('rekognition','webauthn_bypass','hmac_fallback','hardware'));
    COMMENT ON COLUMN public.attendance_events.liveness_method IS
      'Which liveness verification path was used for this event. NULL = legacy (pre-Phase 5).';
  END IF;
END
$$;

-- ── 5.1c  Add hardware_checkin to event_type allowed values ───────────────
DO $$
BEGIN
  -- attendance_events.event_type is TEXT (no enum), so just document allowed values in comment.
  COMMENT ON COLUMN public.attendance_events.event_type IS
    'Values: check_in | check_out | manual_correction | spot_check | hardware_checkin';
END
$$;

-- ==============================================
-- Migration: 20260801110000_phase1_5_gap_closure.sql
-- ==============================================
-- ============================================================================
-- Migration: Phase 1–5 Enterprise Gap Closure
-- Description: Trigger for immutable audit logs, device timestamp offset tracking,
--              condonation credit tracking, and key rotation state persistence.
-- ============================================================================

-- 1. Immutable Audit Log Enforcement Trigger
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CRITICAL: audit_log table is append-only. UPDATE and DELETE operations are strictly prohibited for compliance reasons.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger if audit_log table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'audit_log') THEN
    IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgname = 'trg_prevent_audit_log_modification') THEN
      CREATE TRIGGER trg_prevent_audit_log_modification
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH STATEMENT
      EXECUTE FUNCTION prevent_audit_log_modification();
    END IF;
  END IF;
END $$;

-- 2. Device Timestamp Offset Column for Attendance Events
ALTER TABLE IF EXISTS attendance_events 
ADD COLUMN IF NOT EXISTS device_timestamp_offset_ms INTEGER DEFAULT 0;

-- 3. Condonation Credits Table for Medical/Sports Leave Attendance Offsets
CREATE TABLE IF NOT EXISTS condonation_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  credited_classes INTEGER NOT NULL DEFAULT 1 CHECK (credited_classes > 0),
  reason TEXT NOT NULL,
  approved_by UUID REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for condonation_credits
ALTER TABLE condonation_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "condonation_credits_select_policy" ON condonation_credits
  FOR SELECT USING (
    auth.uid() = student_id OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

CREATE POLICY "condonation_credits_admin_insert_policy" ON condonation_credits
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

-- 4. Teacher Substitute Delegations Table
CREATE TABLE IF NOT EXISTS teacher_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_teacher_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  substitute_teacher_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_range_check CHECK (valid_until > valid_from)
);

ALTER TABLE teacher_delegations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_delegations_read" ON teacher_delegations
  FOR SELECT USING (
    auth.uid() IN (primary_teacher_id, substitute_teacher_id) OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "teacher_delegations_write" ON teacher_delegations
  FOR INSERT WITH CHECK (
    auth.uid() = primary_teacher_id OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 5. Add Checkpoint Column to Key Rotation Jobs for Batch Resume
ALTER TABLE IF EXISTS key_rotation_jobs
ADD COLUMN IF NOT EXISTS last_processed_id UUID DEFAULT NULL;

-- ==============================================
-- Migration: 20260801120000_pinnacle_gap_closure.sql
-- ==============================================
-- ============================================================================
-- Migration: Pinnacle Enterprise Gap Closure (Selected 4 Features)
-- Description: Attendance policy grace periods, student disputes table,
--              and spatial polygon/beacon tables.
-- ============================================================================

-- 1. Add Grace Period Columns to class_sessions
ALTER TABLE IF EXISTS class_sessions
ADD COLUMN IF NOT EXISTS grace_period_mins INTEGER DEFAULT 10 CHECK (grace_period_mins >= 0),
ADD COLUMN IF NOT EXISTS late_cutoff_mins INTEGER DEFAULT 20 CHECK (late_cutoff_mins >= grace_period_mins);

-- 2. Create Attendance Disputes Table
CREATE TABLE IF NOT EXISTS attendance_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  proof_attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  resolved_by UUID REFERENCES profiles(user_id),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attendance_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_disputes_read" ON attendance_disputes
  FOR SELECT USING (
    auth.uid() = student_id OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

CREATE POLICY "attendance_disputes_insert" ON attendance_disputes
  FOR INSERT WITH CHECK (
    auth.uid() = student_id
  );

CREATE POLICY "attendance_disputes_update" ON attendance_disputes
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'teacher'))
  );

-- ==============================================
-- Migration: 20260803000000_audit_logs_nullable_system_actor.sql
-- ==============================================
-- Fixes a bug that made every biometric-retention-purge audit-log write silently fail:
-- audit_logs.actor_id is `uuid NOT NULL REFERENCES auth.users(id)`, but the retention job
-- (src/lib/biometric-retention-policy.server.ts) previously inserted the literal string
-- "system_retention_policy" -- not a UUID, and not a real user -- and audit_logs.target_id is
-- `uuid NOT NULL` while the job inserted a custom string like "purge_1700000000_ab12". Both
-- inserts would fail Postgres's UUID type check every single time, and the failure was
-- swallowed by the job's try/catch, so the "audit trail" for this job has never actually
-- existed. This migration allows a NULL actor_id specifically for system/automated actions
-- (NULL is exempt from FK checks, so this doesn't require inventing a fake user row) and keeps
-- target_id as a real UUID as before -- the application code now generates one properly rather
-- than a custom string.

ALTER TABLE public.audit_logs
  ALTER COLUMN actor_id DROP NOT NULL;

COMMENT ON COLUMN public.audit_logs.actor_id IS
  'NULL indicates a system/automated action (e.g. the biometric retention job) with no human actor. Non-null values must reference a real auth.users row.';

-- ==============================================
-- Migration: 20260804000000_demo_seed_flag.sql
-- ==============================================
-- Demo mode feature flag
INSERT INTO public.feature_flags (key, is_enabled, description)
VALUES ('demo_mode', false, 'Enable demo mode: relaxes geofence, allows simulated liveness for hackathon demo')
ON CONFLICT (key) DO NOTHING;

-- ==============================================
-- Migration: 20260804010000_trust_score.sql
-- ==============================================
-- Add trust score columns to attendance_ledger
ALTER TABLE public.attendance_ledger
  ADD COLUMN IF NOT EXISTS trust_score integer,
  ADD COLUMN IF NOT EXISTS trust_breakdown jsonb;

COMMENT ON COLUMN public.attendance_ledger.trust_score IS 'Composite 0-100 Proof-of-Presence trust score computed from 6 verification signals';
COMMENT ON COLUMN public.attendance_ledger.trust_breakdown IS 'Detailed JSON breakdown of each trust score component (liveness, spatial, device, network, temporal, otp)';

-- ==============================================
-- Migration: 20260804020000_ledger_hash_chain.sql
-- ==============================================
-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add hash chain column
ALTER TABLE public.attendance_ledger
  ADD COLUMN IF NOT EXISTS record_hash text;

COMMENT ON COLUMN public.attendance_ledger.record_hash IS 'SHA-256 hash chaining this row to the previous entry for tamper-evident verification';

-- Trigger to compute hash on insert
CREATE OR REPLACE FUNCTION public.attendance_ledger_compute_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev_hash text;
BEGIN
  -- Look up the hash of the previous entry in the chain
  IF new.previous_entry_id IS NOT NULL THEN
    SELECT record_hash INTO prev_hash
    FROM public.attendance_ledger
    WHERE id = new.previous_entry_id;
  END IF;

  new.record_hash := encode(
    digest(
      coalesce(prev_hash, 'GENESIS') || '|' ||
      new.session_id::text || '|' ||
      new.student_id::text || '|' ||
      new.decision::text || '|' ||
      coalesce(new.similarity::text, '') || '|' ||
      coalesce(new.trust_score::text, '') || '|' ||
      new.created_at::text,
      'sha256'
    ),
    'hex'
  );
  RETURN new;
END;
$$;

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS attendance_ledger_hash_before_insert ON public.attendance_ledger;

CREATE TRIGGER attendance_ledger_hash_before_insert
  BEFORE INSERT ON public.attendance_ledger
  FOR EACH ROW EXECUTE FUNCTION public.attendance_ledger_compute_hash();

-- ==============================================
-- Initial Master Seed (Institutions & Departments)
-- ==============================================

INSERT INTO public.institutions (code, name) 
VALUES ('RRU', 'Rashtriya Raksha University') 
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.departments (code, name) VALUES
  ('SASET', 'School of Advanced Sciences, Engineering and Technology'),
  ('SITAICS', 'School of Information Technology, Artificial Intelligence and Cyber Security'),
  ('SISDSS', 'School of Internal Security, Defence and Strategic Studies'),
  ('SISSP', 'School of Internal Security and Strategic Policy'),
  ('SPES', 'School of Physical Education and Sports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.feature_flags (key, is_enabled, description) VALUES
  ('demo_mode', false, 'Enable demo mode: relaxes geofence, allows simulated liveness')
ON CONFLICT (key) DO NOTHING;
