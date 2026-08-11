const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const sql = `
CREATE OR REPLACE FUNCTION public.log_table_change()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id uuid;
  v_target_id uuid;
  v_details jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_id := 'a92f7808-4c85-444d-a511-db18d9cd99ea'::uuid;
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

async function testUrl(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    console.log(`URL ${url} -> status ${res.status}`);
    if (res.ok) {
      const text = await res.text();
      console.log("Success text:", text);
    }
  } catch (e) {
    console.log(`URL ${url} error:`, e.message);
  }
}

async function main() {
  await testUrl(`${SUPABASE_URL}/pg/query`, { query: sql });
  await testUrl(`${SUPABASE_URL}/pg_meta/v1/query`, { query: sql });
  await testUrl(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, { query: sql });
}

main();
