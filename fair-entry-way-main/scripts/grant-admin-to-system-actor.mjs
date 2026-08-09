import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";
const SYSTEM_ACTOR_ID = 'a92f7808-4c85-444d-a511-db18d9cd99ea';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("Granting admin role to SYSTEM_ACTOR_ID in user_roles...");

  // 1. Grant admin role
  const { error: roleErr } = await supabaseAdmin.from('user_roles').upsert({
    user_id: SYSTEM_ACTOR_ID,
    role: 'admin',
  }, { onConflict: 'user_id,role' });

  if (roleErr) {
    console.error("Error granting admin role:", roleErr.message);
    return;
  }
  console.log("✓ Granted admin role to SYSTEM_ACTOR_ID!");

  // 2. Sign in as system actor to get JWT token
  const { data: sessionData, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
    email: 'system.actor@presence.internal',
    password: 'SystemActorPassword123!',
  });

  if (signInErr || !sessionData.session) {
    console.error("Sign in error:", signInErr?.message);
    return;
  }

  const userToken = sessionData.session.access_token;
  console.log("✓ Acquired user token for SYSTEM_ACTOR_ID");

  // 3. Create authenticated user client
  const userClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzMzNDMsImV4cCI6MjEwMTQwOTM0M30.NzzJkU-_IwV-iEE-yKmYWAaIra6W1CwS--ordaqVnGY", {
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
  });

  // 4. Get a pending leave request
  const { data: pending } = await supabaseAdmin
    .from('leave_requests')
    .select('id, status, reason')
    .eq('status', 'pending')
    .limit(1);

  if (!pending || pending.length === 0) {
    console.log("No pending leave requests found.");
    return;
  }

  const targetId = pending[0].id;
  console.log("Attempting leave approval via userClient for request ID:", targetId, "Reason:", pending[0].reason);

  const { error: updateErr } = await userClient
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: SYSTEM_ACTOR_ID,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', targetId);

  if (updateErr) {
    console.error("❌ UPDATE FAILED:", updateErr.message);
  } else {
    console.log("🎉 SUCCESS! Leave request was successfully approved in DB!");

    // Verify in database
    const { data: verified } = await supabaseAdmin
      .from('leave_requests')
      .select('id, status, approved_by')
      .eq('id', targetId)
      .single();

    console.log("Verified database status after update:", verified);
  }
}

main().catch(console.error);
