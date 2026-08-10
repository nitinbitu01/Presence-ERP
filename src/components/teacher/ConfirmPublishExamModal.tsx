import { useState } from "react";
import { AlertTriangle, Loader2, X, CheckCircle2 } from "lucide-react";

interface ConfirmPublishExamModalProps {
  isOpen: boolean;
  exam: {
    id: string;
    title: string;
    total_marks: number;
    weightage: number;
  } | null;
  onClose: () => void;
  onConfirm: (examId: string) => Promise<void>;
}

export function ConfirmPublishExamModal({
  isOpen,
  exam,
  onClose,
  onConfirm,
}: ConfirmPublishExamModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !exam) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(exam.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish exam.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-publish-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 id="confirm-publish-title" className="text-base font-bold text-foreground">
              Confirm Exam Publication
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Are you sure you want to publish marks for{" "}
          <strong className="text-foreground">{exam.title}</strong>? Once published, students will
          be able to view their scores and total grade weightages.
        </p>

        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Marks:</span>
            <span className="font-semibold text-foreground">{exam.total_marks}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Course Weightage:</span>
            <span className="font-semibold text-foreground">{exam.weightage}%</span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-input bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm &amp; Publish
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
