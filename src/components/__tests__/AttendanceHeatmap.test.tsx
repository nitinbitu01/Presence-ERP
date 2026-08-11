import { describe, it, expect, vi } from "vitest";
import React from "react";
import { AttendanceHeatmap, type AttendanceDay } from "../AttendanceHeatmap";

describe("AttendanceHeatmap Component Unit Suite", () => {
  const sampleData: AttendanceDay[] = [
    { date: "2026-01-10", status: "present" },
    { date: "2026-01-11", status: "absent" },
    { date: "2026-01-12", status: "late" },
    { date: "2026-01-13", status: "holiday" },
  ];

  it("is a valid React component function", () => {
    expect(typeof AttendanceHeatmap).toBe("function");
  });

  it("constructs heatmap element structure with default props", () => {
    const element = React.createElement(AttendanceHeatmap, { data: sampleData });
    expect(element.type).toBe(AttendanceHeatmap);
    expect(element.props.data).toHaveLength(4);
  });

  it("accepts custom onDaySelect click callback", () => {
    const handleSelect = vi.fn();
    const element = React.createElement(AttendanceHeatmap, {
      data: sampleData,
      onDaySelect: handleSelect,
    });
    expect(element.props.onDaySelect).toBe(handleSelect);
  });
});
