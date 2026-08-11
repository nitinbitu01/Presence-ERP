import { describe, it, expect } from "vitest";
import {
  calculateInstitutionalHealthScore,
  getExecutiveKpis,
  getDropoutRiskStudents,
} from "../executive-dashboard.server";

describe("Phase E Executive Dashboard & Predictive Analytics Engine", () => {
  describe("calculateInstitutionalHealthScore", () => {
    it("calculates high health score for high attendance and low proxy risk", () => {
      const score = calculateInstitutionalHealthScore(90, 0, 0.02);
      expect(score).toBeGreaterThan(80);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("applies penalties for proxy risk and high at-risk percentage", () => {
      const score = calculateInstitutionalHealthScore(70, 10, 0.25);
      expect(score).toBeLessThan(70);
    });
  });

  describe("Server Function Exports", () => {
    it("exports getExecutiveKpis function", () => {
      expect(typeof getExecutiveKpis).toBe("function");
    });

    it("exports getDropoutRiskStudents function", () => {
      expect(typeof getDropoutRiskStudents).toBe("function");
    });
  });
});
