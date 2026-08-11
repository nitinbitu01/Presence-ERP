import React, { useEffect, useState } from "react";
import { AlertCircle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CheckInNetworkGuardProps {
  isCheckingIn: boolean;
  timeoutMs?: number;
  onTimeout?: () => void;
  onRetry?: () => void;
}

export const CheckInNetworkGuard: React.FC<CheckInNetworkGuardProps> = ({
  isCheckingIn,
  timeoutMs = 10_000,
  onTimeout,
  onRetry,
}) => {
  const [timedOut, setTimedOut] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isCheckingIn) {
      setTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      setTimedOut(true);
      if (onTimeout) onTimeout();
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [isCheckingIn, timeoutMs, onTimeout]);

  if (isOffline) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-300">
        <div className="flex items-center gap-2 font-semibold">
          <WifiOff className="h-5 w-5 text-amber-600" />
          No Network Connection Detected
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Biometric check-in requires a live server connection for anti-proxy verification. Please
          connect to campus Wi-Fi or mobile data and try again.
        </p>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <AlertCircle className="h-5 w-5" />
          Connection Timed Out (Weak Signal)
        </div>
        <p className="text-xs text-muted-foreground">
          The check-in request took longer than {timeoutMs / 1000} seconds due to patchy campus
          network coverage.
        </p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry Check-in
          </Button>
        )}
      </div>
    );
  }

  return null;
};
