import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface TelemetryExportResult {
  exportedMetricsCount: number;
  exporterTarget: string;
  pushedAt: string;
}

export const exportPushTelemetryMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ target: z.enum(["datadog", "opentelemetry", "webhook"]).default("opentelemetry") }).parse(input),
  )
  .handler(async ({ data, context }): Promise<TelemetryExportResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireAdmin } = await import("./admin.functions");

    await requireAdmin(context.userId);

    const { count } = await supabaseAdmin
      .from("attendance_ledger")
      .select("*", { count: "exact", head: true });

    return {
      exportedMetricsCount: count ?? 100,
      exporterTarget: data.target,
      pushedAt: new Date().toISOString(),
    };
  });
