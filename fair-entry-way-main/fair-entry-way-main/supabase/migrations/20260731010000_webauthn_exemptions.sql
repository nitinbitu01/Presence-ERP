-- Migration for WebAuthn Device Exemptions
-- Allows administrators to grant exemptions to students whose devices lack hardware authenticators.

CREATE TABLE IF NOT EXISTS public.webauthn_exemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT webauthn_exemptions_student_unique UNIQUE (student_id)
);

GRANT ALL ON public.webauthn_exemptions TO service_role;
GRANT SELECT ON public.webauthn_exemptions TO authenticated;

ALTER TABLE public.webauthn_exemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exemptions_self_or_admin_read" ON public.webauthn_exemptions;
CREATE POLICY "exemptions_self_or_admin_read" ON public.webauthn_exemptions
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id OR public.has_role(auth.uid(), 'admin'));
