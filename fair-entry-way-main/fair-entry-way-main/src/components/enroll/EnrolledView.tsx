/**
 * EnrolledView.tsx
 * Profile card shown when user is already enrolled.
 * No hardcoded admin email — isAdmin comes from server getRoles() only.
 * No localStorage for photo — state only.
 */
import { Link } from "@tanstack/react-router";
import { DevicePanel } from "./DevicePanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { useState } from "react";
import type { EnrollState } from "./useEnrollment";

const POLICY_VERSION = "2026-07-01";

type Dept = { id: string; code: string; name: string };
type Prog = { id: string; department_id: string; code: string; name: string };

type Props = {
  state: EnrollState;
  depts: Dept[];
  progs: Prog[];
  deviceLabel: string;
  setDeviceLabel: (v: string) => void;
  onRegisterDevice: () => void;
  onRemoveDevice: (id: string) => void;
  onWithdrawBiometric: () => void;
  onAdminReset: () => void;
  onSignOut: () => void;
};

export function EnrolledView({
  state,
  depts,
  progs,
  deviceLabel,
  setDeviceLabel,
  onRegisterDevice,
  onRemoveDevice,
  onWithdrawBiometric,
  onAdminReset,
  onSignOut,
}: Props) {
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [adminResetDialogOpen, setAdminResetDialogOpen] = useState(false);

  const deptCode = depts.find((d) => d.id === state.profile?.department_id)?.code ?? "";
  const deptName = depts.find((d) => d.id === state.profile?.department_id)?.name ?? "";
  const progCode = progs.find((p) => p.id === state.profile?.program_id)?.code ?? "";
  const progName = progs.find((p) => p.id === state.profile?.program_id)?.name ?? "";

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      {/* Lock Banner */}
      <div
        role="status"
        className="mb-6 flex items-start gap-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 shadow-sm"
      >
        <span aria-hidden="true" className="text-3xl">
          🔒
        </span>
        <div>
          <h3 className="font-bold text-amber-900 dark:text-amber-200 text-sm">
            Biometric Enrollment Completed &amp; Locked
          </h3>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            As per university security policy, a user is allowed to enroll their face{" "}
            <strong>only ONCE</strong>. Re-enrollment requires Administrator action.
          </p>
        </div>
      </div>

      {/* Admin banner — only rendered when isAdmin=true from server */}
      {state.isAdmin && (
        <div className="mb-6 flex items-center justify-between rounded-xl bg-purple-500/10 border border-purple-500/30 px-4 py-3 text-xs text-purple-900 dark:text-purple-200">
          <span className="font-semibold flex items-center gap-1.5">
            <span aria-hidden="true">👑</span> Administrator Privileges Active
          </span>
          <button
            onClick={() => setAdminResetDialogOpen(true)}
            className="rounded bg-purple-600 px-3 py-1 font-bold text-white hover:bg-purple-700 transition-colors"
          >
            Reset Biometrics
          </button>
        </div>
      )}

      {/* Profile Card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {/* Photo */}
        <div className="flex flex-col items-center bg-gradient-to-br from-primary/10 to-primary/5 py-8">
          <div className="relative">
            {state.enrolledPhoto ? (
              <img
                src={state.enrolledPhoto}
                alt="Your enrolled face photo"
                className="h-28 w-28 rounded-full border-4 border-primary/40 object-cover shadow-md"
              />
            ) : (
              <div
                aria-label="No photo available"
                className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-primary/40 bg-primary/20 shadow-md"
              >
                <span aria-hidden="true" className="text-5xl">
                  👤
                </span>
              </div>
            )}
            <span
              aria-label="Enrollment verified"
              className="absolute bottom-1 right-1 rounded-full bg-emerald-500 p-1 text-white text-xs shadow"
            >
              ✓
            </span>
          </div>
          <h2 className="mt-3 text-lg font-bold text-foreground">
            {state.profile?.roll_no ?? state.userEmail.split("@")[0]}
          </h2>
          <p className="text-xs text-muted-foreground">{state.userEmail}</p>
        </div>

        {/* Details */}
        <dl className="divide-y divide-border px-6 py-4">
          {state.profile?.roll_no && (
            <div className="flex justify-between py-2.5">
              <dt className="text-xs font-medium text-muted-foreground">Roll Number</dt>
              <dd className="text-sm font-semibold text-foreground">{state.profile.roll_no}</dd>
            </div>
          )}
          {deptCode && (
            <div className="flex justify-between py-2.5">
              <dt className="text-xs font-medium text-muted-foreground">Department</dt>
              <dd className="text-sm font-semibold text-foreground text-right max-w-[60%]">
                {deptCode}
                {deptName && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {deptName}
                  </span>
                )}
              </dd>
            </div>
          )}
          {progCode && (
            <div className="flex justify-between py-2.5">
              <dt className="text-xs font-medium text-muted-foreground">Program</dt>
              <dd className="text-sm font-semibold text-foreground text-right max-w-[60%]">
                {progCode}
                {progName && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {progName}
                  </span>
                )}
              </dd>
            </div>
          )}
          {state.profile?.current_semester && (
            <div className="flex justify-between py-2.5">
              <dt className="text-xs font-medium text-muted-foreground">Semester</dt>
              <dd className="text-sm font-semibold text-foreground">
                Semester {state.profile.current_semester}
              </dd>
            </div>
          )}
          <div className="flex justify-between py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">Biometric Status</dt>
            <dd>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <span aria-hidden="true">●</span> Enrolled
              </span>
            </dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">Policy Version</dt>
            <dd className="text-xs text-foreground">v{POLICY_VERSION}</dd>
          </div>
        </dl>

        {/* Device binding */}
        <DevicePanel
          devices={state.devices}
          deviceBusy={state.deviceBusy}
          deviceError={state.deviceError}
          deviceLabel={deviceLabel}
          webauthnSupported={state.webauthnSupported}
          isMounted={state.isMounted}
          setDeviceLabel={setDeviceLabel}
          onRegister={onRegisterDevice}
          onRemove={onRemoveDevice}
        />

        {/* Actions */}
        <div className="flex flex-wrap gap-3 border-t border-border px-6 py-4">
          <button
            onClick={() => setWithdrawDialogOpen(true)}
            className="rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            🗑 Delete Biometric &amp; Re-enroll
          </button>
          <button
            onClick={onSignOut}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Read the full{" "}
        <Link to="/privacy" className="text-primary underline">
          privacy &amp; biometric data policy
        </Link>
        .
      </p>

      {/* Accessible confirm dialogs */}
      <ConfirmDialog
        open={withdrawDialogOpen}
        title="Delete your biometric data?"
        description="Past attendance records will remain (they are academic records). You will need to re-enroll to use biometric check-in again."
        confirmLabel="Delete biometric data"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => {
          setWithdrawDialogOpen(false);
          onWithdrawBiometric();
        }}
        onCancel={() => setWithdrawDialogOpen(false)}
      />

      <ConfirmDialog
        open={adminResetDialogOpen}
        title="Admin: Reset biometric enrollment?"
        description="This will delete the current enrollment and allow re-enrollment. This action is logged."
        confirmLabel="Reset enrollment"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          setAdminResetDialogOpen(false);
          onAdminReset();
        }}
        onCancel={() => setAdminResetDialogOpen(false)}
      />
    </div>
  );
}
