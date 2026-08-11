import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = 'supabase/migrations';
const OUTPUT_FILE = 'master_migration.sql';

function combine() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Combining ${files.length} SQL migration files...`);

  let combinedSql = `-- Presence ERP Master Schema Migration Script\n`;
  combinedSql += `-- Generated at ${new Date().toISOString()}\n\n`;

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // In the first migration (20260709143622), inject private schema and overloaded has_role functions right after user_roles table creation
    if (file.startsWith('20260709143622')) {
      const userRolesMarker = 'create policy "user_roles_self_read" on public.user_roles for select to authenticated using (auth.uid() = user_id);';
      const helperFunctions = `\n\n` +
        `CREATE SCHEMA IF NOT EXISTS private;\n\n` +
        `CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)\n` +
        `RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$\n` +
        `  SELECT EXISTS (\n` +
        `    SELECT 1 FROM public.user_roles \n` +
        `    WHERE user_id = _user_id AND role::text = _role\n` +
        `  );\n` +
        `$$;\n\n` +
        `CREATE OR REPLACE FUNCTION public.has_role(_role text)\n` +
        `RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$\n` +
        `  SELECT EXISTS (\n` +
        `    SELECT 1 FROM public.user_roles \n` +
        `    WHERE user_id = auth.uid() AND role::text = _role\n` +
        `  );\n` +
        `$$;\n\n` +
        `CREATE OR REPLACE FUNCTION private.has_role(_role text)\n` +
        `RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$\n` +
        `  SELECT EXISTS (\n` +
        `    SELECT 1 FROM public.user_roles \n` +
        `    WHERE user_id = auth.uid() AND role::text = _role\n` +
        `  );\n` +
        `$$;\n\n` +
        `CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role text)\n` +
        `RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$\n` +
        `  SELECT EXISTS (\n` +
        `    SELECT 1 FROM public.user_roles \n` +
        `    WHERE user_id = _user_id AND role::text = _role\n` +
        `  );\n` +
        `$$;`;

      // Use function replacer to prevent JS String.replace from eating $$ into $
      content = content.replace(userRolesMarker, () => userRolesMarker + helperFunctions);
    }

    combinedSql += `-- ==============================================\n`;
    combinedSql += `-- Migration: ${file}\n`;
    combinedSql += `-- ==============================================\n`;
    combinedSql += content.trim() + `\n\n`;
  }

  // Add initial seed for institutions, departments, and admin role
  combinedSql += `-- ==============================================\n`;
  combinedSql += `-- Initial Master Seed (Institutions & Departments)\n`;
  combinedSql += `-- ==============================================\n`;
  combinedSql += `
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
`;

  fs.writeFileSync(OUTPUT_FILE, combinedSql, 'utf8');
  console.log(`✓ Regenerated ${OUTPUT_FILE} (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB)`);
}

combine();
