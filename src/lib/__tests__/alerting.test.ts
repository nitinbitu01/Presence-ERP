/**
 * Tests for Phase 2 item 4 (hardening work order): structured audit alerting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendSecurityAlert,
  alertRateLimitSpike,
  alertMultiStudentFlag,
  alertAdminRoleChange,
} from "../alerting.server";

describe("sendSecurityAlert", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls back to console.warn when ALERT_WEBHOOK_URL isn't configured", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({ kind: "multi_student_flag", summary: "test summary" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("multi_student_flag"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("POSTs a Slack/Discord-compatible payload when a webhook is configured", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.com/webhook");
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({
      kind: "admin_role_change",
      summary: "admin granted to user-1",
      details: { grantedTo: "user-1" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/webhook");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("admin granted to user-1");
    expect(body.kind).toBe("admin_role_change");
    expect(body.details).toEqual({ grantedTo: "user-1" });
  });

  it("never throws when the webhook request fails (fire-and-forget)", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.com/webhook");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendSecurityAlert({ kind: "rate_limit_spike", summary: "x" }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not throw when the webhook returns a non-2xx status", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.com/webhook");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendSecurityAlert({ kind: "rate_limit_spike", summary: "x" }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("alert helper shape (each produces the right kind/summary)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.com/webhook");
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("alertRateLimitSpike", async () => {
    await alertRateLimitSpike({ scope: "ip", key: "1.2.3.4", sessionId: "sess-1" });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.kind).toBe("rate_limit_spike");
    expect(body.summary).toContain("IP");
    expect(body.details).toEqual({ scope: "ip", key: "1.2.3.4", sessionId: "sess-1" });
  });

  it("alertMultiStudentFlag", async () => {
    await alertMultiStudentFlag({ deviceFpHash: "abc", distinctStudents: 3, windowHours: 24 });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.kind).toBe("multi_student_flag");
    expect(body.summary).toContain("3");
  });

  it("alertAdminRoleChange", async () => {
    await alertAdminRoleChange({ grantedTo: "u1", grantedBy: "u2", role: "admin" });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.kind).toBe("admin_role_change");
    expect(body.summary).toContain("u1");
    expect(body.summary).toContain("u2");
  });
});
