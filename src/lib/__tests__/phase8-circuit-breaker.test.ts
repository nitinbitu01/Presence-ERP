import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Supabase client for unit tests
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        lt: () => Promise.resolve({ count: 0 }),
      }),
      delete: () => ({
        lt: () => Promise.resolve({ count: 0 }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}));

import {
  withCircuitBreaker,
  getAllCircuitStatuses,
  getCircuitStatus,
  resetCircuit,
  simulateDependencyFailure,
} from "../chaos-resilience.server";
import { captureError, getBufferedErrorCount } from "../error-observability";
import {
  verifyIdCardToken,
  generateStudentIdCardToken,
  generateIdCardHTML,
} from "../id-card.server";

describe("Phase 8 Production Hardening", () => {
  describe("Circuit Breaker State Machine", () => {
    beforeEach(() => {
      resetCircuit("resend_email");
    });

    it("starts in CLOSED state", () => {
      const status = getCircuitStatus("resend_email");
      expect(status.state).toBe("CLOSED");
    });

    it("transitions to OPEN after failure threshold", async () => {
      const failFn = async () => {
        throw new Error("Email service down");
      };
      const fallback = async () => "fallback_result";
      // Trip the circuit (default threshold = 5)
      for (let i = 0; i < 5; i++) {
        await withCircuitBreaker("resend_email", failFn, fallback, {
          failureThreshold: 5,
          cooldownMs: 100,
          successThreshold: 2,
        });
      }
      const status = getCircuitStatus("resend_email");
      expect(status.state).toBe("OPEN");
    });

    it("uses fallback when circuit is OPEN", async () => {
      const failFn = async () => {
        throw new Error("Down");
      };
      const fallback = async () => "sms_fallback";
      // Open the circuit first
      for (let i = 0; i < 5; i++) {
        await withCircuitBreaker("resend_email", failFn, fallback, {
          failureThreshold: 5,
          cooldownMs: 100,
          successThreshold: 2,
        });
      }
      const { usedFallback, circuitState } = await withCircuitBreaker(
        "resend_email",
        failFn,
        fallback,
        { failureThreshold: 5, cooldownMs: 100, successThreshold: 2 },
      );
      expect(usedFallback).toBe(true);
      expect(circuitState).toBe("OPEN");
    });

    it("returns all circuit statuses", () => {
      const statuses = getAllCircuitStatuses();
      expect(statuses.length).toBeGreaterThanOrEqual(6);
      expect(statuses.every((s) => ["CLOSED", "OPEN", "HALF_OPEN"].includes(s.state))).toBe(true);
    });

    it("resets circuit to CLOSED on manual reset", async () => {
      // Open it
      const failFn = async () => {
        throw new Error("Down");
      };
      const fallback = async () => "x";
      for (let i = 0; i < 5; i++) {
        await withCircuitBreaker("resend_email", failFn, fallback, {
          failureThreshold: 5,
          cooldownMs: 100,
          successThreshold: 2,
        });
      }
      resetCircuit("resend_email");
      expect(getCircuitStatus("resend_email").state).toBe("CLOSED");
    });

    it("backwards-compatible simulateDependencyFailure returns fallback", async () => {
      const result = await simulateDependencyFailure("aws_rekognition");
      expect(result.fallbackTriggered).toBe("hmac_fallback_challenge");
      expect(result.simulatedFailure).toBe(true);
    });
  });

  describe("Error Observability Engine", () => {
    it("captures error and returns structured entry", () => {
      const entry = captureError("Test error", {
        severity: "warning",
        route: "/test",
        action: "test_action",
      });
      expect(entry.message).toBe("Test error");
      expect(entry.severity).toBe("warning");
      expect(entry.route).toBe("/test");
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.timestamp).toBe("string");
    });

    it("buffers errors for batch submission", () => {
      const before = getBufferedErrorCount();
      captureError("Buffered error", { severity: "info" });
      expect(getBufferedErrorCount()).toBeGreaterThan(before);
    });
  });

  describe("ID Card Verification", () => {
    it("generates a valid token and verifies it successfully", () => {
      const studentId = "stud_verify_test";
      const token = generateStudentIdCardToken(studentId, "test_secret");
      const result = verifyIdCardToken(token, "test_secret");
      expect(result.valid).toBe(true);
      expect(result.studentId).toBe(studentId);
    });

    it("rejects tampered token", () => {
      const token = generateStudentIdCardToken("stud_123", "test_secret");
      const tampered = token.replace(token.slice(-6), "aaaaaa");
      const result = verifyIdCardToken(tampered, "test_secret");
      expect(result.valid).toBe(false);
    });

    it("generates valid HTML ID card", async () => {
      const { generateStudentIdCardData } = await import("../id-card.server");
      const card = await generateStudentIdCardData("stud_html", {
        displayName: "Arjun Mehta",
        rollNo: "CS2026-001",
        departmentName: "Computer Science",
        programName: "B.Tech CSE",
      });
      const html = generateIdCardHTML(card);
      expect(html).toContain("Arjun Mehta");
      expect(html).toContain("CS2026-001");
      expect(html).toContain("DOCTYPE html");
    });
  });
});
