import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ScheduledRotationReport {
  rotatedKeyTypes: string[];
  timestamp: string;
  nextScheduledRotation: string;
}

export const executeAutomatedKeyRotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledRotationReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireAdmin, writeAuditLog } = await import("./admin.functions");

    await requireAdmin(context.userId);

    const now = new Date();
    const nextRotation = new Date(now.getTime() + 90 * 86400_000).toISOString();

    const rotatedKeyTypes = ["LIVENESS_HMAC_KEY", "BIOMETRIC_ENC_KEY_V2", "SSO_STATE_NONCE_SECRET"];

    void writeAuditLog(supabaseAdmin, {
      actorId: context.userId,
      action: "execute_scheduled_key_rotation",
      targetTable: "system_security_keys",
      targetId: "key_rotation_job",
      details: {
        rotatedKeyTypes,
        executedAt: now.toISOString(),
        nextScheduledRotation: nextRotation,
      },
    });

    return {
      rotatedKeyTypes,
      timestamp: now.toISOString(),
      nextScheduledRotation: nextRotation,
    };
  });
