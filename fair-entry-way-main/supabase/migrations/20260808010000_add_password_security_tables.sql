-- migrations/20260808010000_add_password_security_tables.sql

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  CONSTRAINT valid_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_token_hash ON public.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_id_active ON public.password_reset_tokens(user_id, used_at) 
  WHERE used_at IS NULL;

-- Password history table (prevents reuse of last 5 passwords)
CREATE TABLE IF NOT EXISTS public.password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON public.password_history(user_id, created_at DESC);

-- Security audit log
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  metadata JSONB,
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON public.security_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON public.security_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ip ON public.security_audit_log(ip_address, created_at DESC);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS public.rate_limit_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  attempt_type TEXT NOT NULL,
  attempts INTEGER DEFAULT 1,
  first_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  blocked_until TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_identifier_type UNIQUE(identifier, attempt_type)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_identifier ON public.rate_limit_attempts(identifier, attempt_type);

-- Function to clean up expired tokens (run via cron)
CREATE OR REPLACE FUNCTION public.cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM public.password_reset_tokens 
  WHERE expires_at < NOW() - INTERVAL '7 days';
  
  DELETE FROM public.rate_limit_attempts 
  WHERE last_attempt_at < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_attempts ENABLE ROW LEVEL SECURITY;

-- Service role only access
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only password_reset_tokens') THEN
    CREATE POLICY "Service role only password_reset_tokens" ON public.password_reset_tokens FOR ALL USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only password_history') THEN
    CREATE POLICY "Service role only password_history" ON public.password_history FOR ALL USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only security_audit_log') THEN
    CREATE POLICY "Service role only security_audit_log" ON public.security_audit_log FOR ALL USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only rate_limit_attempts') THEN
    CREATE POLICY "Service role only rate_limit_attempts" ON public.rate_limit_attempts FOR ALL USING (false);
  END IF;
END $$;
