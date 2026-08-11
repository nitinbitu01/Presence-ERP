import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & Biometric Data Policy — Presence ERP" },
      {
        name: "description",
        content:
          "How Presence ERP handles biometric descriptors, consent, retention, and student rights.",
      },
      { property: "og:title", content: "Privacy & Biometric Data Policy — Presence" },
      {
        property: "og:description",
        content: "Face descriptors, AES-GCM encryption, retention, and withdrawal rights.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
            <Shield className="h-5 w-5 text-primary" />
            Presence ERP
          </Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-foreground">Privacy & Biometric Data Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This policy details how Presence ERP processes, protects, and retains
          student biometric data and attendance records.
        </p>

        <section className="prose prose-slate mt-8 max-w-none text-sm text-foreground [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mt-2 [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-6">
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>A 128-number face descriptor vector</strong> computed locally inside your web
              browser. Raw camera images or video frames are never stored or transmitted to
              university servers.
            </li>
            <li>
              A cryptographic device fingerprint hash used strictly to prevent a single mobile
              device from submitting attendance for multiple students.
            </li>
            <li>
              Session verification metadata: timestamp, approximate location (evaluated against the
              course geofence), IP address, and 5-gate pipeline verification outcomes.
            </li>
          </ul>

          <h2>Legal basis & consent</h2>
          <p>
            Biometric face descriptors are processed under India's Digital Personal Data Protection
            (DPDP) Act 2023 and GDPR Article 9 standards. Processing occurs exclusively with your{" "}
            <strong>explicit, revocable consent</strong> provided during initial enrollment.
          </p>

          <h2>Security & Encryption</h2>
          <ul>
            <li>
              Face descriptors are encrypted at rest using <strong>AES-GCM-256</strong> with a
              secure server-only key.
            </li>
            <li>
              Attendance check-ins are verified with a 60-second time-bound{" "}
              <strong>HMAC-SHA256</strong> challenge.
            </li>
            <li>
              Row-Level Security (RLS) ensures biometric data is completely isolated. Only
              authorized course instructors and institution administrators can access attendance
              decisions.
            </li>
            <li>
              All attendance decisions (accepted, rejected, manual overrides) are logged in an
              append-only ledger.
            </li>
          </ul>

          {/* Known Residual Risk Disclosure */}
          <div className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-300">
            <div className="flex items-center gap-2 font-semibold text-base mb-1">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Notice on Technical Liveness Verification (Known Residual Risk)
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
              In accordance with university transparency guidelines: Active liveness signals (eye
              aspect ratio, head yaw/pitch) are currently computed on the student's browser device
              prior to submission. While protected by HMAC signing and geofencing, server-side raw
              video frame attestation is scheduled for future release. Students who require
              non-biometric validation may request teacher-assisted manual fallback.
            </p>
          </div>

          <h2>Data Retention & Withdrawal</h2>
          <p>
            Face descriptor vectors are retained for up to <strong>365 days</strong> from enrollment
            or your last active check-in. Students may withdraw consent at any time via the{" "}
            <Link to="/enroll" className="text-primary underline">
              Enrollment Portal
            </Link>
            . Upon withdrawal, biometric vectors are deleted, while academic attendance ledgers are
            retained per university academic regulations.
          </p>

          <h2>Non-Biometric Fallback</h2>
          <p>
            Students who choose not to enroll biometrically or experience recurring technical issues
            can use teacher-assisted manual attendance fallback with documented justification.
          </p>
        </section>

        <div className="mt-10">
          <Link to="/" className="text-sm font-medium text-primary hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
