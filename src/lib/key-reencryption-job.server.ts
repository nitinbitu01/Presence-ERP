/**
 * Phase 5.2 — Biometric Key Re-encryption Job
 *
 * Closes the open caveat in the README: when rotating BIOMETRIC_ENC_KEY,
 * every face_embedding row encrypted under the old key version must eventually
 * be re-encrypted under the new key version before the old key can be safely
 * deleted. Without this job, old key material must be kept indefinitely.
 *
 * Design:
 *   - Idempotent: rows already at target version are skipped.
 *   - Batched: processes `batchSize` rows per invocation (default 100).
 *     Call repeatedly until remaining = 0.
 *   - Safe: UPDATE in-place (no DELETE+INSERT) so row audit trails are intact.
 *   - Progress tracked in key_rotation_jobs table for admin visibility.
 *   - No data loss on error: a failed decrypt/encrypt leaves the row unchanged.
 *
 * Usage:
 *   1. Set BIOMETRIC_ENC_KEY_V2 to the new key.
 *   2. Set BIOMETRIC_ENC_KEY_CURRENT_VERSION=2.
 *   3. Deploy the worker (all new enrollments now encrypt under V2).
 *   4. Trigger runReencryptionJob from admin UI until remaining = 0.
 *   5. Remove BIOMETRIC_ENC_KEY (V0) from your secrets store.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "@/lib/errors";
import { z } from "zod";

export interface ReencryptionJobResult {
  jobId: string;
  processed: number;
  remaining: number;
  errors: number;
  status: "completed" | "partial" | "failed";
  targetVersion: number;
}

/**
 * runReencryptionJob — processes one batch of face_embeddings rows that are
 * below the current key version. Returns progress metrics.
 * Admin-only. Safe to call repeatedly (idempotent).
 */
export const runReencryptionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const parsed = z
      .object({
        batchSize: z.number().int().min(1).max(500).optional().default(100),
      })
      .safeParse(input ?? {});
    return parsed.success ? parsed.data : { batchSize: 100 };
  })
  .handler(async ({ data, context }): Promise<ReencryptionJobResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Guard: admins only.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    if (!roles?.some((r) => r.role === "admin")) {
      throw new PresenceErpError(
        "FORBIDDEN",
        "Only administrators may run key re-encryption jobs.",
      );
    }

    const { encryptEmbedding, decryptEmbedding } = await import("@/lib/attendance-crypto.server");

    // Determine current key version from environment.
    const currentVersion = parseInt(process.env.BIOMETRIC_ENC_KEY_CURRENT_VERSION ?? "0", 10);

    // Create a job record.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jobRow } = await (supabaseAdmin as any)
      .from("key_rotation_jobs")
      .insert({
        operator_id: context.userId,
        target_version: currentVersion,
        status: "running",
      })
      .select("id")
      .single();

    const jobId = (jobRow as { id?: string } | null)?.id ?? "unknown";

    let processed = 0;
    let errorCount = 0;

    try {
      // Fetch rows below current version using ciphertext column (face_embeddings schema).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error: fetchErr } = await (supabaseAdmin as any)
        .from("face_embeddings")
        .select("id, ciphertext, key_version")
        .lt("key_version", currentVersion)
        .limit(data.batchSize);

      if (fetchErr) {
        throw new PresenceErpError("DATABASE_ERROR", fetchErr.message);
      }

      const rowsToProcess = rows ?? [];

      for (const row of rowsToProcess) {
        try {
          // Decode base64 → Uint8Array.
          const rawB64: string = (row as { ciphertext: string }).ciphertext;
          const binaryStr = atob(rawB64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

          // Decrypt under old key (version embedded in ciphertext).
          const embedding = await decryptEmbedding(bytes);

          // Re-encrypt under current key.
          const reencrypted = await encryptEmbedding(Array.from(embedding));

          // Convert back to base64 for storage.
          let b64 = "";
          for (let i = 0; i < reencrypted.length; i++) {
            b64 += String.fromCharCode(reencrypted[i]);
          }
          const newB64 = btoa(b64);

          const rowId = (row as { id: string }).id;
          // Update the row (ciphertext column).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any)
            .from("face_embeddings")
            .update({ ciphertext: newB64, key_version: currentVersion })
            .eq("id", rowId);

          processed++;

          // Checkpoint cursor update every 10 rows or on last row
          if (processed % 10 === 0 && jobId !== "unknown") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabaseAdmin as any)
              .from("key_rotation_jobs")
              .update({ last_processed_id: rowId, rows_processed: processed })
              .eq("id", jobId)
              .catch(() => {});
          }
        } catch (rowErr) {
          // Log and continue — never abort the batch on a single row failure.
          console.error(`[key-reencryption] Failed row:`, rowErr);
          errorCount++;
        }
      }

      // Count remaining rows below current version.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: remaining } = await (supabaseAdmin as any)
        .from("face_embeddings")
        .select("id", { count: "exact", head: true })
        .lt("key_version", currentVersion);

      const status = errorCount === 0 ? "completed" : "partial";

      const lastRowId =
        rowsToProcess.length > 0
          ? (rowsToProcess[rowsToProcess.length - 1] as { id: string }).id
          : null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any)
        .from("key_rotation_jobs")
        .update({
          completed_at: new Date().toISOString(),
          rows_processed: processed,
          rows_remaining: remaining ?? 0,
          error_count: errorCount,
          last_processed_id: lastRowId,
          status,
        })
        .eq("id", jobId);

      // Audit log.
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "key_reencryption_job",
        target_table: "face_embeddings",
        target_id: context.userId,
        details: {
          jobId,
          processed,
          remaining: remaining ?? 0,
          errors: errorCount,
          targetVersion: currentVersion,
        },
      });

      return {
        jobId,
        processed,
        remaining: remaining ?? 0,
        errors: errorCount,
        status,
        targetVersion: currentVersion,
      };
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any)
        .from("key_rotation_jobs")
        .update({ status: "failed", completed_at: new Date().toISOString(), error_count: 1 })
        .eq("id", jobId);
      throw err;
    }
  });

/**
 * getKeyRotationStatus — returns the last N rotation jobs for admin dashboard.
 */
export const getKeyRotationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    if (!roles?.some((r) => r.role === "admin")) {
      throw new PresenceErpError("FORBIDDEN", "Admin only.");
    }

    const currentVersion = parseInt(process.env.BIOMETRIC_ENC_KEY_CURRENT_VERSION ?? "0", 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: rowsBelowVersion } = await (supabaseAdmin as any)
      .from("face_embeddings")
      .select("id", { count: "exact", head: true })
      .lt("key_version", currentVersion);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jobs } = await (supabaseAdmin as any)
      .from("key_rotation_jobs")
      .select(
        "id, target_version, started_at, completed_at, rows_processed, rows_remaining, error_count, status",
      )
      .order("started_at", { ascending: false })
      .limit(10);

    return {
      currentKeyVersion: currentVersion,
      rowsNeedingReencryption: rowsBelowVersion ?? 0,
      recentJobs: jobs ?? [],
    };
  });
