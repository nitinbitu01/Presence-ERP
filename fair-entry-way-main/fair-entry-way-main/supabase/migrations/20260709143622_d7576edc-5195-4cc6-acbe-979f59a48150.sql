
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
