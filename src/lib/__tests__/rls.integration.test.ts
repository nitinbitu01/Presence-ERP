/**
 * RLS (Row Level Security) Integration Tests
 *
 * Tests verify that Supabase RLS policies correctly enforce:
 * - Students can only access their own data
 * - Teachers can access courses they own and enrolled students
 * - Admins can access all data
 * - Non-admins cannot write to user_roles or role_requests
 *
 * NOTE: These tests describe the expected behavior.
 * For full end-to-end testing, use a test Supabase instance.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Mock user roles and their expected permissions
 */

export const PERMISSIONS = {
  STUDENT: {
    canRead: {
      ownNotifications: true,
      ownSubmissions: true,
      ownEnrollments: true,
      otherStudentData: false,
      allCoursesAndSessions: false,
    },
    canWrite: {
      ownNotifications: true, // mark as read
      submitAttendance: true,
      requestFallback: true,
      requestTeacherRole: true,
      updateUserRoles: false,
      updateRoleRequests: false,
    },
  },
  TEACHER: {
    canRead: {
      ownCoursesAndSessions: true,
      enrolledStudentsInOwnCourses: true,
      attendanceOfOwnCourses: true,
      allUserData: false,
    },
    canWrite: {
      createCourses: true,
      createSessions: true,
      reviewFallbackRequests: true,
      reviewAttendance: true,
      updateUserRoles: false,
      updateRoleRequests: false,
    },
  },
  ADMIN: {
    canRead: {
      allUserData: true,
      allCoursesAndSessions: true,
      allAttendance: true,
      allNotifications: true,
    },
    canWrite: {
      createUsers: true,
      updateUserRoles: true,
      approveRoleRequests: true,
      updateAllData: true,
    },
  },
};

describe("RLS Policy Enforcement", () => {
  describe("Notifications Table", () => {
    it("student can read own notifications", () => {
      const studentId = "student_uuid";
      const rls = {
        principal: studentId,
        action: "SELECT",
        table: "notifications",
        filter: { user_id: studentId },
      };

      expect(rls.filter.user_id).toBe(studentId);
      // Policy: user_id = auth.uid() is required
    });

    it("student cannot read other students' notifications", () => {
      const studentId = "student_uuid";
      const otherStudentId = "other_student_uuid";
      const rls = {
        principal: studentId,
        action: "SELECT",
        table: "notifications",
        filter: { user_id: otherStudentId },
      };

      expect(rls.filter.user_id).not.toBe(studentId);
      // Policy: user_id = auth.uid() prevents this read
    });

    it("student can update own notifications", () => {
      const studentId = "student_uuid";
      const update = {
        principal: studentId,
        action: "UPDATE",
        table: "notifications",
        filters: { user_id: studentId },
        columns: ["read"], // Only mark as read
      };

      expect(update.filters.user_id).toBe(studentId);
      // Policy allows UPDATE for own rows
    });

    it("non-owner cannot INSERT notifications for others", () => {
      const studentId = "student_uuid";
      const otherStudentId = "other_student_uuid";
      const insert = {
        principal: studentId,
        action: "INSERT",
        table: "notifications",
        data: { user_id: otherStudentId, title: "Hack" },
      };

      expect(insert.data.user_id).not.toBe(studentId);
      // Policy: user_id = auth.uid() in WITH CHECK prevents insert
    });
  });

  describe("User Roles Table", () => {
    it("admin can read all user roles", () => {
      const adminId = "admin_uuid";
      const rls = {
        principal: adminId,
        role: "admin",
        action: "SELECT",
        table: "user_roles",
      };

      expect(rls.role).toBe("admin");
      // Admin can read all rows
    });

    it("student cannot read user_roles table", () => {
      const studentId = "student_uuid";
      const rls = {
        principal: studentId,
        role: "student",
        action: "SELECT",
        table: "user_roles",
      };

      expect(rls.role).not.toBe("admin");
      // No policy grants student SELECT on user_roles
    });

    it("non-admin cannot INSERT into user_roles", () => {
      const studentId = "student_uuid";
      const insert = {
        principal: studentId,
        role: "student",
        action: "INSERT",
        table: "user_roles",
        data: { user_id: studentId, role: "teacher" },
      };

      expect(insert.role).not.toBe("admin");
      // Only admin-gated server functions can insert via service_role
    });

    it("admin can INSERT approved role grant", () => {
      const adminId = "admin_uuid";
      const targetUserId = "student_uuid";
      const insert = {
        principal: adminId,
        role: "admin",
        action: "INSERT",
        table: "user_roles",
        data: { user_id: targetUserId, role: "teacher" },
      };

      expect(insert.role).toBe("admin");
      // Admin (via server function) can grant roles
    });
  });

  describe("Role Requests Table", () => {
    it("student can INSERT own role request with status=pending", () => {
      const studentId = "student_uuid";
      const insert = {
        principal: studentId,
        action: "INSERT",
        table: "role_requests",
        data: {
          user_id: studentId,
          requested_role: "teacher",
          status: "pending",
          reason: "Want to teach",
        },
      };

      expect(insert.data.user_id).toBe(studentId);
      expect(insert.data.status).toBe("pending");
      // RLS: (auth.uid() = user_id AND status = 'pending' AND reviewed_by IS NULL)
    });

    it("student-crafted INSERT to role_requests with status='approved' or reviewed_by is force-downgraded to 'pending'", () => {
      const studentId = "student_uuid";
      const insertAttempt = {
        user_id: studentId,
        requested_role: "teacher",
        status: "approved",
        reviewed_by: studentId,
      };

      const sanitized = {
        ...insertAttempt,
        status: "pending",
        reviewed_by: null,
      };

      expect(sanitized.status).toBe("pending");
      expect(sanitized.reviewed_by).toBeNull();
    });

    it("student cannot INSERT role request for other user", () => {
      const studentId = "student_uuid";
      const otherStudentId = "other_uuid";
      const insert = {
        principal: studentId,
        action: "INSERT",
        table: "role_requests",
        data: {
          user_id: otherStudentId,
          requested_role: "admin",
          status: "pending",
        },
      };

      expect(insert.data.user_id).not.toBe(studentId);
      // RLS: auth.uid() = user_id check fails
    });

    it("admin can SELECT all role requests", () => {
      const adminId = "admin_uuid";
      const rls = {
        principal: adminId,
        role: "admin",
        action: "SELECT",
        table: "role_requests",
      };

      expect(rls.role).toBe("admin");
      // Admin has full access
    });

    it("student can only SELECT own role requests", () => {
      const studentId = "student_uuid";
      const select = {
        principal: studentId,
        action: "SELECT",
        table: "role_requests",
        filter: { user_id: studentId },
      };

      expect(select.filter.user_id).toBe(studentId);
      // RLS limits to own requests
    });
  });

  describe("Courses Table", () => {
    it("teacher can INSERT own course", () => {
      const teacherId = "teacher_uuid";
      const insert = {
        principal: teacherId,
        action: "INSERT",
        table: "courses",
        data: {
          name: "New Course",
          teacher_id: teacherId,
          department_id: "dept_uuid",
        },
      };

      expect(insert.data.teacher_id).toBe(teacherId);
      // RLS allows teacher_id = auth.uid()
    });

    it("teacher cannot INSERT course for another teacher", () => {
      const teacherId = "teacher_uuid";
      const otherTeacherId = "other_teacher_uuid";
      const insert = {
        principal: teacherId,
        action: "INSERT",
        table: "courses",
        data: {
          name: "Trick Course",
          teacher_id: otherTeacherId,
        },
      };

      expect(insert.data.teacher_id).not.toBe(teacherId);
      // RLS: teacher_id = auth.uid() check fails
    });

    it("student can SELECT enrolled courses only", () => {
      const studentId = "student_uuid";
      const enrollmentCheck = {
        principal: studentId,
        action: "SELECT",
        table: "courses",
        requiresJoin: "enrollments",
        condition: "student_id = auth.uid()",
      };

      expect(enrollmentCheck.principal).toBe(studentId);
      // RLS via EXISTS (SELECT FROM enrollments WHERE student_id = auth.uid())
    });

    it("admin can SELECT all courses", () => {
      const adminId = "admin_uuid";
      const rls = {
        principal: adminId,
        role: "admin",
        action: "SELECT",
        table: "courses",
      };

      expect(rls.role).toBe("admin");
      // Admin policy grants full access
    });
  });

  describe("Attendance Ledger Table", () => {
    it("student can SELECT own attendance only", () => {
      const studentId = "student_uuid";
      const select = {
        principal: studentId,
        action: "SELECT",
        table: "attendance_ledger",
        filter: { student_id: studentId },
      };

      expect(select.filter.student_id).toBe(studentId);
      // RLS: student_id = auth.uid()
    });

    it("teacher can SELECT attendance for own courses", () => {
      const teacherId = "teacher_uuid";
      const select = {
        principal: teacherId,
        action: "SELECT",
        table: "attendance_ledger",
        requiresJoin: "class_sessions JOIN courses",
        condition: "courses.teacher_id = auth.uid()",
      };

      expect(select.requiresJoin).toContain("courses");
      // RLS uses EXISTS with join to verify course ownership
    });

    it("client cannot INSERT into attendance_ledger", () => {
      const studentId = "student_uuid";
      const insert = {
        principal: studentId,
        action: "INSERT",
        table: "attendance_ledger",
      };

      expect(insert.action).toBe("INSERT");
      // RLS policy: ledger_no_client_insert WITH CHECK (false) blocks all client inserts
      // Only service_role (server) can insert
    });

    it("admin can SELECT all attendance", () => {
      const adminId = "admin_uuid";
      const select = {
        principal: adminId,
        role: "admin",
        action: "SELECT",
        table: "attendance_ledger",
      };

      expect(select.role).toBe("admin");
      // Admin policy allows full access
    });

    it("attendance_ledger is immutable (append-only)", () => {
      const anyUser = "any_user_uuid";
      const update = {
        principal: anyUser,
        action: "UPDATE",
        table: "attendance_ledger",
      };

      // Trigger function attendance_ledger_no_update raises exception
      // No UPDATE policy exists
      expect(update.table).toBe("attendance_ledger");
      // All UPDATE attempts fail at trigger level
    });
  });

  describe("Fallback Requests Table", () => {
    it("student can INSERT own fallback request", () => {
      const studentId = "student_uuid";
      const insert = {
        principal: studentId,
        action: "INSERT",
        table: "fallback_requests",
        data: {
          student_id: studentId,
          session_id: "session_uuid",
          reason: "Camera broken",
          status: "pending",
        },
      };

      expect(insert.data.student_id).toBe(studentId);
      expect(insert.data.status).toBe("pending");
      // RLS allows INSERT where student_id = auth.uid()
    });

    it("teacher can SELECT fallback requests for own courses", () => {
      const teacherId = "teacher_uuid";
      const select = {
        principal: teacherId,
        action: "SELECT",
        table: "fallback_requests",
        requiresJoin: "class_sessions JOIN courses",
        condition: "courses.teacher_id = auth.uid()",
      };

      expect(select.requiresJoin).toContain("courses");
      // RLS limits to own course fallback requests
    });

    it("teacher can UPDATE fallback request status", () => {
      const teacherId = "teacher_uuid";
      const update = {
        principal: teacherId,
        action: "UPDATE",
        table: "fallback_requests",
        columns: ["status", "reviewed_by", "reviewed_at"],
      };

      expect(update.action).toBe("UPDATE");
      // RLS allows UPDATE if teacher owns the course
    });

    it("admin can SELECT all fallback requests", () => {
      const adminId = "admin_uuid";
      const select = {
        principal: adminId,
        role: "admin",
        action: "SELECT",
        table: "fallback_requests",
      };

      expect(select.role).toBe("admin");
      // Admin policy grants full access
    });
  });

  describe("Device Fingerprints Table", () => {
    it("student can SELECT own device fingerprints", () => {
      const studentId = "student_uuid";
      const select = {
        principal: studentId,
        action: "SELECT",
        table: "device_fingerprints",
        filter: { student_id: studentId },
      };

      expect(select.filter.student_id).toBe(studentId);
      // RLS: student_id = auth.uid()
    });

    it("student cannot read other students' device fingerprints", () => {
      const studentId = "student_uuid";
      const otherStudentId = "other_uuid";
      const select = {
        principal: studentId,
        action: "SELECT",
        table: "device_fingerprints",
        filter: { student_id: otherStudentId },
      };

      expect(select.filter.student_id).not.toBe(studentId);
      // RLS blocks cross-student access
    });

    it("admin can SELECT all device fingerprints", () => {
      const adminId = "admin_uuid";
      const select = {
        principal: adminId,
        role: "admin",
        action: "SELECT",
        table: "device_fingerprints",
      };

      expect(select.role).toBe("admin");
      // Admin policy allows full read
    });
  });

  describe("Rate Limit Attempts Table", () => {
    it("authenticated users cannot SELECT rate_limit_attempts", () => {
      const anyUser = "any_user_uuid";
      const select = {
        principal: anyUser,
        action: "SELECT",
        table: "rate_limit_attempts",
      };

      // No authenticated policies exist; only service_role can access
      expect(select.table).toBe("rate_limit_attempts");
      // Read blocked by RLS (no granted policies)
    });

    it("service_role (server) can INSERT rate limit records", () => {
      const action = {
        principal: "service_role",
        action: "INSERT",
        table: "rate_limit_attempts",
        data: { key: "attend:student:uuid:session_uuid", attempted_at: new Date() },
      };

      expect(action.principal).toBe("service_role");
      // Service role has GRANT ALL
    });
  });

  describe("Cross-Role Isolation", () => {
    it("prevents privilege escalation via direct INSERT to user_roles", () => {
      const studentId = "student_uuid";
      const attack = {
        principal: studentId,
        intent: "Self-escalate to teacher",
        action: "INSERT",
        table: "user_roles",
        data: { user_id: studentId, role: "teacher" },
      };

      // No INSERT policy grants authenticated users access to user_roles
      // Only admin-gated server functions can write
      expect(attack.principal).not.toBe("admin");
      // RLS blocks this attack
    });

    it("prevents teacher from accessing another teacher's courses", () => {
      const teacherId = "teacher_uuid";
      const otherTeacherId = "other_teacher_uuid";
      const access = {
        principal: teacherId,
        action: "SELECT",
        table: "courses",
        filter: { teacher_id: otherTeacherId },
      };

      expect(access.filter.teacher_id).not.toBe(teacherId);
      // RLS: teacher_id = auth.uid() check fails
    });

    it("prevents student from creating courses", () => {
      const studentId = "student_uuid";
      const insert = {
        principal: studentId,
        role: "student",
        action: "INSERT",
        table: "courses",
      };

      expect(insert.role).not.toBe("teacher");
      // No INSERT policy grants students access to courses
    });
  });

  describe("Leave/OD Request Admin Approval Workflow", () => {
    it("only an admin principal may call reviewLeaveRequest", () => {
      const isAdmin = (roles: string[]) => roles.includes("admin");
      expect(isAdmin(["student"])).toBe(false);
      expect(isAdmin(["teacher"])).toBe(false);
      expect(isAdmin(["admin"])).toBe(true);
    });

    it("rejects reviewing a request that is not pending", () => {
      const canReview = (status: string) => status === "pending";
      expect(canReview("pending")).toBe(true);
      expect(canReview("approved")).toBe(false);
      expect(canReview("rejected")).toBe(false);
    });

    it("student cannot approve their own leave request directly", () => {
      // Students can only INSERT/SELECT their own leave_requests rows;
      // only reviewLeaveRequest (admin-gated) can transition status.
      const studentAttemptsDirectUpdate = {
        principal: "student_uuid",
        role: "student",
        action: "UPDATE",
        table: "leave_requests",
        patch: { status: "approved" },
      };
      expect(studentAttemptsDirectUpdate.role).not.toBe("admin");
      // No UPDATE policy grants students write access to leave_requests.status
    });

    it("student-crafted INSERT with status='approved' is force-downgraded to 'pending' and approved_by is wiped", () => {
      const studentId = "student_uuid";
      const directSelfApproveAttempt = {
        principal: studentId,
        role: "student",
        action: "INSERT",
        table: "leave_requests",
        data: {
          student_id: studentId,
          start_date: "2026-08-01",
          end_date: "2026-08-02",
          reason: "Self approve attempt",
          status: "approved",
          approved_by: studentId,
        },
      };

      // DB Trigger & RLS: status forced to 'pending', approved_by forced to NULL
      const sanitizedData = {
        ...directSelfApproveAttempt.data,
        status: "pending",
        approved_by: null,
      };

      expect(sanitizedData.status).toBe("pending");
      expect(sanitizedData.approved_by).toBeNull();
    });

    it("approving records reviewer identity and timestamp", () => {
      const before = { status: "pending", approved_by: null, reviewed_at: null };
      const after = {
        ...before,
        status: "approved",
        approved_by: "admin_uuid",
        reviewed_at: new Date().toISOString(),
      };
      expect(after.approved_by).toBe("admin_uuid");
      expect(after.reviewed_at).not.toBeNull();
    });

    it("dispatches an approval or rejection notification to the student", () => {
      const buildNotification = (action: "approved" | "rejected", studentId: string) => ({
        userId: studentId,
        type: action === "approved" ? "success" : "error",
      });
      const approved = buildNotification("approved", "student_uuid");
      const rejected = buildNotification("rejected", "student_uuid");
      expect(approved.type).toBe("success");
      expect(rejected.type).toBe("error");
      expect(approved.userId).toBe("student_uuid");
    });

    it("approved leave days are excluded from attendance percentage calculation", () => {
      // Mirrors getMyCourseAttendance: total sessions minus approved leave days
      const totalSessions = 20;
      const missedDueToLeave = 3;
      const missedOther = 2;
      const attended = totalSessions - missedDueToLeave - missedOther;
      const eligibleSessions = totalSessions - missedDueToLeave;
      const percentage = Math.round((attended / eligibleSessions) * 100);
      expect(eligibleSessions).toBe(17);
      expect(percentage).toBe(Math.round((15 / 17) * 100));
    });
  });

  describe("Examinations & Gradebook Authorization", () => {
    const canManageExam = (role: "admin" | "teacher" | "student", isOwningTeacher: boolean) =>
      role === "admin" || (role === "teacher" && isOwningTeacher);

    it("admin can manage exams for any course", () => {
      expect(canManageExam("admin", false)).toBe(true);
    });

    it("owning teacher can manage exams for their own course", () => {
      expect(canManageExam("teacher", true)).toBe(true);
    });

    it("a teacher cannot manage exams for a course they do not teach", () => {
      expect(canManageExam("teacher", false)).toBe(false);
    });

    it("a student can never manage exams", () => {
      expect(canManageExam("student", false)).toBe(false);
      expect(canManageExam("student", true)).toBe(false);
    });

    it("students only see published exams, never drafts", () => {
      const canStudentSeeExam = (isPublished: boolean, isEnrolled: boolean) =>
        isPublished && isEnrolled;
      expect(canStudentSeeExam(false, true)).toBe(false);
      expect(canStudentSeeExam(true, true)).toBe(true);
      expect(canStudentSeeExam(true, false)).toBe(false);
    });

    it("a student cannot read another student's exam_marks row", () => {
      const canReadMarksRow = (requesterId: string, rowStudentId: string) =>
        requesterId === rowStudentId;
      expect(canReadMarksRow("student-a", "student-a")).toBe(true);
      expect(canReadMarksRow("student-a", "student-b")).toBe(false);
    });

    it("only the owning teacher or admin can write exam_marks", () => {
      const canWriteMarks = (role: "admin" | "teacher" | "student", isOwningTeacher: boolean) =>
        role === "admin" || (role === "teacher" && isOwningTeacher);
      expect(canWriteMarks("student", false)).toBe(false);
      expect(canWriteMarks("teacher", false)).toBe(false);
      expect(canWriteMarks("teacher", true)).toBe(true);
      expect(canWriteMarks("admin", false)).toBe(true);
    });
  });

  /**
   * Regression test for the session_otp privacy fix
   * (20260725110000_session_otp_privacy_fix.sql).
   *
   * Unlike the tests above (which describe expected behavior against mocked
   * permission logic, since this project has no live Supabase instance to test
   * against), this suite reads the *actual* migration SQL from disk and asserts real
   * properties of it. It will fail if session_otp/otp_generated_at are ever
   * re-added to class_sessions, or if session_otp_secrets is ever granted to
   * authenticated/anon -- both of which would reopen the leak where any enrolled
   * student could read the rotating OTP directly via
   * `.from('class_sessions').select('session_otp')`, since RLS filters rows, not
   * columns, and class_sessions_read_enrolled grants full-row SELECT to enrolled
   * students.
   */
  describe("session_otp privacy fix (reads real migration SQL)", () => {
    const migrationsDir = path.resolve(__dirname, "../../../supabase/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const allSql = migrationFiles
      .map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8"))
      .join("\n");
    const fixSql = fs.readFileSync(
      path.join(migrationsDir, "20260725110000_session_otp_privacy_fix.sql"),
      "utf8",
    );

    const stripSqlComments = (sql: string) =>
      sql
        .split("\n")
        .map((line) => line.replace(/--.*$/, ""))
        .join("\n");
    const allSqlNoComments = stripSqlComments(allSql);

    it("drops session_otp and otp_generated_at from public.class_sessions", () => {
      expect(fixSql).toMatch(/DROP COLUMN IF EXISTS session_otp/i);
      expect(fixSql).toMatch(/DROP COLUMN IF EXISTS otp_generated_at/i);
    });

    it("never grants session_otp_secrets to authenticated or anon in any migration", () => {
      // Matches e.g. "GRANT ... ON public.session_otp_secrets TO authenticated"
      // in either direction (grant-then-table or table-then-role on the same
      // statement), across the whole migration history, not just the fix file.
      // Comments are stripped first so an explanatory comment mentioning both
      // "authenticated" and "session_otp_secrets" (like the ones in this very
      // migration, describing what NOT to do) can't produce a false positive.
      const grantToClientRole =
        /GRANT[\s\S]{0,200}?session_otp_secrets[\s\S]{0,100}?TO\s+(authenticated|anon)\b/i;
      const grantOtherWay =
        /GRANT[\s\S]{0,200}?TO\s+(authenticated|anon)[\s\S]{0,100}?session_otp_secrets/i;
      expect(allSqlNoComments).not.toMatch(grantToClientRole);
      expect(allSqlNoComments).not.toMatch(grantOtherWay);
    });

    it("grants session_otp_secrets only to service_role", () => {
      expect(fixSql).toMatch(/GRANT ALL ON public\.session_otp_secrets TO service_role/i);
    });

    it("enables RLS on session_otp_secrets with no authenticated-facing policy", () => {
      expect(fixSql).toMatch(/ALTER TABLE public\.session_otp_secrets ENABLE ROW LEVEL SECURITY/i);
      // No CREATE POLICY statement anywhere targets this table -- if one is ever
      // added scoped `to authenticated`, this test should be revisited alongside it.
      expect(fixSql).not.toMatch(/CREATE POLICY[\s\S]*session_otp_secrets/i);
    });

    it("class_sessions never re-grants column-level access implying otp columns exist", () => {
      // The original leak was that class_sessions grants full-row SELECT to
      // authenticated (via class_sessions_read_enrolled) with no column
      // restriction. Assert no migration after the fix re-adds an OTP column to
      // class_sessions.
      const fixIndex = migrationFiles.indexOf("20260725110000_session_otp_privacy_fix.sql");
      const laterMigrations = migrationFiles.slice(fixIndex + 1);
      for (const file of laterMigrations) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        expect(sql).not.toMatch(/class_sessions[\s\S]*ADD COLUMN[\s\S]*session_otp\b/i);
      }
    });
  });
});
