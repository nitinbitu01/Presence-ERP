-- Seed script for Rashtriya Raksha University (RRU)

-- 1. Create or update Institution record
INSERT INTO public.institutions (code, name, address, contact_email, is_active)
VALUES (
  'RRU',
  'Rashtriya Raksha University',
  'Lavad, Dehgam, Gandhinagar, Gujarat 382305',
  'info@rru.ac.in',
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  contact_email = EXCLUDED.contact_email,
  is_active = EXCLUDED.is_active;

-- Also update DEFAULT institution to RRU if present
UPDATE public.institutions
SET name = 'Rashtriya Raksha University',
    code = 'RRU',
    address = 'Lavad, Dehgam, Gandhinagar, Gujarat 382305',
    contact_email = 'info@rru.ac.in'
WHERE code = 'DEFAULT';

-- 2. Departments for RRU
INSERT INTO public.departments (code, name, institution_id)
SELECT d.code, d.name, i.id
FROM (VALUES
  ('SITAICS', 'School of Information Technology, AI & Cyber Security'),
  ('SISSP', 'School of Internal Security & Sports Science'),
  ('SISDSS', 'School of Internal Security, Defence & Strategic Studies'),
  ('SCLML', 'School of Criminology, Law & Military Law'),
  ('SPES', 'School of Physical Education & Sports'),
  ('SBFSI', 'School of Behavioural Forensic Sciences & Investigation'),
  ('SASET', 'School of Applied Sciences, Engineering & Technology')
) AS d(code, name)
CROSS JOIN (SELECT id FROM public.institutions WHERE code IN ('RRU', 'DEFAULT') LIMIT 1) i
ON CONFLICT (code) DO NOTHING;

-- 3. Programs under departments
INSERT INTO public.programs (department_id, code, name, duration_semesters)
SELECT d.id, p.code, p.name, p.duration_semesters
FROM (VALUES
  ('SITAICS', 'BTECH-I', 'B.Tech 1st Year', 2),
  ('SITAICS', 'BTECH-II', 'B.Tech 2nd Year', 4),
  ('SITAICS', 'BTECH-III', 'B.Tech 3rd Year', 6),
  ('SITAICS', 'BTECH-IV', 'B.Tech 4th Year', 8),
  ('SASET', 'BTECH-I', 'B.Tech 1st Year', 2),
  ('SASET', 'BTECH-II', 'B.Tech 2nd Year', 4),
  ('SASET', 'BTECH-III', 'B.Tech 3rd Year', 6),
  ('SASET', 'BTECH-IV', 'B.Tech 4th Year', 8)
) AS p(dept_code, code, name, duration_semesters)
JOIN public.departments d ON d.code = p.dept_code
ON CONFLICT (department_id, code) DO NOTHING;


-- 4. Active Semester
-- Deactivate old semesters first if necessary
UPDATE public.semesters SET is_active = false WHERE is_active = true AND code != '2026-FALL';

INSERT INTO public.semesters (code, name, starts_on, ends_on, is_active)
VALUES (
  '2026-FALL',
  'Fall Semester 2026',
  '2026-08-01',
  '2026-12-31',
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  starts_on = EXCLUDED.starts_on,
  ends_on = EXCLUDED.ends_on,
  is_active = true;
