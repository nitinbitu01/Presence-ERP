-- Extended Phase 2 (Round 3): Feature Flags Table & Initial Core Flags

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_flags TO authenticated, anon;
GRANT ALL ON public.feature_flags TO service_role;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_read_feature_flags" ON public.feature_flags;
CREATE POLICY "anyone_read_feature_flags" ON public.feature_flags
  FOR SELECT USING (true);

-- Seed initial feature flags
INSERT INTO public.feature_flags (key, is_enabled, description) VALUES
  ('self_approval_lockdown', true, 'Forces status=pending on all leave and role requests'),
  ('biometric_liveness', true, 'Requires liveness check on attendance check-in'),
  ('sso_login_enabled', true, 'Allows Google and Microsoft OIDC SSO login'),
  ('email_one_click_approval', true, 'Embeds 1-click approve/reject action links in emails')
ON CONFLICT (key) DO NOTHING;
