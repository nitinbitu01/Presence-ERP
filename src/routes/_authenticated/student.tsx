// src/routes/_authenticated/student.tsx — FINAL WORLD-CLASS VERSION
// ─────────────────────────────────────────────────────────────────────────────
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  memo,
  useId,
  lazy,
  Suspense,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateActiveDemoSession } from "@/lib/attendance.functions";
import { ERPDayWiseTimesheet } from "@/components/ERPDayWiseTimesheet";
import {
  getStudentDashboard,
  submitLeaveRequest,
  listMyLeaveRequests,
  cancelLeaveRequest,
  getMyLeaveBalances,
  getNotifications,
  markNotificationRead,
  listAvailableTeachers,
  calculateAttendanceGoalTrajectory,
} from "@/lib/student.functions";
import { exportLeaveIcsFeed } from "@/lib/calendar-sync.server";
import { offlineQueue } from "@/lib/offline-queue";
import { NetworkQualityIndicator } from "@/components/NetworkQualityIndicator";
import { useStableServerFn } from "@/lib/useStableServerFn";
import { useRetryWithBackoff } from "@/lib/useRetryWithBackoff";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import { SectionErrorBoundary } from "@/components/student/ErrorBoundary";
import { StudentOnboardingWizard } from "@/components/StudentOnboardingWizard";
import { downloadMyData, requestAccountDeletion } from "@/lib/data-subject-requests.functions";
import { Modal } from "@/components/student/Modal";
import { ToastStack, useToast } from "@/components/student/Toast";
import { LiveSessionTicker } from "@/components/student/LiveSessionTicker";
import { VirtualList } from "@/components/student/VirtualList";
import { StaleIndicator } from "@/components/student/StaleIndicator";
import { PrintAttendanceReport } from "@/components/student/PrintAttendanceReport";
import {
  DashboardSkeleton,
  CardSkeleton,
} from "@/components/student/Skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingDown,
  Bell,
  Calendar,
  RefreshCw,
  WifiOff,
  BookOpen,
  Keyboard,
  Target,
} from "lucide-react";

// ── Route-level code splitting for heavy cards ────────────────────────────
const ExamResultsCard = lazy(() =>
  import("@/components/student/ExamResultsCard").then((m) => ({
    default: m.ExamResultsCard,
  })),
);
const FeesCard = lazy(() =>
  import("@/components/student/FeesCard").then((m) => ({
    default: m.FeesCard,
  })),
);

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/_authenticated/student")({
  component: StudentDashboard,
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30_000;
const RECENT_CHECKINS_PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type AttendanceStatus = "safe" | "warning" | "shortage";
type LeaveRequestType = "leave" | "od";

interface LeaveFormState {
  type: LeaveRequestType;
  startDate: string;
  endDate: string;
  reason: string;
  docUrl: string;
  assignedTeacherId: string;
}

const EMPTY_LEAVE_FORM: LeaveFormState = {
  type: "leave",
  startDate: "",
  endDate: "",
  reason: "",
  docUrl: "",
  assignedTeacherId: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function normalizeError(err: unknown): string {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const msg = err.message;
    if (!msg) return "An unexpected error occurred.";
    const lower = msg.toLowerCase();
    if (lower.includes("network") || lower.includes("fetch"))
      return "Network error. Please check your connection and try again.";
    if (lower.includes("permission") || lower.includes("forbidden"))
      return "You do not have permission for this action.";
    if (lower.includes("duplicate") || lower.includes("overlap"))
      return "A leave or OD request already exists for these dates.";
    return msg;
  }
  return "Something went wrong. Please try again.";
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────
function statusIndicatorClass(status: AttendanceStatus): string {
  return status === "safe"
    ? "bg-emerald-500"
    : status === "warning"
      ? "bg-amber-500"
      : "bg-red-500";
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const map = {
    safe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    shortage: "bg-red-500/15 text-red-700 dark:text-red-400",
  } as const;
  return (
    <Badge className={map[status]}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  if (decision === "present" || decision === "fallback_present")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        Present
      </Badge>
    );
  if (decision === "review")
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Under review
      </Badge>
    );
  if (decision === "rejected")
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
        Rejected
      </Badge>
    );
  return <Badge variant="secondary">{decision}</Badge>;
}

function ErrorBanner({
  message,
  onRetry,
  retryLabel,
  isWaiting,
  nextRetryMs,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  isWaiting?: boolean;
  nextRetryMs?: number;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 text-sm text-destructive">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={isWaiting}
          className="shrink-0 text-xs text-destructive underline hover:no-underline disabled:opacity-50"
        >
          {isWaiting && nextRetryMs
            ? `Retry in ${Math.ceil(nextRetryMs / 1000)}s…`
            : (retryLabel ?? "Retry")}
        </button>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

function OfflineBanner({ isOnline }: { isOnline: boolean }) {
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      setShowReconnected(false);
    } else if (wasOffline) {
      setShowReconnected(true);
      const t = setTimeout(() => setShowReconnected(false), 5_000);
      return () => clearTimeout(t);
    }
  }, [isOnline, wasOffline]);

  if (!showReconnected && isOnline && !wasOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={[
        "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium",
        "transition-all duration-500",
        showReconnected || isOnline
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      ].join(" ")}
    >
      {isOnline ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Back online — syncing your data…
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          You are offline. Leave requests will sync when you reconnect.
        </>
      )}
    </div>
  );
}

function KeyboardShortcutsHint() {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShow((s) => !s)}
        aria-label="Keyboard shortcuts"
        aria-expanded={show}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Keyboard shortcuts</span>
      </button>
      {show && (
        <div
          role="tooltip"
          className="absolute right-0 top-6 z-10 w-48 rounded-lg border border-border bg-popover p-3 shadow-lg text-xs space-y-1.5"
        >
          <p className="font-semibold text-foreground mb-2">Shortcuts</p>
          {[
            ["R", "Refresh dashboard"],
            ["L", "Apply leave / OD"],
            ["N", "Open notifications"],
            ["F", "Face attendance"],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {key}
              </kbd>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Keep it",
  onConfirm,
  onCancel,
  busy,
  variant = "destructive",
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  variant?: "destructive" | "default";
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth="max-w-sm">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Please wait…
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LeaveModal({
  open,
  onClose,
  onSubmitSuccess,
  submitFn,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitSuccess: (wasOffline: boolean) => void;
  submitFn: (args: any) => Promise<any>;
}) {
  const [form, setForm] = useState<LeaveFormState>(EMPTY_LEAVE_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const patch = useCallback(
    (updates: Partial<LeaveFormState>) =>
      setForm((prev) => ({ ...prev, ...updates })),
    [],
  );

  const [teachers, setTeachers] = useState<{ id: string; displayName: string }[]>([]);
  const fetchTeachers = useStableServerFn(useServerFn(listAvailableTeachers));

  useEffect(() => {
    if (open) {
      setForm(EMPTY_LEAVE_FORM);
      setError(null);
      fetchTeachers().then((list) => setTeachers(list)).catch(() => {});
    }
  }, [open, fetchTeachers]);

  const validate = (): string | null => {
    if (!form.assignedTeacherId) return "Please select a teacher to review your request.";
    if (!form.startDate) return "Start date is required.";
    if (!form.endDate) return "End date is required.";
    if (form.endDate < form.startDate)
      return "End date cannot be before start date.";
    if (form.startDate < todayIso()) return "Start date cannot be in the past.";
    const trimmed = form.reason.trim();
    if (trimmed.length < 10)
      return "Please provide a reason of at least 10 characters.";
    if (trimmed.length > 500) return "Reason must be 500 characters or fewer.";
    if (form.docUrl && !form.docUrl.startsWith("https://"))
      return "Document URL must start with https://";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const offline = !navigator.onLine;
      if (offline) {
        offlineQueue.enqueueLeaveRequest({
          startDate: form.startDate,
          endDate: form.endDate,
          reason: form.reason,
          requestType: form.type,
        });
        onClose();
        onSubmitSuccess(true);
        return;
      }
      await submitFn({
        data: {
          startDate: form.startDate,
          endDate: form.endDate,
          reason: form.reason.trim(),
          requestType: form.type,
          documentUrl: form.docUrl || undefined,
          assignedTeacherId: form.assignedTeacherId,
        },
      });
      onClose();
      onSubmitSuccess(false);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const charCount = form.reason.trim().length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply for Leave / On-Duty (OD)"
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-foreground">
            Request type
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["leave", "od"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={form.type === t}
                onClick={() => patch({ type: t })}
                className={[
                  "rounded-lg border py-2.5 px-3 text-xs font-semibold transition-all",
                  "focus-visible:outline-none focus-visible:ring-2",
                  "focus-visible:ring-ring focus-visible:ring-offset-1",
                  form.type === t
                    ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
                    : "border-input bg-background text-muted-foreground hover:bg-accent",
                ].join(" ")}
              >
                {t === "leave" ? "🏥 Medical / Personal" : "🎓 On-Duty (OD)"}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1">
          <label
            htmlFor={`${formId}-teacher`}
            className="block text-xs font-medium text-foreground"
          >
            Assign Relevant Teacher <span className="text-destructive">*</span>
          </label>
          <select
            id={`${formId}-teacher`}
            required
            value={form.assignedTeacherId}
            onChange={(e) => patch({ assignedTeacherId: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">-- Choose teacher to review request --</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Only the selected teacher will have the authority to approve or reject this request.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(
            [
              {
                id: "start",
                label: "Start date",
                value: form.startDate,
                min: todayIso(),
                onChange: (v: string) => patch({ startDate: v }),
              },
              {
                id: "end",
                label: "End date",
                value: form.endDate,
                min: form.startDate || todayIso(),
                onChange: (v: string) => patch({ endDate: v }),
              },
            ] as const
          ).map((f) => (
            <div key={f.id} className="space-y-1">
              <label
                htmlFor={`${formId}-${f.id}`}
                className="block text-xs font-medium text-foreground"
              >
                {f.label}{" "}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id={`${formId}-${f.id}`}
                required
                type="date"
                min={f.min}
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor={`${formId}-reason`}
              className="text-xs font-medium text-foreground"
            >
              Reason{" "}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </label>
            <span
              className={`text-[11px] tabular-nums ${charCount > 480 ? "text-amber-600" : "text-muted-foreground"}`}
              aria-live="polite"
              aria-label={`${charCount} of 500 characters used`}
            >
              {charCount}/500
            </span>
          </div>
          <textarea
            id={`${formId}-reason`}
            required
            rows={3}
            maxLength={500}
            value={form.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="Describe the reason (minimum 10 characters)…"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor={`${formId}-doc`}
            className="block text-xs font-medium text-foreground"
          >
            Supporting document{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id={`${formId}-doc`}
            type="url"
            value={form.docUrl}
            onChange={(e) => patch({ docUrl: e.target.value })}
            placeholder="https://drive.google.com/…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>
            {busy ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Submitting…
              </span>
            ) : (
              "Submit Request"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

const NotificationsModal = memo(function NotificationsModal({
  open,
  onClose,
  notifications,
  onRead,
}: {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  onRead: (id: string) => Promise<void>;
}) {
  const ITEM_HEIGHT = 88;
  const CONTAINER_HEIGHT = Math.min(
    notifications.length * ITEM_HEIGHT,
    400,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notifications"
      maxWidth="max-w-md"
    >
      {notifications.length === 0 ? (
        <EmptyState icon={Bell} message="No notifications yet." />
      ) : (
        <div aria-live="polite" aria-label="Notifications list">
          <VirtualList
            items={notifications}
            itemHeight={ITEM_HEIGHT}
            containerHeight={CONTAINER_HEIGHT || 200}
            keyExtractor={(n) => n.id}
            renderItem={(n) => (
              <button
                onClick={() => !n.read && onRead(n.id)}
                disabled={n.read}
                aria-label={n.read ? n.title : `Mark as read: ${n.title}`}
                className={[
                  "w-full h-full rounded-lg border p-3 text-left text-sm",
                  "transition-colors focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  n.read
                    ? "border-border bg-card opacity-60 cursor-default"
                    : "border-primary/30 bg-primary/5 hover:bg-primary/10",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-xs text-foreground line-clamp-1">
                    {n.title}
                  </span>
                  {!n.read && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {n.message}
                </p>
                <time
                  className="mt-1 block text-[10px] text-muted-foreground"
                  dateTime={n.created_at}
                >
                  {fmtDateTime(n.created_at)}
                </time>
              </button>
            )}
          />
        </div>
      )}
    </Modal>
  );
});

function TrajectoryModal({
  open,
  onClose,
  course,
}: {
  open: boolean;
  onClose: () => void;
  course: { courseId: string; code: string; name: string; percentage: number; attended: number; totalHeld: number } | null;
}) {
  const calcTrajectory = useStableServerFn(useServerFn(calculateAttendanceGoalTrajectory));
  const [targetPct, setTargetPct] = useState(75);
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && course) {
      setLoading(true);
      calcTrajectory({ data: { courseId: course.courseId, targetPct } })
        .then(setResult)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, course, targetPct, calcTrajectory]);

  if (!course) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Attendance Trajectory: ${course.code}`}>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
          <p className="text-xs font-semibold text-foreground">{course.name}</p>
          <p className="text-xs text-muted-foreground">
            Current: <strong className="text-foreground">{course.percentage.toFixed(1)}%</strong> ({course.attended}/{course.totalHeld} classes attended)
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium">
            <label htmlFor="target-pct-slider">Target Attendance Goal</label>
            <span className="font-bold text-primary">{targetPct}%</span>
          </div>
          <input
            id="target-pct-slider"
            type="range"
            min={60}
            max={95}
            step={1}
            value={targetPct}
            onChange={(e) => setTargetPct(Number(e.target.value))}
            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>60% (Shortage)</span>
            <span>75% (Eligible)</span>
            <span>90% (Distinction)</span>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" /> Calculating trajectory…
          </div>
        ) : result ? (
          <div
            className={`rounded-lg border p-4 text-center space-y-2 ${
              result.status === "TARGET_ACHIEVED"
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300"
            }`}
          >
            {result.status === "TARGET_ACHIEVED" ? (
              <>
                <p className="text-sm font-bold">🎉 Target Already Achieved!</p>
                <p className="text-xs">
                  Your current attendance ({result.currentAttendancePct}%) meets or exceeds your target of {targetPct}%.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold">🎯 Trajectory Goal Requirement</p>
                <p className="text-2xl font-black tabular-nums my-1">
                  Attend next {result.classesNeeded} consecutive class{result.classesNeeded === 1 ? "" : "es"}
                </p>
                <p className="text-xs">
                  To raise your attendance from {result.currentAttendancePct}% to your target of {targetPct}%.
                </p>
              </>
            )}
          </div>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={onClose}>
            Close Simulator
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DataSubjectRightsCard({ userId }: { userId: string }) {
  const downloadFn = useServerFn(downloadMyData);
  const deleteReqFn = useServerFn(requestAccountDeletion);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleDownload = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await downloadFn({ data: { userId } });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `presence_erp_my_data_${userId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("🎉 Data export generated and downloaded under DPDP Act 2023 Section 11.");
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (!confirm("Are you sure you want to request complete account deletion under DPDP Act 2023 Section 12?")) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await deleteReqFn({
        data: { userId, reason: "Student right-to-erasure request" },
      });
      setMsg(`🎉 Deletion ticket ${res.ticketId} created. DPDP Officer will process within statutory period.`);
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <span>🛡️</span> Statutory DPDP Act 2023 &amp; Privacy Rights
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Download machine-readable personal data or exercise right-to-erasure.
          </p>
        </div>
        <div className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-[10px] font-bold text-indigo-400">
          DPDP Act 2023 Compliant
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy}
          onClick={handleDownload}
          size="sm"
          className="bg-indigo-600 hover:bg-indigo-500 font-bold"
        >
          📥 Download My Machine-Readable Data (JSON)
        </Button>
        <Button
          disabled={busy}
          onClick={handleRequestDeletion}
          variant="outline"
          size="sm"
          className="border-red-600/30 text-red-500 hover:bg-red-600/10 font-bold"
        >
          🗑️ Request Complete Account Erasure
        </Button>
      </div>

      {msg && <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{msg}</p>}

      <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
        <span className="text-base">⚖️</span>
        <div>
          <strong className="text-foreground">Designated Grievance Redressal Officer:</strong> Nitin Kumar
          <br />
          Email: <span className="font-mono text-indigo-500">grievance.officer@university.edu</span> | Phone: +91 79 6812 6800
          <br />
          <span className="text-[10px] opacity-80">Statutory 30-day resolution deadline enforced for all data privacy complaints.</span>
        </div>
      </div>
    </Card>
  );
}

function StudentDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toasts, showToast, dismissToast } = useToast();

  const fetchDashboard = useStableServerFn(useServerFn(getStudentDashboard));
  const startDemo = useStableServerFn(useServerFn(getOrCreateActiveDemoSession));
  const sendLeave = useStableServerFn(useServerFn(submitLeaveRequest));
  const getLeaves = useStableServerFn(useServerFn(listMyLeaveRequests));
  const cancelLeave = useStableServerFn(useServerFn(cancelLeaveRequest));
  const getBalances = useStableServerFn(useServerFn(getMyLeaveBalances));
  const getNotifs = useStableServerFn(useServerFn(getNotifications));
  const readNotif = useStableServerFn(useServerFn(markNotificationRead));
  const exportIcs = useStableServerFn(useServerFn(exportLeaveIcsFeed));

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [trajectoryCourse, setTrajectoryCourse] = useState<any | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [isTabVisible, setIsTabVisible] = useState(true);
  const [demoStarting, setDemoStarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentPage, setRecentPage] = useState(0);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    const vis = () => setIsTabVisible(document.visibilityState === "visible");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const {
    data,
    isLoading,
    error: dashError,
    refetch,
  } = useQuery({
    queryKey: ["student-dashboard"],
    queryFn: fetchDashboard,
    refetchInterval: isTabVisible && isOnline ? POLL_INTERVAL_MS : false,
    staleTime: 10_000,
  });

  const dashboardRetry = useRetryWithBackoff(() => {
    void refetch();
  });

  useEffect(() => {
    const channel = supabase
      .channel("student-dashboard-rt")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "class_sessions",
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["student-dashboard"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: leaves, refetch: refetchLeaves } = useQuery({
    queryKey: ["my-leaves"],
    queryFn: getLeaves,
    staleTime: 30_000,
  });

  const { data: notifications, refetch: refetchNotifs } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: getNotifs,
    staleTime: 60_000,
  });

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ["my-leave-balances"],
    queryFn: getBalances,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!isOnline) return;
    const queue = offlineQueue.getLeaveQueue();
    if (queue.length === 0) return;
    offlineQueue
      .flushLeaveQueue(async (req) => {
        await sendLeave({
          data: {
            startDate: req.startDate,
            endDate: req.endDate,
            reason: req.reason,
            requestType: req.requestType,
          },
        });
      })
      .then(({ syncedCount, conflictCount }) => {
        if (syncedCount > 0) {
          void refetchLeaves();
          showToast(
            `${syncedCount} offline leave request${syncedCount > 1 ? "s" : ""} synced.`,
            "success",
          );
        }
        if (conflictCount > 0) {
          showToast(
            `${conflictCount} request${conflictCount > 1 ? "s" : ""} could not sync — date overlap.`,
            "error",
          );
        }
      })
      .catch(() => showToast("Could not sync offline requests.", "error"));
  }, [isOnline, refetchLeaves, showToast, sendLeave]);

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) =>
      cancelLeave({ data: { requestId } }),
    onMutate: async (requestId) => {
      await queryClient.cancelQueries({ queryKey: ["my-leaves"] });
      const snapshot = queryClient.getQueryData<typeof leaves>(["my-leaves"]);
      if (snapshot) {
        queryClient.setQueryData(
          ["my-leaves"],
          snapshot.map((l: any) =>
            l.id === requestId ? { ...l, status: "cancelled" } : l,
          ),
        );
      }
      return { snapshot };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.snapshot)
        queryClient.setQueryData(["my-leaves"], ctx.snapshot);
      showToast("Could not cancel the request. Please try again.", "error");
    },
    onSuccess: () => showToast("Leave request cancelled.", "success"),
    onSettled: () => {
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-leaves"] });
    },
  });

  const handleNotifRead = useCallback(
    async (id: string) => {
      try {
        await readNotif({ data: { id } });
        queryClient.setQueryData(
          ["my-notifications"],
          (old: typeof notifications) =>
            (old ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
      } catch {
        showToast("Could not mark notification as read.", "error");
      }
    },
    [queryClient, showToast, readNotif],
  );

  const handleExportIcs = useCallback(async () => {
    try {
      const res = await exportIcs();
      const blob = new Blob([res.icsContent], {
        type: "text/calendar;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: "leave_schedule.ics",
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      showToast("Calendar exported.", "success");
    } catch {
      showToast("Could not export calendar.", "error");
    }
  }, [exportIcs, showToast]);

  const handleDemoStart = useCallback(async () => {
    if (demoStarting) return;
    setDemoStarting(true);
    try {
      const res = await startDemo();
      navigate({
        to: "/attend/$sessionId",
        params: { sessionId: res.sessionId },
      });
    } catch (err) {
      showToast(normalizeError(err), "error");
    } finally {
      setDemoStarting(false);
    }
  }, [demoStarting, navigate, showToast, startDemo]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetch(),
        refetchLeaves(),
        refetchNotifs(),
        queryClient.invalidateQueries({ queryKey: ["my-leave-balances"] }),
        queryClient.invalidateQueries({ queryKey: ["my-exam-results"] }),
        queryClient.invalidateQueries({ queryKey: ["my-invoices"] }),
      ]);
    } finally {
      setTimeout(() => setIsRefreshing(false), 600);
    }
  }, [isRefreshing, refetch, refetchLeaves, refetchNotifs, queryClient]);

  useKeyboardShortcuts({
    r: handleRefresh,
    l: () => setShowLeaveModal(true),
    n: () => setShowNotifModal(true),
    f: handleDemoStart,
  });

  const unreadCount = useMemo(
    () => (notifications ?? []).filter((n) => !n.read).length,
    [notifications],
  );

  const shortageCourses = useMemo(
    () => (data?.courses ?? []).filter((c) => c.status === "shortage"),
    [data?.courses],
  );

  const paginatedRecent = useMemo(() => {
    const all = data?.recent ?? [];
    const start = recentPage * RECENT_CHECKINS_PAGE_SIZE;
    return {
      items: all.slice(start, start + RECENT_CHECKINS_PAGE_SIZE),
      totalPages: Math.ceil(all.length / RECENT_CHECKINS_PAGE_SIZE),
      total: all.length,
    };
  }, [data?.recent, recentPage]);

  const studentTabItems = useMemo(
    () => [
      { id: "attendance", label: "My Attendance Log" },
      { id: "leaves", label: "Leave & OD Quotas" },
      { id: "exams", label: "Exams & Results" },
      { id: "fees", label: "Fee Invoices" },
      { id: "ask", label: "Ask Presence 🤖" },
      { id: "help", label: "Help & FAQ" },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <StudentOnboardingWizard />
      <ERPDayWiseTimesheet
        adminTabs={studentTabItems}
        headerTitle="⚡ Student Quick Navigation"
        onOpenNotifications={() => setShowNotifModal(true)}
        onOpenSettings={() => navigate({ to: "/enroll" })}
        onOpenProfile={() => navigate({ to: "/enroll" })}
      >
      <main
        id="main-content"
        className="mx-auto max-w-6xl px-6 py-8 space-y-5"
        aria-label="Student attendance dashboard"
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          Skip to main content
        </a>

        <OfflineBanner isOnline={isOnline} />

        {data?.upcoming && (
          <SectionErrorBoundary sectionName="Live Session">
            <LiveSessionTicker sessions={data.upcoming} />
          </SectionErrorBoundary>
        )}

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight">
                My Attendance
              </h1>
              <NetworkQualityIndicator />
              {data && <StaleIndicator dataVersion={data} />}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Minimum {(data as any)?.statutoryThreshold ?? 75}% required for exam
              eligibility.
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-2"
            role="toolbar"
            aria-label="Dashboard actions"
          >
            <KeyboardShortcutsHint />

            {data && (
              <SectionErrorBoundary sectionName="Print">
                <PrintAttendanceReport
                  studentName={(data as any).studentName ?? null}
                  rollNo={(data as any).rollNo ?? null}
                  overall={data.overall}
                  courses={data.courses}
                />
              </SectionErrorBoundary>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNotifModal(true)}
              aria-label={
                unreadCount > 0
                  ? `Notifications — ${unreadCount} unread`
                  : "Notifications"
              }
              className="relative"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>

            <Button
              size="sm"
              disabled={demoStarting}
              aria-busy={demoStarting}
              onClick={handleDemoStart}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
            >
              {demoStarting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "📸"
              )}
              {demoStarting ? "Opening…" : "Face Attendance"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLeaveModal(true)}
            >
              <Calendar className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Apply Leave / OD
            </Button>

            <Link to="/enroll">
              <Button variant="outline" size="sm">
                Profile & Biometrics
              </Button>
            </Link>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label={isRefreshing ? "Refreshing…" : "Refresh dashboard"}
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </div>
        </header>

        {isLoading && <DashboardSkeleton />}

        {dashError && !isLoading && (
          <ErrorBanner
            message={normalizeError(dashError)}
            onRetry={dashboardRetry.retry}
            isWaiting={dashboardRetry.isWaiting}
            nextRetryMs={dashboardRetry.nextRetryMs}
            retryLabel={
              dashboardRetry.attemptCount > 0
                ? `Retry (attempt ${dashboardRetry.attemptCount + 1})`
                : "Retry"
            }
          />
        )}

        {!isLoading && !dashError && data && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base font-medium">
                  <span>Overall Attendance</span>
                  <StatusBadge status={data.overall.status} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div
                      className="text-4xl font-bold tabular-nums"
                      aria-label={`${data.overall.percentage.toFixed(1)} percent overall attendance`}
                    >
                      {data.overall.percentage.toFixed(1)}%
                    </div>
                    <p
                      id="overall-desc"
                      className="mt-1 text-sm text-muted-foreground"
                    >
                      {data.overall.attended} of {data.overall.totalHeld}{" "}
                      classes attended
                    </p>
                  </div>
                  <div className="w-full sm:w-1/2">
                    <Progress
                      value={Math.min(100, data.overall.percentage)}
                      className="h-3"
                      indicatorClassName={statusIndicatorClass(
                        data.overall.status,
                      )}
                      aria-label="Overall attendance progress"
                      aria-describedby="overall-desc"
                      aria-valuenow={Math.round(data.overall.percentage)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                    <p className="mt-1 text-right text-xs text-muted-foreground">
                      Target {(data as any).statutoryThreshold ?? 75}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {shortageCourses.length > 0 && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3"
              >
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <div className="text-sm">
                  <p className="font-semibold text-red-700 dark:text-red-400">
                    Attendance shortage in{" "}
                    {shortageCourses.length === 1
                      ? "1 course"
                      : `${shortageCourses.length} courses`}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {shortageCourses.map((c) => c.code).join(", ")} — attend
                    upcoming classes to restore eligibility.
                  </p>
                </div>
              </div>
            )}

            {balancesLoading ? (
              <CardSkeleton />
            ) : balances && balances.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base font-medium">
                    <span>Leave & Duty Quotas</span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={handleExportIcs}
                      >
                        <Calendar className="h-3.5 w-3.5" />
                        Export .ics
                      </Button>
                      <span className="text-xs font-normal text-muted-foreground">
                        AY 2025–2026
                      </span>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                    {balances.map((b) => {
                      const remaining = Math.max(0, b.allocated - b.used);
                      const pct = Math.min(
                        100,
                        Math.round(
                          (b.used / Math.max(b.allocated, 1)) * 100,
                        ),
                      );
                      const isLow = remaining <= 2;
                      return (
                        <div
                          key={b.id}
                          className={[
                            "rounded-lg border p-3 space-y-1.5 transition-colors",
                            isLow
                              ? "border-amber-500/40 bg-amber-500/5"
                              : "border-border",
                          ].join(" ")}
                          aria-label={`${b.leave_type}: ${remaining} days remaining`}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold uppercase">
                            <span>{b.leave_type}</span>
                            <span
                              className={
                                isLow
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                              }
                            >
                              {remaining} left
                            </span>
                          </div>
                          <Progress value={pct} className="h-2" />
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span>{b.used} used</span>
                            <span>{b.allocated} total</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {leaves !== undefined && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-medium">
                    My Leave & OD Requests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {leaves.length === 0 ? (
                    <EmptyState
                      icon={Calendar}
                      message="No leave or OD requests yet."
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowLeaveModal(true)}
                        >
                          Apply for Leave
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2" role="list">
                      {leaves.map((l: any) => (
                        <div
                          key={l.id}
                          role="listitem"
                          className={[
                            "flex flex-wrap items-start justify-between gap-3",
                            "rounded-lg border p-3 text-sm transition-colors",
                            l.status === "pending"
                              ? "border-amber-500/30 bg-amber-500/5"
                              : "border-border",
                          ].join(" ")}
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-semibold uppercase">
                              {l.request_type}{" "}
                              <span className="font-normal text-muted-foreground">
                                ({l.leave_type})
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {fmtDate(l.start_date)} → {fmtDate(l.end_date)}
                            </div>
                             {l.assignedTeacherName && (
                              <div className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                                Assigned Teacher: {l.assignedTeacherName}
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                              &ldquo;{l.reason}&rdquo;
                            </p>
                            {l.rejection_reason && (
                              <p className="mt-1 text-xs font-medium text-destructive">
                                Rejection: &ldquo;{l.rejection_reason}&rdquo;
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                l.status === "approved"
                                  ? "default"
                                  : l.status === "rejected" ||
                                      l.status === "cancelled"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {l.status}
                            </Badge>
                            {l.status === "pending" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                                onClick={() => setCancelTarget(l.id)}
                                aria-label={`Cancel leave from ${fmtDate(l.start_date)}`}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">
                  Upcoming Classes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.upcoming.length === 0 ? (
                  <EmptyState
                    icon={Calendar}
                    message="No classes in the next 14 days."
                  />
                ) : (
                  <div className="space-y-2" role="list">
                    {data.upcoming.map((u) => {
                      const tooEarly =
                        new Date(u.startsAt).getTime() > Date.now() + 5 * 60_000;
                      return (
                        <div
                          key={u.sessionId}
                          role="listitem"
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                        >
                          <div>
                            <div className="font-medium text-sm">
                              {u.courseCode} · {u.courseName}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              <time dateTime={u.startsAt}>
                                {fmtDateTime(u.startsAt)}
                              </time>
                            </div>
                          </div>
                          <div>
                            {u.alreadyMarked ? (
                              <Badge variant="secondary">
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Marked
                              </Badge>
                            ) : (
                              <Link
                                to="/attend/$sessionId"
                                params={{ sessionId: u.sessionId }}
                              >
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={tooEarly}
                                  aria-label={
                                    tooEarly
                                      ? `${u.courseName} — not open yet`
                                      : `Check in to ${u.courseName}`
                                  }
                                >
                                  {tooEarly ? "Not open yet" : "Check in"}
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">
                  Subject-wise Attendance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.courses.length === 0 ? (
                  <EmptyState
                    icon={BookOpen}
                    message="Not enrolled in any courses yet. Contact your administrator."
                  />
                ) : (
                  <div className="space-y-4">
                    {data.courses.map((c) => {
                      const thresholdPct = (data as any).statutoryThreshold ?? 75;
                      return (
                        <div
                          key={c.courseId}
                          className="rounded-lg border border-border p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-sm">
                                {c.code} · {c.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {c.teacherName
                                  ? `Faculty: ${c.teacherName}`
                                  : "Faculty: —"}
                                {c.semesterCode ? ` · ${c.semesterCode}` : ""}
                              </div>
                            </div>
                            <div className="text-right">
                              <div
                                className="text-2xl font-bold tabular-nums"
                                aria-label={`${c.percentage.toFixed(1)} percent`}
                              >
                                {c.percentage.toFixed(1)}%
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {c.attended}/{c.totalHeld} classes
                              </div>
                            </div>
                          </div>
                          <Progress
                            value={Math.min(100, c.percentage)}
                            className="mt-3 h-2"
                            indicatorClassName={statusIndicatorClass(c.status)}
                            aria-label={`${c.code} attendance`}
                            aria-valuenow={Math.round(c.percentage)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={c.status} />
                              {c.status === "safe" && c.totalHeld > 0 && (
                                <span className="text-muted-foreground">
                                  Can miss{" "}
                                  <strong className="text-foreground">
                                    {c.bunkable}
                                  </strong>{" "}
                                  more class{c.bunkable === 1 ? "" : "es"} and
                                  stay above {thresholdPct}%.
                                </span>
                              )}
                              {c.status !== "safe" && c.totalHeld > 0 && (
                                <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                  <TrendingDown
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  Attend next{" "}
                                  <strong>{c.needToAttend}</strong> class
                                  {c.needToAttend === 1 ? "" : "es"} to reach{" "}
                                  {thresholdPct}%.
                                </span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-xs text-primary hover:bg-primary/10 gap-1 ml-auto"
                              onClick={() => setTrajectoryCourse(c)}
                            >
                              <Target className="h-3.5 w-3.5" /> Goal Simulator
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <SectionErrorBoundary sectionName="Exam Results">
              <Suspense fallback={<CardSkeleton />}>
                <ExamResultsCard />
              </Suspense>
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Fee Invoices">
              <Suspense fallback={<CardSkeleton />}>
                <FeesCard showToast={showToast} />
              </Suspense>
            </SectionErrorBoundary>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base font-medium">
                  <span>Recent Check-ins</span>
                  {paginatedRecent.total > RECENT_CHECKINS_PAGE_SIZE && (
                    <span className="text-xs font-normal text-muted-foreground">
                      Showing {recentPage * RECENT_CHECKINS_PAGE_SIZE + 1}–
                      {Math.min(
                        (recentPage + 1) * RECENT_CHECKINS_PAGE_SIZE,
                        paginatedRecent.total,
                      )}{" "}
                      of {paginatedRecent.total}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {paginatedRecent.items.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    message="No check-ins recorded yet."
                  />
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Course</TableHead>
                          <TableHead>Decision</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right">Match</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedRecent.items.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs">
                              <time dateTime={r.createdAt}>
                                {fmtDateTime(r.createdAt)}
                              </time>
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.courseCode ?? "—"}
                            </TableCell>
                            <TableCell>
                              <DecisionBadge decision={r.decision} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {r.reasonCode ?? "—"}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {r.similarity !== null
                                ? r.similarity.toFixed(3)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {paginatedRecent.totalPages > 1 && (
                      <div
                        className="mt-3 flex items-center justify-between"
                        role="navigation"
                        aria-label="Check-in history pagination"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setRecentPage((p) => Math.max(0, p - 1))
                          }
                          disabled={recentPage === 0}
                          aria-label="Previous page"
                        >
                          ← Previous
                        </Button>
                        <span
                          className="text-xs text-muted-foreground"
                          aria-current="page"
                        >
                          Page {recentPage + 1} of {paginatedRecent.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setRecentPage((p) =>
                              Math.min(paginatedRecent.totalPages - 1, p + 1),
                            )
                          }
                          disabled={
                            recentPage >= paginatedRecent.totalPages - 1
                          }
                          aria-label="Next page"
                        >
                          Next →
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            <div className="mt-6">
              <DataSubjectRightsCard userId={(data as any)?.studentId || ""} />
            </div>
          </>
        )}
      </main>
      </ERPDayWiseTimesheet>

      <LeaveModal
        open={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        onSubmitSuccess={(wasOffline) => {
          showToast(
            wasOffline
              ? "Saved offline — will sync when you reconnect."
              : "Leave request submitted successfully.",
            "success",
          );
          queryClient.invalidateQueries({ queryKey: ["my-leaves"] });
          queryClient.invalidateQueries({ queryKey: ["student-dashboard"] });
        }}
        submitFn={sendLeave}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel Leave Request"
        description="Are you sure you want to cancel this leave request? This action cannot be undone."
        confirmLabel="Yes, Cancel Request"
        cancelLabel="Keep Request"
        onConfirm={() => {
          if (cancelTarget) cancelMutation.mutate(cancelTarget);
        }}
        onCancel={() => setCancelTarget(null)}
        busy={cancelMutation.isPending}
      />

      <NotificationsModal
        open={showNotifModal}
        onClose={() => setShowNotifModal(false)}
        notifications={notifications ?? []}
        onRead={handleNotifRead}
      />

      <TrajectoryModal
        open={!!trajectoryCourse}
        onClose={() => setTrajectoryCourse(null)}
        course={trajectoryCourse}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
