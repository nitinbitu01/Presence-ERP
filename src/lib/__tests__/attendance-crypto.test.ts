import { describe, it, expect } from "vitest";
import {
  matchCidr,
  cosineSimilarity,
  computeEAR,
  estimateHeadPose,
  verifyLivenessSignals,
  verifyFrameIdentityConsistency,
} from "../attendance-crypto.server";

describe("CIDR Matcher", () => {
  it("matches valid IPv4 CIDRs correctly", () => {
    expect(matchCidr("192.168.1.50", "192.168.1.0/24")).toBe(true);
    expect(matchCidr("192.168.2.50", "192.168.1.0/24")).toBe(false);
    expect(matchCidr("10.0.0.1", "10.0.0.0/8")).toBe(true);
    expect(matchCidr("172.16.0.1", "10.0.0.0/8")).toBe(false);
  });

  it("handles exact IP matching without CIDR prefix", () => {
    expect(matchCidr("192.168.1.1", "192.168.1.1")).toBe(true);
    expect(matchCidr("192.168.1.2", "192.168.1.1")).toBe(false);
  });

  it("matches IPv6 CIDRs correctly", () => {
    expect(matchCidr("2001:db8:abcd:0012::1", "2001:db8:abcd::/48")).toBe(true);
    expect(matchCidr("2001:db8:ffff:0012::1", "2001:db8:abcd::/48")).toBe(false);
  });
});

describe("Cosine Similarity", () => {
  it("computes exact match as 1.0", () => {
    const vecA = new Float32Array([1, 2, 3, 4]);
    const vecB = new Float32Array([1, 2, 3, 4]);
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 4);
  });

  it("computes orthogonal vectors as 0.0", () => {
    const vecA = new Float32Array([1, 0]);
    const vecB = new Float32Array([0, 1]);
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0, 4);
  });

  it("returns -1 for mismatched lengths", () => {
    const vecA = new Float32Array([1, 2]);
    const vecB = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(vecA, vecB)).toBe(-1);
  });
});

describe("Liveness Signal Trajectory Analysis", () => {
  it("rejects static photos with low spatial variance", () => {
    const staticSignals = new Array(10).fill({
      ear: 0.3,
      yaw: 0.1,
      pitch: 0.1,
      faceArea: 1000,
      faceX: 100,
      faceY: 100,
    });
    const result = verifyLivenessSignals("blink", staticSignals);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("static_photo_detected");
  });

  it("detects valid blink action", () => {
    const blinkSignals = [
      { ear: 0.35, yaw: 0.1, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.18, yaw: 0.2, pitch: 0.1, faceArea: 1010, faceX: 102, faceY: 101 }, // blink drop
      { ear: 0.34, yaw: 0.1, pitch: 0.2, faceArea: 1020, faceX: 105, faceY: 103 }, // recover
    ];
    const result = verifyLivenessSignals("blink", blinkSignals);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("blink_detected");
  });

  it("detects valid turn_left action", () => {
    const turnLeftSignals = [
      { ear: 0.3, yaw: 0.0, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: -12.0, pitch: 0.1, faceArea: 1050, faceX: 110, faceY: 105 },
      { ear: 0.3, yaw: -18.0, pitch: 0.1, faceArea: 1100, faceX: 120, faceY: 110 },
    ];
    const result = verifyLivenessSignals("turn_left", turnLeftSignals);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("turn_left_detected");
  });

  // ---- NEGATIVE-CASE TESTS (§1.1 security audit) ----
  // These tests assert REJECTION when the requested action was NOT performed.
  // The original code had no negative-case tests — only positive-case tests
  // ("a real turn passes"), which is why the no-op bug shipped undetected.

  it("rejects blink when eyes stay open (no EAR drop)", () => {
    const noBlink = [
      { ear: 0.35, yaw: 0.1, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.34, yaw: 0.2, pitch: 0.1, faceArea: 1010, faceX: 102, faceY: 101 },
      { ear: 0.36, yaw: 0.1, pitch: 0.2, faceArea: 1020, faceX: 105, faceY: 103 },
    ];
    const result = verifyLivenessSignals("blink", noBlink);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("blink_not_detected");
  });

  it("rejects turn_left when head stays facing forward (yaw ≈ 0)", () => {
    const noTurn = [
      { ear: 0.3, yaw: 0.0, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: 1.0, pitch: 0.1, faceArea: 1050, faceX: 110, faceY: 105 },
      { ear: 0.3, yaw: -2.0, pitch: 0.1, faceArea: 1100, faceX: 120, faceY: 110 },
    ];
    const result = verifyLivenessSignals("turn_left", noTurn);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("turn_left_not_detected");
  });

  it("rejects turn_right when head actually turns LEFT", () => {
    const wrongDirection = [
      { ear: 0.3, yaw: 0.0, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: -15.0, pitch: 0.1, faceArea: 1050, faceX: 110, faceY: 105 },
      { ear: 0.3, yaw: -20.0, pitch: 0.1, faceArea: 1100, faceX: 120, faceY: 110 },
    ];
    const result = verifyLivenessSignals("turn_right", wrongDirection);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("turn_right_not_detected");
  });

  it("rejects nod when head pitch stays flat", () => {
    const noNod = [
      { ear: 0.3, yaw: 0.0, pitch: 0.0, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: 0.5, pitch: 1.0, faceArea: 1050, faceX: 110, faceY: 105 },
      { ear: 0.3, yaw: 0.0, pitch: 2.0, faceArea: 1100, faceX: 120, faceY: 110 },
    ];
    const result = verifyLivenessSignals("nod", noNod);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("nod_not_detected");
  });

  it("rejects turn_right with only 1 frame (insufficient for delta)", () => {
    const singleFrame = [
      { ear: 0.3, yaw: 15.0, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
    ];
    const result = verifyLivenessSignals("turn_right", singleFrame);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("insufficient_frames");
  });

  it("detects valid turn_right action", () => {
    const turnRight = [
      { ear: 0.3, yaw: 0.0, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: 14.0, pitch: 0.1, faceArea: 1050, faceX: 110, faceY: 105 },
    ];
    const result = verifyLivenessSignals("turn_right", turnRight);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("turn_right_detected");
  });

  it("detects valid nod action", () => {
    const nod = [
      { ear: 0.3, yaw: 0.0, pitch: 0.0, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: 0.5, pitch: 10.0, faceArea: 1050, faceX: 110, faceY: 105 },
    ];
    const result = verifyLivenessSignals("nod", nod);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("nod_detected");
  });

  it("rejects static photo with only 2 signals (widened from >= 3)", () => {
    const twoStatic = [
      { ear: 0.3, yaw: 0.1, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
      { ear: 0.3, yaw: 0.1, pitch: 0.1, faceArea: 1000, faceX: 100, faceY: 100 },
    ];
    const result = verifyLivenessSignals("blink", twoStatic);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("static_photo_detected");
  });

  it("verifies frame sequence identity consistency", () => {
    const samePerson = [
      [0.5, 0.5, 0.5, 0.5],
      [0.51, 0.49, 0.5, 0.5],
      [0.5, 0.52, 0.48, 0.5],
    ];
    expect(verifyFrameIdentityConsistency(samePerson, 0.85)).toBe(true);

    const frameSwapAttempt = [
      [0.5, 0.5, 0.5, 0.5],
      [-0.5, -0.5, -0.5, -0.5], // completely different person swapped in frame
    ];
    expect(verifyFrameIdentityConsistency(frameSwapAttempt, 0.85)).toBe(false);
  });
});
