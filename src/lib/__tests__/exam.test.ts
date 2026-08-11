import { describe, it, expect } from "vitest";
import { resolveGrade, type GradeBand } from "../exam.functions";

const STANDARD_BANDS: GradeBand[] = [
  { letter: "O", min_percent: 90, max_percent: 100, grade_point: 10, is_passing: true },
  { letter: "A+", min_percent: 80, max_percent: 89.99, grade_point: 9, is_passing: true },
  { letter: "A", min_percent: 70, max_percent: 79.99, grade_point: 8, is_passing: true },
  { letter: "B+", min_percent: 60, max_percent: 69.99, grade_point: 7, is_passing: true },
  { letter: "B", min_percent: 50, max_percent: 59.99, grade_point: 6, is_passing: true },
  { letter: "C", min_percent: 45, max_percent: 49.99, grade_point: 5, is_passing: true },
  { letter: "P", min_percent: 40, max_percent: 44.99, grade_point: 4, is_passing: true },
  { letter: "F", min_percent: 0, max_percent: 39.99, grade_point: 0, is_passing: false },
];

describe("Grade Resolution (resolveGrade)", () => {
  it("resolves a perfect score to the top band", () => {
    expect(resolveGrade(100, STANDARD_BANDS)?.letter).toBe("O");
  });

  it("resolves a boundary value to the correct band (90 -> O, not A+)", () => {
    expect(resolveGrade(90, STANDARD_BANDS)?.letter).toBe("O");
    expect(resolveGrade(89.99, STANDARD_BANDS)?.letter).toBe("A+");
  });

  it("resolves a mid-range percentage correctly", () => {
    expect(resolveGrade(65, STANDARD_BANDS)?.letter).toBe("B+");
  });

  it("resolves a failing percentage to F and marks it not passing", () => {
    const grade = resolveGrade(20, STANDARD_BANDS);
    expect(grade?.letter).toBe("F");
    expect(grade?.is_passing).toBe(false);
  });

  it("resolves the exact pass boundary (40) to P, and just below to F", () => {
    expect(resolveGrade(40, STANDARD_BANDS)?.letter).toBe("P");
    expect(resolveGrade(39.99, STANDARD_BANDS)?.letter).toBe("F");
  });

  it("returns null for a percentage outside all bands", () => {
    expect(resolveGrade(150, STANDARD_BANDS)).toBeNull();
    expect(resolveGrade(-5, STANDARD_BANDS)).toBeNull();
  });

  it("returns null when given an empty band list", () => {
    expect(resolveGrade(75, [])).toBeNull();
  });
});

describe("Weighted Percentage Calculation", () => {
  // Mirrors the logic in getMyExamResults: weighted average of each exam's
  // percentage, weighted by that exam's weightage_percent, re-normalized by
  // the total weight of exams that actually have a recorded percentage.
  type ExamLike = { percentage: number | null; weightagePercent: number };

  function weightedPercentage(exams: ExamLike[]): number | null {
    const totalWeight = exams.reduce(
      (sum, e) => sum + (e.percentage !== null ? e.weightagePercent : 0),
      0,
    );
    if (totalWeight === 0) return null;
    return exams.reduce(
      (sum, e) =>
        sum + (e.percentage !== null ? (e.percentage * e.weightagePercent) / totalWeight : 0),
      0,
    );
  }

  it("computes a simple single-exam weighted percentage as just that exam's percentage", () => {
    expect(weightedPercentage([{ percentage: 80, weightagePercent: 100 }])).toBe(80);
  });

  it("computes a weighted average across two exams with different weights", () => {
    // 50% weighted at 30, 90% weighted at 70 -> (50*30 + 90*70) / 100 = 78
    const result = weightedPercentage([
      { percentage: 50, weightagePercent: 30 },
      { percentage: 90, weightagePercent: 70 },
    ]);
    expect(result).toBeCloseTo(78, 5);
  });

  it("renormalizes weight when some exams have no marks yet (percentage null)", () => {
    // Only the graded exam counts; its weight becomes 100% of the total considered.
    const result = weightedPercentage([
      { percentage: 60, weightagePercent: 50 },
      { percentage: null, weightagePercent: 50 }, // not yet graded
    ]);
    expect(result).toBe(60);
  });

  it("returns null when no exams have been graded yet", () => {
    expect(
      weightedPercentage([
        { percentage: null, weightagePercent: 50 },
        { percentage: null, weightagePercent: 50 },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty exam list", () => {
    expect(weightedPercentage([])).toBeNull();
  });
});

describe("Backlog Detection Threshold", () => {
  // Mirrors listBacklogs: a student is a backlog for a course if their
  // weighted percentage falls below the lowest is_passing band's min_percent.
  const passThreshold = Math.min(
    ...STANDARD_BANDS.filter((b) => b.is_passing).map((b) => b.min_percent),
  );

  it("computes the pass threshold as 40 for the standard scale", () => {
    expect(passThreshold).toBe(40);
  });

  it("flags a student below the pass threshold as backlog", () => {
    expect(35 < passThreshold).toBe(true);
  });

  it("does not flag a student exactly at the pass threshold", () => {
    expect(40 < passThreshold).toBe(false);
  });

  it("does not flag a comfortably passing student", () => {
    expect(75 < passThreshold).toBe(false);
  });
});

describe("Marks Entry Validation", () => {
  // Mirrors bulkEnterMarks: every non-absent row must have marks in [0, maxMarks].
  function isValidEntry(
    entry: { isAbsent: boolean; marksObtained: number | null },
    maxMarks: number,
  ) {
    if (entry.isAbsent) return true;
    return (
      entry.marksObtained !== null && entry.marksObtained >= 0 && entry.marksObtained <= maxMarks
    );
  }

  it("accepts a valid in-range mark", () => {
    expect(isValidEntry({ isAbsent: false, marksObtained: 45 }, 50)).toBe(true);
  });

  it("accepts marks at the exact maximum", () => {
    expect(isValidEntry({ isAbsent: false, marksObtained: 50 }, 50)).toBe(true);
  });

  it("rejects marks exceeding the maximum", () => {
    expect(isValidEntry({ isAbsent: false, marksObtained: 51 }, 50)).toBe(false);
  });

  it("rejects a null mark for a present student", () => {
    expect(isValidEntry({ isAbsent: false, marksObtained: null }, 50)).toBe(false);
  });

  it("allows a null mark when the student is marked absent", () => {
    expect(isValidEntry({ isAbsent: true, marksObtained: null }, 50)).toBe(true);
  });
});
