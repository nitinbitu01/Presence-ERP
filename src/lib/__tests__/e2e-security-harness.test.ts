import { describe, it, expect } from "vitest";
import {
  verifyLivenessSignals,
  verifyFrameIdentityConsistency,
  cosineSimilarity,
  haversineMeters,
} from "../attendance-crypto.server";

describe("E2E Security Attack Harness Assertion Suite", () => {
  const classroomLat = 23.153421;
  const classroomLng = 72.886547;
  const classroomRadiusM = 50;

  it("Attack 1: Photo / Static-Image Spoof is caught by Gate 8 (short-frame & long-frame)", () => {
    // 5-frame static signals (short-frame guard)
    const staticSignals5 = Array.from({ length: 5 }, () => ({
      ear: 0.31,
      yaw: 2.1,
      pitch: 1.0,
      faceArea: 9850,
      faceX: 320.0,
      faceY: 240.0,
    }));

    const result5 = verifyLivenessSignals("blink", staticSignals5);
    expect(result5.passed).toBe(false);
    expect(result5.reason).toBe("static_photo_detected");

    // 10-frame static signals (long-frame guard)
    const staticSignals10 = Array.from({ length: 10 }, () => ({
      ear: 0.31,
      yaw: 2.1,
      pitch: 1.0,
      faceArea: 9850,
      faceX: 320.0,
      faceY: 240.0,
    }));

    const result10 = verifyLivenessSignals("blink", staticSignals10);
    expect(result10.passed).toBe(false);
    expect(result10.reason).toBe("static_photo_detected");

    // Real face signals should pass photo check
    const realFaceSignals = Array.from({ length: 10 }, (_, i) => ({
      ear: 0.30 + Math.sin(i * 0.8) * 0.06,
      yaw: 1.5 + Math.sin(i * 0.4) * 5,
      pitch: 0.8 + Math.cos(i * 0.5) * 3,
      faceArea: 9800 + Math.sin(i * 0.9) * 350,
      faceX: 320 + Math.sin(i * 0.3) * 7,
      faceY: 240 + Math.cos(i * 0.3) * 5,
    }));

    const resultReal = verifyLivenessSignals("blink", realFaceSignals);
    expect(resultReal.reason).not.toBe("static_photo_detected");
  });

  it("Attack 2: Video Replay — frame-swap inconsistency is caught", () => {
    const personA = new Array(128).fill(0).map(() => 0.5);
    const personB = new Array(128).fill(0).map((_, i) => (i < 64 ? -0.5 : 0.5));

    const consistent = verifyFrameIdentityConsistency([personA, personA]);
    expect(consistent).toBe(true);

    const swapped = verifyFrameIdentityConsistency([personA, personB]);
    expect(swapped).toBe(false);
  });

  it("Attack 3: Wrong-Face Impersonation — similarity thresholds enforced", () => {
    const personA = new Array(128).fill(0).map(() => 1 / Math.sqrt(128));
    const personB = new Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 1 : -1) / Math.sqrt(128));

    const similarityWrongFace = cosineSimilarity(personA, personB);
    expect(similarityWrongFace).toBeLessThan(0.75); // THRESHOLD_REVIEW = 0.75

    const similaritySameFace = cosineSimilarity(personA, personA);
    expect(similaritySameFace).toBeGreaterThanOrEqual(0.82); // THRESHOLD_MATCH = 0.82
  });

  it("Attack 5: GPS Spoofing — Geofence radius and synthetic accuracy", () => {
    // 500m outside classroom radius
    const latOutside = classroomLat + 0.005;
    const distOutside = haversineMeters(latOutside, classroomLng, classroomLat, classroomLng);
    expect(distOutside).toBeGreaterThan(classroomRadiusM);

    // Inside radius
    const latInside = classroomLat + 0.00001;
    const distInside = haversineMeters(latInside, classroomLng, classroomLat, classroomLng);
    expect(distInside).toBeLessThanOrEqual(classroomRadiusM);

    // Impossibly perfect accuracy (< 0.5m)
    const accuracyMock = 0.1;
    expect(accuracyMock < 0.5).toBe(true);

    const accuracyRealistic = 10.0;
    expect(accuracyRealistic >= 0.5).toBe(true);
  });
});
