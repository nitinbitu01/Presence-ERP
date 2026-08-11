import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("Testing insert into profiles for nil uuid...");
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';

  const { error } = await supabase.from('profiles').insert({
    user_id: NIL_UUID,
    display_name: 'Nil System Actor',
  });

  if (error) {
    console.log("Profiles insert error:", error.message);
  } else {
    console.log("✓ Profiles nil insert succeeded!");
  }
}

main();
