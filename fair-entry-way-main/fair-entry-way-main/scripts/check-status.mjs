import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, status, reason, approved_by, reviewed_at");

  if (error) {
    console.error("Error:", error.message);
    return;
  }

  console.log("Current leave_requests in database:");
  for (const r of data ?? []) {
    console.log(
      `- ID: ${r.id} | Status: ${r.status} | Reason: "${r.reason}" | ApprovedBy: ${r.approved_by}`,
    );
  }
}

main().catch(console.error);
