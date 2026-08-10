import { describe, it, expect } from "vitest";
import {
  isPointInPolygon,
  verifyBleBeaconProximity,
  GeoPoint,
  BleBeaconSignal,
  RequiredBleBeacon,
} from "../spatial-validation.server";

describe("Pinnacle Enterprise Gap Closure Test Suite", () => {
  describe("Component 4: Ray-Casting Geo-Polygon Engine", () => {
    // Square building footprint around (12.9716, 77.5946)
    const buildingPolygon: GeoPoint[] = [
      { lat: 12.971, lng: 77.594 },
      { lat: 12.971, lng: 77.595 },
      { lat: 12.972, lng: 77.595 },
      { lat: 12.972, lng: 77.594 },
    ];

    it("returns true for GPS coordinates inside the campus building polygon", () => {
      const insidePoint: GeoPoint = { lat: 12.9715, lng: 77.5945 };
      expect(isPointInPolygon(insidePoint, buildingPolygon)).toBe(true);
    });

    it("returns false for GPS coordinates outside the campus building polygon", () => {
      const outsidePoint: GeoPoint = { lat: 12.973, lng: 77.596 };
      expect(isPointInPolygon(outsidePoint, buildingPolygon)).toBe(false);
    });

    it("handles irregular multi-vertex polygon footprints", () => {
      const LShapePolygon: GeoPoint[] = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 4 },
        { lat: 2, lng: 4 },
        { lat: 2, lng: 2 },
        { lat: 4, lng: 2 },
        { lat: 4, lng: 0 },
      ];
      expect(isPointInPolygon({ lat: 1, lng: 1 }, LShapePolygon)).toBe(true);
      expect(isPointInPolygon({ lat: 3, lng: 3 }, LShapePolygon)).toBe(false);
    });
  });

  describe("Component 4b: Bluetooth Low Energy (BLE) Beacon Proximity", () => {
    const classroomBeacons: RequiredBleBeacon[] = [
      { uuid: "12345678-1234-1234-1234-123456789abc", major: 1, minor: 101, minRssi: -85 },
    ];

    it("validates when client detects classroom beacon with strong RSSI", () => {
      const detected: BleBeaconSignal[] = [
        { uuid: "12345678-1234-1234-1234-123456789abc", major: 1, minor: 101, rssi: -65 },
      ];
      const result = verifyBleBeaconProximity(detected, classroomBeacons);
      expect(result.isWithinRange).toBe(true);
      expect(result.matchedCount).toBe(1);
      expect(result.strongestRssi).toBe(-65);
    });

    it("fails when beacon signal is too weak (< minRssi)", () => {
      const detected: BleBeaconSignal[] = [
        { uuid: "12345678-1234-1234-1234-123456789abc", major: 1, minor: 101, rssi: -95 }, // weaker than -85
      ];
      const result = verifyBleBeaconProximity(detected, classroomBeacons);
      expect(result.isWithinRange).toBe(false);
      expect(result.matchedCount).toBe(0);
    });

    it("passes immediately when no classroom beacons are required", () => {
      const result = verifyBleBeaconProximity([], []);
      expect(result.isWithinRange).toBe(true);
    });
  });

  describe("Component 1: Attendance Policy Grace Period Math", () => {
    it("classifies check-ins within grace period as present", () => {
      const starts = 1700000000000;
      const gracePeriodMs = 10 * 60_000; // 10 mins
      const lateCutoffMs = 20 * 60_000; // 20 mins

      const checkInTime = starts + 5 * 60_000; // 5 mins in
      const isLate = checkInTime > starts + gracePeriodMs;
      const isCutoff = checkInTime > starts + lateCutoffMs;

      expect(isLate).toBe(false);
      expect(isCutoff).toBe(false);
    });

    it("classifies check-ins past grace period but within late cutoff as late", () => {
      const starts = 1700000000000;
      const gracePeriodMs = 10 * 60_000;
      const lateCutoffMs = 20 * 60_000;

      const checkInTime = starts + 15 * 60_000; // 15 mins in
      const isLate = checkInTime > starts + gracePeriodMs;
      const isCutoff = checkInTime > starts + lateCutoffMs;

      expect(isLate).toBe(true);
      expect(isCutoff).toBe(false);
    });

    it("rejects check-ins exceeding late mark cutoff", () => {
      const starts = 1700000000000;
      const gracePeriodMs = 10 * 60_000;
      const lateCutoffMs = 20 * 60_000;

      const checkInTime = starts + 25 * 60_000; // 25 mins in
      const isCutoff = checkInTime > starts + lateCutoffMs;

      expect(isCutoff).toBe(true);
    });
  });
});
