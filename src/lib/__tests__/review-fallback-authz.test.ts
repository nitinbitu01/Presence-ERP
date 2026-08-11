/**
 * Regression test for a Phase 2 security-review finding: reviewFallbackRequest
 * had no authorization check at all beyond "is logged in" -- any authenticated
 * user, including a student, could approve any fallback request (their own or
 * anyone else's) and be granted `fallback_present` attendance credit, bypassing
 * every one of the 5 gates entirely.
 *
 * Testing the real exported function directly would require simulating
 * createServerFn's auth middleware/context, which no test in this suite does
 * (see the docs/SECURITY_REVIEW.md and IMPLEMENTATION_SUMMARY.md notes on this
 * suite's limitations). Rather than skip a regression test for a bug this
 * serious, this asserts the fix's actual presence in the source: the handler
 * must check course ownership or admin role before touching status, and must do
 * so before the update/insert that grants attendance -- not after.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../attendance.functions.ts"), "utf8");

function extractFunctionBody(source: string, exportName: string): string {
  const start = source.indexOf(`export const ${exportName} = createServerFn`);
  expect(start, `${exportName} not found in attendance.functions.ts`).toBeGreaterThan(-1);
  // Grab up to the next top-level `export const`, or EOF.
  const next = source.indexOf("\nexport const ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("reviewFallbackRequest authorization (security review fix)", () => {
  const body = extractFunctionBody(source, "reviewFallbackRequest");

  it("checks course ownership (teacher_id) or admin role before granting attendance", () => {
    expect(body).toMatch(/teacher_id/);
    expect(body).toMatch(/role.*admin|admin.*role/i);
    expect(body).toMatch(/Forbidden/);
  });

  it("performs the authorization check before updating fallback_requests.status", () => {
    const forbiddenIdx = body.indexOf("Forbidden");
    const updateIdx = body.indexOf('.from("fallback_requests")\n      .update(');
    expect(forbiddenIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(forbiddenIdx).toBeLessThan(updateIdx);
  });

  it("performs the authorization check before granting attendance_ledger credit", () => {
    const forbiddenIdx = body.indexOf("Forbidden");
    const ledgerIdx = body.indexOf('.from("attendance_ledger")');
    expect(forbiddenIdx).toBeGreaterThan(-1);
    expect(ledgerIdx).toBeGreaterThan(-1);
    expect(forbiddenIdx).toBeLessThan(ledgerIdx);
  });
});
