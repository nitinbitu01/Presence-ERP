-- Migration: Core Academic, Multi-Campus, Room Management, and Leave Hardening

-- 1. Campuses Table
CREATE TABLE IF NOT EXISTS public.campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  address text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Physical Classrooms & Resource Management
CREATE TABLE IF NOT EXISTS public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid REFERENCES public.campuses(id) ON DELETE CASCADE,
  building_name text NOT NULL,
  room_number text NOT NULL,
  capacity integer NOT NULL DEFAULT 60,
  has_projector boolean DEFAULT true,
  has_biometric_gate boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(building_name, room_number)
);

-- 3. Academic Calendar & Term Boundaries
CREATE TABLE IF NOT EXISTS public.academic_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year text NOT NULL,
  term_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  exam_periods jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Leave Request Enhancements (Half-Day & Weekend Exclusion)
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS is_half_day boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS half_day_type text CHECK (half_day_type IN ('am', 'pm')),
  ADD COLUMN IF NOT EXISTS excluded_weekends_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_leave_days numeric(4,1) DEFAULT 1.0;

-- 5. Session Enhancements (Room, Campus & Excursion/Event Types)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES public.campuses(id),
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms(id),
  ADD COLUMN IF NOT EXISTS session_category text DEFAULT 'regular' CHECK (session_category IN ('regular', 'excursion', 'event', 'camp', 'industrial_visit'));

-- Enable RLS & Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campuses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_calendars TO authenticated;

ALTER TABLE public.campuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_campuses" ON public.campuses;
CREATE POLICY "authenticated_read_campuses" ON public.campuses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_rooms" ON public.rooms;
CREATE POLICY "authenticated_read_rooms" ON public.rooms FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_academic_calendars" ON public.academic_calendars;
CREATE POLICY "authenticated_read_academic_calendars" ON public.academic_calendars FOR SELECT TO authenticated USING (true);
