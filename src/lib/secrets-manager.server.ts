/**
 * Phase 5.2 — Secrets Manager (Cloudflare Secrets Store wrapper)
 *
 * Provides a unified interface for reading and rotating secrets whether they
 * live in:
 *   a) Plain env vars  (local dev / legacy)   — process.env[name]
 *   b) Cloudflare Secrets Store               — env.SECRETS.get(name) binding
 *
 * All existing read paths (attendance-crypto, webauthn, resend, razorpay) stay
 * unchanged: they call requireKeyMaterial(name) which internally calls getSecret().
 * Only the *write* (rotation) side gains a management surface via admin UI.
 *
 * Security contract:
 *   - getSecret() NEVER returns a value to the client. It is server-only.
 *   - listManagedSecrets() returns names + metadata only — no values.
 *   - rotateSecret() validates the caller is admin before writing.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "@/lib/errors";
import { z } from "zod";

// ── Canonical list of secrets this application manages ────────────────────
// Any secret referenced by application code MUST appear here so the admin
// rotation UI and audit log can track it.
export const MANAGED_SECRETS = [
  {
    name: "BIOMETRIC_ENC_KEY",
    category: "biometric",
    description: "AES-GCM-256 master key for face embedding encryption (version 0 / legacy)",
  },
  {
    name: "BIOMETRIC_ENC_KEY_V1",
    category: "biometric",
    description: "AES-GCM-256 key version 1 (set BIOMETRIC_ENC_KEY_CURRENT_VERSION=1 to activate)",
  },
  {
    name: "BIOMETRIC_ENC_KEY_V2",
    category: "biometric",
    description: "AES-GCM-256 key version 2 (future rotation slot)",
  },
  {
    name: "LIVENESS_HMAC_KEY",
    category: "liveness",
    description: "HMAC-SHA256 signing key for liveness challenges and WebAuthn registration tokens",
  },
  {
    name: "LIVENESS_HMAC_KEY_PREVIOUS",
    category: "liveness",
    description:
      "Previous HMAC key for grace-window rotation (remove after ~5 min rotation window)",
  },
  { name: "RESEND_API_KEY", category: "email", description: "Resend transactional email API key" },
  {
    name: "RAZORPAY_KEY_SECRET",
    category: "payment",
    description: "Razorpay payment gateway secret",
  },
  {
    name: "AWS_REKOGNITION_ACCESS_KEY",
    category: "liveness",
    description: "AWS IAM access key for Rekognition Face Liveness",
  },
  {
    name: "AWS_REKOGNITION_SECRET_KEY",
    category: "liveness",
    description: "AWS IAM secret key for Rekognition Face Liveness",
  },
  {
    name: "CLOUDFLARE_API_TOKEN",
    category: "infra",
    description: "Cloudflare API token for Secrets Store write operations (admin rotation)",
  },
] as const;

export type ManagedSecretName = (typeof MANAGED_SECRETS)[number]["name"];

export interface SecretMetadata {
  name: string;
  category: string;
  description: string;
  source: "env" | "secrets_store" | "absent";
  isPresent: boolean;
}

// ── Core read helper ───────────────────────────────────────────────────────

import { getOptionalSecret } from "./cf-env.server";

/**
 * getSecret — reads a secret from env var or Cloudflare binding object.
 * Never call this from client components.
 */
export function getSecret(name: string): string | undefined {
  return getOptionalSecret(name);
}

/**
 * requireSecret — throws if the secret is absent. Drop-in replacement for
 * the existing requireKeyMaterial() pattern scattered across crypto files.
 */
export function requireSecret(name: string): string {
  const val = getSecret(name);
  if (!val) {
    throw new PresenceErpError(
      "INTERNAL_ERROR",
      `Required secret "${name}" is not configured. Add it via wrangler secret put ${name} or the admin Secrets panel.`,
    );
  }
  return val;
}

// ── Server functions ───────────────────────────────────────────────────────

/**
 * listManagedSecrets — returns metadata about every known secret.
 * Values are NEVER included. Presence is indicated by a boolean.
 */
export const listManagedSecrets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SecretMetadata[]> => {
    // Only admins may view the secrets inventory.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    if (!roles?.some((r) => r.role === "admin")) {
      throw new PresenceErpError(
        "FORBIDDEN",
        "Only administrators may view the secrets inventory.",
      );
    }

    return MANAGED_SECRETS.map((s) => {
      const val = getSecret(s.name);
      return {
        name: s.name,
        category: s.category,
        description: s.description,
        source: val ? "env" : "absent",
        isPresent: !!val,
      };
    });
  });

/**
 * rotateSecret — writes a new secret value via Cloudflare Workers API.
 * The new value flows through wrangler → Cloudflare's encrypted secrets store
 * → the Worker's env binding on next deploy / restart.
 *
 * This requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars to be
 * set. In environments without them, the function returns an actionable error
 * rather than silently failing.
 */
export const rotateSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        secretName: z.string().min(1),
        newValue: z.string().min(8, "Secret must be at least 8 characters"),
        confirm: z.literal(true, { message: "You must explicitly confirm the rotation" }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Guard: admins only.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    if (!roles?.some((r) => r.role === "admin")) {
      throw new PresenceErpError("FORBIDDEN", "Only administrators may rotate secrets.");
    }

    // Guard: only known secrets may be rotated (prevents open-ended writes).
    const knownNames = MANAGED_SECRETS.map((s) => s.name);
    if (!knownNames.includes(data.secretName as ManagedSecretName)) {
      throw new PresenceErpError(
        "VALIDATION_FAILED",
        `"${data.secretName}" is not a managed secret. Add it to MANAGED_SECRETS first.`,
      );
    }

    const cfToken = getSecret("CLOUDFLARE_API_TOKEN");
    const cfAccountId = getSecret("CLOUDFLARE_ACCOUNT_ID");
    const cfWorkerName = getSecret("CLOUDFLARE_WORKER_NAME") ?? "tanstack-start-ts";

    if (!cfToken || !cfAccountId) {
      // Graceful degradation: tell the admin how to do it manually.
      return {
        success: false,
        message:
          `CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set. ` +
          `Run manually: echo "${data.newValue}" | npx wrangler secret put ${data.secretName}`,
        manual: true,
      };
    }

    // Cloudflare Workers API: PUT /accounts/:account_id/workers/scripts/:script_name/secrets
    const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/workers/scripts/${cfWorkerName}/secrets`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: data.secretName, text: data.newValue, type: "secret_text" }),
    });

    const json = (await resp.json()) as { success: boolean; errors?: { message: string }[] };

    if (!json.success) {
      throw new PresenceErpError(
        "INTERNAL_ERROR",
        `Cloudflare API error: ${json.errors?.map((e) => e.message).join("; ")}`,
      );
    }

    // Audit log.
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "rotate_secret",
      target_table: "secrets",
      target_id: context.userId,
      details: { secretName: data.secretName, rotatedAt: new Date().toISOString() },
    });

    return { success: true, message: `Secret "${data.secretName}" rotated successfully.` };
  });
