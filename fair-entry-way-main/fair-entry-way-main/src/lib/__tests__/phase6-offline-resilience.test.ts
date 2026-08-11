import { describe, it, expect, beforeEach } from "vitest";
import { offlineQueue, computeBackoffMs } from "../offline-queue";

describe("Phase 6 Offline Resilience", () => {
  beforeEach(() => {
    offlineQueue.clearQueue();
  });

  describe("computeBackoffMs", () => {
    it("returns 1000ms for first retry (retryCount=0)", () => {
      expect(computeBackoffMs(0)).toBe(1000);
    });
    it("returns 2000ms for second retry (retryCount=1)", () => {
      expect(computeBackoffMs(1)).toBe(2000);
    });
    it("returns 4000ms for third retry (retryCount=2)", () => {
      expect(computeBackoffMs(2)).toBe(4000);
    });
    it("caps at 32000ms for high retry counts", () => {
      expect(computeBackoffMs(10)).toBe(32000);
    });
  });

  describe("getSyncStatus", () => {
    it("returns zero status when queue is empty", () => {
      const status = offlineQueue.getSyncStatus();
      expect(status.pending).toBe(0);
      expect(status.synced).toBe(0);
      expect(status.failed).toBe(0);
      expect(status.totalItems).toBe(0);
    });

    it("reports pending correctly after enqueue", () => {
      offlineQueue.enqueue({ sessionId: "sess_1", livenessVerified: true });
      const status = offlineQueue.getSyncStatus();
      expect(status.pending).toBe(1);
      expect(status.totalItems).toBe(1);
    });
  });

  describe("flushQueue with exponential backoff", () => {
    it("increments retryCount on failure", async () => {
      offlineQueue.enqueue({ sessionId: "sess_fail", livenessVerified: true });
      const failFn = async () => {
        throw new Error("Network error");
      };
      const result = await offlineQueue.flushQueue(failFn);
      expect(result.errorsCount).toBe(1);
      expect(result.syncedCount).toBe(0);
      const queue = offlineQueue.getQueue();
      expect(queue[0]?.retryCount).toBe(1);
    });

    it("syncs successfully and marks as synced", async () => {
      offlineQueue.enqueue({ sessionId: "sess_ok", livenessVerified: true });
      const result = await offlineQueue.flushQueue(async () => ({ success: true }));
      expect(result.syncedCount).toBe(1);
    });
  });

  describe("getQueueAgeMs", () => {
    it("returns null when queue is empty", () => {
      expect(offlineQueue.getQueueAgeMs()).toBeNull();
    });

    it("returns positive ms when there are pending items", () => {
      offlineQueue.enqueue({ sessionId: "sess_age", livenessVerified: false });
      const age = offlineQueue.getQueueAgeMs();
      expect(age).not.toBeNull();
      expect(age!).toBeGreaterThanOrEqual(0);
    });
  });
});
