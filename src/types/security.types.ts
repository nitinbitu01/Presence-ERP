export interface PasswordRequirements {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventCommonPatterns: boolean;
  preventUserInfo: boolean;
  historyCount: number; // Prevent reuse of last N passwords
}

export type SecurityEventType =
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_TOKEN_VALIDATED"
  | "PASSWORD_RESET_COMPLETED"
  | "PASSWORD_RESET_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "SUSPICIOUS_ACTIVITY";

export interface AuditLogEntry {
  eventType: SecurityEventType;
  userId?: string;
  email?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  success: boolean;
  failureReason?: string;
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: {
    score: number; // 0-100
    label: "Very Weak" | "Weak" | "Fair" | "Strong" | "Very Strong";
  };
}

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
}
