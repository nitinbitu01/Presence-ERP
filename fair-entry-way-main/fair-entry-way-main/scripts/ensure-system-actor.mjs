import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Checking / creating system actor user in auth.users...");
  const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

  try {
    const { data: user, error } = await supabase.auth.admin.getUserById(SYSTEM_ACTOR_ID);
    if (user && user.user) {
      console.log("✓ System actor user already exists in auth.users:", user.user.id);
      return;
    }
  } catch (e) {
    console.log("User lookup note:", e.message);
  }

  // Create system actor user via Admin API
  const { data, error } = await supabase.auth.admin.createUser({
    id: SYSTEM_ACTOR_ID,
    email: "system.actor@presence.internal",
    password: "SystemActorPassword123!",
    email_confirm: true,
    user_metadata: { display_name: "System Actor" },
  });

  if (error) {
    console.log("Result from admin.createUser:", error.message);
  } else {
    console.log("✓ Successfully created system actor user:", data.user?.id);
  }
}

main().catch(console.error);
