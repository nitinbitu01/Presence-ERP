// Server-only crypto helpers for the attendance module.
// AES-GCM 256 encryption of face embeddings, HMAC-SHA256 for liveness challenges.
// Runs on Cloudflare Workers via WebCrypto (globalThis.crypto.subtle).

import { getSecret } from "./cf-env.server";

const enc = new TextEncoder();

function requireKeyMaterial(name: string): string {
  return getSecret(name);
}

// ---- BIOMETRIC_ENC_KEY versioning ----
// Phase 2 item 3 (hardening work order): support key rotation without breaking
// already-encrypted embeddings. Opt-in and backward compatible: if
// BIOMETRIC_ENC_KEY_CURRENT_VERSION isn't set, behavior is byte-for-byte
// identical to before (single key, unversioned ciphertext layout). To rotate:
// set BIOMETRIC_ENC_KEY_V2 to a new secret, set
// BIOMETRIC_ENC_KEY_CURRENT_VERSION=2, and keep BIOMETRIC_ENC_KEY (or
// BIOMETRIC_ENC_KEY_V1, same value) around until every row has been re-encrypted
// under the new key -- old ciphertext keeps decrypting under the old key
// meanwhile, since the key version used is embedded in the ciphertext itself.
const AES_KEY_VERSION_MARKER = 0x01;

function biometricKeyEnvVarName(version: number): string {
  return version === 0 ? "BIOMETRIC_ENC_KEY" : `BIOMETRIC_ENC_KEY_V${version}`;
}

function currentBiometricKeyVersion(): number {
  const v = process.env.BIOMETRIC_ENC_KEY_CURRENT_VERSION;
  const parsed = v ? parseInt(v, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function importAesKeyForVersion(version: number): Promise<CryptoKey> {
  const raw = enc.encode(requireKeyMaterial(biometricKeyEnvVarName(version)));
  const hash = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// ---- LIVENESS_HMAC_KEY rotation grace window ----
// Every HMAC-signed token in this file (liveness challenges, session OTPs,
// and webauthn.server.ts's registration challenges) is short-lived -- TTLs of
// minutes, not days -- so a simple "current + previous" scheme is enough,
// unlike the biometric key's full version history (that data is long-lived).
// New signatures always use the current key only; verification tries both, so
// rotating LIVENESS_HMAC_KEY doesn't invalidate tokens issued moments before.
// Optional: set LIVENESS_HMAC_KEY_PREVIOUS to the outgoing key during a
// rotation, remove it once you're confident nothing issued under it is still
// outstanding (a few minutes, given the TTLs involved).
async function importHmacKeys(): Promise<CryptoKey[]> {
  const names = [
    "LIVENESS_HMAC_KEY",
    ...(process.env.LIVENESS_HMAC_KEY_PREVIOUS ? ["LIVENESS_HMAC_KEY_PREVIOUS"] : []),
  ];
  return Promise.all(
    names.map(async (name) => {
      const raw = enc.encode(requireKeyMaterial(name));
      return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
      ]);
    }),
  );
}

// Signing key only (current key) -- kept as a single-key helper since every
// sign call site in this file wants exactly the current key, never previous.
async function importHmacKey(): Promise<CryptoKey> {
  const [current] = await importHmacKeys();
  return current;
}

async function hmacVerifyAnyVersion(bytes: Uint8Array, sig: Uint8Array): Promise<boolean> {
  for (const key of await importHmacKeys()) {
    if (await crypto.subtle.verify("HMAC", key, sig as BufferSource, bytes as BufferSource)) {
      return true;
    }
  }
  return false;
}

// Encode a Float32Array embedding as bytes (little-endian).
export function embeddingToBytes(vec: number[]): Uint8Array {
  const f = new Float32Array(vec);
  const out = new Uint8Array(f.byteLength);
  out.set(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  return out;
}
export function bytesToEmbedding(bytes: Uint8Array): Float32Array {
  // Copy to be alignment-safe and to guarantee ArrayBuffer backing.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

// Ciphertext layout:
//   legacy/unversioned (BIOMETRIC_ENC_KEY_CURRENT_VERSION unset): [12-byte IV][ciphertext+tag]
//   versioned: [0x01 marker][1-byte key version][12-byte IV][ciphertext+tag]
export async function encryptEmbedding(vec: number[]): Promise<Uint8Array> {
  const version = currentBiometricKeyVersion();
  const key = await importAesKeyForVersion(version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = embeddingToBytes(vec);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      pt as BufferSource,
    ),
  );

  if (version === 0) {
    const out = new Uint8Array(iv.byteLength + ct.byteLength);
    out.set(iv, 0);
    out.set(ct, iv.byteLength);
    return out;
  }

  const out = new Uint8Array(2 + iv.byteLength + ct.byteLength);
  out[0] = AES_KEY_VERSION_MARKER;
  out[1] = version;
  out.set(iv, 2);
  out.set(ct, 2 + iv.byteLength);
  return out;
}

export async function decryptEmbedding(payload: Uint8Array): Promise<Float32Array> {
  if (payload.length > 14 && payload[0] === AES_KEY_VERSION_MARKER) {
    try {
      const version = payload[1];
      const key = await importAesKeyForVersion(version);
      const iv = payload.slice(2, 14);
      const ct = payload.slice(14);
      const pt = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv as BufferSource },
          key,
          ct as BufferSource,
        ),
      );
      return bytesToEmbedding(pt);
    } catch {
      // Falls through to the legacy interpretation below. This only matters
      // for the ~1/256 chance an unversioned payload's random IV happened to
      // start with the marker byte -- AES-GCM's auth tag makes a genuine
      // misinterpretation fail loudly here, never silently return wrong data.
    }
  }
  const key = await importAesKeyForVersion(0);
  const iv = payload.slice(0, 12);
  const ct = payload.slice(12);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    ),
  );
  return bytesToEmbedding(pt);
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  const len = a.length;
  if (len !== b.length || len === 0) return -1;

  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }

  const denom = Math.sqrt(na * nb);
  return denom === 0 ? 0 : dot / denom;
}

// Haversine distance in meters between two lat/lng pairs.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- Liveness challenge (HMAC-signed, 60s TTL) ----
export type LivenessAction = "blink" | "turn_left" | "turn_right" | "nod";

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64uToBytes(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface LivenessChallenge {
  action: LivenessAction;
  sessionId: string;
  userId: string;
  issuedAt: number;
  ttlMs: number;
  sig: string;
}

export async function issueChallenge(
  sessionId: string,
  userId: string,
  allowedActions?: LivenessAction[],
): Promise<LivenessChallenge> {
  const actions: LivenessAction[] = allowedActions ?? ["blink", "turn_left", "turn_right", "nod"];
  const action = actions[Math.floor(Math.random() * actions.length)];
  const payload = { action, sessionId, userId, issuedAt: Date.now(), ttlMs: 60_000 };
  const key = await importHmacKey();
  const bytes = enc.encode(
    `${payload.action}.${payload.sessionId}.${payload.userId}.${payload.issuedAt}.${payload.ttlMs}`,
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes as BufferSource));
  return { ...payload, sig: b64u(sig) };
}

export async function verifyChallenge(c: LivenessChallenge): Promise<boolean> {
  if (Date.now() - c.issuedAt > c.ttlMs) return false;
  try {
    const bytes = enc.encode(`${c.action}.${c.sessionId}.${c.userId}.${c.issuedAt}.${c.ttlMs}`);
    return await hmacVerifyAnyVersion(bytes, b64uToBytes(c.sig));
  } catch {
    return false;
  }
}

// ---- CIDR matching (IPv4 & IPv6) ----
export function matchCidr(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false;
  const trimmedCidr = cidr.trim();
  const trimmedIp = ip.trim();

  // If no subnet mask specified, treat as exact IP match or prefix match fallback
  const [range, prefixStr] = trimmedCidr.split("/");
  if (trimmedIp === range) return true;

  if (range.includes(".")) {
    // IPv4 matching
    const prefixLen = prefixStr ? parseInt(prefixStr, 10) : 32;
    if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
    const ipNum = ipv4ToNum(trimmedIp);
    const rangeNum = ipv4ToNum(range);
    if (ipNum === null || rangeNum === null) return false;
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  } else if (range.includes(":")) {
    // IPv6 matching
    const prefixLen = prefixStr ? parseInt(prefixStr, 10) : 128;
    if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) return false;
    return ipv6Match(trimmedIp, range, prefixLen);
  }
  return false;
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }
  return num >>> 0;
}

function ipv6Match(ip1: string, ip2: string, prefixLen: number): boolean {
  try {
    const expand = (ip: string) => {
      let str = ip;
      if (str.includes("::")) {
        const parts = str.split("::");
        const left = parts[0] ? parts[0].split(":") : [];
        const right = parts[1] ? parts[1].split(":") : [];
        const missing = 8 - (left.length + right.length);
        const middle = new Array(missing).fill("0");
        str = [...left, ...middle, ...right].join(":");
      }
      return str
        .split(":")
        .map((h) => parseInt(h, 16).toString(2).padStart(16, "0"))
        .join("");
    };
    const b1 = expand(ip1);
    const b2 = expand(ip2);
    return b1.substring(0, prefixLen) === b2.substring(0, prefixLen);
  } catch {
    return false;
  }
}

// ---- Rate Limiter Helper ----
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // SECURITY: count-check and insert must happen atomically. Doing them as two
    // separate round trips (as before) lets concurrent requests for the same key
    // all read the same under-limit count before any insert commits, letting more
    // than maxAttempts through. check_and_increment_rate_limit (see
    // 20260725120000_atomic_rate_limit.sql) does both inside one Postgres function
    // call, serialized per-key with a transaction-scoped advisory lock.
    const { data, error } = await supabaseAdmin.rpc("check_and_increment_rate_limit", {
      p_key: key,
      p_max_attempts: maxAttempts,
      p_window_ms: windowMs,
    });

    if (error) {
      console.warn("rate_limit check failed, allowing fallback", error);
      return { allowed: true, remaining: 1, retryAfterMs: 0 };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.warn("rate_limit check returned no row, allowing fallback");
      return { allowed: true, remaining: 1, retryAfterMs: 0 };
    }

    if (!row.allowed) {
      return { allowed: false, remaining: 0, retryAfterMs: windowMs };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - row.current_count),
      retryAfterMs: 0,
    };
  } catch (e) {
    console.warn("rate limit exception", e);
    return { allowed: true, remaining: 1, retryAfterMs: 0 };
  }
}

// ---- Rotating Session OTP Factor ----
// SECURITY: the OTP value and its activation marker live in
// public.session_otp_secrets, a table with NO grant to authenticated/anon at all
// (see 20260725110000_session_otp_privacy_fix.sql). They must never be stored on or
// read from public.class_sessions, which enrolled students can SELECT in full via
// the "class_sessions_read_enrolled" RLS policy -- RLS filters rows, not columns.
export async function generateSessionOtp(sessionId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Generate deterministic 6-digit OTP derived from sessionId and secret HMAC
  const key = await importHmacKey();
  const bucket = Math.floor(Date.now() / 300_000); // 5-minute rotating window
  const bytes = enc.encode(`otp.${sessionId}.${bucket}`);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  // 6-digit code
  const num = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
  const otp = String(num % 1000000).padStart(6, "0");

  // Save to the service-role-only table, not class_sessions.
  await supabaseAdmin.from("session_otp_secrets").upsert({
    session_id: sessionId,
    session_otp: otp,
    otp_generated_at: new Date().toISOString(),
  });

  return otp;
}

export async function verifySessionOtp(sessionId: string, providedOtp: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("session_otp_secrets")
    .select("session_otp, otp_generated_at")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!data?.session_otp) return true; // If no OTP configured/generated, pass
  // Constant-time comparison to prevent timing side-channel on the 6-digit OTP.
  const a = enc.encode(data.session_otp.padEnd(6, "\0"));
  const b = enc.encode(providedOtp.trim().padEnd(6, "\0"));
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff === 0) return true;
  }

  // Also check adjacent 5-minute bucket for timing drift, trying every
  // available key version (current + previous, if a rotation is in progress).
  const keys = await importHmacKeys();
  const bucket = Math.floor(Date.now() / 300_000);
  for (const key of keys) {
    for (const b of [bucket - 1, bucket, bucket + 1]) {
      const bytes = enc.encode(`otp.${sessionId}.${b}`);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
      const num = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
      const otp = String(num % 1000000).padStart(6, "0");
      if (otp === providedOtp.trim()) return true;
    }
  }
  return false;
}

// Whether a teacher has ever activated the rotating-OTP gate for this session.
// Used by submitAttendance (Gate 2b) instead of reading session.session_otp off
// class_sessions, since that column no longer exists there (see above).
export async function isSessionOtpActive(sessionId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("session_otp_secrets")
    .select("session_otp")
    .eq("session_id", sessionId)
    .maybeSingle();
  return !!data?.session_otp;
}

// ---- Multi-frame Liveness Signal Analysis ----
export type LivenessSignal = {
  ear: number;
  yaw: number;
  pitch: number;
  faceArea: number;
  faceX: number;
  faceY: number;
};

export function computeEAR(landmarks: { x: number; y: number }[]): number {
  if (!landmarks || landmarks.length < 48) return 0.3; // Default open
  // Left eye landmarks: 36..41
  const dist = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
    Math.hypot(p1.x - p2.x, p1.y - p2.y);

  const l1 = dist(landmarks[37], landmarks[41]);
  const l2 = dist(landmarks[38], landmarks[40]);
  const l3 = dist(landmarks[36], landmarks[39]);
  const leftEar = l3 === 0 ? 0.3 : (l1 + l2) / (2 * l3);

  // Right eye landmarks: 42..47
  const r1 = dist(landmarks[43], landmarks[47]);
  const r2 = dist(landmarks[44], landmarks[46]);
  const r3 = dist(landmarks[42], landmarks[45]);
  const rightEar = r3 === 0 ? 0.3 : (r1 + r2) / (2 * r3);

  return (leftEar + rightEar) / 2;
}

export function estimateHeadPose(landmarks: { x: number; y: number }[]): {
  yaw: number;
  pitch: number;
} {
  if (!landmarks || landmarks.length < 34) return { yaw: 0, pitch: 0 };
  const noseTip = landmarks[30];
  const leftEye = landmarks[36];
  const rightEye = landmarks[45];

  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeWidth = Math.abs(rightEye.x - leftEye.x) || 1;

  // Yaw: horizontal offset of nose tip relative to eye center
  const yaw = ((noseTip.x - eyeCenter.x) / eyeWidth) * 90;
  // Pitch: vertical offset of nose tip relative to eye center (subtracting 0.0625 baseline offset)
  const pitchRatio = (noseTip.y - eyeCenter.y) / eyeWidth - 0.0625;
  const pitch = pitchRatio * 90;

  return { yaw, pitch };
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
}

export type LivenessVerificationResult = {
  passed: boolean;
  reason: string;
  signals?: Record<string, number>;
};

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4: Server-Side Liveness Signal Plausibility Gate
// ─────────────────────────────────────────────────────────────────────────────
// Called BEFORE verifyLivenessSignals() in submitAttendance.
//
// Why this is needed: verifyLivenessSignals() checks that the *pattern* of
// signals is consistent with a real blink/nod/turn — e.g., EAR drops during a
// blink. But a scripted client that knows the thresholds can fabricate
// perfectly plausible numbers without any camera or face-api.js involvement.
//
// This function adds a physics-level gate: if any value falls outside the range
// that a real face-api.js detector produces for real human faces, it must be a
// fabricated payload. Additional checks catch the simplest replay attack
// (identical arrays across different submissions).
//
// Limits are intentionally generous to avoid false positives for extreme poses,
// but tight enough to reject obviously synthetic numbers.
export function validateLivenessSignalPlausibility(
  signals: LivenessSignal[],
): { valid: boolean; reason: string } {
  if (!signals || signals.length < 1) {
    return { valid: false, reason: "plausibility_no_signals" };
  }

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];

    // EAR (Eye Aspect Ratio): physically bounded [0.05, 0.55]
    // < 0.05 = eyes clamped shut beyond anatomical minimum
    // > 0.55 = eyes wider than humanly possible
    if (!Number.isFinite(s.ear) || s.ear < 0.05 || s.ear > 0.55) {
      return {
        valid: false,
        reason: `plausibility_ear_out_of_range_frame${i}`,
      };
    }

    // Yaw: horizontal head rotation [-90, 90] degrees
    // face-api.js head pose estimation cannot produce |yaw| > 90 for a frontal camera
    if (!Number.isFinite(s.yaw) || s.yaw < -90 || s.yaw > 90) {
      return {
        valid: false,
        reason: `plausibility_yaw_out_of_range_frame${i}`,
      };
    }

    // Pitch: vertical head rotation [-60, 60] degrees
    // Extreme values beyond ±60° mean the head is nearly parallel to the camera
    if (!Number.isFinite(s.pitch) || s.pitch < -60 || s.pitch > 60) {
      return {
        valid: false,
        reason: `plausibility_pitch_out_of_range_frame${i}`,
      };
    }

    // faceArea: fraction of frame [0.005, 0.9]
    // < 0.005 = face is a single pixel (no real detection)
    // > 0.9   = face covers 90%+ of frame (impossible for a front camera)
    if (!Number.isFinite(s.faceArea) || s.faceArea < 0.005 || s.faceArea > 0.9) {
      return {
        valid: false,
        reason: `plausibility_faceArea_out_of_range_frame${i}`,
      };
    }

    // faceX / faceY: face centre must be within frame bounds [0, 1]
    if (
      !Number.isFinite(s.faceX) || s.faceX < 0 || s.faceX > 1 ||
      !Number.isFinite(s.faceY) || s.faceY < 0 || s.faceY > 1
    ) {
      return {
        valid: false,
        reason: `plausibility_facePosition_out_of_range_frame${i}`,
      };
    }
  }

  // Replay detection: all frames cannot be bit-for-bit identical across every field.
  // A legitimate liveness video always has *some* natural movement.
  if (signals.length >= 2) {
    const allIdentical = signals.every(
      (s) =>
        s.ear === signals[0].ear &&
        s.yaw === signals[0].yaw &&
        s.pitch === signals[0].pitch &&
        s.faceX === signals[0].faceX &&
        s.faceY === signals[0].faceY &&
        s.faceArea === signals[0].faceArea,
    );
    if (allIdentical) {
      return { valid: false, reason: "plausibility_replay_identical_frames" };
    }

    // At least one signal dimension must show non-zero variance across frames.
    // A scripted client that jitters values by 0.000001 would need to hit this threshold.
    const earVar = variance(signals.map((s) => s.ear));
    const yawVar = variance(signals.map((s) => s.yaw));
    const pitchVar = variance(signals.map((s) => s.pitch));
    const MIN_VARIANCE = 0.0001;
    if (earVar < MIN_VARIANCE && yawVar < MIN_VARIANCE && pitchVar < MIN_VARIANCE) {
      return { valid: false, reason: "plausibility_zero_signal_variance" };
    }
  }

  return { valid: true, reason: "ok" };
}

export function verifyLivenessSignals(
  action: LivenessAction,
  signals: LivenessSignal[],
): LivenessVerificationResult {
  if (!signals || signals.length < 1) {
    return { passed: false, reason: "insufficient_frames" };
  }

  // 1. Anti-spoof heuristic: static photo detection (detects static paper photos / frozen screens)
  // Widened to >= 2 signals (was >= 3) — a scripted client sending exactly 2 signals
  // should still be caught if positions/sizes are identical.
  if (signals.length >= 2) {
    const xVar = variance(signals.map((s) => s.faceX));
    const yVar = variance(signals.map((s) => s.faceY));
    const areaVar = variance(signals.map((s) => s.faceArea));

    if (xVar < 0.00001 && yVar < 0.00001 && areaVar < 0.0001) {
      return { passed: false, reason: "static_photo_detected", signals: { xVar, yVar, areaVar } };
    }
  }

  // 2. Action-specific verification using real signal deltas against baseline (first frame).
  const ears = signals.map((s) => s.ear);
  const yaws = signals.map((s) => s.yaw);
  const pitches = signals.map((s) => s.pitch);

  const minEar = Math.min(...ears);
  const maxEar = Math.max(...ears);
  const earDrop = maxEar - minEar;

  if (action === "blink") {
    // Real blink: EAR drops below 0.28 AND the drop magnitude exceeds 0.04.
    // Both conditions must be true — a single always-true clause (|| signals.length >= 1)
    // previously made the reject branch unreachable.
    if (minEar < 0.28 && earDrop > 0.04) {
      return { passed: true, reason: "blink_detected", signals: { minEar, earDrop } };
    }
    return { passed: false, reason: "blink_not_detected", signals: { minEar, earDrop } };
  }

  // Head rotation and nod actions require >= 2 frames to compute a delta.
  // A single frame cannot show movement — reject with a clear message.
  if (signals.length < 2) {
    return {
      passed: false,
      reason: "insufficient_frames",
      signals: { frameCount: signals.length },
    };
  }

  const baselineYaw = yaws[0];
  const baselinePitch = pitches[0];
  const MIN_YAW_DELTA_DEG = 12;
  const MIN_PITCH_DELTA_DEG = 8;

  if (action === "turn_left") {
    // Nose must move LEFT from baseline: min(yaws) should be notably negative relative to start.
    const minYaw = Math.min(...yaws);
    if (minYaw <= baselineYaw - MIN_YAW_DELTA_DEG) {
      return { passed: true, reason: "turn_left_detected", signals: { baselineYaw, minYaw } };
    }
    return { passed: false, reason: "turn_left_not_detected", signals: { baselineYaw, minYaw } };
  }

  if (action === "turn_right") {
    // Nose must move RIGHT from baseline: max(yaws) should be notably positive relative to start.
    const maxYaw = Math.max(...yaws);
    if (maxYaw >= baselineYaw + MIN_YAW_DELTA_DEG) {
      return { passed: true, reason: "turn_right_detected", signals: { baselineYaw, maxYaw } };
    }
    return { passed: false, reason: "turn_right_not_detected", signals: { baselineYaw, maxYaw } };
  }

  if (action === "nod") {
    // Chin must dip downward: max(pitches) should exceed baseline by threshold.
    const maxPitch = Math.max(...pitches);
    if (maxPitch >= baselinePitch + MIN_PITCH_DELTA_DEG) {
      return { passed: true, reason: "nod_detected", signals: { baselinePitch, maxPitch } };
    }
    return { passed: false, reason: "nod_not_detected", signals: { baselinePitch, maxPitch } };
  }

  return { passed: false, reason: "unknown_action" };
}

// FIX 9: Threshold raised 0.85 → 0.88.
// At 0.85 a face-swap between two physically similar people (siblings, twins)
// could slip through mid-stream. 0.88 is the sweet spot: still passes natural
// frame-to-frame variation (lighting, slight pose change), but rejects a switch
// to a different person's face, which typically drops similarity to 0.60–0.80.
export function verifyFrameIdentityConsistency(
  embeddings: number[][],
  threshold: number = 0.88,
): boolean {
  if (!embeddings || embeddings.length < 2) return true;
  const first = embeddings[0];
  for (let i = 1; i < embeddings.length; i++) {
    const sim = cosineSimilarity(first, embeddings[i]);
    if (sim < threshold) return false;
  }
  return true;
}

// Encrypt a photo string (e.g. data URL or base64) with AES-GCM-256
export async function encryptPhoto(photoDataUrl: string): Promise<string> {
  const bytes = enc.encode(photoDataUrl);
  const version = currentBiometricKeyVersion();
  const key = await importAesKeyForVersion(version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      bytes as BufferSource,
    ),
  );

  let out: Uint8Array;
  if (version === 0) {
    out = new Uint8Array(iv.byteLength + ct.byteLength);
    out.set(iv, 0);
    out.set(ct, iv.byteLength);
  } else {
    out = new Uint8Array(2 + iv.byteLength + ct.byteLength);
    out[0] = AES_KEY_VERSION_MARKER;
    out[1] = version;
    out.set(iv, 2);
    out.set(ct, 2 + iv.byteLength);
  }

  return `\\x${Array.from(out)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

// Decrypt an AES-GCM-256 encrypted photo string
export async function decryptPhoto(hexOrCiphertext: string): Promise<string> {
  let bytes: Uint8Array;
  if (typeof hexOrCiphertext === "string" && hexOrCiphertext.startsWith("\\x")) {
    const hex = hexOrCiphertext.slice(2);
    bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
  } else if (typeof hexOrCiphertext === "string") {
    const hex = hexOrCiphertext;
    bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
  } else {
    bytes = new Uint8Array(hexOrCiphertext);
  }

  let pt: Uint8Array;
  if (bytes.length > 14 && bytes[0] === AES_KEY_VERSION_MARKER) {
    try {
      const version = bytes[1];
      const key = await importAesKeyForVersion(version);
      const iv = bytes.slice(2, 14);
      const ct = bytes.slice(14);
      pt = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv as BufferSource },
          key,
          ct as BufferSource,
        ),
      );
      return new TextDecoder().decode(pt);
    } catch {
      // Fall through to legacy
    }
  }

  const key = await importAesKeyForVersion(0);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  pt = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    ),
  );
  return new TextDecoder().decode(pt);
}
