// src/components/student/StaleIndicator.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { useLastUpdated } from "@/lib/useLastUpdated";
import { Clock } from "lucide-react";

export function StaleIndicator({ dataVersion }: { dataVersion: unknown }) {
  const label = useLastUpdated(dataVersion);
  if (!label) return null;

  return (
    <span
      className="flex items-center gap-1 text-[11px] text-muted-foreground"
      aria-live="polite"
      aria-atomic="true"
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
