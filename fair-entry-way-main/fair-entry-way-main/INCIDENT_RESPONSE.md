# Presence ERP — Incident Response & Rollback Runbook

## Emergency Incident Response Workflow

### Scenario 1: Email Notification Outage (Resend API Failure)

1. **Diagnosis**: Check `/admin` health dashboard or inspect structured logs via `logger.error("notifications", ...)`.
2. **Action**: The system automatically falls back to in-app notifications (`notifications` table).
3. **Mitigation**: Rotate Resend API key or toggle feature flag `email_one_click_approval := false`.

### Scenario 2: RLS Trigger Misbehavior / Blocked Writes

1. **Diagnosis**: Student or teacher leave submissions fail with `42501` (permission denied).
2. **Action**: Inspect `audit_logs` table for latest trigger execution trace.
3. **Rollback**: Disable feature flag via SQL or Admin UI:
   ```sql
   UPDATE public.feature_flags SET is_enabled = false WHERE key = 'self_approval_lockdown';
   ```

### Scenario 3: Biometric Liveness False Positive Surge

1. **Diagnosis**: Liveness failure rate exceeds 15% on Admin Health Dashboard.
2. **Action**: Temporarily reduce liveness threshold or toggle `biometric_liveness` feature flag off until camera feed calibration is complete.
