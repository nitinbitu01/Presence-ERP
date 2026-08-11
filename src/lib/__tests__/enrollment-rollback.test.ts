/**
 * Phase 1 fix verification: saveEnrollment must never report success while leaving a partial
 * write behind. rollbackEnrollment is the compensating action saveEnrollment now calls whenever
 * face_embeddings, enrollment_photos, or device_fingerprints fails to persist — it must (a)
 * always throw, and (b) always attempt to delete every enrollment-related row for that student
 * before throwing, so no orphaned consent/embedding/photo row survives a failed enrollment.
 */

import { describe, it, expect, vi } from "vitest";
import {
  rollbackEnrollment,
  EnrollmentRollbackError,
  type MinimalSupabaseAdmin,
} from "../enrollment-rollback.server";

function buildTrackedAdminMock() {
  const calls: Array<{ table: string; studentId: string; policyVersion?: string }> = [];

  const admin: MinimalSupabaseAdmin = {
    from: (table: string) => ({
      delete: () => ({
        eq: (col1: string, val1: string) => {
          const partial: { table: string; studentId: string; policyVersion?: string } = {
            table,
            studentId: val1,
          };
          calls.push(partial);
          return {
            eq: (col2: string, val2: string) => {
              partial.policyVersion = val2;
              return Promise.resolve({ error: null });
            },
            then: (resolve: (v: { error: null }) => unknown) =>
              Promise.resolve({ error: null }).then(resolve),
          };
        },
      }),
    }),
  };

  return { admin, calls };
}

describe("rollbackEnrollment (Phase 1: no silent enrollment failures)", () => {
  it("always throws — never resolves normally", async () => {
    const { admin } = buildTrackedAdminMock();
    await expect(
      rollbackEnrollment(admin, "student-1", "policy-v1", "face_embeddings: write failed"),
    ).rejects.toThrow();
  });

  it("throws an EnrollmentRollbackError carrying the failure reason", async () => {
    const { admin } = buildTrackedAdminMock();
    await expect(
      rollbackEnrollment(admin, "student-1", "policy-v1", "device_fingerprints: conflict"),
    ).rejects.toThrow(EnrollmentRollbackError);

    try {
      await rollbackEnrollment(admin, "student-1", "policy-v1", "device_fingerprints: conflict");
    } catch (e) {
      expect(e).toBeInstanceOf(EnrollmentRollbackError);
      expect((e as Error).message).toContain("device_fingerprints: conflict");
      expect((e as Error).message).toContain("Nothing was saved");
    }
  });

  it("attempts to delete every enrollment-related table for the student, not just the one that failed", async () => {
    const { admin, calls } = buildTrackedAdminMock();
    await rollbackEnrollment(admin, "student-42", "policy-v2", "enrollment_photos: timeout").catch(
      () => {},
    );

    const touchedTables = calls.map((c) => c.table).sort();
    expect(touchedTables).toEqual(
      ["biometric_consent", "device_fingerprints", "enrollment_photos", "face_embeddings"].sort(),
    );
    expect(calls.every((c) => c.studentId === "student-42")).toBe(true);
  });

  it("scopes the biometric_consent delete to the specific policy version", async () => {
    const { admin, calls } = buildTrackedAdminMock();
    await rollbackEnrollment(admin, "student-7", "policy-v3", "face_embeddings: rls").catch(
      () => {},
    );
    const consentCall = calls.find((c) => c.table === "biometric_consent");
    expect(consentCall?.policyVersion).toBe("policy-v3");
  });

  it("still throws even if the underlying delete calls themselves fail (Promise.allSettled, not Promise.all)", async () => {
    const throwingAdmin: MinimalSupabaseAdmin = {
      from: () => ({
        delete: () => ({
          eq: () => {
            throw new Error("connection reset");
          },
        }),
      }),
    };
    // allSettled means an individual delete throwing synchronously would escape as an unhandled
    // rejection only if not wrapped — this test locks in that rollback always still surfaces the
    // original enrollment failure reason rather than crashing on the cleanup attempt itself.
    await expect(
      rollbackEnrollment(throwingAdmin, "student-9", "policy-v1", "face_embeddings: boom"),
    ).rejects.toThrow(/face_embeddings: boom/);
  });
});
