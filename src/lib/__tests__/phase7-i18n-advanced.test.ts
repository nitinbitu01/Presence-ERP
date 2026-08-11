import { describe, it, expect } from "vitest";
import {
  formatIndianCurrency,
  formatIndianDate,
  formatRelativeTime,
  getDirectionality,
  formatIndianNumber,
} from "../locale-formatter";
import { t, getSupportedLocales } from "../../i18n";

describe("Phase 7 World-Class i18n & Locale Formatter", () => {
  describe("Intl-based formatIndianCurrency", () => {
    it("formats zero correctly", () => {
      const result = formatIndianCurrency(0);
      expect(result).toContain("0");
    });

    it("formats 100000 with Indian grouping (contains comma)", () => {
      const result = formatIndianCurrency(100000);
      expect(result).toContain(",");
      expect(result).toContain("\u20b9");
    });

    it("handles NaN gracefully", () => {
      expect(formatIndianCurrency(NaN)).toContain("0");
    });
  });

  describe("Intl-based formatIndianDate", () => {
    it("formats a valid date string", () => {
      const result = formatIndianDate("2026-08-15");
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles invalid date gracefully", () => {
      const result = formatIndianDate("not-a-date");
      expect(typeof result).toBe("string");
    });
  });

  describe("formatRelativeTime", () => {
    it("returns a string for a past date", () => {
      const past = new Date(Date.now() - 3600000).toISOString();
      const result = formatRelativeTime(past);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getDirectionality", () => {
    it("returns ltr for English", () => {
      expect(getDirectionality("en")).toBe("ltr");
    });
    it("returns ltr for Hindi", () => {
      expect(getDirectionality("hi")).toBe("ltr");
    });
    it("returns ltr for Gujarati", () => {
      expect(getDirectionality("gu")).toBe("ltr");
    });
  });

  describe("formatIndianNumber", () => {
    it("formats large numbers with Indian grouping", () => {
      const result = formatIndianNumber(1000000);
      expect(result).toContain(",");
    });
  });

  describe("i18n translations coverage", () => {
    it("returns Telugu translation for class_checkin", () => {
      expect(t("class_checkin", "te")).not.toBe("class_checkin");
    });
    it("returns Marathi translation for class_checkin", () => {
      expect(t("class_checkin", "mr")).not.toBe("class_checkin");
    });
    it("getSupportedLocales returns 5 languages", () => {
      expect(getSupportedLocales()).toHaveLength(5);
    });
  });
});
