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

/** Admin, or the teacher who owns the given course. Throws if neither. */
async function requireAdminOrCourseTeacher(userId: string, courseId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleRow) return;

  const { data: course, error } = await supabaseAdmin
    .from("courses")
    .select("teacher_id")
    .eq("id", courseId)
    .single();
  if (error || !course) throw new Error("Course not found");
  if (course.teacher_id !== userId) {
    throw new Error("Forbidden: must be the course's teacher or an admin");
  }
}

// ============= Grade Scale computation helper =============

export interface GradeBand {
  letter: string;
  min_percent: number;
  max_percent: number;
  grade_point: number;
  is_passing: boolean;
}

export function resolveGrade(percentage: number, bands: GradeBand[]): GradeBand | null {
  return bands.find((b) => percentage >= b.min_percent && percentage <= b.max_percent) ?? null;
}

// ============= Admin: Exam CRUD =============

export const createExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        courseId: z.string().uuid(),
        semesterId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        examType: z.enum(["quiz", "midterm", "end_semester", "practical", "assignment"]),
        maxMarks: z.number().positive().max(1000),
        weightagePercent: z.number().min(0).max(100),
        examDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdminOrCourseTeacher(context.userId, data.courseId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("exams")
      .insert({
        course_id: data.courseId,
        semester_id: data.semesterId,
        name: data.name,
        exam_type: data.examType,
        max_marks: data.maxMarks,
        weightage_percent: data.weightagePercent,
        exam_date: data.examDate ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listExamsForCourse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ courseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("exams")
      .select(
        "id, course_id, semester_id, name, exam_type, max_marks, weightage_percent, exam_date, is_published, created_at",
      )
      .eq("course_id", data.courseId)
      .order("exam_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        examId: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        maxMarks: z.number().positive().max(1000).optional(),
        weightagePercent: z.number().min(0).max(100).optional(),
        examDate: z.string().nullable().optional(),
        isPublished: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam, error: getErr } = await supabaseAdmin
      .from("exams")
      .select("course_id")
      .eq("id", data.examId)
      .single();
    if (getErr || !exam) throw new Error("Exam not found");
    await requireAdminOrCourseTeacher(context.userId, exam.course_id);

    const patch: {
      updated_at: string;
      name?: string;
      max_marks?: number;
      weightage_percent?: number;
      exam_date?: string | null;
      is_published?: boolean;
    } = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.maxMarks !== undefined) patch.max_marks = data.maxMarks;
    if (data.weightagePercent !== undefined) patch.weightage_percent = data.weightagePercent;
    if (data.examDate !== undefined) patch.exam_date = data.examDate;
    if (data.isPublished !== undefined) patch.is_published = data.isPublished;

    const { error } = await supabaseAdmin.from("exams").update(patch).eq("id", data.examId);
    if (error) throw new Error(error.message);

    // ============ Notification Dispatch (on publish only) ============
    if (data.isPublished === true) {
      (async () => {
        try {
          const { data: examInfo } = await supabaseAdmin
            .from("exams")
            .select("name, max_marks")
            .eq("id", data.examId)
            .single();
          const { data: marks } = await supabaseAdmin
            .from("exam_marks")
            .select("student_id, marks_obtained, is_absent")
            .eq("exam_id", data.examId);

          const { notifyUser, notifyGuardiansOfStudent } = await import("./notifications.server");

          await Promise.all(
            (marks ?? []).map(async (m) => {
              const message = m.is_absent
                ? `Marked absent for "${examInfo?.name}".`
                : `Scored ${m.marks_obtained} / ${examInfo?.max_marks} in "${examInfo?.name}".`;
              const notif = {
                userId: m.student_id,
                title: "Exam result published",
                message,
                type: "info" as const,
              };
              await notifyUser(supabaseAdmin, notif);
              await notifyGuardiansOfStudent(supabaseAdmin, m.student_id, notif);
            }),
          );
        } catch (e) {
          console.error("Failed to dispatch exam result notifications:", e);
        }
      })();
    }

    return { ok: true };
  });

export const deleteExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ examId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam, error: getErr } = await supabaseAdmin
      .from("exams")
      .select("course_id")
      .eq("id", data.examId)
      .single();
    if (getErr || !exam) throw new Error("Exam not found");
    await requireAdminOrCourseTeacher(context.userId, exam.course_id);

    const { error } = await supabaseAdmin.from("exams").delete().eq("id", data.examId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Admin: Grade Scale management =============

export const listGradeScales = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("grade_scales")
      .select(
        "id, name, is_default, grade_bands(id, letter, min_percent, max_percent, grade_point, is_passing)",
      )
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getDefaultGradeBands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: scale, error: scaleErr } = await context.supabase
      .from("grade_scales")
      .select("id")
      .eq("is_default", true)
      .single();
    if (scaleErr || !scale) return [];

    const { data, error } = await context.supabase
      .from("grade_bands")
      .select("letter, min_percent, max_percent, grade_point, is_passing")
      .eq("grade_scale_id", scale.id)
      .order("min_percent", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ============= Teacher: Bulk marks entry =============

export const listEnrolledStudentsForMarksEntry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ examId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam, error: examErr } = await supabaseAdmin
      .from("exams")
      .select("course_id, max_marks")
      .eq("id", data.examId)
      .single();
    if (examErr || !exam) throw new Error("Exam not found");
    await requireAdminOrCourseTeacher(context.userId, exam.course_id);

    const [{ data: enrollments, error: enrollErr }, { data: existingMarks, error: marksErr }] =
      await Promise.all([
        supabaseAdmin
          .from("enrollments")
          .select("student_id, profiles:student_id(display_name, roll_no)")
          .eq("course_id", exam.course_id),
        supabaseAdmin
          .from("exam_marks")
          .select("student_id, marks_obtained, is_absent, remarks")
          .eq("exam_id", data.examId),
      ]);
    if (enrollErr) throw new Error(enrollErr.message);
    if (marksErr) throw new Error(marksErr.message);

    const marksByStudent = new Map((existingMarks ?? []).map((m) => [m.student_id, m]));

    interface EnrollmentProfileRow {
      student_id: string;
      profiles?: { display_name?: string | null; roll_no?: string | null } | null;
    }

    return {
      maxMarks: exam.max_marks,
      students: ((enrollments ?? []) as EnrollmentProfileRow[]).map((e) => {
        const existing = marksByStudent.get(e.student_id);
        return {
          studentId: e.student_id,
          displayName: e.profiles?.display_name ?? null,
          rollNo: e.profiles?.roll_no ?? null,
          marksObtained: existing?.marks_obtained ?? null,
          isAbsent: existing?.is_absent ?? false,
          remarks: existing?.remarks ?? "",
        };
      }),
    };
  });

export const bulkEnterMarks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        examId: z.string().uuid(),
        entries: z
          .array(
            z.object({
              studentId: z.string().uuid(),
              marksObtained: z.number().min(0).nullable(),
              isAbsent: z.boolean().default(false),
              remarks: z.string().max(500).optional().default(""),
            }),
          )
          .min(1)
          .max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam, error: examErr } = await supabaseAdmin
      .from("exams")
      .select("course_id, max_marks")
      .eq("id", data.examId)
      .single();
    if (examErr || !exam) throw new Error("Exam not found");
    await requireAdminOrCourseTeacher(context.userId, exam.course_id);

    const invalid = data.entries.filter(
      (e) => !e.isAbsent && (e.marksObtained === null || e.marksObtained > exam.max_marks),
    );
    if (invalid.length > 0) {
      throw new Error(
        `${invalid.length} row(s) have marks missing or exceeding the max (${exam.max_marks}).`,
      );
    }

    const now = new Date().toISOString();
    const rows = data.entries.map((e) => ({
      exam_id: data.examId,
      student_id: e.studentId,
      marks_obtained: e.isAbsent ? null : e.marksObtained,
      is_absent: e.isAbsent,
      remarks: e.remarks || null,
      entered_by: context.userId,
      entered_at: now,
      updated_at: now,
    }));

    const { error } = await supabaseAdmin
      .from("exam_marks")
      .upsert(rows, { onConflict: "exam_id,student_id" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

// ============= Student: Results =============

export type ExamResultRow = {
  examId: string;
  examName: string;
  examType: string;
  maxMarks: number;
  weightagePercent: number;
  marksObtained: number | null;
  isAbsent: boolean;
  percentage: number | null;
};

export type CourseResultSummary = {
  courseId: string;
  courseCode: string;
  courseName: string;
  exams: ExamResultRow[];
  weightedPercentage: number | null;
  grade: GradeBand | null;
};

export const getMyExamResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ semesterId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const enrollQuery = supabase
      .from("enrollments")
      .select("course_id, courses(id, code, name)")
      .eq("student_id", userId);
    const { data: enrollments, error: enrollErr } = await enrollQuery;
    if (enrollErr) throw new Error(enrollErr.message);

    interface EnrollCourseRow {
      course_id: string;
      courses?: { id: string; code: string; name: string } | null;
    }
    const courseIds = ((enrollments ?? []) as EnrollCourseRow[])
      .map((e) => e.courses)
      .filter((c): c is { id: string; code: string; name: string } => !!c);

    if (courseIds.length === 0) return [];

    let examQuery = supabase
      .from("exams")
      .select(
        "id, course_id, name, exam_type, max_marks, weightage_percent, is_published, semester_id",
      )
      .in(
        "course_id",
        courseIds.map((c) => c.id),
      )
      .eq("is_published", true);
    if (data.semesterId) examQuery = examQuery.eq("semester_id", data.semesterId);
    const { data: exams, error: examErr } = await examQuery;
    if (examErr) throw new Error(examErr.message);

    const examIds = (exams ?? []).map((e) => e.id);
    const { data: marks, error: marksErr } =
      examIds.length > 0
        ? await supabase
            .from("exam_marks")
            .select("exam_id, marks_obtained, is_absent")
            .eq("student_id", userId)
            .in("exam_id", examIds)
        : { data: [], error: null };
    if (marksErr) throw new Error(marksErr.message);

    const { data: bands } = await supabase
      .from("grade_scales")
      .select(
        "id, is_default, grade_bands(letter, min_percent, max_percent, grade_point, is_passing)",
      )
      .eq("is_default", true)
      .maybeSingle();
    const gradeBands: GradeBand[] = (bands?.grade_bands as GradeBand[] | undefined) ?? [];

    const marksByExam = new Map((marks ?? []).map((m) => [m.exam_id, m]));

    const results: CourseResultSummary[] = courseIds.map((course) => {
      const courseExams = (exams ?? []).filter((e) => e.course_id === course.id);
      const examRows: ExamResultRow[] = courseExams.map((ex) => {
        const m = marksByExam.get(ex.id);
        const marksObtained = m?.marks_obtained ?? null;
        const isAbsent = m?.is_absent ?? false;
        const percentage =
          marksObtained !== null && ex.max_marks > 0 ? (marksObtained / ex.max_marks) * 100 : null;
        return {
          examId: ex.id,
          examName: ex.name,
          examType: ex.exam_type,
          maxMarks: ex.max_marks,
          weightagePercent: ex.weightage_percent,
          marksObtained,
          isAbsent,
          percentage,
        };
      });

      const totalWeight = examRows.reduce(
        (sum, e) => sum + (e.percentage !== null ? e.weightagePercent : 0),
        0,
      );
      const weightedPercentage =
        totalWeight > 0
          ? examRows.reduce(
              (sum, e) =>
                sum +
                (e.percentage !== null ? (e.percentage * e.weightagePercent) / totalWeight : 0),
              0,
            )
          : null;

      return {
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        exams: examRows,
        weightedPercentage,
        grade: weightedPercentage !== null ? resolveGrade(weightedPercentage, gradeBands) : null,
      };
    });

    return results;
  });

// ============= Admin: Backlog report =============

export const listBacklogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ semesterId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let examQuery = supabaseAdmin
      .from("exams")
      .select("id, course_id, max_marks, weightage_percent, courses(code, name)")
      .eq("is_published", true);
    if (data.semesterId) examQuery = examQuery.eq("semester_id", data.semesterId);
    const { data: exams, error: examErr } = await examQuery;
    if (examErr) throw new Error(examErr.message);
    if (!exams || exams.length === 0) return [];

    const { data: marks, error: marksErr } = await supabaseAdmin
      .from("exam_marks")
      .select(
        "exam_id, student_id, marks_obtained, is_absent, profiles:student_id(display_name, roll_no)",
      )
      .in(
        "exam_id",
        exams.map((e) => e.id),
      );
    if (marksErr) throw new Error(marksErr.message);

    const { data: scale } = await supabaseAdmin
      .from("grade_scales")
      .select("id, grade_bands(letter, min_percent, max_percent, grade_point, is_passing)")
      .eq("is_default", true)
      .maybeSingle();
    const bands: GradeBand[] = (scale?.grade_bands as GradeBand[] | undefined) ?? [];
    const passThreshold = Math.min(...bands.filter((b) => b.is_passing).map((b) => b.min_percent));

    interface ExamCourseRow {
      id: string;
      course_id: string;
      max_marks: number;
      weightage_percent: number;
      courses?: { code: string; name: string } | null;
    }
    interface MarkRow {
      exam_id: string;
      student_id: string;
      marks_obtained: number | null;
      is_absent: boolean;
      profiles?: { display_name?: string | null; roll_no?: string | null } | null;
    }

    const examsByCourse = new Map<string, ExamCourseRow[]>();
    for (const e of exams as ExamCourseRow[]) {
      const list = examsByCourse.get(e.course_id) ?? [];
      list.push(e);
      examsByCourse.set(e.course_id, list);
    }

    const marksByExam = new Map<string, MarkRow[]>();
    for (const m of (marks ?? []) as MarkRow[]) {
      const list = marksByExam.get(m.exam_id) ?? [];
      list.push(m);
      marksByExam.set(m.exam_id, list);
    }

    const backlogs: {
      studentId: string;
      displayName: string | null;
      rollNo: string | null;
      courseCode: string;
      courseName: string;
      weightedPercentage: number;
    }[] = [];

    for (const [courseId, courseExams] of examsByCourse) {
      const studentIds = new Set<string>();
      for (const ex of courseExams) {
        for (const m of marksByExam.get(ex.id) ?? []) studentIds.add(m.student_id);
      }
      for (const studentId of studentIds) {
        let weightedSum = 0;
        let totalWeight = 0;
        let displayName: string | null = null;
        let rollNo: string | null = null;
        for (const ex of courseExams) {
          const mark = marksByExam.get(ex.id)?.find((m) => m.student_id === studentId);
          if (!mark || mark.is_absent || mark.marks_obtained === null) continue;
          displayName = mark.profiles?.display_name ?? displayName;
          if (mark.profiles?.roll_no) rollNo = mark.profiles.roll_no;
          const pct = ex.max_marks > 0 ? (mark.marks_obtained / ex.max_marks) * 100 : 0;
          weightedSum += pct * ex.weightage_percent;
          totalWeight += ex.weightage_percent;
        }
        if (totalWeight === 0) continue;
        const weightedPercentage = weightedSum / totalWeight;
        if (weightedPercentage < passThreshold) {
          backlogs.push({
            studentId,
            displayName,
            rollNo,
            courseCode: courseExams[0].courses?.code ?? "",
            courseName: courseExams[0].courses?.name ?? "",
            weightedPercentage: Math.round(weightedPercentage * 100) / 100,
          });
        }
      }
    }

    return backlogs;
  });

/**
 * Phase 3.1 Gap Closure: checkCondonedHallTicketEligibility
 * Calculates student hall ticket eligibility considering both raw attendance % and approved condonation credits (medical/sports leave).
 */
export const checkCondonedHallTicketEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        studentId: z.string().uuid().optional(),
        courseId: z.string().uuid(),
        minAttendancePct: z.number().min(0).max(100).default(75),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const targetStudentId = data.studentId ?? context.userId;

    // 1. Get total sessions for course
    const { count: totalSessions } = await supabaseAdmin
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .eq("course_id", data.courseId);

    const total = totalSessions ?? 0;

    // 2. Get present count from attendance_ledger
    const { count: presentSessions } = await supabaseAdmin
      .from("attendance_ledger")
      .select("id", { count: "exact", head: true })
      .eq("student_id", targetStudentId)
      .eq("decision", "present");

    const present = presentSessions ?? 0;

    // 3. Get approved condonation credits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: condonationRows } = await (supabaseAdmin as any)
      .from("condonation_credits")
      .select("credited_classes")
      .eq("student_id", targetStudentId)
      .eq("course_id", data.courseId);

    const condonationClasses = (condonationRows ?? []).reduce(
      (sum: number, r: { credited_classes?: number }) => sum + (r.credited_classes ?? 0),
      0,
    );

    const rawPct = total > 0 ? (present / total) * 100 : 100;
    const condonedPct =
      total > 0 ? Math.min(100, ((present + condonationClasses) / total) * 100) : 100;
    const isEligible = condonedPct >= data.minAttendancePct;

    return {
      studentId: targetStudentId,
      courseId: data.courseId,
      totalSessions: total,
      presentSessions: present,
      condonationClasses,
      rawAttendancePct: Math.round(rawPct * 10) / 10,
      effectiveAttendancePct: Math.round(condonedPct * 10) / 10,
      minThresholdPct: data.minAttendancePct,
      isEligible,
      status: isEligible
        ? "ELIGIBLE"
        : condonationClasses > 0
          ? "CONDONED_INSUFFICIENT"
          : "SHORTAGE",
    };
  });
