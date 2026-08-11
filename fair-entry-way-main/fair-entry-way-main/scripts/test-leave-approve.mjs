import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("Testing leave request update directly...");
  const { data: requests, error: fetchErr } = await supabase
    .from("leave_requests")
    .select("id, student_id, status, reason")
    .eq("status", "pending")
    .limit(1);

  if (fetchErr) {
    console.error("Fetch error:", fetchErr.message);
    return;
  }

  if (!requests || requests.length === 0) {
    console.log("No pending leave requests found to test.");
    return;
  }

  const target = requests[0];
  console.log("Testing approval on pending request ID:", target.id, "Reason:", target.reason);

  const SYSTEM_ACTOR_ID = "a92f7808-4c85-444d-a511-db18d9cd99ea";
  const { error: updateErr } = await supabase
    .from("leave_requests")
    .update({
      status: "approved",
      approved_by: SYSTEM_ACTOR_ID,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", target.id);

  if (updateErr) {
    console.error("❌ DIRECT UPDATE FAILED WITH ERROR:", updateErr.message);
  } else {
    console.log("✓ DIRECT UPDATE SUCCEEDED FOR REQUEST ID:", target.id);
  }
}

main().catch(console.error);
