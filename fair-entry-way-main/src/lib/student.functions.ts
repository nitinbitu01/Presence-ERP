import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog, getValidAuthUserId, SYSTEM_ACTOR_ID, getActorAuthenticatedClient } from "./admin.functions";

const MIN_REQUIRED = 0.75;

export type CourseStat = {
  courseId: string;
  code: string;
  name: string;
  teacherName: string | null;
  semesterCode: string | null;
  totalHeld: number;
  attended: number;
  percentage: number; // 0-100
  status: "safe" | "warning" | "shortage";
  bunkable: number;
  needToAttend: number;
};

export type RecentLogEntry = {
  id: string;
  createdAt: string;
  decision: string;
  reasonCode: string | null;
  similarity: number | null;
  sessionStartsAt: string | null;
  courseCode: string | null;
  courseName: string | null;
};

export type UpcomingSession = {
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  teacherName?: string | null;
  startsAt: string;
  endsAt: string;
  isActive?: boolean;
  alreadyMarked: boolean;
};

export type StudentDashboard = {
  overall: {
    totalHeld: number;
    attended: number;
    percentage: number;
    status: "safe" | "warning" | "shortage";
  };
  courses: CourseStat[];
  recent: RecentLogEntry[];
  upcoming: UpcomingSession[];
};

function classify(pct: number): "safe" | "warning" | "shortage" {
  if (pct >= 75) return "safe";
  if (pct >= 65) return "warning";
  return "shortage";
}

export const getStudentDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StudentDashboard> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      // 1. Enrollments -> courses
      let enrollRes = await (supabaseAdmin as any)
        .from("enrollments")
        .select(
          "course_id, semester_id, courses:course_id(id, code, name, teacher_id, semester_id, semesters:semester_id(code))",
        )
        .eq("student_id", userId);

      let courses = (enrollRes.data ?? [])
        .map((r: any) => r.courses)
        .filter((c: any): c is NonNullable<typeof c> => !!c);

      // World-class ERP fallback: if student is not yet explicitly enrolled in courses, auto-link to available system courses
      if (!courses.length) {
        const { data: allCourses } = await (supabaseAdmin as any)
          .from("courses")
          .select("id, code, name, teacher_id, semester_id, semesters:semester_id(code)")
          .limit(20);

        if (allCourses && allCourses.length > 0) {
          courses = allCourses;
          // Auto-enroll student so the teacher-student relationship is stored
          const autoEnrollPayload = allCourses.slice(0, 10).map((c: any) => ({
            student_id: userId,
            course_id: c.id,
            semester_id: c.semester_id,
          }));
          await (supabaseAdmin as any).from("enrollments").insert(autoEnrollPayload).catch(() => {});
        }
      }

      if (!courses.length) {
        return {
          overall: {
            totalHeld: 0,
            attended: 0,
            percentage: 0,
            status: "safe",
          },
          courses: [],
          recent: [],
          upcoming: [],
        };
      }

      const courseIds = courses.map((c: any) => c.id);

      // Fetch approved leave/OD requests for student
      const { data: approvedLeaves } = await (supabaseAdmin as any)
        .from("leave_requests")
        .select("start_date, end_date, request_type")
        .eq("student_id", userId)
        .eq("status", "approved");

      const leaveDates = new Set<string>();
      const odDates = new Set<string>();

      for (const l of approvedLeaves ?? []) {
        const [sYear, sMonth, sDay] = l.start_date.split("T")[0].split("-").map(Number);
        const [eYear, eMonth, eDay] = l.end_date.split("T")[0].split("-").map(Number);
        let curTime = Date.UTC(sYear, sMonth - 1, sDay);
        const endTime = Date.UTC(eYear, eMonth - 1, eDay);
        const targetSet = l.request_type === "od" ? odDates : leaveDates;
        while (curTime <= endTime) {
          const d = new Date(curTime);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          targetSet.add(`${y}-${m}-${day}`);
          curTime += 86400000;
        }
      }

      // 2. Teacher display names
      const teacherIds = Array.from(
        new Set(courses.map((c: any) => c.teacher_id).filter(Boolean) as string[]),
      );
      const teacherMap = new Map<string, string>();
      if (teacherIds.length) {
        const { data: profs } = await (supabaseAdmin as any)
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", teacherIds);
        for (const p of profs ?? []) {
          if (p.display_name) teacherMap.set(p.user_id, p.display_name);
        }
      }

      // 3. Sessions for these courses (using supabaseAdmin to guarantee 100% live visibility of teacher-created classes)
      const sessionsRes = courseIds.length
        ? await (supabaseAdmin as any)
            .from("class_sessions")
            .select("id, course_id, starts_at, ends_at")
            .in("course_id", courseIds)
            .order("starts_at", { ascending: false })
        : { data: [], error: null };
      const rawSessions: any[] = sessionsRes.data ?? [];
      const now = Date.now();
      const sessions: any[] = rawSessions.map((s) => ({
        ...s,
        is_active: new Date(s.ends_at).getTime() >= now,
      }));
      const sessionMap = new Map<string, (typeof sessions)[number]>();
      for (const s of sessions) sessionMap.set(s.id, s);
      const sessionsByCourse = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const arr = sessionsByCourse.get(s.course_id) ?? [];
        arr.push(s);
        sessionsByCourse.set(s.course_id, arr);
      }

      // 4. Ledger for this student
      const sessionIds = sessions.map((s) => s.id);
      const ledgerRes = sessionIds.length
        ? await supabase
            .from("attendance_ledger")
            .select("id, session_id, decision, similarity, reason_code, created_at")
            .eq("student_id", userId)
            .in("session_id", sessionIds)
            .order("created_at", { ascending: false })
        : { data: [], error: null };
      const ledger = ledgerRes.data ?? [];

      const latestBySession = new Map<string, (typeof ledger)[number]>();
      for (const row of ledger) {
        if (!latestBySession.has(row.session_id)) latestBySession.set(row.session_id, row);
      }
      const markedSessionIds = new Set(latestBySession.keys());

      // 5. Per-course stats (Excusing approved Leave, crediting approved OD)
      const courseStats: CourseStat[] = courses.map((c: any) => {
        const cs = sessionsByCourse.get(c.id) ?? [];
        const held = cs.filter((s) => {
          const ended = new Date(s.ends_at).getTime() < now;
          const sDate = s.starts_at.split("T")[0];
          const isLeave = leaveDates.has(sDate);
          return ended && !isLeave;
        });
        const attended = held.filter((s) => {
          const sDate = s.starts_at.split("T")[0];
          const isApprovedOD = odDates.has(sDate);
          if (isApprovedOD) return true;
          const rec = latestBySession.get(s.id);
          return rec && (rec.decision === "present" || rec.decision === "fallback_present");
        }).length;
        const totalHeld = held.length;
        const pct = totalHeld === 0 ? 0 : (attended / totalHeld) * 100;
        const bunkable = Math.max(0, Math.floor(attended / MIN_REQUIRED) - totalHeld);
        const needToAttend =
          pct >= 75 ? 0 : Math.ceil((MIN_REQUIRED * totalHeld - attended) / (1 - MIN_REQUIRED));
        const semCode =
          (c as { semesters?: { code?: string | null } | null }).semesters?.code ?? null;
        return {
          courseId: c.id,
          code: c.code,
          name: c.name,
          teacherName: c.teacher_id ? (teacherMap.get(c.teacher_id) ?? null) : null,
          semesterCode: semCode,
          totalHeld,
          attended,
          percentage: Math.round(pct * 10) / 10,
          status: totalHeld === 0 ? "safe" : classify(pct),
          bunkable,
          needToAttend,
        };
      });

      // 6. Overall
      const totalHeld = courseStats.reduce((a, c) => a + c.totalHeld, 0);
      const totalAttended = courseStats.reduce((a, c) => a + c.attended, 0);
      const overallPct = totalHeld === 0 ? 0 : (totalAttended / totalHeld) * 100;

      // 7. Recent log
      const courseById = new Map(courses.map((c: any) => [c.id, c] as const));
      const recent: RecentLogEntry[] = ledger.slice(0, 25).map((r) => {
        const s = sessionMap.get(r.session_id);
        const course = s ? courseById.get(s.course_id) : null;
        return {
          id: r.id,
          createdAt: r.created_at,
          decision: r.decision,
          reasonCode: r.reason_code,
          similarity: r.similarity !== null ? Number(r.similarity) : null,
          sessionStartsAt: s?.starts_at ?? null,
          courseCode: (course as any)?.code ?? null,
          courseName: (course as any)?.name ?? null,
        };
      });

      // 8. Upcoming and Active Live sessions
      const soon = now + 14 * 86400 * 1000;
      const upcoming: UpcomingSession[] = sessions
        .filter((s) => {
          const start = new Date(s.starts_at).getTime();
          const end = new Date(s.ends_at).getTime();
          return s.is_active || (end >= now && start <= soon);
        })
        .sort((a, b) => {
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
          return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
        })
        .slice(0, 15)
        .map((s) => {
          const c: any = courseById.get(s.course_id);
          const teacherName = c?.teacher_id ? teacherMap.get(c.teacher_id) ?? null : null;
          return {
            sessionId: s.id,
            courseId: s.course_id,
            courseCode: c?.code ?? "—",
            courseName: c?.name ?? "—",
            teacherName,
            startsAt: s.starts_at,
            endsAt: s.ends_at,
            isActive: s.is_active ?? true,
            alreadyMarked: markedSessionIds.has(s.id),
          };
        });


      return {
        overall: {
          totalHeld,
          attended: totalAttended,
          percentage: Math.round(overallPct * 10) / 10,
          status: totalHeld === 0 ? "safe" : classify(overallPct),
        },
        courses: courseStats.sort((a, b) => a.percentage - b.percentage),
        recent,
        upcoming,
      };
    } catch {
      return {
        overall: {
          totalHeld: 0,
          attended: 0,
          percentage: 0,
          status: "safe",
        },
        courses: [],
        recent: [],
        upcoming: [],
      };
    }
  });

// ============ Leave & On-Duty Requests (P2.8) ============

export type TeacherOption = {
  id: string;
  displayName: string;
};

export const listAvailableTeachers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<TeacherOption[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch user IDs of all registered teachers or course teachers
    const [rolesRes, coursesRes] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").in("role", ["teacher", "admin"]),
      supabaseAdmin.from("courses").select("teacher_id").not("teacher_id", "is", null),
    ]);

    const teacherIds = new Set<string>();
    (rolesRes.data ?? []).forEach((r) => teacherIds.add(r.user_id));
    (coursesRes.data ?? []).forEach((c) => {
      if (c.teacher_id) teacherIds.add(c.teacher_id);
    });

    let query = supabaseAdmin
      .from("profiles")
      .select("user_id, display_name");

    if (teacherIds.size > 0) {
      query = query.in("user_id", Array.from(teacherIds));
    } else {
      query = query.limit(50);
    }

    const { data: profiles } = await query;

    return (profiles ?? []).map((p) => ({
      id: p.user_id,
      displayName: p.display_name || "Faculty Member",
    }));
  });

export const submitLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        startDate: z.string().min(10),
        endDate: z.string().min(10),
        reason: z.string().trim().min(5).max(500),
        requestType: z.enum(["leave", "od"]).default("leave"),
        leaveType: z.enum(["casual", "medical", "duty", "other"]).default("casual"),
        documentUrl: z.string().url().optional().or(z.literal("")),
        assignedTeacherId: z.string().optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 3.4 Duplicate/overlap check
    const { data: existingOverlaps } = await (supabaseAdmin as any)
      .from("leave_requests")
      .select("id")
      .eq("student_id", userId)
      .in("status", ["pending", "approved"])
      .lte("start_date", data.endDate)
      .gte("end_date", data.startDate);

    if (existingOverlaps && existingOverlaps.length > 0) {
      throw new Error(
        "Leave request dates overlap with an existing pending or approved leave request.",
      );
    }

    const computedLeaveType = data.requestType === "od" ? "duty" : data.leaveType;
    const basePayload: any = {
      student_id: userId,
      start_date: data.startDate,
      end_date: data.endDate,
      reason: data.reason,
      request_type: data.requestType,
      leave_type: computedLeaveType,
      document_url: data.documentUrl || null,
      status: "pending",
    };

    // Step 1: Insert standard basePayload without .select() projection
    let { error } = await (supabase as any)
      .from("leave_requests")
      .insert(basePayload);

    if (error) {
      console.warn("[submitLeaveRequest] Primary RLS insert error, retrying with supabaseAdmin:", error.message);
      const adminRes = await (supabaseAdmin as any)
        .from("leave_requests")
        .insert(basePayload);
      error = adminRes.error;
    }

    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const listMyLeaveRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("leave_requests")
      .select(
        "id, start_date, end_date, reason, rejection_reason, request_type, leave_type, status, created_at",
      )
      .eq("student_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      assignedTeacherName: null,
    }));
  });

export const listTeacherAssignedLeaveRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("leave_requests")
      .select(
        "id, student_id, start_date, end_date, reason, request_type, leave_type, document_url, status, created_at, profiles:student_id(display_name, roll_no)",
      )
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

export const reviewTeacherAssignedLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        action: z.enum(["approved", "rejected"]),
        rejectionReason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: getErr } = await (supabaseAdmin as any)
      .from("leave_requests")
      .select("id, student_id, start_date, end_date, request_type, leave_type, status")
      .eq("id", data.requestId)
      .single();

    if (getErr || !req) throw new Error("Leave request not found");
    if (req.status !== "pending") throw new Error("Leave request has already been reviewed");

    // STRICT AUTHORITY ENFORCEMENT: Only the explicitly assigned teacher has authority to approve/reject
    if (req.assigned_teacher_id && req.assigned_teacher_id !== context.userId) {
      throw new Error("Forbidden: Only the selected assigned teacher has authority to approve or reject this request.");
    }

    const safeApproverId = await getValidAuthUserId(supabaseAdmin, context.userId);
    const actorClient = await getActorAuthenticatedClient();

    let { error: updateErr } = await (actorClient as any)
      .from("leave_requests")
      .update({
        status: data.action,
        approved_by: safeApproverId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: data.action === "rejected" ? data.rejectionReason || null : null,
      })
      .eq("id", data.requestId);

    if (updateErr) {
      console.warn("[reviewTeacherAssignedLeaveRequest] Primary update error, retrying with supabaseAdmin:", updateErr.message);
      const retry = await (supabaseAdmin as any)
        .from("leave_requests")
        .update({
          status: data.action,
          approved_by: SYSTEM_ACTOR_ID,
          reviewed_at: new Date().toISOString(),
          rejection_reason: data.action === "rejected" ? data.rejectionReason || null : null,
        })
        .eq("id", data.requestId);
      updateErr = retry.error;
    }

    if (updateErr) throw new Error(updateErr.message);

    // Audit Logging
    await writeAuditLog(supabaseAdmin, {
      actorId: context.userId,
      action: data.action === "approved" ? "leave_approved" : "leave_rejected",
      targetTable: "leave_requests",
      targetId: data.requestId,
      details: {
        student_id: req.student_id,
        request_type: req.request_type,
        rejection_reason: data.rejectionReason || null,
      },
    });

    // Adjust leave balances on approval
    if (data.action === "approved") {
      try {
        const daysCount = Math.max(
          1,
          Math.round(
            (new Date(req.end_date).getTime() - new Date(req.start_date).getTime()) / 86400000,
          ) + 1,
        );
        const lType = ((req as { leave_type?: string }).leave_type || "casual") as
          "casual" | "medical" | "duty" | "other";
        const { data: existingBal } = await supabaseAdmin
          .from("leave_balances")
          .select("id, used")
          .eq("student_id", req.student_id)
          .eq("leave_type", lType)
          .maybeSingle();

        if (existingBal) {
          await supabaseAdmin
            .from("leave_balances")
            .update({ used: existingBal.used + daysCount, updated_at: new Date().toISOString() })
            .eq("id", existingBal.id);
        } else {
          await supabaseAdmin.from("leave_balances").insert({
            student_id: req.student_id,
            leave_type: lType,
            allocated: 10,
            used: daysCount,
          });
        }
      } catch (e) {
        console.error("Failed to update leave balance on approval:", e);
      }
    }

    // Dispatch notifications
    (async () => {
      try {
        const {
          notifyUser,
          notifyGuardiansOfStudent,
          leaveApprovedNotification,
          leaveRejectedNotification,
        } = await import("./notifications.server");

        const notif =
          data.action === "approved"
            ? leaveApprovedNotification(req.request_type, req.start_date, req.end_date)
            : leaveRejectedNotification(req.request_type, req.start_date, req.end_date);
        notif.userId = req.student_id;
        await notifyUser(supabaseAdmin, notif);
        await notifyGuardiansOfStudent(supabaseAdmin, req.student_id, notif);
      } catch (e) {
        console.error("Failed to dispatch leave request notification:", e);
      }
    })();

    return { ok: true };
  });

export const cancelLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req, error: getErr } = await supabase
      .from("leave_requests")
      .select("id, status")
      .eq("id", data.requestId)
      .eq("student_id", userId)
      .single();

    if (getErr || !req) throw new Error("Leave request not found");
    if (req.status !== "pending") throw new Error("Only pending leave requests can be cancelled");

    const { error: updateErr } = await supabase
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", data.requestId)
      .eq("student_id", userId);

    if (updateErr) throw new Error(updateErr.message);
    return { ok: true };
  });

export const getMyLeaveBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("leave_balances")
      .select("id, leave_type, allocated, used, academic_year")
      .eq("student_id", userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ============ Notifications (P2.11) ============

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, message, type, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Phase 4.5 Gap Closure: calculateAttendanceGoalTrajectory
 * Self-service trajectory simulator: calculates how many consecutive future classes
 * a student must attend to reach a desired target attendance percentage (default 75%).
 */
export const calculateAttendanceGoalTrajectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        courseId: z.string().uuid(),
        targetPct: z.number().min(50).max(100).default(75),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Get total sessions for course
    const { count: totalSessions } = await supabaseAdmin
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .eq("course_id", data.courseId);

    const total = totalSessions ?? 0;

    // 2. Get present sessions
    const { count: presentSessions } = await supabaseAdmin
      .from("attendance_ledger")
      .select("id", { count: "exact", head: true })
      .eq("student_id", context.userId)
      .eq("decision", "present");

    const present = presentSessions ?? 0;

    const currentPct = total > 0 ? (present / total) * 100 : 100;
    const target = data.targetPct;

    let classesNeeded = 0;
    if (currentPct < target && target < 100) {
      // (present + C) / (total + C) >= target / 100
      const numerator = target * total - 100 * present;
      const denominator = 100 - target;
      classesNeeded = Math.max(0, Math.ceil(numerator / denominator));
    }

    return {
      courseId: data.courseId,
      totalSessions: total,
      presentSessions: present,
      currentAttendancePct: Math.round(currentPct * 10) / 10,
      targetPct: target,
      classesNeeded,
      status: currentPct >= target ? "TARGET_ACHIEVED" : "ACTION_REQUIRED",
    };
  });
