/**
 * attack.config.ts — shared configuration for all 15-day attack harness scripts.
 *
 * HOW TO USE:
 *   1. Copy ../.env to this directory or set the env vars listed below in your shell.
 *   2. Run 00-seed-test-students.ts once to create the test accounts.
 *   3. Fill in ATTACK_SESSION_ID after creating a live test session in the admin UI.
 *   4. Find SERVER_FN_URL:
 *        a. Run `bun run dev` in the project root
 *        b. Open http://localhost:3000, sign in as a test student, start a check-in
 *        c. Open DevTools → Network tab, look for the POST request
 *        d. Copy that URL and paste it below (or set ATTACK_SERVER_FN_URL env var)
 *
 * Run any script with: bun attack-harness/<script>.ts
 */

// ── Required env vars ────────────────────────────────────────────────────────
const require = (name: string): string => {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `Missing required env var: ${name}\nSet it in your shell or copy ../.env here.`,
    );
  return v;
};

// ── Core config ──────────────────────────────────────────────────────────────
export const config = {
  /** Base URL of the running app (dev server or deployed) */
  appUrl: process.env.ATTACK_APP_URL ?? "http://localhost:3000",

  /** Supabase project URL */
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",

  /** Supabase publishable (anon) key */
  supabaseAnonKey:
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",

  /**
   * Supabase service_role key — required ONLY for 00-seed-test-students.ts
   * (to create admin test accounts). Never expose in client-side code.
   * Find in: Supabase Dashboard → Project Settings → API → service_role key
   */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  /**
   * Live class session ID to attack against.
   * Create a session in the teacher UI and paste its UUID here (or set env var).
   * The session must be open (within starts_at / ends_at window) when scripts run.
   */
  testSessionId: process.env.ATTACK_SESSION_ID ?? "00000000-0000-0000-0000-000000000000",

  /**
   * The URL of the submitAttendance server function.
   *
   * FINDING THIS URL (one-time step):
   *   1. Open the app in a browser and sign in as a test student
   *   2. Start the check-in flow (you don't need to complete it)
   *   3. Open DevTools → Network → filter by "Fetch/XHR"
   *   4. Click "Submit Attendance" — watch for a POST request
   *   5. Copy the full URL and paste it here or set ATTACK_SERVER_FN_URL
   *
   * Typical formats for TanStack Start / Nitro:
   *   http://localhost:3000/_server
   *   http://localhost:3000/api/attendance/submit
   */
  serverFnUrl: process.env.ATTACK_SERVER_FN_URL ?? "http://localhost:3000/_server",

  /** Real classroom coordinates (Ahmedabad campus — confirmed Q2) */
  classroom: {
    lat: 23.153421,
    lng: 72.886547,
    radiusM: 50,
  },

  /**
   * 5 seeded test accounts — created by 00-seed-test-students.ts.
   * Names are intentionally generic so they don't expose real personal data.
   */
  testStudents: [
    { email: "attack-student-1@attack.local", password: "AttackPass1!", name: "Attack Student A" },
    { email: "attack-student-2@attack.local", password: "AttackPass2!", name: "Attack Student B" },
    { email: "attack-student-3@attack.local", password: "AttackPass3!", name: "Attack Student C" },
    { email: "attack-student-4@attack.local", password: "AttackPass4!", name: "Attack Student D" },
    { email: "attack-student-5@attack.local", password: "AttackPass5!", name: "Attack Student E" },
  ],
};

/** Extract Supabase project ref from URL (used to set auth cookie name) */
export function projectRef(): string {
  try {
    const host = new URL(config.supabaseUrl).hostname; // e.g. "abcdefgh.supabase.co"
    return host.split(".")[0]; // e.g. "abcdefgh"
  } catch {
    return "unknown";
  }
}

/** Shared device fingerprints for multi-device tests */
export const DEVICE_FP = {
  shared: "shared-device-fingerprint-001",
  studentA: "device-fingerprint-student-a-002",
  studentB: "device-fingerprint-student-b-003",
  studentC: "device-fingerprint-student-c-004",
};

/** Minimal valid liveness signals — inside the classroom */
export function makeValidSignals(frameCount: number = 10) {
  return Array.from({ length: frameCount }, (_, i) => ({
    ear: 0.3 + Math.sin(i * 0.5) * 0.04, // realistic EAR variation
    yaw: 2 + Math.sin(i * 0.3) * 3, // mild natural head movement
    pitch: 1 + Math.cos(i * 0.4) * 2,
    faceArea: 9800 + Math.sin(i * 0.7) * 300, // breathing-scale area variance
    faceX: 320 + Math.sin(i * 0.2) * 4,
    faceY: 240 + Math.cos(i * 0.2) * 3,
  }));
}

/** Minimal valid blink signals (ear drops sharply in middle frames) */
export function makeBlinkSignals(frameCount: number = 10) {
  return Array.from({ length: frameCount }, (_, i) => {
    const inBlink = i >= 3 && i <= 5;
    return {
      ear: inBlink ? 0.18 : 0.32 + Math.random() * 0.02,
      yaw: 1 + Math.random() * 2,
      pitch: 1 + Math.random() * 2,
      faceArea: 9800 + Math.random() * 400,
      faceX: 320 + Math.random() * 6,
      faceY: 240 + Math.random() * 5,
    };
  });
}

/** A random 128-dim unit embedding — used as a plausible probe */
export function randomEmbedding(dims: number = 128): number[] {
  const raw = Array.from({ length: dims }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return raw.map((v) => v / norm);
}
