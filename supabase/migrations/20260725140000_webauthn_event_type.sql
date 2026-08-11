-- Phase 1: extend attendance_events.event_type to allow logging failures of the
-- new WebAuthn device-attestation gate (see webauthn.server.ts and the
-- submitAttendance gate it's wired into).

ALTER TABLE public.attendance_events DROP CONSTRAINT IF EXISTS attendance_events_event_type_check;
ALTER TABLE public.attendance_events ADD CONSTRAINT attendance_events_event_type_check
  CHECK (event_type IN (
    'submit_attempt','liveness_fail','geofence_fail','time_window_fail','identity_fail',
    'device_lock_fail','accepted','review','withdraw','rate_limited',
    'verification_unavailable','otp_fail','fallback_requested','multi_student_flag',
    'device_attestation_fail'
  ));
