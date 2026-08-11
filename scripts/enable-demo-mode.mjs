import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log("Enabling demo_mode feature flag in Supabase DB...");
  const { error } = await supabase.from("feature_flags").upsert(
    {
      key: "demo_mode",
      is_enabled: true,
      description: "Enable demo mode: relaxes geofence and allows multi-account face testing for hackathon demo",
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("Error setting demo_mode flag:", error.message);
  } else {
    console.log("✓ demo_mode feature flag successfully enabled!");
  }
}

run().catch(console.error);
