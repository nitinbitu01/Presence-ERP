-- Demo mode feature flag
INSERT INTO public.feature_flags (key, is_enabled, description)
VALUES ('demo_mode', false, 'Enable demo mode: relaxes geofence, allows simulated liveness for hackathon demo')
ON CONFLICT (key) DO NOTHING;
