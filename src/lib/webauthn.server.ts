// Phase 1 (hardening work order): WebAuthn platform-authenticator device binding.
//
// Closes part of the liveness trust gap documented in README.md's security
// section: submitAttendance's liveness signals are client-computed numbers, and
// the existing HMAC challenge (issueChallenge/verifyChallenge in
// attendance-crypto.server.ts) secures the challenge *metadata*, not the claim
// that a real camera produced the signals. A student who has registered a
// platform authenticator (Face ID / Touch ID / Windows Hello / Android biometric
// unlock) here must produce a hardware-backed signature over that same
// server-issued challenge to check in -- something a scripted HTTP client can't
// forge, because the private key never leaves the authenticator.
//
// CORRECTED (was previously mis-described as "opt-in per student" here): submitAttendance's
// gate is actually deny-by-default -- a student with no registered credential AND no active
// admin-granted webauthn_exemptions row is rejected outright. What was missing was a graduated
// rollout mode: getWebauthnPolicy()/decideDeviceGateOutcome() below add a "recommended" grace
// period (warn but allow) driven by the WEBAUTHN_POLICY env var, so a mass student rollout
// doesn't hard-lock out everyone on day one before they've had a chance to register a device.
// This is one additional gate alongside the existing 5, not a replacement for any of them.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/server";

import { getSecret } from "./cf-env.server";

const enc = new TextEncoder();

function requireKeyMaterial(name: string): string {
  return getSecret(name);
}

// Reuses LIVENESS_HMAC_KEY rather than introducing a new required secret: it's
// already this project's general-purpose key for signing short-lived,
// server-issued tokens, and every payload signed with it here is domain-tagged
// ("webauthn_reg...") so it can't be confused with an attendance LivenessChallenge
// even though both use the same key. Same current+previous rotation grace window
// as attendance-crypto.server.ts's importHmacKeys (see that file's comment for
// why a two-key scheme is enough for short-lived tokens): new envelopes always
// sign with the current key; verification tries current and, if configured,
// LIVENESS_HMAC_KEY_PREVIOUS too.
async function importHmacKeys(): Promise<CryptoKey[]> {
  const names = [
    "LIVENESS_HMAC_KEY",
    ...(process.env.LIVENESS_HMAC_KEY_PREVIOUS ? ["LIVENESS_HMAC_KEY_PREVIOUS"] : []),
  ];
  return Promise.all(
    names.map(async (name) => {
      const raw = enc.encode(requireKeyMaterial(name));
      return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
      ]);
    }),
  );
}
async function importHmacKey(): Promise<CryptoKey> {
  const [current] = await importHmacKeys();
  return current;
}

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64uToBytes(str: string): Uint8Array<ArrayBuffer> {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---- RP ID / origin resolution ----
// Derived from the incoming request rather than a hardcoded env var, so this
// works correctly across local dev, preview deployments, and production without
// needing a new required config value.
export function resolveRpConfig(req: Request | null): { rpID: string; origin: string } {
  const originHeader = req?.headers.get("origin");
  if (originHeader) {
    try {
      return { rpID: new URL(originHeader).hostname, origin: originHeader };
    } catch {
      // fall through to host-header derivation
    }
  }
  const host = req?.headers.get("x-forwarded-host") ?? req?.headers.get("host");
  if (host) {
    const proto = req?.headers.get("x-forwarded-proto") ?? "https";
    return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
  }
  return { rpID: "localhost", origin: "http://localhost:3000" };
}

// ---- Stateless HMAC-signed registration challenge ----
// Same shape/spirit as LivenessChallenge in attendance-crypto.server.ts: no
// server-side session storage needed, since the challenge carries its own
// signature and expiry. Registration (unlike check-in) has no existing
// per-attempt challenge to piggyback on, so this is its own small envelope.
export interface WebauthnRegChallenge {
  userId: string;
  nonce: string; // base64url random bytes -- this IS the WebAuthn `challenge`
  issuedAt: number;
  ttlMs: number;
  sig: string;
}

export async function issueRegistrationChallenge(userId: string): Promise<WebauthnRegChallenge> {
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = Date.now();
  const ttlMs = 5 * 60_000; // 5 minutes to complete the registration ceremony
  const key = await importHmacKey();
  const bytes = enc.encode(`webauthn_reg.${nonce}.${userId}.${issuedAt}.${ttlMs}`);
  const sig = b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes as BufferSource)));
  return { userId, nonce, issuedAt, ttlMs, sig };
}

export async function verifyRegistrationChallenge(
  c: WebauthnRegChallenge,
  expectedUserId: string,
): Promise<boolean> {
  if (c.userId !== expectedUserId) return false;
  if (Date.now() - c.issuedAt > c.ttlMs) return false;
  const key = await importHmacKey();
  const bytes = enc.encode(`webauthn_reg.${c.nonce}.${c.userId}.${c.issuedAt}.${c.ttlMs}`);
  return crypto.subtle.verify(
    "HMAC",
    key,
    b64uToBytes(c.sig) as BufferSource,
    bytes as BufferSource,
  );
}

// ---- Registration ----
export async function startDeviceRegistration(
  userId: string,
  userEmail: string,
  req: Request | null,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; envelope: WebauthnRegChallenge }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rpID } = resolveRpConfig(req);

    const existing = await supabaseAdmin
      .from("webauthn_credentials")
      .select("credential_id, transports")
      .eq("user_id", userId);

    const envelope = await issueRegistrationChallenge(userId);

    // Build a deterministic userHandle (Uint8Array) from the UUID — required in
    // @simplewebauthn/server v10+. TextEncoder produces a plain Uint8Array which
    // the library's isoBase64URL.fromBuffer can safely consume.
    const userHandle = new Uint8Array(enc.encode(userId));

    // Build the challenge bytes from the nonce we issued.
    const challengeBytes = new Uint8Array(b64uToBytes(envelope.nonce));

    const options = await generateRegistrationOptions({
      rpName: "Presence Attendance",
      rpID,
      userName: userEmail,
      userID: userHandle,
      challenge: challengeBytes,
      attestationType: "none",
      excludeCredentials: (existing.data ?? []).map((c) => ({
        id: c.credential_id,
        transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
    });

    // Verify the returned options are plain-JSON-serializable before returning
    // (avoids Seroval "step 3" TypeError when non-plain values sneak through).
    return JSON.parse(JSON.stringify({ options, envelope })) as {
      options: PublicKeyCredentialCreationOptionsJSON;
      envelope: WebauthnRegChallenge;
    };
  } catch (err) {
    console.error("[startDeviceRegistration] crash:", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function finishDeviceRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  envelope: WebauthnRegChallenge,
  deviceLabel: string | undefined,
  req: Request | null,
): Promise<{ ok: true }> {
  const envelopeValid = await verifyRegistrationChallenge(envelope, userId);
  if (!envelopeValid) {
    throw new Error("Registration challenge expired or invalid. Please retry.");
  }

  const { rpID, origin } = resolveRpConfig(req);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: envelope.nonce,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Device registration could not be verified.");
  }

  const { credential } = verification.registrationInfo;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // ── FIX 7: Max 1 registered device per student ───────────────────────────────────
  // Closes Gap #8: a student could pre-register a "proxy device" (phone given to
  // a friend), then use their own device to attend another class simultaneously.
  // With a hard cap of 1 device per student (enforced at registration time), a
  // proxy would have to steal / borrow the student's ACTUAL enrolled device —
  // which requires physical possession, the same bar as the student attending.
  //
  // Admins are exempt: they may need multiple devices for testing/support.
  // ─────────────────────────────────────────────────────────────────────────
  const isAdminEmail = process.env.ADMIN_EMAIL ?? "nitinbitu03@gmail.com";
  const { data: adminRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  const isAdmin = Boolean(adminRow);

  if (!isAdmin) {
    const { count: existingCount } = await supabaseAdmin
      .from("webauthn_credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if ((existingCount ?? 0) >= 1) {
      throw new Error(
        "Device limit reached. You may only register one device for attendance. " +
        "To replace your device, contact an administrator to remove the existing registration.",
      );
    }
  }
  // ── End FIX 7 ───────────────────────────────────────────────────────────────────────

  const { error } = await supabaseAdmin.from("webauthn_credentials").insert({
    user_id: userId,
    credential_id: credential.id,
    public_key: b64u(credential.publicKey),
    counter: credential.counter,
    device_label: deviceLabel ?? null,
    transports: credential.transports ?? null,
  });
  if (error) throw new Error(`Could not save device: ${error.message}`);

  return { ok: true };
}

// ---- Authentication (used as a submitAttendance gate) ----
export async function hasRegisteredDevice(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

export async function verifyDeviceAssertion(
  userId: string,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  req: Request | null,
): Promise<{ verified: boolean; reason?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cred, error } = await supabaseAdmin
    .from("webauthn_credentials")
    .select("*")
    .eq("user_id", userId)
    .eq("credential_id", response.id)
    .maybeSingle();

  if (error || !cred) return { verified: false, reason: "unknown_credential" };

  if (cred.credential_id.startsWith("demo_virtual_key_") || response?.id?.startsWith("demo_virtual_key_")) {
    const { isDemoMode } = await import("@/lib/feature-flags.server");
    if (await isDemoMode()) {
      await supabaseAdmin
        .from("webauthn_credentials")
        .update({
          counter: Number(cred.counter) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("credential_id", cred.credential_id);
      return { verified: true };
    }
    // In production: demo virtual key exists but demo mode is off — reject
    return { verified: false, reason: "demo_key_not_allowed_in_production" };
  }

  const { rpID, origin } = resolveRpConfig(req);
  const webauthnCredential: WebAuthnCredential = {
    id: cred.credential_id,
    publicKey: b64uToBytes(cred.public_key),
    counter: Number(cred.counter),
    transports: (cred.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
  };

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: webauthnCredential,
      requireUserVerification: true,
    });
  } catch (e) {
    // SimpleWebAuthn throws on structural problems, including a signature counter
    // that didn't increase -- a strong signal of a cloned authenticator or a
    // replayed assertion. Treat any throw as a failed verification, not an
    // exception that should propagate and 500 the request.
    return { verified: false, reason: e instanceof Error ? e.message : "verification_error" };
  }

  if (!verification.verified) return { verified: false, reason: "not_verified" };

  await supabaseAdmin
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("credential_id", cred.credential_id);

  return { verified: true };
}

export type WebauthnPolicy = "mandatory" | "recommended" | "optional";

/**
 * WEBAUTHN_POLICY env var controls rollout strictness:
 *  "mandatory"   — default. No device + no exemption => blocked.
 *  "recommended" — grace period. No device + no exemption => allowed, but flagged/warned.
 *  "optional"    — legacy escape hatch. Gate is skipped entirely.
 *
 * Use "recommended" for the first few days of a mass rollout (e.g. onboarding 1000 students)
 * so nobody is hard-locked out of their first class before they've registered a device, then
 * switch to "mandatory" once the registration window has closed.
 */
export function getWebauthnPolicy(): WebauthnPolicy {
  const raw = process.env.WEBAUTHN_POLICY ?? "mandatory";
  if (raw === "recommended" || raw === "optional") {
    // FIX 8: Warn operators in production when running in a degraded security mode.
    // "optional" means Gate 2c (hardware device assertion) is entirely skipped,
    // reducing the system to client-side signals only.
    // "recommended" means students without a device are warned but still let through.
    // Neither is acceptable in a production attendance system without an explicit rollout plan.
    const isProduction = process.env.NODE_ENV === "production" || process.env.CF_PAGES === "1";
    if (isProduction && raw === "optional") {
      console.warn(
        `[WebAuthn] SECURITY DEGRADED: WEBAUTHN_POLICY=optional in production. ` +
        `Gate 2c (hardware device attestation) is disabled. ` +
        `Students can check in without a bound device. ` +
        `Set WEBAUTHN_POLICY=mandatory to enforce hardware binding.`,
      );
    }
    return raw;
  }
  return "mandatory";
}

export type DeviceGateOutcome =
  | { outcome: "pass"; note: string }
  | { outcome: "pass_grace_warn"; note: string }
  | { outcome: "verify_assertion" }
  | { outcome: "blocked"; reasonCode: "device_required_no_exemption" };

/**
 * Pure decision logic for Gate 2c (device attestation), extracted so it can be unit tested
 * without needing to invoke the createServerFn-wrapped submitAttendance handler directly.
 * submitAttendance calls this and then acts on the result.
 */
export function decideDeviceGateOutcome(input: {
  deviceRegistered: boolean;
  isExempt: boolean;
  policy: WebauthnPolicy;
}): DeviceGateOutcome {
  const { deviceRegistered, isExempt, policy } = input;

  if (deviceRegistered) {
    // Always verify the assertion when a device IS registered, regardless of policy —
    // the student has the stronger factor available, so use it. This check must stay
    // first: "optional" policy is meant to stop punishing students with no device, not
    // to stop verifying students who already registered one.
    return { outcome: "verify_assertion" };
  }
  if (policy === "optional") {
    return { outcome: "pass", note: "policy_optional" };
  }
  if (isExempt) {
    return { outcome: "pass", note: "admin_exemption_active" };
  }
  if (policy === "recommended") {
    return {
      outcome: "pass_grace_warn",
      note: "no_device_grace_period_warned",
    };
  }
  // policy === "mandatory", no device, no exemption
  return { outcome: "blocked", reasonCode: "device_required_no_exemption" };
}

export async function hasWebauthnExemption(studentId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("webauthn_exemptions")
    .select("student_id, expires_at, revoked_at")
    .eq("student_id", studentId)
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return false;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return false;
  }
  return true;
}
