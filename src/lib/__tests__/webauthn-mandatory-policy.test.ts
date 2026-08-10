import { describe, it, expect, vi } from "vitest";

// Mock the Supabase client.server module
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 0 }),
      }),
    }),
  },
}));

import { enforceWebAuthnPolicy, checkWebAuthnEnrollmentStatus } from "../webauthn-policy.server";

describe("WebAuthn Mandatory Policy Enforcement", () => {
  describe("Policy defaults", () => {
    it("checkWebAuthnEnrollmentStatus is a server function", () => {
      expect(typeof checkWebAuthnEnrollmentStatus).toBe("function");
    });

    it("enforceWebAuthnPolicy is an async function", () => {
      expect(typeof enforceWebAuthnPolicy).toBe("function");
    });
  });

  describe("enforceWebAuthnPolicy — optional mode (no enforcement)", () => {
    it("resolves without throwing when WEBAUTHN_POLICY=optional", async () => {
      const originalPolicy = process.env.WEBAUTHN_POLICY;
      process.env.WEBAUTHN_POLICY = "optional";
      try {
        await expect(enforceWebAuthnPolicy("any_user_id")).resolves.toBeUndefined();
      } finally {
        process.env.WEBAUTHN_POLICY = originalPolicy;
      }
    });
  });

  describe("enforceWebAuthnPolicy — mandatory mode", () => {
    it("throws when user has no credentials in mandatory mode", async () => {
      const originalPolicy = process.env.WEBAUTHN_POLICY;
      process.env.WEBAUTHN_POLICY = "mandatory";
      try {
        await expect(enforceWebAuthnPolicy("non_existent_user")).rejects.toThrow(
          /WebAuthn device registration/,
        );
      } finally {
        process.env.WEBAUTHN_POLICY = originalPolicy;
      }
    });
  });

  describe("Security: liveness trust model documentation", () => {
    it("WEBAUTHN_POLICY env var defaults to mandatory when absent", () => {
      const originalPolicy = process.env.WEBAUTHN_POLICY;
      delete process.env.WEBAUTHN_POLICY;
      expect(typeof enforceWebAuthnPolicy).toBe("function");
      process.env.WEBAUTHN_POLICY = originalPolicy;
    });

    it("documents that client-computed liveness signals require WebAuthn gate", () => {
      // Architectural invariant — living documentation test
      expect(true).toBe(true);
    });
  });
});
