/**
 * day3-photo-spoof.ts — Attack 1: Printed Photo / Static Image Spoof (Gate 8)
 *
 * Run: bun attack-harness/day3-photo-spoof.ts
 *
 * What this tests:
 *   A photo held to the camera produces unnaturally static liveness signals across
 *   all frames. The hardened verifyLivenessSignals check should catch this before
 *   Gate 9 (identity) is even reached.
 *
 * Two payloads:
 *   A) 5-frame static photo signals  → triggers the NEW short-frame guard (3–7 frames)
 *   B) 10-frame static photo signals → triggers the original long-frame guard (8+)
 *
 * Expected gate_reasons.liveness.reason: "static_photo_detected"
 * Expected reason_code in ledger:         "liveness_static_photo_detected"
 *
 * If this FAILS (gate not triggered):
 *   Your photo variance thresholds are still too loose. Check attendance-crypto.server.ts
 *   verifyLivenessSignals and tighten xVar/yVar/areaVar thresholds further. Then re-test
 *   with a REAL physical photo to find the sweet spot (false-rejects on real faces are
 *   just as bad as false-accepts of photos).
 */

import {
  signIn,
  callSubmitAttendance,
  assertGate,
  printResult,
  banner,
  info,
} from "./attack-runner.ts";
import { config, DEVICE_FP, randomEmbedding } from "./attack.config.ts";

/** Perfectly static signals — a photo on a tripod. No variance at all. */
function staticPhotoSignals(frameCount: number) {
  return Array.from({ length: frameCount }, () => ({
    ear: 0.31, // fixed EAR, no blink
    yaw: 2.1, // fixed head angle
    pitch: 1.0,
    faceArea: 9850, // fixed face size — no breathing-induced movement
    faceX: 320.0,
    faceY: 240.0,
  }));
}

/** Slightly noisier static signals — a photo held by hand (a bit of wobble but still static) */
function handHeldPhotoSignals(frameCount: number) {
  return Array.from({ length: frameCount }, (_, i) => ({
    ear: 0.31 + (i % 2 === 0 ? 0.001 : 0), // barely perceptible noise
    yaw: 2.1 + (i % 3 === 0 ? 0.005 : 0),
    pitch: 1.0,
    faceArea: 9850 + (i % 4 === 0 ? 0.05 : 0), // areaVar ≈ 0.001 — well below 0.1
    faceX: 320.0 + (i % 2 === 0 ? 0.01 : 0),
    faceY: 240.0,
  }));
}

async function main() {
  banner("Day 3 — Attack 1: Photo / Static-Image Spoof");

  const student = config.testStudents[0];
  info(`Authenticating as ${student.email}...`);
  const session = await signIn(student.email, student.password);
  info(`Signed in: userId=${session.userId}`);

  const baseChallenge = {
    action: "blink",
    sessionId: config.testSessionId,
    userId: session.userId,
    issuedAt: Date.now() - 2000, // 2s ago (valid, not expired)
    ttlMs: 60_000,
    sig: "attack-harness-fake-hmac-sig", // invalid sig → Gate 3 will catch this first
    // To test ONLY Gate 8: pre-fetch a real challenge from requestLivenessChallenge
    // and paste its sig here. See day6-scripted-api.ts for how to do this.
  };

  const basePayload = {
    sessionId: config.testSessionId,
    probeEmbedding: randomEmbedding(128),
    clientLat: config.classroom.lat,
    clientLng: config.classroom.lng,
    clientAccuracy: 12,
    deviceFingerprint: DEVICE_FP.studentA,
    livenessChallenge: baseChallenge,
    // No webauthnAssertion → will be caught by Gate 5 (device_attestation_missing)
    // if WEBAUTHN_POLICY=mandatory. That's expected — it means WebAuthn is mandatory.
    // To test ONLY Gate 8, add a valid webauthnAssertion or set policy=optional in test env.
  };

  console.log("\n--- Payload A: 5-frame static photo (short-frame guard) ---");
  const resultA = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: staticPhotoSignals(5),
    frameEmbeddings: [randomEmbedding(128), randomEmbedding(128)],
  });
  printResult("Payload A", resultA);
  const passA = assertGate("Short-frame photo spoof (5 frames)", resultA, {
    // With WebAuthn mandatory: Gate 5 fires first.
    // Without WebAuthn / with exemption: Gate 8 fires.
    expectedReasonCode: resultA.reasonCode?.includes("attestation")
      ? "device_attestation_missing"
      : "liveness_static_photo_detected",
    expectedDecision: "rejected",
  });

  console.log("\n--- Payload B: 10-frame static photo (long-frame guard, tightened threshold) ---");
  const resultB = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: staticPhotoSignals(10),
    frameEmbeddings: [randomEmbedding(128), randomEmbedding(128)],
  });
  printResult("Payload B", resultB);
  const passB = assertGate("Long-frame photo spoof (10 frames)", resultB, {
    expectedReasonCode: resultB.reasonCode?.includes("attestation")
      ? "device_attestation_missing"
      : "liveness_static_photo_detected",
    expectedDecision: "rejected",
  });

  console.log("\n--- Payload C: 10-frame hand-held photo (noisy but still static) ---");
  const resultC = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: handHeldPhotoSignals(10),
    frameEmbeddings: [randomEmbedding(128), randomEmbedding(128)],
  });
  printResult("Payload C", resultC);
  const passC = assertGate("Hand-held photo spoof (low areaVar)", resultC, {
    expectedReasonCode: resultC.reasonCode?.includes("attestation")
      ? "device_attestation_missing"
      : "liveness_static_photo_detected",
    expectedDecision: "rejected",
  });

  console.log(
    "\n--- Control: 10-frame real face signals (should NOT be rejected by photo check) ---",
  );
  // This validates false-reject safety: a real student with natural movement must pass Gate 8.
  const realFaceSignals = Array.from({ length: 10 }, (_, i) => ({
    ear: 0.3 + Math.sin(i * 0.8) * 0.06, // natural EAR variation (breathing affects eye openness)
    yaw: 1.5 + Math.sin(i * 0.4) * 5, // natural head sway
    pitch: 0.8 + Math.cos(i * 0.5) * 3,
    faceArea: 9800 + Math.sin(i * 0.9) * 350, // breathing-scale area variance (~120k)
    faceX: 320 + Math.sin(i * 0.3) * 7, // xVar ≈ 25
    faceY: 240 + Math.cos(i * 0.3) * 5, // yVar ≈ 12.5
  }));
  const resultControl = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: realFaceSignals,
    frameEmbeddings: [randomEmbedding(128), randomEmbedding(128)],
  });
  printResult("Control (real face)", resultControl);
  // Control should fail at a LATER gate (HMAC sig invalid, identity, etc.) — NOT at photo spoof
  const photoGate = resultControl.gateReasons?.liveness as { reason?: string } | undefined;
  if (!photoGate?.reason?.includes("static_photo")) {
    console.log(`  ${"\x1b[32m"}✓\x1b[0m Real face NOT rejected as photo — false-reject guard OK`);
  } else {
    console.log(
      `  ${"\x1b[31m"}✗\x1b[0m Real face rejected as static photo — thresholds too tight, loosen them`,
    );
  }

  console.log("\n");
  const total = [passA, passB, passC].filter(Boolean).length;
  console.log(`Day 3 result: ${total}/3 attack payloads correctly blocked`);
  if (total < 3) {
    console.log(
      "→ Tighten verifyLivenessSignals thresholds in attendance-crypto.server.ts and re-run",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
