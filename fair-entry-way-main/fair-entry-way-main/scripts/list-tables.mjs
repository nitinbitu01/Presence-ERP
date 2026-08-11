import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data: featureFlags, error: ffErr } = await supabase
    .from("feature_flags")
    .select("key, description");
  console.log("feature_flags error:", ffErr?.message);
  console.log("feature_flags count:", featureFlags?.length);

  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("user_id")
    .limit(1);
  console.log("profiles accessible:", !pErr);
}

main();
