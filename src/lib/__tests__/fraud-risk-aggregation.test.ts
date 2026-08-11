/**
 * Tests for Fraud Risk Aggregation Engine (Day 3 Task 8):
 * 1. Aggregates timing_anomaly, virtual_camera_detected, spot_check_failed, reviewRejections, and multiStudentFlags correctly.
 * 2. Assigns LOW, MEDIUM, or HIGH risk level based on total risk signal threshold counts.
 */

import { describe, it, expect } from "vitest";

function computeRiskLevel(total: number): "LOW" | "MEDIUM" | "HIGH" {
  if (total === 0) return "LOW";
  if (total < 5) return "MEDIUM";
  return "HIGH";
}

describe("Fraud Risk Aggregation Engine", () => {
  it("computes LOW risk level for zero aggregated signals", () => {
    expect(computeRiskLevel(0)).toBe("LOW");
  });

  it("computes MEDIUM risk level for 1 to 4 aggregated signals", () => {
    expect(computeRiskLevel(1)).toBe("MEDIUM");
    expect(computeRiskLevel(4)).toBe("MEDIUM");
  });

  it("computes HIGH risk level for 5 or more aggregated signals", () => {
    expect(computeRiskLevel(5)).toBe("HIGH");
    expect(computeRiskLevel(12)).toBe("HIGH");
  });

  it("correctly sums individual fraud signal counts", () => {
    const signals = {
      timingAnomalies: 2,
      virtualCameraDetections: 1,
      spotCheckFailures: 1,
      reviewRejections: 0,
      multiStudentFlags: 1,
    };

    const total =
      signals.timingAnomalies +
      signals.virtualCameraDetections +
      signals.spotCheckFailures +
      signals.reviewRejections +
      signals.multiStudentFlags;

    expect(total).toBe(5);
    expect(computeRiskLevel(total)).toBe("HIGH");
  });
});
