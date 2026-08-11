import type { PasswordRequirements, RateLimitConfig } from "@/types/security.types";

export const PASSWORD_CONFIG: PasswordRequirements = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  preventCommonPatterns: true,
  preventUserInfo: true,
  historyCount: 5, // Prevent reuse of last 5 passwords
};

export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  blockDurationMs: 30 * 60 * 1000, // 30 minutes
};

export const TOKEN_CONFIG = {
  expiryMinutes: 60, // 1 hour
  singleUse: true,
  length: 64, // hex chars
};

export const SESSION_CONFIG = {
  invalidateAllOnReset: true,
  require2FAAfterReset: true,
  sendEmailNotification: true,
};

export const COMMON_PASSWORDS = [
  "password", "Password1", "12345678", "qwerty123", "admin123",
  "letmein", "welcome123", "monkey123", "dragon123", "master123",
  "Password123", "P@ssw0rd", "Admin@123", "User@123",
];
