import { describe, it, expect } from "vitest";
import { fetchSystemStatus } from "../incident-response.server";

describe("Operations & Reliability Suite", () => {
  describe("getSystemStatus", () => {
    it("reports operational status across all 5 core ERP subsystems", async () => {
      const result = await fetchSystemStatus();

      expect(result.overall).toBe("operational");
      expect(result.subsystems).toHaveLength(5);
      expect(result.activeIncidentsCount).toBe(0);

      const names = result.subsystems.map((s) => s.name);
      expect(names).toContain("Database & Ledger");
      expect(names).toContain("Auth & SSO Engine");
      expect(names).toContain("Biometric Liveness SDK");
      expect(names).toContain("WebAuthn Hardware Gate");
      expect(names).toContain("Encrypted Storage (AES-256)");
    });
  });
});
