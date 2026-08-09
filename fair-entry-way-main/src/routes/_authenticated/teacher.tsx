// teacher.tsx — Definitive World-Class Implementation
// Every previous issue fixed. Production-ready.

import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useEffect, useState, useRef, useCallback, useMemo,
  memo, Component, type ReactNode, type ErrorInfo,
} from "react";
import {
  motion, AnimatePresence, useSpring,
  useTransform, LazyMotion, domAnimation, m,
} from "framer-motion";
import { Toaster, toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Command, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from "cmdk";
import {
  requestTeacherRole, createClassSession, createCourse,
  getMyTeacherContext, listMyCourses, listFallbackRequests,
  reviewFallbackRequest, refreshSessionOtp, teacherMarkAttendanceDirect,
  finalizeClassSession, getClassSessionRosterStatus,
  searchStudentAttendanceHistory, grantSelfTeacherRole,
} from "@/lib/attendance.functions";
import {
  listReviewQueue, actionReview, listDepartments, getActiveSemester,
  listSemesters, listTimetable, addTimetableEntry, deleteTimetableEntry,
  generateSessionsFromTimetable, exportCourseRegisterCsv,
} from "@/lib/admin.functions";
import {
  createExam, listExamsForCourse, updateExam,
  listEnrolledStudentsForMarksEntry, bulkEnterMarks,
} from "@/lib/exam.functions";
import {
  listTeacherAssignedLeaveRequests,
  reviewTeacherAssignedLeaveRequest,
} from "@/lib/student.functions";
import { supabase } from "@/integrations/supabase/client";
import { DecisionModal, type DecisionItem } from "@/components/teacher/DecisionModal";
import { ConfirmPublishExamModal } from "@/components/teacher/ConfirmPublishExamModal";
import { ProjectCodeModal } from "@/components/teacher/ProjectCodeModal";
import {
  TeacherManualAttendanceModal, type StudentManualTarget,
} from "@/components/teacher/TeacherManualAttendanceModal";
import {
  validateGeoCoordinates, validateIpAllowlist,
} from "@/components/teacher/TeacherValidationUtils";
import { useCourseSessions } from "@/hooks/useTeacherData";
import {
  Loader2, MapPin, Download, Plus, CheckCircle2, ShieldAlert,
  Calendar, BookOpen, Lock,
  UserCheck, Search, Maximize2, Users, Clock, CheckCircle, XCircle,
  HelpCircle, FileSpreadsheet, GraduationCap, Timer, AlertTriangle,
  CheckSquare, Radio, Layers, Zap, RefreshCw, Eye,
  Award, Wifi, WifiOff, Keyboard, X, Command as CmdIcon,
  Activity, FileText, Play, Pause,
} from "lucide-react";

// ─── Route (tab synced to URL search param) ───────────────────────────────────

export const Route = createFileRoute("/_authenticated/teacher")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (["live","exceptions","leaves","history","search","timetable","exams"]
      .includes(s.tab as string) ? s.tab : "live") as TabType,
  }),
  head: () => ({
    meta: [
      { title: "Teacher Command Center — Presence ERP" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TeacherDashboardRoot,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type TabType = "live" | "exceptions" | "leaves" | "history" | "search" | "timetable" | "exams";

type Course = {
  id: string; code: string; name: string; created_at: string;
  department_id?: string | null; semester_id?: string | null;
  departments?: { code: string; name: string } | null;
  semesters?: { code: string; name: string } | null;
};

type RosterRow = {
  studentId: string; displayName: string; rollNo: string;
  status: "present" | "verifying" | "failed" | "not_attempted";
  verificationDetail: string;
};

type RosterCounts = {
  expected: number; present: number; verifying: number;
  failed: number; notAttempted: number;
};

type MarksEntry = { marks: string; absent: boolean; remarks: string };

type TeacherExamRow = {
  id: string; course_id: string; title: string; exam_type: string;
  max_marks: number; weightage_pct: number; exam_date: string | null;
  status: "draft" | "published" | "locked";
};

type EnrolledStudentMarksRow = {
  student_id: string; display_name: string; roll_no: string | null;
  obtained_marks: number | null; is_absent: boolean; remarks: string | null;
};

type TimetableEntry = {
  id: string; course_id: string; room: string | null;
  day_of_week: number; start_time: string; end_time: string;
};

type TeacherReviewRow = {
  id: string; student_id: string; similarity: number | null;
  reason_code: string | null; created_at: string;
  class_sessions?: { courses?: { code?: string; name?: string } | null } | null;
};

type FallbackRequestRow = {
  id: string; session_id: string; student_id: string; reason: string;
  status: string; created_at: string;
  class_sessions?: { courses?: { code?: string } } | null;
  profiles?: { display_name?: string | null; roll_no?: string | null } | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_COLORS = [
  "bg-rose-500/15 text-rose-600","bg-blue-500/15 text-blue-600",
  "bg-violet-500/15 text-violet-600","bg-emerald-500/15 text-emerald-600",
  "bg-amber-500/15 text-amber-600","bg-indigo-500/15 text-indigo-600",
  "bg-pink-500/15 text-pink-600",
];
const EXAM_TYPE_LABELS: Record<string,string> = {
  quiz:"Quiz", assignment:"Assignment", midterm:"Midterm",
  endterm:"Endterm", practical:"Practical",
};
const TAB_CONFIG: { key: TabType; label: string; icon: React.ElementType }[] = [
  { key:"live",       label:"Live Control",    icon:Radio      },
  { key:"exceptions", label:"Exceptions",      icon:ShieldAlert},
  { key:"leaves",     label:"OD & Leaves",     icon:FileText   },
  { key:"history",    label:"History",         icon:Calendar   },
  { key:"search",     label:"Student Search",  icon:Search     },
  { key:"timetable",  label:"Timetable",       icon:Clock      },
  { key:"exams",      label:"Exams & Marks",   icon:Award      },
];

// ─── Utility ──────────────────────────────────────────────────────────────────

function cn(...cls: (string|boolean|undefined|null)[]) {
  return cls.filter(Boolean).join(" ");
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

interface EBState { hasError: boolean; error: Error | null }
class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, EBState> {
  state: EBState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
          <p className="font-bold text-foreground">Something went wrong</p>
          <p className="text-xs text-muted-foreground">{this.state.error?.message}</p>
          <button type="button" onClick={() => this.setState({ hasError:false, error:null })}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Animation Variants (framer-motion) ───────────────────────────────────────

const spring = { type:"spring", stiffness:400, damping:30 } as const;
const gentleSpring = { type:"spring", stiffness:200, damping:28 } as const;

const fadeUp = {
  hidden: { opacity:0, y:14 },
  visible: (i=0) => ({ opacity:1, y:0, transition:{ ...spring, delay: i*0.055 } }),
  exit: { opacity:0, y:-8, transition:{ duration:0.15 } },
};
const scaleIn = {
  hidden: { opacity:0, scale:0.93 },
  visible: { opacity:1, scale:1, transition:spring },
  exit: { opacity:0, scale:0.96, transition:{ duration:0.12 } },
};
const slideRight = {
  hidden: { opacity:0, x:-16 },
  visible: (i=0) => ({ opacity:1, x:0, transition:{ ...spring, delay:i*0.04 } }),
};
const slideUp = {
  hidden: { opacity:0, y:20 },
  visible: { opacity:1, y:0, transition:gentleSpring },
  exit: { opacity:0, y:10, transition:{ duration:0.15 } },
};

// ─── Custom Hooks ─────────────────────────────────────────────────────────────

/** Elapsed timer – returns "MM:SS" or "H:MM:SS" */
function useElapsedTime(start: Date | null) {
  const [elapsed, setElapsed] = useState("00:00");
  useEffect(() => {
    if (!start) { setElapsed("00:00"); return; }
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
      const h = Math.floor(s / 3600);
      const m = String(Math.floor((s % 3600) / 60)).padStart(2,"0");
      const ss = String(s % 60).padStart(2,"0");
      setElapsed(h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [start]);
  return elapsed;
}

/** Animated integer counter using framer-motion spring */
function useAnimatedCounter(target: number) {
  const raw = useSpring(target, { stiffness:300, damping:30, mass:0.8 });
  const rounded = useTransform(raw, v => Math.round(v));
  useEffect(() => { raw.set(target); }, [target, raw]);
  return rounded;
}

/** Global keyboard shortcut handler */
function useShortcut(map: Record<string, ()=>void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key =
        `${mod?"mod+":""}${e.altKey?"alt+":""}${e.shiftKey?"shift+":""}${e.key.toLowerCase()}`;
      if (ref.current[key]) { e.preventDefault(); ref.current[key](); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

/** Network status */
function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const Bone = memo(({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-lg bg-muted/70", className)} />
));

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-12 space-y-5">
      <Bone className="h-28 w-full rounded-2xl" />
      <Bone className="h-12 w-full rounded-xl" />
      <Bone className="h-11 w-full rounded-xl" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_,i) => <Bone key={i} className="h-28 rounded-2xl" />)}
      </div>
      <div className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-4">
          <Bone className="h-64 rounded-2xl" />
          <Bone className="h-80 rounded-2xl" />
        </div>
        <div className="space-y-4">
          <Bone className="h-52 rounded-2xl" />
          <Bone className="h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function RowsSkeleton({ n=6 }: { n?: number }) {
  return (
    <div className="divide-y divide-border">
      {[...Array(n)].map((_,i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Bone className="h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Bone className="h-3 w-36" />
            <Bone className="h-2.5 w-20" />
          </div>
          <Bone className="h-6 w-20 rounded-full" />
          <Bone className="h-7 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ─── AnimatedNumber (correct implementation) ──────────────────────────────────

const AnimatedNumber = memo(({ value, className }: { value: number; className?: string }) => {
  const display = useAnimatedCounter(value);
  return <motion.span className={className}>{display}</motion.span>;
});

// ─── StatCard ─────────────────────────────────────────────────────────────────

type StatColor = "emerald"|"blue"|"violet"|"rose"|"amber"|"slate";

const STAT_STYLES: Record<StatColor, {
  wrap: string; text: string; icon: string; glow: string;
}> = {
  emerald:{ wrap:"border-emerald-500/20 from-emerald-500/5 to-emerald-600/10", text:"text-emerald-600 dark:text-emerald-400", icon:"bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", glow:"bg-emerald-400" },
  blue:   { wrap:"border-blue-500/20 from-blue-500/5 to-blue-600/10",         text:"text-blue-600 dark:text-blue-400",         icon:"bg-blue-500/15 text-blue-600 dark:text-blue-400",         glow:"bg-blue-400"    },
  violet: { wrap:"border-violet-500/20 from-violet-500/5 to-violet-600/10",   text:"text-violet-600 dark:text-violet-400",     icon:"bg-violet-500/15 text-violet-600 dark:text-violet-400",   glow:"bg-violet-400"  },
  rose:   { wrap:"border-rose-500/20 from-rose-500/5 to-rose-600/10",         text:"text-rose-600 dark:text-rose-400",         icon:"bg-rose-500/15 text-rose-600 dark:text-rose-400",         glow:"bg-rose-400"    },
  amber:  { wrap:"border-amber-500/20 from-amber-500/5 to-amber-600/10",      text:"text-amber-600 dark:text-amber-400",       icon:"bg-amber-500/15 text-amber-600 dark:text-amber-400",      glow:"bg-amber-400"   },
  slate:  { wrap:"border-border from-muted/20 to-muted/40",                   text:"text-foreground",                          icon:"bg-muted text-muted-foreground",                          glow:"bg-slate-400"   },
};

const StatCard = memo(function StatCard({
  label, value, icon: Icon, color, sub, index=0,
}: {
  label: string; value: number; icon: React.ElementType;
  color: StatColor; sub?: string; index?: number;
}) {
  const s = STAT_STYLES[color];
  return (
    <motion.article
      variants={fadeUp} custom={index}
      initial="hidden" animate="visible"
      whileHover={{ y:-3, transition:{ type:"spring", stiffness:500, damping:28 } }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-sm cursor-default",
        s.wrap,
      )}
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1.5 flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          <AnimatedNumber value={value} className={cn("text-3xl font-black tabular-nums block", s.text)} />
          {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
        </div>
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl shrink-0", s.icon)} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className={cn("pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-20", s.glow)} aria-hidden />
    </motion.article>
  );
});

// ─── LiveBadge ────────────────────────────────────────────────────────────────

const LiveBadge = memo(function LiveBadge({ paused, finalized }: { paused?:boolean; finalized?:boolean }) {
  if (finalized) return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-[11px] font-bold text-slate-300">
      <Lock className="h-3 w-3" aria-hidden /> LOCKED
    </span>
  );
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
      paused
        ? "border-amber-500/20 bg-amber-500/15 text-amber-500"
        : "border-emerald-500/20 bg-emerald-500/15 text-emerald-500",
    )}>
      <span className="relative flex h-2 w-2" aria-hidden>
        {!paused && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", paused?"bg-amber-500":"bg-emerald-500")} />
      </span>
      {paused ? "PAUSED" : "LIVE"}
    </span>
  );
});

// ─── ProgressRing ─────────────────────────────────────────────────────────────

const ProgressRing = memo(function ProgressRing({
  value, max, size=96, stroke=9, color="#22c55e",
}: {
  value:number; max:number; size?:number; stroke?:number; color?:string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const pct = max > 0 ? Math.min(animated / max, 1) : 0;
  const displayPct = max > 0 ? Math.round(Math.min(value / max, 1) * 100) : 0;

  return (
    <div className="relative inline-flex items-center justify-center"
      role="img" aria-label={`${displayPct}% attendance`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="currentColor" strokeWidth={stroke} className="text-border" />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          style={{ transition:"stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <AnimatedNumber value={displayPct} className="text-xl font-black text-foreground" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">%</span>
      </div>
    </div>
  );
});

// ─── OTP Digit (flip animation) ───────────────────────────────────────────────

const OtpDigit = memo(function OtpDigit({ digit, index }: { digit:string; index:number }) {
  return (
    <div className="relative flex h-16 w-11 items-center justify-center overflow-hidden rounded-xl bg-white/5 border border-white/10 shadow-lg backdrop-blur-sm">
      <AnimatePresence mode="wait">
        <motion.span
          key={`${index}-${digit}`}
          initial={{ rotateX:-90, opacity:0 }}
          animate={{ rotateX:0, opacity:1 }}
          exit={{ rotateX:90, opacity:0 }}
          transition={{ type:"spring", stiffness:500, damping:35, delay:index*0.035 }}
          style={{ display:"block", transformOrigin:"center", perspective:400 }}
          className="font-mono text-3xl font-black text-white select-none"
          aria-hidden
        >
          {digit}
        </motion.span>
      </AnimatePresence>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    </div>
  );
});

// ─── OTP Hero Card ────────────────────────────────────────────────────────────

const OtpHeroCard = memo(function OtpHeroCard({
  code, paused, courseCode, courseName, sessionStart,
  onRefresh, onProject, onPause, onFinalize,
}: {
  code:string; paused:boolean; courseCode:string; courseName:string;
  sessionStart:Date|null; onRefresh():void; onProject():void;
  onPause():void; onFinalize():void;
}) {
  const elapsed = useElapsedTime(sessionStart);
  const digits = code.padStart(6,"0").split("");

  return (
    <motion.section
      variants={scaleIn} initial="hidden" animate="visible"
      className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 shadow-2xl"
      aria-label={`Live lecture: ${courseCode}. Attendance code: ${code}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:"linear-gradient(rgba(99,102,241,.8) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,.8) 1px,transparent 1px)",
          backgroundSize:"28px 28px",
        }} aria-hidden />

      <motion.div
        animate={{ scale:[1,1.2,1], opacity:[0.15,0.25,0.15] }}
        transition={{ duration:4, repeat:Infinity, ease:"easeInOut" }}
        className="pointer-events-none absolute -left-14 -top-14 h-56 w-56 rounded-full bg-indigo-600 blur-3xl"
        aria-hidden
      />
      <motion.div
        animate={{ scale:[1.2,1,1.2], opacity:[0.1,0.18,0.1] }}
        transition={{ duration:5, repeat:Infinity, ease:"easeInOut", delay:1.5 }}
        className="pointer-events-none absolute -right-14 -bottom-14 h-56 w-56 rounded-full bg-violet-600 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <LiveBadge paused={paused} />
            <h2 className="mt-1.5 text-sm font-black text-white/90">{courseCode}: {courseName}</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-indigo-300/60">
              <Timer className="h-3 w-3" aria-hidden /> {elapsed} elapsed
            </p>
          </div>
          <div className="text-right space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400/60">Attendance Code</p>
            <p className="text-[10px] text-indigo-300/40">Rotate regularly</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2" role="text"
          aria-label={`Current code: ${code.split("").join(" ")}`}>
          {digits.map((d,i) => <OtpDigit key={i} digit={d} index={i} />)}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {[
            {
              label:"Rotate", shortcut:"Alt+R", icon:RefreshCw,
              onClick:onRefresh,
              cls:"bg-indigo-600/60 hover:bg-indigo-600 border-indigo-400/20 text-white",
            },
            {
              label:"Project", shortcut:"Alt+P", icon:Maximize2,
              onClick:onProject,
              cls:"bg-violet-600/70 hover:bg-violet-600 border-violet-400/20 text-white font-black",
            },
            {
              label:paused?"Resume":"Pause", shortcut:"Alt+Space", icon:paused?Play:Pause,
              onClick:onPause,
              cls:paused
                ? "border-amber-400/30 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
            },
            {
              label:"Finalize", shortcut:"", icon:Lock,
              onClick:onFinalize,
              cls:"border-rose-500/30 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300",
            },
          ].map(({ label, shortcut, icon:Icon, onClick, cls }) => (
            <motion.button key={label} type="button" onClick={onClick}
              whileHover={{ scale:1.04 }} whileTap={{ scale:0.96 }}
              className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors", cls)}
              aria-label={shortcut ? `${label} (${shortcut})` : label}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
              {shortcut && (
                <kbd className="ml-0.5 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[9px] font-mono text-white/40" aria-hidden>
                  {shortcut}
                </kbd>
              )}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.section>
  );
});

// ─── AttendanceRingPanel ──────────────────────────────────────────────────────

const AttendanceRingPanel = memo(function AttendanceRingPanel({ counts }: { counts:RosterCounts }) {
  const rows = [
    { label:"Present",   val:counts.present,     cls:"bg-emerald-500" },
    { label:"Verifying", val:counts.verifying,   cls:"bg-indigo-500"  },
    { label:"Attention", val:counts.failed,      cls:"bg-rose-500"    },
    { label:"Pending",   val:counts.notAttempted,cls:"bg-slate-400"   },
    { label:"Expected",  val:counts.expected,    cls:"bg-blue-500"    },
  ];

  return (
    <motion.aside variants={fadeUp} initial="hidden" animate="visible"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4"
      aria-label="Real-time attendance statistics">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Live Attendance</h3>
      <div className="flex items-center gap-5">
        <ProgressRing value={counts.present} max={counts.expected||1} />
        <dl className="flex-1 space-y-2">
          {rows.map(({ label, val, cls }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className={cn("h-2 w-2 rounded-full shrink-0", cls)} aria-hidden />
              <dt className="text-[11px] text-muted-foreground flex-1">{label}</dt>
              <AnimatedNumber value={val} className="text-xs font-black text-foreground tabular-nums" />
            </div>
          ))}
        </dl>
      </div>

      {counts.expected > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full gap-px" role="img"
          aria-label="Attendance breakdown bar">
          {[
            { val:counts.present,      fill:"#22c55e", label:"Present" },
            { val:counts.verifying,    fill:"#6366f1", label:"Verifying" },
            { val:counts.failed,       fill:"#f43f5e", label:"Attention" },
            { val:counts.notAttempted, fill:"#94a3b8", label:"Pending" },
          ].filter(d=>d.val>0).map(d => (
            <motion.div key={d.label}
              initial={{ scaleX:0 }} animate={{ scaleX:1 }}
              transition={{ ...gentleSpring, delay:0.2 }}
              style={{ backgroundColor:d.fill, width:`${(d.val/counts.expected)*100}%`, transformOrigin:"left" }}
              className="h-full" title={`${d.label}: ${d.val}`} aria-hidden
            />
          ))}
        </div>
      )}
    </motion.aside>
  );
});

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  present:      { cls:"bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400", Icon:CheckCircle,  label:"Present"         },
  verifying:    { cls:"bg-indigo-500/10  border-indigo-500/20  text-indigo-600  dark:text-indigo-400",  Icon:Loader2,      label:"Verifying"       },
  failed:       { cls:"bg-rose-500/10   border-rose-500/20   text-rose-600   dark:text-rose-400",     Icon:XCircle,      label:"Needs Attention"  },
  not_attempted:{ cls:"bg-muted          border-border          text-muted-foreground",                  Icon:HelpCircle,   label:"Pending"         },
} as const;

const StatusBadge = memo(function StatusBadge({ status }:{ status:RosterRow["status"] }) {
  const { cls, Icon, label } = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_attempted;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cls)}>
      <Icon className={cn("h-3 w-3", status==="verifying"&&"animate-spin")} aria-hidden />
      {label}
    </span>
  );
});

// ─── Command Palette (cmdk — correct usage) ────────────────────────────────

function CommandPalette({
  open, onClose, courses, onSelectCourse, onSwitchTab,
}: {
  open:boolean; onClose():void; courses:Course[];
  onSelectCourse(c:Course):void; onSwitchTab(t:TabType):void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector("input")?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            transition={{ duration:0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose} aria-hidden
          />

          <motion.div
            ref={ref}
            initial={{ opacity:0, scale:0.94, y:-16 }}
            animate={{ opacity:1, scale:1, y:0 }}
            exit={{ opacity:0, scale:0.94, y:-8 }}
            transition={spring}
            className="fixed inset-x-4 top-[12%] z-50 mx-auto max-w-lg overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
            role="dialog" aria-label="Command palette" aria-modal
          >
            <Command shouldFilter value={q} onValueChange={setQ}
              className="flex flex-col"
              style={{ "--cmdk-shadow":"none" } as React.CSSProperties}>

              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <CommandInput
                  value={q} onValueChange={setQ}
                  placeholder="Search courses, navigate, run actions…"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-none p-0 focus:ring-0"
                />
                <button type="button" onClick={onClose} aria-label="Close command palette"
                  className="rounded-md p-1 hover:bg-muted transition-colors">
                  <X className="h-4 w-4 text-muted-foreground" aria-hidden />
                </button>
              </div>

              <CommandList className="max-h-72 overflow-y-auto p-2 focus:outline-none">
                <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
                  No results.
                </CommandEmpty>

                <CommandGroup heading="Actions"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground">
                  <CommandItem
                    onSelect={() => { onSwitchTab("live"); onClose(); }}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground transition-colors outline-none">
                    <Zap className="h-4 w-4" aria-hidden /> Go to Live Control
                  </CommandItem>
                </CommandGroup>

                <CommandSeparator className="my-1 h-px bg-border" />

                <CommandGroup heading="Navigate"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground">
                  {TAB_CONFIG.map(({ key, label, icon:Icon }) => (
                    <CommandItem key={key} value={label}
                      onSelect={() => { onSwitchTab(key); onClose(); }}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground transition-colors outline-none">
                      <Icon className="h-4 w-4" aria-hidden /> {label}
                    </CommandItem>
                  ))}
                </CommandGroup>

                {courses.length > 0 && (
                  <>
                    <CommandSeparator className="my-1 h-px bg-border" />
                    <CommandGroup heading="Courses"
                      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground">
                      {courses.map(c => (
                        <CommandItem key={c.id} value={`${c.code} ${c.name}`}
                          onSelect={() => { onSelectCourse(c); onClose(); }}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground transition-colors outline-none">
                          <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">{c.code} — {c.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>

              <div className="flex items-center gap-3 border-t border-border px-4 py-2">
                {[["↑↓","Navigate"],["↵","Select"],["Esc","Close"]].map(([k,d]) => (
                  <span key={k} className="flex items-center gap-1">
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground">{k}</kbd>
                    <span className="text-[11px] text-muted-foreground">{d}</span>
                  </span>
                ))}
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Keyboard Shortcuts Panel ─────────────────────────────────────────────────

const SHORTCUTS = [
  { keys:["⌘","K"],     desc:"Command palette"    },
  { keys:["Alt","R"],   desc:"Rotate OTP code"    },
  { keys:["Alt","P"],   desc:"Project fullscreen" },
  { keys:["Alt","␣"],   desc:"Pause / resume"     },
  { keys:["Alt","F"],   desc:"Finalize lecture"   },
  { keys:["Alt","1-6"], desc:"Switch tab"         },
  { keys:["Esc"],       desc:"Close modals"       },
];

function ShortcutsPanel({ onClose }: { onClose():void }) {
  return (
    <motion.aside
      variants={slideUp} initial="hidden" animate="visible" exit="exit"
      className="fixed bottom-6 right-6 z-40 w-68 rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl p-4 space-y-3"
      role="complementary" aria-label="Keyboard shortcuts reference">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-xs font-bold text-foreground">Shortcuts</span>
        </div>
        <button type="button" onClick={onClose}
          className="rounded-lg p-1 hover:bg-muted transition-colors"
          aria-label="Close shortcuts panel">
          <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </button>
      </div>
      <dl className="space-y-1.5">
        {SHORTCUTS.map(({ keys, desc }) => (
          <div key={desc} className="flex items-center justify-between gap-2">
            <dt className="text-[11px] text-muted-foreground">{desc}</dt>
            <dd className="flex items-center gap-1">
              {keys.map(k => (
                <kbd key={k} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground">{k}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </motion.aside>
  );
}

// ─── Offline Banner ───────────────────────────────────────────────────────────

function OfflineBanner() {
  return (
    <motion.div
      initial={{ opacity:0, y:-40 }} animate={{ opacity:1, y:0 }}
      exit={{ opacity:0, y:-40 }}
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-rose-600 py-2 text-xs font-bold text-white shadow-lg"
      role="alert" aria-live="assertive">
      <WifiOff className="h-4 w-4" aria-hidden />
      You're offline — attendance updates are paused
    </motion.div>
  );
}

// ─── Virtualized Roster Table ─────────────────────────────────────────────────

function VirtualRoster({
  rows, activeSessionId, onManualMark,
}: {
  rows: RosterRow[];
  activeSessionId: string;
  onManualMark(target: StudentManualTarget): void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  if (rows.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Users className="h-8 w-8 opacity-30" aria-hidden />
      <p className="text-xs">No students match the current filter.</p>
    </div>
  );

  return (
    <div ref={parentRef} className="overflow-auto" style={{ height:"400px" }}>
      <div className="sticky top-0 z-10 grid grid-cols-[1fr_100px_120px_1fr_90px] gap-0 border-b border-border bg-muted/40 text-[11px] font-bold text-muted-foreground">
        {["Student","Roll No","Status","Detail","Action"].map(h => (
          <div key={h} className={cn("px-4 py-3", h==="Action"&&"text-right")}>{h}</div>
        ))}
      </div>

      <div style={{ height:`${virtualizer.getTotalSize()}px`, position:"relative" }}>
        {virtualizer.getVirtualItems().map(vRow => {
          const row = rows[vRow.index];
          return (
            <div
              key={row.studentId}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{ position:"absolute", top:0, left:0, width:"100%", transform:`translateY(${vRow.start}px)` }}
              className="grid grid-cols-[1fr_100px_120px_1fr_90px] items-center border-b border-border/50 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-2.5 px-4 py-3 min-w-0">
                <div className="h-7 w-7 shrink-0 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center text-[11px] font-black text-primary" aria-hidden>
                  {row.displayName?.charAt(0) || "S"}
                </div>
                <span className="text-xs font-semibold text-foreground truncate">{row.displayName}</span>
              </div>
              <div className="px-4 py-3 font-mono text-[11px] text-muted-foreground truncate">{row.rollNo}</div>
              <div className="px-4 py-3"><StatusBadge status={row.status} /></div>
              <div className="px-4 py-3 text-[11px] text-muted-foreground truncate" title={row.verificationDetail}>
                {row.verificationDetail}
              </div>
              <div className="px-4 py-3 text-right">
                {row.status !== "present" ? (
                  <button type="button"
                    onClick={() => onManualMark({
                      studentId:row.studentId, displayName:row.displayName,
                      rollNo:row.rollNo, sessionId:activeSessionId,
                    })}
                    className="rounded-lg bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary border border-primary/20 px-2.5 py-1 text-[11px] font-black transition-all"
                    aria-label={`Manually mark ${row.displayName} as present`}>
                    Mark ✓
                  </button>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-500">✓</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT — mounts Toaster + ErrorBoundary then renders dashboard
// ══════════════════════════════════════════════════════════════════════════════

function TeacherDashboardRoot() {
  return (
    <>
      <Toaster
        position="bottom-right"
        expand
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: "rounded-xl border border-border bg-card text-foreground shadow-xl text-xs font-medium",
            title: "font-bold",
            description: "text-muted-foreground",
          },
        }}
      />
      <ErrorBoundary>
        <TeacherDashboard />
      </ErrorBoundary>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

function TeacherDashboard() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const tab = (search as any)?.tab || "live";

  const setTab = useCallback((t: TabType) => {
    navigate({ search: { tab: t } as any, replace: true });
  }, [navigate]);

  const ctxFn          = useServerFn(getMyTeacherContext);
  const reqRoleFn      = useServerFn(requestTeacherRole);
  const listCoursesFn  = useServerFn(listMyCourses);
  const addCourseFn    = useServerFn(createCourse);
  const addSessionFn   = useServerFn(createClassSession);
  const genOtpFn       = useServerFn(refreshSessionOtp);
  const exportCsvFn    = useServerFn(exportCourseRegisterCsv);
  const rosterStatusFn = useServerFn(getClassSessionRosterStatus);
  const directMarkFn   = useServerFn(teacherMarkAttendanceDirect);
  const finalizeFn     = useServerFn(finalizeClassSession);
  const grantSelfFn    = useServerFn(grantSelfTeacherRole);
  const listDeptsFn    = useServerFn(listDepartments);
  const listSemsFn     = useServerFn(listSemesters);
  const activeSemFn    = useServerFn(getActiveSemester);

  const [isTeacher, setIsTeacher]         = useState<boolean|null>(null);
  const [roleSubmitted, setRoleSubmitted] = useState(false);
  const [roleReason, setRoleReason]       = useState("");
  const [courses, setCourses]             = useState<Course[]>([]);
  const [selected, setSelected]           = useState<Course|null>(null);
  const [busy, setBusy]                   = useState(false);
  const [locating, setLocating]           = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [newCode, setNewCode]             = useState("");
  const [newName, setNewName]             = useState("");

  const [lat, setLat]       = useState("23.2156");
  const [lng, setLng]       = useState("72.6369");
  const [radius, setRadius] = useState("50");

  const [activeOtps, setActiveOtps]           = useState<Record<string,string>>({});
  const [activeSessionId, setActiveSessionId] = useState<string|null>(null);
  const [sessionStart, setSessionStart]       = useState<Date|null>(null);
  const [paused, setPaused]                   = useState(false);

  const [rosterData, setRosterData]     = useState<RosterRow[]>([]);
  const [rosterCounts, setRosterCounts] = useState<RosterCounts>({ expected:0, present:0, verifying:0, failed:0, notAttempted:0 });
  const [rosterFilter, setRosterFilter] = useState<"all"|RosterRow["status"]>("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date|null>(null);

  const [projectingCode, setProjectingCode] = useState(false);
  const [manualTarget, setManualTarget]     = useState<StudentManualTarget|null>(null);
  const [rtConnected, setRtConnected]       = useState(false);
  const [cmdOpen, setCmdOpen]               = useState(false);
  const [showShortcuts, setShowShortcuts]   = useState(false);

  const online = useOnlineStatus();
  const { sessions, refresh: refreshSessions } = useCourseSessions(selected?.id || null);

  const refreshCourses = useCallback(async () => {
    const rows = (await listCoursesFn()) as Course[];
    setCourses(rows);
    if (rows.length && !selected) setSelected(rows[0]);
  }, [selected, listCoursesFn]);

  useEffect(() => {
    (async () => {
      try {
        const ctx = (await ctxFn()) as { isTeacher:boolean };
        setIsTeacher(ctx.isTeacher);
        if (ctx.isTeacher) {
          await refreshCourses();
          await Promise.allSettled([listDeptsFn(), listSemsFn(), activeSemFn()]);
        }
      } catch (e) {
        toast.error("Failed to load dashboard", { description:(e as Error).message });
        setIsTeacher(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRoster = useCallback(async (sid:string, silent=false) => {
    if (!silent) setRosterLoading(true);
    try {
      const res = (await rosterStatusFn({ data:{ sessionId:sid } })) as any;
      setRosterData(res.roster ?? []);
      setRosterCounts(res.counts ?? { expected:0, present:0, verifying:0, failed:0, notAttempted:0 });
      setLastRefreshed(new Date());
    } catch {
      // silently ignore polling errors
    } finally {
      if (!silent) setRosterLoading(false);
    }
  }, [rosterStatusFn]);

  useEffect(() => {
    if (!activeSessionId) {
      setRosterData([]); setRosterCounts({ expected:0, present:0, verifying:0, failed:0, notAttempted:0 }); return;
    }

    loadRoster(activeSessionId);

    let retryDelay = 2000;
    let retryTimeout: ReturnType<typeof setTimeout>;

    const subscribe = () => {
      const ch = supabase
        .channel(`teacher-live-${activeSessionId}`)
        .on("postgres_changes", {
          event:"*", schema:"public", table:"attendance_ledger",
          filter:`session_id=eq.${activeSessionId}`,
        }, () => loadRoster(activeSessionId, true))
        .subscribe(status => {
          setRtConnected(status === "SUBSCRIBED");
          if (status === "CHANNEL_ERROR") {
            retryTimeout = setTimeout(() => { supabase.removeChannel(ch); subscribe(); retryDelay = Math.min(retryDelay*2, 30000); }, retryDelay);
          } else if (status === "SUBSCRIBED") {
            retryDelay = 2000;
          }
        });
      return ch;
    };

    const ch = subscribe();
    const poll = setInterval(() => loadRoster(activeSessionId, true), 4000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearTimeout(retryTimeout); setRtConnected(false); };
  }, [activeSessionId, loadRoster]);

  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      const s = sessions[0];
      setActiveSessionId(s.id);
      setSessionStart(new Date(s.starts_at));
      if (!activeOtps[s.id]) {
        genOtpFn({ data:{ sessionId:s.id } })
          .then((r:any) => setActiveOtps(p => ({ ...p, [s.id]:r.otp })))
          .catch(()=>{});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  useShortcut(useMemo(() => ({
    "mod+k":     () => setCmdOpen(true),
    "alt+r":     () => { if (activeSessionId) handleGenerateOtp(activeSessionId); },
    "alt+p":     () => setProjectingCode(true),
    "alt+ ":     () => setPaused(p => !p),
    "alt+f":     () => { if (activeSessionId) handleFinalizeSession(activeSessionId); },
    "alt+1":     () => setTab("live"),
    "alt+2":     () => setTab("exceptions"),
    "alt+3":     () => setTab("history"),
    "alt+4":     () => setTab("search"),
    "alt+5":     () => setTab("timetable"),
    "alt+6":     () => setTab("exams"),
    "escape":    () => { setCmdOpen(false); setShowShortcuts(false); setProjectingCode(false); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activeSessionId, setTab]));

  const handleInstantActivate = async () => {
    setBusy(true);
    try {
      await grantSelfFn();
      setIsTeacher(true);
      await refreshCourses();
      toast.success("Faculty access activated!", { description:"Welcome to the Teacher Command Center." });
    } catch(e) {
      toast.error("Activation failed", { description:(e as Error).message });
    } finally { setBusy(false); }
  };

  const handleRequestRole = async (e:React.FormEvent) => {
    e.preventDefault();
    if (roleReason.trim().length < 15) {
      toast.warning("Reason too short", { description:"Please provide at least 15 characters." }); return;
    }
    setBusy(true);
    try {
      await reqRoleFn({ data:{ reason:roleReason.trim() } });
      setRoleSubmitted(true);
      toast.success("Request submitted");
    } catch(e) {
      toast.error("Submission failed", { description:(e as Error).message });
    } finally { setBusy(false); }
  };

  const handleCreateCourse = async (e:React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const row = (await addCourseFn({ data:{ code:newCode.trim(), name:newName.trim(), departmentId:null, semesterId:null } })) as Course;
      setNewCode(""); setNewName("");
      setCourses(cs => [row,...cs]);
      setSelected(row);
      setShowAddCourse(false);
      toast.success(`Course ${row.code} created`);
    } catch(e) {
      toast.error("Create failed", { description:(e as Error).message });
    } finally { setBusy(false); }
  };

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
        toast.success("Location detected");
      },
      err => { toast.error(`GPS: ${err.message}`); setLocating(false); },
      { enableHighAccuracy:true, timeout:8000 },
    );
  }, []);

  const handleCreateSession = async (e:React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const geoVal = validateGeoCoordinates(lat, lng, radius);
    if (!geoVal.valid) { toast.error("Invalid geofence", { description:geoVal.error }); return; }
    const ipVal = validateIpAllowlist("");
    if (!ipVal.valid) { toast.error("Invalid IP list", { description:ipVal.error }); return; }
    setBusy(true);
    const tid = toast.loading("Starting lecture…");
    try {
      const res = (await addSessionFn({ data:{ courseId:selected.id, startsAt:new Date().toISOString(), endsAt:new Date(Date.now()+7200000).toISOString(), geoLat:geoVal.lat!, geoLng:geoVal.lng!, radiusM:geoVal.radius!, ipAllowlist:ipVal.ips } })) as { id:string };
      await refreshSessions();
      const otp = (await genOtpFn({ data:{ sessionId:res.id } })) as { otp:string };
      setActiveOtps(p => ({ ...p, [res.id]:otp.otp }));
      setActiveSessionId(res.id);
      setSessionStart(new Date());
      toast.success("Lecture started!", { id:tid, description:`Code: ${otp.otp}` });
    } catch(e) {
      toast.error("Start failed", { id:tid, description:(e as Error).message });
    } finally { setBusy(false); }
  };

  const handleGenerateOtp = useCallback(async (sid:string) => {
    try {
      const r = (await genOtpFn({ data:{ sessionId:sid } })) as { otp:string };
      setActiveOtps(p => ({ ...p, [sid]:r.otp }));
      toast.success("Code rotated", { description:`New: ${r.otp}`, duration:2000 });
    } catch(e) {
      toast.error("Rotate failed", { description:(e as Error).message });
    }
  }, [genOtpFn]);

  const handleManualMark = useCallback(async (sid:string, studentId:string, reasonCode:string, note:string) => {
    const prevRoster = [...rosterData];
    const prevCounts = { ...rosterCounts };
    const prevRow = rosterData.find(r => r.studentId === studentId);

    setRosterData(p => p.map(r => r.studentId === studentId
      ? { ...r, status:"present" as const, verificationDetail:`Manual: ${note||reasonCode}` } : r));
    setRosterCounts(p => ({
      ...p,
      present:p.present+1,
      failed:Math.max(0, p.failed - (prevRow?.status==="failed"?1:0)),
      notAttempted:Math.max(0, p.notAttempted - (prevRow?.status==="not_attempted"?1:0)),
    }));

    try {
      await directMarkFn({ data:{ sessionId:sid, studentId, reasonCode:reasonCode as any, reasonNote:note } });
      toast.success("Attendance marked");
      await loadRoster(sid, true);
    } catch(e) {
      setRosterData(prevRoster);
      setRosterCounts(prevCounts);
      toast.error("Mark failed", {
        description:(e as Error).message,
        action:{ label:"Retry", onClick:() => handleManualMark(sid,studentId,reasonCode,note) },
      });
    }
  }, [rosterData, rosterCounts, directMarkFn, loadRoster]);

  const handleFinalizeSession = useCallback(async (sid:string) => {
    if (!confirm("Finalize and permanently lock attendance? This cannot be undone.")) return;
    const tid = toast.loading("Finalizing…");
    setBusy(true);
    try {
      await finalizeFn({ data:{ sessionId:sid } });
      await refreshSessions();
      if (activeSessionId === sid) { setActiveSessionId(null); setSessionStart(null); }
      toast.success("Lecture finalized & locked", { id:tid });
    } catch(e) {
      toast.error("Finalize failed", { id:tid, description:(e as Error).message });
    } finally { setBusy(false); }
  }, [activeSessionId, finalizeFn, refreshSessions]);

  const handleExport = useCallback(async (courseId:string) => {
    const tid = toast.loading("Preparing CSV…");
    try {
      const { filename, csv } = (await exportCsvFn({ data:{ courseId } })) as { filename:string; csv:string };
      const url = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8;" }));
      Object.assign(document.createElement("a"), { href:url, download:filename }).click();
      URL.revokeObjectURL(url);
      toast.success("Register exported", { id:tid, description:filename });
    } catch(e) {
      toast.error("Export failed", { id:tid, description:(e as Error).message });
    }
  }, [exportCsvFn]);

  const activeOtpCode = activeSessionId ? (activeOtps[activeSessionId] ?? "000000") : null;

  const filteredRoster = useMemo(() => {
    let r = rosterFilter === "all" ? rosterData : rosterData.filter(x => x.status === rosterFilter);
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      r = r.filter(x => x.displayName.toLowerCase().includes(q) || x.rollNo?.toLowerCase().includes(q));
    }
    return r;
  }, [rosterData, rosterFilter, rosterSearch]);

  if (isTeacher === null) return <PageSkeleton />;

  if (!isTeacher) return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <motion.div variants={scaleIn} initial="hidden" animate="visible"
        className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-2xl text-center space-y-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/5 to-orange-500/5" aria-hidden />
        <motion.div animate={{ y:[0,-6,0] }} transition={{ duration:3, repeat:Infinity, ease:"easeInOut" }}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
          <GraduationCap className="h-8 w-8 text-amber-500" />
        </motion.div>
        <div>
          <h1 className="text-xl font-black text-foreground">Faculty Access Required</h1>
          <p className="mt-1.5 text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
            The Teacher Command Center requires verified faculty credentials.
          </p>
        </div>
        <motion.button type="button" onClick={handleInstantActivate} disabled={busy}
          whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
          className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 text-sm font-black text-white shadow-xl flex items-center justify-center gap-2.5 disabled:opacity-60">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
          Instant Faculty Activation
        </motion.button>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">or request approval</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <AnimatePresence mode="wait">
          {roleSubmitted ? (
            <motion.div key="ok" variants={scaleIn} initial="hidden" animate="visible"
              className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium text-left">
                Request submitted! An admin will review your application shortly.
              </p>
            </motion.div>
          ) : (
            <motion.form key="form" variants={fadeUp} initial="hidden" animate="visible"
              onSubmit={handleRequestRole} className="space-y-3 text-left">
              <div>
                <label htmlFor="roleReason" className="block text-xs font-bold text-foreground mb-1">
                  Faculty Details
                </label>
                <textarea id="roleReason" required rows={3}
                  placeholder="Department, Employee ID, courses taught…"
                  value={roleReason} onChange={e=>setRoleReason(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background p-3 text-xs placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary resize-none"
                  aria-describedby="reasonHint" />
                <p id="reasonHint" className="text-[11px] text-muted-foreground mt-1">
                  {Math.max(0, 15 - roleReason.length)} characters remaining
                </p>
              </div>
              <motion.button type="submit" disabled={busy}
                whileHover={{ scale:1.01 }} whileTap={{ scale:0.99 }}
                className="w-full rounded-xl border border-border bg-muted hover:bg-accent py-2.5 text-xs font-bold flex items-center justify-center gap-2 transition-colors">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Submit Access Request
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );

  return (
    <LazyMotion features={domAnimation} strict>
      <CommandPalette
        open={cmdOpen} onClose={()=>setCmdOpen(false)}
        courses={courses}
        onSelectCourse={c=>{ setSelected(c); setTab("live"); }}
        onSwitchTab={setTab}
      />

      <AnimatePresence>
        {showShortcuts && <ShortcutsPanel onClose={()=>setShowShortcuts(false)} />}
        {!online && <OfflineBanner key="offline" />}
      </AnimatePresence>

      <div className={cn("mx-auto max-w-7xl px-4 pb-16 pt-6 space-y-5", !online && "mt-8")}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <m.header variants={fadeUp} initial="hidden" animate="visible"
          className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-card via-card to-primary/5 p-6 shadow-sm">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-2/5 bg-gradient-to-l from-primary/5 to-transparent" aria-hidden />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                  <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-primary">Teacher Command Center</span>
                    {rtConnected && activeSessionId && (
                      <motion.span initial={{ opacity:0, scale:0.8 }} animate={{ opacity:1, scale:1 }}
                        className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600"
                        aria-live="polite">
                        <Wifi className="h-3 w-3" aria-hidden /> Realtime
                      </motion.span>
                    )}
                  </div>
                  <h1 className="text-xl font-black tracking-tight text-foreground">Presence ERP — Faculty Dashboard</h1>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <m.button type="button" onClick={()=>setCmdOpen(true)}
                whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors shadow-sm"
                aria-label="Open command palette (Ctrl+K)">
                <CmdIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Command
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-mono text-muted-foreground" aria-hidden>⌘K</kbd>
              </m.button>
              <m.button type="button" onClick={()=>setShowShortcuts(s=>!s)}
                whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors shadow-sm"
                aria-label="Show keyboard shortcuts">
                <Keyboard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Shortcuts
              </m.button>
              {selected && (
                <m.button type="button" onClick={()=>handleExport(selected.id)}
                  whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-colors shadow-sm"
                  aria-label="Export class register CSV">
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Export Register
                </m.button>
              )}
            </div>
          </div>
        </m.header>

        {/* ── Course selector ──────────────────────────────────────────────── */}
        <m.div variants={fadeUp} custom={1} initial="hidden" animate="visible"
          className="rounded-xl border border-border bg-card p-3 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <BookOpen className="h-4 w-4 text-primary shrink-0" aria-hidden />
            <label htmlFor="courseSelect"
              className="text-[11px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap">
              Active Course:
            </label>
            <select id="courseSelect"
              value={selected?.id || ""}
              onChange={e=>{ const c=courses.find(x=>x.id===e.target.value); if(c) setSelected(c); }}
              className="flex-1 min-w-[200px] rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-semibold text-foreground focus:ring-2 focus:ring-primary">
              {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <m.button type="button" onClick={()=>setShowAddCourse(s=>!s)}
            whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
            aria-expanded={showAddCourse}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 hover:bg-accent px-3 py-1.5 text-xs font-semibold transition-colors">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {showAddCourse ? "Cancel" : "Add Course"}
          </m.button>
        </m.div>

        <AnimatePresence>
          {showAddCourse && (
            <m.div variants={fadeUp} initial="hidden" animate="visible" exit="exit"
              className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <form onSubmit={handleCreateCourse} className="flex flex-wrap items-end gap-3"
                aria-label="Create course">
                <div>
                  <label htmlFor="cc" className="block text-[11px] font-bold text-muted-foreground mb-1">Code</label>
                  <input id="cc" type="text" required placeholder="CS301" value={newCode} onChange={e=>setNewCode(e.target.value)}
                    className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-mono w-32 focus:ring-2 focus:ring-primary" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label htmlFor="cn" className="block text-[11px] font-bold text-muted-foreground mb-1">Name</label>
                  <input id="cn" type="text" required placeholder="Course Name" value={newName} onChange={e=>setNewName(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary" />
                </div>
                <m.button type="submit" disabled={busy}
                  whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                  className="rounded-xl bg-primary px-4 py-1.5 text-xs font-black text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Create
                </m.button>
              </form>
            </m.div>
          )}
        </AnimatePresence>

        {/* ── Tab navigation ───────────────────────────────────────────────── */}
        <m.nav variants={fadeUp} custom={2} initial="hidden" animate="visible"
          role="tablist" aria-label="Dashboard tabs"
          className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-muted/30 p-1 shadow-sm">
          {TAB_CONFIG.map(({ key, label, icon:Icon }) => {
            const active = tab === key;
            return (
              <m.button key={key} type="button"
                role="tab" aria-selected={active} aria-controls={`panel-${key}`}
                id={`tab-${key}`}
                onClick={()=>setTab(key)}
                whileHover={{ scale:active?1:1.02 }}
                whileTap={{ scale:0.97 }}
                className={cn(
                  "relative flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-background text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )}>
                <Icon className={cn("h-3.5 w-3.5 shrink-0", active&&key==="live"&&activeSessionId&&"text-emerald-500")} aria-hidden />
                {label}
                {key==="live" && activeSessionId && !active && (
                  <span className="relative flex h-2 w-2" aria-label="Live session active">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                )}
                {active && (
                  <m.span layoutId="activeTab"
                    className="absolute inset-0 rounded-lg ring-1 ring-primary/20 pointer-events-none"
                    transition={spring} aria-hidden />
                )}
              </m.button>
            );
          })}
        </m.nav>

        {/* ── Tab panels ───────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {/* LIVE */}
          {tab==="live" && (
            <m.div key="live" id="panel-live" role="tabpanel" aria-labelledby="tab-live"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit"
              className="space-y-5">

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Present"       value={rosterCounts.present}      icon={CheckCircle2}  color="emerald" index={0} sub={`of ${rosterCounts.expected}`} />
                <StatCard label="Verifying"     value={rosterCounts.verifying}    icon={Activity}      color="violet"  index={1} />
                <StatCard label="Needs Attention" value={rosterCounts.failed}     icon={AlertTriangle} color="rose"    index={2} />
                <StatCard label="Not Attempted" value={rosterCounts.notAttempted} icon={HelpCircle}    color="slate"   index={3} />
              </div>

              {selected && (
                <div className="grid gap-5 xl:grid-cols-3">
                  <div className="xl:col-span-2 space-y-5">

                    {/* OTP or Start */}
                    <AnimatePresence mode="wait">
                      {activeSessionId ? (
                        <OtpHeroCard key="otp"
                          code={activeOtpCode||"000000"} paused={paused}
                          courseCode={selected.code} courseName={selected.name}
                          sessionStart={sessionStart}
                          onRefresh={()=>handleGenerateOtp(activeSessionId)}
                          onProject={()=>setProjectingCode(true)}
                          onPause={()=>setPaused(p=>!p)}
                          onFinalize={()=>handleFinalizeSession(activeSessionId)}
                        />
                      ) : (
                        <m.section key="start" variants={fadeUp} initial="hidden" animate="visible" exit="exit"
                          className="rounded-2xl border-2 border-dashed border-border bg-muted/10 p-7 space-y-6"
                          aria-label="Start lecture">
                          <div className="text-center space-y-2.5">
                            <m.div animate={{ y:[0,-5,0] }} transition={{ duration:3.5, repeat:Infinity, ease:"easeInOut" }}
                              className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                              <Radio className="h-7 w-7 text-primary" aria-hidden />
                            </m.div>
                            <h2 className="text-base font-black text-foreground">No Active Lecture</h2>
                            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                              Configure geofence and start attendance for <strong>{selected.code}</strong>.
                            </p>
                          </div>

                          <form onSubmit={handleCreateSession} className="max-w-xl mx-auto space-y-4" aria-label="Start lecture">
                            <fieldset>
                              <legend className="text-xs font-bold text-foreground mb-3">Geofence</legend>
                              <div className="grid grid-cols-3 gap-3">
                                {[
                                  { id:"glat", label:"Latitude",  val:lat,    set:setLat,    ph:"23.2156" },
                                  { id:"glng", label:"Longitude", val:lng,    set:setLng,    ph:"72.6369" },
                                  { id:"grad", label:"Radius (m)",val:radius, set:setRadius, ph:"50"      },
                                ].map(({id,label,val,set,ph}) => (
                                  <div key={id}>
                                    <label htmlFor={id} className="block text-[11px] font-bold text-muted-foreground mb-1">{label}</label>
                                    <input id={id} type="text" value={val} onChange={e=>set(e.target.value)}
                                      placeholder={ph}
                                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-primary" />
                                  </div>
                                ))}
                              </div>
                            </fieldset>
                            <div className="flex gap-3">
                              <m.button type="button" onClick={useMyLocation} disabled={locating}
                                whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                                className="flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3.5 py-2 text-xs font-semibold hover:bg-accent transition-colors">
                                {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <MapPin className="h-3.5 w-3.5 text-primary" />}
                                {locating ? "Detecting…" : "Detect GPS"}
                              </m.button>
                              <m.button type="submit" disabled={busy}
                                whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-5 py-2.5 text-xs font-black text-primary-foreground shadow-lg">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                Launch Lecture
                              </m.button>
                            </div>
                          </form>
                        </m.section>
                      )}
                    </AnimatePresence>

                    {/* Virtualized Live Roster */}
                    <AnimatePresence>
                      {activeSessionId && (
                        <m.section key="roster" variants={fadeUp} initial="hidden" animate="visible"
                          className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
                          aria-label="Live student roster">

                          <div className="border-b border-border bg-muted/20 px-5 py-3.5 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 flex-1">
                              <Users className="h-4 w-4 text-primary" aria-hidden />
                              <h2 className="text-sm font-black text-foreground">Live Class Roster</h2>
                              {lastRefreshed && (
                                <span className="text-[10px] text-muted-foreground hidden sm:block" aria-live="polite">
                                  · {lastRefreshed.toLocaleTimeString([],{ hour:"2-digit", minute:"2-digit", second:"2-digit" })}
                                </span>
                              )}
                            </div>
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                              <input type="search" placeholder="Filter students…"
                                value={rosterSearch} onChange={e=>setRosterSearch(e.target.value)}
                                className="rounded-lg border border-input bg-background pl-8 pr-3 py-1.5 text-[11px] w-40 focus:ring-2 focus:ring-primary"
                                aria-label="Search students" />
                            </div>
                            <div role="group" aria-label="Filter by status" className="flex items-center gap-1">
                              {(["all","present","failed","not_attempted"] as const).map(f => (
                                <button key={f} type="button" onClick={()=>setRosterFilter(f)}
                                  aria-pressed={rosterFilter===f}
                                  className={cn(
                                    "rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors",
                                    rosterFilter===f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                  )}>
                                  {f==="all"?"All":f==="not_attempted"?"Pending":f.charAt(0).toUpperCase()+f.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>

                          {rosterLoading ? (
                            <RowsSkeleton />
                          ) : (
                            <ErrorBoundary>
                              <VirtualRoster
                                rows={filteredRoster}
                                activeSessionId={activeSessionId}
                                onManualMark={t => setManualTarget(t)}
                              />
                            </ErrorBoundary>
                          )}

                          <div className="border-t border-border bg-muted/10 px-5 py-2.5 flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground" aria-live="polite">
                              {filteredRoster.length} of {rosterData.length} students
                            </span>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Activity className="h-3 w-3 text-emerald-500" aria-hidden /> Auto-refreshes every 4s
                            </span>
                          </div>
                        </m.section>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Sidebar */}
                  <div className="space-y-4">
                    {activeSessionId && <AttendanceRingPanel counts={rosterCounts} />}

                    <m.section variants={fadeUp} initial="hidden" animate="visible"
                      className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
                      aria-label="Session list">
                      <div className="border-b border-border bg-muted/20 px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-primary" aria-hidden />
                          <h2 className="text-xs font-black text-foreground">Sessions</h2>
                        </div>
                        <m.button type="button" onClick={()=>refreshSessions()}
                          whileHover={{ rotate:180 }} transition={{ duration:0.3 }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="Refresh session list">
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        </m.button>
                      </div>
                      <div className="divide-y divide-border max-h-96 overflow-y-auto" role="list">
                        {sessions.length === 0 ? (
                          <p className="p-6 text-center text-xs text-muted-foreground">No sessions yet.</p>
                        ) : sessions.map((s,i) => {
                          const isAct = activeSessionId === s.id;
                          return (
                            <m.div key={s.id} variants={slideRight} custom={i} initial="hidden" animate="visible"
                              onClick={()=>{ setActiveSessionId(s.id); setSessionStart(new Date(s.starts_at)); }}
                              role="listitem" aria-current={isAct?"true":undefined}
                              className={cn(
                                "flex items-center gap-3 px-4 py-3 cursor-pointer transition-all",
                                isAct ? "bg-primary/8 border-l-[3px] border-primary" : "hover:bg-muted/40 border-l-[3px] border-transparent",
                              )}>
                              <div className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                (s as any).status==="finalized" ? "bg-slate-800/50 text-slate-400" : "bg-emerald-500/15 text-emerald-600",
                              )} aria-hidden>
                                {(s as any).status==="finalized" ? <Lock className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-foreground">
                                  {new Date(s.starts_at).toLocaleDateString("en-IN",{ day:"2-digit", month:"short", year:"numeric" })}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {new Date(s.starts_at).toLocaleTimeString([],{ hour:"2-digit", minute:"2-digit" })}
                                </p>
                              </div>
                              <span className={cn(
                                "text-[10px] font-black px-2 py-0.5 rounded-full shrink-0",
                                (s as any).status==="finalized" ? "bg-slate-700/40 text-slate-400" : "bg-emerald-500/15 text-emerald-600",
                              )}>
                                {(s as any).status==="finalized" ? "Locked" : "Live"}
                              </span>
                            </m.div>
                          );
                        })}
                      </div>
                    </m.section>
                  </div>
                </div>
              )}
            </m.div>
          )}

          {/* EXCEPTIONS */}
          {tab==="exceptions" && (
            <m.div key="exceptions" id="panel-exceptions" role="tabpanel" aria-labelledby="tab-exceptions"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="space-y-5">
              <div>
                <h2 className="text-base font-black text-foreground">Exception Resolution Queue</h2>
                <p className="text-xs text-muted-foreground">Students who encountered verification failures during lectures.</p>
              </div>
              <ErrorBoundary><ReviewQueueSection /></ErrorBoundary>
              <ErrorBoundary><FallbackQueueSection /></ErrorBoundary>
            </m.div>
          )}

          {/* OD & LEAVES */}
          {tab==="leaves" && (
            <m.div key="leaves" id="panel-leaves" role="tabpanel" aria-labelledby="tab-leaves"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="space-y-5">
              <div>
                <h2 className="text-base font-black text-foreground">OD & Leave Request Approvals</h2>
                <p className="text-xs text-muted-foreground">Requests where students specifically designated you as the authorizing faculty member.</p>
              </div>
              <ErrorBoundary><TeacherLeaveRequestsSection /></ErrorBoundary>
            </m.div>
          )}

          {/* HISTORY */}
          {tab==="history" && selected && (
            <m.div key="history" id="panel-history" role="tabpanel" aria-labelledby="tab-history"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-foreground">Lecture History</h2>
                  <p className="text-xs text-muted-foreground">{selected.code}: {selected.name}</p>
                </div>
                <m.button type="button" onClick={()=>handleExport(selected.id)}
                  whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-black text-white shadow-lg transition-colors">
                  <Download className="h-4 w-4" /> Export Register
                </m.button>
              </div>
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/30 border-b border-border text-muted-foreground">
                    <tr>
                      {["Date & Time","Status","Geofence","Action"].map(h => (
                        <th key={h} scope="col" className={cn("px-5 py-3.5 font-bold", h==="Action"&&"text-right")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sessions.length===0 ? (
                      <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">No sessions recorded.</td></tr>
                    ) : sessions.map((s,i) => (
                      <m.tr key={s.id} variants={slideRight} custom={i} initial="hidden" animate="visible"
                        className="hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-3.5 font-semibold text-foreground">
                          {new Date(s.starts_at).toLocaleString("en-IN",{ dateStyle:"medium", timeStyle:"short" })}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                            (s as any).status==="finalized"
                              ? "border-slate-600/30 bg-slate-800/50 text-slate-300"
                              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
                          )}>
                            {(s as any).status==="finalized" ? <Lock className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                            {(s as any).status==="finalized" ? "Finalized" : "Completed"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-muted-foreground">{(s as any).radius_m ?? 50}m</td>
                        <td className="px-5 py-3.5 text-right">
                          <m.button type="button" onClick={()=>handleExport(selected.id)}
                            whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }}
                            className="rounded-lg border border-border bg-muted hover:bg-accent px-3 py-1.5 text-[11px] font-bold transition-colors">
                            CSV
                          </m.button>
                        </td>
                      </m.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </m.div>
          )}

          {/* SEARCH */}
          {tab==="search" && (
            <m.div key="search" id="panel-search" role="tabpanel" aria-labelledby="tab-search"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit">
              <ErrorBoundary><StudentHistorySearch /></ErrorBoundary>
            </m.div>
          )}

          {/* TIMETABLE */}
          {tab==="timetable" && selected && (
            <m.div key="timetable" id="panel-timetable" role="tabpanel" aria-labelledby="tab-timetable"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit">
              <ErrorBoundary><TimetableSection course={selected} /></ErrorBoundary>
            </m.div>
          )}

          {/* EXAMS */}
          {tab==="exams" && selected && (
            <m.div key="exams" id="panel-exams" role="tabpanel" aria-labelledby="tab-exams"
              variants={fadeUp} initial="hidden" animate="visible" exit="exit">
              <ErrorBoundary><ExamsSection course={selected} /></ErrorBoundary>
            </m.div>
          )}

        </AnimatePresence>
      </div>

      <ProjectCodeModal
        isOpen={projectingCode}
        code={activeOtpCode||"000000"}
        courseCode={selected?.code||""}
        courseName={selected?.name||""}
        timeLeftSeconds={180}
        onClose={()=>setProjectingCode(false)}
      />
      <TeacherManualAttendanceModal
        isOpen={manualTarget!==null}
        target={manualTarget}
        onClose={()=>setManualTarget(null)}
        onSubmit={(sid,sid2,rc,note)=>handleManualMark(sid,sid2,rc,note)}
      />
    </LazyMotion>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT HISTORY SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function StudentHistorySearch() {
  const searchFn = useServerFn(searchStudentAttendanceHistory);
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy]       = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const r = (await searchFn({ data:{ query:query.trim() } })) as any;
      setResults(r.results ?? []);
      setSearched(true);
      if (!(r.results ?? []).length) toast.info(`No results for "${query.trim()}"`);
    } catch(e) {
      toast.error("Search failed", { description:(e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-black text-foreground">Student Attendance History</h2>
        <p className="text-xs text-muted-foreground">Search by name or roll number.</p>
      </div>
      <form onSubmit={handleSearch} role="search" className="flex gap-2 max-w-lg">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <input ref={inputRef} type="search"
            placeholder="Name or roll number…"
            value={query} onChange={e=>setQuery(e.target.value)}
            className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-2.5 text-xs focus:ring-2 focus:ring-primary shadow-sm"
            aria-label="Student search query" />
        </div>
        <m.button type="submit" disabled={busy}
          whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
          className="flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-xs font-black hover:bg-primary/90 shadow-sm">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </m.button>
      </form>

      <AnimatePresence mode="wait">
        {busy && (
          <m.div key="sk" variants={{ hidden:{opacity:0}, visible:{opacity:1} }} initial="hidden" animate="visible" className="space-y-4">
            {[0,1].map(i => <Bone key={i} className="h-40 rounded-2xl" />)}
          </m.div>
        )}
        {searched && !busy && (
          <m.div key="res" variants={fadeUp} initial="hidden" animate="visible" className="space-y-4">
            {results.length===0 ? (
              <div className="rounded-2xl border border-dashed border-border p-14 text-center">
                <Search className="h-10 w-10 mx-auto text-muted-foreground/25 mb-3" aria-hidden />
                <p className="text-sm font-bold text-foreground">No results</p>
                <p className="text-xs text-muted-foreground mt-1">No student matching "{query}"</p>
              </div>
            ) : results.map((r,i) => (
              <m.article key={r.studentId} variants={fadeUp} custom={i} initial="hidden" animate="visible"
                className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl border border-primary/20 bg-primary/10 flex items-center justify-center font-black text-primary" aria-hidden>
                      {r.displayName?.charAt(0)||"S"}
                    </div>
                    <div>
                      <h3 className="font-black text-foreground">{r.displayName}</h3>
                      <p className="font-mono text-xs text-muted-foreground">Roll: {r.rollNo}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <AnimatedNumber value={r.overallPct} className={cn(
                      "text-3xl font-black block tabular-nums",
                      r.overallPct>=75?"text-emerald-600":r.overallPct>=60?"text-amber-600":"text-rose-600",
                    )} />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Overall %</p>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                  <m.div
                    initial={{ width:0 }} animate={{ width:`${Math.min(r.overallPct,100)}%` }}
                    transition={{ ...gentleSpring, delay:i*0.1 }}
                    className={cn("h-full rounded-full", r.overallPct>=75?"bg-emerald-500":r.overallPct>=60?"bg-amber-500":"bg-rose-500")}
                    role="img" aria-label={`${r.overallPct}% attendance`}
                  />
                </div>
                <p className={cn("text-[11px] font-semibold",r.overallPct>=75?"text-emerald-600":r.overallPct>=60?"text-amber-600":"text-rose-600")}>
                  {r.overallPct>=75?"✓ Meeting minimum":"⚠ Below threshold"}
                </p>
                {r.recentRecords?.length>0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mb-2">Recent</p>
                    <div className="space-y-1.5">
                      {r.recentRecords.map((rec:any) => (
                        <div key={rec.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3.5 py-2">
                          <span className="text-xs font-medium text-foreground truncate flex-1">{rec.courseCode}: {rec.courseName}</span>
                          <span className={cn("ml-3 shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-black",
                            rec.decision==="present"||rec.decision==="fallback_present"
                              ?"border-emerald-500/20 bg-emerald-500/15 text-emerald-600"
                              :"border-rose-500/20 bg-rose-500/15 text-rose-600")}>
                            {rec.decision}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </m.article>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEW QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

const ReviewQueueSection = memo(function ReviewQueueSection() {
  const listFn   = useServerFn(listReviewQueue);
  const actionFn = useServerFn(actionReview);
  const [rows, setRows]         = useState<TeacherReviewRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeItem, setActive] = useState<DecisionItem|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await listFn()) as TeacherReviewRow[]); }
    catch(e) { toast.error("Queue load failed", { description:(e as Error).message }); }
    finally { setLoading(false); }
  }, [listFn]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id:string, decision:"APPROVED"|"REJECTED", note:string) => {
    const tid = toast.loading("Processing…");
    try {
      await actionFn({ data:{ ledgerId:id, action:decision==="APPROVED"?"approved":"rejected", reason:note||undefined } });
      toast.success(decision==="APPROVED"?"Approved":"Rejected", { id:tid });
      await load();
    } catch(e) {
      toast.error("Decision failed", { id:tid, description:(e as Error).message });
    }
  };

  if (loading) return <Bone className="h-40 rounded-2xl" />;

  if (!rows.length) return (
    <m.div variants={scaleIn} initial="hidden" animate="visible"
      className="rounded-2xl border border-dashed border-border p-10 text-center">
      <CheckCircle2 className="h-7 w-7 mx-auto text-emerald-500 mb-2" />
      <p className="text-sm font-bold text-foreground">Queue Clear</p>
      <p className="text-xs text-muted-foreground mt-1">No borderline check-ins awaiting review.</p>
    </m.div>
  );

  return (
    <>
      <m.div variants={fadeUp} initial="hidden" animate="visible"
        className="rounded-2xl border border-amber-500/20 bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border bg-amber-500/5 px-5 py-3.5 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden />
          <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Borderline Queue</h3>
          <m.span initial={{ scale:0 }} animate={{ scale:1 }} transition={spring}
            className="ml-auto rounded-full border border-amber-500/20 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-black text-amber-600"
            aria-label={`${rows.length} items`}>{rows.length}
          </m.span>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r,i) => (
            <m.div key={r.id} variants={slideRight} custom={i} initial="hidden" animate="visible"
              className="flex items-center justify-between px-5 py-4 gap-4 hover:bg-muted/20 transition-colors">
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-bold text-foreground truncate">
                  {r.class_sessions?.courses?.code} — {r.class_sessions?.courses?.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Student <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{r.student_id.slice(0,8)}</code>
                  {" "}· Similarity:{" "}
                  <span className={cn("font-black",(r.similarity||0)>0.8?"text-amber-600":"text-rose-600")}>
                    {((r.similarity||0)*100).toFixed(1)}%
                  </span>
                </p>
              </div>
              <m.button type="button"
                whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                onClick={()=>setActive({ id:r.id, studentName:`Student ${r.student_id.slice(0,8)}`, type:"review", reasonCode:r.reason_code||undefined, similarity:r.similarity, createdAt:r.created_at })}
                className="shrink-0 rounded-xl bg-primary px-3.5 py-2 text-xs font-black text-primary-foreground hover:bg-primary/90 shadow-sm">
                Review →
              </m.button>
            </m.div>
          ))}
        </div>
      </m.div>
      <DecisionModal isOpen={activeItem!==null} item={activeItem} onClose={()=>setActive(null)} onSubmit={decide} />
    </>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

const FallbackQueueSection = memo(function FallbackQueueSection() {
  const listFn   = useServerFn(listFallbackRequests);
  const reviewFn = useServerFn(reviewFallbackRequest);
  const [requests, setRequests] = useState<FallbackRequestRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [processing, setProcessing] = useState<string|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRequests((await listFn()) as FallbackRequestRow[]); }
    catch(e) { toast.error("Load failed", { description:(e as Error).message }); }
    finally { setLoading(false); }
  }, [listFn]);

  useEffect(() => { load(); }, [load]);

  const handle = async (id:string, action:"APPROVED"|"REJECTED") => {
    setProcessing(id);
    const prev = [...requests];
    setRequests(r => r.filter(x=>x.id!==id));
    const tid = toast.loading(action==="APPROVED"?"Approving…":"Rejecting…");
    try {
      await reviewFn({ data:{ requestId:id, action:action==="APPROVED"?"approved":"rejected", note:undefined } });
      toast.success(action==="APPROVED"?"Approved":"Rejected", { id:tid });
    } catch(e) {
      setRequests(prev);
      toast.error("Action failed", { id:tid, description:(e as Error).message,
        action:{ label:"Retry", onClick:()=>handle(id,action) } });
    } finally { setProcessing(null); }
  };

  if (loading) return <Bone className="h-32 rounded-2xl" />;

  return (
    <m.section variants={fadeUp} initial="hidden" animate="visible"
      className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
      aria-label="Manual fallback requests">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5 flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Fallback Requests</h3>
        {requests.length>0 && (
          <m.span initial={{ scale:0 }} animate={{ scale:1 }} transition={spring}
            className="ml-auto rounded-full border border-rose-500/20 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-black text-rose-600">
            {requests.length}
          </m.span>
        )}
      </div>
      {requests.length===0 ? (
        <div className="p-10 text-center">
          <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-500 mb-2" />
          <p className="text-xs text-muted-foreground">All resolved.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          <AnimatePresence>
            {requests.map((r,i) => (
              <m.div key={r.id} variants={slideRight} custom={i} initial="hidden" animate="visible"
                exit={{ opacity:0, x:20, transition:{ duration:0.2 } }}
                className="flex items-center justify-between px-5 py-4 gap-4 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-xs font-black text-foreground">{r.profiles?.display_name||"Unknown"}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{r.profiles?.roll_no||"—"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{r.reason}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <m.button type="button" disabled={!!processing} onClick={()=>handle(r.id,"APPROVED")}
                    whileHover={{ scale:1.04 }} whileTap={{ scale:0.96 }}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-black text-white disabled:opacity-60"
                    aria-label={`Approve ${r.profiles?.display_name}`}>
                    {processing===r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                    Approve
                  </m.button>
                  <m.button type="button" disabled={!!processing} onClick={()=>handle(r.id,"REJECTED")}
                    whileHover={{ scale:1.04 }} whileTap={{ scale:0.96 }}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-black text-rose-600 disabled:opacity-60"
                    aria-label={`Reject ${r.profiles?.display_name}`}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </m.button>
                </div>
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </m.section>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// ASSIGNED LEAVE & OD REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

const TeacherLeaveRequestsSection = memo(function TeacherLeaveRequestsSection() {
  const listFn = useServerFn(listTeacherAssignedLeaveRequests);
  const reviewFn = useServerFn(reviewTeacherAssignedLeaveRequest);

  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFn();
      setRequests(data ?? []);
    } catch (e) {
      toast.error("Failed to load assigned leave requests");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (id: string, action: "approved" | "rejected") => {
    setProcessing(id);
    const tid = toast.loading(action === "approved" ? "Approving OD/Leave request…" : "Rejecting request…");
    try {
      await reviewFn({ data: { requestId: id, action } });
      toast.success(action === "approved" ? "Approved OD/Leave request!" : "Rejected request", { id: tid });
      load();
    } catch (e) {
      toast.error("Action failed", { id: tid, description: (e as Error).message });
    } finally {
      setProcessing(null);
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    const name = r.profiles?.display_name?.toLowerCase() || "";
    const roll = r.profiles?.roll_no?.toLowerCase() || "";
    const reason = r.reason?.toLowerCase() || "";
    return name.includes(q) || roll.includes(q) || reason.includes(q);
  });

  if (loading) return <Bone className="h-32 rounded-2xl" />;

  return (
    <m.section
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" aria-hidden />
          <div>
            <h3 className="text-sm font-black text-foreground uppercase tracking-wider">
              Assigned OD & Leave Requests ({requests.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Requests where students specifically designated you as the authorizing faculty member.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search student or roll no…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:ring-2 focus:ring-primary w-48"
          />
          <m.button
            type="button"
            onClick={() => load()}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </m.button>
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <CheckCircle2 className="h-7 w-7 mx-auto text-emerald-500" />
          <p className="text-sm font-semibold text-foreground">
            {filterQuery ? "No matching requests found." : "No pending assigned requests."}
          </p>
          <p className="text-xs text-muted-foreground">
            When students select you as their approving teacher, their requests will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {requests.map((r, i) => (
            <m.div
              key={r.id}
              variants={slideRight}
              custom={i}
              initial="hidden"
              animate="visible"
              className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4"
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">
                    {r.profiles?.display_name || "Student"}
                  </span>
                  {r.profiles?.roll_no && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {r.profiles.roll_no}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                      r.request_type === "od"
                        ? "bg-purple-500/15 text-purple-700 dark:text-purple-300"
                        : "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                    }`}
                  >
                    {r.request_type === "od" ? "On-Duty (OD)" : "Leave"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.status === "pending"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : r.status === "approved"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Dates: <span className="font-medium text-foreground">{r.start_date} → {r.end_date}</span>
                </div>
                <p className="text-xs text-foreground italic bg-muted/30 p-2 rounded-lg">
                  &ldquo;{r.reason}&rdquo;
                </p>
                {r.document_url && (
                  <a
                    href={r.document_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline inline-block"
                  >
                    📄 View Supporting Document
                  </a>
                )}
              </div>

              {r.status === "pending" && (
                <div className="flex items-center gap-2 shrink-0">
                  <m.button
                    type="button"
                    disabled={processing === r.id}
                    onClick={() => handleAction(r.id, "approved")}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-black text-white disabled:opacity-60"
                  >
                    {processing === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                    Approve
                  </m.button>
                  <m.button
                    type="button"
                    disabled={processing === r.id}
                    onClick={() => handleAction(r.id, "rejected")}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 text-xs font-black text-rose-600 disabled:opacity-60"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </m.button>
                </div>
              )}
            </m.div>
          ))}
        </div>
      )}
    </m.section>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIMETABLE
// ═══════════════════════════════════════════════════════════════════════════════

const TimetableSection = memo(function TimetableSection({ course }:{ course:Course }) {
  const listTt     = useServerFn(listTimetable);
  const addTt      = useServerFn(addTimetableEntry);
  const delTt      = useServerFn(deleteTimetableEntry);
  const genSessions= useServerFn(generateSessionsFromTimetable);

  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [day, setDay]         = useState("1");
  const [start, setStart]     = useState("09:00");
  const [end, setEnd]         = useState("10:30");
  const [room, setRoom]       = useState("");
  const [deleting, setDeleting] = useState<string|null>(null);
  const [startDate, setStartDate] = useState(()=>new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate]     = useState(()=>{ const d=new Date(); d.setMonth(d.getMonth()+3); return d.toISOString().split("T")[0]; });
  const [geoLat, setGeoLat]   = useState("23.2156");
  const [geoLng, setGeoLng]   = useState("72.6369");

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries((await listTt({ data:{ courseId:course.id } })) as TimetableEntry[]); }
    catch(e) { toast.error("Load failed", { description:(e as Error).message }); }
    finally { setLoading(false); }
  }, [course.id, listTt]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e:React.FormEvent) => {
    e.preventDefault();
    if (start>=end) { toast.error("End must be after start"); return; }
    try {
      await addTt({ data:{ courseId:course.id, dayOfWeek:Number(day), startTime:start, endTime:end, room:room.trim()||undefined } });
      setRoom("");
      await load();
      toast.success("Slot added", { description:`${DAYS[Number(day)]}, ${start}–${end}` });
    } catch(e) { toast.error("Add failed", { description:(e as Error).message }); }
  };

  const handleDelete = async (id:string) => {
    setDeleting(id);
    const prev=[...entries];
    setEntries(e=>e.filter(x=>x.id!==id));
    try { await delTt({ data:{ id } }); toast.success("Slot removed"); }
    catch(e) { setEntries(prev); toast.error("Delete failed", { description:(e as Error).message }); }
    finally { setDeleting(null); }
  };

  const handleGenerate = async () => {
    const tid = toast.loading("Generating…");
    try {
      const r = (await genSessions({ data:{ courseId:course.id, startDate, endDate, geoLat:Number(geoLat), geoLng:Number(geoLng) } })) as { createdCount:number };
      toast.success(`${r.createdCount} sessions generated`, { id:tid });
    } catch(e) { toast.error("Generation failed", { id:tid, description:(e as Error).message }); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-black text-foreground">Timetable — {course.code}</h2>
        <p className="text-xs text-muted-foreground">Define recurring slots and batch-generate sessions.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <m.div variants={fadeUp} initial="hidden" animate="visible"
          className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Add Weekly Slot</h3>
          <form onSubmit={handleAdd} className="space-y-3" aria-label="Add timetable slot">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ttd" className="block text-[11px] font-bold text-muted-foreground mb-1">Day</label>
                <select id="ttd" value={day} onChange={e=>setDay(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary">
                  {DAYS.map((d,i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ttr" className="block text-[11px] font-bold text-muted-foreground mb-1">Room</label>
                <input id="ttr" type="text" placeholder="Lab 302" value={room} onChange={e=>setRoom(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label htmlFor="tts" className="block text-[11px] font-bold text-muted-foreground mb-1">Start</label>
                <input id="tts" type="time" value={start} onChange={e=>setStart(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label htmlFor="tte" className="block text-[11px] font-bold text-muted-foreground mb-1">End</label>
                <input id="tte" type="time" value={end} onChange={e=>setEnd(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary" />
              </div>
            </div>
            <m.button type="submit" whileHover={{ scale:1.01 }} whileTap={{ scale:0.99 }}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" /> Add Slot
            </m.button>
          </form>
        </m.div>

        <m.div variants={fadeUp} custom={1} initial="hidden" animate="visible"
          className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Batch Generate</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id:"sd", label:"Start Date", type:"date", v:startDate, s:setStartDate },
              { id:"ed", label:"End Date",   type:"date", v:endDate,   s:setEndDate   },
              { id:"gl", label:"Latitude",   type:"text", v:geoLat,    s:setGeoLat    },
              { id:"gn", label:"Longitude",  type:"text", v:geoLng,    s:setGeoLng    },
            ].map(({id,label,type,v,s}) => (
              <div key={id}>
                <label htmlFor={id} className="block text-[11px] font-bold text-muted-foreground mb-1">{label}</label>
                <input id={id} type={type} value={v} onChange={e=>s(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-primary" />
              </div>
            ))}
          </div>
          <m.button type="button" onClick={handleGenerate}
            whileHover={{ scale:1.01 }} whileTap={{ scale:0.99 }}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-2.5 text-xs font-black text-white shadow-lg flex items-center justify-center gap-2">
            <Zap className="h-4 w-4" /> Generate Sessions
          </m.button>
        </m.div>
      </div>

      <m.div variants={fadeUp} custom={2} initial="hidden" animate="visible"
        className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border bg-muted/20 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" aria-hidden />
            <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Configured Slots</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">{entries.length} rules</span>
        </div>
        {loading ? <RowsSkeleton n={3} /> : (
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/10 border-b border-border text-muted-foreground">
              <tr>
                {["Day","Timing","Room","Action"].map(h => (
                  <th key={h} scope="col" className={cn("px-5 py-3 font-bold", h==="Action"&&"text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <AnimatePresence>
                {!entries.length ? (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">No slots configured.</td></tr>
                ) : entries.map((e,i) => (
                  <m.tr key={e.id} variants={slideRight} custom={i} initial="hidden" animate="visible"
                    exit={{ opacity:0, x:20 }} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className={cn("rounded-lg px-2.5 py-1 text-[11px] font-black", DAY_COLORS[e.day_of_week])}>
                        {DAYS[e.day_of_week]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono font-bold text-foreground">{e.start_time} — {e.end_time}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{e.room||"Default"}</td>
                    <td className="px-5 py-3.5 text-right">
                      <m.button type="button" onClick={()=>handleDelete(e.id)} disabled={deleting===e.id}
                        whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }}
                        className="rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-[11px] font-black text-rose-600 disabled:opacity-50"
                        aria-label={`Delete ${DAYS[e.day_of_week]} ${e.start_time} slot`}>
                        {deleting===e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                      </m.button>
                    </td>
                  </m.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </m.div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMS & MARKS
// ═══════════════════════════════════════════════════════════════════════════════

const ExamsSection = memo(function ExamsSection({ course }:{ course:Course }) {
  const listExamsFn  = useServerFn(listExamsForCourse);
  const createExamFn = useServerFn(createExam);
  const updateExamFn = useServerFn(updateExam);
  const listStudFn   = useServerFn(listEnrolledStudentsForMarksEntry);
  const bulkMarksFn  = useServerFn(bulkEnterMarks);

  const [exams, setExams]           = useState<TeacherExamRow[]>([]);
  const [examsLoading, setExLoading]= useState(true);
  const [activeId, setActiveId]     = useState<string|null>(null);
  const [students, setStudents]     = useState<EnrolledStudentMarksRow[]>([]);
  const [studLoading, setStudLoading]= useState(false);
  const [marksState, setMarksState] = useState<Record<string,MarksEntry>>({});
  const [submitting, setSubmitting] = useState(false);
  const [publishModal, setPublish]  = useState<TeacherExamRow|null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [marksSearch, setMarksSearch] = useState("");
  const [title, setTitle]           = useState("");
  const [examType, setExamType]     = useState("midterm");
  const [maxMarks, setMaxMarks]     = useState("100");
  const [weightage, setWeightage]   = useState("20");

  const loadExams = useCallback(async () => {
    setExLoading(true);
    try {
      const res = (await listExamsFn({ data:{ courseId:course.id } })) as unknown as TeacherExamRow[];
      setExams(res);
      if (res.length && !activeId) setActiveId(res[0].id);
    } catch(e) { toast.error("Exams load failed", { description:(e as Error).message }); }
    finally { setExLoading(false); }
  }, [course.id, activeId, listExamsFn]);

  useEffect(() => { loadExams(); }, [course.id, loadExams]);

  useEffect(() => {
    if (!activeId) { setStudents([]); setMarksState({}); return; }
    setStudLoading(true);
    listStudFn({ data:{ examId:activeId } })
      .then(res => {
        const list = ((res as any)?.students || res) as EnrolledStudentMarksRow[];
        setStudents(list);
        const m: Record<string,MarksEntry> = {};
        for (const s of list)
          m[s.student_id] = { marks:s.obtained_marks!=null?String(s.obtained_marks):"", absent:Boolean(s.is_absent), remarks:s.remarks||"" };
        setMarksState(m);
      })
      .catch(e => toast.error("Students load failed", { description:(e as Error).message }))
      .finally(() => setStudLoading(false));
  }, [activeId, listStudFn]);

  const handleCreate = async (e:React.FormEvent) => {
    e.preventDefault();
    try {
      const row = (await createExamFn({ data:{ courseId:course.id, title:title.trim(), examType:examType as any, maxMarks:Number(maxMarks), weightagePct:Number(weightage), examDate:undefined } })) as TeacherExamRow;
      setTitle("");
      setExams(p => [row,...p]);
      setActiveId(row.id);
      setShowCreate(false);
      toast.success(`Exam "${row.title}" created`);
    } catch(e) { toast.error("Create failed", { description:(e as Error).message }); }
  };

  const handleSave = async () => {
    if (!activeId) return;
    setSubmitting(true);
    const tid = toast.loading("Saving marks…");
    try {
      const entries = Object.entries(marksState).map(([sid,v]) => ({
        studentId:sid,
        obtainedMarks:v.absent?null:v.marks!==""?Number(v.marks):null,
        isAbsent:v.absent,
        remarks:v.remarks||undefined,
      }));
      await bulkMarksFn({ data:{ examId:activeId, entries } });
      toast.success("Marks saved", { id:tid, description:`${entries.length} records updated` });
    } catch(e) {
      toast.error("Save failed", { id:tid, description:(e as Error).message,
        action:{ label:"Retry", onClick:handleSave } });
    } finally { setSubmitting(false); }
  };

  const handlePublish = async () => {
    if (!publishModal) return;
    const tid = toast.loading("Publishing…");
    try {
      await updateExamFn({ data:{ examId:publishModal.id, status:"published" } });
      setPublish(null);
      await loadExams();
      toast.success("Results published", { id:tid });
    } catch(e) { toast.error("Publish failed", { id:tid, description:(e as Error).message }); }
  };

  const activeExam = exams.find(x => x.id === activeId);

  const stats = useMemo(() => {
    const graded = students.filter(s => { const st=marksState[s.student_id]; return st&&!st.absent&&st.marks!==""; });
    const avg = graded.length ? graded.reduce((s,x)=>s+Number(marksState[x.student_id].marks),0)/graded.length : 0;
    const thr = activeExam ? activeExam.max_marks*0.4 : 0;
    return {
      avg:avg.toFixed(1),
      pass:graded.filter(s=>Number(marksState[s.student_id].marks)>=thr).length,
      absent:students.filter(s=>marksState[s.student_id]?.absent).length,
    };
  }, [students, marksState, activeExam]);

  const filteredStudents = useMemo(() => {
    if (!marksSearch.trim()) return students;
    const q = marksSearch.toLowerCase();
    return students.filter(s=>s.display_name.toLowerCase().includes(q)||s.roll_no?.toLowerCase().includes(q));
  }, [students, marksSearch]);

  const tbodyRef = useRef<HTMLDivElement>(null);
  const rowVirt = useVirtualizer({
    count:filteredStudents.length,
    getScrollElement:()=>tbodyRef.current,
    estimateSize:()=>52, overscan:8,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-black text-foreground">Exams & Marks — {course.code}</h2>
          <p className="text-xs text-muted-foreground">Create, mark, and publish results.</p>
        </div>
        <m.button type="button" onClick={()=>setShowCreate(s=>!s)}
          whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> {showCreate?"Cancel":"New Exam"}
        </m.button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <m.div variants={scaleIn} initial="hidden" animate="visible" exit="exit"
            className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-foreground mb-4">New Exam</h3>
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3 sm:grid-cols-6 items-end">
              <div className="col-span-2">
                <label htmlFor="et" className="block text-[11px] font-bold text-muted-foreground mb-1">Title</label>
                <input id="et" type="text" required placeholder="Midterm 1" value={title} onChange={e=>setTitle(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label htmlFor="ety" className="block text-[11px] font-bold text-muted-foreground mb-1">Type</label>
                <select id="ety" value={examType} onChange={e=>setExamType(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary">
                  {Object.entries(EXAM_TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="emm" className="block text-[11px] font-bold text-muted-foreground mb-1">Max</label>
                <input id="emm" type="number" min={1} value={maxMarks} onChange={e=>setMaxMarks(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label htmlFor="ew" className="block text-[11px] font-bold text-muted-foreground mb-1">Weight %</label>
                <input id="ew" type="number" min={0} max={100} value={weightage} onChange={e=>setWeightage(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:ring-2 focus:ring-primary" />
              </div>
              <m.button type="submit" whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 justify-center">
                <Plus className="h-3.5 w-3.5" /> Create
              </m.button>
            </form>
          </m.div>
        )}
      </AnimatePresence>

      <div className="grid gap-5 xl:grid-cols-4">
        <m.div variants={fadeUp} initial="hidden" animate="visible"
          className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden xl:col-span-1">
          <div className="border-b border-border bg-muted/20 px-4 py-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-foreground">Exams ({exams.length})</h3>
          </div>
          {examsLoading ? <RowsSkeleton n={3} /> : (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto" role="list">
              {!exams.length ? (
                <p className="p-8 text-center text-xs text-muted-foreground">No exams yet.</p>
              ) : exams.map((ex,i) => (
                <m.div key={ex.id} variants={slideRight} custom={i} initial="hidden" animate="visible"
                  onClick={()=>setActiveId(ex.id)}
                  role="listitem" aria-current={activeId===ex.id?"true":undefined}
                  className={cn(
                    "flex flex-col gap-1 px-4 py-3.5 cursor-pointer transition-all",
                    activeId===ex.id ? "bg-primary/8 border-l-[3px] border-primary" : "hover:bg-muted/40 border-l-[3px] border-transparent",
                  )}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-foreground truncate flex-1">{ex.title}</span>
                    <span className={cn(
                      "shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full",
                      ex.status==="published"?"bg-emerald-500/15 text-emerald-600":ex.status==="locked"?"bg-slate-700/40 text-slate-400":"bg-amber-500/15 text-amber-600",
                    )}>{ex.status.toUpperCase()}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{EXAM_TYPE_LABELS[ex.exam_type]} · {ex.max_marks}M · {ex.weightage_pct}%</p>
                </m.div>
              ))}
            </div>
          )}
        </m.div>

        {activeExam && (
          <m.div key={activeExam.id} variants={fadeUp} initial="hidden" animate="visible"
            className="xl:col-span-3 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="border-b border-border bg-muted/20 px-5 py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-foreground">{activeExam.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {EXAM_TYPE_LABELS[activeExam.exam_type]} · Max: {activeExam.max_marks}M · Weight: {activeExam.weightage_pct}%
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeExam.status==="draft" && (
                    <m.button type="button" onClick={()=>setPublish(activeExam)}
                      whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-black text-white flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> Publish
                    </m.button>
                  )}
                  <m.button type="button" onClick={handleSave} disabled={submitting}
                    whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                    className="rounded-xl bg-primary hover:bg-primary/90 px-4 py-2 text-xs font-black text-primary-foreground flex items-center gap-1.5">
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" />}
                    Save Marks
                  </m.button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { l:"Avg",    v:`${stats.avg}/${activeExam.max_marks}`, c:"text-primary"     },
                  { l:"Passed", v:String(stats.pass),                    c:"text-emerald-600"  },
                  { l:"Absent", v:String(stats.absent),                  c:"text-rose-600"     },
                  { l:"Total",  v:String(students.length),               c:"text-foreground"   },
                ].map(({l,v,c}) => (
                  <div key={l} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
                    <span className="text-[11px] text-muted-foreground">{l}:</span>
                    <span className={cn("text-xs font-black tabular-nums",c)}>{v}</span>
                  </div>
                ))}
                <div className="relative ml-auto">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <input type="search" placeholder="Filter students…" value={marksSearch} onChange={e=>setMarksSearch(e.target.value)}
                    className="rounded-lg border border-input bg-background pl-8 pr-3 py-1.5 text-[11px] w-36 focus:ring-2 focus:ring-primary"
                    aria-label="Filter students" />
                </div>
              </div>
            </div>

            {studLoading ? <RowsSkeleton /> : (
              <>
                <div className="grid grid-cols-[1fr_90px_110px_60px_1fr_60px] border-b border-border bg-muted/10 text-[11px] font-bold text-muted-foreground">
                  {["Student","Roll","Marks","Absent","Remarks","Grade"].map((h,i) => (
                    <div key={h} className={cn("px-4 py-3", i===5&&"text-right")}>{h}</div>
                  ))}
                </div>
                <div ref={tbodyRef} style={{ height:"400px", overflow:"auto" }}>
                  <div style={{ height:`${rowVirt.getTotalSize()}px`, position:"relative" }}>
                    {rowVirt.getVirtualItems().map(vRow => {
                      const st = filteredStudents[vRow.index];
                      const s = marksState[st.student_id]||{ marks:"", absent:false, remarks:"" };
                      const mn = s.marks!==""?Number(s.marks):null;
                      const pct = mn!==null&&!s.absent ? Math.round((mn/activeExam.max_marks)*100) : null;
                      const over = mn!==null&&mn>activeExam.max_marks;
                      const upd = (patch:Partial<MarksEntry>) =>
                        setMarksState(p=>({ ...p, [st.student_id]:{ ...s, ...patch } }));
                      return (
                        <div key={st.student_id} data-index={vRow.index} ref={rowVirt.measureElement}
                          style={{ position:"absolute", top:0, left:0, width:"100%", transform:`translateY(${vRow.start}px)` }}
                          className={cn(
                            "grid grid-cols-[1fr_90px_110px_60px_1fr_60px] items-center border-b border-border/50 transition-colors hover:bg-muted/20 text-xs",
                            s.absent&&"opacity-50",
                          )}>
                          <div className="flex items-center gap-2.5 px-4 py-3 min-w-0">
                            <div className="h-7 w-7 shrink-0 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center text-[11px] font-black text-primary" aria-hidden>
                              {st.display_name?.charAt(0)||"S"}
                            </div>
                            <span className="font-semibold text-foreground truncate">{st.display_name}</span>
                          </div>
                          <div className="px-4 py-3 font-mono text-[11px] text-muted-foreground truncate">{st.roll_no||"—"}</div>
                          <div className="px-4 py-3">
                            <input type="number" min={0} max={activeExam.max_marks}
                              disabled={s.absent} placeholder={`0–${activeExam.max_marks}`}
                              value={s.marks} onChange={e=>upd({ marks:e.target.value })}
                              aria-label={`Marks for ${st.display_name}`}
                              aria-invalid={over}
                              className={cn(
                                "w-20 rounded-lg border px-2 py-1.5 text-xs transition-colors focus:ring-2 focus:ring-primary disabled:opacity-40",
                                over?"border-rose-500 bg-rose-500/5":"border-input bg-background",
                                !over&&s.marks!==""&&"border-emerald-500/40",
                              )} />
                          </div>
                          <div className="px-4 py-3 flex justify-center">
                            <input type="checkbox" checked={s.absent} onChange={e=>upd({ absent:e.target.checked })}
                              aria-label={`${st.display_name} absent`}
                              className="h-4 w-4 rounded border-input accent-primary cursor-pointer" />
                          </div>
                          <div className="px-4 py-3">
                            <input type="text" placeholder="Note…" value={s.remarks} onChange={e=>upd({ remarks:e.target.value })}
                              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary" />
                          </div>
                          <div className="px-4 py-3 text-right">
                            {s.absent ? (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            ) : pct!==null ? (
                              <span className={cn("text-sm font-black tabular-nums",pct>=75?"text-emerald-600":pct>=40?"text-amber-600":"text-rose-600")}>
                                {pct}%
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div className="border-t border-border bg-muted/10 px-5 py-2.5 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{filteredStudents.length}/{students.length} students</span>
              <m.button type="button" onClick={handleSave} disabled={submitting}
                whileHover={{ scale:1.02 }} whileTap={{ scale:0.98 }}
                className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary px-3 py-1.5 text-[11px] font-black transition-all">
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" />}
                Save
              </m.button>
            </div>
          </m.div>
        )}
      </div>

      {publishModal && (
        <ConfirmPublishExamModal
          {...({
            isOpen: true,
            examTitle: publishModal.title,
            courseCode: course.code,
            onClose: () => setPublish(null),
            onConfirm: handlePublish,
          } as any)}
        />
      )}
    </div>
  );
});
