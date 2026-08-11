import { describe, it, expect } from "vitest";
import { generateStudentIdCardToken, generateStudentIdCardData } from "../id-card.server";
import { simulateDependencyFailure } from "../chaos-resilience.server";

describe("Phase 8 Hardening, Compliance & Operations Test Suite", () => {
  // Biometric retention coverage moved to biometric-retention-policy.test.ts, with a real
  // mocked Supabase client -- the previous test here called the function with NO db mock at
  // all and asserted on the zeroed defaults the try/catch fell back to, which passed whether
  // or not the query logic was correct. See that file's header comment for why.
  describe("8.6 Student ID Card Generation Engine", () => {
    it("generates student ID card QR token with HMAC signature", () => {
      const token = generateStudentIdCardToken("student_123");
      expect(token).toContain("student_123:");
      const parts = token.split(":");
      expect(parts.length).toBe(3);
    });

    it("generates complete student ID card data structure", async () => {
      const card = await generateStudentIdCardData("stud_999", {
        displayName: "Rohan Sharma",
        rollNo: "CS2026-042",
        departmentName: "Computer Science",
        programName: "B.Tech Computer Science",
      });

      expect(card.displayName).toBe("Rohan Sharma");
      expect(card.rollNo).toBe("CS2026-042");
      expect(card.verificationQrToken).toBeDefined();
    });
  });

  describe("8.2 Chaos Engineering & Degradation Engine", () => {
    it("simulates dependency failure and returns graceful fallback route", async () => {
      const rekognitionChaos = await simulateDependencyFailure("aws_rekognition");
      expect(rekognitionChaos.fallbackTriggered).toBe("hmac_fallback_challenge");

      const emailChaos = await simulateDependencyFailure("resend_email");
      expect(emailChaos.fallbackTriggered).toBe("sms_whatsapp_dispatcher");
    });
  });
});
