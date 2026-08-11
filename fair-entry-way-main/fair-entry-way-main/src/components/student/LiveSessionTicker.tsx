// src/components/student/LiveSessionTicker.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Updates every second so the "Live now" badge appears at the correct moment
// without waiting for the next 30-second poll.
import { useState, useEffect, memo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

interface Session {
  sessionId: string;
  courseCode: string;
  courseName: string;
  teacherName?: string | null;
  startsAt: string;
  endsAt: string;
  isActive?: boolean;
  alreadyMarked: boolean;
}

interface Props {
  sessions: Session[];
}

/**
 * Ticks every second to keep live session state accurate.
 * Isolated here so only this component re-renders on each tick,
 * not the entire dashboard.
 */
export const LiveSessionTicker = memo(function LiveSessionTicker({ sessions }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const liveSession = sessions.find((u) => {
    const start = new Date(u.startsAt).getTime();
    const end = new Date(u.endsAt).getTime();
    return ((now >= start && now <= end) || Boolean(u.isActive)) && !u.alreadyMarked;
  });

  if (!liveSession) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      className={[
        "rounded-2xl border border-indigo-500/40",
        "bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-950",
        "p-5 text-white shadow-xl",
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4",
        "animate-in fade-in slide-in-from-top-2",
      ].join(" ")}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span
            className="flex h-3 w-3 rounded-full bg-emerald-400 animate-pulse"
            aria-hidden="true"
          />
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Live Class — Attendance Open
          </span>
        </div>
        <h2 className="text-lg font-extrabold">
          {liveSession.courseCode} — {liveSession.courseName}
        </h2>
        {liveSession.teacherName && (
          <p className="text-xs text-indigo-200">Faculty: {liveSession.teacherName}</p>
        )}
      </div>
      <Link
        to="/attend/$sessionId"
        params={{ sessionId: liveSession.sessionId }}
        aria-label={`Mark attendance for ${liveSession.courseName}`}
      >
        <Button
          size="lg"
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-lg shadow-emerald-500/30"
        >
          📸 Mark Attendance Now
        </Button>
      </Link>
    </div>
  );
});
