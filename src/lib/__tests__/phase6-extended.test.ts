import { describe, it, expect, vi } from "vitest";
import { isNativePlatform, getPlatformType, getDeviceSecurityTelemetry } from "../native-bridge";
import { offlineQueue } from "../offline-queue";

describe("Phase 6 Extended Test Suite", () => {
  describe("Component 6.4: Native Bridge Abstraction Layer", () => {
    it("returns false for isNativePlatform in standard test environment", () => {
      expect(isNativePlatform()).toBe(false);
    });

    it("returns 'web' platform type by default in standard browser env", () => {
      expect(getPlatformType()).toBe("web");
    });

    it("returns device telemetry breakdown correctly", async () => {
      const telemetry = await getDeviceSecurityTelemetry();
      expect(telemetry.platform).toBe("web");
      expect(telemetry.isNative).toBe(false);
      expect(typeof telemetry.hardwareSecurityModule).toBe("boolean");
    });

    it("correctly identifies Windows desktop environment as web platform", () => {
      const winUa =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
      const originalUa = navigator.userAgent;
      Object.defineProperty(navigator, "userAgent", { value: winUa, configurable: true });

      expect(getPlatformType()).toBe("web");
      expect(isNativePlatform()).toBe(false);

      Object.defineProperty(navigator, "userAgent", { value: originalUa, configurable: true });
    });
  });

  describe("Component 6.7: Offline Leave Request Conflict Resolution", () => {
    it("enqueues and flushes offline leave request cleanly when no conflict exists", async () => {
      offlineQueue.enqueueLeaveRequest({
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        requestType: "leave",
        reason: "Medical appointment",
      });

      const mockSubmitFn = vi.fn().mockResolvedValue({ id: "leave_123" });
      const result = await offlineQueue.flushLeaveQueue(mockSubmitFn);

      expect(result.syncedCount).toBe(1);
      expect(result.conflictCount).toBe(0);
      expect(mockSubmitFn).toHaveBeenCalledWith({
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        requestType: "leave",
        reason: "Medical appointment",
      });
    });

    it("detects leave overlap conflict on sync and marks status as conflict", async () => {
      offlineQueue.enqueueLeaveRequest({
        startDate: "2026-09-05",
        endDate: "2026-09-07",
        requestType: "leave",
        reason: "Field trip",
      });

      const mockSubmitFn = vi
        .fn()
        .mockRejectedValue(new Error("Leave request overlaps with existing approved leave"));

      const result = await offlineQueue.flushLeaveQueue(mockSubmitFn);

      expect(result.syncedCount).toBe(0);
      expect(result.conflictCount).toBe(1);

      const queue = offlineQueue.getLeaveQueue();
      const conflictItem = queue.find((q) => q.startDate === "2026-09-05");
      expect(conflictItem?.status).toBe("conflict");
      expect(conflictItem?.conflictReason).toContain("Overlaps with another request");
    });
  });
});
