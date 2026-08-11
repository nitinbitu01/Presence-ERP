import { useState, useEffect } from "react";
import { KeyRound, Copy, Check, RefreshCw, Clock } from "lucide-react";

interface OtpDisplayCardProps {
  sessionId: string;
  otp: string;
  onRefreshOtp: (sessionId: string) => Promise<void>;
  ttlSeconds?: number;
}

export function OtpDisplayCard({
  sessionId,
  otp,
  onRefreshOtp,
  ttlSeconds = 180, // Default 3 minutes TTL
}: OtpDisplayCardProps) {
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ttlSeconds);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setTimeLeft(ttlSeconds);
  }, [otp, ttlSeconds]);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const handleCopy = () => {
    navigator.clipboard.writeText(otp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshOtp(sessionId);
      setTimeLeft(ttlSeconds);
    } catch (e) {
      console.error("Failed to refresh OTP:", e);
    } finally {
      setRefreshing(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const progressPct = Math.round((timeLeft / ttlSeconds) * 100);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <KeyRound className="h-4 w-4" />
          Active Classroom OTP
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          {timeLeft > 0 ? (
            <span>Expires in {formatTime(timeLeft)}</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400 font-semibold">OTP Expired</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 bg-background/80 rounded-lg p-2 border border-border">
        <span className="font-mono text-2xl font-bold tracking-widest text-foreground px-2">
          {otp}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            title="Copy OTP to clipboard"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            title="Generate new OTP"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-1000 ${
            progressPct > 50
              ? "bg-emerald-500"
              : progressPct > 20
                ? "bg-amber-500"
                : "bg-destructive"
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
