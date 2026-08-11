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
