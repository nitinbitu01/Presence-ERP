import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  startDeviceRegistration,
  finishDeviceRegistration,
  hasRegisteredDevice,
  hasWebauthnExemption,
  getWebauthnPolicy,
  decideDeviceGateOutcome,
} from "./webauthn.server";

// ---------- Start device (platform authenticator) registration ----------
export const startWebauthnRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email ?? context.userId;
    const req = getRequest();
    return await startDeviceRegistration(context.userId, email, req ?? null);
  });

// ---------- Finish device registration ----------
export const finishWebauthnRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        response: z.any(),
        envelope: z.object({
          userId: z.string(),
          nonce: z.string(),
          issuedAt: z.number(),
          ttlMs: z.number(),
          sig: z.string(),
        }),
        deviceLabel: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const req = getRequest();
    return await finishDeviceRegistration(
      context.userId,
      data.response,
      data.envelope,
      data.deviceLabel,
      req ?? null,
    );
  });

// ---------- List / remove my registered devices ----------
export const listMyWebauthnDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("webauthn_credentials")
      .select("id, device_label, created_at, last_used_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const removeWebauthnDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("webauthn_credentials")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Whether the caller has any device registered ----------
export const hasWebauthnDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { registered: await hasRegisteredDevice(context.userId) };
  });

// ---------- Pre-flight status for the attend page UI ----------
export const getWebauthnStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const deviceRegistered = await hasRegisteredDevice(context.userId);
    const isExempt = deviceRegistered ? false : await hasWebauthnExemption(context.userId);
    const policy = getWebauthnPolicy();
    const outcome = decideDeviceGateOutcome({ deviceRegistered, isExempt, policy });

    const canCheckIn = outcome.outcome !== "blocked";
    const message =
      outcome.outcome === "blocked"
        ? "WebAuthn device registration is required before you can mark attendance. Please register your device in Security Settings → Register This Device."
        : outcome.outcome === "pass_grace_warn"
          ? "Your device isn't registered for secure check-in yet. This will be required soon — register now in Security Settings to avoid being blocked later."
          : null;

    return { deviceRegistered, isExempt, policy, canCheckIn, message };
  });

// ---------- Register Virtual WebAuthn Key (Hackathon Demo Mode Fallback) ----------
export const registerDemoVirtualWebauthnDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { checkIsAdmin } = await import("@/lib/admin.functions");
    const isAdmin = await checkIsAdmin(context.userId, context.email);
    if (!isAdmin) throw new Error("Forbidden: administrator access required");

    const { isDemoMode } = await import("@/lib/feature-flags.server");
    if (!(await isDemoMode())) {
      throw new Error("Demo mode is not active. Virtual WebAuthn keys are only available in demo mode.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const credId = "demo_virtual_key_" + context.userId.slice(0, 8);
    const { error } = await supabaseAdmin.from("webauthn_credentials").upsert(
      {
        user_id: context.userId,
        credential_id: credId,
        public_key: "demo_virtual_public_key_b64u",
        counter: 1,
        device_label: "Virtual Security Key (Hackathon Demo Mode)",
        transports: ["internal"],
      },
      { onConflict: "user_id,credential_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, message: "Virtual Demo WebAuthn Security Key successfully registered!" };
  });
