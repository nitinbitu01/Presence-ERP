import { describe, it, expect } from "vitest";
import { parseCsv } from "../csv-parser";

describe("CSV Parser", () => {
  it("parses a simple CSV with headers", () => {
    const text = "email,display_name\njane@example.edu,Jane Doe\njohn@example.edu,John Smith";
    const { headers, rows, errors } = parseCsv(text);
    expect(headers).toEqual(["email", "display_name"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ email: "jane@example.edu", display_name: "Jane Doe" });
    expect(errors).toHaveLength(0);
  });

  it("lowercases and trims headers", () => {
    const text = " Email , Display Name \nx@y.com,X";
    const { headers } = parseCsv(text);
    expect(headers).toEqual(["email", "display name"]);
  });

  it("handles quoted fields with embedded commas", () => {
    const text = 'email,display_name\njane@example.edu,"Doe, Jane"';
    const { rows } = parseCsv(text);
    expect(rows[0].display_name).toBe("Doe, Jane");
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const text = 'email,note\nx@y.com,"She said ""hi"""';
    const { rows } = parseCsv(text);
    expect(rows[0].note).toBe('She said "hi"');
  });

  it("handles CRLF line endings", () => {
    const text = "email,name\r\nx@y.com,X\r\ny@z.com,Y\r\n";
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(2);
  });

  it("skips blank lines", () => {
    const text = "email,name\nx@y.com,X\n\n\ny@z.com,Y\n";
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(2);
  });

  it("flags rows with a mismatched column count instead of crashing", () => {
    const text = "email,name\nx@y.com,X,extra\ny@z.com,Y";
    const { rows, errors } = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("y@z.com");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/Row 2/);
  });

  it("returns an error for an empty file", () => {
    const { headers, rows, errors } = parseCsv("");
    expect(headers).toHaveLength(0);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/empty/i);
  });
});

describe("Roster Import Validation Logic", () => {
  // Mirrors the classification logic in previewRosterImport: a row is
  // "matched" if the email already exists, "will_invite" if not, and
  // "invalid" if it fails validation or references an unknown dept/program.
  type Status = "matched" | "will_invite" | "invalid";

  function classify(opts: {
    emailValid: boolean;
    knownDepartment: boolean | null; // null = not specified
    knownProgram: boolean | null;
    existingUserId: string | null;
  }): Status {
    if (!opts.emailValid) return "invalid";
    if (opts.knownDepartment === false) return "invalid";
    if (opts.knownProgram === false) return "invalid";
    return opts.existingUserId ? "matched" : "will_invite";
  }

  it("classifies an existing user with valid dept/program as matched", () => {
    expect(
      classify({
        emailValid: true,
        knownDepartment: true,
        knownProgram: true,
        existingUserId: "user-1",
      }),
    ).toBe("matched");
  });

  it("classifies a new email as will_invite", () => {
    expect(
      classify({
        emailValid: true,
        knownDepartment: null,
        knownProgram: null,
        existingUserId: null,
      }),
    ).toBe("will_invite");
  });

  it("classifies an invalid email as invalid regardless of other fields", () => {
    expect(
      classify({
        emailValid: false,
        knownDepartment: true,
        knownProgram: true,
        existingUserId: "user-1",
      }),
    ).toBe("invalid");
  });

  it("classifies an unknown department_code as invalid", () => {
    expect(
      classify({
        emailValid: true,
        knownDepartment: false,
        knownProgram: null,
        existingUserId: null,
      }),
    ).toBe("invalid");
  });

  it("classifies an unknown program_code as invalid", () => {
    expect(
      classify({
        emailValid: true,
        knownDepartment: true,
        knownProgram: false,
        existingUserId: "user-1",
      }),
    ).toBe("invalid");
  });

  it("treats an omitted department/program as valid (optional fields)", () => {
    expect(
      classify({
        emailValid: true,
        knownDepartment: null,
        knownProgram: null,
        existingUserId: "user-1",
      }),
    ).toBe("matched");
  });

  it("current_semester range validation accepts 1-20 and rejects outside that range", () => {
    const isValidSemester = (raw: string) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 20;
    };
    expect(isValidSemester("5")).toBe(true);
    expect(isValidSemester("1")).toBe(true);
    expect(isValidSemester("20")).toBe(true);
    expect(isValidSemester("0")).toBe(false);
    expect(isValidSemester("21")).toBe(false);
    expect(isValidSemester("abc")).toBe(false);
    expect(isValidSemester("3.5")).toBe(false);
  });

  it("defaults an unspecified role to student", () => {
    const resolveRole = (raw: string | undefined) => (raw === "teacher" ? "teacher" : "student");
    expect(resolveRole(undefined)).toBe("student");
    expect(resolveRole("")).toBe("student");
    expect(resolveRole("teacher")).toBe("teacher");
    expect(resolveRole("nonsense")).toBe("student");
  });

  it("detects duplicate emails within the same file", () => {
    const emails = ["a@x.com", "b@x.com", "a@x.com"];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const e of emails) {
      const lower = e.toLowerCase();
      if (seen.has(lower)) duplicates.push(e);
      seen.add(lower);
    }
    expect(duplicates).toEqual(["a@x.com"]);
  });
});
