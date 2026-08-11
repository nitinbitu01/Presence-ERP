import { describe, it, expect } from "vitest";
import { computeTrustScore } from "../trust-score.server";

describe("Trust Score Calculator", () => {
  it("computes 100/100 score for perfect verification signals", () => {
    const gateReasons = {
      spatial: { ok: true, distance_m: 0 },
      deviceAttestation: { ok: true },
      network: { ok: true },
      temporal: { ok: true, drift_ms: 0 },
      otp: { ok: true },
    };
    const result = computeTrustScore(gateReasons, 1.0);
    expect(result.total).toBe(100);
    expect(result.components.length).toBe(6);
  });

  it("handles missing/partial gate signals gracefully", () => {
    const gateReasons = {
      spatial: { ok: false, distance_m: 100 },
    };
    const result = computeTrustScore(gateReasons, 0.6);
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThan(100);
  });
});
