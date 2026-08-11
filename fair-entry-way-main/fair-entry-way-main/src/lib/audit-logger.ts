import type { AuditLogEntry } from "@/types/security.types";
import { logger } from "./logger.server";

/**
 * Log security events to audit trail
 */
export async function logSecurityEvent(
  supabaseAdmin: any,
  event: Omit<AuditLogEntry, "timestamp">,
): Promise<void> {
  try {
    logger.security("AUDIT_LOG", `[${event.eventType}] ${event.success ? "SUCCESS" : "FAILURE"}`, {
      userId: event.userId,
      email: event.email,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      failureReason: event.failureReason,
      metadata: event.metadata,
    });

    if (supabaseAdmin?.from) {
      await supabaseAdmin.from("security_audit_log").insert({
        event_type: event.eventType,
        user_id: event.userId || null,
        email: event.email || null,
        ip_address: event.ipAddress,
        user_agent: event.userAgent,
        metadata: event.metadata || {},
        success: event.success,
        failure_reason: event.failureReason || null,
        created_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Failed to log security audit event:", error);
  }
}

/**
 * Helper to extract request metadata
 */
export function getRequestMetadata(request: Request | null): {
  ipAddress: string;
  userAgent: string;
} {
  if (!request?.headers) {
    return { ipAddress: "127.0.0.1", userAgent: "Unknown" };
  }

  const ipAddress =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  const userAgent = request.headers.get("user-agent") || "Unknown";

  return { ipAddress, userAgent };
}
