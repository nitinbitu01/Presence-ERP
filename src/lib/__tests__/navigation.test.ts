import { describe, it, expect } from "vitest";
import { sanitizeNext, determineDefaultDashboard } from "../nav-utils";

describe("sanitizeNext", () => {
  it("returns null for empty or undefined input", () => {
    expect(sanitizeNext(undefined)).toBeNull();
    expect(sanitizeNext("")).toBeNull();
  });

  it("allows safe relative paths", () => {
    expect(sanitizeNext("/admin")).toBe("/admin");
    expect(sanitizeNext("/student?tab=attendance")).toBe("/student?tab=attendance");
    expect(sanitizeNext("/attend/session-123")).toBe("/attend/session-123");
  });

  it("blocks open redirects and protocol-relative URLs", () => {
    expect(sanitizeNext("//evil.com")).toBeNull();
    expect(sanitizeNext("https://evil.com")).toBeNull();
    expect(sanitizeNext("javascript:alert(1)")).toBeNull();
  });
});

describe("determineDefaultDashboard", () => {
  it("routes admin first", () => {
    expect(determineDefaultDashboard({ isAdmin: true, isTeacher: true, isStudent: true })).toBe(
      "/admin",
    );
  });

  it("routes teacher when not admin", () => {
    expect(determineDefaultDashboard({ isTeacher: true, isStudent: true })).toBe("/teacher");
  });

  it("routes student when only student", () => {
    expect(determineDefaultDashboard({ isStudent: true })).toBe("/student");
  });

  it("routes guardian when isGuardian is set", () => {
    expect(determineDefaultDashboard({ isGuardian: true })).toBe("/parent");
  });

  it("routes employee when isEmployee is set", () => {
    expect(determineDefaultDashboard({ isEmployee: true })).toBe("/employee");
  });

  it("falls back to /enroll when no roles are set", () => {
    expect(determineDefaultDashboard({})).toBe("/enroll");
  });
});
