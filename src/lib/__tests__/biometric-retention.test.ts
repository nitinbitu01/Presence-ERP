/**
 * Regression test for Phase 2 item 2 (hardening work order): the automated
 * biometric-retention enforcement job. No live Postgres instance here, so --
 * same approach as the session_otp privacy fix test in rls.integration.test.ts --
 * this reads the real migration SQL and asserts real properties of it, rather
 * than re-implementing the logic in JS and testing that instead.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const migrationPath = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260725150000_biometric_retention_job.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

describe("biometric retention job migration", () => {
  it("only targets consent rows whose retention window has actually passed", () => {
    expect(sql).toMatch(/retention_until IS NOT NULL/);
    expect(sql).toMatch(/retention_until < now\(\)/);
  });

  it("skips students who already withdrew consent (already erased, don't double-process)", () => {
    expect(sql).toMatch(/withdrawn_at IS NULL/);
  });

  it("deletes the actual biometric data (face_embeddings), not just the consent record", () => {
    expect(sql).toMatch(/DELETE FROM public\.face_embeddings/);
  });

  it("records the erasure in biometric_withdrawals with a distinguishing reason", () => {
    expect(sql).toMatch(/INSERT INTO public\.biometric_withdrawals/);
    expect(sql).toMatch(/retention_period_expired/);
  });

  it("marks consent as withdrawn so the row reflects reality after the sweep", () => {
    expect(sql).toMatch(/UPDATE public\.biometric_consent[\s\S]*SET withdrawn_at = now\(\)/);
  });

  it("is service-role only, like every other sensitive function/table added this hardening pass", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_biometric_retention\(\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.enforce_biometric_retention\(\) TO service_role/,
    );
  });

  it("schedules the daily sweep via pg_cron without letting a missing extension break the migration", () => {
    expect(sql).toMatch(/cron\.schedule\(/);
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });
});
