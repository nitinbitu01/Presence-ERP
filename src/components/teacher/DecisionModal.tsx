import React, { useState, useEffect } from "react";
import { CheckCircle2, XCircle, AlertCircle, Loader2, X, ShieldCheck } from "lucide-react";

export interface DecisionItem {
  id: string;
  studentName: string;
  rollNo?: string;
  type: "fallback" | "review";
  reasonCode?: string;
  similarity?: number | null;
  photoUrl?: string | null;
  createdAt: string;
}

interface DecisionModalProps {
  isOpen: boolean;
  item: DecisionItem | null;
  onClose: () => void;
  onSubmit: (id: string, decision: "APPROVED" | "REJECTED", note: string) => Promise<void>;
}

export function DecisionModal({ isOpen, item, onClose, onSubmit }: DecisionModalProps) {
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDecision("APPROVED");
      setNote("");
      setError(null);
    }
  }, [isOpen, item]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen || !item) return null;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (note.length > 500) {
      setError("Reviewer note cannot exceed 500 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit(item.id, decision, note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit decision.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="decision-modal-title" className="text-lg font-bold text-foreground">
                Review Attendance Request
              </h2>
              <p className="text-xs text-muted-foreground">
                {item.type === "fallback" ? "Fallback Check-in Decision" : "Human Verification Queue"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Student Metadata Card */}
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground text-sm">{item.studentName}</span>
            {item.rollNo && (
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                {item.rollNo}
              </span>
            )}
          </div>
          {item.reasonCode && (
            <div className="text-muted-foreground">
              Reason Code: <span className="font-medium text-foreground">{item.reasonCode}</span>
            </div>
          )}
          {item.similarity != null && (
            <div className="text-muted-foreground">
              Embedding Similarity:{" "}
              <span className="font-semibold text-foreground font-mono">
                {(item.similarity * 100).toFixed(1)}%
              </span>
            </div>
          )}
          <div className="text-muted-foreground text-[11px]">
            Submitted: {new Date(item.createdAt).toLocaleString()}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-2">
              Select Decision
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDecision("APPROVED")}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  decision === "APPROVED"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Approve
              </button>

              <button
                type="button"
                onClick={() => setDecision("REJECTED")}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  decision === "REJECTED"
                    ? "border-destructive bg-destructive/10 text-destructive shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <XCircle className="h-4 w-4 text-destructive" />
                Reject
              </button>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="reviewer-note" className="text-xs font-semibold text-foreground">
                Reviewer Note / Justification <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <span className="text-[11px] font-mono text-muted-foreground">
                {note.length}/500
              </span>
            </div>
            <textarea
              id="reviewer-note"
              rows={3}
              maxLength={500}
              placeholder="Provide reason for approval or rejection..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-input bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`rounded-lg px-5 py-2 text-xs font-semibold text-white shadow transition-all focus:outline-none focus:ring-2 ${
                decision === "APPROVED"
                  ? "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
                  : "bg-destructive hover:bg-destructive/90 focus:ring-red-500"
              }`}
            >
              {submitting ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting...
                </span>
              ) : (
                `Confirm ${decision === "APPROVED" ? "Approval" : "Rejection"}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
