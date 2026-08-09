-- Extended Phase 1: Automated Change Capture Triggers, PII Encryption & MFA Flags

-- 1. Enable pgcrypto extension for field-level encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Add MFA columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret text;

-- 3. Generic Audit Change Capture Trigger Function
CREATE OR REPLACE FUNCTION public.log_table_change()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id uuid;
  v_target_id uuid;
  v_details jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_id := '00000000-0000-0000-0000-000000000000'::uuid;
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

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, details)
  VALUES (
    v_actor_id,
    lower(TG_OP) || '_' || TG_TABLE_NAME,
    TG_TABLE_NAME,
    v_target_id,
    v_details
  );

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach triggers to sensitive tables
DROP TRIGGER IF EXISTS trg_audit_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_audit_leave_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS trg_audit_staff_leave ON public.staff_leave_requests;
CREATE TRIGGER trg_audit_staff_leave
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS trg_audit_fee_payments ON public.fee_payments;
CREATE TRIGGER trg_audit_fee_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();

DROP TRIGGER IF EXISTS trg_audit_role_requests ON public.role_requests;
CREATE TRIGGER trg_audit_role_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.role_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_table_change();
