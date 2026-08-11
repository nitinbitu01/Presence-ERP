/**
 * Phase 3 Gap Closure: Substitute Faculty Delegation Service
 * Allows primary course instructors to delegate session authority to substitute teachers
 * during approved leave or absence.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "./errors";

/**
 * createTeacherDelegation — Primary teacher delegates course session authority to a substitute teacher.
 */
export const createTeacherDelegation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        substituteTeacherId: z.string().uuid(),
        courseId: z.string().uuid(),
        validFrom: z.string(),
        validUntil: z.string(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify current user is primary teacher of course or admin
    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("teacher_id")
      .eq("id", data.courseId)
      .single();

    if (!course) throw new PresenceErpError("NOT_FOUND", "Course not found");

    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (course.teacher_id !== context.userId && !adminRole) {
      throw new PresenceErpError(
        "FORBIDDEN",
        "Must be course teacher or admin to delegate authority.",
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (supabaseAdmin as any)
      .from("teacher_delegations")
      .insert({
        primary_teacher_id: course.teacher_id,
        substitute_teacher_id: data.substituteTeacherId,
        course_id: data.courseId,
        valid_from: data.validFrom,
        valid_until: data.validUntil,
        reason: data.reason,
      })
      .select("id")
      .single();

    if (error) throw new PresenceErpError("DATABASE_ERROR", error.message);

    return { delegationId: row?.id, status: "ACTIVE" };
  });

/**
 * verifyTeacherSessionAuthority — checks if a user is either primary teacher, active substitute, or admin.
 */
export async function verifyTeacherSessionAuthority(
  userId: string,
  courseId: string,
): Promise<{ authorized: boolean; role: "primary" | "substitute" | "admin" }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Check admin
  const { data: adminRole } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (adminRole) return { authorized: true, role: "admin" };

  // Check primary teacher
  const { data: course } = await supabaseAdmin
    .from("courses")
    .select("teacher_id")
    .eq("id", courseId)
    .single();

  if (course && course.teacher_id === userId) {
    return { authorized: true, role: "primary" };
  }

  // Check active delegation
  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: delegation } = await (supabaseAdmin as any)
    .from("teacher_delegations")
    .select("id")
    .eq("substitute_teacher_id", userId)
    .eq("course_id", courseId)
    .lte("valid_from", now)
    .gte("valid_until", now)
    .maybeSingle();

  if (delegation) {
    return { authorized: true, role: "substitute" };
  }

  return { authorized: false, role: "primary" };
}
