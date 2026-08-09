-- Extended Phase 4: Analytics Materialized Views, Refresh Procedures & Report Subscriptions

-- 1. Analytics Refresh Metadata Log
CREATE TABLE IF NOT EXISTS public.analytics_refresh_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.analytics_refresh_log (refreshed_at) VALUES (now());

-- 2. Materialized View: mv_attendance_weekly
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_attendance_weekly AS
SELECT
  l.student_id,
  cs.course_id,
  date_trunc('week', l.created_at) AS week_start,
  COUNT(*) AS total_held,
  COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END) AS total_attended,
  ROUND(
    (COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END)::numeric / GREATEST(COUNT(*), 1)::numeric) * 100,
    1
  ) AS attendance_pct
FROM public.attendance_ledger l
LEFT JOIN public.class_sessions cs ON cs.id = l.session_id
GROUP BY l.student_id, cs.course_id, date_trunc('week', l.created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_att_weekly_pk 
  ON public.mv_attendance_weekly (student_id, course_id, week_start);

-- 3. Materialized View: mv_department_summary
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_department_summary AS
SELECT
  p.department_id,
  COUNT(DISTINCT l.student_id) AS student_count,
  COUNT(l.id) AS total_sessions,
  COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END) AS total_present,
  ROUND(
    (COUNT(CASE WHEN l.decision IN ('present', 'fallback_present') THEN 1 END)::numeric / GREATEST(COUNT(l.id), 1)::numeric) * 100,
    1
  ) AS overall_attendance_pct
FROM public.attendance_ledger l
JOIN public.profiles p ON p.user_id = l.student_id
WHERE p.department_id IS NOT NULL
GROUP BY p.department_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dept_summary_pk 
  ON public.mv_department_summary (department_id);

-- 4. Composite Indexes for Underlying Ledger Queries
CREATE INDEX IF NOT EXISTS idx_ledger_dept_date 
  ON public.attendance_ledger (session_id, created_at);

-- 5. Refresh Procedure
CREATE OR REPLACE FUNCTION public.refresh_analytics_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_attendance_weekly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_department_summary;
  INSERT INTO public.analytics_refresh_log (refreshed_at) VALUES (now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Report Subscriptions Table
CREATE TABLE IF NOT EXISTS public.report_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  frequency text NOT NULL DEFAULT 'weekly',
  email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_subscriptions TO authenticated;
GRANT ALL ON public.report_subscriptions TO service_role;

ALTER TABLE public.report_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_manage_own_subscriptions" ON public.report_subscriptions;
CREATE POLICY "user_manage_own_subscriptions" ON public.report_subscriptions
  FOR ALL TO authenticated USING (auth.uid() = user_id);
