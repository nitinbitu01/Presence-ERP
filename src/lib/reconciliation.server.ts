import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ReconciliationResult {
  studentId: string;
  sessionDate: string;
  type: "present_during_leave" | "absent_without_leave";
  details: string;
}

export const runAttendanceReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ dateString: z.string().min(10).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const targetDate = data.dateString || new Date().toISOString().split("T")[0];

    // 1. Fetch approved leave/OD requests spanning targetDate
    const { data: approvedLeaves } = await supabaseAdmin
      .from("leave_requests")
      .select("id, student_id, start_date, end_date, request_type")
      .eq("status", "approved")
      .lte("start_date", targetDate)
      .gte("end_date", targetDate);

    const onLeaveStudents = new Map<string, string>();
    for (const l of approvedLeaves ?? []) {
      onLeaveStudents.set(l.student_id, l.request_type);
    }

    // 2. Fetch biometric check-in events on targetDate
    const startIso = `${targetDate}T00:00:00.000Z`;
    const endIso = `${targetDate}T23:59:59.999Z`;

    const { data: checkins } = await supabaseAdmin
      .from("attendance_events")
      .select("id, student_id, created_at, similarity")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const checkinStudentIds = new Set((checkins ?? []).map((c) => c.student_id));
    const anomalies: ReconciliationResult[] = [];

    // Type A: Gate scan recorded while on approved leave
    for (const studentId of checkinStudentIds) {
      if (onLeaveStudents.has(studentId)) {
        const type = onLeaveStudents.get(studentId);
        anomalies.push({
          studentId,
          sessionDate: targetDate,
          type: "present_during_leave",
          details: `Biometric gate scan recorded while student is on approved ${type?.toUpperCase()}`,
        });
      }
    }

    // Write audit log if anomalies found
    if (anomalies.length > 0) {
      const { logger } = await import("./logger.server");
      logger.security(
        "reconciliation",
        `Discovered ${anomalies.length} attendance/leave reconciliation mismatches for ${targetDate}`,
        {
          anomaliesCount: anomalies.length,
          anomalies,
        },
      );
    }

    return { targetDate, anomaliesCount: anomalies.length, anomalies };
  });
