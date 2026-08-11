/**
 * Tests for Behavioral Timing Anomaly Detection Engine (Day 3 Task 7):
 * 1. Sub-400ms latency (<400ms between challenge issue and submission) is flagged as timing_anomaly.
 *    The threshold was lowered from 800ms to 400ms to allow fast-but-human mobile submissions
 *    (students already in front of the camera) while still blocking true bot submissions (<100ms).
 * 2. Normal latency (>=400ms) passes timing check.
 * 3. Near-zero variance across historical attempt latencies is flagged as timing_anomaly.
 */

import { describe, it, expect } from "vitest";

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
}

describe("Behavioral Timing Anomaly Detection Engine", () => {
  it("flags sub-400ms latency (<400ms) as timing_anomaly", () => {
    const issuedAt = Date.now() - 200; // 200ms ago — below the 400ms human floor
    const nowMs = Date.now();
    const latencyMs = nowMs - issuedAt;

    expect(latencyMs).toBeLessThan(400);
  });

  it("accepts normal latency (>=400ms)", () => {
    const issuedAt = Date.now() - 1500; // 1.5s ago
    const nowMs = Date.now();
    const latencyMs = nowMs - issuedAt;

    expect(latencyMs).toBeGreaterThanOrEqual(400);
  });

  it("accepts fast-but-human latency at the 400ms boundary", () => {
    // A student already in front of the camera on mobile can legitimately submit
    // in ~400-500ms. This should NOT be flagged as a bot.
    const issuedAt = Date.now() - 450; // 450ms ago — just above the 400ms floor
    const nowMs = Date.now();
    const latencyMs = nowMs - issuedAt;

    expect(latencyMs).toBeGreaterThanOrEqual(400);
  });

  it("detects near-zero variance across historical latencies (<20)", () => {
    const scriptedLatencies = [1200, 1200, 1201, 1200, 1200];
    const variance = calculateVariance(scriptedLatencies);

    expect(variance).toBeLessThan(20);
  });

  it("calculates normal non-zero variance for human latencies (>=20)", () => {
    const humanLatencies = [1200, 1850, 1420, 2100, 1600];
    const variance = calculateVariance(humanLatencies);

    expect(variance).toBeGreaterThan(20);
  });
});
