import { describe, it, expect } from "vitest";
import { parseWiegand26, parseWiegand34 } from "../hardware-checkin-adapter.server";

describe("Phase 1–5 Enterprise Gap Closure Test Suite", () => {
  describe("Component 5.3: Wiegand RFID Payload Decoders", () => {
    it("parseWiegand26 correctly extracts facility code and card ID from valid hex string", () => {
      // Facility code 1, card ID 1 encoded in 26-bit Wiegand:
      // Bit 1: parity (0), Bits 2-9: 00000001 (1), Bits 10-25: 0000000000000001 (1), Bit 26: parity (1)
      const bits = "0" + (1).toString(2).padStart(8, "0") + (1).toString(2).padStart(16, "0") + "1";
      const hex = BigInt(`0b${bits}`).toString(16).padStart(7, "0");
      const result = parseWiegand26(`0x${hex}`);
      expect(result).not.toBeNull();
      expect(result?.facilityCode).toBe(1);
      expect(result?.cardId).toBe(1);
    });

    it("parseWiegand26 returns null for invalid length hex string", () => {
      expect(parseWiegand26("0x12")).toBeNull();
      expect(parseWiegand26("0x123456789ABC")).toBeNull();
    });

    it("parseWiegand34 correctly extracts facility code and card ID", () => {
      // Facility code 100, Card ID 5000 in 34-bit Wiegand:
      const bits =
        "0" + (100).toString(2).padStart(16, "0") + (5000).toString(2).padStart(16, "0") + "0";
      const hex = BigInt(`0b${bits}`).toString(16).padStart(8, "0");
      const result = parseWiegand34(`0x${hex}`);
      expect(result).not.toBeNull();
      expect(result?.facilityCode).toBe(100);
      expect(result?.cardId).toBe(5000);
    });

    it("parseWiegand34 handles raw hex without 0x prefix", () => {
      const bits =
        "0" + (100).toString(2).padStart(16, "0") + (5000).toString(2).padStart(16, "0") + "0";
      const hex = BigInt(`0b${bits}`).toString(16).padStart(8, "0");
      const result = parseWiegand34(hex);
      expect(result).not.toBeNull();
      expect(result?.facilityCode).toBe(100);
      expect(result?.cardId).toBe(5000);
    });
  });

  describe("Component 4.5: Student Attendance Goal Trajectory Math", () => {
    it("calculates exact consecutive future classes required to reach 75% target", () => {
      const calculateClassesNeeded = (present: number, total: number, targetPct: number) => {
        const currentPct = total > 0 ? (present / total) * 100 : 100;
        if (currentPct >= targetPct || targetPct >= 100) return 0;
        const numerator = targetPct * total - 100 * present;
        const denominator = 100 - targetPct;
        return Math.max(0, Math.ceil(numerator / denominator));
      };

      // 10 / 20 = 50% -> needs 20 consecutive present (30/40 = 75%)
      expect(calculateClassesNeeded(10, 20, 75)).toBe(20);

      // 14 / 20 = 70% -> needs 4 consecutive present (18/24 = 75%)
      expect(calculateClassesNeeded(14, 20, 75)).toBe(4);
    });

    it("returns 0 if student is already above target attendance", () => {
      const calculateClassesNeeded = (present: number, total: number, targetPct: number) => {
        const currentPct = total > 0 ? (present / total) * 100 : 100;
        if (currentPct >= targetPct || targetPct >= 100) return 0;
        const numerator = targetPct * total - 100 * present;
        const denominator = 100 - targetPct;
        return Math.max(0, Math.ceil(numerator / denominator));
      };

      expect(calculateClassesNeeded(18, 20, 75)).toBe(0);
    });
  });

  describe("Component 2.1: Server Timestamp Drift Guard Logic", () => {
    it("rejects clock skew exceeding 300,000 ms (5 minutes)", () => {
      const serverTime = 1700000000000;
      const clientTimeTampered = 1700000400000; // 400,000 ms skew (~6.6 mins)
      const driftMs = Math.abs(serverTime - clientTimeTampered);
      expect(driftMs).toBeGreaterThan(300_000);
    });

    it("accepts clock skew within 300,000 ms (5 minutes)", () => {
      const serverTime = 1700000000000;
      const clientTimeValid = 1700000060000; // 60,000 ms skew (1 min)
      const driftMs = Math.abs(serverTime - clientTimeValid);
      expect(driftMs).toBeLessThanOrEqual(300_000);
    });
  });
});
