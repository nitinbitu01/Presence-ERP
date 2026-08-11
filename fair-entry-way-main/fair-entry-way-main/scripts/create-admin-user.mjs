import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Checking / creating user nitinbitu03@gmail.com in", SUPABASE_URL);

  const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("List users error:", listErr.message);
    return;
  }

  let adminUser = users.users.find((u) => u.email === "nitinbitu03@gmail.com");

  if (!adminUser) {
    console.log("User not found. Creating nitinbitu03@gmail.com...");
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email: "nitinbitu03@gmail.com",
      password: "Nitinyadav#2006",
      email_confirm: true,
      user_metadata: { display_name: "Nitin Bitu Admin" },
    });

    if (createErr) {
      console.error("Failed to create admin user:", createErr.message);
      return;
    }

    adminUser = createData.user;
    console.log("Successfully created user nitinbitu03@gmail.com (ID:", adminUser.id, ")");
  } else {
    console.log("User nitinbitu03@gmail.com exists (ID:", adminUser.id, "). Updating password...");
    const { error: updateErr } = await supabase.auth.admin.updateUserById(adminUser.id, {
      password: "Nitinyadav#2006",
      email_confirm: true,
    });
    if (updateErr) console.error("Update error:", updateErr.message);
    else console.log("Password updated successfully!");
  }
}

main().catch(console.error);
