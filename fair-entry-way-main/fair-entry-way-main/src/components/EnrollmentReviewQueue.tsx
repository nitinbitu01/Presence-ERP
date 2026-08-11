/**
 * EnrollmentReviewQueue — Admin UI component for the borderline-match review queue.
 *
 * Displays rows from `enrollment_review_queue` where a new enrollee's face embedding
 * produced a cosine similarity in [THRESHOLD_REVIEW=0.70, THRESHOLD_MATCH=0.82) against
 * an existing enrolled face. The student was still enrolled (not left in limbo), but an
 * admin must review whether the match is a genuine duplicate or a false positive.
 *
 * Actions:
 *   Approve → row marked resolved; no change to face_embeddings.
 *   Reject  → row marked resolved; face_embeddings deleted for that student;
 *             audit event logged; student must re-enroll.
 */

import { useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listEnrollmentReviewQueue, reviewEnrollmentMatch } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

type ReviewRow = {
  id: string;
  student_id: string;
  matched_student_id: string | null;
  similarity: number;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  student_profile: { roll_no: string | null; department_id: string | null } | null;
  matched_student_profile: { roll_no: string | null; department_id: string | null } | null;
};

type StatusFilter = "pending" | "approved" | "rejected" | "all";

export function EnrollmentReviewQueue() {
  const listQueue = useServerFn(listEnrollmentReviewQueue);
  const reviewMatch = useServerFn(reviewEnrollmentMatch);

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const getHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }, []);

  const loadQueue = useCallback(
    async (filter: StatusFilter = statusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const headers = await getHeaders();
        const data = await listQueue({ data: { statusFilter: filter }, headers });
        setRows(data as ReviewRow[]);
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load review queue.");
      } finally {
        setLoading(false);
      }
    },
    [listQueue, statusFilter, getHeaders],
  );

  const handleDecision = async (reviewId: string, decision: "approved" | "rejected") => {
    setBusyIds((prev) => new Set(prev).add(reviewId));
    setActionError(null);
    try {
      const headers = await getHeaders();
      await reviewMatch({ data: { reviewId, decision }, headers });
      // Refresh the list after action
      await loadQueue(statusFilter);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
    }
  };

  const handleFilterChange = (filter: StatusFilter) => {
    setStatusFilter(filter);
    loadQueue(filter);
  };

  const simPercent = (sim: number) => `${(sim * 100).toFixed(1)}%`;

  const simColor = (sim: number) => {
    // 0.82+ would be a hard block (should never appear here)
    // 0.75–0.82 → amber (higher concern)
    // 0.70–0.75 → yellow (lower concern)
    if (sim >= 0.78) return "text-amber-700 dark:text-amber-300 font-bold";
    if (sim >= 0.74) return "text-amber-600 dark:text-amber-400 font-semibold";
    return "text-yellow-700 dark:text-yellow-400";
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            ⏳ Pending
          </span>
        );
      case "approved":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
            ✓ Approved
          </span>
        );
      case "rejected":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/30 dark:text-red-300">
            ✗ Rejected
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Enrollment Review Queue</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Borderline face-match enrollments (similarity 70–82%). Approve to confirm legitimacy, or
            Reject to deactivate and require re-enrollment.
          </p>
        </div>
        <button
          onClick={() => loadQueue(statusFilter)}
          disabled={loading}
          className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
        >
          {loading ? "Loading…" : loaded ? "↻ Refresh" : "Load Queue"}
        </button>
      </div>

      {/* Status filter tabs */}
      {loaded && (
        <div className="flex gap-1 text-xs">
          {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`rounded px-3 py-1 capitalize transition-colors ${
                statusFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "border border-input hover:bg-accent"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive font-medium">{error}</p>}
      {actionError && (
        <p className="text-xs text-destructive font-medium">Action failed: {actionError}</p>
      )}

      {loaded && rows.length === 0 && (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {statusFilter === "pending"
              ? "✓ No pending review items."
              : `No ${statusFilter} items found.`}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Student</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                  Matched Against
                </th>
                <th className="px-3 py-2 text-center font-semibold text-muted-foreground">
                  Similarity
                </th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                  Flagged At
                </th>
                <th className="px-3 py-2 text-center font-semibold text-muted-foreground">
                  Status
                </th>
                <th className="px-3 py-2 text-center font-semibold text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const isBusy = busyIds.has(row.id);
                return (
                  <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <p className="font-mono text-foreground">
                        {row.student_profile?.roll_no ?? "—"}
                      </p>
                      <p className="text-muted-foreground mt-0.5 break-all">
                        {row.student_id.slice(0, 8)}…
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.matched_student_id ? (
                        <>
                          <p className="font-mono text-foreground">
                            {row.matched_student_profile?.roll_no ?? "—"}
                          </p>
                          <p className="text-muted-foreground mt-0.5 break-all">
                            {row.matched_student_id.slice(0, 8)}…
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">Deleted</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={simColor(row.similarity)}>{simPercent(row.similarity)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {statusBadge(row.status)}
                      {row.reviewed_at && (
                        <p className="mt-1 text-muted-foreground">
                          {new Date(row.reviewed_at).toLocaleDateString()}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {row.status === "pending" ? (
                        <div className="flex justify-center gap-2">
                          <button
                            id={`approve-${row.id}`}
                            disabled={isBusy}
                            onClick={() => handleDecision(row.id, "approved")}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                          >
                            {isBusy ? "…" : "Approve"}
                          </button>
                          <button
                            id={`reject-${row.id}`}
                            disabled={isBusy}
                            onClick={() => {
                              if (
                                confirm(
                                  `Reject this enrollment? This will DELETE the face descriptor for student ${row.student_profile?.roll_no ?? row.student_id.slice(0, 8)} and require re-enrollment.`,
                                )
                              ) {
                                handleDecision(row.id, "rejected");
                              }
                            }}
                            className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
                          >
                            {isBusy ? "…" : "Reject"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">Done</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {loaded && (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Approve</strong> — Face descriptors are legitimately different people (false
            positive); no data is changed.
          </p>
          <p>
            <strong>Reject</strong> — Possible duplicate identity; enrollment is revoked and the
            student must re-enroll under admin supervision.
          </p>
          <p className="text-amber-700 dark:text-amber-400">
            Similarity ≥ 78% is higher concern. Similarity 70–74% is lower concern.
          </p>
        </div>
      )}
    </div>
  );
}
