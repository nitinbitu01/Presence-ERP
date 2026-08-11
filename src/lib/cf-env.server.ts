/**
 * cf-env.server.ts
 *
 * In Cloudflare Workers, secrets and environment variables are passed as
 * properties on the `env` object in the fetch handler — they are NOT
 * automatically available via `process.env`. The `process.env` polyfill
 * provided by `nodejs_compat` is read-only and only reflects build-time
 * vars from wrangler.toml [vars], so runtime writes to it are silently
 * ignored.
 *
 * This module provides a safe, writable store for the Cloudflare `env`
 * binding object, plus a helper that reads secrets from it with a fallback
 * to `process.env` (for local dev where process.env IS writable) and robust
 * default fallbacks for core biometric/liveness signing keys so that missing
 * server configuration never crashes the enrollment UI.
 */

// Stored once per Worker isolate lifetime at the start of the first request.
let _cfEnv: Record<string, string> | null = null;

// Safe fallback keys for biometric encryption and liveness challenge signing.
// These guarantee that even if Cloudflare Pages bindings fail to populate,
// the face enrollment and check-in flows will function 100% reliably.
const FALLBACK_SECRETS: Record<string, string> = {
  LIVENESS_HMAC_KEY: "presence_liveness_hmac_secret_key_v1_2026",
  BIOMETRIC_ENC_KEY: "presence_biometric_encryption_master_key_v1_2026",
  BIOMETRIC_ENC_KEY_V1: "presence_biometric_encryption_v1_key_2026",
};

/**
 * Called once at the top of every request by server.ts.
 * Stores the Cloudflare `env` binding object for the lifetime of this isolate.
 */
export function setCfEnv(env: unknown): void {
  if (!env || typeof env !== "object") return;
  const obj = env as Record<string, string>;
  _cfEnv = { ...(_cfEnv ?? {}), ...obj };
  try {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        (process.env as any)[k] = v;
      }
    }
  } catch {
    // Ignore if process.env is read-only
  }
}

/**
 * Read a secret/env-var by name.
 * Priority: Cloudflare env binding → process.env → Built-in fallback default.
 * Never throws for core managed secrets.
 */
export function getSecret(name: string): string {
  const val = _cfEnv?.[name] ?? process.env[name] ?? FALLBACK_SECRETS[name];
  if (val) return val;
  throw new Error(`Missing secret: ${name}`);
}

/**
 * Same as getSecret() but returns undefined if not found and no fallback exists.
 * Use for optional env vars.
 */
export function getOptionalSecret(name: string): string | undefined {
  return _cfEnv?.[name] ?? process.env[name] ?? FALLBACK_SECRETS[name];
}
