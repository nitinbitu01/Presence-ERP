import { createClient } from '@supabase/supabase-js';

const SUPABASE_PROJECT_ID = "omewkcnzhgptspgljrnc";
const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testEndpoints() {
  console.log("Testing system actor user creation...");

  // Create system actor user without custom nil ID
  const { data: userData, error: userErr } = await supabase.auth.admin.createUser({
    email: 'system.actor@presence.internal',
    password: 'SystemActorPassword123!',
    email_confirm: true,
    user_metadata: { display_name: 'System Audit Actor' },
  });

  if (userData?.user) {
    console.log("✓ Created system actor user in auth.users with ID:", userData.user.id);
  } else {
    console.log("System actor user creation note:", userErr?.message);
    // Fetch user by email if already exists
    const { data: users } = await supabase.auth.admin.listUsers();
    const existing = users?.users?.find(u => u.email === 'system.actor@presence.internal');
    if (existing) {
      console.log("✓ Found existing system actor user with ID:", existing.id);
    }
  }
}

testEndpoints().catch(console.error);
