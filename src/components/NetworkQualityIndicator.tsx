import React, { useEffect, useState } from "react";
import { Signal, SignalLow, WifiOff } from "lucide-react";

export interface NetworkStatusInfo {
  online: boolean;
  effectiveType: string;
  rttMs: number | null;
  downlinkMbps: number | null;
}

interface NetworkInformationApi {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export const NetworkQualityIndicator: React.FC = () => {
  const [netStatus, setNetStatus] = useState<NetworkStatusInfo>({
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    effectiveType: "4g",
    rttMs: 30,
    downlinkMbps: 10,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nav = navigator as unknown as Record<string, NetworkInformationApi | undefined>;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

    const updateStatus = () => {
      setNetStatus({
        online: navigator.onLine,
        effectiveType: conn?.effectiveType ?? (navigator.onLine ? "4g" : "offline"),
        rttMs: conn?.rtt ?? (navigator.onLine ? 30 : null),
        downlinkMbps: conn?.downlink ?? (navigator.onLine ? 10 : null),
      });
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    if (conn && typeof conn.addEventListener === "function") {
      conn.addEventListener("change", updateStatus);
    }

    updateStatus();

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
      if (conn && typeof conn.removeEventListener === "function") {
        conn.removeEventListener("change", updateStatus);
      }
    };
  }, []);

  if (!netStatus.online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive">
        <WifiOff className="h-3.5 w-3.5" />
        Offline
      </span>
    );
  }

  const isSlow =
    netStatus.effectiveType === "2g" ||
    netStatus.effectiveType === "slow-2g" ||
    (netStatus.rttMs ?? 0) > 300;

  if (isSlow) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <SignalLow className="h-3.5 w-3.5 text-amber-500" />
        Weak Signal ({netStatus.effectiveType.toUpperCase()})
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <Signal className="h-3.5 w-3.5 text-emerald-500" />
      {netStatus.effectiveType.toUpperCase()}
      {netStatus.rttMs ? ` (${netStatus.rttMs}ms)` : ""}
    </span>
  );
};
