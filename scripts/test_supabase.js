import { createClient } from "@supabase/supabase-js";

const url = "https://kdqcfhhaffsbhnmvrjmt.supabase.co";
const key = "sb_publishable_qtBzgk_bEgNdMMlcbcaLxA_F-Eul3bW";

const supabase = createClient(url, key);

async function main() {
  console.log("Checking Supabase connection...");
  const { data: depts, error: err1 } = await supabase.from("departments").select("*");
  console.log("Departments:", depts?.length, "Error:", err1?.message);

  const { data: roles, error: err2 } = await supabase.from("user_roles").select("*");
  console.log("User Roles count:", roles?.length, "Error:", err2?.message);

  const { data: profs, error: err3 } = await supabase.from("profiles").select("*");
  console.log("Profiles count:", profs?.length, "Error:", err3?.message);

  console.log("Profiles data:", JSON.stringify(profs, null, 2));
}

main().catch(console.error);
