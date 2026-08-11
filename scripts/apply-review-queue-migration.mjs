import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const sql = `
CREATE TABLE IF NOT EXISTS public.enrollment_review_queue (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_embedding_ciphertext  TEXT          NOT NULL,
  matched_student_id              UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  similarity                      NUMERIC(6,5)  NOT NULL,
  status                          TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by                     UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at                     TIMESTAMPTZ   NULL,
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE public.enrollment_review_queue ENABLE ROW LEVEL SECURITY;
`;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ query: sql })
    });
    console.log("SQL exec response status:", res.status);
  } catch (e) {
    console.log("Error running SQL:", e.message);
  }

  const { error } = await supabase.from('enrollment_review_queue').select('id').limit(1);
  if (!error) {
    console.log("✓ enrollment_review_queue table is ready!");
  } else {
    console.log("Table status:", error.message);
  }
}

run().catch(console.error);
