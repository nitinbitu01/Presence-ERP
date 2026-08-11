import { describe, it, expect } from "vitest";
import { t, setLanguage, getLanguage } from "../../i18n";
import { formatIndianCurrency, formatIndianDate } from "../locale-formatter";

describe("Phase 7 Accessibility & Localization Test Suite", () => {
  describe("7.2 i18n Multi-Language Engine", () => {
    it("returns correct English translations by default", () => {
      setLanguage("en");
      expect(getLanguage()).toBe("en");
      expect(t("class_checkin")).toBe("Class Check-in");
      expect(t("my_attendance")).toBe("My Attendance");
    });

    it("returns correct Hindi translations when locale is hi", () => {
      expect(t("class_checkin", "hi")).toBe("कक्षा चेक-इन");
      expect(t("my_attendance", "hi")).toBe("मेरी उपस्थिति");
    });

    it("returns correct Gujarati translations when locale is gu", () => {
      expect(t("class_checkin", "gu")).toBe("ક્લાસ ચેક-ઈન");
      expect(t("my_attendance", "gu")).toBe("મારી હાજરી");
    });

    it("falls back to key or English string when translation key is missing", () => {
      expect(t("non_existent_key_xyz", "hi")).toBe("non_existent_key_xyz");
    });
  });

  describe("7.2 Locale Formatter (Indian Currency & Date)", () => {
    it("formats Indian numbers and currency correctly with lakhs and crores grouping", () => {
      expect(formatIndianCurrency(100000)).toBe("₹1,00,000.00");
      expect(formatIndianCurrency(15000)).toBe("₹15,000.00");
      expect(formatIndianCurrency(0)).toBe("₹0.00");
    });

    it("formats dates in DD/MM/YYYY Indian format correctly", () => {
      const formatted = formatIndianDate("2026-08-15T00:00:00.000Z");
      expect(formatted).toContain("/2026");
    });
  });
});
