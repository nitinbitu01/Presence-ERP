// seed-departments.mjs
// Run: node seed-departments.mjs
// Seeds departments and programs into Supabase via REST API

const SUPABASE_URL = "https://kdqcfhhaffsbhnmvrjmt.supabase.co";
// Using the publishable (anon) key - will use service role header trick
// Actually we need the service_role key. Let's use the REST API with anon key
// but we need service role for bypassing RLS on departments table.
// We'll call via the admin REST endpoint.

// Try with anon key first (departments may be publicly insertable by admin)
const ANON_KEY = "sb_publishable_qtBzgk_bEgNdMMlcbcaLxA_F-Eul3bW";

async function supabaseRequest(path, method = "GET", body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    Prefer: "return=representation",
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[${method} ${path}] ${res.status}: ${text}`);
    return null;
  }
  return text ? JSON.parse(text) : null;
}

// Departments to add
const DEPARTMENTS = [
  {
    code: "SITAICS",
    name: "School of Information Technology, Artificial Intelligence & Computer Science",
  },
  { code: "SISSP", name: "School of Intelligence, Security Studies & Psychology" },
  { code: "SISDSS", name: "School of Intelligence & Data Science for Security" },
  { code: "SCLML", name: "School of Computational Linguistics & Machine Learning" },
  { code: "SPES", name: "School of Physical Education & Sports" },
  { code: "SBFSI", name: "School of Business, Finance & Strategic Intelligence" },
  { code: "SASET", name: "School of Applied Science, Engineering & Technology" },
];

// Programs for SITAICS and SASET
const BTECH_PROGRAMS = [
  { code: "BTECH-I", name: "B.Tech 1st Year" },
  { code: "BTECH-II", name: "B.Tech 2nd Year" },
  { code: "BTECH-III", name: "B.Tech 3rd Year" },
  { code: "BTECH-IV", name: "B.Tech 4th Year" },
];

async function main() {
  console.log("Fetching existing departments...");
  const existing = await supabaseRequest("departments?select=id,code");
  const existingCodes = existing ? existing.map((d) => d.code) : [];
  console.log("Existing department codes:", existingCodes);

  const insertedDepts = {};

  // Insert missing departments
  for (const dept of DEPARTMENTS) {
    if (existingCodes.includes(dept.code)) {
      console.log(`⏭  Department ${dept.code} already exists.`);
      const ex = existing.find((d) => d.code === dept.code);
      if (ex) insertedDepts[dept.code] = ex.id;
      continue;
    }
    console.log(`➕ Inserting department: ${dept.code}`);
    const result = await supabaseRequest("departments", "POST", dept);
    if (result && result[0]) {
      insertedDepts[dept.code] = result[0].id;
      console.log(`   ✅ Created ${dept.code} with id=${result[0].id}`);
    } else {
      console.log(`   ❌ Failed to create ${dept.code}`);
    }
  }

  // Also get existing dept IDs for pre-existing ones
  if (Object.keys(insertedDepts).length < DEPARTMENTS.length) {
    const allDepts = await supabaseRequest("departments?select=id,code");
    if (allDepts) {
      for (const d of allDepts) {
        insertedDepts[d.code] = d.id;
      }
    }
  }

  console.log("\nFetching existing programs...");
  const existingPrograms = await supabaseRequest("programs?select=id,code,department_id");
  const existingProgramKeys = existingPrograms
    ? existingPrograms.map((p) => `${p.department_id}::${p.code}`)
    : [];

  // Insert BTECH programs for SITAICS and SASET
  for (const deptCode of ["SITAICS", "SASET"]) {
    const deptId = insertedDepts[deptCode];
    if (!deptId) {
      console.log(`⚠️  No ID found for department ${deptCode}, skipping programs.`);
      continue;
    }
    for (const prog of BTECH_PROGRAMS) {
      const key = `${deptId}::${prog.code}`;
      if (existingProgramKeys.includes(key)) {
        console.log(`⏭  Program ${prog.code} in ${deptCode} already exists.`);
        continue;
      }
      console.log(`➕ Inserting program: ${prog.code} in ${deptCode}`);
      const result = await supabaseRequest("programs", "POST", {
        code: prog.code,
        name: prog.name,
        department_id: deptId,
      });
      if (result && result[0]) {
        console.log(`   ✅ Created ${prog.code} in ${deptCode}`);
      } else {
        console.log(`   ❌ Failed to create ${prog.code} in ${deptCode}`);
      }
    }
  }

  console.log("\n✅ Seeding complete!");

  // Final check
  const finalDepts = await supabaseRequest("departments?select=id,code,name&order=code");
  console.log("\nFinal departments in DB:");
  if (finalDepts) finalDepts.forEach((d) => console.log(`  ${d.code}: ${d.name} (${d.id})`));

  const finalProgs = await supabaseRequest("programs?select=id,code,department_id&order=code");
  console.log("\nFinal programs in DB:");
  if (finalProgs) finalProgs.forEach((p) => console.log(`  ${p.code} (dept: ${p.department_id})`));
}

main().catch(console.error);
