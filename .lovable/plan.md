## Phase 2 kickoff — Departments, Semesters, Department-scoped Rosters

Scope for this pass (three tightly-related building blocks, everything else in the phase — CSV import, bulk teacher assignment, admin dashboard tiles — comes right after):

### 1. Data model (one migration)

New tables in `public`:

- `departments` — `code` (unique, e.g. `CSE`), `name`, `created_at`, `updated_at`.
- `programs` — `department_id` FK, `code` (unique per dept, e.g. `BTECH-CSE`), `name`, `duration_semesters` (int, default 8).
- `semesters` — `code` (unique, e.g. `2026-ODD`), `name`, `starts_on`, `ends_on`, `is_active` (bool). Exactly one active at a time (partial unique index).

Extensions:

- `profiles` gains `department_id` (nullable FK), `program_id` (nullable FK), `current_semester` (int, nullable), `roll_no` (text, unique nullable).
- `courses` gains `department_id` (nullable FK for backfill), `semester_id` (nullable FK).
- `enrollments` gains `semester_id` (nullable FK) so the same student can re-enroll a course in a different term.

RLS + GRANTs:

- `departments` / `programs` / `semesters`: `SELECT` to `authenticated`; write only via `private.has_role(auth.uid(), 'admin')`.
- Existing `profiles` / `courses` / `enrollments` policies keep working; new columns default nullable so nothing breaks.

Seed: one department `GEN` ("General"), one program `GEN-DEFAULT`, one semester marked active for today so the UI is never empty.

### 2. Server functions (`src/lib/admin.functions.ts`)

Admin-only unless noted:

- `listDepartments`, `createDepartment`, `renameDepartment`.
- `listPrograms(departmentId?)`, `createProgram`.
- `listSemesters`, `createSemester`, `setActiveSemester` (flips `is_active`, ensures single active).
- `listDepartmentRoster(departmentId, semesterId?)` — profiles in a department with role tags + course-enrollment count for the given semester.
- `assignStudentToDepartment({ userId, departmentId, programId, currentSemester, rollNo })`.
- `bulkEnrollStudents({ courseId, semesterId, userIds[] })` and `unenrollStudent({ courseId, semesterId, userId })` for department-scoped roster ops.
- `getActiveSemester` (any authenticated user) so teacher dashboard defaults correctly.

Teacher-side (`src/lib/attendance.functions.ts`):

- `createCourse` gains optional `departmentId` + `semesterId` (defaults to active semester).
- `listMyCourses` returns dept/semester labels.

### 3. UI

- **New admin tab "Departments & Semesters"** in `src/routes/_authenticated/admin.tsx` (adds two panes: manage departments/programs, manage semesters with "Set active"). No new route needed.
- **New admin tab "Rosters"**: pick department + semester → list students → assign to program/semester/roll no → bulk-enroll into a selected course.
- **Teacher dashboard**: course-create form gets a Department + Semester selector (semester defaults to active); session list shows semester chip.
- **Enroll page** (student): if `profiles.department_id` is null, show a one-time "Pick your department / program / semester / roll no" card before biometric enrollment.

### Non-goals this pass

CSV import, teacher-assignment bulk tool, admin dashboard tiles, defaulter reports — all Phase 2 but scheduled in the next passes so this one stays reviewable.

### Technical details

- Single migration file with `CREATE TABLE` → `GRANT` → `ENABLE RLS` → `CREATE POLICY` per table, plus one seed `INSERT ... ON CONFLICT DO NOTHING` block for `GEN` dept/program and today's active semester.
- Partial unique index for active semester: `CREATE UNIQUE INDEX ON public.semesters (is_active) WHERE is_active`.
- All new admin server fns gate through the existing `requireAdmin(userId)` helper; `bulkEnrollStudents` uses `supabaseAdmin` because it needs to bypass the per-student RLS.
- Types regenerate after migration approval, so UI wiring happens in the follow-up edit batch.
