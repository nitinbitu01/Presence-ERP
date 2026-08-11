import { describe, it, expect } from "vitest";
import {
  decodeWiegand26,
  decodeWiegand34,
  decodeWiegand37,
  detectGatePassbackViolation,
  verifyGateSignature,
  ingestGateScanEvent,
  listRecentGateScans,
} from "../hardware-gate-listener.server";

describe("Phase C.2 Hardware Biometric & RFID Gate Listener", () => {
  describe("Wiegand-26 Binary Decoder", () => {
    it("decodes valid 26-bit Wiegand hex into facility code and card number", () => {
      const res = decodeWiegand26("0x0123456");
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("facilityCode");
      expect(res).toHaveProperty("cardNumber");
      expect(typeof res?.facilityCode).toBe("number");
      expect(typeof res?.cardNumber).toBe("number");
    });

    it("returns null for invalid hex strings", () => {
      expect(decodeWiegand26("invalid_hex")).toBeNull();
    });
  });

  describe("Wiegand-34 Binary Decoder", () => {
    it("decodes valid 34-bit Wiegand hex into facility code and card number", () => {
      const res = decodeWiegand34("0x12345678");
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("facilityCode");
      expect(res).toHaveProperty("cardNumber");
    });
  });

  describe("Wiegand-37 Corporate 1000 Binary Decoder", () => {
    it("decodes valid 37-bit Corporate 1000 Wiegand hex", () => {
      const res = decodeWiegand37("0x12345678");
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("facilityCode");
      expect(res).toHaveProperty("cardNumber");
    });
  });

  describe("Turnstile Anti-Passback (APB) Violation Detector", () => {
    it("flags duplicate card scan at turnstile within APB window", () => {
      const cardId = "card_apb_test_999";
      const initial = detectGatePassbackViolation(cardId, "gate_main_north");
      expect(initial.isPassbackViolation).toBe(false);

      const reScan = detectGatePassbackViolation(cardId, "gate_main_south");
      expect(reScan.isPassbackViolation).toBe(true);
      expect(reScan.reason).toContain("Anti-Passback (APB) violation");
    });
  });

  describe("HMAC Gate Signature Verification", () => {
    it("verifies payload signature", () => {
      const valid = verifyGateSignature("payload_data", "sig_1234567890abc", "secret_key");
      expect(valid).toBe(true);
    });
  });

  describe("Server Functions", () => {
    it("exports ingestGateScanEvent server function", () => {
      expect(typeof ingestGateScanEvent).toBe("function");
    });

    it("exports listRecentGateScans server function", () => {
      expect(typeof listRecentGateScans).toBe("function");
    });
  });
});
