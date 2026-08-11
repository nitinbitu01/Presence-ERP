import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Shield,
  Fingerprint,
  Lock,
  UserCheck,
  MapPin,
  Key,
  Smartphone,
  Activity,
  Award,
  FileCheck,
  Building2,
  CheckCircle2,
  Layers,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Landing,
});

function Landing() {
  const [timeStr, setTimeStr] = useState("");
  const [seqIndex, setSeqIndex] = useState(1);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const h = now.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
      });
      setTimeStr(h + " IST");
    };
    tick();
    const timer = setInterval(tick, 10000);
    return () => clearInterval(timer);
  }, []);

  const sequence = [
    { active: 0, pct: "25%", score: 65, fill: "25%" },
    { active: 1, pct: "50%", score: 78, fill: "50%" },
    { active: 2, pct: "75%", score: 88, fill: "75%" },
    { active: 3, pct: "100%", score: 91, fill: "100%" },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setSeqIndex((prev) => (prev + 1) % sequence.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const revealEls = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - 60;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const currentSeq = sequence[seqIndex];

  return (
    <div className="min-h-screen bg-[#FAFBFC] text-[#172B4D] font-sans antialiased selection:bg-[#0052CC]/20 flex flex-col">
      <style>{`
        html { scroll-behavior: smooth; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
        .reveal.visible { opacity: 1; transform: translateY(0); }
        .reveal-delay-1 { transition-delay: 0.1s; }
        .reveal-delay-2 { transition-delay: 0.2s; }
        .reveal-delay-3 { transition-delay: 0.3s; }
      `}</style>

      <nav className="bg-[#091E42] h-[52px] flex items-center justify-between px-3.5 sm:px-7 sticky top-0 z-[1000] border-b border-white/5 shadow-sm">
        <Link to="/" className="flex items-center gap-2.5 mr-2 sm:mr-9 flex-shrink-0 group">
          <img src="/logo.png" alt="Presence ERP Logo" className="w-[32px] h-[32px] object-contain rounded-lg bg-white p-0.5 shadow-sm transition-transform group-hover:scale-105" />
          <div className="flex flex-col">
            <span className="text-[12px] sm:text-[13px] font-bold text-white leading-none tracking-tight">Presence ERP</span>
            <span className="text-[8.5px] sm:text-[9px] font-medium text-[#8993A4] uppercase tracking-wider mt-0.5">Attendance ERP</span>
          </div>
        </Link>
        <div className="hidden md:flex items-center gap-0.5 flex-1">
          <Link to="/" className="text-white bg-white/10 text-xs font-medium px-3.5 py-1.5 rounded">Home</Link>
          <button type="button" onClick={() => scrollToSection("features")} className="text-[#8993A4] hover:text-white hover:bg-white/5 text-xs font-medium px-3.5 py-1.5 rounded cursor-pointer border-0 bg-transparent">Features</button>
          <button type="button" onClick={() => scrollToSection("compliance")} className="text-[#8993A4] hover:text-white hover:bg-white/5 text-xs font-medium px-3.5 py-1.5 rounded cursor-pointer border-0 bg-transparent">Compliance</button>
          <Link to="/privacy" className="text-[#8993A4] hover:text-white hover:bg-white/5 text-xs font-medium px-3.5 py-1.5 rounded">Documentation</Link>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link to="/student" className="text-[#C1C7D0] hover:text-white border border-white/20 hover:border-white/40 px-2.5 sm:px-3.5 py-1.5 rounded text-[11px] sm:text-xs font-medium whitespace-nowrap">Student Portal</Link>
          <div className="hidden sm:block w-px h-4 bg-white/10 mx-1"></div>
          <Link to="/auth" className="bg-[#0052CC] hover:bg-[#0065FF] text-white px-3 sm:px-4 py-1.5 rounded text-[11px] sm:text-xs font-semibold shadow-sm flex items-center gap-1 whitespace-nowrap">Sign In <ArrowRight className="w-3 h-3" /></Link>
        </div>
      </nav>

      <div className="bg-[#172B4D] h-7 flex items-center px-4 sm:px-7 gap-4 sm:gap-5 border-b border-white/5 overflow-x-auto text-[10px] sm:text-[10.5px]">
        <div className="flex items-center gap-1.5 text-[#8993A4] whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-[#57D9A3]"></span>All Systems Operational</div>
        <div className="w-px h-3 bg-white/10"></div>
        <div className="flex items-center gap-1.5 text-[#8993A4] whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-[#4C9AFF]"></span>Recognition Engine &middot; Active</div>
        <div className="w-px h-3 bg-white/10"></div>
        <div className="flex items-center gap-1.5 text-[#8993A4] whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-[#4C9AFF]"></span>Ledger Sync &middot; Real-time</div>
        <div className="w-px h-3 bg-white/10"></div>
        <div className="flex items-center gap-1.5 text-[#8993A4] whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-[#57D9A3]"></span>12 Geofence Zones &middot; Active</div>
        <div className="ml-auto flex items-center gap-4 text-[#8993A4] whitespace-nowrap"><span>AY 2025–26</span><div className="w-px h-3 bg-white/10"></div><span className="font-mono text-[#5E6C84]">{timeStr || "--:-- IST"}</span></div>
      </div>

      <section className="bg-white border-b border-[#DFE1E6] py-10 sm:py-16 px-4 sm:px-7 relative overflow-hidden">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-[1fr_540px] gap-8 sm:gap-16 items-center relative z-10">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider text-[#0052CC] bg-[#E6F0FF] px-2.5 py-1 rounded border border-[#0052CC]/15 mb-4 sm:mb-5">🔐 Cryptographic Attendance ERP</div>
            <h1 className="text-3xl sm:text-5xl font-extrabold text-[#091E42] tracking-tight leading-[1.1] sm:leading-[1.08] mb-4 sm:mb-5">Cryptographically-Enforced<br />Attendance<span className="block text-2xl sm:text-3xl font-normal text-[#5E6C84] tracking-tight mt-1.5">for Higher Education.</span></h1>
            <p className="text-sm sm:text-base text-[#5E6C84] leading-relaxed max-w-lg mb-6 sm:mb-8">Proxy attendance costs institutions accreditation points and erodes academic trust. Presence makes fraudulent check-ins impossible.</p>
            <div className="flex items-center gap-2.5 sm:gap-3 mb-8 sm:mb-9 flex-wrap">
              <Link to="/auth" className="bg-[#0052CC] hover:bg-[#0065FF] text-white px-4 sm:px-5 py-2.5 sm:py-3 rounded-md text-xs sm:text-sm font-semibold shadow-md flex items-center gap-2"><Layers className="w-4 h-4" />Access Dashboard</Link>
              <Link to="/enroll" className="bg-white hover:bg-[#F4F5F7] text-[#253858] border border-[#DFE1E6] px-4 sm:px-5 py-2.5 sm:py-3 rounded-md text-xs sm:text-sm font-semibold flex items-center gap-2"><Fingerprint className="w-4 h-4 text-[#0052CC]" />Enroll Biometrics</Link>
            </div>
          </div>
          <div className="bg-white border border-[#DFE1E6] rounded-xl shadow-xl overflow-hidden">
            <div className="bg-[#091E42] px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#C1C7D0]">Attendance Capture Flow</span>
              <div className="flex items-center gap-1.5 text-[9.5px] font-bold text-[#57D9A3] uppercase"><span className="w-1.5 h-1.5 bg-[#57D9A3] rounded-full animate-pulse"></span>Processing</div>
            </div>
            <div className="p-4 sm:p-5 flex flex-col gap-2">
              {[ {label: "Liveness + Face Match", icon: "1", status: "✓ 98.2%"}, {label: "Geofence Verification", icon: "2", status: "✓ Valid"}, {label: "Ledger Write", icon: "3", status: "✓ Written"}, {label: "Trust Score", icon: "4", status: "✓ 91/100"}].map((step, idx) => (
                <div key={idx} className={`p-2.5 sm:p-3 rounded-md border flex items-center gap-3 ${currentSeq.active >= idx ? "bg-[#E3FCEF] border-[#00875A]/25" : "bg-[#FAFBFC]"}`}>
                  <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold ${currentSeq.active >= idx ? "bg-[#00875A] text-white" : "bg-[#F4F5F7]"}`}>{currentSeq.active >= idx ? "✓" : step.icon}</div>
                  <div className="flex-1 text-[11.5px] sm:text-[12.5px] font-semibold text-[#172B4D]">{step.label}</div>
                  <span className="text-[10.5px] sm:text-[11px] font-semibold text-[#00875A]">{step.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-10 sm:py-14 px-4 sm:px-7 bg-[#FAFBFC] flex-1">
        <div className="max-w-7xl mx-auto grid grid-cols-12 gap-3.5">
          <div className="col-span-12 lg:col-span-5 bg-white border border-[#DFE1E6] border-t-4 border-t-[#0052CC] rounded-xl p-5 sm:p-6 reveal">
            <Fingerprint className="w-6 h-6 text-[#0052CC] mb-3 sm:mb-4" />
            <h3 className="text-base font-bold mb-2">Liveness + Device Binding</h3>
            <p className="text-xs text-[#5E6C84]">Face embedding match with WebAuthn ensures biometric inseparable device binding.</p>
          </div>
          <div className="col-span-12 lg:col-span-7 bg-white border border-[#DFE1E6] border-t-4 border-t-[#00875A] rounded-xl p-5 sm:p-6 reveal">
            <Activity className="w-6 h-6 text-[#00875A] mb-3 sm:mb-4" />
            <h3 className="text-base font-bold mb-2">Tamper-Evident SHA-256 Ledger</h3>
            <p className="text-xs text-[#5E6C84]">Every check-in is secured in an append-only hash chain. Database triggers detect unauthorized revisions.</p>
          </div>
        </div>
      </section>

      <footer className="bg-white border-t border-[#DFE1E6] py-4.5 px-4 sm:px-7 text-[11.5px] text-[#8993A4]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>&copy; 2026 Presence ERP &middot; All rights reserved</div>
          <div className="flex items-center gap-4 sm:gap-5">
            <Link to="/privacy" className="hover:text-[#0052CC]">Privacy Policy</Link>
            <Link to="/help" className="hover:text-[#0052CC]">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
