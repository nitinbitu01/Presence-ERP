import { logger } from "./logger.server";

export async function setupSecurityMonitoring(supabaseAdmin: any): Promise<void> {
  const suspiciousPatterns = [
    { type: "RAPID_RESETS", threshold: 10, windowMinutes: 5 },
    { type: "FAILED_VALIDATIONS", threshold: 20, windowMinutes: 15 },
    { type: "MULTIPLE_IPS", threshold: 5, windowMinutes: 10 },
  ];

  if (!supabaseAdmin?.from) return;

  try {
    for (const pattern of suspiciousPatterns) {
      const windowStart = new Date(Date.now() - pattern.windowMinutes * 60000).toISOString();
      const { data: events } = await supabaseAdmin
        .from("security_audit_log")
        .select("*")
        .eq("success", false)
        .gte("created_at", windowStart);

      if (events && events.length > pattern.threshold) {
        await sendSecurityAlert({
          type: pattern.type,
          count: events.length,
          window: pattern.windowMinutes,
          events,
        });
      }
    }
  } catch (e) {
    console.warn("Security monitoring error:", e);
  }
}

async function sendSecurityAlert(alert: {
  type: string;
  count: number;
  window: number;
  events: any[];
}): Promise<void> {
  logger.security(
    "SECURITY_ALERT",
    `[${alert.type}] Detected ${alert.count} suspicious events in ${alert.window}m`,
    { alert },
  );
}
