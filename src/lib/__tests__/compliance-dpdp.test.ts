import { describe, it, expect } from "vitest";
import { calculateAge } from "../compliance.server";

describe("DPDP Act 2023 & Legal Compliance Suite", () => {
  describe("calculateAge", () => {
    it("correctly identifies minor status for students under 18", () => {
      const minorDob = "2010-05-15";
      const adultDob = "2002-08-10";

      expect(calculateAge(minorDob)).toBeLessThan(18);
      expect(calculateAge(adultDob)).toBeGreaterThanOrEqual(18);
    });
  });
});
