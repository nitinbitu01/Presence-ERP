/**
 * day6-scripted-api.ts — Attack 4: Raw HTTP POST with No Camera (Gate 5)
 *
 * Run: bun attack-harness/day6-scripted-api.ts
 *
 * ═══════════════════════════════════════════════════════════════
 *  THIS IS THE SINGLE MOST CONVINCING DEMO MOMENT.
 *  SCREEN-RECORD THIS SPECIFICALLY.
 * ═══════════════════════════════════════════════════════════════
 *
 * What this proves:
 *   A real attacker doesn't open a browser. They write a script that calls the
 *   server API directly with fabricated-but-structurally-valid liveness signals,
 *   a real session ID, and a stolen JWT. No camera, no face, no device.
 *
 *   Most attendance systems accept this because they only validate client-side.
 *   This system rejects it at Gate 5 (WebAuthn device attestation) before
 *   liveness or face match gates are even reached.
 *
 * What to show judges:
 *   1. This script (a raw HTTP client — no browser, no camera)
 *   2. The request payload (structurally valid, would fool a naive server)
 *   3. The response: { decision: "rejected", reasonCode: "device_attestation_missing" }
 *   4. The attendance_events row in the admin audit feed
 *   5. The key point: "WebAuthn requires a hardware FIDO authenticator. A script can't
 *      produce one. This is a cryptographic guarantee, not a heuristic."
 *
 * Pre-flight check:
 *   Before running this, verify WebAuthn policy is mandatory in Cloudflare logs:
 *     grep "[Gate2c] WebAuthn policy resolved" in your Cloudflare Workers logs
 *     It must say "mandatory". If it says "optional", set WEBAUTHN_POLICY=mandatory.
 *
 * Expected:
 *   decision: "rejected"
 *   reasonCode: "device_attestation_missing"
 *   event_type: "device_attestation_fail" in attendance_events
 *   Gate reached: 2c — liveness and face gates are NOT even evaluated
 */

import {
  signIn,
  callSubmitAttendance,
  assertGate,
  printResult,
  banner,
  info,
  ok,
  fail,
} from "./attack-runner.ts";
import { config, DEVICE_FP, randomEmbedding, makeBlinkSignals } from "./attack.config.ts";

async function main() {
  banner("Day 6 — Attack 4: Scripted API Call (No Camera, No Device)");
  console.log("  ┌──────────────────────────────────────────────────┐");
  console.log("  │  SCREEN-RECORD THIS FOR THE DEMO PRESENTATION   │");
  console.log("  └──────────────────────────────────────────────────┘\n");

  const student = config.testStudents[0];
  info(`Step 1: Authenticate as ${student.email} (simulating stolen credentials)...`);
  const session = await signIn(student.email, student.password);
  ok(`Got valid JWT: ${session.accessToken.slice(0, 20)}...`);

  info("Step 2: Craft a structurally valid payload with NO real camera data...");

  // Everything here is fabricated but passes schema validation.
  // A naive server that only checks input shapes would accept this.
  const payload = {
    sessionId: config.testSessionId,

    // Fabricated but structurally valid face embedding
    probeEmbedding: randomEmbedding(128),

    // Location: inside the classroom (we know the coordinates)
    clientLat: config.classroom.lat + 0.00001, // ~1m offset, well within 50m radius
    clientLng: config.classroom.lng - 0.00001,
    clientAccuracy: 8.5, // realistic accuracy — not suspiciously perfect

    // Device fingerprint: plausible format
    deviceFingerprint: "scripted-attack-device-fp-12345678",

    // Liveness challenge: the HMAC sig is fabricated (would fail at Gate 3),
    // but Gate 5 fires BEFORE Gate 3 — so this is fine for proving the point.
    livenessChallenge: {
      action: "blink",
      sessionId: config.testSessionId,
      userId: session.userId,
      issuedAt: Date.now() - 2000,
      ttlMs: 60_000,
      sig: "ZmFicmljYXRlZC1obWFjLXNpZw", // fabricated base64url — looks like a real sig
    },

    // Fabricated liveness signals — would pass the variance checks
    livenessSignals: makeBlinkSignals(10),

    // Fabricated frame embeddings — consistent with each other
    frameEmbeddings: (() => {
      const base = randomEmbedding(128);
      return [base, base.map((v) => v + 0.001), base.map((v) => v - 0.001)];
    })(),

    // THE MISSING PIECE: no webauthnAssertion
    // This is what a script CANNOT produce — it requires a hardware FIDO authenticator
    // (Face ID / Touch ID / Windows Hello / Android biometric) physically present.
    webauthnAssertion: undefined,
  };

  info("Step 3: POST to submitAttendance server function...");
  info(`  URL: ${config.serverFnUrl}`);
  info(`  Payload size: ${JSON.stringify(payload).length} bytes`);
  info("  webauthnAssertion: ABSENT (no hardware authenticator)");

  const result = await callSubmitAttendance(session, payload);

  console.log("\n");
  info("Step 4: Verify the result...");
  printResult("Scripted API attack", result);

  const passed = assertGate("Scripted API (no camera, no device)", result, {
    expectedDecision: "rejected",
    expectedReasonCode: "device_attestation_missing",
    expectedFailedGate: "deviceAttestation",
  });

  // Verify the critical property: gate 5 fired BEFORE later gates
  if (result.gateReasons) {
    const gr = result.gateReasons as Record<string, { ok?: boolean }>;
    const livenessReached = gr.liveness !== undefined;
    const identityReached = gr.identity !== undefined;

    if (!livenessReached && !identityReached) {
      ok("Liveness and identity gates were NOT reached — Gate 5 blocked first ✓");
    } else {
      fail("Later gates were evaluated despite Gate 5 rejection — ordering bug");
    }
  }

  console.log("\n");
  if (passed) {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ✅ SCRIPTED API ATTACK BLOCKED AT GATE 5");
    console.log("  ");
    console.log("  A raw HTTP request with fabricated signals,");
    console.log("  structurally valid payload, stolen credentials,");
    console.log("  and spoofed location was REJECTED before liveness");
    console.log("  or face-match gates were even evaluated.");
    console.log("  ");
    console.log("  The missing piece: a hardware FIDO2 assertion that");
    console.log("  only a physical authenticator can produce.");
    console.log("  ");
    console.log("  This is a cryptographic guarantee, not a heuristic.");
    console.log("═══════════════════════════════════════════════════════════");
  } else {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ❌ GATE 5 DID NOT FIRE");
    console.log("  ");
    console.log("  Check:");
    console.log("  1. Is WEBAUTHN_POLICY=mandatory set in .env / Cloudflare secrets?");
    console.log("  2. Does the student have a webauthn_exemptions row? (remove it)");
    console.log("  3. Grep Cloudflare logs for '[Gate2c] WebAuthn policy resolved'");
    console.log("═══════════════════════════════════════════════════════════");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
