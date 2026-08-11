import React, { useMemo } from "react";

export type AttendanceDayStatus = "present" | "absent" | "late" | "holiday" | "weekend" | "future";

export interface AttendanceDay {
  date: string; // ISO YYYY-MM-DD
  status: AttendanceDayStatus;
  percentage?: number; // 0-100 for partial days
}

interface AttendanceHeatmapProps {
  /** Array of attendance day records. Days not included default to 'future'. */
  data: AttendanceDay[];
  /** Number of days to display (default 365) */
  days?: number;
  className?: string;
  /** Called with the date string when a user clicks/focuses a day */
  onDaySelect?: (date: string, status: AttendanceDayStatus) => void;
}

const STATUS_COLORS: Record<AttendanceDayStatus, { bg: string; label: string }> = {
  present: { bg: "bg-emerald-500 dark:bg-emerald-400", label: "Present" },
  absent: { bg: "bg-red-500 dark:bg-red-400", label: "Absent" },
  late: { bg: "bg-amber-400 dark:bg-amber-300", label: "Late" },
  holiday: { bg: "bg-purple-400 dark:bg-purple-300", label: "Holiday" },
  weekend: { bg: "bg-slate-200 dark:bg-slate-700", label: "Weekend" },
  future: { bg: "bg-slate-100 dark:bg-slate-800", label: "No data" },
};

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns ISO day-of-week (0=Sunday … 6=Saturday) */
function dow(d: Date): number {
  return d.getDay();
}

export const AttendanceHeatmap: React.FC<AttendanceHeatmapProps> = ({
  data,
  days = 365,
  className = "",
  onDaySelect,
}) => {
  const statusMap = useMemo(() => {
    const m = new Map<string, AttendanceDayStatus>();
    for (const d of data) m.set(d.date, d.status);
    return m;
  }, [data]);

  // Build array of day objects for the last `days` days, aligned to week grid
  const grid = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);

    // Pad to Sunday of the start week
    const padding = dow(start);
    start.setDate(start.getDate() - padding);

    const cells: Array<{ date: string; status: AttendanceDayStatus; isPadding: boolean }> = [];
    const cursor = new Date(start);

    while (cursor <= today || cells.length % 7 !== 0) {
      const dateStr = toYYYYMMDD(cursor);
      const isFuture = cursor > today;
      const isPadding = cursor < new Date(today.getTime() - (days - 1) * 86400000);
      const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
      const status: AttendanceDayStatus =
        statusMap.get(dateStr) ?? (isFuture ? "future" : isWeekend ? "weekend" : "future");
      cells.push({ date: dateStr, status, isPadding });
      cursor.setDate(cursor.getDate() + 1);
    }
    return cells;
  }, [statusMap, days]);

  // Group into columns (weeks)
  const weeks = useMemo(() => {
    const w: Array<typeof grid> = [];
    for (let i = 0; i < grid.length; i += 7) w.push(grid.slice(i, i + 7));
    return w;
  }, [grid]);

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: Array<{ label: string; col: number }> = [];
    let lastMonth = -1;
    weeks.forEach((week, colIdx) => {
      const firstReal = week.find((d) => !d.isPadding);
      if (!firstReal) return;
      const m = new Date(firstReal.date).getMonth();
      if (m !== lastMonth) {
        labels.push({
          label: new Date(firstReal.date).toLocaleString("default", { month: "short" }),
          col: colIdx,
        });
        lastMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  return (
    <div
      className={`select-none ${className}`}
      role="region"
      aria-label="Attendance heatmap calendar"
    >
      {/* Month labels */}
      <div className="relative mb-1" style={{ marginLeft: 28 }}>
        <div className="flex gap-[2px]">
          {weeks.map((_, colIdx) => {
            const label = monthLabels.find((l) => l.col === colIdx);
            return (
              <div key={colIdx} className="w-[14px] shrink-0 text-[9px] text-muted-foreground">
                {label?.label ?? ""}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-[2px]">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-[2px] mr-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div
              key={d}
              className="h-[14px] w-[14px] text-[9px] text-muted-foreground flex items-center justify-center"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Week columns */}
        {weeks.map((week, colIdx) => (
          <div key={colIdx} className="flex flex-col gap-[2px]">
            {week.map((cell, rowIdx) => {
              const { bg, label } = STATUS_COLORS[cell.status];
              const opacity = cell.isPadding ? "opacity-0 pointer-events-none" : "";
              return (
                <button
                  key={rowIdx}
                  type="button"
                  aria-label={`${cell.date}: ${label}`}
                  title={`${cell.date}: ${label}`}
                  tabIndex={cell.isPadding ? -1 : 0}
                  onClick={() => !cell.isPadding && onDaySelect?.(cell.date, cell.status)}
                  className={`w-[14px] h-[14px] rounded-[2px] ${bg} ${opacity} cursor-pointer
                    hover:ring-2 hover:ring-offset-1 hover:ring-primary/60
                    focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none
                    transition-transform hover:scale-125`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        <span className="text-xs text-muted-foreground">Less</span>
        {(["present", "late", "absent", "holiday", "weekend"] as AttendanceDayStatus[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-[2px] ${STATUS_COLORS[s].bg}`} />
            <span className="text-xs text-muted-foreground">{STATUS_COLORS[s].label}</span>
          </div>
        ))}
        <span className="text-xs text-muted-foreground">More</span>
      </div>
    </div>
  );
};
