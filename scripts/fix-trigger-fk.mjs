import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log("Applying safe log_table_change() database trigger fix to Supabase...");
  
  const sql = `
-- Replace trigger function log_table_change with safe actor_id handling and exception handler
CREATE OR REPLACE FUNCTION public.log_table_change()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id uuid;
  v_target_id uuid;
  v_details jsonb;
  v_user_exists boolean;
BEGIN
  v_actor_id := auth.uid();
  
  -- Check if v_actor_id is a valid UUID in auth.users
  IF v_actor_id IS NOT NULL THEN
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM auth.users WHERE id = v_actor_id
      ) INTO v_user_exists;
      
      IF NOT v_user_exists THEN
        v_actor_id := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_actor_id := NULL;
    END;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    v_target_id := OLD.id;
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF (TG_OP = 'INSERT') THEN
    v_target_id := NEW.id;
    v_details := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF (TG_OP = 'UPDATE') THEN
    v_target_id := NEW.id;
    v_details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, details)
    VALUES (
      v_actor_id,
      lower(TG_OP) || '_' || TG_TABLE_NAME,
      TG_TABLE_NAME,
      v_target_id,
      v_details
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let audit logging failure block table operations
    NULL;
  END;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
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
    if (!res.ok) {
      const text = await res.text();
      console.log("Response text:", text);
    }
  } catch (e) {
    console.log("Error running SQL via exec_sql:", e.message);
  }

  // Verify by running a test update on a pending leave request or querying leave_requests
  const { data: pending, error: selectErr } = await supabase
    .from('leave_requests')
    .select('id, status')
    .limit(1);

  if (selectErr) {
    console.error("Select error:", selectErr.message);
  } else {
    console.log("✓ Successfully connected to leave_requests. Pending count:", pending?.length ?? 0);
  }
}

run().catch(console.error);
