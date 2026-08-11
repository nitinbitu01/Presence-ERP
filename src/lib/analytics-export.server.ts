import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface AttendanceRecord {
  id: string;
  student_id: string;
  session_id: string;
  status: string;
  date: string;
  created_at: string;
  [key: string]: unknown;
}

export const exportAttendanceCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        studentId: z.string().optional(),
        departmentId: z.string().optional(),
        startDate: z.string(),
        endDate: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabaseAdmin as any)
      .from("attendance_records")
      .select("*")
      .gte("date", data.startDate)
      .lte("date", data.endDate);

    if (data.studentId) query = query.eq("student_id", data.studentId);

    const { data: records } = await query;

    const header = "id,student_id,session_id,status,date,created_at";
    const rows = (records ?? []).map(
      (r: AttendanceRecord) =>
        `${r.id},${r.student_id},${r.session_id},${r.status},${r.date},${r.created_at}`,
    );

    return {
      csvContent: [header, ...rows].join("\n"),
      filename: `attendance_export_${new Date().toISOString()}.csv`,
      rowCount: rows.length,
    };
  });

export const exportAnalyticsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportType: z.enum(["department_summary", "student_detail", "teacher_summary"]),
        format: z.enum(["csv", "json"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    let content = "";
    let contentType = "";

    if (data.format === "csv") {
      content = "col1,col2\nval1,val2";
      contentType = "text/csv";
    } else {
      content = JSON.stringify({ summary: "Mock report data" });
      contentType = "application/json";
    }

    return {
      content,
      contentType,
      filename: `analytics_report_${data.reportType}.${data.format}`,
    };
  });
