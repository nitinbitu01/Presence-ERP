/**
 * Phase 2 fix verification: submitAttendance's device-attestation gate was previously
 * deny-by-default with NO grace period -- meaning a mass rollout (e.g. 1000 students'
 * first class session) would hard-lock out every student who hadn't separately registered
 * a WebAuthn device yet, since face enrollment and device registration are distinct steps.
 *
 * decideDeviceGateOutcome adds a WEBAUTHN_POLICY=recommended grace mode (warn, don't block)
 * for the rollout window, while keeping "mandatory" as the strict post-rollout default and
 * preserving admin-granted per-student exemptions.
 */

import { describe, it, expect } from "vitest";
import { decideDeviceGateOutcome } from "../webauthn.server";

describe("decideDeviceGateOutcome", () => {
  it("always verifies the assertion when a device IS registered, regardless of policy", () => {
    for (const policy of ["mandatory", "recommended", "optional"] as const) {
      const result = decideDeviceGateOutcome({ deviceRegistered: true, isExempt: false, policy });
      expect(result.outcome).toBe("verify_assertion");
    }
  });

  it("mandatory policy blocks a student with no device and no exemption", () => {
    const result = decideDeviceGateOutcome({
      deviceRegistered: false,
      isExempt: false,
      policy: "mandatory",
    });
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reasonCode).toBe("device_required_no_exemption");
    }
  });

  it("mandatory policy still passes a student with an active admin exemption", () => {
    const result = decideDeviceGateOutcome({
      deviceRegistered: false,
      isExempt: true,
      policy: "mandatory",
    });
    expect(result.outcome).toBe("pass");
  });

  it("recommended policy WARNS but ALLOWS a student with no device (grace period) — this is the rollout fix", () => {
    const result = decideDeviceGateOutcome({
      deviceRegistered: false,
      isExempt: false,
      policy: "recommended",
    });
    expect(result.outcome).toBe("pass_grace_warn");
  });

  it("optional policy always passes, even with no device and no exemption", () => {
    const result = decideDeviceGateOutcome({
      deviceRegistered: false,
      isExempt: false,
      policy: "optional",
    });
    expect(result.outcome).toBe("pass");
    if (result.outcome === "pass") {
      expect(result.note).toBe("policy_optional");
    }
  });

  it("never silently drops a case — every (deviceRegistered, isExempt, policy) combination returns a defined outcome", () => {
    const policies = ["mandatory", "recommended", "optional"] as const;
    for (const deviceRegistered of [true, false]) {
      for (const isExempt of [true, false]) {
        for (const policy of policies) {
          const result = decideDeviceGateOutcome({ deviceRegistered, isExempt, policy });
          expect(["pass", "pass_grace_warn", "verify_assertion", "blocked"]).toContain(
            result.outcome,
          );
        }
      }
    }
  });
});
