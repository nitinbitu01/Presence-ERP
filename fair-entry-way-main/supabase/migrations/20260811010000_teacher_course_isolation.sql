-- ============================================================================
-- Teacher ↔ Course Isolation Fix
-- ============================================================================
-- Root cause of "5 subjects becomes 7-9" and cross-account data leakage:
--   1. `courses.teacher_id` was the ONLY representation of "which subjects
--      does this teacher teach". `assignSignupRole` would STEAL a course from
--      its current teacher by running `UPDATE courses SET teacher_id = <new>`
--      whenever a new signup selected an existing subject code.
--   2. `maybeSingle()` on `courses.code` returns `{ data: null, error }` when
--      legacy duplicate codes exist; the code ignored `error` and inserted yet
--      another row, multiplying subjects per teacher.
--   3. Logout never cleared React Query cache / localStorage / component state,
--      so the previous user's profile name and subjects persisted.
--
-- This migration introduces a canonical `teacher_courses` join table as the
-- authoritative source of "which subjects does this teacher teach", dedupes
-- existing `courses` rows by code, and backfills the join table.
-- ============================================================================

-- ── 1. Canonical teacher→course assignment join table ────────────────────────
create table if not exists public.teacher_courses (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (teacher_id, course_id)
);

comment on table public.teacher_courses is
  'Canonical source of truth for which subjects (courses) a teacher teaches. '
  'Never merge, steal, or reassign rows here across teachers.';

create index if not exists teacher_courses_teacher_idx
  on public.teacher_courses(teacher_id);
create index if not exists teacher_courses_course_idx
  on public.teacher_courses(course_id);

grant select, insert, delete on public.teacher_courses to authenticated;
grant all on public.teacher_courses to service_role;

alter table public.teacher_courses enable row level security;

-- Teachers can read their own assignments only.
create policy "teacher_courses_read_own"
  on public.teacher_courses for select
  to authenticated
  using (auth.uid() = teacher_id);

-- Teachers can insert their own assignments only (no stealing).
create policy "teacher_courses_insert_own"
  on public.teacher_courses for insert
  to authenticated
  with check (auth.uid() = teacher_id);

-- ── 2. Deduplicate existing courses by code ──────────────────────────────────
-- Keep the earliest row per code; remap dependent rows to the canonical id;
-- delete orphan duplicates. This cleans up already-polluted 7-9-row subjects.
do $$
declare
  dup record;
  canonical_id uuid;
begin
  for dup in
    select code, array_agg(id order by created_at asc, id asc) as ids
    from public.courses
    group by code
    having count(*) > 1
  loop
    canonical_id := dup.ids[1];

    -- Remap enrollments
    update public.enrollments
      set course_id = canonical_id
      where course_id = any(dup.ids[2:]);

    -- Remap class_sessions
    update public.class_sessions
      set course_id = canonical_id
      where course_id = any(dup.ids[2:]);

    -- Remap timetable
    update public.timetable
      set course_id = canonical_id
      where course_id = any(dup.ids[2:]);

    -- Remap exam-related tables if they exist
    begin
      update public.exams
        set course_id = canonical_id
        where course_id = any(dup.ids[2:]);
    exception when undefined_table then null; end;

    begin
      update public.exam_results
        set course_id = canonical_id
        where course_id = any(dup.ids[2:]);
    exception when undefined_table then null; end;

    -- Delete orphan duplicate course rows
    delete from public.courses
      where id = any(dup.ids[2:]);
  end loop;
end $$;

-- ── 3. Backfill teacher_courses from existing courses.teacher_id ─────────────
insert into public.teacher_courses (teacher_id, course_id, assigned_at)
select c.teacher_id, c.id, c.created_at
from public.courses c
where c.teacher_id is not null
on conflict (teacher_id, course_id) do nothing;

-- ── 4. Make courses.teacher_id nullable going forward ────────────────────────
-- The join table is now the source of truth. `courses.teacher_id` is kept for
-- backward compatibility but is no longer the sole authority.
alter table public.courses
  alter column teacher_id drop not null;

-- ── 5. Guard against future duplicate codes ──────────────────────────────────
-- Ensure the unique constraint exists (it may already, but be idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'courses_code_key' and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses add constraint courses_code_key unique (code);
  end if;
end $$;