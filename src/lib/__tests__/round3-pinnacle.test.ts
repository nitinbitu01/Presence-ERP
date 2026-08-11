import { describe, it, expect, beforeEach } from "vitest";
import { generateActionToken, verifyActionToken } from "../email-action-link.server";
import { offlineQueue } from "../offline-queue";

describe("Round 3 Pinnacle Features Suite", () => {
  describe("3.13 1-Click Email Action Link Token Engine", () => {
    it("generates signed HMAC token and successfully verifies valid token", () => {
      const token = generateActionToken("req_101", "approved", "user_approver_1");
      expect(token).toBeDefined();

      const verified = verifyActionToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.requestId).toBe("req_101");
      expect(verified?.action).toBe("approved");
      expect(verified?.approverId).toBe("user_approver_1");
    });

    it("rejects tampered or malformed action link tokens", () => {
      const token = generateActionToken("req_102", "rejected", "user_approver_1");
      const tampered = token.slice(0, -4) + "XXXX";
      expect(verifyActionToken(tampered)).toBeNull();
    });
  });

  describe("3.15 Offline-Capable PWA Attendance Queue", () => {
    beforeEach(() => {
      offlineQueue.clearQueue();
    });

    it("enqueues offline check-in items and retrieves queue correctly", () => {
      expect(offlineQueue.getQueue()).toEqual([]);
      offlineQueue.enqueue({ sessionId: "sess_1", livenessVerified: true });
      offlineQueue.enqueue({ sessionId: "sess_2", livenessVerified: true });

      const queue = offlineQueue.getQueue();
      expect(queue.length).toBe(2);
      expect(queue[0].sessionId).toBe("sess_1");
      expect(queue[1].sessionId).toBe("sess_2");
    });

    it("flushes offline queue upon network reconnection", async () => {
      offlineQueue.enqueue({ sessionId: "sess_1", livenessVerified: true });

      const mockSubmit = async (id: string) => {
        expect(id).toBe("sess_1");
        return { success: true };
      };

      const result = await offlineQueue.flushQueue(mockSubmit);
      expect(result.syncedCount).toBe(1);
      expect(result.errorsCount).toBe(0);
      // Upgraded queue marks items as 'synced' (audit trail) instead of deleting
      const queue = offlineQueue.getQueue();
      const pendingItems = queue.filter((item) => item.status === "pending");
      expect(pendingItems.length).toBe(0);
    });
  });
});
