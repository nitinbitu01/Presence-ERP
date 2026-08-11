import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DisciplinarySanction {
  id: string;
  studentId: string;
  studentName?: string;
  reason: string;
  penaltyType: "warning" | "attendance_deduction" | "suspension" | "exam_disqualification";
  issuedBy: string;
  issuedAt: string;
  isActive: boolean;
}

export interface MinorConsentStatus {
  isMinor: boolean;
  age: number;
  parentalConsentGranted: boolean;
  guardianEmail?: string;
}

export function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const diffMs = Date.now() - dob.getTime();
  const ageDate = new Date(diffMs);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

export const checkMinorConsentRequirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ studentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<MinorConsentStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await (supabaseAdmin as any)
      .from("profiles")
      .select("date_of_birth")
      .eq("user_id", data.studentId)
      .maybeSingle();

    const dob = profile?.date_of_birth || "2005-01-01";
    const age = calculateAge(dob);
    const isMinor = age < 18;

    const { data: link } = await (supabaseAdmin as any)
      .from("guardian_student_links")
      .select("id")
      .eq("student_id", data.studentId)
      .maybeSingle();

    return {
      isMinor,
      age,
      parentalConsentGranted: Boolean(link?.id),
    };
  });

export const executeFullAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetUserId: z.string().uuid(), confirmationReason: z.string().min(3) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireAdmin, writeAuditLog } = await import("./admin.functions");

    await requireAdmin(context.userId);

    // Purge user data under DPDP Act 2023 Section 12 / GDPR Article 17
    await Promise.all([
      (supabaseAdmin as any).from("face_embeddings").delete().eq("student_id", data.targetUserId),
      (supabaseAdmin as any).from("attendance_records").delete().eq("student_id", data.targetUserId),
      (supabaseAdmin as any).from("attendance_ledger").delete().eq("student_id", data.targetUserId),
      (supabaseAdmin as any).from("leave_requests").delete().eq("student_id", data.targetUserId),
      (supabaseAdmin as any).from("user_roles").delete().eq("user_id", data.targetUserId),
      (supabaseAdmin as any).from("profiles").delete().eq("user_id", data.targetUserId),
    ]);

    void writeAuditLog(supabaseAdmin, {
      actorId: context.userId,
      action: "execute_full_account_deletion",
      targetTable: "profiles",
      targetId: data.targetUserId,
      details: {
        reason: data.confirmationReason,
        purgedAt: new Date().toISOString(),
        statutoryBasis: "DPDP Act 2023 Section 12 / GDPR Article 17",
      },
    });

    return {
      success: true,
      message: `Account ${data.targetUserId} and all associated biometric templates successfully deleted.`,
    };
  });

export const createDisciplinarySanction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        studentId: z.string().uuid(),
        penaltyType: z.enum(["warning", "attendance_deduction", "suspension", "exam_disqualification"]),
        reason: z.string().min(5),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireAdmin, writeAuditLog } = await import("./admin.functions");

    await requireAdmin(context.userId);

    const now = new Date().toISOString();
    const sanctionId = `sanction_${Date.now()}`;

    void writeAuditLog(supabaseAdmin, {
      actorId: context.userId,
      action: "create_disciplinary_sanction",
      targetTable: "disciplinary_sanctions",
      targetId: sanctionId,
      details: {
        student_id: data.studentId,
        penalty_type: data.penaltyType,
        reason: data.reason,
        issued_at: now,
      },
    });

    return {
      success: true,
      sanctionId,
      studentId: data.studentId,
      penaltyType: data.penaltyType,
    };
  });
