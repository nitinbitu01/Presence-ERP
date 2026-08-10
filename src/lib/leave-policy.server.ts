import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "@/lib/errors";

export interface LeaveBalanceSummary {
  studentId: string;
  academicYear: string;
  totalAllocatedDays: number;
  consumedDays: number;
  carryForwardDays: number;
  remainingDays: number;
}

export function computeLeaveBalanceCarryForward(
  allocated: number,
  consumed: number,
  maxCarryForward: number = 5,
): { carryForwardDays: number; lapsedDays: number; remainingDays: number } {
  const unused = Math.max(0, allocated - consumed);
  const carryForwardDays = Math.min(unused, maxCarryForward);
  const lapsedDays = unused - carryForwardDays;
  const remainingDays = unused;

  return { carryForwardDays, lapsedDays, remainingDays };
}

export const getStudentLeaveBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        studentId: z.string().uuid().optional(),
        academicYear: z.string().optional().default("2026-2027"),
      })
      .default({ academicYear: "2026-2027" })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<LeaveBalanceSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const targetUserId = data.studentId ?? context.userId;

    const DEFAULT_ALLOCATED = 15;

    const { data: approvedRequests } = await supabaseAdmin
      .from("leave_requests")
      .select("net_leave_days, start_date, end_date")
      .eq("student_id", targetUserId)
      .eq("status", "approved");

    let consumedDays = 0;
    for (const r of approvedRequests ?? []) {
      const netDays = (r as { net_leave_days?: number }).net_leave_days;
      if (typeof netDays === "number" && !isNaN(netDays)) {
        consumedDays += netDays;
      } else {
        consumedDays += 1;
      }
    }

    const { carryForwardDays, remainingDays } = computeLeaveBalanceCarryForward(
      DEFAULT_ALLOCATED,
      consumedDays,
    );

    return {
      studentId: targetUserId,
      academicYear: data.academicYear,
      totalAllocatedDays: DEFAULT_ALLOCATED,
      consumedDays: Math.round(consumedDays * 10) / 10,
      carryForwardDays,
      remainingDays: Math.round(remainingDays * 10) / 10,
    };
  });
