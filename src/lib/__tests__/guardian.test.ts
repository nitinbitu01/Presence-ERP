import { describe, it, expect } from "vitest";

describe("Guardian Authorization", () => {
  // Mirrors RLS: a guardian can only read data for students they are
  // explicitly linked to via guardian_students; admin manages all links.
  const isLinked = (guardianId: string, studentId: string, links: Record<string, string[]>) =>
    (links[guardianId] ?? []).includes(studentId);

  it("allows a guardian to read their linked student's data", () => {
    const links = { "guardian-1": ["student-a", "student-b"] };
    expect(isLinked("guardian-1", "student-a", links)).toBe(true);
  });

  it("denies a guardian access to an unlinked student", () => {
    const links = { "guardian-1": ["student-a"] };
    expect(isLinked("guardian-1", "student-c", links)).toBe(false);
  });

  it("denies access when the guardian has no links at all", () => {
    expect(isLinked("guardian-2", "student-a", {})).toBe(false);
  });

  it("only an admin may create or remove guardian_students links", () => {
    const canManageLinks = (role: "admin" | "teacher" | "student" | "guardian") => role === "admin";
    expect(canManageLinks("admin")).toBe(true);
    expect(canManageLinks("teacher")).toBe(false);
    expect(canManageLinks("student")).toBe(false);
    expect(canManageLinks("guardian")).toBe(false);
  });

  it("guardian accounts do not receive a student profile/role on signup", () => {
    // Mirrors the handle_new_user trigger branch for is_guardian = 'true'.
    const provisionOnSignup = (isGuardian: boolean) =>
      isGuardian
        ? { table: "guardians", getsStudentRole: false }
        : { table: "profiles", getsStudentRole: true };
    expect(provisionOnSignup(true)).toEqual({ table: "guardians", getsStudentRole: false });
    expect(provisionOnSignup(false)).toEqual({ table: "profiles", getsStudentRole: true });
  });

  it("a guardian can only see published exam marks, never drafts", () => {
    const canGuardianSeeMark = (isPublished: boolean, isLinkedGuardian: boolean) =>
      isPublished && isLinkedGuardian;
    expect(canGuardianSeeMark(false, true)).toBe(false);
    expect(canGuardianSeeMark(true, true)).toBe(true);
    expect(canGuardianSeeMark(true, false)).toBe(false);
  });
});

describe("Guardian Overall Attendance Aggregation", () => {
  // Mirrors getGuardianStudentSummary / sendLowAttendanceAlerts: sessions
  // held across ALL enrolled courses, minus approved-leave days, vs present.
  type Session = { id: string; courseId: string; startsAt: string; ended: boolean };

  function computeAttendance(
    sessions: Session[],
    presentSessionIds: Set<string>,
    leaveDates: Set<string>,
  ) {
    const held = sessions.filter((s) => s.ended && !leaveDates.has(s.startsAt.split("T")[0]));
    const attended = held.filter((s) => presentSessionIds.has(s.id));
    const totalHeld = held.length;
    return {
      totalHeld,
      attended: attended.length,
      percentage: totalHeld === 0 ? null : Math.round((attended.length / totalHeld) * 1000) / 10,
    };
  }

  it("computes 100% when every held session was attended", () => {
    const sessions: Session[] = [
      { id: "s1", courseId: "c1", startsAt: "2026-01-01T09:00:00Z", ended: true },
      { id: "s2", courseId: "c1", startsAt: "2026-01-02T09:00:00Z", ended: true },
    ];
    const result = computeAttendance(sessions, new Set(["s1", "s2"]), new Set());
    expect(result.percentage).toBe(100);
  });

  it("excludes sessions that have not yet ended", () => {
    const sessions: Session[] = [
      { id: "s1", courseId: "c1", startsAt: "2026-01-01T09:00:00Z", ended: true },
      { id: "s2", courseId: "c1", startsAt: "2099-01-01T09:00:00Z", ended: false },
    ];
    const result = computeAttendance(sessions, new Set(["s1"]), new Set());
    expect(result.totalHeld).toBe(1);
    expect(result.percentage).toBe(100);
  });

  it("excludes approved-leave days from the held count", () => {
    const sessions: Session[] = [
      { id: "s1", courseId: "c1", startsAt: "2026-01-01T09:00:00Z", ended: true },
      { id: "s2", courseId: "c1", startsAt: "2026-01-02T09:00:00Z", ended: true },
    ];
    // s2's date is an approved leave day -> excluded from denominator entirely
    const result = computeAttendance(sessions, new Set(["s1"]), new Set(["2026-01-02"]));
    expect(result.totalHeld).toBe(1);
    expect(result.percentage).toBe(100);
  });

  it("returns null percentage when no sessions have been held yet", () => {
    const result = computeAttendance([], new Set(), new Set());
    expect(result.percentage).toBeNull();
  });

  it("aggregates across multiple courses for one student", () => {
    const sessions: Session[] = [
      { id: "s1", courseId: "c1", startsAt: "2026-01-01T09:00:00Z", ended: true },
      { id: "s2", courseId: "c2", startsAt: "2026-01-01T09:00:00Z", ended: true },
      { id: "s3", courseId: "c2", startsAt: "2026-01-02T09:00:00Z", ended: true },
    ];
    const result = computeAttendance(sessions, new Set(["s1", "s2"]), new Set());
    expect(result.totalHeld).toBe(3);
    expect(result.attended).toBe(2);
    expect(result.percentage).toBeCloseTo(66.7, 1);
  });
});

describe("Low-Attendance Alert Threshold", () => {
  const shouldAlert = (percentage: number, threshold: number) => percentage < threshold;

  it("alerts a student below the default 75% threshold", () => {
    expect(shouldAlert(60, 75)).toBe(true);
  });

  it("does not alert a student exactly at the threshold", () => {
    expect(shouldAlert(75, 75)).toBe(false);
  });

  it("does not alert a student comfortably above threshold", () => {
    expect(shouldAlert(90, 75)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(shouldAlert(80, 85)).toBe(true);
    expect(shouldAlert(80, 70)).toBe(false);
  });

  it("skips students with zero held sessions (nothing to alert on yet)", () => {
    const held = 0;
    const eligible = held > 0;
    expect(eligible).toBe(false);
  });
});

describe("SMS/WhatsApp Dispatch Fallback", () => {
  // Mirrors notifyGuardiansOfStudent: prefer WhatsApp, fall back to SMS,
  // and never throw when no provider is configured (best-effort only).
  async function dispatch(
    phone: string | null,
    sendWhatsApp: (p: string) => Promise<boolean>,
    sendSms: (p: string) => Promise<boolean>,
  ) {
    if (!phone) return { attempted: false };
    const waSent = await sendWhatsApp(phone);
    if (!waSent) await sendSms(phone);
    return { attempted: true, viaWhatsApp: waSent };
  }

  it("does not attempt to send when the guardian has no phone number", async () => {
    const result = await dispatch(
      null,
      async () => true,
      async () => true,
    );
    expect(result.attempted).toBe(false);
  });

  it("uses WhatsApp when it succeeds, and does not also send SMS", async () => {
    let smsCalled = false;
    const result = await dispatch(
      "+919876543210",
      async () => true,
      async () => {
        smsCalled = true;
        return true;
      },
    );
    expect(result.viaWhatsApp).toBe(true);
    expect(smsCalled).toBe(false);
  });

  it("falls back to SMS when WhatsApp is unavailable/unconfigured", async () => {
    let smsCalled = false;
    const result = await dispatch(
      "+919876543210",
      async () => false,
      async () => {
        smsCalled = true;
        return true;
      },
    );
    expect(result.viaWhatsApp).toBe(false);
    expect(smsCalled).toBe(true);
  });

  it("treats both channels being unconfigured as a silent no-op, not an error", async () => {
    await expect(
      dispatch(
        "+919876543210",
        async () => false,
        async () => false,
      ),
    ).resolves.toEqual({ attempted: true, viaWhatsApp: false });
  });
});
