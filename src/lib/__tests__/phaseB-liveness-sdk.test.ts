import { describe, it, expect, vi } from "vitest";

// Mock Supabase client for liveness tests
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve({ data: null }),
          }),
          not: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: null }),
              }),
            }),
          }),
          neq: () => Promise.resolve({ data: [] }),
        }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}));

import {
  assertLiveness,
  startLivenessSession,
  verifyLivenessSessionResult,
  detectImpossibleTravel,
  detectDescriptorReuse,
  generateLivenessActionSequence,
  verifyActionSequenceTimestamps,
  computeReferenceFrameSha256,
  analyzeFacialDepthMap,
  detectScreenMoirePattern,
  computeTemporalLivenessFusionScore,
  detectDeepfakeArtifacts,
} from "../liveness-sdk.server";

describe("Phase B Server-Side Liveness Attestation Engine (AWS Rekognition / PAD Level 2)", () => {
  describe("assertLiveness function", () => {
    it("is an executable function", () => {
      expect(typeof assertLiveness).toBe("function");
    });

    it("bypasses liveness verification for webauthn_bypass prefixed session IDs", async () => {
      const method = await assertLiveness("webauthn_bypass:usr_123", "usr_123");
      expect(method).toBe("webauthn_bypass");
    });

    it("handles hmac fallback prefixed session IDs cleanly", async () => {
      const method = await assertLiveness("hmac:test_token_uuid", "usr_456");
      expect(method).toBe("hmac_fallback");
    });
  });

  describe("startLivenessSession server function", () => {
    it("is exported as a server function", () => {
      expect(typeof startLivenessSession).toBe("function");
    });
  });

  describe("verifyLivenessSessionResult confidence threshold evaluator", () => {
    it("evaluates liveness confidence >= 85 as live pass", () => {
      const res = verifyLivenessSessionResult(88.5);
      expect(res.isLive).toBe(true);
      expect(res.confidence).toBe(88.5);
    });

    it("evaluates liveness confidence < 85 as live failure", () => {
      const res = verifyLivenessSessionResult(62.0);
      expect(res.isLive).toBe(false);
      expect(res.reason).toContain("below the 85% threshold");
    });
  });

  describe("3D Facial Depth Map Variance Analysis", () => {
    it("validates 3D head landmark depth variance", () => {
      const landmarks3D = [
        { x: 10, y: 20, z: 0.1 },
        { x: 15, y: 25, z: 0.8 },
        { x: 20, y: 30, z: -0.5 },
        { x: 25, y: 35, z: 0.4 },
        { x: 30, y: 40, z: -0.2 },
      ];
      const res = analyzeFacialDepthMap(landmarks3D);
      expect(res.is3DFace).toBe(true);
      expect(res.depthVariance).toBeGreaterThan(0.02);
    });

    it("detects flat 2D photo/screen presentation attack", () => {
      const flatLandmarks = [
        { x: 10, y: 20, z: 0.01 },
        { x: 15, y: 25, z: 0.01 },
        { x: 20, y: 30, z: 0.01 },
        { x: 25, y: 35, z: 0.01 },
        { x: 30, y: 40, z: 0.01 },
      ];
      const res = analyzeFacialDepthMap(flatLandmarks);
      expect(res.is3DFace).toBe(false);
      expect(res.reason).toContain("Low pseudo-depth variance");
    });
  });

  describe("High-Frequency Screen Moiré Pattern Detector", () => {
    it("detects digital display lattice grid noise", () => {
      const screenPixels = [10, 80, 10, 80, 10, 80, 10, 80, 10, 80, 10, 80, 10, 80, 10, 80];
      const res = detectScreenMoirePattern(screenPixels);
      expect(res.isDigitalScreen).toBe(true);
      expect(res.moireConfidence).toBeGreaterThan(50);
    });
  });

  describe("Generative AI Deepfake Artifact Detector", () => {
    it("flags deepfake smoothing when gradient variance is artificially flat", () => {
      const flatGradients = [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001];
      const res = detectDeepfakeArtifacts(flatGradients);
      expect(res.isDeepfake).toBe(true);
      expect(res.smoothingConfidence).toBeGreaterThan(90);
    });

    it("passes natural skin gradient maps", () => {
      const naturalGradients = [0.12, 0.45, 0.88, 0.23, 0.67, 0.91, 0.34, 0.56];
      const res = detectDeepfakeArtifacts(naturalGradients);
      expect(res.isDeepfake).toBe(false);
    });
  });

  describe("Multi-Frame Temporal Liveness Fusion Score", () => {
    it("computes exponential moving average over 10 confidence frames", () => {
      const confidences = [85, 90, 88, 92, 94, 91, 95, 93, 96, 95];
      const score = computeTemporalLivenessFusionScore(confidences);
      expect(score).toBeGreaterThan(85);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("Dynamic Action Sequence Challenge & HMAC Signatures", () => {
    it("generates 3 randomized action steps with HMAC signature", async () => {
      const challenge = await generateLivenessActionSequence("sess_action_123", "usr_challenge_1");
      expect(challenge.steps).toHaveLength(3);
      expect(challenge.sig.length).toBeGreaterThan(10);

      const isValid = await verifyActionSequenceTimestamps(challenge, "usr_challenge_1");
      expect(isValid).toBe(true);
    });
  });

  describe("Reference Frame SHA-256 Anti-Tamper Integrity", () => {
    it("computes deterministic SHA-256 digest of captured camera frame", async () => {
      const hash1 = await computeReferenceFrameSha256("frame_base64_payload_test");
      const hash2 = await computeReferenceFrameSha256("frame_base64_payload_test");
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe("Anti-Spoofing Anomaly Detection Helpers", () => {
    it("detects impossible travel anomalies", async () => {
      const res = await detectImpossibleTravel("usr_travel_1", 28.6139, 77.209);
      expect(res).toHaveProperty("isSuspicious");
      expect(typeof res.isSuspicious).toBe("boolean");
    });

    it("detects cross-student descriptor reuse", async () => {
      const mockVector = Array.from({ length: 128 }, () => 0.1);
      const res = await detectDescriptorReuse(mockVector, "sess_123", "usr_student_1");
      expect(res).toHaveProperty("isDuplicate");
      expect(typeof res.isDuplicate).toBe("boolean");
    });
  });
});
