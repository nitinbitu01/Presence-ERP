/**
 * @deprecated SUPERSEDED as of the 15-day hardening pass — kept only because its test file
 * (webauthn-mandatory-policy.test.ts) still exercises it, not because it's live.
 *
 * The real, wired enforcement now lives in webauthn.server.ts's decideDeviceGateOutcome(),
 * called directly from submitAttendance in attendance.functions.ts. That version is a strict
 * superset of this one: it also accounts for admin-granted webauthn_exemptions rows, which
 * checkWebAuthnEnrollmentStatus below does NOT check — so this function can report a student as
 * "blocked" when the real gate would actually let them through on an exemption. Do not call
 * checkWebAuthnEnrollmentStatus/enforceWebAuthnPolicy from new code; use
 * webauthn.functions.ts's getWebauthnStatus (UI pre-check) or webauthn.server.ts's
 * decideDeviceGateOutcome (server-side gate) instead, so the UI and the real gate can never
 * disagree.
 *
 * Phase 5 — WebAuthn Mandatory Policy Enforcement
 *
 * SECURITY GAP CLOSED: Previously WebAuthn was opt-in. A student without
 * a registered WebAuthn credential could skip hardware-backed liveness and
 * rely only on client-computed EAR/yaw/pitch numbers that a scripted HTTP
 * client could fabricate.
 *
 * This module enforces mandatory WebAuthn for all check-ins:
 *  - Students with ≥1 registered credential → PASS (hardware-backed)
 *  - Students with 0 credentials → BLOCKED (must enroll first)
 *
 * Configured via WEBAUTHN_POLICY env var:
 *  "mandatory"   — default; blocks check-in without credential
 *  "recommended" — warns but allows (grace period mode)
 *  "optional"    — legacy; equivalent to old opt-in behavior (NOT recommended)
 *
 * The AWS Rekognition server-side liveness path is orthogonal:
 *  - Rekognition fires when AWS credentials are configured AND student has no WebAuthn
 *  - If both AWS Rekognition AND WebAuthn are available, WebAuthn takes precedence
 *    (hardware > server-side ML > client-computed)
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "@/lib/errors";
import { getWebauthnPolicy } from "@/lib/webauthn.server";

export type WebAuthnPolicy = "mandatory" | "recommended" | "optional";

export interface WebAuthnEnrollmentStatus {
  hasCredential: boolean;
  credentialCount: number;
  policy: WebAuthnPolicy;
  /** True when the student may proceed with check-in */
  canCheckIn: boolean;
  /** Non-null when the student is blocked or warned */
  message: string | null;
}

function getActivePolicy(): WebAuthnPolicy {
  return getWebauthnPolicy();
}

/**
 * Check whether the currently authenticated student has a registered
 * WebAuthn credential, and whether their policy allows check-in.
 *
 * Call this at the START of the attendance check-in flow before any
 * liveness session is created.
 */
export const checkWebAuthnEnrollmentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WebAuthnEnrollmentStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const policy = getActivePolicy();

    const { count } = await supabaseAdmin
      .from("webauthn_credentials")
      .select("*", { count: "exact", head: true })
      .eq("user_id", context.userId);

    const credentialCount = count ?? 0;
    const hasCredential = credentialCount > 0;

    let canCheckIn = true;
    let message: string | null = null;

    if (!hasCredential) {
      if (policy === "mandatory") {
        canCheckIn = false;
        message =
          "WebAuthn device registration is required before you can mark attendance. " +
          "Please register your device in Security Settings → Register This Device.";
      } else if (policy === "recommended") {
        canCheckIn = true;
        message =
          "Your device is not registered for secure check-in. " +
          "This is required from the next semester. Register now in Security Settings.";
      }
      // policy === "optional": canCheckIn = true, message = null
    }

    return { hasCredential, credentialCount, policy, canCheckIn, message };
  });

/**
 * Gate function: throws PresenceErpError if student cannot check in
 * under the active WebAuthn policy.
 *
 * Use this inside submitAttendance as a pre-flight check.
 */
export async function enforceWebAuthnPolicy(userId: string): Promise<void> {
  const policy = getActivePolicy();
  if (policy === "optional") return; // No enforcement

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("webauthn_credentials")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const hasCredential = (count ?? 0) > 0;

  if (!hasCredential && policy === "mandatory") {
    throw new PresenceErpError(
      "FORBIDDEN",
      "Attendance check-in requires WebAuthn device registration. " +
        "Please register your device in Security Settings before marking attendance.",
    );
  }
}

/**
 * Update the active WebAuthn policy in feature_flags / database settings.
 * Admin-only.
 */
export const updateWebAuthnPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ policy: z.enum(["mandatory", "recommended", "optional"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireAdmin, writeAuditLog } = await import("./admin.functions");

    await requireAdmin(context.userId);

    const { error } = await supabaseAdmin.from("feature_flags").upsert({
      key: "webauthn_policy",
      is_enabled: data.policy === "mandatory",
      description: data.policy,
    });

    if (error) throw new Error(error.message);

    void writeAuditLog(supabaseAdmin, {
      actorId: context.userId,
      action: "update_webauthn_policy",
      targetTable: "feature_flags",
      targetId: "webauthn_policy",
      details: { newPolicy: data.policy },
    });

    return { success: true, policy: data.policy };
  });
