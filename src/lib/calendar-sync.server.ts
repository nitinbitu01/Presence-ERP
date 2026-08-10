import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export function generateIcsContent(
  events: { id: string; title: string; startDate: string; endDate: string; description: string }[],
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Presence ERP//Leave Calendar Sync//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const e of events) {
    const sDate = e.startDate.replace(/-/g, "");
    const eDate = e.endDate.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@presence-erp.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTSTART;VALUE=DATE:${sDate}`,
      `DTEND;VALUE=DATE:${eDate}`,
      `SUMMARY:${e.title}`,
      `DESCRIPTION:${e.description}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export const exportLeaveIcsFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: leaves } = await supabase
      .from("leave_requests")
      .select("id, start_date, end_date, request_type, leave_type, reason")
      .eq("student_id", userId)
      .eq("status", "approved");

    const events = (leaves ?? []).map(
      (l: {
        id: string;
        start_date: string;
        end_date: string;
        request_type: string;
        leave_type: string;
        reason: string;
      }) => ({
        id: l.id,
        title: `[Presence ERP] Approved ${l.request_type.toUpperCase()} (${l.leave_type})`,
        startDate: l.start_date.split("T")[0],
        endDate: l.end_date.split("T")[0],
        description: `Reason: ${l.reason}`,
      }),
    );

    const icsContent = generateIcsContent(events);
    return { icsContent };
  });
