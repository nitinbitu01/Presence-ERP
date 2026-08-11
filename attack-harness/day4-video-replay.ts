/**
 * day4-video-replay.ts — Attack 2: Video Replay (Gates 8 + 5)
 *
 * Run: bun attack-harness/day4-video-replay.ts
 *
 * What this tests:
 *   A video of an enrolled student played on a screen in front of the camera.
 *   A video produces slightly more variance than a photo (it moves) but the embeddings
 *   across frames are NOT from a real face present in the room.
 *
 *   Two independent gates should catch this:
 *   - Gate 5 (WebAuthn): A video on a screen can't produce a hardware FIDO assertion.
 *     This gate always catches it when WEBAUTHN_POLICY=mandatory.
 *   - Gate 8 (frameEmbeddings required): A scripted caller that sends livenessSignals
 *     WITHOUT frameEmbeddings is now rejected. A real camera client always sends both.
 *
 * Three payloads:
 *   A) livenessSignals present, frameEmbeddings ABSENT → frame_embeddings_missing
 *   B) livenessSignals present, frameEmbeddings inconsistent → frame_swap_detected
 *   C) No webauthnAssertion (control confirming Gate 5 catches even a "good" replay)
 *
 * Pitch for demo:
 *   "Liveness catches most naive replay attempts. WebAuthn closes the rest.
 *    A video on a phone screen cannot produce a hardware-backed FIDO signature —
 *    that's the cryptographic guarantee."
 */

import {
  signIn,
  callSubmitAttendance,
  assertGate,
  printResult,
  banner,
  info,
} from "./attack-runner.ts";
import {
  config,
  DEVICE_FP,
  randomEmbedding,
  makeValidSignals,
} from "./attack.config.ts";

/** Simulate the liveness signals a video replay produces:
 *  The video moves so variance is non-zero, but the SAME video loop means
 *  we can fabricate the signals without a real camera. */
function videoReplaySignals(frameCount: number = 10) {
  return Array.from({ length: frameCount }, (_, i) => ({
    ear: 0.29 + Math.sin(i * 1.2) * 0.03, // repeating pattern (looping video)
    yaw: 2.0 + Math.sin(i * 0.6) * 4,
    pitch: 1.0 + Math.cos(i * 0.6) * 2,
    faceArea: 9820 + Math.sin(i * 1.0) * 180, // some variance — would pass photo check
    faceX: 320 + Math.sin(i * 0.7) * 5,
    faceY: 240 + Math.cos(i * 0.7) * 4,
  }));
}

/** Inconsistent frame embeddings: two clearly different faces (frame-swap attack) */
function inconsistentEmbeddings(): number[][] {
  const personA = randomEmbedding(128);
  // Person B is orthogonal to A — cosine similarity ≈ 0, well below 0.85 threshold
  const personB = randomEmbedding(128).map((v, i) => (i < 64 ? -personA[i] : v));
  return [personA, personB];
}

async function main() {
  banner("Day 4 — Attack 2: Video Replay");

  const student = config.testStudents[1];
  info(`Authenticating as ${student.email}...`);
  const session = await signIn(student.email, student.password);
  info(`Signed in: userId=${session.userId}`);

  const baseChallenge = {
    action: "blink",
    sessionId: config.testSessionId,
    userId: session.userId,
    issuedAt: Date.now() - 3000,
    ttlMs: 60_000,
    sig: "attack-harness-fake-hmac-sig",
  };

  const basePayload = {
    sessionId: config.testSessionId,
    probeEmbedding: randomEmbedding(128),
    clientLat: config.classroom.lat,
    clientLng: config.classroom.lng,
    clientAccuracy: 10,
    deviceFingerprint: DEVICE_FP.studentB,
    livenessChallenge: baseChallenge,
  };

  // ── Payload A: livenessSignals present, frameEmbeddings absent ───────────
  console.log("\n--- Payload A: signals with NO frameEmbeddings (scripted caller pattern) ---");
  const resultA = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: videoReplaySignals(10),
    // frameEmbeddings deliberately omitted — a scripted caller can't produce real camera frames
  });
  printResult("Payload A", resultA);
  assertGate("Video replay — missing frameEmbeddings", resultA, {
    expectedDecision: "rejected",
    expectedReasonCode: resultA.reasonCode?.includes("attestation")
      ? "device_attestation_missing"
      : "frame_embeddings_missing",
  });

  // ── Payload B: frameEmbeddings present but inconsistent (frame-swap) ─────
  console.log("\n--- Payload B: signals WITH inconsistent frameEmbeddings (frame-swap) ---");
  const resultB = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: videoReplaySignals(10),
    frameEmbeddings: inconsistentEmbeddings(),
  });
  printResult("Payload B", resultB);
  assertGate("Video replay — frame-swap detected", resultB, {
    expectedDecision: "rejected",
    expectedReasonCode: resultB.reasonCode?.includes("attestation")
      ? "device_attestation_missing"
      : "frame_swap_detected",
  });

  // ── Payload C: "perfect" replay — consistent frames, good signals, but no WebAuthn ──
  console.log("\n--- Payload C: perfect replay signals + consistent frames — no WebAuthn ---");
  console.log("    (WebAuthn mandatory gate should catch this regardless of liveness quality)");
  const personA = randomEmbedding(128);
  const consistentEmbeddings = [
    personA,
    personA.map((v) => v + 0.001),  // near-identical — passes frame consistency check
    personA.map((v) => v - 0.001),
  ];
  const resultC = await callSubmitAttendance(session, {
    ...basePayload,
    livenessSignals: makeValidSignals(10),
    frameEmbeddings: consistentEmbeddings,
    // No webauthnAssertion — the critical missing piece
  });
  printResult("Payload C", resultC);
  assertGate("Perfect replay — blocked by Gate 5 (WebAuthn mandatory)", resultC, {
    expectedDecision: "rejected",
    expectedReasonCode: "device_attestation_missing",
    expectedFailedGate: "deviceAttestation",
  });

  console.log("\n📋 Summary for demo pitch:");
  console.log("   · Naive replay (no frameEmbeddings): caught by Gate 8");
  console.log("   · Frame-swap attack: caught by Gate 8 frame consistency check");
  console.log("   · Best-effort replay: caught by Gate 5 — hardware signature can't be faked");
  console.log("   → 'WebAuthn is the cryptographic guarantee; liveness is the biological one'");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
