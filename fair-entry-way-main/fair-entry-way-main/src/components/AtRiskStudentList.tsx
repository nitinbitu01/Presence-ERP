import React from "react";
import { AlertTriangle, TrendingDown, Bell, CheckCircle2 } from "lucide-react";

interface AtRiskStudent {
  studentId: string;
  displayName: string;
  rollNo: string;
  semesterAvgPct: number;
  last14DayPct: number;
  trendSlope: number;
  weeksToThreshold: number;
  urgency: "critical" | "high" | "medium";
}

interface AtRiskStudentListProps {
  students: AtRiskStudent[];
  onNotifyStudent?: (studentId: string) => void;
}

export function AtRiskStudentList({ students, onNotifyStudent }: AtRiskStudentListProps) {
  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-2xl border border-border shadow-sm">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-foreground">All students on track!</h3>
        <p className="text-muted-foreground mt-2 max-w-sm">
          No students are currently at risk of falling below the attendance threshold.
        </p>
      </div>
    );
  }

  // Sort: critical > high > medium, then by semesterAvgPct ascending
  const sortedStudents = [...students].sort((a, b) => {
    const urgencyWeight = { critical: 3, high: 2, medium: 1 };
    if (urgencyWeight[a.urgency] !== urgencyWeight[b.urgency]) {
      return urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
    }
    return a.semesterAvgPct - b.semesterAvgPct;
  });

  return (
    <div className="w-full bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="p-5 border-b border-border bg-muted/30">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          At-Risk Students Watchlist
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Predictive alerts based on 14-day rolling trends and semester averages.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
            <tr>
              <th className="px-6 py-3 font-semibold">Student</th>
              <th className="px-6 py-3 font-semibold text-center">Sem Avg</th>
              <th className="px-6 py-3 font-semibold text-center">Trend (14d)</th>
              <th className="px-6 py-3 font-semibold text-center">Est. Time to Threshold</th>
              <th className="px-6 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedStudents.map((s) => {
              const bgClass =
                s.urgency === "critical"
                  ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/10 dark:hover:bg-red-950/20"
                  : s.urgency === "high"
                    ? "bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
                    : "bg-card hover:bg-muted/30";

              const badgeClass =
                s.urgency === "critical"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200"
                  : s.urgency === "high"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200";

              return (
                <tr key={s.studentId} className={`transition-colors ${bgClass}`}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${badgeClass}`}
                      >
                        {s.urgency}
                      </span>
                      <div>
                        <div className="font-bold text-foreground">{s.displayName}</div>
                        <div className="text-xs text-muted-foreground">{s.rollNo}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-mono font-semibold">{s.semesterAvgPct.toFixed(1)}%</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-1 text-red-500 font-medium">
                      <TrendingDown className="w-4 h-4" />
                      {s.last14DayPct.toFixed(1)}%
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-medium text-foreground">{s.weeksToThreshold} weeks</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {onNotifyStudent && (
                      <button
                        onClick={() => onNotifyStudent(s.studentId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors"
                      >
                        <Bell className="w-3.5 h-3.5" /> Notify
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
