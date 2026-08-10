import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hashSha256,
  hashSha1,
  generateResetToken,
  checkPasswordPwned,
  validateErpPassword,
} from "../reset-password.server";
import { calculateEntropy, checkPasswordStrength } from "@/components/PasswordInput";

describe("Reset Password Security Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token Generation & Hashing", () => {
    it("generates a 64-character hex raw token (32 bytes of entropy)", async () => {
      const { rawToken, tokenHash } = await generateResetToken();
      expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
      expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(rawToken).not.toEqual(tokenHash);
    });

    it("SHA-256 digest is deterministic", async () => {
      const hash1 = await hashSha256("test-token-12345678901234567890123456789012");
      const hash2 = await hashSha256("test-token-12345678901234567890123456789012");
      expect(hash1).toBe(hash2);
    });

    it("SHA-1 digest produces uppercase hex string (for HIBP k-Anonymity)", async () => {
      const hash = await hashSha1("password123");
      expect(hash).toBe("CBFDAC6008F9CAB4083784CBD1874F76618D2A97");
      expect(hash.slice(0, 5)).toBe("CBFDA");
    });
  });

  describe("ERP Password Requirements Validation", () => {
    it("rejects passwords shorter than 12 characters", () => {
      const res = validateErpPassword("Short1!");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Password must be at least 12 characters long.");
    });

    it("rejects passwords missing uppercase letters", () => {
      const res = validateErpPassword("nouppercase123!");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Password must contain at least one uppercase letter (A-Z).");
    });

    it("rejects passwords missing lowercase letters", () => {
      const res = validateErpPassword("NOLOWERCASE123!");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Password must contain at least one lowercase letter (a-z).");
    });

    it("rejects passwords missing numbers", () => {
      const res = validateErpPassword("NoNumbersHere!");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Password must contain at least one number (0-9).");
    });

    it("rejects passwords missing special characters", () => {
      const res = validateErpPassword("NoSpecialChars123");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Password must contain at least one special character (!@#$%^&*).");
    });

    it("rejects common patterns like 'password123' or 'qwerty'", () => {
      const res = validateErpPassword("Qwerty123456!#");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("forbidden common pattern"))).toBe(true);
    });

    it("rejects passwords containing user's email handle", () => {
      const res = validateErpPassword("NitinBitu2026!#", "nitinbitu03@gmail.com");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Password must not contain parts of your email address or username.");
    });

    it("accepts strong, compliant passwords", () => {
      const res = validateErpPassword("RruPresence@2026#Secure", "student@university.edu");
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe("Password Entropy & Strength Component Logic", () => {
    it("calculates entropy bits correctly", () => {
      const entropy = calculateEntropy("RruPresence@2026#Secure");
      expect(entropy).toBeGreaterThan(100);
    });

    it("evaluates weak vs strong password strength", () => {
      const weak = checkPasswordStrength("weak", "test@university.edu");
      expect(weak.isStrongEnough).toBe(false);

      const strong = checkPasswordStrength("RruPresence@2026#Secure", "test@university.edu");
      expect(strong.isStrongEnough).toBe(true);
      expect(strong.entropy).toBeGreaterThan(80);
    });
  });

  describe("Have I Been Pwned (HIBP) Breach Check", () => {
    it("detects breached password when suffix matches HIBP range response", async () => {
      const mockResponseBody = `C6008F9CAB4083784CBD1874F76618D2A97:1234\n00000000000000000000000000000000000:5`;
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        text: async () => mockResponseBody,
      } as Response);

      const result = await checkPasswordPwned("password123");
      expect(result.pwned).toBe(true);
      expect(result.count).toBe(1234);
    });

    it("returns pwned=false when suffix is not found in HIBP range response", async () => {
      const mockResponseBody = `11111111111111111111111111111111111:100\n22222222222222222222222222222222222:50`;
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        text: async () => mockResponseBody,
      } as Response);

      const result = await checkPasswordPwned("UniqueStrongPassphrase2026!#");
      expect(result.pwned).toBe(false);
      expect(result.count).toBe(0);
    });

    it("gracefully falls back when HIBP API returns an error or times out", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network Error"));

      const result = await checkPasswordPwned("anyPassword");
      expect(result.pwned).toBe(false);
      expect(result.count).toBe(0);
    });
  });
});
