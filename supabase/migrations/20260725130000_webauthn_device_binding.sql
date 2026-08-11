-- Phase 1 (hardening work order): liveness trust gap mitigation.
--
-- The 5-gate pipeline's liveness signals (EAR, yaw, pitch, frame embeddings) are
-- computed client-side and submitted as plain numbers. The HMAC in
-- attendance-crypto.server.ts secures the challenge metadata (action/session/TTL),
-- not the claim that the numbers came from a real camera -- a scripted HTTP client
-- could POST fabricated-but-plausible signal sequences straight to submitAttendance
-- without ever opening a camera.
--
-- This migration adds device/app attestation via WebAuthn platform authenticators
-- (Face ID / Touch ID / Windows Hello / Android biometric unlock) as an additional
-- bound factor, per the work order's second listed option (staying browser-only,
-- add WebAuthn as an additional bound factor at enrollment). A student who has
-- registered a platform authenticator must produce a fresh, hardware-backed
-- signature over the same server-issued challenge used for the liveness gate to
-- check in -- something a raw scripted POST cannot forge even with perfectly
-- fabricated liveness numbers, because it doesn't have the private key, which
-- never leaves the authenticator.
--
-- NOTE (residual risk, see also README.md's security section): this is opt-in per
-- student, not yet mandatory. A student who hasn't registered a device is still
-- only protected by the existing client-reported-signal trust model. Making
-- registration mandatory at enrollment is a rollout/policy decision for the
-- institution, not purely a code change (existing enrolled students would need a
-- migration window) -- tracked, not done here.

CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL, -- base64url-encoded COSE public key
  counter bigint NOT NULL DEFAULT 0, -- signature counter; must be strictly increasing (replay defense)
  device_label text,
  transports text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX webauthn_credentials_user_id_idx ON public.webauthn_credentials(user_id);

-- Same pattern as session_otp_secrets and rate_limit_attempts (this session's
-- other two service-role-only tables): registration and verification both happen
-- server-side via supabaseAdmin, so there's no need to reason about RLS policies
-- for a security-critical counter/key table -- it's simply not reachable from any
-- authenticated/anon client call at all.
GRANT ALL ON public.webauthn_credentials TO service_role;

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated: blocked from client-side queries entirely.
