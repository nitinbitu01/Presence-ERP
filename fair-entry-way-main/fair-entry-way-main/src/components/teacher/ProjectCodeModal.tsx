import React, { useEffect } from "react";
import { X, Copy, Check } from "lucide-react";

interface ProjectCodeModalProps {
  isOpen: boolean;
  code: string;
  courseCode: string;
  courseName: string;
  timeLeftSeconds: number;
  onClose: () => void;
}

export function ProjectCodeModal({
  isOpen,
  code,
  courseCode,
  courseName,
  timeLeftSeconds,
  onClose,
}: ProjectCodeModalProps) {
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl text-center space-y-8">
        <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2 text-left">
            <span className="font-mono text-xs px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-400 font-bold border border-indigo-500/30">
              {courseCode}
            </span>
            <span className="font-semibold text-sm text-slate-200">{courseName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Exit Fullscreen (Esc)"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold tracking-wider uppercase text-indigo-400">
            Live Lecture Attendance Code
          </p>
          <div className="inline-block bg-slate-900 border-2 border-indigo-500/50 rounded-3xl px-12 py-8 shadow-2xl shadow-indigo-500/20">
            <span className="font-mono text-7xl sm:text-8xl font-extrabold tracking-widest text-white drop-shadow-md">
              {code}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Students should enter this code in their attendance screen to verify.
          </p>
        </div>

        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2 font-mono text-slate-300 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
            <span>Expires in:</span>
            <span
              className={`font-bold text-base ${timeLeftSeconds > 60 ? "text-emerald-400" : "text-amber-400"}`}
            >
              {formatTime(timeLeftSeconds)}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2 rounded-xl transition-all shadow-lg shadow-indigo-600/30 active:scale-95 text-xs"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied to Clipboard" : "Copy Code"}
          </button>
        </div>
      </div>
    </div>
  );
}
