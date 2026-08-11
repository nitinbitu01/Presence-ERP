import { describe, it, expect } from "vitest";
import {
  calculateNetLeaveDuration,
  applyAttendanceRounding,
} from "../academic-calendar.server";
import { computeLeaveBalanceCarryForward } from "../leave-policy.server";

describe("Academic Domain & Leave Policy Engine", () => {
  describe("calculateNetLeaveDuration", () => {
    it("calculates exact calendar days for a standard weekday leave", () => {
      // Mon 2026-08-10 to Wed 2026-08-12
      const result = calculateNetLeaveDuration({
        startDate: "2026-08-10",
        endDate: "2026-08-12",
        excludeSundays: true,
      });

      expect(result.totalCalendarDays).toBe(3);
      expect(result.excludedSundaysCount).toBe(0);
      expect(result.netLeaveDays).toBe(3);
    });

    it("automatically excludes Sundays from leave consumption", () => {
      // Sat 2026-08-08 to Mon 2026-08-10 (includes Sun 2026-08-09)
      const result = calculateNetLeaveDuration({
        startDate: "2026-08-08",
        endDate: "2026-08-10",
        excludeSundays: true,
      });

      expect(result.totalCalendarDays).toBe(3);
      expect(result.excludedSundaysCount).toBe(1);
      expect(result.netLeaveDays).toBe(2);
      expect(result.validLeaveDates).toEqual(["2026-08-08", "2026-08-10"]);
    });

    it("automatically excludes official institutional holidays", () => {
      // Mon 2026-08-10 to Fri 2026-08-14 with Independence Day Eve holiday on 2026-08-14
      const result = calculateNetLeaveDuration({
        startDate: "2026-08-10",
        endDate: "2026-08-14",
        holidays: ["2026-08-14"],
        excludeSundays: true,
      });

      expect(result.totalCalendarDays).toBe(5);
      expect(result.excludedHolidaysCount).toBe(1);
      expect(result.netLeaveDays).toBe(4);
    });

    it("correctly handles half-day leave (0.5 days)", () => {
      const result = calculateNetLeaveDuration({
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        isHalfDay: true,
        halfDayType: "am",
      });

      expect(result.netLeaveDays).toBe(0.5);
      expect(result.totalCalendarDays).toBe(1);
    });
  });

  describe("applyAttendanceRounding", () => {
    it("applies nearest_integer policy", () => {
      expect(applyAttendanceRounding(74.4, "nearest_integer")).toBe(74);
      expect(applyAttendanceRounding(74.5, "nearest_integer")).toBe(75);
    });

    it("applies half_percent_up policy", () => {
      expect(applyAttendanceRounding(74.1, "half_percent_up")).toBe(74.5);
      expect(applyAttendanceRounding(74.6, "half_percent_up")).toBe(75.0);
    });

    it("applies ceil policy", () => {
      expect(applyAttendanceRounding(74.1, "ceil")).toBe(75);
    });

    it("applies none policy (1 decimal place default)", () => {
      expect(applyAttendanceRounding(74.34, "none")).toBe(74.3);
    });
  });

  describe("computeLeaveBalanceCarryForward", () => {
    it("caps carry-forward at maximum allowed days and records lapsed days", () => {
      // 15 allocated, 3 consumed => 12 unused. Max carry-forward = 5.
      const result = computeLeaveBalanceCarryForward(15, 3, 5);

      expect(result.carryForwardDays).toBe(5);
      expect(result.lapsedDays).toBe(7);
      expect(result.remainingDays).toBe(12);
    });
  });
});
