import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SubsystemHealth {
  name: string;
  status: "operational" | "degraded" | "outage";
  latencyMs: number;
  lastChecked: string;
}

export interface SystemStatusOverview {
  overall: "operational" | "degraded" | "outage";
  updatedAt: string;
  subsystems: SubsystemHealth[];
  activeIncidentsCount: number;
}

export async function fetchSystemStatus(): Promise<SystemStatusOverview> {
  const now = new Date().toISOString();
  const subsystems: SubsystemHealth[] = [
    { name: "Database & Ledger", status: "operational", latencyMs: 14, lastChecked: now },
    { name: "Auth & SSO Engine", status: "operational", latencyMs: 22, lastChecked: now },
    { name: "Biometric Liveness SDK", status: "operational", latencyMs: 38, lastChecked: now },
    { name: "WebAuthn Hardware Gate", status: "operational", latencyMs: 18, lastChecked: now },
    { name: "Encrypted Storage (AES-256)", status: "operational", latencyMs: 29, lastChecked: now },
  ];

  return {
    overall: "operational",
    updatedAt: now,
    subsystems,
    activeIncidentsCount: 0,
  };
}

export const getSystemStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SystemStatusOverview> => {
    return fetchSystemStatus();
  },
);

export const triggerIncidentRunbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        subsystem: z.string(),
        severity: z.enum(["low", "medium", "high", "critical"]),
        description: z.string().min(5),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireAdmin, writeAuditLog } = await import("./admin.functions");

    await requireAdmin(context.userId);

    void writeAuditLog(supabaseAdmin, {
      actorId: context.userId,
      action: "trigger_incident_runbook",
      targetTable: "system_incidents",
      targetId: `inc_${Date.now()}`,
      details: {
        subsystem: data.subsystem,
        severity: data.severity,
        description: data.description,
        triggeredAt: new Date().toISOString(),
      },
    });

    return {
      success: true,
      incidentId: `inc_${Date.now()}`,
      subsystem: data.subsystem,
      status: "mitigating",
    };
  });
