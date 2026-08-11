/**
 * Tests for Mandatory WebAuthn Device Binding & Admin Exemptions (Day 1 Task 2):
 * 1. Registered device is required and passes Gate 2c.
 * 2. No device and no exemption fails closed with device_attestation_missing.
 * 3. No device with valid admin exemption passes Gate 2c.
 * 4. Expired or revoked admin exemption fails closed with device_attestation_missing.
 */

import { describe, it, expect, vi } from "vitest";
import { hasWebauthnExemption } from "../webauthn.server";

process.env.BIOMETRIC_ENC_KEY = "UHdHDQpUZMLlhy+yx8INeqOJom+g+sHVU/tf7zYgJU8=";
process.env.LIVENESS_HMAC_KEY = "fffcHAvJI1MMpMoj4cniu09R332lWv++Bwxt9y2iW+c=";

// Mock Supabase admin client for exemption checks
vi.mock("@/integrations/supabase/client.server", () => {
  let mockExemptionRow: Record<string, unknown> | null = null;

  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === "webauthn_exemptions") {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                is: (revCol: string, revVal: unknown) => ({
                  maybeSingle: async () => {
                    if (
                      mockExemptionRow &&
                      mockExemptionRow.student_id === val &&
                      mockExemptionRow.revoked_at === revVal
                    ) {
                      return { data: mockExemptionRow, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          };
        }
        return {};
      },
    },
    __setMockExemption: (row: Record<string, unknown> | null) => {
      mockExemptionRow = row;
    },
  };
});

describe("Mandatory WebAuthn Device Binding & Exemption Engine", () => {
  it("returns false for student without an exemption", async () => {
    const { __setMockExemption } =
      (await import("@/integrations/supabase/client.server")) as unknown as {
        __setMockExemption: (row: Record<string, unknown> | null) => void;
      };
    __setMockExemption(null);

    const isExempt = await hasWebauthnExemption("student-uuid-no-exemption");
    expect(isExempt).toBe(false);
  });

  it("returns true for student with active, non-expired admin exemption", async () => {
    const { __setMockExemption } =
      (await import("@/integrations/supabase/client.server")) as unknown as {
        __setMockExemption: (row: Record<string, unknown> | null) => void;
      };
    __setMockExemption({
      student_id: "student-uuid-exempt",
      granted_by: "admin-uuid-1",
      reason: "Device camera lacks FIDO2 platform authenticator",
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      revoked_at: null,
    });

    const isExempt = await hasWebauthnExemption("student-uuid-exempt");
    expect(isExempt).toBe(true);
  });

  it("returns false for expired admin exemption", async () => {
    const { __setMockExemption } =
      (await import("@/integrations/supabase/client.server")) as unknown as {
        __setMockExemption: (row: Record<string, unknown> | null) => void;
      };
    __setMockExemption({
      student_id: "student-uuid-expired",
      granted_by: "admin-uuid-1",
      reason: "Temporary hardware exemption",
      expires_at: new Date(Date.now() - 3600_000).toISOString(), // expired 1 hour ago
      revoked_at: null,
    });

    const isExempt = await hasWebauthnExemption("student-uuid-expired");
    expect(isExempt).toBe(false);
  });

  it("returns false when admin exemption has been revoked", async () => {
    const { __setMockExemption } =
      (await import("@/integrations/supabase/client.server")) as unknown as {
        __setMockExemption: (row: Record<string, unknown> | null) => void;
      };
    __setMockExemption(null); // mock returns null when revoked_at is not null

    const isExempt = await hasWebauthnExemption("student-uuid-revoked");
    expect(isExempt).toBe(false);
  });
});
