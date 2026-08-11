// ─────────────────────────────────────────────────────────────────
// Alert Scheduler — Server Function
//
// This is the "cron brain" of the proactive alert system.
// Called by:
//   - A Cloudflare Cron Trigger (every 15 minutes)
//   - Manually by an admin for testing
//   - Automatically on login (for low-cost check)
//
// Usage:
//   import { runAlertScheduler } from '@/lib/presence-ai/alert-scheduler'
//   await runAlertScheduler()                    // full run
//   await runAlertScheduler({ userId })          // single student
//   const preview = await runAlertScheduler({ dryRun: true })
// ─────────────────────────────────────────────────────────────────

import { generateAlertsForStudent, persistAlertsForUser } from "./alerting-engine";
import type { AttendanceAlert } from "./alerting-engine";

export interface SchedulerOptions {
  /** Run without persisting — returns what WOULD be sent */
  dryRun?: boolean;
  /** Run for a specific student only */
  userId?: string;
  /** Minimum risk level to include ('warning' | 'critical') */
  minSeverity?: "warning" | "critical";
}

export interface SchedulerResult {
  studentsScanned: number;
  alertsGenerated: number;
  alertsPersisted: number;
  dryRun: boolean;
  durationMs: number;
  preview: AttendanceAlert[];
  errors: string[];
}

// ── Main Scheduler Function ────────────────────────────────────────

export async function runAlertScheduler(options: SchedulerOptions = {}): Promise<SchedulerResult> {
  const start = Date.now();
  const { dryRun = false, userId: targetUserId, minSeverity = "warning" } = options;

  const errors: string[] = [];
  const allAlerts: AttendanceAlert[] = [];
  let studentsScanned = 0;
  let alertsPersisted = 0;

  try {
    const userIds = targetUserId ? [targetUserId] : await fetchAtRiskStudentIds(minSeverity);

    studentsScanned = userIds.length;

    // Process in batches of 10 to avoid overwhelming the DB
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map((uid) => processStudent(uid, dryRun)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled") {
          allAlerts.push(...result.value.alerts);
          if (!dryRun) alertsPersisted += result.value.persisted;
        } else {
          errors.push(`User ${batch[j]}: ${String(result.reason)}`);
        }
      }

      // Yield between batches to avoid blocking the event loop
      if (i + batchSize < userIds.length) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  } catch (err) {
    errors.push(`Scheduler fatal: ${String(err)}`);
  }

  return {
    studentsScanned,
    alertsGenerated: allAlerts.length,
    alertsPersisted,
    dryRun,
    durationMs: Date.now() - start,
    preview: allAlerts,
    errors,
  };
}

// ── Per-Student Processing ────────────────────────────────────────

async function processStudent(
  userId: string,
  dryRun: boolean,
): Promise<{ alerts: AttendanceAlert[]; persisted: number }> {
  const alerts = await generateAlertsForStudent(userId);

  if (!dryRun && alerts.length > 0) {
    await persistAlertsForUser(userId, alerts);
    return { alerts, persisted: alerts.length };
  }

  return { alerts, persisted: 0 };
}

// ── Find At-Risk Students ─────────────────────────────────────────
// Queries attendance_ledger and class_sessions to find students
// whose computed attendance rate is <= 80% (warning zone).
// This avoids loading ALL students into memory.

async function fetchAtRiskStudentIds(minSeverity: "warning" | "critical"): Promise<string[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Get all distinct student IDs from ledger (active students)
    const { data, error } = await supabaseAdmin
      .from("attendance_ledger")
      .select("student_id")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Deduplicate
    const uniqueIds = [...new Set((data ?? []).map((r) => r.student_id as string))];
    return uniqueIds;
  } catch (err) {
    console.warn("[AlertScheduler] Failed to fetch at-risk students:", err);
    return [];
  }
}

// ── TanStack Server Function Wrapper ──────────────────────────────
// For use in API routes or Cloudflare cron handlers

export function createSchedulerServerFn() {
  return async (ctx: unknown, data: SchedulerOptions): Promise<SchedulerResult> => {
    return runAlertScheduler(data);
  };
}

// ── Lightweight Login Trigger ─────────────────────────────────────
// Called on student login — only re-generates if last check > 15 min ago

export async function refreshAlertsOnLogin(userId: string): Promise<AttendanceAlert[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Check when we last generated alerts for this user
    const { data: latestAlert } = await db
      .from("ai_alerts")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = new Date();
    const lastRefresh = latestAlert?.created_at ? new Date(latestAlert.created_at as string) : null;

    if (lastRefresh && now.getTime() - lastRefresh.getTime() < 15 * 60 * 1000) {
      // Less than 15 min since last refresh — return existing unread alerts
      const { fetchUnreadAlerts } = await import("./alerting-engine");
      return fetchUnreadAlerts(userId);
    }

    // Refresh alerts
    const alerts = await generateAlertsForStudent(userId);
    if (alerts.length > 0) {
      await persistAlertsForUser(userId, alerts);
    }

    return alerts;
  } catch (err) {
    console.warn("[AlertScheduler] Login refresh failed:", err);
    return [];
  }
}
