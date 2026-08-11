-- Migration: Add assigned_teacher_id column to leave_requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS assigned_teacher_id uuid REFERENCES public.profiles(user_id);

COMMENT ON COLUMN public.leave_requests.assigned_teacher_id IS 'Teacher assigned by student to review and approve/reject this leave or OD request';
