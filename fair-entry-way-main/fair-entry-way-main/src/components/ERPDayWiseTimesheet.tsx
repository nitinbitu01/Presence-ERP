import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Briefcase,
  Award,
  Layers,
  Camera,
  Shield,
  ShieldCheck,
  Settings,
  Activity,
  Target,
  FileText,
  TrendingUp,
  TrendingDown,
  Zap,
  Bell,
  BarChart3,
  Lock,
  Eye,
  ArrowRight,
  Plus,
  Filter,
  Download,
  RefreshCw,
  Wifi,
  Check,
  AlertCircle,
  Home,
  Star,
  Info,
  User,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getOrCreateActiveDemoSession } from "@/lib/attendance.functions";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
export interface ClassSessionRow {
  id: string;
  code: string;
  name: string;
  timeSlot: string;
  room: string;
  status: "present" | "absent" | "upcoming" | "on_duty";
  trustScore?: number;
  similarity?: number;
  professor?: string;
}

export interface DayAttendance {
  dayName: string;
  dateStr: string;
  fullDate: string;
  isWeekend?: boolean;
  status: "present" | "absent" | "weekend" | "partial" | "on_duty";
  checkInTime: string;
  checkOutTime: string;
  hoursWorked: string;
  progressPct: number;
  classes: ClassSessionRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE UTILITY
// ─────────────────────────────────────────────────────────────────────────────
function cx(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi);
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────
function useLiveClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    let start: number | null = null;
    const from = 0;
    function step(ts: number) {
      if (!start) start = ts;
      const p = clamp((ts - start) / duration, 0, 1);
      // ease-out-cubic
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * ease);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN SYSTEM TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CFG = {
  present: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
    card: "border-emerald-500/20 bg-emerald-500/5",
    bar: "from-emerald-500 to-teal-500",
    label: "Present",
  },
  absent: {
    dot: "bg-rose-500",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30",
    card: "border-rose-500/20 bg-rose-500/5",
    bar: "from-rose-500 to-rose-400",
    label: "Absent",
  },
  weekend: {
    dot: "bg-slate-400",
    badge: "bg-slate-500/10 text-slate-500 dark:text-slate-400 ring-1 ring-slate-500/20",
    card: "border-border bg-muted/20",
    bar: "from-slate-400 to-slate-300",
    label: "Weekend",
  },
  partial: {
    dot: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
    card: "border-amber-500/20 bg-amber-500/5",
    bar: "from-amber-500 to-yellow-400",
    label: "Partial",
  },
  on_duty: {
    dot: "bg-violet-500",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30",
    card: "border-violet-500/20 bg-violet-500/5",
    bar: "from-violet-500 to-purple-400",
    label: "On Duty",
  },
} as const;

const CLASS_STATUS_CFG = {
  present: {
    icon: CheckCircle2,
    iconCls: "text-emerald-500",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    accent: "bg-emerald-500",
    label: "Attended",
    labelCls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25",
  },
  absent: {
    icon: XCircle,
    iconCls: "text-rose-500",
    bg: "bg-rose-500/10 border-rose-500/20",
    accent: "bg-rose-500",
    label: "Missed",
    labelCls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25",
  },
  upcoming: {
    icon: Clock,
    iconCls: "text-blue-500",
    bg: "bg-blue-500/10 border-blue-500/20",
    accent: "bg-blue-500",
    label: "Upcoming",
    labelCls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/25",
  },
  on_duty: {
    icon: ShieldCheck,
    iconCls: "text-violet-500",
    bg: "bg-violet-500/10 border-violet-500/20",
    accent: "bg-violet-500",
    label: "On Duty",
    labelCls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/25",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Accessible pulsing live indicator */
function LiveDot({ color = "emerald" }: { color?: "emerald" | "indigo" | "rose" }) {
  const bg =
    color === "emerald" ? "bg-emerald-500" : color === "rose" ? "bg-rose-500" : "bg-indigo-500";
  return (
    <span role="status" aria-label="Live" className="relative flex h-2.5 w-2.5 shrink-0">
      <span className={cx("animate-ping absolute inset-0 rounded-full opacity-50", bg)} />
      <span className={cx("relative rounded-full h-2.5 w-2.5", bg)} />
    </span>
  );
}

/** SVG arc trust-score gauge */
function TrustArc({ score, size = 44 }: { score: number; size?: number }) {
  const strokeW = 4;
  const r = (size - strokeW * 2) / 2;
  const cx2 = size / 2;
  const cy2 = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = clamp(score / 100, 0, 1) * circ;
  const color = score >= 90 ? "#10b981" : score >= 75 ? "#f59e0b" : "#ef4444";

  return (
    <div
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Trust score ${score} out of 100`}
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={cx2}
          cy={cy2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeW}
          className="text-muted/30"
        />
        <circle
          cx={cx2}
          cy={cy2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - fill}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <span
        className="absolute text-[10px] font-black tabular-nums"
        style={{ color }}
        aria-hidden="true"
      >
        {score}
      </span>
    </div>
  );
}

/** Inline sparkline — safe with 1 point */
function SparkLine({
  data,
  color = "#6366f1",
  height = 28,
  width = 72,
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height * 0.85 - height * 0.075}`,
    )
    .join(" ");
  const areaClose = `${width},${height} 0,${height}`;

  return (
    <svg width={width} height={height} aria-hidden="true" className="overflow-visible shrink-0">
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline
        points={`${pts} ${areaClose}`}
        fill={`url(#sg-${color.replace("#", "")})`}
        stroke="none"
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Status badge pill */
function StatusBadge({ status }: { status: keyof typeof STATUS_CFG }) {
  const c = STATUS_CFG[status];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap",
        c.badge,
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full shrink-0", c.dot)} aria-hidden="true" />
      {c.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC CARD
// ─────────────────────────────────────────────────────────────────────────────
type AccentKey = "indigo" | "emerald" | "amber" | "rose" | "violet" | "blue" | "teal";

const ACCENT_MAP: Record<
  AccentKey,
  {
    bg: string;
    border: string;
    iconBg: string;
    text: string;
    spark: string;
    glow: string;
    bar?: string;
  }
> = {
  indigo: {
    bg: "bg-indigo-500/8",
    border: "border-indigo-500/20",
    iconBg: "bg-indigo-500/12",
    text: "text-indigo-600 dark:text-indigo-400",
    spark: "#6366f1",
    glow: "hover:shadow-indigo-500/10",
    bar: "from-indigo-500 to-indigo-400",
  },
  emerald: {
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/20",
    iconBg: "bg-emerald-500/12",
    text: "text-emerald-600 dark:text-emerald-400",
    spark: "#10b981",
    glow: "hover:shadow-emerald-500/10",
    bar: "from-emerald-500 to-teal-500",
  },
  amber: {
    bg: "bg-amber-500/8",
    border: "border-amber-500/20",
    iconBg: "bg-amber-500/12",
    text: "text-amber-600 dark:text-amber-400",
    spark: "#f59e0b",
    glow: "hover:shadow-amber-500/10",
    bar: "from-amber-500 to-yellow-400",
  },
  rose: {
    bg: "bg-rose-500/8",
    border: "border-rose-500/20",
    iconBg: "bg-rose-500/12",
    text: "text-rose-600 dark:text-rose-400",
    spark: "#f43f5e",
    glow: "hover:shadow-rose-500/10",
    bar: "from-rose-500 to-rose-400",
  },
  violet: {
    bg: "bg-violet-500/8",
    border: "border-violet-500/20",
    iconBg: "bg-violet-500/12",
    text: "text-violet-600 dark:text-violet-400",
    spark: "#8b5cf6",
    glow: "hover:shadow-violet-500/10",
    bar: "from-violet-500 to-purple-400",
  },
  blue: {
    bg: "bg-blue-500/8",
    border: "border-blue-500/20",
    iconBg: "bg-blue-500/12",
    text: "text-blue-600 dark:text-blue-400",
    spark: "#3b82f6",
    glow: "hover:shadow-blue-500/10",
    bar: "from-blue-500 to-cyan-400",
  },
  teal: {
    bg: "bg-teal-500/8",
    border: "border-teal-500/20",
    iconBg: "bg-teal-500/12",
    text: "text-teal-600 dark:text-teal-400",
    spark: "#14b8a6",
    glow: "hover:shadow-teal-500/10",
    bar: "from-teal-500 to-emerald-400",
  },
};

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "indigo",
  sparkData,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ElementType;
  accent?: AccentKey;
  sparkData?: number[];
  trend?: { pct: number; up: boolean };
}) {
  const a = ACCENT_MAP[accent];
  const TrendIcon = trend?.up ? TrendingUp : TrendingDown;

  return (
    <div
      className={cx(
        "group relative rounded-2xl border p-4 overflow-hidden",
        "transition-all duration-300",
        "hover:scale-[1.02] hover:shadow-lg",
        a.bg,
        a.border,
        a.glow,
      )}
    >
      {/* ambient blob */}
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl opacity-20",
          "transition-opacity duration-300 group-hover:opacity-35",
          a.iconBg,
        )}
      />

      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <span className={cx("text-[10px] font-bold uppercase tracking-[0.12em]", a.text)}>
            {label}
          </span>
          {Icon && (
            <div className={cx("p-1.5 rounded-xl", a.iconBg)}>
              <Icon className={cx("h-3.5 w-3.5", a.text)} aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-2xl font-black text-foreground leading-none tracking-tight">
              {value}
            </div>
            {sub && (
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug">{sub}</div>
            )}
          </div>
          {sparkData && sparkData.length >= 2 && <SparkLine data={sparkData} color={a.spark} />}
        </div>

        {trend && (
          <div
            className={cx(
              "flex items-center gap-1 text-[10px] font-bold",
              trend.up
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            <TrendIcon className="h-3 w-3" aria-hidden="true" />
            <span>{trend.pct}% vs last week</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
function PageSection({
  title,
  sub,
  topBarClass,
  actions,
  children,
}: {
  title: string;
  sub?: string;
  topBarClass: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className={cx("h-0.5 w-full", topBarClass)} aria-hidden="true" />
        <div className="p-5 md:p-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-foreground tracking-tight">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground max-w-prose">{sub}</p>}
          </div>
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAY PROGRESS BAR
// ─────────────────────────────────────────────────────────────────────────────
function DayProgressBar({ day }: { day: DayAttendance }) {
  if (day.isWeekend || day.status === "absent") {
    const isAbsent = day.status === "absent";
    return (
      <div className="flex flex-1 min-w-0 items-center gap-2">
        <div
          className={cx(
            "flex-1 h-1.5 rounded-full",
            isAbsent
              ? "bg-rose-200/40 dark:bg-rose-900/20"
              : "bg-slate-200/40 dark:bg-slate-700/20",
          )}
        />
        <span
          className={cx(
            "shrink-0 text-[10px] font-semibold",
            isAbsent ? "text-rose-500" : "text-slate-400",
          )}
        >
          {isAbsent ? "No check-in" : "Day off"}
        </span>
        <div
          className={cx(
            "flex-1 h-1.5 rounded-full",
            isAbsent
              ? "bg-rose-200/40 dark:bg-rose-900/20"
              : "bg-slate-200/40 dark:bg-slate-700/20",
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <div
        role="progressbar"
        aria-valuenow={day.progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Work progress ${day.progressPct}%`}
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted/50"
      >
        <div
          className={cx(
            "h-full rounded-full bg-gradient-to-r",
            STATUS_CFG[day.status]?.bar ?? "from-indigo-500 to-indigo-400",
          )}
          style={{
            width: `${day.progressPct}%`,
            transition: "width 1s cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
          ▶ {day.checkInTime}
        </span>
        <span className="font-bold text-foreground">{day.hoursWorked}</span>
        <span className="text-rose-500 dark:text-rose-400 font-semibold">■ {day.checkOutTime}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS SESSION CARD
// ─────────────────────────────────────────────────────────────────────────────
function ClassCard({ cls, onCheckIn }: { cls: ClassSessionRow; onCheckIn: () => void }) {
  const s = CLASS_STATUS_CFG[cls.status];
  const Icon = s.icon;

  return (
    <div
      className={cx(
        "relative flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl",
        "border border-border/60 bg-background",
        "hover:border-indigo-400/30 hover:shadow-md",
        "transition-all duration-200 focus-within:ring-2 focus-within:ring-indigo-500/20",
      )}
    >
      {/* Colored left accent bar */}
      <div
        aria-hidden="true"
        className={cx("absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full", s.accent)}
      />

      <div className="flex items-center gap-3 min-w-0 pl-2.5">
        <div
          className={cx(
            "shrink-0 h-9 w-9 rounded-xl border flex items-center justify-center",
            s.bg,
          )}
          aria-hidden="true"
        >
          <Icon className={cx("h-4 w-4", s.iconCls)} />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 tracking-wide">
              {cls.code}
            </span>
            <span className="text-xs font-semibold text-foreground">{cls.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>⏰ {cls.timeSlot}</span>
            <span>📍 {cls.room}</span>
            {cls.professor && <span className="hidden sm:inline">👤 {cls.professor}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {cls.trustScore !== undefined && (
          <div className="flex items-center gap-2">
            <TrustArc score={cls.trustScore} size={42} />
            <div className="text-right hidden sm:block">
              <div className="text-[10px] font-black text-foreground">{cls.trustScore}/100</div>
              <div className="text-[9px] text-muted-foreground">
                {cls.similarity != null
                  ? `${(cls.similarity * 100).toFixed(1)}% face`
                  : "trust score"}
              </div>
            </div>
          </div>
        )}

        {cls.status === "upcoming" ? (
          <button
            onClick={onCheckIn}
            className={cx(
              "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-bold text-white",
              "bg-gradient-to-br from-indigo-600 to-emerald-500",
              "shadow-sm hover:shadow-md hover:shadow-indigo-500/20",
              "hover:scale-105 active:scale-95 transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
            )}
          >
            <Camera className="h-3 w-3" aria-hidden="true" />
            <span>Check In</span>
          </button>
        ) : (
          <span className={cx("rounded-xl px-3 py-1.5 text-[10px] font-bold", s.labelCls)}>
            {s.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {
    id: "attendance",
    label: "Attend",
    icon: Calendar,
    color: "text-indigo-400",
    activeBg: "bg-indigo-500/15",
  },
  { id: "leave", label: "Leave", icon: Clock, color: "text-blue-400", activeBg: "bg-blue-500/15" },
  {
    id: "timesheet",
    label: "Hours",
    icon: Layers,
    color: "text-teal-400",
    activeBg: "bg-teal-500/15",
  },
  {
    id: "performance",
    label: "Grades",
    icon: Award,
    color: "text-amber-400",
    activeBg: "bg-amber-500/15",
  },
  {
    id: "lms",
    label: "LMS",
    icon: BookOpen,
    color: "text-violet-400",
    activeBg: "bg-violet-500/15",
  },
  {
    id: "cases",
    label: "Cases",
    icon: Briefcase,
    color: "text-rose-400",
    activeBg: "bg-rose-500/15",
  },
] as const;

type NavId = (typeof NAV_ITEMS)[number]["id"];

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA — clean structure with zero prebuilt hardcoded classes
// ─────────────────────────────────────────────────────────────────────────────
const DAYS_DATA: DayAttendance[] = [
  {
    dayName: "Sun",
    dateStr: "03-Aug-2026",
    fullDate: "Sunday, 03 August 2026",
    isWeekend: true,
    status: "weekend",
    checkInTime: "—",
    checkOutTime: "—",
    hoursWorked: "00:00",
    progressPct: 0,
    classes: [],
  },
  {
    dayName: "Mon",
    dateStr: "04-Aug-2026",
    fullDate: "Monday, 04 August 2026",
    status: "present",
    checkInTime: "09:00 AM",
    checkOutTime: "05:00 PM",
    hoursWorked: "08:00 Hrs",
    progressPct: 100,
    classes: [],
  },
  {
    dayName: "Tue",
    dateStr: "05-Aug-2026",
    fullDate: "Tuesday, 05 August 2026",
    status: "present",
    checkInTime: "09:00 AM",
    checkOutTime: "05:00 PM",
    hoursWorked: "08:00 Hrs",
    progressPct: 100,
    classes: [],
  },
  {
    dayName: "Wed",
    dateStr: "06-Aug-2026",
    fullDate: "Wednesday, 06 August 2026",
    status: "absent",
    checkInTime: "—",
    checkOutTime: "—",
    hoursWorked: "00:00 Hrs",
    progressPct: 0,
    classes: [],
  },
  {
    dayName: "Thu",
    dateStr: "07-Aug-2026",
    fullDate: "Thursday, 07 August 2026",
    status: "present",
    checkInTime: "09:00 AM",
    checkOutTime: "05:00 PM",
    hoursWorked: "08:00 Hrs",
    progressPct: 100,
    classes: [],
  },
  {
    dayName: "Fri",
    dateStr: "08-Aug-2026",
    fullDate: "Friday, 08 August 2026",
    status: "present",
    checkInTime: "09:00 AM",
    checkOutTime: "05:00 PM",
    hoursWorked: "08:00 Hrs",
    progressPct: 100,
    classes: [],
  },
  {
    dayName: "Sat",
    dateStr: "09-Aug-2026",
    fullDate: "Saturday, 09 August 2026",
    isWeekend: true,
    status: "weekend",
    checkInTime: "—",
    checkOutTime: "—",
    hoursWorked: "00:00",
    progressPct: 0,
    classes: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export function ERPDayWiseTimesheet({
  adminTabs,
  activeAdminTab,
  onSelectAdminTab,
  children,
  headerTitle = "⚡ Administrative Governance",
  showWeeklyLog = true,
  onOpenNotifications,
  onOpenSettings,
  onOpenProfile,
}: {
  adminTabs?: { id: string; label: string; count?: number }[];
  activeAdminTab?: string;
  onSelectAdminTab?: (id: string) => void;
  children?: React.ReactNode;
  headerTitle?: string;
  showWeeklyLog?: boolean;
  onOpenNotifications?: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}) {
  const navigate = useNavigate();
  const startDemo = useServerFn(getOrCreateActiveDemoSession);
  const clock = useLiveClock();
  const [nav, setNav] = useState<NavId>("attendance");
  const [expanded, setExpanded] = useState<string | null>("Mon");
  const [busy, setBusy] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Derived stats
  const workDays = useMemo(() => DAYS_DATA.filter((d) => !d.isWeekend), []);
  const presentDays = useMemo(() => workDays.filter((d) => d.status === "present"), [workDays]);
  const absentDays = useMemo(() => workDays.filter((d) => d.status === "absent"), [workDays]);
  const attendancePct = useMemo(
    () => Math.round((presentDays.length / workDays.length) * 100),
    [presentDays, workDays],
  );
  const totalHours = useMemo(
    () =>
      presentDays.reduce((sum, d) => {
        const m = d.hoursWorked.match(/(\d+):(\d+)/);
        return m ? sum + parseInt(m[1], 10) + parseInt(m[2], 10) / 60 : sum;
      }, 0),
    [presentDays],
  );

  // Scroll admin panel
  useEffect(() => {
    if (!activeAdminTab) return;
    const timers = [80, 300, 600].map((ms) =>
      setTimeout(() => {
        document
          .getElementById("admin-panel")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [activeAdminTab]);

  const handleCheckIn = useCallback(async () => {
    setBusy(true);
    try {
      const res = await startDemo();
      const id = res?.sessionId ?? "00000000-0000-4000-a000-000000000001";
      navigate({ to: "/attend/$sessionId", params: { sessionId: id } });
    } catch {
      navigate({
        to: "/attend/$sessionId",
        params: { sessionId: "00000000-0000-4000-a000-000000000001" },
      });
    } finally {
      setBusy(false);
    }
  }, [navigate, startDemo]);

  const toggleDay = useCallback(
    (name: string) => setExpanded((prev) => (prev === name ? null : name)),
    [],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 dark:bg-[#070b14] flex flex-col md:flex-row text-foreground relative">
      {/* ══════════════════════════════ SIDEBAR ══════════════════════════════ */}
      <aside
        role="navigation"
        aria-label="ERP navigation"
        className={cx(
          "shrink-0 z-40",
          "w-full md:w-[68px] lg:w-[76px]",
          "md:fixed md:top-0 md:bottom-0 md:left-0 md:h-screen md:min-h-screen",
          "bg-[#0b1120]",
          "border-b border-white/[0.06] md:border-b-0 md:border-r md:border-white/[0.06]",
          "flex md:flex-col items-center justify-between",
          "py-2.5 md:py-5 px-2 md:px-0 gap-1 md:gap-0",
          "overflow-x-auto md:overflow-y-auto md:overflow-x-hidden",
          "shadow-2xl shadow-black/50",
        )}
      >
        {/* Logo */}
        <button
          onClick={() => navigate({ to: "/" })}
          aria-label="Go to home"
          className={cx(
            "flex flex-col items-center gap-1 p-1.5 rounded-2xl",
            "hover:bg-white/5 transition-all duration-200",
            "group shrink-0 md:mb-5 md:mx-auto focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-indigo-500",
          )}
        >
          <div
            aria-hidden="true"
            className={cx(
              "h-9 w-9 rounded-xl",
              "bg-gradient-to-br from-indigo-600 via-violet-600 to-emerald-500",
              "flex items-center justify-center",
              "text-white font-black text-base",
              "shadow-lg shadow-indigo-500/30",
              "group-hover:scale-110 group-hover:shadow-indigo-500/50",
              "transition-all duration-300",
            )}
          >
            P
          </div>
          <span className="text-[8px] font-black text-slate-400 tracking-[0.18em] hidden md:block">
            PULSE
          </span>
        </button>

        {/* Divider */}
        <div aria-hidden="true" className="hidden md:block h-px w-9 mx-auto bg-white/[0.06] mb-2" />

        {/* Nav items */}
        <nav className="flex md:flex-col items-center gap-0.5 w-full md:px-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setNav(item.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className={cx(
                  "relative flex flex-col items-center justify-center gap-1",
                  "p-2.5 rounded-xl w-full text-center shrink-0",
                  "transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  isActive
                    ? cx("text-white", item.activeBg)
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
                )}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute left-0 top-1/2 -translate-y-1/2",
                      "w-0.5 h-5 rounded-r-full",
                      item.color.replace("text-", "bg-"),
                    )}
                  />
                )}
                <Icon
                  aria-hidden="true"
                  className={cx(
                    "h-4 w-4 transition-transform duration-200",
                    isActive ? cx(item.color, "scale-110") : "group-hover:scale-105",
                  )}
                />
                <span className="text-[9px] font-bold leading-none hidden md:block">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Bottom: alerts + settings + avatar */}
        <div className="flex md:flex-col items-center justify-around md:justify-start gap-0.5 w-full md:px-1.5 mt-auto border-t md:border-t-0 border-white/[0.06] pt-1 md:pt-0">
          <div
            aria-hidden="true"
            className="hidden md:block h-px w-9 mx-auto bg-white/[0.06] mb-1"
          />

          <button
            type="button"
            aria-label="Notifications"
            title="Notifications"
            onClick={() => {
              setShowNotifModal(true);
              if (onOpenNotifications) onOpenNotifications();
            }}
            className="flex flex-col items-center gap-1 p-2 md:p-2.5 rounded-xl text-center text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span className="text-[9px] font-bold">Notifications</span>
          </button>

          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => {
              setShowSettingsModal(true);
              if (onOpenSettings) onOpenSettings();
            }}
            className="flex flex-col items-center gap-1 p-2 md:p-2.5 rounded-xl text-center text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            <span className="text-[9px] font-bold">Settings</span>
          </button>

          {/* Avatar */}
          <button
            type="button"
            aria-label="Profile & Biometrics"
            title="Profile & Biometrics Settings"
            onClick={() => {
              setShowProfileModal(true);
              if (onOpenProfile) onOpenProfile();
            }}
            className="my-1 group cursor-pointer focus-visible:outline-none"
          >
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center text-white text-[11px] font-black shadow-md mx-auto group-hover:scale-110 transition-transform">
              R
            </div>
          </button>
        </div>
      </aside>

      {/* Spacer for fixed sidebar on desktop */}
      <div className="hidden md:block shrink-0 md:w-[68px] lg:w-[76px]" aria-hidden="true" />

      {/* ════════════════════════════ MAIN CONTENT ═══════════════════════════ */}
      <main
        id="main-content"
        className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 max-w-5xl mx-auto w-full"
      >
        {/* ════════════════ ATTENDANCE ════════════════ */}
        {nav === "attendance" && (
          <>
            {/* ── Hero control bar ── */}
            <div
              className={cx(
                "relative overflow-hidden rounded-2xl",
                "bg-[#0f1623] border border-white/[0.07]",
                "shadow-2xl shadow-black/40",
                "text-white",
              )}
            >
              {/* ambient glows */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-20 -left-20 h-52 w-52 rounded-full bg-indigo-600/25 blur-3xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-12 -right-12 h-36 w-36 rounded-full bg-emerald-500/20 blur-2xl"
              />

              <div className="relative p-4 md:p-5 space-y-4">
                {/* Row 1: week nav + live indicators */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Week selector */}
                  <div className="flex items-center gap-1.5 bg-white/5 rounded-xl px-3 py-1.5 border border-white/[0.08]">
                    <button
                      aria-label="Previous week"
                      className="p-1 rounded-lg hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                    >
                      <ChevronLeft className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    </button>
                    <div className="flex items-center gap-2 text-sm font-bold px-1">
                      <Calendar
                        className="h-3.5 w-3.5 text-indigo-400 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="whitespace-nowrap text-[13px]">03 – 09 Aug 2026</span>
                    </div>
                    <button
                      aria-label="Next week"
                      className="p-1 rounded-lg hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                    >
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Live pills */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div
                      className="flex items-center gap-2 rounded-xl bg-emerald-500/12 border border-emerald-500/20 px-3 py-1.5"
                      aria-live="polite"
                      aria-label="Current time"
                    >
                      <LiveDot color="emerald" />
                      <span className="font-mono text-[11px] text-emerald-300 tabular-nums">
                        {clock.toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-xl bg-indigo-500/12 border border-indigo-500/20 px-3 py-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                      <span className="text-[11px] font-bold text-indigo-300">
                        Biometric Active
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/[0.08] px-3 py-1.5">
                      <Wifi className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                      <span className="text-[11px] font-semibold text-slate-300">Online</span>
                    </div>
                  </div>
                </div>

                {/* Row 2: shift + CTA */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold text-slate-400 bg-white/5 border border-white/[0.07] rounded-xl px-3.5 py-2">
                    📅 General Academic Shift —{" "}
                    <span className="text-white font-bold">09:00 AM – 05:00 PM</span>
                  </div>

                  <button
                    onClick={handleCheckIn}
                    disabled={busy}
                    aria-busy={busy}
                    className={cx(
                      "flex items-center gap-2 rounded-xl px-5 py-2.5",
                      "text-xs font-bold text-white",
                      "bg-gradient-to-r from-emerald-500 to-teal-500",
                      "shadow-lg shadow-emerald-500/20",
                      "hover:from-emerald-400 hover:to-teal-400",
                      "hover:shadow-emerald-500/30 hover:scale-105",
                      "active:scale-95 transition-all duration-150",
                      "disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                    )}
                  >
                    {busy ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <>
                        <LiveDot />
                        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      </>
                    )}
                    <span>{busy ? "Opening camera…" : "Face Check-in · 07:53:12"}</span>
                  </button>
                </div>

                {/* Row 3: week summary chips */}
                <div className="grid grid-cols-4 gap-2" role="group" aria-label="Week summary">
                  {(
                    [
                      {
                        label: "Present",
                        value: `${presentDays.length}`,
                        sub: "days",
                        highlight: "text-emerald-400",
                      },
                      {
                        label: "Absent",
                        value: `${absentDays.length}`,
                        sub: "days",
                        highlight: "text-rose-400",
                      },
                      {
                        label: "Attendance",
                        value: `${attendancePct}%`,
                        sub: "rate",
                        highlight: "text-indigo-300",
                      },
                      {
                        label: "Hours",
                        value: `${totalHours.toFixed(1)}`,
                        sub: "hrs",
                        highlight: "text-teal-300",
                      },
                    ] as const
                  ).map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl bg-white/[0.04] border border-white/[0.06] py-2.5 text-center"
                    >
                      <div className={cx("text-lg font-black tabular-nums", s.highlight)}>
                        {s.value}
                      </div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Admin tabs */}
            {adminTabs && adminTabs.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {headerTitle}
                </p>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {adminTabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onSelectAdminTab?.(t.id);
                        setTimeout(
                          () =>
                            document
                              .getElementById("admin-panel")
                              ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                          80,
                        );
                      }}
                      aria-pressed={activeAdminTab === t.id}
                      className={cx(
                        "whitespace-nowrap rounded-xl px-4 py-1.5 text-xs font-bold",
                        "transition-all duration-150 shrink-0",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                        activeAdminTab === t.id
                          ? "bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/25"
                          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {t.label}
                      {!!t.count && (
                        <span
                          aria-label={`${t.count} items`}
                          className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-px text-[9px] text-white font-black"
                        >
                          {t.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {children && (
                  <div id="admin-panel" className="border-t border-border pt-4 space-y-4">
                    {children}
                  </div>
                )}
              </div>
            )}

            {/* ── 7-day heat strip ── */}
            <div
              role="group"
              aria-label="Day selector"
              className="grid grid-cols-7 gap-1.5 sm:gap-2"
            >
              {DAYS_DATA.map((day) => {
                const isExp = expanded === day.dayName;
                const dotCls =
                  day.status === "present"
                    ? "bg-emerald-500 shadow-emerald-500/60 shadow-sm"
                    : day.status === "absent"
                      ? "bg-rose-500 shadow-rose-500/60 shadow-sm"
                      : "bg-slate-500";
                return (
                  <button
                    key={day.dayName}
                    onClick={() => toggleDay(day.dayName)}
                    aria-pressed={isExp}
                    aria-label={`${day.fullDate} — ${day.status}`}
                    className={cx(
                      "flex flex-col items-center gap-1 py-2.5 px-1 rounded-2xl border",
                      "text-center transition-all duration-200",
                      "hover:scale-105",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                      isExp
                        ? "border-indigo-500/50 bg-indigo-500/10 scale-[1.04] shadow-md shadow-indigo-500/10"
                        : day.status === "present"
                          ? "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/35"
                          : day.status === "absent"
                            ? "border-rose-500/20 bg-rose-500/5 hover:border-rose-500/35"
                            : "border-border bg-muted/20",
                    )}
                  >
                    <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                      {day.dayName}
                    </span>
                    <span className="text-base font-black text-foreground leading-none">
                      {day.dateStr.slice(0, 2)}
                    </span>
                    {day.classes.length > 0 && (
                      <span className="text-[8px] font-bold text-indigo-500">
                        {day.classes.length}c
                      </span>
                    )}
                    <div aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", dotCls)} />
                  </button>
                );
              })}
            </div>

            {/* ── Day accordion ── */}
            {showWeeklyLog && (
              <div className="space-y-2" role="list" aria-label="Daily attendance log">
                {DAYS_DATA.map((day) => {
                  const isExp = expanded === day.dayName;
                  const attendedCount = day.classes.filter((c) => c.status === "present").length;
                  const avgTrust = (() => {
                    const scored = day.classes.filter((c) => c.trustScore != null);
                    if (!scored.length) return null;
                    return Math.round(
                      scored.reduce((s, c) => s + c.trustScore!, 0) / scored.length,
                    );
                  })();

                  return (
                    <div
                      key={day.dayName}
                      role="listitem"
                      className={cx(
                        "rounded-2xl border overflow-hidden",
                        "bg-card transition-all duration-300",
                        isExp
                          ? "border-indigo-500/35 shadow-lg shadow-indigo-500/5 ring-1 ring-indigo-500/10"
                          : "border-border hover:border-indigo-400/20 shadow-sm",
                      )}
                    >
                      {/* ── Header row ── */}
                      <button
                        onClick={() => toggleDay(day.dayName)}
                        aria-expanded={isExp}
                        aria-controls={`day-${day.dayName}-classes`}
                        className={cx(
                          "w-full flex flex-wrap items-center gap-3 p-4 text-left",
                          "hover:bg-muted/25 transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40",
                          isExp && "bg-muted/15",
                        )}
                      >
                        {/* Date chip */}
                        <div
                          aria-hidden="true"
                          className={cx(
                            "shrink-0 h-10 w-10 rounded-xl border flex flex-col items-center justify-center",
                            day.status === "present"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : day.status === "absent"
                                ? "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                                : "bg-muted/50 border-border text-muted-foreground",
                          )}
                        >
                          <span className="text-[8px] font-bold uppercase leading-none opacity-60">
                            {day.dayName}
                          </span>
                          <span className="text-sm font-black leading-tight">
                            {day.dateStr.slice(0, 2)}
                          </span>
                        </div>

                        {/* Status badge */}
                        <StatusBadge status={day.status} />

                        {/* Timeline bar */}
                        <DayProgressBar day={day} />

                        {/* Right info + chevron */}
                        <div className="flex items-center gap-3 shrink-0 ml-auto">
                          <div className="text-right hidden sm:block">
                            <div className="text-xs font-black text-foreground tabular-nums">
                              {day.hoursWorked}
                            </div>
                            {day.classes.length > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                {attendedCount}/{day.classes.length} classes
                              </div>
                            )}
                          </div>

                          {avgTrust != null && <TrustArc score={avgTrust} size={34} />}

                          <div
                            aria-hidden="true"
                            className={cx(
                              "p-1.5 rounded-full transition-all duration-200",
                              isExp
                                ? "bg-indigo-500/15 text-indigo-500"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {isExp ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </div>
                        </div>
                      </button>

                      {/* ── Expanded classes panel ── */}
                      {isExp && (
                        <div
                          id={`day-${day.dayName}-classes`}
                          className="border-t border-border/50 bg-muted/[0.07] p-4 space-y-2.5"
                        >
                          {/* Sub-header */}
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                              {day.fullDate}
                            </span>
                            <div className="flex items-center gap-2">
                              {day.classes.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {attendedCount}/{day.classes.length} attended
                                </span>
                              )}
                              {avgTrust != null && (
                                <div className="flex items-center gap-1.5 rounded-lg bg-indigo-500/8 border border-indigo-500/15 px-2 py-1">
                                  <Shield className="h-3 w-3 text-indigo-500" aria-hidden="true" />
                                  <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400">
                                    Avg Trust {avgTrust}/100
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Empty state */}
                          {day.classes.length === 0 ? (
                            <div className="flex flex-col items-center gap-2.5 py-8 text-center">
                              <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                                {day.isWeekend ? (
                                  <Star className="h-5 w-5 text-amber-400" aria-hidden="true" />
                                ) : (
                                  <Calendar
                                    className="h-5 w-5 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground">
                                  {day.isWeekend
                                    ? "Rest day — no scheduled classes."
                                    : "No scheduled classes on this day."}
                                </p>
                                {day.status === "absent" && (
                                  <button className="mt-1.5 text-[11px] font-bold text-rose-500 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500 rounded">
                                    Submit absence reason →
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* Class cards */
                            <div className="space-y-2">
                              {day.classes.map((cls) => (
                                <ClassCard key={cls.id} cls={cls} onCheckIn={handleCheckIn} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ════════════════ LEAVE ════════════════ */}
        {nav === "leave" && (
          <PageSection
            title="Leave & On-Duty Management"
            sub="Track leave quotas, submit medical or casual leave, and monitor OD approvals in real-time."
            topBarClass="bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500"
            actions={
              <button
                onClick={() => navigate({ to: "/student" })}
                className={cx(
                  "flex items-center gap-2 rounded-xl px-4 py-2.5",
                  "text-xs font-bold text-white",
                  "bg-gradient-to-r from-indigo-600 to-violet-600",
                  "shadow-lg shadow-indigo-500/20",
                  "hover:scale-105 active:scale-95 transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                )}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Apply Leave / OD
              </button>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MetricCard
                label="Medical Leave"
                value="8 / 12"
                sub="4 days utilized this semester"
                icon={Activity}
                accent="emerald"
                sparkData={[4, 5, 6, 6, 7, 8, 8]}
                trend={{ pct: 8, up: false }}
              />
              <MetricCard
                label="Casual Leave"
                value="4 / 6"
                sub="2 remaining days"
                icon={Clock}
                accent="blue"
                sparkData={[1, 2, 3, 3, 4, 4, 4]}
              />
              <MetricCard
                label="On-Duty (OD)"
                value="10 / 10"
                sub="Full quota — all events"
                icon={ShieldCheck}
                accent="violet"
                sparkData={[2, 4, 6, 7, 9, 10, 10]}
                trend={{ pct: 15, up: true }}
              />
            </div>

            {/* Leave history table */}
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                  Leave Applications
                </h3>
                <div className="flex gap-2">
                  {[
                    { icon: Filter, label: "Filter" },
                    { icon: Download, label: "Export" },
                  ].map(({ icon: Icon, label }) => (
                    <button
                      key={label}
                      aria-label={label}
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground bg-muted hover:bg-accent rounded-lg px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" aria-label="Leave applications">
                  <thead className="bg-muted/30">
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {["Type", "Duration", "Reason", "Approved By", "Status"].map((h) => (
                        <th key={h} scope="col" className="p-3 text-left first:pl-4 last:pr-4">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {[
                      {
                        type: "Medical Leave",
                        typeCls: "text-emerald-600 dark:text-emerald-400",
                        duration: "01–02 Aug 2026",
                        days: 2,
                        reason: "Fever + doctor's advice",
                        approver: "HOD Sharma",
                        status: "Approved",
                      },
                      {
                        type: "On-Duty (OD)",
                        typeCls: "text-violet-600 dark:text-violet-400",
                        duration: "25–26 Jul 2026",
                        days: 2,
                        reason: "Hackathon @ Presence",
                        approver: "Dean Office",
                        status: "Approved",
                      },
                      {
                        type: "Casual Leave",
                        typeCls: "text-blue-600 dark:text-blue-400",
                        duration: "15 Aug 2026",
                        days: 1,
                        reason: "Personal work",
                        approver: "Pending",
                        status: "Pending",
                      },
                    ].map((row, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className={cx("p-3 pl-4 font-black", row.typeCls)}>{row.type}</td>
                        <td className="p-3">
                          <div className="font-mono text-[11px] text-foreground">
                            {row.duration}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {row.days} day{row.days > 1 ? "s" : ""}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">{row.reason}</td>
                        <td className="p-3 text-[11px] text-muted-foreground">{row.approver}</td>
                        <td className="p-3 pr-4">
                          <span
                            className={cx(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1",
                              row.status === "Approved"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
                            )}
                          >
                            {row.status === "Approved" ? (
                              <Check className="h-2.5 w-2.5" aria-hidden="true" />
                            ) : (
                              <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                            )}
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </PageSection>
        )}

        {/* ════════════════ TIMESHEET ════════════════ */}
        {nav === "timesheet" && (
          <PageSection
            title="Shift & Work Hours Log"
            sub="Biometric check-in timelines, per-session trust scores, and WebAuthn hardware key binding."
            topBarClass="bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500"
            actions={
              <div className="rounded-2xl bg-indigo-500/8 border border-indigo-500/20 px-4 py-2.5 text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Weekly Target
                </div>
                <div className="text-xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {totalHours.toFixed(1)} / 40.0 Hrs
                </div>
              </div>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="Daily Average"
                value="7.7 Hrs"
                sub="per working day"
                icon={BarChart3}
                accent="indigo"
                sparkData={[7.5, 8, 8.1, 0, 7.9, 7.8, 0]}
              />
              <MetricCard
                label="On-Time Rate"
                value="98.5%"
                sub="check-in punctuality"
                icon={Target}
                accent="emerald"
                sparkData={[95, 97, 98, 98, 99, 98, 99]}
                trend={{ pct: 2.1, up: true }}
              />
              <MetricCard
                label="Face Trust Avg"
                value="92/100"
                sub="biometric quality"
                icon={Eye}
                accent="violet"
                sparkData={[88, 90, 91, 92, 93, 91, 92]}
              />
              <MetricCard
                label="Hardware Key"
                value="Verified"
                sub="WebAuthn passkey bound"
                icon={Lock}
                accent="teal"
              />
            </div>

            {/* Bar timeline */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                Daily Hours Breakdown
              </h3>
              <div className="space-y-2.5" role="list">
                {DAYS_DATA.filter((d) => !d.isWeekend).map((day) => (
                  <div key={day.dayName} className="flex items-center gap-3" role="listitem">
                    <div className="w-8 text-[10px] font-black text-muted-foreground text-right shrink-0">
                      {day.dayName}
                    </div>
                    <div
                      role="progressbar"
                      aria-valuenow={day.progressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${day.dayName}: ${day.hoursWorked}`}
                      className="flex-1 h-7 bg-muted/40 rounded-xl overflow-hidden relative"
                    >
                      <div
                        className={cx(
                          "h-full rounded-xl transition-all duration-1000",
                          day.status === "absent"
                            ? "bg-rose-500/25"
                            : "bg-gradient-to-r from-indigo-600 to-teal-500",
                        )}
                        style={{ width: `${day.progressPct}%` }}
                      />
                      {day.status !== "absent" && day.progressPct > 20 && (
                        <span className="absolute inset-0 flex items-center px-3 text-[10px] font-bold text-white">
                          {day.hoursWorked}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={day.status} />
                  </div>
                ))}
              </div>
            </div>

            {/* Trust grid */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Shield className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                Per-Session Biometric Trust Log
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {DAYS_DATA.flatMap((d) =>
                  d.classes
                    .filter((c) => c.trustScore != null)
                    .map((c) => ({ ...c, dayName: d.dayName })),
                ).map((cls) => (
                  <div
                    key={cls.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:border-indigo-400/25 transition-colors"
                  >
                    <TrustArc score={cls.trustScore!} size={44} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-black text-indigo-600 dark:text-indigo-400">
                        {cls.code}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {cls.timeSlot}
                      </div>
                      <div className="text-[10px] font-semibold text-foreground">
                        {cls.similarity != null
                          ? `${(cls.similarity * 100).toFixed(1)}% face match`
                          : "verified"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageSection>
        )}

        {/* ════════════════ PERFORMANCE ════════════════ */}
        {nav === "performance" && (
          <PageSection
            title="Academic Performance & Exam Eligibility"
            sub="Course-wise attendance against the 75% minimum exam eligibility threshold."
            topBarClass="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500"
          >
            {/* Warning alert */}
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/8 p-4"
            >
              <AlertTriangle
                className="h-4 w-4 text-amber-500 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                  MATH102 at 76.5% — only 1.5% above the danger threshold.
                </p>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-0.5">
                  Attend your next 2 scheduled classes to reach a safe 82%+ buffer.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  code: "CS101",
                  name: "Computer Science & AI",
                  pct: 92.4,
                  attended: 23,
                  total: 25,
                  status: "Safe",
                  accent: "emerald" as AccentKey,
                },
                {
                  code: "AI202",
                  name: "Machine Learning & Neural Nets",
                  pct: 88.1,
                  attended: 19,
                  total: 21,
                  status: "Safe",
                  accent: "emerald" as AccentKey,
                },
                {
                  code: "MATH102",
                  name: "Linear Algebra & Calculus",
                  pct: 76.5,
                  attended: 13,
                  total: 17,
                  status: "Warning",
                  accent: "amber" as AccentKey,
                },
              ].map((course) => {
                const a = ACCENT_MAP[course.accent];
                return (
                  <div
                    key={course.code}
                    className={cx(
                      "rounded-2xl border p-5 space-y-4",
                      "hover:scale-[1.02] transition-all duration-300",
                      a.border,
                      a.bg,
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 tracking-wide">
                        {course.code}
                      </span>
                      <span
                        className={cx(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1",
                          course.accent === "emerald"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
                        )}
                      >
                        {course.status === "Safe" ? "✓ Safe" : "⚠ Warning"}
                      </span>
                    </div>

                    <div>
                      <div className="text-4xl font-black text-foreground tabular-nums leading-none">
                        {course.pct.toFixed(1)}%
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">{course.name}</div>
                    </div>

                    <div className="space-y-2">
                      <div
                        role="progressbar"
                        aria-valuenow={course.pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${course.code} attendance ${course.pct}%`}
                        className="relative h-2 w-full bg-muted rounded-full overflow-hidden"
                      >
                        {/* Danger line at 75% */}
                        <div
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 w-px bg-red-500/50 z-10"
                          style={{ left: "75%" }}
                        />
                        <div
                          className={cx(
                            "h-full rounded-full bg-gradient-to-r",
                            a.bar ?? "from-indigo-500 to-indigo-400",
                          )}
                          style={{
                            width: `${course.pct}%`,
                            transition: "width 1s cubic-bezier(0.4,0,0.2,1)",
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>
                          {course.attended}/{course.total} classes
                        </span>
                        <span className="text-rose-500 font-bold">75% min ↑</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </PageSection>
        )}

        {/* ════════════════ LMS ════════════════ */}
        {nav === "lms" && (
          <PageSection
            title="Learning Management System"
            sub="Enrolled courses, lecture materials, and syllabus coverage analytics."
            topBarClass="bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  code: "CS101",
                  name: "Computer Science & Artificial Intelligence",
                  prof: "Dr. N. Sharma",
                  cov: 78,
                  done: 18,
                  total: 24,
                },
                {
                  code: "AI202",
                  name: "Machine Learning & Deep Neural Networks",
                  prof: "Prof. A. Patel",
                  cov: 64,
                  done: 13,
                  total: 20,
                },
                {
                  code: "MATH102",
                  name: "Linear Algebra & Multivariable Calculus",
                  prof: "Dr. S. Gupta",
                  cov: 55,
                  done: 10,
                  total: 18,
                },
              ].map((c) => (
                <div
                  key={c.code}
                  className={cx(
                    "group rounded-2xl border border-border bg-card p-5 space-y-4",
                    "hover:border-indigo-400/30 hover:shadow-lg hover:shadow-indigo-500/5",
                    "transition-all duration-300",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400">
                        {c.code}
                      </span>
                      <h3 className="text-sm font-bold text-foreground mt-0.5 leading-snug">
                        {c.name}
                      </h3>
                      <div className="text-[11px] text-muted-foreground mt-0.5">👤 {c.prof}</div>
                    </div>
                    <div className="shrink-0 h-9 w-9 rounded-xl bg-indigo-500/8 border border-indigo-500/15 flex items-center justify-center">
                      <BookOpen className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-muted-foreground font-semibold">
                        Syllabus Coverage
                      </span>
                      <span className="text-sm font-black text-foreground tabular-nums">
                        {c.cov}%
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuenow={c.cov}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${c.code} syllabus coverage ${c.cov}%`}
                      className="h-2 w-full bg-muted rounded-full overflow-hidden"
                    >
                      <div
                        className="h-full bg-gradient-to-r from-indigo-600 to-violet-500 rounded-full"
                        style={{
                          width: `${c.cov}%`,
                          transition: "width 1s cubic-bezier(0.4,0,0.2,1)",
                        }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {c.done}/{c.total} lectures completed
                    </div>
                  </div>

                  <button
                    className={cx(
                      "w-full flex items-center justify-center gap-1.5 rounded-xl py-2",
                      "text-xs font-bold text-indigo-600 dark:text-indigo-400",
                      "border border-indigo-500/15 bg-indigo-500/5",
                      "hover:bg-indigo-500/10 hover:border-indigo-500/30",
                      "transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                    )}
                  >
                    View Course Materials
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </PageSection>
        )}

        {/* ════════════════ CASES ════════════════ */}
        {nav === "cases" && (
          <PageSection
            title="Support Cases & Help Desk"
            sub="Raise attendance disputes, face-ID failures, or infrastructure anomaly tickets."
            topBarClass="bg-gradient-to-r from-rose-500 via-pink-500 to-orange-500"
            actions={
              <button
                className={cx(
                  "flex items-center gap-2 rounded-xl px-4 py-2.5",
                  "text-xs font-bold text-white",
                  "bg-gradient-to-r from-rose-500 to-pink-500",
                  "shadow-lg shadow-rose-500/20",
                  "hover:scale-105 active:scale-95 transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
                )}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Open Case
              </button>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MetricCard
                label="Open Cases"
                value="2"
                sub="awaiting response"
                icon={AlertCircle}
                accent="rose"
              />
              <MetricCard
                label="Resolved"
                value="7"
                sub="last 30 days"
                icon={CheckCircle2}
                accent="emerald"
                sparkData={[1, 2, 3, 4, 5, 6, 7]}
                trend={{ pct: 40, up: true }}
              />
              <MetricCard
                label="Avg Resolution"
                value="1.4d"
                sub="SLA target: 2 days"
                icon={Zap}
                accent="blue"
              />
            </div>

            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-rose-500" aria-hidden="true" />
                  Active & Recent Cases
                </h3>
                <button
                  aria-label="Filter cases"
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground bg-muted hover:bg-accent rounded-lg px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Filter className="h-3 w-3" aria-hidden="true" />
                  Filter
                </button>
              </div>

              <div className="divide-y divide-border/50" role="list" aria-label="Support cases">
                {[
                  {
                    id: "#C-1042",
                    subject: "Face ID mismatch on 06 Aug 2026",
                    date: "07 Aug 2026",
                    priority: "High",
                    status: "Open",
                    assignee: "IT Support",
                  },
                  {
                    id: "#C-1038",
                    subject: "Absent mark dispute — Wednesday",
                    date: "06 Aug 2026",
                    priority: "Medium",
                    status: "In Review",
                    assignee: "Reg. Office",
                  },
                  {
                    id: "#C-1021",
                    subject: "Check-out not recorded on 28 Jul",
                    date: "28 Jul 2026",
                    priority: "Low",
                    status: "Resolved",
                    assignee: "IT Support",
                  },
                  {
                    id: "#C-1015",
                    subject: "Biometric scanner offline in Lab 3B",
                    date: "20 Jul 2026",
                    priority: "High",
                    status: "Resolved",
                    assignee: "Infra Team",
                  },
                ].map((c) => (
                  <div
                    key={c.id}
                    role="listitem"
                    className="flex flex-wrap items-center gap-3 p-4 hover:bg-muted/20 transition-colors"
                  >
                    <div className="font-black text-xs text-indigo-600 dark:text-indigo-400 w-16 shrink-0 tabular-nums">
                      {c.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {c.subject}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {c.date} · {c.assignee}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cx(
                          "rounded-full px-2 py-0.5 text-[9px] font-black ring-1",
                          c.priority === "High"
                            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/25"
                            : c.priority === "Medium"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/25"
                              : "bg-slate-500/10 text-slate-500 ring-slate-500/20",
                        )}
                      >
                        {c.priority}
                      </span>
                      <span
                        className={cx(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1",
                          c.status === "Resolved"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25"
                            : c.status === "In Review"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25"
                              : "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/25",
                        )}
                      >
                        {c.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageSection>
        )}
      </main>

      {/* ════════════════ SIDEBAR MODALS ════════════════ */}
      {showNotifModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Notifications & Alerts</h3>
                  <p className="text-xs text-slate-400">
                    Real-time system updates & attendance logs
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNotifModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {[
                {
                  title: "Biometric Liveness Active",
                  desc: "Face match algorithm 98.2% confidence verified.",
                  time: "Just now",
                  icon: CheckCircle2,
                  color: "text-emerald-400",
                },
                {
                  title: "SHA-256 Ledger Synced",
                  desc: "Check-in written to append-only database audit log.",
                  time: "10 mins ago",
                  icon: ShieldCheck,
                  color: "text-indigo-400",
                },
                {
                  title: "Geofence Verification",
                  desc: "Location verified within 50m classroom boundary.",
                  time: "1 hour ago",
                  icon: Zap,
                  color: "text-cyan-400",
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-start gap-3"
                >
                  <item.icon className={`h-4 w-4 shrink-0 mt-0.5 ${item.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{item.title}</span>
                      <span className="text-[10px] text-slate-400">{item.time}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowNotifModal(false)}
                className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all"
              >
                Dismiss Notifications
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-violet-500/20 text-violet-400">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">System Settings</h3>
                  <p className="text-xs text-slate-400">Manage security & preferences</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">WebAuthn Hardware Passkey</div>
                  <div className="text-[10px] text-slate-400">
                    Face ID / Touch ID hardware device binding
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(false);
                    navigate({ to: "/enroll" });
                  }}
                  className="px-3 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all"
                >
                  Configure
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">Cryptographic Ledger</div>
                  <div className="text-[10px] text-slate-400">
                    Append-only SHA-256 integrity mode
                  </div>
                </div>
                <span className="px-2.5 py-1 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                  ENFORCED
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">Geofence Radius</div>
                  <div className="text-[10px] text-slate-400">Classroom boundary check</div>
                </div>
                <span className="font-mono text-indigo-400 font-bold">50 Meters</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSettingsModal(false);
                  navigate({ to: "/enroll" });
                }}
                className="px-4 py-2 text-xs font-bold border border-slate-700 hover:bg-slate-800 text-white rounded-xl transition-all"
              >
                Full Profile & Biometrics →
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center text-white text-sm font-black shadow-md">
                  R
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Student Account Profile</h3>
                  <p className="text-xs text-slate-400">Presence ERP Verified Identity</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs bg-slate-800/60 p-4 rounded-xl border border-slate-700/50">
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">Roll Number</span>
                <span className="font-mono font-bold text-indigo-400">24BCSCS031</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">Department</span>
                <span className="font-bold text-white">Cyber Security (SITAICS)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">Institution</span>
                <span className="font-bold text-white">Rashtriya Raksha University</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Biometric Registration</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Enrolled
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(false);
                  navigate({ to: "/enroll" });
                }}
                className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all"
              >
                Manage Profile & Biometrics →
              </button>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
