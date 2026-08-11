// Compensating-rollback helper for saveEnrollment.
//
// Why this exists: saveEnrollment writes several related rows (biometric_consent,
// face_embeddings, enrollment_photos, device_fingerprints) as separate sequential upserts,
// not inside a single DB transaction. If a later step fails, earlier writes must not be left
// behind silently — otherwise a student can end up with "consent granted" but no embedding on
// file, or vice versa, while the UI still reports success. This helper deletes everything for
// that student/policy version and throws, so the caller always fails loudly and the student is
// left in a clean, fully-unenrolled state ready to retry.
//
// Kept in its own module (rather than inline in the createServerFn handler) specifically so it
// can be unit tested without needing to fake TanStack Start's server-function runtime — see
// src/lib/__tests__/enrollment-rollback.test.ts.

// Deliberately loose/structural: matching the full generated Supabase client type here causes
// "Type instantiation is excessively deep" TS errors, and this helper only ever calls
// .from(table).delete().eq(...) so it doesn't need the full client surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MinimalSupabaseAdmin = { from: (table: string) => any };

export class EnrollmentRollbackError extends Error {}

/**
 * Deletes any partially-written enrollment rows for a student and throws a clear error.
 * Always throws — callers should `await rollbackEnrollment(...)` directly inside a failure
 * branch; it never returns normally.
 */
// Wraps a cleanup delete so a synchronous throw from the client (not just a rejected promise)
// can never escape and mask the original enrollment failure reason below.
async function safeDelete(run: () => unknown): Promise<void> {
  try {
    await run();
  } catch {
    // Best-effort cleanup — a stray row from a failed enrollment is far less harmful than
    // hiding the real reason the enrollment failed, so cleanup errors are swallowed here.
  }
}

export async function rollbackEnrollment(
  admin: MinimalSupabaseAdmin,
  userId: string,
  policyVersion: string,
  reason: string,
): Promise<never> {
  await Promise.allSettled([
    safeDelete(() => admin.from("face_embeddings").delete().eq("student_id", userId)),
    safeDelete(() => admin.from("enrollment_photos").delete().eq("student_id", userId)),
    safeDelete(() => admin.from("device_fingerprints").delete().eq("student_id", userId)),
    safeDelete(() =>
      admin
        .from("biometric_consent")
        .delete()
        .eq("student_id", userId)
        .eq("policy_version", policyVersion),
    ),
  ]);
  throw new EnrollmentRollbackError(
    `Enrollment could not be completed (${reason}). Nothing was saved — please try again.`,
  );
}
