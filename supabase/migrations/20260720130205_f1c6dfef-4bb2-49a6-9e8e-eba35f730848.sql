
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
