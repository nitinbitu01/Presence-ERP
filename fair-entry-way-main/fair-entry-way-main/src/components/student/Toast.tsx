// src/components/student/Toast.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { X, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { createPortal } from "react-dom";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

/**
 * Toast duration scales with message length so users have
 * enough time to read longer messages.
 */
function computeDuration(message: string): number {
  const words = message.split(/\s+/).length;
  // ~200 words per minute reading speed, minimum 3s, maximum 10s
  return Math.min(10_000, Math.max(3_000, (words / 200) * 60_000));
}

function SingleToast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(item.id), 300); // Wait for exit animation
  };

  useEffect(() => {
    const duration = computeDuration(item.message);
    timerRef.current = setTimeout(dismiss, duration);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const styles: Record<ToastType, string> = {
    success: "bg-emerald-950 border-emerald-500/40 text-emerald-100",
    error: "bg-red-950 border-red-500/40 text-red-100",
    info: "bg-slate-900 border-slate-500/40 text-slate-100",
  };

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />,
    error: <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />,
    info: <Info className="h-4 w-4 shrink-0 text-slate-400" />,
  };

  return (
    <div
      role={item.type === "error" ? "alert" : "status"}
      aria-live={item.type === "error" ? "assertive" : "polite"}
      className={[
        "flex items-start gap-3 rounded-lg border px-4 py-3 shadow-xl text-sm",
        "transition-all duration-300",
        visible
          ? "animate-in slide-in-from-right-4 fade-in opacity-100 translate-x-0"
          : "opacity-0 translate-x-4",
        styles[item.type],
      ].join(" ")}
    >
      {icons[item.type]}
      <span className="flex-1 leading-relaxed">{item.message}</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="mt-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Toast stack — renders up to 5 toasts stacked from the bottom right.
 * Import useToast() to show toasts from any component.
 */
export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (typeof document === "undefined" || toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 w-full max-w-sm"
      aria-label="Notifications"
    >
      {toasts.slice(-5).map((t) => (
        <SingleToast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

/**
 * Hook to manage toast state.
 * Use in your root dashboard component and pass showToast down.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (message: string, type: ToastType = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, showToast, dismissToast };
}
