import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const SYSTEM_ACTOR_ID = "a92f7808-4c85-444d-a511-db18d9cd99ea";
  console.log("Upserting system actor profile...");

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: SYSTEM_ACTOR_ID,
      display_name: "System Audit Actor",
      roll_no: "SYS-001",
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("Profile upsert note:", error.message);
  } else {
    console.log("✓ Profile for system actor created successfully!");
  }
}

main().catch(console.error);
