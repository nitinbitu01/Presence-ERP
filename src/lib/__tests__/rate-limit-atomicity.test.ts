/**
 * Regression test for Phase 0 fix #2: checkRateLimit() TOCTOU race
 * (20260725120000_atomic_rate_limit.sql).
 *
 * There's no live Postgres instance in this environment, so this can't prove the
 * transaction-scoped advisory lock in check_and_increment_rate_limit() serializes
 * concurrent Postgres *connections* -- that guarantee is provided by the database
 * itself, at the SQL level, and isn't something a JS-side unit test can exercise
 * without a real DB. That's a known, documented limitation of this whole test
 * suite (see IMPLEMENTATION_SUMMARY.md).
 *
 * What this test *can* and does prove: it calls the real, exported checkRateLimit()
 * -- not a re-implementation of its logic -- and stubs global fetch (the actual
 * network boundary the Supabase client calls through) so the single RPC call it
 * makes resolves against an in-memory model of the atomic Postgres function: count
 * and insert evaluated together, no gap for another concurrent call to land in
 * between. Fired concurrently, exactly maxAttempts of N calls come back allowed.
 *
 * NOTE on approach: an earlier version of this test used vi.mock() on
 * "@/integrations/supabase/client.server" instead of stubbing fetch. That worked
 * for a single call but was unreliable under concurrent Promise.all() -- concurrent
 * first-time dynamic import() of a not-yet-cached mocked module intermittently fell
 * through to the real, unmocked client in this vite-node/Vitest version. Stubbing
 * fetch avoids that entirely, since it doesn't depend on module-resolution timing.
 *
 * The second describe block below contrasts this against the *old* two-round-trip
 * (count-then-insert) shape being fixed, to demonstrate concretely that the old
 * shape could overshoot the limit under concurrency and the new one cannot.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { checkRateLimit } from "../attendance-crypto.server";

type RateLimitRow = { key: string; attempted_at: number };
let store: RateLimitRow[] = [];

beforeAll(() => {
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

  // Stand-in for check_and_increment_rate_limit(): count and insert are decided
  // together, synchronously, before responding -- exactly as the real Postgres
  // function does them in one transaction under an advisory lock.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("/rpc/check_and_increment_rate_limit")) {
        throw new Error(`unexpected fetch in rate-limit-atomicity test: ${url}`);
      }
      const args = JSON.parse((init?.body as string) ?? "{}") as {
        p_key: string;
        p_max_attempts: number;
        p_window_ms: number;
      };
      const cutoff = Date.now() - args.p_window_ms;
      store = store.filter((r) => r.attempted_at >= cutoff);
      const count = store.filter((r) => r.key === args.p_key).length;

      const body =
        count >= args.p_max_attempts
          ? [{ allowed: false, current_count: count }]
          : (store.push({ key: args.p_key, attempted_at: Date.now() }),
            [{ allowed: true, current_count: count + 1 }]);

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

describe("checkRateLimit (atomic RPC)", () => {
  beforeEach(() => {
    store = [];
  });

  it("allows exactly maxAttempts out of N concurrent calls for the same key", async () => {
    const maxAttempts = 5;
    const N = 30;

    const results = await Promise.all(
      Array.from({ length: N }, () => checkRateLimit("student-123", maxAttempts, 60_000)),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(maxAttempts);
    expect(results.filter((r) => !r.allowed).length).toBe(N - maxAttempts);
  });

  it("tracks separate keys independently under concurrent load", async () => {
    const maxAttempts = 3;
    const [aResults, bResults] = await Promise.all([
      Promise.all(
        Array.from({ length: 10 }, () => checkRateLimit("student-a", maxAttempts, 60_000)),
      ),
      Promise.all(
        Array.from({ length: 10 }, () => checkRateLimit("student-b", maxAttempts, 60_000)),
      ),
    ]);

    expect(aResults.filter((r) => r.allowed).length).toBe(maxAttempts);
    expect(bResults.filter((r) => r.allowed).length).toBe(maxAttempts);
  });
});

describe("pre-fix shape, for contrast (demonstrates the bug this migration closes)", () => {
  beforeEach(() => {
    store = [];
  });

  // Reproduces the *old* checkRateLimit body: a separate count round trip followed
  // by a separate insert round trip, each awaited independently -- the exact shape
  // that shipped before 20260725120000_atomic_rate_limit.sql. This is deliberately
  // NOT imported from the source, since the fix replaced it; it's inlined here only
  // to prove the old shape is genuinely racy under the same concurrency this suite
  // uses to prove the new shape isn't.
  async function legacyCheckThenInsert(key: string, maxAttempts: number, windowMs: number) {
    const cutoff = Date.now() - windowMs;
    // Simulate the round-trip latency that lets other calls interleave here, the
    // same way two separate awaited Supabase calls would in production.
    await new Promise((r) => setTimeout(r, 0));
    const count = store.filter((r) => r.key === key && r.attempted_at >= cutoff).length;
    if (count >= maxAttempts) return { allowed: false };
    await new Promise((r) => setTimeout(r, 0));
    store.push({ key, attempted_at: Date.now() });
    return { allowed: true };
  }

  it("overshoots maxAttempts under concurrency (the bug being fixed)", async () => {
    const maxAttempts = 5;
    const N = 30;

    const results = await Promise.all(
      Array.from({ length: N }, () => legacyCheckThenInsert("student-123", maxAttempts, 60_000)),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    // The whole point of this test: the old two-round-trip shape does NOT reliably
    // cap at maxAttempts under concurrency.
    expect(allowedCount).toBeGreaterThan(maxAttempts);
  });
});
