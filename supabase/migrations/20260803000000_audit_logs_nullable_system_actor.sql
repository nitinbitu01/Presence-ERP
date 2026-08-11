-- Fixes a bug that made every biometric-retention-purge audit-log write silently fail:
-- audit_logs.actor_id is `uuid NOT NULL REFERENCES auth.users(id)`, but the retention job
-- (src/lib/biometric-retention-policy.server.ts) previously inserted the literal string
-- "system_retention_policy" -- not a UUID, and not a real user -- and audit_logs.target_id is
-- `uuid NOT NULL` while the job inserted a custom string like "purge_1700000000_ab12". Both
-- inserts would fail Postgres's UUID type check every single time, and the failure was
-- swallowed by the job's try/catch, so the "audit trail" for this job has never actually
-- existed. This migration allows a NULL actor_id specifically for system/automated actions
-- (NULL is exempt from FK checks, so this doesn't require inventing a fake user row) and keeps
-- target_id as a real UUID as before -- the application code now generates one properly rather
-- than a custom string.

ALTER TABLE public.audit_logs
  ALTER COLUMN actor_id DROP NOT NULL;

COMMENT ON COLUMN public.audit_logs.actor_id IS
  'NULL indicates a system/automated action (e.g. the biometric retention job) with no human actor. Non-null values must reference a real auth.users row.';
