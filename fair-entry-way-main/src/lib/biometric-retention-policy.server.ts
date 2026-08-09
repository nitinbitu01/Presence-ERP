/**
 * Biometric data retention.
 *
 * REWRITTEN — the original version of this module was unsafe to ever run automatically and is
 * kept only as history in git blame. Two real bugs, found during the 15-day hardening pass:
 *
 * 1. It deleted `face_embeddings` purely by age (`created_at < cutoff`), with no way to tell a
 *    currently-enrolled student from one who has actually left — profiles has no
 *    graduated/withdrawn/expelled status column at all (checked against
 *    src/integrations/supabase/types.ts and the migration that creates `profiles`). Running it
 *    on a schedule would eventually delete face data for active students who simply enrolled
 *    more than a year ago (e.g. a 3rd/4th-year student), silently breaking their attendance.
 * 2. Its audit-log write always failed: `audit_logs.actor_id` and `.target_id` are strict
 *    `uuid NOT NULL` columns, but the code inserted non-UUID strings
 *    ("system_retention_policy", "purge_<timestamp>_<rand>"). Postgres would reject every
 *    insert, and the surrounding try/catch swallowed the error — so the "audit trail" for this
 *    job never actually existed. See migration 20260803000000_audit_logs_nullable_system_actor
 *    for the actor_id fix (now nullable for system actions).
 *
 * What this file actually does now, split by real risk:
 *
 * - face_embeddings / enrollment_photos / device_fingerprints: NEVER auto-deleted by age here.
 *   These already correctly disappear via `ON DELETE CASCADE` the moment an admin deletes a
 *   student's auth account (see admin.functions.ts) — that's the real, working deletion path.
 *   What THIS module provides for these tables is dry-run reporting only: how many embeddings
 *   are older than N days, surfaced for a human admin to review and decide whether those
 *   accounts should be offboarded. Auto-deleting them would require a real student-lifecycle
 *   status field that doesn't exist yet — building that is a separate, larger piece of work,
 *   not something to fake here.
 * - liveness_sessions: pass/fail *outcome* logs (confidence score, method, timestamp) — not a
 *   biometric template that could re-identify someone the way an embedding can. These ARE safe
 *   to prune by flat age alone, same as any other audit log, and this module does actually
 *   delete these when runLivenessSessionLogPurge is called with dryRun: false.
 */

export interface EmbeddingRetentionReport {
  staleEmbeddingsCount: number;
  cutoffDate: string;
  retentionDays: number;
  timestamp: string;
}

export interface LivenessSessionPurgeResult {
  deletedCount: number;
  dryRun: boolean;
  cutoffDate: string;
  retentionDays: number;
  timestamp: string;
  auditLogId: string | null;
}

/**
 * Reporting only — never deletes. Tells an admin how many face_embeddings rows are older than
 * `retentionDays` so they can investigate whether those students have actually left and should
 * be offboarded (which triggers the real, safe cascade-delete path).
 */
export async function reportStaleEmbeddings(
  retentionDays: number = 365,
): Promise<EmbeddingRetentionReport> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { count, error } = await supabaseAdmin
    .from("face_embeddings")
    .select("*", { count: "exact", head: true })
    .lt("created_at", cutoffDate);

  if (error) {
    throw new Error(`reportStaleEmbeddings failed: ${error.message}`);
  }

  return {
    staleEmbeddingsCount: count ?? 0,
    cutoffDate,
    retentionDays,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Safe to run automatically: prunes liveness_sessions rows (outcome logs, not biometric
 * templates) older than `retentionDays`. Defaults to dry-run; pass dryRun: false to actually
 * delete. Always writes (or attempts to write) an audit_logs row for a live run, and throws
 * loudly instead of swallowing errors, so a broken job can't hide silently for months the way
 * the original one did.
 */
export async function runLivenessSessionLogPurge(
  retentionDays: number = 730,
  dryRun: boolean = true,
): Promise<LivenessSessionPurgeResult> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (dryRun) {
    const { count, error } = await supabaseAdmin
      .from("liveness_sessions")
      .select("*", { count: "exact", head: true })
      .lt("created_at", cutoffDate);
    if (error) throw new Error(`runLivenessSessionLogPurge (dry run) failed: ${error.message}`);
    return {
      deletedCount: count ?? 0,
      dryRun: true,
      cutoffDate,
      retentionDays,
      timestamp: new Date().toISOString(),
      auditLogId: null,
    };
  }

  const { count: deletedCount, error: deleteError } = await supabaseAdmin
    .from("liveness_sessions")
    .delete({ count: "exact" })
    .lt("created_at", cutoffDate);

  if (deleteError) {
    throw new Error(`runLivenessSessionLogPurge (live) failed: ${deleteError.message}`);
  }

  const auditLogId = crypto.randomUUID();
  const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
    id: auditLogId,
    actor_id: null, // system/automated action — see migration for why this is allowed to be null
    action: "liveness_session_log_purge",
    target_table: "liveness_sessions",
    target_id: auditLogId,
    details: {
      deletedCount: deletedCount ?? 0,
      cutoffDate,
      retentionDays,
    },
  });
  if (auditError) {
    // The purge itself already succeeded and can't be undone — but don't hide the fact that
    // the audit trail write failed, unlike the original version of this module.
    throw new Error(
      `Liveness session purge succeeded (${deletedCount ?? 0} rows deleted) but the audit ` +
        `log write failed: ${auditError.message}`,
    );
  }

  return {
    deletedCount: deletedCount ?? 0,
    dryRun: false,
    cutoffDate,
    retentionDays,
    timestamp: new Date().toISOString(),
    auditLogId,
  };
}
