// ─────────────────────────────────────────────────────────────────
// Proactive Alert Engine
//
// Generates in-app attendance alerts for at-risk students.
// Storage: ai_alerts table (cast to any — not in generated types yet)
//
// Trigger conditions:
//   1. Session starting soon (< 60 min) for an at-risk student
//   2. Critical rate (< 75%)
//   3. Warning rate (75%–80%)
// ─────────────────────────────────────────────────────────────────

export type AlertType =
  | 'session_starting_soon'
  | 'daily_warning_digest'
  | 'critical_threshold';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AttendanceAlert {
  id: string;
  userId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  actionLabel?: string;
  actionRoute?: string;
  createdAt: string;
  readAt?: string;
  expiresAt: string;
}

import type { AttendanceForecast } from './predictor';
import { computeForecast } from './predictor';

// ── Generate Alerts for a Single Student ─────────────────────────

export async function generateAlertsForStudent(
  userId: string,
): Promise<AttendanceAlert[]> {
  const forecast = await computeForecast(userId);
  const alerts: AttendanceAlert[] = [];
  const now = new Date();

  // Alert 1: session starting soon
  const imminent = forecast.upcomingSessions.filter(s => s.minutesUntil <= 60 && s.minutesUntil >= 0);
  for (const session of imminent) {
    alerts.push(buildSessionImminentAlert(userId, session, forecast, now));
  }

  // Alert 2: risk-based daily alert
  if (forecast.riskLevel === 'critical' || forecast.riskLevel === 'failed') {
    alerts.push(buildCriticalAlert(userId, forecast, now));
  } else if (forecast.riskLevel === 'warning') {
    alerts.push(buildWarningAlert(userId, forecast, now));
  }

  return alerts;
}

function buildSessionImminentAlert(
  userId: string,
  session: AttendanceForecast['upcomingSessions'][number],
  forecast: AttendanceForecast,
  now: Date,
): AttendanceAlert {
  const isCritical = forecast.riskLevel === 'critical' || forecast.riskLevel === 'failed';
  const urgencyNote = isCritical
    ? ` ⚠️ Missing this will drop you to ${((forecast.projectedRateIfNoneAttended) * 100).toFixed(1)}%.`
    : '';

  return {
    id: `session-${session.id}-${userId}`,
    userId,
    type: 'session_starting_soon',
    severity: isCritical ? 'critical' : 'info',
    title: `📍 ${session.courseName} starts in ${session.minutesUntil} min`,
    message: `${session.courseName} (${session.courseCode}).${urgencyNote} Your current attendance: ${(forecast.currentRate * 100).toFixed(1)}%.`,
    actionLabel: 'Mark Attendance',
    actionRoute: '/check-in',
    createdAt: now.toISOString(),
    expiresAt: session.endsAt,
  };
}

function buildCriticalAlert(
  userId: string,
  forecast: AttendanceForecast,
  now: Date,
): AttendanceAlert {
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    id: `critical-${userId}-${now.toDateString()}`,
    userId,
    type: 'critical_threshold',
    severity: 'critical',
    title: `🔴 Attendance at ${(forecast.currentRate * 100).toFixed(1)}% — Action Required`,
    message: `You need to attend ${forecast.sessionsNeededToRecover} of your next ${forecast.remainingSessions} sessions to stay enrolled. Do not miss any upcoming sessions.`,
    actionLabel: 'View My Attendance',
    actionRoute: '/attendance',
    createdAt: now.toISOString(),
    expiresAt: expiry.toISOString(),
  };
}

function buildWarningAlert(
  userId: string,
  forecast: AttendanceForecast,
  now: Date,
): AttendanceAlert {
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const canMiss = forecast.remainingSessions - forecast.sessionsNeededToRecover;
  return {
    id: `warning-${userId}-${now.toDateString()}`,
    userId,
    type: 'daily_warning_digest',
    severity: 'warning',
    title: `⚠️ Attendance Warning: ${(forecast.currentRate * 100).toFixed(1)}%`,
    message: `You are close to the 75% minimum. You can only afford to miss ${Math.max(0, canMiss)} more ${canMiss === 1 ? 'session' : 'sessions'}.`,
    actionLabel: 'Ask Presence AI',
    actionRoute: '/ask',
    createdAt: now.toISOString(),
    expiresAt: expiry.toISOString(),
  };
}

// ── Persist Alerts ────────────────────────────────────────────────
// Uses ai_alerts table (not in generated Supabase types yet — cast to any)

export async function persistAlertsForUser(
  userId: string,
  alerts: AttendanceAlert[],
): Promise<void> {
  if (alerts.length === 0) return;

  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as any;

    for (const alert of alerts) {
      await db
        .from('ai_alerts')
        .upsert(
          {
            id: alert.id,
            user_id: alert.userId,
            type: alert.type,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            action_label: alert.actionLabel,
            action_route: alert.actionRoute,
            created_at: alert.createdAt,
            expires_at: alert.expiresAt,
          },
          { onConflict: 'id' },
        );
    }
  } catch (err) {
    console.warn('[AlertEngine] Failed to persist alerts for', userId, err);
  }
}

// ── Fetch Unread Alerts ───────────────────────────────────────────

export async function fetchUnreadAlerts(userId: string): Promise<AttendanceAlert[]> {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as any;

    const { data, error } = await db
      .from('ai_alerts')
      .select('*')
      .eq('user_id', userId)
      .is('read_at', null)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    return (data ?? []).map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      message: r.message,
      actionLabel: r.action_label,
      actionRoute: r.action_route,
      createdAt: r.created_at,
      readAt: r.read_at,
      expiresAt: r.expires_at,
    }));
  } catch {
    return [];
  }
}

// ── Mark Alert as Read ────────────────────────────────────────────

export async function markAlertRead(alertId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await (supabaseAdmin as any)
      .from('ai_alerts')
      .update({ read_at: new Date().toISOString() })
      .eq('id', alertId);
  } catch (err) {
    console.warn('[AlertEngine] Failed to mark alert read:', err);
  }
}
