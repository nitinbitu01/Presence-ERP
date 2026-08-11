import React, { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { offlineQueue, type QueueSyncStatus } from "@/lib/offline-queue";

export const OfflineSyncStatus: React.FC = () => {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [status, setStatus] = useState<QueueSyncStatus>({
    pending: 0,
    synced: 0,
    failed: 0,
    conflicted: 0,
    totalItems: 0,
    oldestPendingMs: null,
    lastSyncAttemptMs: null,
  });

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      setStatus(offlineQueue.getSyncStatus());
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  const ageMs = offlineQueue.getQueueAgeMs();
  const ageMinutes = ageMs !== null ? Math.floor(ageMs / 60000) : null;

  if (status.totalItems === 0 && online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Sync status: ${online ? "Online" : "Offline"}, ${status.pending} pending`}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm border ${
        !online
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : status.failed > 0
            ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
            : status.pending > 0
              ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      }`}
    >
      {!online ? (
        <WifiOff className="h-3 w-3" aria-hidden="true" />
      ) : status.pending > 0 ? (
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : status.failed > 0 ? (
        <AlertCircle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <CheckCircle className="h-3 w-3" aria-hidden="true" />
      )}
      <span>
        {!online
          ? `Offline${status.pending > 0 ? ` — ${status.pending} queued` : ""}`
          : status.pending > 0
            ? `Syncing ${status.pending} item${status.pending > 1 ? "s" : ""}...`
            : status.failed > 0
              ? `${status.failed} failed to sync`
              : "All synced"}
      </span>
      {ageMinutes !== null && ageMinutes > 5 && (
        <span className="opacity-70">— {ageMinutes}m ago</span>
      )}
    </div>
  );
};
