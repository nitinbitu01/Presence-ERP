import { describe, it, expect } from "vitest";
import { PresenceErpError, isPresenceErpError } from "../errors";

describe("Code Quality & Enterprise Error System", () => {
  it("creates PresenceErpError instance with custom error codes and HTTP status", () => {
    const err = new PresenceErpError(
      "FORBIDDEN",
      "Self-approval is forbidden",
      { requestId: "req_123" },
      403,
    );

    expect(err.name).toBe("PresenceErpError");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Self-approval is forbidden");
    expect(err.details).toEqual({ requestId: "req_123" });
    expect(isPresenceErpError(err)).toBe(true);
  });

  it("serializes to JSON cleanly with timestamp and metadata", () => {
    const err = new PresenceErpError("UNAUTHORIZED", "Missing session token", undefined, 401);
    const json = err.toJSON();

    expect(json.name).toBe("PresenceErpError");
    expect(json.code).toBe("UNAUTHORIZED");
    expect(json.statusCode).toBe(401);
    expect(json.timestamp).toBeDefined();
  });

  it("type-guard correctly distinguishes standard Error from PresenceErpError", () => {
    const stdErr = new Error("Standard error");
    const erpErr = new PresenceErpError("RATE_LIMITED", "Too many requests", undefined, 429);

    expect(isPresenceErpError(stdErr)).toBe(false);
    expect(isPresenceErpError(erpErr)).toBe(true);
  });
});
