import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in user's Presence profile and roles.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    const [profileRes, rolesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, display_name, roll_no, department_id, program_id, current_semester")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    if (profileRes.error) {
      return { content: [{ type: "text", text: profileRes.error.message }], isError: true };
    }
    const payload = {
      user_id: userId,
      email: ctx.getUserEmail() ?? null,
      profile: profileRes.data ?? null,
      roles: (rolesRes.data ?? []).map((r) => r.role as string),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
