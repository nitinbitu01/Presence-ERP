import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log("Seeding departments & programs...");

  // Ensure default institution
  let { data: inst } = await supabase.from('institutions').select('id').eq('code', 'RRU').maybeSingle();
  if (!inst) {
    const { data: newInst } = await supabase.from('institutions').insert({ code: 'RRU', name: 'Rashtriya Raksha University' }).select('id').single();
    inst = newInst;
  }
  const instId = inst.id;

  const defaultDepts = [
    { code: "SASET", name: "School of Advanced Sciences, Engineering and Technology" },
    { code: "SITAICS", name: "School of Information Technology, Artificial Intelligence and Cyber Security" },
    { code: "SISDSS", name: "School of Internal Security, Defence and Strategic Studies" },
    { code: "SISSP", name: "School of Internal Security and Strategic Policy" },
    { code: "SPES", name: "School of Physical Education and Sports" },
  ];

  for (const d of defaultDepts) {
    await supabase.from("departments").upsert(
      { code: d.code, name: d.name, institution_id: instId },
      { onConflict: "code" }
    );
  }

  const { data: depts } = await supabase.from("departments").select("id, code");
  console.log("Departments in DB:", depts);

  const defaultPrograms = [
    { code: "BTECH-CS", name: "B.Tech Computer Science & Engineering", duration_semesters: 8 },
    { code: "BTECH-CY", name: "B.Tech Cyber Security", duration_semesters: 8 },
    { code: "BTECH-I", name: "B.Tech 1st Year", duration_semesters: 2 },
    { code: "BTECH-II", name: "B.Tech 2nd Year", duration_semesters: 4 },
    { code: "BTECH-III", name: "B.Tech 3rd Year", duration_semesters: 6 },
    { code: "BTECH-IV", name: "B.Tech 4th Year", duration_semesters: 8 },
    { code: "MTECH-AI", name: "M.Tech Artificial Intelligence", duration_semesters: 4 },
    { code: "MSC-DS", name: "M.Sc Data Science & Analytics", duration_semesters: 4 },
    { code: "MA-SS", name: "M.A. Strategic Studies & Defence", duration_semesters: 4 },
  ];

  for (const dept of depts || []) {
    for (const prog of defaultPrograms) {
      await supabase.from("programs").upsert(
        {
          department_id: dept.id,
          code: prog.code,
          name: prog.name,
          duration_semesters: prog.duration_semesters,
        },
        { onConflict: "department_id,code" }
      );
    }
  }

  const { data: progs } = await supabase.from("programs").select("id, department_id, code, name");
  console.log("Programs in DB count:", progs?.length);
  console.log("Programs in DB sample:", JSON.stringify(progs, null, 2));
}

run().catch(console.error);
