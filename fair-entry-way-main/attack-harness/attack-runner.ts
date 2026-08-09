/**
 * attack-runner.ts — core HTTP client for the attack harness.
 *
 * Provides:
 *  - signIn()              Authenticate a test student, return an access token
 *  - callSubmitAttendance() POST directly to the server (bypasses the UI)
 *  - assertGate()          Fail-loud assertion: confirms the expected gate fired
 *  - printResult()         Colour-coded output for live demo readability
 *
 * Run with: bun <script>.ts  (Bun has native fetch, crypto, and ESM support)
 */

import { createClient } from "@supabase/supabase-js";
import { config, projectRef } from "./attack.config.ts";

// ── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
};

function banner(title: string) {
  console.log(`\n${C.bold}${C.cyan}${"═".repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${"═".repeat(60)}${C.reset}`);
}

function ok(msg: string) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`  ${C.grey}·${C.reset} ${msg}`);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface Session {
  accessToken: string;
  userId: string;
  email: string;
}

/**
 * Sign in a test student with email + password.
 * Returns a session object with the JWT access token.
 */
export async function signIn(email: string, password: string): Promise<Session> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set.\n" +
        "Copy your project .env file or set them in your shell.",
    );
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    throw new Error(
      `Auth failed for ${email}: ${error?.message ?? "no session returned"}\n` +
        "Did you run 00-seed-test-students.ts first?",
    );
  }

  return {
    accessToken: data.session.access_token,
    userId: data.session.user.id,
    email: data.session.user.email ?? email,
  };
}

// ── Server function call ──────────────────────────────────────────────────────

export interface AttendancePayload {
  sessionId: string;
  probeEmbedding: number[];
  clientLat: number;
  clientLng: number;
  clientAccuracy?: number;
  deviceFingerprint: string;
  livenessChallenge: {
    action: string;
    sessionId: string;
    userId: string;
    issuedAt: number;
    ttlMs: number;
    sig: string;
  };
  livenessSignals?: Array<{
    ear: number;
    yaw: number;
    pitch: number;
    faceArea: number;
    faceX: number;
    faceY: number;
  }>;
  frameEmbeddings?: number[][];
  sessionOtp?: string;
  webauthnAssertion?: unknown;
  virtualCameraDetected?: boolean;
  cameraLabel?: string;
  livenessVendorSessionId?: string;
}

export interface AttendanceResult {
  decision?: "present" | "review" | "rejected" | "fallback_present";
  similarity?: number | null;
  gateReasons?: Record<string, unknown>;
  reasonCode?: string;
  httpStatus?: number;
  httpError?: string;
}

/**
 * POST directly to the submitAttendance server function, bypassing the UI.
 * This is how a real attacker would call it: raw HTTP with a stolen JWT.
 *
 * The server function URL is discovered by inspecting the Network tab (see attack.config.ts).
 * Auth is passed via both Authorization header and the Supabase cookie so the
 * requireSupabaseAuth middleware accepts the request regardless of how it reads the token.
 */
export async function callSubmitAttendance(
  session: Session,
  payload: AttendancePayload,
): Promise<AttendanceResult> {
  const ref = projectRef();

  // Supabase stores the session as a JSON blob in a cookie. We reconstruct
  // a minimal version that the auth middleware can parse.
  const cookieVal = JSON.stringify({
    access_token: session.accessToken,
    token_type: "bearer",
    expires_in: 3600,
    user: { id: session.userId, email: session.email },
  });

  let res: Response;
  try {
    res = await fetch(config.serverFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        // Supabase auth middleware reads from this cookie in server-side contexts
        Cookie: `sb-${ref}-auth-token=${encodeURIComponent(cookieVal)}; sb-access-token=${session.accessToken}`,
        // TanStack Start server function routing hint
        "X-Tanstack-Start-Client": "1",
      },
      // TanStack Start wraps server function args in an array
      body: JSON.stringify([payload]),
    });
  } catch (networkErr: unknown) {
    return {
      httpError: `Network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}\n` +
        `Is the dev server running at ${config.serverFnUrl}? Run: bun run dev`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    return { httpStatus: res.status, httpError: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  }

  try {
    const json = await res.json();
    // Server function may return the result directly or wrapped in a data envelope
    return (json?.data ?? json) as AttendanceResult;
  } catch {
    return { httpError: "Response was not valid JSON — check server function URL format" };
  }
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

export interface AssertOptions {
  /** Expected value in result.reasonCode */
  expectedReasonCode?: string;
  /** Expected value in result.decision */
  expectedDecision?: string;
  /** Expected gate key to be present in gateReasons with ok: false */
  expectedFailedGate?: string;
}

/**
 * Asserts the result matches the expected pass/fail criteria.
 * Prints a coloured PASS/FAIL line.
 * Returns true on pass, false on fail.
 */
export function assertGate(
  attackName: string,
  result: AttendanceResult,
  opts: AssertOptions,
): boolean {
  const r = result;

  // Check for network/HTTP errors first
  if (r.httpError) {
    fail(`${attackName}: HTTP error — ${r.httpError}`);
    return false;
  }

  let passed = true;
  const notes: string[] = [];

  if (opts.expectedReasonCode) {
    if (r.reasonCode === opts.expectedReasonCode) {
      notes.push(`reason_code=${r.reasonCode} ✓`);
    } else {
      notes.push(
        `reason_code expected="${opts.expectedReasonCode}" got="${r.reasonCode ?? "(none)"}" ✗`,
      );
      passed = false;
    }
  }

  if (opts.expectedDecision) {
    if (r.decision === opts.expectedDecision) {
      notes.push(`decision=${r.decision} ✓`);
    } else {
      notes.push(
        `decision expected="${opts.expectedDecision}" got="${r.decision ?? "(none)"}" ✗`,
      );
      passed = false;
    }
  }

  if (opts.expectedFailedGate && r.gateReasons) {
    const gate = r.gateReasons[opts.expectedFailedGate] as { ok?: boolean } | undefined;
    if (gate && gate.ok === false) {
      notes.push(`gate[${opts.expectedFailedGate}].ok=false ✓`);
    } else {
      notes.push(`gate[${opts.expectedFailedGate}] expected ok=false but got: ${JSON.stringify(gate)} ✗`);
      passed = false;
    }
  }

  if (passed) {
    ok(`${C.bold}${attackName}${C.reset}${C.green} — ATTACK BLOCKED${C.reset}`);
  } else {
    fail(`${C.bold}${attackName}${C.reset}${C.red} — GATE NOT ENFORCED${C.reset}`);
  }

  for (const note of notes) {
    info(`  ${note}`);
  }

  return passed;
}

/** Pretty-print the full result for debugging */
export function printResult(label: string, result: AttendanceResult) {
  info(`${label} full result:`);
  if (result.httpError) {
    console.log(`    ${C.red}${result.httpError}${C.reset}`);
    return;
  }
  console.log(`    decision:    ${result.decision ?? "(none)"}`);
  console.log(`    reasonCode:  ${result.reasonCode ?? "(none)"}`);
  console.log(`    similarity:  ${result.similarity ?? "(none)"}`);
  console.log(`    gateReasons: ${JSON.stringify(result.gateReasons, null, 6).replace(/^/gm, "    ")}`);
}

/** Export banner for scripts to use */
export { banner, ok, fail, info };
