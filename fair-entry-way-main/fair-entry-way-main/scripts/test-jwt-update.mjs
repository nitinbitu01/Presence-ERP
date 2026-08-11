import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("Testing user session update for leave_requests...");
  const SYSTEM_ACTOR_ID = "a92f7808-4c85-444d-a511-db18d9cd99ea";

  // 1. Get a pending request
  const { data: requests } = await supabaseAdmin
    .from("leave_requests")
    .select("id, student_id, status")
    .eq("status", "pending")
    .limit(1);

  if (!requests || requests.length === 0) {
    console.log("No pending leave requests found.");
    return;
  }

  const reqId = requests[0].id;
  console.log("Targeting request ID:", reqId);

  // 2. Generate a user session for SYSTEM_ACTOR_ID
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: "system.actor@presence.internal",
  });

  if (linkErr) {
    console.error("Magiclink generation error:", linkErr.message);
    return;
  }

  console.log("✓ Magiclink generated!");

  // Create a client initialized with the user's access token if available, or test sign-in
  const { data: sessionData, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
    email: "system.actor@presence.internal",
    password: "SystemActorPassword123!",
  });

  if (signInErr || !sessionData.session) {
    console.error("Sign in error:", signInErr?.message);
    return;
  }

  const userToken = sessionData.session.access_token;
  console.log("✓ Signed in as system actor user. Token acquired.");

  // Create a user-authenticated Supabase client
  const userClient = createClient(
    SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzMzNDMsImV4cCI6MjEwMTQwOTM0M30.NzzJkU-_IwV-iEE-yKmYWAaIra6W1CwS--ordaqVnGY",
    {
      global: {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    },
  );

  // Now perform the update using the user-authenticated client or supabaseAdmin with JWT
  const { error: userUpdateErr } = await userClient
    .from("leave_requests")
    .update({
      status: "approved",
      approved_by: SYSTEM_ACTOR_ID,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", reqId);

  if (userUpdateErr) {
    console.error("❌ USER CLIENT UPDATE FAILED:", userUpdateErr.message);
  } else {
    console.log("🎉 SUCCESS! USER CLIENT UPDATE SUCCEEDED FOR REQUEST ID:", reqId);
  }
}

main().catch(console.error);
