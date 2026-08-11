import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export async function isFeatureEnabled(key: string, defaultValue = true): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("feature_flags")
      .select("is_enabled")
      .eq("key", key)
      .maybeSingle();

    return data ? data.is_enabled : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

let demoModeCache: { value: boolean; expiresAt: number } | null = null;

export async function isDemoMode(): Promise<boolean> {
  if (process.env.VITE_DEMO_MODE === 'true') return true;
  if (demoModeCache && Date.now() < demoModeCache.expiresAt) {
    return demoModeCache.value;
  }
  const val = await isFeatureEnabled('demo_mode', false);
  demoModeCache = { value: val, expiresAt: Date.now() + 30_000 };
  return val;
}

export const listFeatureFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { checkIsAdmin } = await import("@/lib/admin.functions");
    const isAdmin = await checkIsAdmin(context.userId, context.email);
    if (!isAdmin) throw new Error("Forbidden: administrator access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("feature_flags")
      .select("key, is_enabled, description, updated_at")
      .order("key");

    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const toggleFeatureFlagFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ key: z.string(), isEnabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { checkIsAdmin } = await import("@/lib/admin.functions");
    const isAdmin = await checkIsAdmin(context.userId, context.email);
    if (!isAdmin) throw new Error("Forbidden: administrator access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("feature_flags").upsert({
      key: data.key,
      is_enabled: data.isEnabled,
      updated_at: new Date().toISOString(),
    });

    if (error) throw new Error(error.message);
    return { success: true, key: data.key, isEnabled: data.isEnabled };
  });
