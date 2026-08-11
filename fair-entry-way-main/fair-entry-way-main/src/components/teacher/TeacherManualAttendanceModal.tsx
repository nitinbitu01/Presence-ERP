import React, { useState } from "react";
import { UserCheck, ShieldAlert, Loader2, X } from "lucide-react";

export interface StudentManualTarget {
  studentId: string;
  displayName: string;
  rollNo: string;
  sessionId: string;
}

interface TeacherManualAttendanceModalProps {
  isOpen: boolean;
  target: StudentManualTarget | null;
  onClose: () => void;
  onSubmit: (
    sessionId: string,
    studentId: string,
    reasonCode: string,
    reasonNote: string,
  ) => Promise<void>;
}

export function TeacherManualAttendanceModal({
  isOpen,
  target,
  onClose,
  onSubmit,
}: TeacherManualAttendanceModalProps) {
  const [reasonCode, setReasonCode] = useState<string>("camera_fault");
  const [reasonNote, setReasonNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonNote.trim() || reasonNote.trim().length < 3) {
      setError("Please enter a valid reason note (minimum 3 characters).");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(target.sessionId, target.studentId, reasonCode, reasonNote.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record manual attendance.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Manual Attendance Override</h3>
              <p className="text-xs text-muted-foreground">Controlled & Audit-Logged Action</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-muted/40 rounded-lg p-3 border border-border space-y-1">
          <div className="text-xs font-semibold text-foreground">{target.displayName}</div>
          <div className="text-xs text-muted-foreground font-mono">Roll No: {target.rollNo}</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">
              Override Reason <span className="text-destructive">*</span>
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:ring-2 focus:ring-primary"
            >
              <option value="camera_fault">📷 Camera Fault / Blurred Lens</option>
              <option value="device_battery_dead">🪫 Device Battery Dead / Offline</option>
              <option value="network_failure">🌐 Classroom Network Failure</option>
              <option value="liveness_issue">👤 Verification / Liveness Timeout</option>
              <option value="medical_od_exemption">
                🏥 Medical / Official Duty (OD) Exemption
              </option>
              <option value="other">📝 Other Verified Exception</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">
              Detailed Reason / Teacher Note <span className="text-destructive">*</span>
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Student's front camera glass was cracked; verified student identity in class."
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              This override will mark the student <strong>Present</strong> and permanently log your
              Teacher ID, timestamp, and reason for audit compliance.
            </span>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md border border-input text-xs font-medium hover:bg-accent"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCheck className="h-3.5 w-3.5" />
              )}
              Mark Present & Log Audit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
