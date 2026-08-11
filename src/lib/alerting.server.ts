/**
 * Structured audit alerting (Phase 2 item 4 of the hardening work order): the
 * existing admin health dashboard (getHealthMetrics in admin.functions.ts) is
 * pull-based -- someone has to be looking at /admin. This adds push-based
 * alerting for the specific events the work order calls out: repeated liveness
 * failures from one account, sudden rate-limit spikes, multi_student_flag events,
 * and admin-role changes.
 *
 * Delivery: a single generic webhook URL (ALERT_WEBHOOK_URL). The payload shape
 * (`{ text: "..." }` at the top level) is understood natively by Slack and
 * Discord incoming webhooks, and any other endpoint can read the structured
 * `kind`/`summary`/`details` fields instead. Swap in PagerDuty/Opsgenie here by
 * changing sendSecurityAlert's fetch call -- same interface either way.
 *
 * Same fire-and-forget philosophy as notifications.server.ts's email dispatch:
 * if ALERT_WEBHOOK_URL isn't configured, alerts fall back to a structured
 * console.warn (still visible to any log aggregator watching stdout) rather than
 * silently disappearing, and a failed webhook delivery is caught and logged, never
 * thrown -- an alerting failure must not block the attendance/admin action that
 * triggered it.
 */

export type SecurityAlertKind =
  "repeated_liveness_failure" | "rate_limit_spike" | "multi_student_flag" | "admin_role_change";

export interface SecurityAlertPayload {
  kind: SecurityAlertKind;
  summary: string;
  details?: Record<string, unknown>;
}

export async function sendSecurityAlert(payload: SecurityAlertPayload): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const line = `[security-alert:${payload.kind}] ${payload.summary}`;

  if (!webhookUrl) {
    console.warn(line, payload.details ?? {});
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: ${payload.summary}`,
        kind: payload.kind,
        summary: payload.summary,
        details: payload.details ?? {},
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error(`Security alert webhook returned ${res.status}: ${line}`);
    }
  } catch (e) {
    console.error("Failed to dispatch security alert webhook:", e, line);
    // Never throw -- alerting failures must not block the underlying action.
  }
}

// ---- Specific triggers ----
// Each of these is intentionally thin: gather just enough context to make the
// alert actionable, then hand off to sendSecurityAlert. Call sites in
// attendance.functions.ts / admin.functions.ts fire these without awaiting, same
// as the existing notification dispatch pattern.

const REPEATED_LIVENESS_FAILURE_THRESHOLD = 3;
const REPEATED_LIVENESS_FAILURE_WINDOW_MS = 15 * 60_000;

export async function maybeAlertRepeatedLivenessFailure(
  studentId: string,
  sessionId: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - REPEATED_LIVENESS_FAILURE_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from("attendance_events")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("event_type", "liveness_fail")
    .gte("created_at", since);

  if ((count ?? 0) >= REPEATED_LIVENESS_FAILURE_THRESHOLD) {
    await sendSecurityAlert({
      kind: "repeated_liveness_failure",
      summary: `${count} liveness failures from one student in the last ${REPEATED_LIVENESS_FAILURE_WINDOW_MS / 60_000} minutes`,
      details: { studentId, sessionId, count },
    });
  }
}

export async function alertRateLimitSpike(details: {
  scope: "ip" | "student";
  key: string;
  sessionId: string;
}): Promise<void> {
  await sendSecurityAlert({
    kind: "rate_limit_spike",
    summary: `${details.scope === "ip" ? "IP" : "Student"} rate limit exceeded for ${details.key}`,
    details,
  });
}

export async function alertMultiStudentFlag(details: {
  deviceFpHash: string;
  distinctStudents: number;
  windowHours: number;
}): Promise<void> {
  await sendSecurityAlert({
    kind: "multi_student_flag",
    summary: `${details.distinctStudents} distinct students checked in from one device in ${details.windowHours}h`,
    details,
  });
}

export async function alertAdminRoleChange(details: {
  grantedTo: string;
  grantedBy: string;
  role: string;
}): Promise<void> {
  await sendSecurityAlert({
    kind: "admin_role_change",
    summary: `${details.role} role granted to ${details.grantedTo} by ${details.grantedBy}`,
    details,
  });
}
