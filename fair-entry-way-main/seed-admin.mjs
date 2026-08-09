// seed-admin.mjs
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kdqcfhhaffsbhnmvrjmt.supabase.co";
const ANON_KEY = "sb_publishable_qtBzgk_bEgNdMMlcbcaLxA_F-Eul3bW";

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  console.log("Seeding institutions...");
  let { data: inst } = await supabase.from("institutions").select("id").limit(1).maybeSingle();

  if (!inst) {
    console.log("Inserting default institution...");
    const { data: newInst, error } = await supabase
      .from("institutions")
      .insert({
        code: "RRU",
        name: "Rashtriya Raksha University",
      })
      .select("id")
      .single();
    if (error) {
      console.error("Institution error:", error);
      return;
    }
    inst = newInst;
  }
  console.log("Institution ID:", inst.id);

  const defaultDepts = [
    {
      code: "SITAICS",
      name: "School of Information Technology, AI & Cyber Security",
      institution_id: inst.id,
    },
    {
      code: "SISSP",
      name: "School of Internal Security & Sports Science",
      institution_id: inst.id,
    },
    {
      code: "SISDSS",
      name: "School of Internal Security, Defence & Strategic Studies",
      institution_id: inst.id,
    },
    { code: "SCLML", name: "School of Criminology, Law & Military Law", institution_id: inst.id },
    { code: "SPES", name: "School of Physical Education & Sports", institution_id: inst.id },
    {
      code: "SBFSI",
      name: "School of Behavioural Forensic Sciences & Investigation",
      institution_id: inst.id,
    },
    {
      code: "SASET",
      name: "School of Applied Sciences, Engineering & Technology",
      institution_id: inst.id,
    },
  ];

  for (const d of defaultDepts) {
    const { error } = await supabase
      .from("departments")
      .upsert(d, { onConflict: "code", ignoreDuplicates: true });
    if (error) console.error(`Dept error (${d.code}):`, error.message);
    else console.log(`Dept OK: ${d.code}`);
  }

  const { data: depts } = await supabase
    .from("departments")
    .select("id, code")
    .in("code", ["SITAICS", "SASET"]);

  if (depts && depts.length > 0) {
    const btechPrograms = [
      { code: "BTECH-I", name: "B.Tech 1st Year", duration_semesters: 2 },
      { code: "BTECH-II", name: "B.Tech 2nd Year", duration_semesters: 4 },
      { code: "BTECH-III", name: "B.Tech 3rd Year", duration_semesters: 6 },
      { code: "BTECH-IV", name: "B.Tech 4th Year", duration_semesters: 8 },
    ];

    for (const dept of depts) {
      for (const prog of btechPrograms) {
        const { error } = await supabase.from("programs").upsert(
          {
            department_id: dept.id,
            code: prog.code,
            name: prog.name,
            duration_semesters: prog.duration_semesters,
          },
          { onConflict: "department_id,code", ignoreDuplicates: true },
        );
        if (error) console.error(`Prog error (${prog.code}):`, error.message);
        else console.log(`Prog OK: ${prog.code} (${dept.code})`);
      }
    }
  }
}

main().catch(console.error);
