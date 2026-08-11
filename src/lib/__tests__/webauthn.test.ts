/**
 * Tests for Phase 1 (hardening work order): WebAuthn device-attestation gate.
 *
 * Same approach as rate-limit-atomicity.test.ts: no live Postgres instance here, so
 * these stub global fetch (the real network boundary the Supabase client calls
 * through) rather than mocking the client module, and call the real exported
 * functions from webauthn.server.ts -- not re-implementations of their logic.
 *
 * verifyAuthenticationResponse itself (real WebAuthn signature cryptography) is
 * mocked via vi.mock("@simplewebauthn/server", ...): producing a genuinely signed
 * assertion needs a real or virtual authenticator, which is out of scope here.
 * That library's own correctness isn't what's under test -- this project's
 * integration around it is: does verifyDeviceAssertion look up the right
 * credential, pass the right challenge/origin/RPID through, persist the new
 * counter on success, and fail closed on any error.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockVerifyAuthenticationResponse = vi.fn();
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyAuthenticationResponse: (...args: unknown[]) => mockVerifyAuthenticationResponse(...args),
  };
});

import {
  resolveRpConfig,
  issueRegistrationChallenge,
  verifyRegistrationChallenge,
  hasRegisteredDevice,
  verifyDeviceAssertion,
} from "../webauthn.server";

// ---- In-memory model of the webauthn_credentials table, served over a stubbed
// global fetch so the real supabaseAdmin client (real HTTP calls, real
// PostgREST-shaped requests) exercises this project's own query logic.
type CredRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[] | null;
};
let creds: CredRow[] = [];

function qp(url: string, key: string): string | null {
  const m = new URL(url).searchParams.get(key);
  return m;
}

beforeAll(() => {
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  vi.stubEnv("LIVENESS_HMAC_KEY", "test-liveness-hmac-key-for-webauthn-envelopes");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/rest/v1/webauthn_credentials")) {
        const userIdFilter = qp(url, "user_id"); // "eq.<uuid>"
        const credentialIdFilter = qp(url, "credential_id"); // "eq.<id>"
        const selectHead = new Headers(init?.headers).get("prefer");

        if (method === "GET" || method === "HEAD") {
          let rows = creds;
          if (userIdFilter) rows = rows.filter((r) => `eq.${r.user_id}` === userIdFilter);
          if (credentialIdFilter)
            rows = rows.filter((r) => `eq.${r.credential_id}` === credentialIdFilter);
          const isCountHead = selectHead?.includes("count=exact");
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (isCountHead) headers["Content-Range"] = `*/${rows.length}`;
          return new Response(method === "HEAD" ? null : JSON.stringify(rows), {
            status: 200,
            headers,
          });
        }

        if (method === "PATCH") {
          const body = JSON.parse((init?.body as string) ?? "{}");
          creds = creds.map((r) =>
            credentialIdFilter && `eq.${r.credential_id}` === credentialIdFilter
              ? { ...r, ...body }
              : r,
          );
          return new Response(JSON.stringify([]), { status: 200 });
        }
      }

      throw new Error(`unexpected fetch in webauthn test: ${method} ${url}`);
    }),
  );
});

beforeEach(() => {
  creds = [];
  mockVerifyAuthenticationResponse.mockReset();
});

describe("resolveRpConfig", () => {
  it("prefers the Origin header", () => {
    const req = new Request("https://ignored.example/x", {
      headers: { origin: "https://app.example.com" },
    });
    expect(resolveRpConfig(req)).toEqual({
      rpID: "app.example.com",
      origin: "https://app.example.com",
    });
  });

  it("falls back to Host header when Origin is absent", () => {
    const req = new Request("https://ignored.example/x", {
      headers: { host: "campus.example.org" },
    });
    expect(resolveRpConfig(req)).toEqual({
      rpID: "campus.example.org",
      origin: "https://campus.example.org",
    });
  });

  it("falls back to localhost when neither header is present", () => {
    expect(resolveRpConfig(null)).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
  });
});

describe("registration challenge envelope (stateless HMAC, mirrors LivenessChallenge)", () => {
  it("round-trips: issue then verify succeeds for the same user", async () => {
    const c = await issueRegistrationChallenge("user-1");
    expect(await verifyRegistrationChallenge(c, "user-1")).toBe(true);
  });

  it("rejects a challenge presented for the wrong user", async () => {
    const c = await issueRegistrationChallenge("user-1");
    expect(await verifyRegistrationChallenge(c, "user-2")).toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const c = await issueRegistrationChallenge("user-1");
    const expired = { ...c, issuedAt: c.issuedAt - c.ttlMs - 1 };
    expect(await verifyRegistrationChallenge(expired, "user-1")).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const c = await issueRegistrationChallenge("user-1");
    const tampered = { ...c, sig: c.sig.slice(0, -2) + (c.sig.slice(-2) === "AA" ? "BB" : "AA") };
    expect(await verifyRegistrationChallenge(tampered, "user-1")).toBe(false);
  });

  it("rejects a challenge whose nonce was swapped after signing", async () => {
    const c = await issueRegistrationChallenge("user-1");
    const other = await issueRegistrationChallenge("user-1");
    const swapped = { ...c, nonce: other.nonce };
    expect(await verifyRegistrationChallenge(swapped, "user-1")).toBe(false);
  });
});

describe("hasRegisteredDevice", () => {
  it("is false for a user with no rows", async () => {
    expect(await hasRegisteredDevice("user-1")).toBe(false);
  });

  it("is true once a credential row exists", async () => {
    creds.push({
      id: "cred-row-1",
      user_id: "user-1",
      credential_id: "abc",
      public_key: "xyz",
      counter: 0,
      transports: null,
    });
    expect(await hasRegisteredDevice("user-1")).toBe(true);
    expect(await hasRegisteredDevice("user-2")).toBe(false);
  });
});

describe("verifyDeviceAssertion (gate used by submitAttendance)", () => {
  const req = new Request("https://app.example.com/x", {
    headers: { origin: "https://app.example.com" },
  });

  it("fails closed for an unknown credential id", async () => {
    const result = await verifyDeviceAssertion(
      "user-1",
      { id: "not-registered" } as never,
      "challenge-abc",
      req,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("unknown_credential");
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("accepts a verified assertion and persists the new counter", async () => {
    creds.push({
      id: "cred-row-1",
      user_id: "user-1",
      credential_id: "cred-abc",
      public_key: "cHVibGljS2V5",
      counter: 5,
      transports: null,
    });
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });

    const result = await verifyDeviceAssertion(
      "user-1",
      { id: "cred-abc" } as never,
      "challenge-abc",
      req,
    );

    expect(result.verified).toBe(true);
    // Passed the right expectedChallenge/origin/RPID through to the library call.
    const callArgs = mockVerifyAuthenticationResponse.mock.calls[0][0] as {
      expectedChallenge: string;
      expectedOrigin: string;
      expectedRPID: string;
    };
    expect(callArgs.expectedChallenge).toBe("challenge-abc");
    expect(callArgs.expectedOrigin).toBe("https://app.example.com");
    expect(callArgs.expectedRPID).toBe("app.example.com");
    // Counter was persisted (replay defense for next time).
    expect(creds.find((c) => c.credential_id === "cred-abc")?.counter).toBe(6);
  });

  it("fails closed when the library reports not verified", async () => {
    creds.push({
      id: "cred-row-1",
      user_id: "user-1",
      credential_id: "cred-abc",
      public_key: "cHVibGljS2V5",
      counter: 5,
      transports: null,
    });
    mockVerifyAuthenticationResponse.mockResolvedValue({ verified: false });

    const result = await verifyDeviceAssertion(
      "user-1",
      { id: "cred-abc" } as never,
      "challenge-abc",
      req,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("not_verified");
    // Counter must NOT be bumped on a failed verification.
    expect(creds.find((c) => c.credential_id === "cred-abc")?.counter).toBe(5);
  });

  it("fails closed when the library throws (e.g. non-increasing counter -- cloned authenticator)", async () => {
    creds.push({
      id: "cred-row-1",
      user_id: "user-1",
      credential_id: "cred-abc",
      public_key: "cHVibGljS2V5",
      counter: 5,
      transports: null,
    });
    mockVerifyAuthenticationResponse.mockRejectedValue(
      new Error("Response counter value 3 was lower than expected 5"),
    );

    const result = await verifyDeviceAssertion(
      "user-1",
      { id: "cred-abc" } as never,
      "challenge-abc",
      req,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/counter/i);
    expect(creds.find((c) => c.credential_id === "cred-abc")?.counter).toBe(5);
  });
});
