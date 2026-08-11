
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
