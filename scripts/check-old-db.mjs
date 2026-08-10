import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://kdqcfhhaffsbhnmvrjmt.supabase.co";
const ANON_KEY = "sb_publishable_qtBzgk_bEgNdMMlcbcaLxA_F-Eul3bW";

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  console.log("Checking project kdqcfhhaffsbhnmvrjmt.supabase.co...");
  const { data: inst, error: instErr } = await supabase.from('institutions').select('id, name').limit(5);
  console.log("Institutions:", inst, "Error:", instErr?.message);

  const { data: profiles, error: profErr } = await supabase.from('profiles').select('user_id, display_name').limit(5);
  console.log("Profiles:", profiles, "Error:", profErr?.message);
}

main().catch(console.error);
