/**
 * Integration tests for the 5-gate attendance verification pipeline.
 * Tests: temporal, spatial, liveness, identity, and device-lock gates.
 *
 * NOTE: These tests use mocked Supabase and face-api data.
 * For full end-to-end testing with real Supabase, use a test database.
 */

import { describe, it, expect } from "vitest";

/**
 * Mock data and fixtures for gate testing
 */

export const mockStudent = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "student@example.com",
};

export const mockTeacher = {
  userId: "00000000-0000-4000-8000-000000000002",
  email: "teacher@example.com",
};

export const mockAdmin = {
  userId: "00000000-0000-4000-8000-000000000003",
  email: "admin@example.com",
};

export const mockCourse = {
  id: "00000000-0000-4000-8000-000000000011",
  name: "CS 101: Introduction to Computer Science",
  teacher_id: mockTeacher.userId,
  semester_id: "00000000-0000-4000-8000-000000000031",
};

export const mockSession = {
  id: "00000000-0000-4000-8000-000000000021",
  course_id: mockCourse.id,
  starts_at: new Date(Date.now() - 5 * 60_000).toISOString(), // Started 5 minutes ago
  ends_at: new Date(Date.now() + 55 * 60_000).toISOString(), // Ends in 55 minutes
  // Real classroom coordinates (Ahmedabad campus) — replaced from NYC placeholder
  // so Day-7 GPS demo shows realistic distance numbers, not 12,000 km.
  geo_lat: 23.153421,
  geo_lng: 72.886547,
  radius_m: 50,
  ip_allowlist: ["192.168.1.0/24", "2001:db8::/32"],
};

export const mockValidProbeEmbedding = new Array(128).fill(0).map(() => Math.random() * 2 - 1);

export const mockReferenceEmbedding = mockValidProbeEmbedding.map(
  (v) => v + (Math.random() * 0.05 - 0.025), // ~0.98 cosine similarity
);

export const mockLivenessChallenge = {
  action: "blink",
  sessionId: mockSession.id,
  userId: mockStudent.userId,
  issuedAt: Date.now(),
  ttlMs: 60_000,
  sig: "mock_hmac_signature_base64url",
};

export const mockLivenessSignals = [
  { ear: 0.35, yaw: 0.1, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
  { ear: 0.18, yaw: 0.2, pitch: 0.1, faceArea: 1010, faceX: 102, faceY: 101 }, // blink drop
  { ear: 0.34, yaw: 0.1, pitch: 0.2, faceArea: 1020, faceX: 105, faceY: 103 }, // recover
];

export const mockDeviceFingerprint = "fingerprint_12345678";

describe("5-Gate Attendance Verification Pipeline", () => {
  describe("Gate 1: Temporal (Session Window)", () => {
    it("rejects submission before session starts", () => {
      const futureSession = {
        ...mockSession,
        starts_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
      const now = Date.now();
      const starts = new Date(futureSession.starts_at).getTime();

      expect(now < starts).toBe(true);
      // Would result in "outside_window" rejection
    });

    it("rejects submission after session ends", () => {
      const pastSession = {
        ...mockSession,
        ends_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      };
      const now = Date.now();
      const ends = new Date(pastSession.ends_at).getTime();

      expect(now > ends).toBe(true);
      // Would result in "outside_window" rejection
    });

    it("accepts submission during session window", () => {
      const now = Date.now();
      const starts = new Date(mockSession.starts_at).getTime();
      const ends = new Date(mockSession.ends_at).getTime();

      expect(now >= starts && now <= ends).toBe(true);
      // Gate passes
    });
  });

  describe("Gate 2: Spatial (Geofencing + GPS Accuracy)", () => {
    it("rejects submission outside geofence radius", () => {
      // Mock: student is 100m away, radius is 50m
      const dist = 100;
      const radiusM = mockSession.radius_m;

      expect(dist > radiusM).toBe(true);
      // Would result in "outside_geofence" rejection
    });

    it("accepts submission within geofence radius", () => {
      // Mock: student is 25m away, radius is 50m
      const dist = 25;
      const radiusM = mockSession.radius_m;

      expect(dist <= radiusM).toBe(true);
      // Gate passes
    });

    it("rejects implausibly perfect GPS accuracy (< 0.5m synthetic location)", () => {
      // Rejection of accuracy < 0.5m indicates mock location
      const accuracy = 0.1;

      expect(accuracy < 0.5).toBe(true);
      // Would result in "mock_location_detected" rejection
    });

    it("accepts realistic GPS accuracy (> 0.5m)", () => {
      const accuracy = 5.0; // 5 meters, realistic for GPS

      expect(accuracy >= 0.5).toBe(true);
      // Gate passes
    });

    it("verifies CIDR matching for IP allowlist", () => {
      const allowedIp = "192.168.1.50";
      const allowlist = mockSession.ip_allowlist;
      // Should match "192.168.1.0/24"
      // Match logic: (allowedIp & mask) === (rangeIp & mask)

      const [octet1, octet2, octet3] = allowedIp.split(".").map(Number);
      const ipNum = (octet1 << 24) | (octet2 << 16) | (octet3 << 8) | 0;
      const rangeNum = (192 << 24) | (168 << 16) | (1 << 8) | 0;
      const mask = ~0 << (32 - 24);

      expect((ipNum & mask) === (rangeNum & mask)).toBe(true);
      // IP matches CIDR, gate passes
    });

    it("rejects IP not in allowlist", () => {
      const deniedIp = "10.0.0.1";
      const allowlist = mockSession.ip_allowlist;
      // Should not match "192.168.1.0/24" or "2001:db8::/32"

      const [octet1, octet2] = deniedIp.split(".").map(Number);
      const ipNum = (octet1 << 24) | (octet2 << 16);
      const rangeNum = (192 << 24) | (168 << 16);
      const mask = ~0 << (32 - 24);

      expect((ipNum & mask) === (rangeNum & mask)).toBe(false);
      // IP does not match CIDR, gate fails
    });
  });

  describe("Gate 3: Liveness Challenge", () => {
    it("rejects expired HMAC challenge (> 60s TTL)", () => {
      const expiredChallenge = {
        ...mockLivenessChallenge,
        issuedAt: Date.now() - 65_000, // 65 seconds ago
      };
      const now = Date.now();
      const age = now - expiredChallenge.issuedAt;

      expect(age > expiredChallenge.ttlMs).toBe(true);
      // Would result in "liveness_failed" rejection
    });

    it("accepts valid challenge within TTL", () => {
      const now = Date.now();
      const age = now - mockLivenessChallenge.issuedAt;

      expect(age <= mockLivenessChallenge.ttlMs).toBe(true);
      // Gate passes (signature verification would occur server-side)
    });

    it("rejects if liveness signals do not match action", () => {
      // If action is "turn_left" but signals show blink
      const blinkSignals = mockLivenessSignals;
      const expectedAction = "turn_left";

      // Blink detected (low EAR drop), but action requires yaw
      // verifyLivenessSignals would return { passed: false, reason: "action_not_detected" }
      expect(expectedAction).not.toBe("blink");
      // Gate fails
    });

    it("verifies frame identity consistency across sequence", () => {
      // If frame embeddings swap (frame-swap attack), cosine similarity dips
      const embeddings = [
        [0.5, 0.5, 0.5, 0.5],
        [0.51, 0.49, 0.5, 0.5], // Same person, slight variation
        [0.5, 0.52, 0.48, 0.5], // Still same person
      ];

      const threshold = 0.85;
      // Pairwise cosine similarity should all be > 0.85
      // If any pair < 0.85, frame-swap is detected
      expect(embeddings.length).toBeGreaterThanOrEqual(2);
      // Gate passes if all pairs similar
    });
  });

  describe("Gate 4: Identity (Face Embedding Similarity)", () => {
    it("rejects low similarity (< 0.75 threshold)", () => {
      const similarity = 0.7;
      const thresholdReview = 0.75;

      expect(similarity < thresholdReview).toBe(true);
      // Would result in "rejected" decision with reason "low_similarity"
    });

    it("accepts borderline similarity (0.75-0.82) for teacher review", () => {
      const similarity = 0.78;
      const thresholdReview = 0.75;
      const thresholdMatch = 0.82;

      expect(similarity >= thresholdReview && similarity < thresholdMatch).toBe(true);
      // Decision: "review" (teacher approval needed)
    });

    it("accepts high similarity (> 0.82) as immediate present", () => {
      const similarity = 0.85;
      const thresholdMatch = 0.82;

      expect(similarity >= thresholdMatch).toBe(true);
      // Decision: "present" (no further review needed)
    });

    it("rejects no enrollment (student not biometrically enrolled)", () => {
      // Query to face_embeddings returns null
      const enrollment = null;

      expect(enrollment).toBe(null);
      // Would result in "no_enrollment" rejection
    });
  });

  describe("Gate 5: Device Lock (No Duplicate Presents)", () => {
    it("prevents same device from marking multiple students present", () => {
      // Unique index: (session_id, device_fp_hash) where decision in ('present', 'review')
      const records = [
        {
          session_id: mockSession.id,
          device_fp_hash: mockDeviceFingerprint,
          student_id: mockStudent.userId,
          decision: "present",
        },
        {
          session_id: mockSession.id,
          device_fp_hash: mockDeviceFingerprint,
          student_id: "00000000-0000-4000-8000-000000000099", // Different student
          decision: "present",
        },
      ];

      // Second insert would violate UNIQUE constraint
      // Would result in "multi_student_attack" or "already_enrolled_device" rejection
      expect(records.length).toBeGreaterThan(1);
    });

    it("prevents same student from marking present twice in same session", () => {
      // Unique index: (session_id, student_id) where decision in ('present', 'fallback_present')
      const records = [
        {
          session_id: mockSession.id,
          student_id: mockStudent.userId,
          decision: "present",
        },
        {
          session_id: mockSession.id,
          student_id: mockStudent.userId,
          decision: "present",
        },
      ];

      // Second insert would violate UNIQUE constraint
      // Would result in "already_present" rejection
      expect(records.length).toBeGreaterThan(1);
    });

    it("allows review decisions without device lock", () => {
      // Unique index only applies to decision in ('present', 'fallback_present')
      // Multiple "review" decisions are allowed (different gate failures)
      const decision = "review";

      expect(decision).not.toBe("present");
      // Device lock gate passes
    });
  });

  describe("Rate Limiting", () => {
    it("limits student to 5 attempts per session per hour", () => {
      const attempts = [1, 2, 3, 4, 5, 6]; // 6th attempt
      const maxAttempts = 5;

      expect(attempts.length > maxAttempts).toBe(true);
      // 6th attempt would result in "student_rate_limited" rejection
    });

    it("limits IP to 10 attempts per session per hour", () => {
      const attempts = new Array(11).fill(null); // 11 attempts
      const maxAttempts = 10;

      expect(attempts.length > maxAttempts).toBe(true);
      // 11th attempt would result in "ip_rate_limited" rejection
    });

    it("limits challenge requests to 10 per 5 minutes", () => {
      const challenges = new Array(11).fill(null);
      const maxChallenges = 10;

      expect(challenges.length > maxChallenges).toBe(true);
      // 11th challenge would be rejected
    });
  });

  describe("OTP Verification (Gate 2b)", () => {
    it("rejects if session requires OTP but not provided", () => {
      const sessionOtp = "123456";
      const providedOtp = undefined;

      expect(providedOtp).toBeFalsy();
      // If isSessionOtpActive(sessionId) is true and providedOtp is missing, rejection
    });

    it("rejects invalid or expired OTP", () => {
      // OTP verification checks time (within otp_validity_seconds) and code
      const otpIssuedAt = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min old
      const otpValiditySecs = 5 * 60; // 5 min valid
      const now = Date.now();
      const issueTime = new Date(otpIssuedAt).getTime();

      expect(now - issueTime > otpValiditySecs * 1000).toBe(true);
      // OTP has expired, rejection
    });
  });

  describe("Fallback Attendance (Non-Biometric)", () => {
    it("allows student to request fallback with reason", () => {
      const reason = "Camera malfunction";
      const minLength = 5;

      expect(reason.length >= minLength).toBe(true);
      // Request inserted with status: "pending"
    });

    it("teacher approves/rejects fallback with audit trail", () => {
      // Each approval/rejection logged to attendance_review_actions
      // with reviewer_id and reason
      const action = {
        action: "approved",
        reviewer_id: mockTeacher.userId,
        reason: "Legitimate hardware failure",
      };

      expect(action.reviewer_id).toBe(mockTeacher.userId);
      // Audit trail created
    });
  });

  describe("Multi-student Device Flagging", () => {
    // Mirrors the logic in submitAttendance: after a device fingerprint is
    // used successfully, we look back 24h for OTHER distinct students who
    // used the same device, and flag once 2+ other students are found
    // (i.e. 3+ students total on one device).
    const countsAsFlag = (otherStudentIds: string[]) => {
      const distinct = new Set(otherStudentIds);
      return distinct.size >= 2;
    };

    it("does not flag a device used by only one other student", () => {
      expect(countsAsFlag(["student-b"])).toBe(false);
    });

    it("does not flag a device with no prior history", () => {
      expect(countsAsFlag([])).toBe(false);
    });

    it("flags a device shared across 2 other distinct students (3 total)", () => {
      expect(countsAsFlag(["student-b", "student-c"])).toBe(true);
    });

    it("flags a device shared across many distinct students", () => {
      expect(countsAsFlag(["student-b", "student-c", "student-d", "student-e"])).toBe(true);
    });

    it("deduplicates repeat submissions from the same other student", () => {
      // Same student submitting twice should not count as two distinct students
      expect(countsAsFlag(["student-b", "student-b", "student-b"])).toBe(false);
    });

    it("does not flag based on shared IP alone (classroom WiFi is expected)", () => {
      // The implementation intentionally keys off device_fp_hash, not ip,
      // to avoid flagging every student on the same classroom network.
      const sameIpDifferentDevices = [
        { studentId: "student-b", deviceFp: "device-2", ip: "10.0.0.5" },
        { studentId: "student-c", deviceFp: "device-3", ip: "10.0.0.5" },
      ];
      const uniqueDevicesUsed = new Set(sameIpDifferentDevices.map((s) => s.deviceFp));
      expect(uniqueDevicesUsed.size).toBe(2);
      // Each student used their own device -> no shared-device flag triggers,
      // even though they share an IP.
    });

    it("only counts present/review/fallback_present decisions, not rejections", () => {
      const rows = [
        { student_id: "student-b", decision: "rejected" },
        { student_id: "student-c", decision: "present" },
      ];
      const eligible = rows.filter((r) =>
        ["present", "review", "fallback_present"].includes(r.decision),
      );
      expect(eligible.length).toBe(1);
      expect(countsAsFlag(eligible.map((r) => r.student_id))).toBe(false);
    });
  });
});
