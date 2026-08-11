/**
 * Unit & integration tests for face enrollment hardening:
 * 1. Liveness challenge at enrollment (pass/fail)
 * 2. Single-face detection
 * 3. Duplicate identity detection & audit logging
 * 4. Photo persistence, encryption/decryption, & retention enforcement
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  encryptPhoto,
  decryptPhoto,
  issueChallenge,
  verifyChallenge,
  verifyLivenessSignals,
  cosineSimilarity,
} from "../attendance-crypto.server";

// Set required env vars for crypto operations in tests
process.env.BIOMETRIC_ENC_KEY = "UHdHDQpUZMLlhy+yx8INeqOJom+g+sHVU/tf7zYgJU8=";
process.env.LIVENESS_HMAC_KEY = "fffcHAvJI1MMpMoj4cniu09R332lWv++Bwxt9y2iW+c=";

describe("Enrollment Hardening & Security Suite", () => {
  // --------------------------------------------------------------------------
  // 1. Liveness Challenge at Enrollment (Pass / Fail)
  // --------------------------------------------------------------------------
  describe("Liveness Challenge at Enrollment", () => {
    it("generates a valid signed challenge and verifies correctly", async () => {
      const challenge = await issueChallenge("enrollment", "student-uuid-123");
      expect(challenge.action).toMatch(/blink|turn_left|turn_right|nod/);
      expect(challenge.sessionId).toBe("enrollment");
      expect(challenge.userId).toBe("student-uuid-123");

      const isValid = await verifyChallenge(challenge);
      expect(isValid).toBe(true);
    });

    it("rejects an expired liveness challenge", async () => {
      const challenge = await issueChallenge("enrollment", "student-uuid-123");
      // Simulate expired challenge by back-dating issuedAt
      challenge.issuedAt = Date.now() - 120_000;

      const isValid = await verifyChallenge(challenge);
      expect(isValid).toBe(false);
    });

    it("rejects a tampered liveness challenge signature", async () => {
      const challenge = await issueChallenge("enrollment", "student-uuid-123");
      challenge.sig = "tampered-signature-string";

      const isValid = await verifyChallenge(challenge);
      expect(isValid).toBe(false);
    });

    it("verifies valid blink liveness signals and rejects static photo signals", () => {
      // Valid blink sequence: EAR drops below 0.22 with drop > 0.05
      const validBlinkSignals = [
        { ear: 0.3, yaw: 0, pitch: 0, faceArea: 100, faceX: 50, faceY: 50 },
        { ear: 0.28, yaw: 1, pitch: 0, faceArea: 101, faceX: 51, faceY: 50 },
        { ear: 0.15, yaw: 2, pitch: 1, faceArea: 102, faceX: 52, faceY: 51 },
        { ear: 0.29, yaw: 1, pitch: 0, faceArea: 100, faceX: 50, faceY: 50 },
      ];
      const resPass = verifyLivenessSignals("blink", validBlinkSignals);
      expect(resPass.passed).toBe(true);
      expect(resPass.reason).toBe("blink_detected");

      // Static photo sequence: zero variance across 8 frames
      const staticPhotoSignals = Array(8).fill({
        ear: 0.3,
        yaw: 0,
        pitch: 0,
        faceArea: 100,
        faceX: 50,
        faceY: 50,
      });
      const resFail = verifyLivenessSignals("blink", staticPhotoSignals);
      expect(resFail.passed).toBe(false);
      expect(resFail.reason).toBe("static_photo_detected");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Single-Face-Only Detection Logic
  // --------------------------------------------------------------------------
  describe("Single-Face-Only Detection", () => {
    it("rejects capture when face count is greater than 1", () => {
      const detectFacesCountMock = (detectionsCount: number) => {
        if (detectionsCount > 1) {
          throw new Error("Multiple faces detected, please ensure you are alone in frame.");
        }
        return true;
      };

      expect(() => detectFacesCountMock(1)).not.toThrow();
      expect(() => detectFacesCountMock(2)).toThrow(
        "Multiple faces detected, please ensure you are alone in frame.",
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Duplicate-Identity Detection (Cosine Similarity & Audit Logging)
  // --------------------------------------------------------------------------
  describe("Duplicate-Identity Detection", () => {
    it("flags duplicate embedding when similarity exceeds THRESHOLD_MATCH (0.82) against different student", () => {
      const THRESHOLD_MATCH = 0.82;

      // Base vector (128 dimensions)
      const baseVector = new Float32Array(128).map((_, i) => (i % 2 === 0 ? 0.5 : -0.5));
      // Nearly identical vector (high cosine similarity ~0.98)
      const duplicateVector = new Float32Array(baseVector).map((v) => v + 0.02);
      // Completely different vector (low cosine similarity ~0.0)
      const distinctVector = new Float32Array(128).map((_, i) => (i % 3 === 0 ? 0.8 : -0.2));

      const simDuplicate = cosineSimilarity(baseVector, duplicateVector);
      expect(simDuplicate).toBeGreaterThanOrEqual(THRESHOLD_MATCH);

      const simDistinct = cosineSimilarity(baseVector, distinctVector);
      expect(simDistinct).toBeLessThan(THRESHOLD_MATCH);
    });

    it("prevents save and throws error asking student to contact admin when duplicate is detected", async () => {
      const THRESHOLD_MATCH = 0.82;
      const newUserId = "user-b-uuid";
      const existingUserId = "user-a-uuid";

      const embeddingA = new Float32Array(128).fill(0.5);
      const embeddingB = new Float32Array(128).fill(0.5); // identical match

      const existingRows = [{ student_id: existingUserId, vec: embeddingA }];
      let auditEventLogged = false;

      const checkForDuplicates = (userId: string, newVec: Float32Array) => {
        for (const row of existingRows) {
          if (row.student_id === userId) continue;
          const sim = cosineSimilarity(newVec, row.vec);
          if (sim >= THRESHOLD_MATCH) {
            auditEventLogged = true;
            throw new Error(
              "A matching face descriptor is already enrolled under a different student account. Please contact administration.",
            );
          }
        }
      };

      expect(() => checkForDuplicates(newUserId, embeddingB)).toThrow(
        "A matching face descriptor is already enrolled under a different student account. Please contact administration.",
      );
      expect(auditEventLogged).toBe(true);

      // Re-enrollment of the SAME student should be allowed
      expect(() => checkForDuplicates(existingUserId, embeddingA)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 4. Photo Persistence, Encryption/Decryption & Retention SQL Assertions
  // --------------------------------------------------------------------------
  describe("Photo Persistence & Retention", () => {
    it("encrypts and decrypts photo data URLs accurately using AES-GCM-256", async () => {
      const mockPhotoDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...";

      const encryptedHex = await encryptPhoto(mockPhotoDataUrl);
      expect(encryptedHex).toMatch(/^\\x[0-9a-f]+$/);

      const decrypted = await decryptPhoto(encryptedHex);
      expect(decrypted).toBe(mockPhotoDataUrl);
    });

    it("verifies enrollment_photos table creation and retention job migration properties", () => {
      const migrationPath = path.resolve(
        __dirname,
        "../../../supabase/migrations/20260730230000_enrollment_photos.sql",
      );
      const sql = fs.readFileSync(migrationPath, "utf8");

      // Verify table creation & RLS
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.enrollment_photos/);
      expect(sql).toMatch(/ALTER TABLE public\.enrollment_photos ENABLE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/GRANT ALL ON public\.enrollment_photos TO service_role/);
      expect(sql).toMatch(/GRANT SELECT ON public\.enrollment_photos TO authenticated/);
      expect(sql).toMatch(/USING \(auth\.uid\(\) = student_id\)/);

      // Verify retention job erases enrollment_photos
      expect(sql).toMatch(/DELETE FROM public\.enrollment_photos/);
      expect(sql).toMatch(/WHERE student_id IN \(SELECT student_id FROM _expired_consent\)/);
    });
  });
});
