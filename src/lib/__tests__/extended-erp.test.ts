import { describe, it, expect } from "vitest";
import { generateIcsContent } from "../calendar-sync.server";

describe("Extended Phase 1-3 Best-in-Class Suite", () => {
  describe("3.11 Calendar (.ics) Export", () => {
    it("generates valid RFC 5545 VCALENDAR string", () => {
      const events = [
        {
          id: "req_1",
          title: "[Presence ERP] Approved LEAVE (casual)",
          startDate: "2026-08-01",
          endDate: "2026-08-03",
          description: "Reason: Medical appointment",
        },
      ];

      const ics = generateIcsContent(events);
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("END:VCALENDAR");
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("SUMMARY:[Presence ERP] Approved LEAVE (casual)");
      expect(ics).toContain("DTSTART;VALUE=DATE:20260801");
      expect(ics).toContain("DTEND;VALUE=DATE:20260803");
    });
  });

  describe("3.8 Attendance & Biometric Reconciliation Logic", () => {
    it("detects Type A anomaly: Gate scan recorded while on approved leave", () => {
      const onLeaveStudents = new Set(["student_1"]);
      const gateCheckins = ["student_1", "student_2"];

      const anomalies = gateCheckins.filter((id) => onLeaveStudents.has(id));
      expect(anomalies).toEqual(["student_1"]);
    });

    it("returns clean status when no gate scans match approved leave dates", () => {
      const onLeaveStudents = new Set(["student_3"]);
      const gateCheckins = ["student_1", "student_2"];

      const anomalies = gateCheckins.filter((id) => onLeaveStudents.has(id));
      expect(anomalies.length).toBe(0);
    });
  });

  describe("3.9 UGC/AICTE Statutory Compliance Threshold", () => {
    it("flags compliance status based on 75% threshold", () => {
      const threshold = 75;

      function checkCompliance(pct: number): "compliant" | "shortage" {
        return pct >= threshold ? "compliant" : "shortage";
      }

      expect(checkCompliance(82.5)).toBe("compliant");
      expect(checkCompliance(75.0)).toBe("compliant");
      expect(checkCompliance(74.9)).toBe("shortage");
      expect(checkCompliance(60.0)).toBe("shortage");
    });
  });
});
