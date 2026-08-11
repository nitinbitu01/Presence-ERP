-- Migration: password_reset_tokens
-- Stores cryptographically secure SHA-256 hashed reset tokens with expiry, single-use enforcement, and RLS lockdown.

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT DEFAULT NULL
);

-- Index for fast token validation & cleanup
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON public.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON public.password_reset_tokens(expires_at);

-- RLS Lockdown: Service role only. No direct client grants to anon or authenticated.
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "No public access to password reset tokens" ON public.password_reset_tokens;

-- Service role bypasses RLS automatically; deny access to public roles explicitly
CREATE POLICY "No public access to password reset tokens"
    ON public.password_reset_tokens
    FOR ALL
    TO anon, authenticated
    USING (false);

COMMENT ON TABLE public.password_reset_tokens IS 'Stores SHA-256 hashed password reset tokens with 30-minute expiration and single-use invalidation.';
