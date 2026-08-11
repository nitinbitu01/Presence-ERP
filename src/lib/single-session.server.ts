import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const registerUserActiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch existing metadata
    const { data: userRes, error: fetchErr } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (fetchErr) throw new Error(fetchErr.message);

    const existingMetadata = userRes.user.user_metadata || {};
    
    // Update active_session_id in user_metadata
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      context.userId,
      {
        user_metadata: {
          ...existingMetadata,
          active_session_id: data.sessionId,
          last_session_registered_at: new Date().toISOString(),
        },
      },
    );

    if (updateErr) throw new Error(updateErr.message);
    return { success: true, sessionId: data.sessionId };
  });

export const validateUserActiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: userRes, error } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );

    if (error || !userRes?.user) {
      return { valid: false, reason: "user_not_found" };
    }

    const currentActiveSessionId = userRes.user.user_metadata?.active_session_id;

    // If no active_session_id is set yet, register current one
    if (!currentActiveSessionId) {
      return { valid: true };
    }

    const isMatch = currentActiveSessionId === data.sessionId;
    return {
      valid: isMatch,
      reason: isMatch ? null : "concurrent_login_detected",
    };
  });
