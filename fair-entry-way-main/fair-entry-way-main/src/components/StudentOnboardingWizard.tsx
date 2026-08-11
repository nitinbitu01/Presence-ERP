import React, { useState, useEffect } from "react";
import { ShieldCheck, User, Key, CheckCircle, ArrowRight, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

const ONBOARDING_COMPLETED_KEY = "presence_erp_onboarding_done";

export const StudentOnboardingWizard: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    if (!done) {
      setIsOpen(true);
    }
  }, []);

  const handleFinish = () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2 font-bold text-lg text-indigo-400">
            <ShieldCheck className="h-6 w-6 text-indigo-500" />
            <span>Welcome to Presence ERP</span>
          </div>
          <button
            onClick={handleFinish}
            className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step Content */}
        <div className="py-6">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Proof-of-Presence Verification</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Presence ERP uses cryptographic liveness checks and hardware device binding to
                ensure attendance records are 100% authentic and tamper-evident.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <User className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Step 1: Face Mesh Enrollment</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Your face template is encrypted with AES-256-GCM using military-grade security. No
                raw photos are stored on our servers.
              </p>
              <Link
                to="/enroll"
                onClick={handleFinish}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                <span>Enroll Face Template Now</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Key className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Step 2: Bind WebAuthn Device</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Bind your smartphone or hardware key (TouchID, FaceID, YubiKey) to prevent proxy
                check-ins from unauthorized devices.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <CheckCircle className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Ready to Check-in!</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                You're all set! Use the "Face Check-in 📸" button in the top navigation whenever
                your professor starts a class session.
              </p>
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`h-2 rounded-full transition-all ${
                  step === i ? "w-6 bg-indigo-500" : "w-2 bg-slate-700"
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold hover:bg-slate-800"
              >
                Back
              </button>
            )}

            {step < 4 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold hover:bg-indigo-500"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold hover:bg-emerald-500"
              >
                Get Started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
