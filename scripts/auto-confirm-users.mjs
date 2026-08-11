import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log("Checking unconfirmed users in Supabase Auth...");
  const { data: usersData, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error("Error listing users:", error.message);
    return;
  }

  const users = usersData.users;
  console.log(`Found ${users.length} total users in Auth.`);

  let confirmedCount = 0;
  for (const user of users) {
    if (!user.email_confirmed_at) {
      console.log(`Auto-confirming user: ${user.email} (ID: ${user.id})...`);
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
        email_confirm: true,
      });
      if (updateErr) {
        console.error(`Failed to confirm ${user.email}:`, updateErr.message);
      } else {
        console.log(`✓ Confirmed ${user.email}`);
        confirmedCount++;
      }
    } else {
      console.log(`User already confirmed: ${user.email}`);
    }
  }

  console.log(`\nAuto-confirmation finished. Confirmed ${confirmedCount} pending users.`);
}

run().catch(console.error);
