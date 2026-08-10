/**
 * day7-gps-spoof.ts — Attack 5: GPS Spoofing / Outside Geofence (Gate 3)
 *
 * Run: bun attack-harness/day7-gps-spoof.ts
 *
 * What this tests:
 *   1. Location outside the classroom radius → "outside_geofence"
 *   2. Location inside but with impossibly perfect GPS accuracy → "mock_location_detected"
 *   3. Control: inside radius with realistic accuracy → should PASS Gate 3
 *
 * Real classroom coordinates (Q2 confirmed):
 *   lat: 23.153421, lng: 72.886547, radius: 50m (Ahmedabad campus)
 *
 * How this maps to the real attack:
 *   Chrome DevTools → Sensors → Geolocation → Override with custom coordinates
 *   Android: mock location apps set GPS to arbitrary coordinates
 *   iOS: Xcode GPS simulation
 *
 * The GPS accuracy check catches the most common spoofing tools, which report
 * impossibly precise readings (0.0m or 0.1m) because they hard-code the value
 * instead of letting the real GPS hardware report its uncertainty.
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
  makeBlinkSignals,
} from "./attack.config.ts";

async function main() {
  banner("Day 7 — Attack 5: GPS Spoofing / Outside Geofence");

  const student = config.testStudents[2];
  info(`Authenticating as ${student.email}...`);
  const session = await signIn(student.email, student.password);
  info(`Signed in: userId=${session.userId}`);

  const baseChallenge = {
    action: "blink",
    sessionId: config.testSessionId,
    userId: session.userId,
    issuedAt: Date.now() - 2000,
    ttlMs: 60_000,
    sig: "attack-harness-fake-hmac-sig",
  };

  const base = {
    sessionId: config.testSessionId,
    probeEmbedding: randomEmbedding(128),
    deviceFingerprint: DEVICE_FP.studentC,
    livenessChallenge: baseChallenge,
    livenessSignals: makeBlinkSignals(10),
    frameEmbeddings: [randomEmbedding(128), randomEmbedding(128)],
  };

  // ── Payload A: Outside the geofence (500m away) ──────────────────────────
  console.log("\n--- Payload A: 500m outside classroom radius ---");
  // 0.005 degrees latitude ≈ 555m at this latitude
  const resultA = await callSubmitAttendance(session, {
    ...base,
    clientLat: config.classroom.lat + 0.005,
    clientLng: config.classroom.lng,
    clientAccuracy: 10,
  });
  printResult("Payload A (outside geofence)", resultA);
  assertGate("Outside geofence (500m away)", resultA, {
    expectedDecision: "rejected",
    expectedReasonCode: "outside_geofence",
  });

  // Show the distance the server calculated
  const spatialA = resultA.gateReasons?.spatial as { distance_m?: number } | undefined;
  if (spatialA?.distance_m) {
    info(`  Server-calculated distance: ${spatialA.distance_m.toFixed(1)}m (radius: ${config.classroom.radiusM}m)`);
  }

  // ── Payload B: Inside radius but impossibly perfect GPS (0.1m accuracy) ──
  console.log("\n--- Payload B: inside radius, GPS accuracy = 0.1m (mock location) ---");
  const resultB = await callSubmitAttendance(session, {
    ...base,
    clientLat: config.classroom.lat + 0.00001, // ~1m offset, well inside 50m
    clientLng: config.classroom.lng,
    clientAccuracy: 0.1, // impossibly precise — real GPS is 3-10m at best
  });
  printResult("Payload B (perfect GPS)", resultB);
  assertGate("Mock location — impossibly perfect accuracy", resultB, {
    expectedDecision: "rejected",
    expectedReasonCode: "mock_location_detected",
  });

  // ── Payload C: Inside radius, perfectly accurate but 0.0m (zero accuracy) ─
  console.log("\n--- Payload C: inside radius, GPS accuracy = 0.0m (extreme mock) ---");
  const resultC = await callSubmitAttendance(session, {
    ...base,
    clientLat: config.classroom.lat,
    clientLng: config.classroom.lng,
    clientAccuracy: 0.0,
  });
  printResult("Payload C (zero accuracy)", resultC);
  assertGate("Mock location — zero accuracy", resultC, {
    expectedDecision: "rejected",
    expectedReasonCode: "mock_location_detected",
  });

  // ── Control: Inside radius with realistic accuracy ────────────────────────
  console.log("\n--- Control: inside radius, GPS accuracy = 15m (realistic) ---");
  const resultD = await callSubmitAttendance(session, {
    ...base,
    clientLat: config.classroom.lat + 0.0001, // ~11m offset
    clientLng: config.classroom.lng + 0.0001,
    clientAccuracy: 15, // realistic for indoor GPS
  });
  printResult("Control (valid location)", resultD);

  // Control should NOT fail at the spatial gate — it should fail at a later gate
  const spatialGate = resultD.gateReasons?.spatial as { ok?: boolean } | undefined;
  if (spatialGate?.ok !== false) {
    console.log("  \x1b[32m✓\x1b[0m Legitimate location passed Gate 3 — no false-reject");
  } else {
    console.log("  \x1b[31m✗\x1b[0m Legitimate location rejected at Gate 3 — radius too tight?");
  }

  // Show the distance for the control payload
  const spatialD = resultD.gateReasons?.spatial as { distance_m?: number } | undefined;
  if (spatialD?.distance_m) {
    info(`  Control distance: ${spatialD.distance_m.toFixed(1)}m (radius: ${config.classroom.radiusM}m)`);
  }

  console.log("\n📋 For the demo:");
  console.log(`   Classroom: ${config.classroom.lat}, ${config.classroom.lng}`);
  console.log(`   Radius:    ${config.classroom.radiusM}m`);
  console.log("   Show Chrome DevTools → Sensors → set fake GPS → check-in rejected");
  console.log("   The accuracy check catches spoofing apps that report 0.0m precision");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
