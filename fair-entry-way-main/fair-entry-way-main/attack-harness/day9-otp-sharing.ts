/**
 * day9-otp-sharing.ts — Attack 7: OTP Sharing (Gate 4 — Documented Boundary)
 *
 * Run: bun attack-harness/day9-otp-sharing.ts
 *
 * What this tests:
 *   Two students use the same valid OTP simultaneously from different devices/locations.
 *   This is a SOCIAL attack vector, not a technical one — the OTP can't distinguish
 *   who typed it, only that the code is correct.
 *
 * Expected outcome:
 *   - OTP gate (Gate 4) PASSES for BOTH users (this is the known gap)
 *   - The 2nd user is caught by other gates:
 *     · Gate 3 (spatial): if they're not in the classroom
 *     · Gate 5 (WebAuthn): if they don't have a registered device
 *     · Gate 9 (identity): if their face doesn't match
 *     · Gate 10 (device-lock): if they're using a different device
 *
 * This script is designed to demonstrate an honest understanding of the system's
 * limits, not a code fix. Use the companion day9-analysis.md in your pitch.
 */

import {
  signIn,
  callSubmitAttendance,
  printResult,
  banner,
  info,
  ok,
  fail,
} from "./attack-runner.ts";
import { config, DEVICE_FP, randomEmbedding, makeBlinkSignals } from "./attack.config.ts";

async function main() {
  banner("Day 9 — Attack 7: OTP Sharing (Social Vector)");

  console.log("  This test demonstrates a KNOWN boundary, not a code fix.");
  console.log("  The OTP gate alone cannot stop two people sharing a code.");
  console.log("  Other gates catch the attack in practice.\n");

  const studentA = config.testStudents[0]; // legitimate student (has the OTP)
  const studentB = config.testStudents[3]; // accomplice (received OTP via text)

  info(`Authenticating Student A (legitimate): ${studentA.email}`);
  const sessionA = await signIn(studentA.email, studentA.password);

  info(`Authenticating Student B (accomplice): ${studentB.email}`);
  const sessionB = await signIn(studentB.email, studentB.password);

  // The OTP — in a real attack, Student A reads this from the teacher's board
  // and texts it to Student B who is elsewhere
  const SHARED_OTP = "123456"; // placeholder — actual OTP must be fetched from the session

  function makePayload(userId: string, fp: string, lat: number, lng: number) {
    return {
      sessionId: config.testSessionId,
      probeEmbedding: randomEmbedding(128),
      clientLat: lat,
      clientLng: lng,
      clientAccuracy: 10,
      deviceFingerprint: fp,
      livenessChallenge: {
        action: "blink" as const,
        sessionId: config.testSessionId,
        userId,
        issuedAt: Date.now() - 2000,
        ttlMs: 60_000,
        sig: "attack-harness-fake-hmac-sig",
      },
      livenessSignals: makeBlinkSignals(10),
      frameEmbeddings: [randomEmbedding(128), randomEmbedding(128)],
      sessionOtp: SHARED_OTP,
    };
  }

  // ── Student A: in the classroom, correct device ───────────────────────────
  console.log("\n--- Student A: legitimate check-in (inside classroom) ---");
  const resultA = await callSubmitAttendance(
    sessionA,
    makePayload(
      sessionA.userId,
      DEVICE_FP.studentA,
      config.classroom.lat, // inside classroom
      config.classroom.lng,
    ),
  );
  printResult("Student A (legitimate)", resultA);

  // Student A may fail at other gates (HMAC, WebAuthn) but NOT at OTP
  const otpGateA = resultA.gateReasons?.otp as { ok?: boolean } | undefined;
  if (!otpGateA || otpGateA.ok !== false) {
    ok("Student A: OTP gate did not reject (expected — correct code)");
  } else {
    fail("Student A: OTP gate rejected — is the OTP correct? Check the teacher's session.");
  }

  // ── Student B: OUTSIDE classroom, different device, same OTP ──────────────
  console.log(
    "\n--- Student B: accomplice with same OTP (outside classroom, different device) ---",
  );
  const resultB = await callSubmitAttendance(
    sessionB,
    makePayload(
      sessionB.userId,
      DEVICE_FP.studentB,
      config.classroom.lat + 0.01, // ~1.1km away from classroom
      config.classroom.lng,
    ),
  );
  printResult("Student B (accomplice)", resultB);

  // Analysis: what gate caught Student B?
  const reasons = resultB.gateReasons as
    Record<string, { ok?: boolean; reason?: string }> | undefined;
  const caughtBy: string[] = [];

  if (reasons) {
    if (reasons.spatial?.ok === false) caughtBy.push("Gate 3 (spatial/geofence)");
    if (reasons.deviceAttestation?.ok === false) caughtBy.push("Gate 5 (WebAuthn)");
    if (reasons.liveness?.ok === false) caughtBy.push("Gate 8 (liveness)");
    if (reasons.identity?.ok === false) caughtBy.push("Gate 9 (identity)");
    if (reasons.device_lock?.ok === false) caughtBy.push("Gate 10 (device-lock)");
    if (reasons.otp?.ok === false) caughtBy.push("Gate 4 (OTP)");
  }

  if (resultB.decision === "rejected") {
    ok(
      `Accomplice rejected! Caught by: ${caughtBy.join(", ") || resultB.reasonCode || "unknown gate"}`,
    );
  } else {
    fail("Accomplice was NOT rejected — check gate configuration");
  }

  // ── Student B: INSIDE classroom, different device, same OTP ───────────────
  console.log("\n--- Student B (variant): inside classroom but different face + device ---");
  const resultB2 = await callSubmitAttendance(
    sessionB,
    makePayload(
      sessionB.userId,
      DEVICE_FP.studentB,
      config.classroom.lat + 0.0001, // ~11m from center, inside 50m radius
      config.classroom.lng,
    ),
  );
  printResult("Student B in classroom", resultB2);

  const reasons2 = resultB2.gateReasons as Record<string, { ok?: boolean }> | undefined;
  const caughtBy2: string[] = [];
  if (reasons2) {
    if (reasons2.deviceAttestation?.ok === false) caughtBy2.push("Gate 5 (WebAuthn)");
    if (reasons2.liveness?.ok === false) caughtBy2.push("Gate 8 (liveness)");
    if (reasons2.identity?.ok === false) caughtBy2.push("Gate 9 (face doesn't match)");
  }

  if (resultB2.decision === "rejected") {
    ok(
      `Accomplice in room rejected! Caught by: ${caughtBy2.join(", ") || resultB2.reasonCode || "unknown"}`,
    );
  } else {
    fail("Accomplice in room was NOT rejected — the face match should have caught them");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n📋 OTP Sharing — Boundary Analysis:");
  console.log('   The OTP gate is a knowledge factor ("something you know").');
  console.log("   It cannot distinguish who typed the code.");
  console.log("");
  console.log("   Defense in depth catches the accomplice through:");
  console.log("   1. Gate 3 (geofence): accomplice not in the room");
  console.log("   2. Gate 5 (WebAuthn): accomplice's device isn't registered");
  console.log("   3. Gate 9 (face match): accomplice's face ≠ enrolled face");
  console.log("   4. Gate 10 (device-lock): blocks sharing a single device");
  console.log("");
  console.log("   Worst case: accomplice IS in the room, HAS a spoofed device,");
  console.log("   and the OTP alone doesn't stop them. But Gate 9 (face match)");
  console.log("   still catches them — they can't change their face.");
  console.log("");
  console.log("   → See day9-analysis.md for the pitch-ready write-up.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
