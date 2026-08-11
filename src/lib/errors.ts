export type ErpErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR"
  | "LIVENESS_FAILED"
  | "DUPLICATE_BIOMETRIC"
  | "CLOCK_SKEW"
  | "BIOMETRIC_MISMATCH"
  | "SESSION_EXPIRED";

export class PresenceErpError extends Error {
  public readonly code: ErpErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErpErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode = 400,
  ) {
    super(message);
    this.name = "PresenceErpError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: new Date().toISOString(),
    };
  }
}

export function isPresenceErpError(err: unknown): err is PresenceErpError {
  return err instanceof PresenceErpError;
}
