import { describe, it, expect, vi } from "vitest";

// Mock the Supabase client.server module so tests don't need real DB credentials
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: null }),
              }),
            }),
          }),
          neq: () => Promise.resolve({ data: [] }),
        }),
        order: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve({ data: null }),
          }),
        }),
      }),
    }),
  },
}));

import { detectImpossibleTravel, detectDescriptorReuse } from "../liveness-sdk.server";

describe("Phase 5 Fraud Detection", () => {
  describe("detectImpossibleTravel", () => {
    it("is an async function", () => {
      expect(typeof detectImpossibleTravel).toBe("function");
    });

    it("returns safe result when no previous records exist", async () => {
      const result = await detectImpossibleTravel("user_test_123", 28.6139, 77.209);
      expect(result).toHaveProperty("isSuspicious");
      expect(result).toHaveProperty("distanceKm");
      expect(result).toHaveProperty("timeDeltaMinutes");
      // No previous record → not suspicious
      expect(result.isSuspicious).toBe(false);
      expect(result.distanceKm).toBe(0);
    });
  });

  describe("detectDescriptorReuse", () => {
    it("is an async function", () => {
      expect(typeof detectDescriptorReuse).toBe("function");
    });

    it("returns non-duplicate when no session records exist", async () => {
      const mockDescriptor = Array.from({ length: 128 }, () => Math.random() * 2 - 1);
      const result = await detectDescriptorReuse(mockDescriptor, "session_test", "student_test");
      expect(result).toHaveProperty("isDuplicate");
      expect(typeof result.isDuplicate).toBe("boolean");
      expect(result.isDuplicate).toBe(false);
    });
  });
});
