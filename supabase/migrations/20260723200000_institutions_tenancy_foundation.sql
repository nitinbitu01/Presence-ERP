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
