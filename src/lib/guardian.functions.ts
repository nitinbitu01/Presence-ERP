import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

// ============= Admin: Guardian management =============

export const inviteGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        displayName: z.string().trim().min(1).max(200),
        phone: z
          .string()
          .trim()
          .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 format, e.g. +919876543210")
          .optional(),
        studentIds: z.array(z.string().uuid()).min(1).max(20),
        relationship: z.string().trim().max(32).optional().default("guardian"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check if a user with this email already exists in Auth.
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const existing = existingUsers?.users.find(
      (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
    );

    let guardianUserId: string;
    if (existing) {
      guardianUserId = existing.id;
      // Ensure a guardians row exists even if this account predates the flag.
      await supabaseAdmin
        .from("guardians")
        .upsert(
          { user_id: guardianUserId, display_name: data.displayName, phone: data.phone ?? null },
          { onConflict: "user_id" },
        );
    } else {
      const { data: invite, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        data.email,
        { data: { display_name: data.displayName, phone: data.phone, is_guardian: "true" } },
      );
      if (inviteErr || !invite?.user) {
        throw new Error(inviteErr?.message ?? "Failed to invite guardian");
      }
      guardianUserId = invite.user.id;
    }

    const links = data.studentIds.map((studentId) => ({
      guardian_id: guardianUserId,
      student_id: studentId,
      relationship: data.relationship,
      is_primary: true,
    }));
    const { error: linkErr } = await supabaseAdmin
      .from("guardian_students")
      .upsert(links, { onConflict: "guardian_id,student_id" });
    if (linkErr) throw new Error(linkErr.message);

    return { ok: true, guardianUserId, linkedCount: links.length };
  });

export const linkGuardianToStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        guardianId: z.string().uuid(),
        studentId: z.string().uuid(),
        relationship: z.string().trim().max(32).optional().default("guardian"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("guardian_students").upsert(
      {
        guardian_id: data.guardianId,
        student_id: data.studentId,
        relationship: data.relationship,
        is_primary: true,
      },
      { onConflict: "guardian_id,student_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unlinkGuardianFromStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ guardianId: z.string().uuid(), studentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("guardian_students")
      .delete()
      .eq("guardian_id", data.guardianId)
      .eq("student_id", data.studentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAllGuardianLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("guardian_students")
      .select(
        "id, guardian_id, student_id, relationship, is_primary, created_at, guardians(display_name, phone), profiles:student_id(display_name, roll_no)",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ============= Guardian-facing: portal reads =============

export const getMyLinkedStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("guardian_students")
      .select("student_id, relationship, profiles:student_id(display_name, roll_no)")
      .eq("guardian_id", context.userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getGuardianStudentSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ studentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // RLS on guardian_students already restricts reads to own links; this
    // check gives a clean error instead of silently returning empty data.
    const { data: link } = await supabase
      .from("guardian_students")
      .select("id")
      .eq("guardian_id", userId)
      .eq("student_id", data.studentId)
      .maybeSingle();
    if (!link) throw new Error("Not authorized to view this student");

    const [{ data: enrollments }, { data: leaves }, { data: notifications }] = await Promise.all([
      supabase
        .from("enrollments")
        .select("course_id, courses:course_id(id, code, name)")
        .eq("student_id", data.studentId),
      supabase
        .from("leave_requests")
        .select("id, start_date, end_date, request_type, status, reason, created_at")
        .eq("student_id", data.studentId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("notifications")
        .select("id, title, message, type, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    interface CourseRow {
      course_id: string;
      courses?: { id: string; code: string; name: string } | null;
    }
    const courseIds = ((enrollments ?? []) as CourseRow[])
      .map((e) => e.courses)
      .filter((c): c is { id: string; code: string; name: string } => !!c)
      .map((c) => c.id);

    const now = Date.now();
    const [{ data: sessions }, { data: approvedLeaves }] = await Promise.all([
      courseIds.length
        ? supabase
            .from("class_sessions")
            .select("id, course_id, starts_at, ends_at")
            .in("course_id", courseIds)
        : Promise.resolve({
            data: [] as { id: string; course_id: string; starts_at: string; ends_at: string }[],
          }),
      supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("student_id", data.studentId)
        .eq("status", "approved"),
    ]);

    const leaveDates = new Set<string>();
    for (const l of approvedLeaves ?? []) {
      const cur = new Date(l.start_date);
      const last = new Date(l.end_date);
      while (cur <= last) {
        leaveDates.add(cur.toISOString().split("T")[0]);
        cur.setDate(cur.getDate() + 1);
      }
    }

    const heldSessions = (sessions ?? []).filter((s) => {
      const ended = new Date(s.ends_at).getTime() < now;
      return ended && !leaveDates.has(s.starts_at.split("T")[0]);
    });
    const sessionIds = heldSessions.map((s) => s.id);

    const { data: ledger } = sessionIds.length
      ? await supabase
          .from("attendance_ledger")
          .select("session_id, decision")
          .eq("student_id", data.studentId)
          .in("session_id", sessionIds)
      : { data: [] as { session_id: string; decision: string }[] };

    const presentSessionIds = new Set(
      (ledger ?? [])
        .filter((r) => r.decision === "present" || r.decision === "fallback_present")
        .map((r) => r.session_id),
    );

    const totalHeld = heldSessions.length;
    const attended = heldSessions.filter((s) => presentSessionIds.has(s.id)).length;
    const attendancePercentage =
      totalHeld === 0 ? null : Math.round((attended / totalHeld) * 1000) / 10;

    return {
      attendance: { attended, totalHeld, percentage: attendancePercentage },
      leaveRequests: leaves ?? [],
      recentNotifications: notifications ?? [],
    };
  });

// ============= Admin: Low-attendance alert broadcast =============

export const sendLowAttendanceAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ thresholdPercent: z.number().min(0).max(100).optional().default(75) })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: enrollments }, { data: approvedLeaves }] = await Promise.all([
      supabaseAdmin.from("enrollments").select("student_id, course_id"),
      supabaseAdmin
        .from("leave_requests")
        .select("student_id, start_date, end_date")
        .eq("status", "approved"),
    ]);

    const courseIds = Array.from(new Set((enrollments ?? []).map((e) => e.course_id)));
    const { data: sessions } = courseIds.length
      ? await supabaseAdmin
          .from("class_sessions")
          .select("id, course_id, starts_at, ends_at")
          .in("course_id", courseIds)
      : { data: [] as { id: string; course_id: string; starts_at: string; ends_at: string }[] };

    const now = Date.now();
    const heldSessions = (sessions ?? []).filter((s) => new Date(s.ends_at).getTime() < now);
    const sessionIds = heldSessions.map((s) => s.id);

    const { data: ledger } = sessionIds.length
      ? await supabaseAdmin
          .from("attendance_ledger")
          .select("session_id, student_id, decision")
          .in("session_id", sessionIds)
      : { data: [] as { session_id: string; student_id: string; decision: string }[] };

    const leaveDatesByStudent = new Map<string, Set<string>>();
    for (const l of approvedLeaves ?? []) {
      const set = leaveDatesByStudent.get(l.student_id) ?? new Set<string>();
      const cur = new Date(l.start_date);
      const last = new Date(l.end_date);
      while (cur <= last) {
        set.add(cur.toISOString().split("T")[0]);
        cur.setDate(cur.getDate() + 1);
      }
      leaveDatesByStudent.set(l.student_id, set);
    }

    const sessionsByCourse = new Map<string, typeof heldSessions>();
    for (const s of heldSessions) {
      const arr = sessionsByCourse.get(s.course_id) ?? [];
      arr.push(s);
      sessionsByCourse.set(s.course_id, arr);
    }

    const presentByStudentSession = new Set(
      (ledger ?? [])
        .filter((r) => r.decision === "present" || r.decision === "fallback_present")
        .map((r) => `${r.student_id}:${r.session_id}`),
    );

    // Aggregate held/attended per student across all their enrolled courses.
    const statsByStudent = new Map<string, { held: number; attended: number }>();
    for (const e of enrollments ?? []) {
      const courseSessions = sessionsByCourse.get(e.course_id) ?? [];
      const leaveDates = leaveDatesByStudent.get(e.student_id) ?? new Set<string>();
      const stat = statsByStudent.get(e.student_id) ?? { held: 0, attended: 0 };
      for (const s of courseSessions) {
        if (leaveDates.has(s.starts_at.split("T")[0])) continue;
        stat.held++;
        if (presentByStudentSession.has(`${e.student_id}:${s.id}`)) stat.attended++;
      }
      statsByStudent.set(e.student_id, stat);
    }

    const { notifyUser, notifyGuardiansOfStudent } = await import("./notifications.server");

    let alertsSent = 0;
    for (const [studentId, stat] of statsByStudent) {
      if (stat.held === 0) continue;
      const pct = (stat.attended / stat.held) * 100;
      if (pct < data.thresholdPercent) {
        const notif = {
          userId: studentId,
          title: "Low attendance warning",
          message: `Your overall attendance is ${pct.toFixed(1)}% (${stat.attended}/${stat.held}), below the ${data.thresholdPercent}% requirement.`,
          type: "warning" as const,
        };
        await notifyUser(supabaseAdmin, notif);
        await notifyGuardiansOfStudent(supabaseAdmin, studentId, notif);
        alertsSent++;
      }
    }

    return { studentsChecked: statsByStudent.size, alertsSent };
  });
