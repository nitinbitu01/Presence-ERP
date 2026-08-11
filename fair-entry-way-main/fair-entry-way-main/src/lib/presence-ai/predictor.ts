// ─────────────────────────────────────────────────────────────────
// Attendance Forecast Engine
//
// Computes a real-time, data-driven forecast of a student's
// attendance trajectory BEFORE the AI ever sees the question.
//
// Data sources:
//   - attendance_ledger (past decisions, already typed in Supabase)
//   - class_sessions   (has course_id, joins to courses for name/code)
//
// No AI needed — pure arithmetic on existing DB data.
// ─────────────────────────────────────────────────────────────────

export type RiskLevel = "safe" | "warning" | "critical" | "failed";

export interface UpcomingSession {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  startsAt: string;
  endsAt: string;
  minutesUntil: number;
}

export interface AttendanceForecast {
  // Current state
  totalSessions: number;
  attendedSessions: number;
  currentRate: number; // 0–1  e.g. 0.743

  // Projection
  remainingSessions: number;
  projectedRateIfAllAttended: number;
  projectedRateIfNoneAttended: number;
  daysUntilBelowThreshold: number | null;
  sessionsNeededToRecover: number;

  // Risk
  riskLevel: RiskLevel;
  thresholdRate: number;

  // Upcoming (next 24h)
  upcomingSessions: UpcomingSession[];
  nextSessionMinutes: number | null;

  // Pre-built messages
  headline: string;
  detail: string;
}

const THRESHOLD = 0.75;

interface RawLedgerRow {
  session_id: string;
  decision: string;
  created_at: string;
}

interface RawSessionRow {
  id: string;
  starts_at: string;
  ends_at: string;
  course_id: string;
  courses?: { name: string; code: string } | null;
}

// ── Main export ───────────────────────────────────────────────────

export async function computeForecast(
  userId: string,
  semesterEndDate?: Date,
): Promise<AttendanceForecast> {
  try {
    return await fetchAndCompute(userId, semesterEndDate);
  } catch (err) {
    console.warn("[Predictor] Failed to compute forecast:", err);
    return buildFallbackForecast();
  }
}

async function fetchAndCompute(
  userId: string,
  semesterEndDate?: Date,
): Promise<AttendanceForecast> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const endDate = semesterEndDate ?? getSemesterEndEstimate(now);

  // 1. All past attendance decisions for this student
  const { data: ledger, error: ledgerError } = await supabaseAdmin
    .from("attendance_ledger")
    .select("decision, created_at, session_id")
    .eq("student_id", userId)
    .order("created_at", { ascending: true });

  if (ledgerError) throw ledgerError;

  // 2. All class sessions in this semester, joined to courses for names
  const { data: sessions, error: sessionsError } = await (supabaseAdmin as any)
    .from("class_sessions")
    .select("id, starts_at, ends_at, course_id, courses(name, code)")
    .gte("starts_at", getSemesterStartEstimate(now).toISOString())
    .lte("starts_at", endDate.toISOString())
    .order("starts_at", { ascending: true });

  if (sessionsError) throw sessionsError;

  const rows = (ledger ?? []) as RawLedgerRow[];
  const sessionRows = (sessions ?? []) as RawSessionRow[];

  return compute(userId, rows, sessionRows, now, endDate);
}

export function compute(
  _userId: string,
  ledger: RawLedgerRow[],
  sessions: RawSessionRow[],
  now: Date,
  _semesterEnd: Date,
): AttendanceForecast {
  // Deduplicate — keep latest decision per session
  const decisionMap = new Map<string, string>();
  for (const row of ledger) {
    decisionMap.set(row.session_id, row.decision);
  }

  const pastSessions = sessions.filter((s) => new Date(s.starts_at) <= now);
  const futureSessions = sessions.filter((s) => new Date(s.starts_at) > now);

  let attended = 0;
  for (const session of pastSessions) {
    const decision = decisionMap.get(session.id);
    if (decision === "APPROVED" || decision === "APPROVED_MANUAL" || decision === "present") {
      attended++;
    }
  }

  const total = pastSessions.length;
  const currentRate = total > 0 ? attended / total : 1;
  const remaining = futureSessions.length;

  const bestCaseRate = total + remaining > 0 ? (attended + remaining) / (total + remaining) : 1;

  const worstCaseRate = total + remaining > 0 ? attended / (total + remaining) : 0;

  const needed = Math.max(0, Math.ceil(THRESHOLD * (total + remaining) - attended));
  const sessionsNeededToRecover = Math.min(needed, remaining);

  let daysUntilBelowThreshold: number | null = null;
  if (currentRate >= THRESHOLD && remaining > 0) {
    let sim_attended = attended;
    let sim_total = total;
    for (const session of futureSessions) {
      sim_total++;
      const rate = sim_attended / sim_total;
      if (rate < THRESHOLD) {
        const daysAway = Math.ceil(
          (new Date(session.starts_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        daysUntilBelowThreshold = daysAway;
        break;
      }
      sim_attended++;
    }
  } else if (currentRate < THRESHOLD) {
    daysUntilBelowThreshold = 0;
  }

  let riskLevel: RiskLevel;
  if (currentRate < THRESHOLD - 0.05) riskLevel = "critical";
  else if (currentRate < THRESHOLD) riskLevel = "failed";
  else if (currentRate < THRESHOLD + 0.05) riskLevel = "warning";
  else riskLevel = "safe";

  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const upcomingSessions: UpcomingSession[] = futureSessions
    .filter((s) => new Date(s.starts_at) <= in24h)
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      courseId: s.course_id,
      courseName: s.courses?.name ?? "Class",
      courseCode: s.courses?.code ?? "N/A",
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      minutesUntil: Math.ceil((new Date(s.starts_at).getTime() - now.getTime()) / 60_000),
    }));

  const nextSessionMinutes = upcomingSessions[0]?.minutesUntil ?? null;

  const { headline, detail } = buildMessages(
    riskLevel,
    currentRate,
    sessionsNeededToRecover,
    remaining,
    daysUntilBelowThreshold,
    upcomingSessions,
  );

  return {
    totalSessions: total,
    attendedSessions: attended,
    currentRate,
    remainingSessions: remaining,
    projectedRateIfAllAttended: bestCaseRate,
    projectedRateIfNoneAttended: worstCaseRate,
    daysUntilBelowThreshold,
    sessionsNeededToRecover,
    riskLevel,
    thresholdRate: THRESHOLD,
    upcomingSessions,
    nextSessionMinutes,
    headline,
    detail,
  };
}

function buildMessages(
  risk: RiskLevel,
  currentRate: number,
  needed: number,
  remaining: number,
  daysUntil: number | null,
  upcoming: UpcomingSession[],
): { headline: string; detail: string } {
  const pct = (currentRate * 100).toFixed(1);
  const next = upcoming[0];

  if (risk === "failed") {
    return {
      headline: `⛔ FAILED: ${pct}% attendance (minimum 75%)`,
      detail: `You need to attend ${needed} of the remaining ${remaining} sessions to recover. ${next ? `Your next session is ${next.courseName} in ${next.minutesUntil} min.` : ""}`,
    };
  }

  if (risk === "critical") {
    return {
      headline: `🔴 CRITICAL RISK: ${pct}% attendance`,
      detail: `You need ${needed} of ${remaining} remaining sessions. ${daysUntil === 0 ? "You are already below threshold." : `You have ${daysUntil ?? "?"} days before you fail.`} ${next ? `Next: ${next.courseName} in ${next.minutesUntil} min — do not miss it.` : ""}`,
    };
  }

  if (risk === "warning") {
    return {
      headline: `⚠️ WARNING: ${pct}% attendance (close to 75% limit)`,
      detail: `You can afford to miss ${Math.max(0, remaining - needed)} more sessions. ${daysUntil !== null ? `You will breach threshold in ~${daysUntil} days if absent.` : ""} ${next ? `Next: ${next.courseName} starts in ${next.minutesUntil} min.` : ""}`,
    };
  }

  return {
    headline: `✅ SAFE: ${pct}% attendance`,
    detail: `You are ${((currentRate - 0.75) * 100).toFixed(1)}% above the minimum. ${remaining > 0 ? `${remaining} sessions remain this semester.` : "Semester complete."} ${next ? `Next class: ${next.courseName} in ${next.minutesUntil} min.` : ""}`,
  };
}

// ── Format for Prompt Injection ───────────────────────────────────

export function formatForecastForPrompt(forecast: AttendanceForecast): string {
  const lines: string[] = [
    "━━━ ATTENDANCE FORECAST (LIVE DATA) ━━━━━━━━━━━━━━",
    forecast.headline,
    forecast.detail,
    "",
    `Current: ${(forecast.currentRate * 100).toFixed(1)}% | Required: 75%`,
    `Sessions attended: ${forecast.attendedSessions}/${forecast.totalSessions}`,
    `Sessions remaining this semester: ${forecast.remainingSessions}`,
  ];

  if (forecast.sessionsNeededToRecover > 0) {
    lines.push(
      `To recover: must attend ${forecast.sessionsNeededToRecover} of next ${forecast.remainingSessions} sessions`,
    );
  }

  if (forecast.upcomingSessions.length > 0) {
    lines.push("", "Upcoming sessions (next 24h):");
    for (const s of forecast.upcomingSessions) {
      lines.push(`  • ${s.courseName} (${s.courseCode}) — in ${s.minutesUntil} min`);
    }
  }

  lines.push(
    "",
    "INSTRUCTION: Use this data to answer any future-tense attendance questions.",
    'Do NOT invent numbers. If the student asks "will I fail?" use the forecast above.',
  );

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────

function getSemesterStartEstimate(now: Date): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 6) return new Date(year, 6, 1);
  return new Date(year, 0, 1);
}

function getSemesterEndEstimate(now: Date): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 6) return new Date(year, 11, 31);
  return new Date(year, 5, 30);
}

function buildFallbackForecast(): AttendanceForecast {
  return {
    totalSessions: 0,
    attendedSessions: 0,
    currentRate: 1,
    remainingSessions: 0,
    projectedRateIfAllAttended: 1,
    projectedRateIfNoneAttended: 1,
    daysUntilBelowThreshold: null,
    sessionsNeededToRecover: 0,
    riskLevel: "safe",
    thresholdRate: THRESHOLD,
    upcomingSessions: [],
    nextSessionMinutes: null,
    headline: "✅ Attendance data unavailable — check back shortly",
    detail: "We could not retrieve your attendance data. Please try again.",
  };
}
