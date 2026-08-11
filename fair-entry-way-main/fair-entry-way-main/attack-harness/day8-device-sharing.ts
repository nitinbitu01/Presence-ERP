/**
 * day8-device-sharing.ts — Attack 6: One Device, Multiple Students (Gates 10 + 11)
 *
 * Run: bun attack-harness/day8-device-sharing.ts
 *
 * What this tests:
 *   A single device (same browser fingerprint) is used to check in 3 different students.
 *   Gate 10 (unique index) blocks the 2nd student on the SAME session.
 *   Gate 11 (24h rolling window) flags when ≥3 distinct students use the same device.
 *
 * Pass criteria:
 *   Step 1: Student A checks in → accepted (or rejected at a later gate, but NOT device-lock)
 *   Step 2: Student B same device same session → rejected "device_already_used"
 *   Step 3: Student C same device same session → rejected "device_already_used"
 *   Step 4: multi_student_flag event logged with distinctStudentsOnDevice: 3
 *   Step 5: ALERT_WEBHOOK_URL fires a Discord/Slack notification (verify visually)
 *
 * Pre-requisites:
 *   - ALERT_WEBHOOK_URL must be set in .env (Discord/Slack webhook)
 *   - Create a test session that is currently open
 *   - All 3 students must be seeded (run 00-seed-test-students.ts)
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
  banner("Day 8 — Attack 6: Device Sharing (Gates 10 + 11)");

  // Same device fingerprint for all 3 students
  const SHARED_DEVICE = DEVICE_FP.shared;

  const students = [config.testStudents[0], config.testStudents[1], config.testStudents[2]];

  const sessions: Array<{
    session: Awaited<ReturnType<typeof signIn>>;
    student: (typeof students)[0];
  }> = [];

  for (const student of students) {
    info(`Authenticating ${student.email}...`);
    const session = await signIn(student.email, student.password);
    sessions.push({ session, student });
  }

  function makePayload(userId: string) {
    return {
      sessionId: config.testSessionId,
      probeEmbedding: randomEmbedding(128),
      clientLat: config.classroom.lat,
      clientLng: config.classroom.lng,
      clientAccuracy: 10,
      deviceFingerprint: SHARED_DEVICE, // ← same device for all
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
    };
  }

  // ── Step 1: Student A checks in ──────────────────────────────────────────
  console.log("\n--- Step 1: Student A checks in with Device X ---");
  const resultA = await callSubmitAttendance(
    sessions[0].session,
    makePayload(sessions[0].session.userId),
  );
  printResult("Student A", resultA);
  // Student A may be rejected at another gate (HMAC, WebAuthn, etc.) but NOT device-lock
  const deviceGateA = resultA.gateReasons?.device_lock as { ok?: boolean } | undefined;
  if (!deviceGateA || deviceGateA.ok !== false) {
    ok("Student A: NOT blocked by device-lock gate (first use of this device) ✓");
  } else {
    fail("Student A: blocked by device-lock — unexpected for first use");
  }

  // ── Step 2: Student B, same device, same session ─────────────────────────
  console.log("\n--- Step 2: Student B checks in with SAME Device X, same session ---");
  const resultB = await callSubmitAttendance(
    sessions[1].session,
    makePayload(sessions[1].session.userId),
  );
  printResult("Student B (same device)", resultB);

  // If WebAuthn fires first, that's fine — it means Gate 5 blocked before Gate 10.
  // But if it gets past Gate 5, the unique index should fire.
  if (resultB.reasonCode?.includes("attestation")) {
    info("Gate 5 (WebAuthn) blocked before device-lock — expected when policy=mandatory");
    info("To test device-lock in isolation: set WEBAUTHN_POLICY=optional temporarily");
  } else {
    assertGate("Student B — device already used in this session", resultB, {
      expectedDecision: "rejected",
      expectedReasonCode: "device_already_used",
      expectedFailedGate: "device_lock",
    });
  }

  // ── Step 3: Student C, same device, same session ─────────────────────────
  console.log("\n--- Step 3: Student C checks in with SAME Device X, same session ---");
  const resultC = await callSubmitAttendance(
    sessions[2].session,
    makePayload(sessions[2].session.userId),
  );
  printResult("Student C (same device)", resultC);

  if (resultC.reasonCode?.includes("attestation")) {
    info("Gate 5 (WebAuthn) blocked before device-lock — expected when policy=mandatory");
  } else {
    assertGate("Student C — device already used in this session", resultC, {
      expectedDecision: "rejected",
      expectedReasonCode: "device_already_used",
      expectedFailedGate: "device_lock",
    });
  }

  // ── Step 4: Check for multi_student_flag ──────────────────────────────────
  console.log("\n--- Step 4: Check multi_student_flag in attendance_events ---");
  info("The multi_student_flag fires asynchronously (fire-and-forget).");
  info("Check your admin dashboard → attendance_events for:");
  info(`  event_type = "multi_student_flag"`);
  info(`  reason_code = "device_shared_across_3_students"`);
  info(`  gate_reasons.multi_student.distinctStudentsOnDevice = 3`);

  // ── Step 5: Webhook alert ─────────────────────────────────────────────────
  console.log("\n--- Step 5: Verify Discord/Slack alert ---");
  if (process.env.ALERT_WEBHOOK_URL) {
    ok(`ALERT_WEBHOOK_URL is set: ${process.env.ALERT_WEBHOOK_URL.slice(0, 40)}...`);
    info("Check your Discord/Slack channel for:");
    info('  🚨 "3 distinct students checked in from one device in 24h"');
    info("  (This fires from alertMultiStudentFlag in alerting.server.ts)");
  } else {
    fail("ALERT_WEBHOOK_URL is NOT set — no live alert will fire");
    info("Set it: Discord → Server Settings → Integrations → Webhooks → New Webhook → Copy URL");
    info("Then: export ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...");
  }

  console.log("\n📋 For the demo:");
  console.log("   1. Show two browser windows: attack script terminal + admin audit feed");
  console.log("   2. Run this script live → 3 students on 1 device");
  console.log("   3. Show the multi_student_flag event appear in the admin feed");
  console.log("   4. Show the Discord/Slack notification pop up in real-time");
  console.log("   → Great visual: the system catches AND alerts on device sharing");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
