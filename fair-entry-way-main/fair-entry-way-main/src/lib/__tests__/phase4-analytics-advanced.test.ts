import { describe, it, expect } from "vitest";
import {
  getCourseAttendanceSummary,
  getTeacherEngagementMetrics,
  getAttendanceStreaks,
  getCohortComparison,
} from "../analytics.server";
import { exportAttendanceCSV, exportAnalyticsReport } from "../analytics-export.server";
import { formatIndianCurrency, formatIndianDate } from "../locale-formatter";

describe("Phase 4 Advanced Analytics", () => {
  it("exports are functions", () => {
    expect(typeof getCourseAttendanceSummary).toBe("function");
    expect(typeof getTeacherEngagementMetrics).toBe("function");
    expect(typeof exportAnalyticsReport).toBe("function");
  });

  it("formatIndianCurrency formats correctly", () => {
    expect(formatIndianCurrency(100000)).toBe("₹1,00,000.00");
  });

  it("exportAttendanceCSV is a function", () => {
    expect(typeof exportAttendanceCSV).toBe("function");
  });

  it("getAttendanceStreaks is a function", () => {
    expect(typeof getAttendanceStreaks).toBe("function");
  });

  it("getCohortComparison is a function", () => {
    expect(typeof getCohortComparison).toBe("function");
  });
});
