import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const userId = "5d89c94d-6607-4b4b-9e56-9add800b2852"; // nitinbitu03@gmail.com
  console.log("Ensuring admin profile and role for user:", userId);

  // 1. Create or update profile
  const { error: profileErr } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      display_name: "Nitin Bitu (Admin)",
      roll_no: "ADMIN001",
    },
    { onConflict: "user_id" },
  );

  if (profileErr) {
    console.error("Profile creation error:", profileErr.message);
  } else {
    console.log("Profile created/updated successfully ✓");
  }

  // 2. Assign admin role in user_roles
  const { error: roleErr } = await supabase.from("user_roles").upsert(
    {
      user_id: userId,
      role: "admin",
    },
    { onConflict: "user_id,role" },
  );

  if (roleErr) {
    console.error("User role assignment error:", roleErr.message);
  } else {
    console.log("Admin role assigned successfully ✓");
  }
}

main().catch(console.error);
