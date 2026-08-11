-- ═══════════════════════════════════════════════════════════════════
-- World-Class Presence AI — Supabase Migration
-- Run this in your Supabase SQL editor to activate the new tables.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Student Memory Table
CREATE TABLE IF NOT EXISTS public.ai_memory (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_json JSONB       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "students_own_memory" ON public.ai_memory
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- Service role bypasses RLS automatically.

-- 2. Attendance Alerts Table
CREATE TABLE IF NOT EXISTS public.ai_alerts (
  id           TEXT        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
  severity     TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  action_label TEXT,
  action_route TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_alerts_user_unread
  ON public.ai_alerts (user_id, read_at, expires_at);
ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "students_own_alerts" ON public.ai_alerts
  USING (auth.uid() = user_id);
-- Admins use service role to write alerts.

-- 3. AI Feedback Table
CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question    TEXT        NOT NULL,
  answer      TEXT        NOT NULL,
  was_helpful BOOLEAN     NOT NULL,
  correction  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_feedback_unhelpful
  ON public.ai_feedback (was_helpful, created_at DESC)
  WHERE NOT was_helpful;
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "students_own_feedback" ON public.ai_feedback
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Done. All three tables use RLS so students only see their own data.
-- The AI engine uses supabaseAdmin (service role) to write across users.
