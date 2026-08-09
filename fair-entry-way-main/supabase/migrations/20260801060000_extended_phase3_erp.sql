-- Extended Phase 3: Multi-tier Approvals, Delegations, Document Verification & Notification Preferences

-- 1. Document verification columns on leave_requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS document_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Multi-tier Approval Rules Table
CREATE TABLE IF NOT EXISTS public.leave_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_type text NOT NULL,
  min_days integer NOT NULL DEFAULT 1,
  max_days integer,
  approval_chain text[] NOT NULL DEFAULT ARRAY['advisor'],
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.leave_approval_rules TO authenticated;
GRANT ALL ON public.leave_approval_rules TO service_role;

ALTER TABLE public.leave_approval_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_select_approval_rules" ON public.leave_approval_rules;
CREATE POLICY "authenticated_select_approval_rules" ON public.leave_approval_rules
  FOR SELECT TO authenticated USING (true);

-- 3. Approver Delegations Table
CREATE TABLE IF NOT EXISTS public.approver_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delegate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

GRANT SELECT, INSERT, UPDATE ON public.approver_delegations TO authenticated;
GRANT ALL ON public.approver_delegations TO service_role;

ALTER TABLE public.approver_delegations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_manage_own_delegations" ON public.approver_delegations;
CREATE POLICY "user_manage_own_delegations" ON public.approver_delegations
  FOR ALL TO authenticated USING (auth.uid() = approver_id OR auth.uid() = delegate_id);

-- 4. User Notification Preferences Table
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT false,
  in_app_enabled boolean NOT NULL DEFAULT true,
  phone_number text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_notification_preferences TO authenticated;
GRANT ALL ON public.user_notification_preferences TO service_role;

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_manage_own_notif_prefs" ON public.user_notification_preferences;
CREATE POLICY "user_manage_own_notif_prefs" ON public.user_notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id);
