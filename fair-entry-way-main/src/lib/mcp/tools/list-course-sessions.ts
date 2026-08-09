import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_course_sessions",
  title: "List class sessions for a course",
  description:
    "Return scheduled class sessions for a course the signed-in user teaches or is enrolled in. RLS applies.",
  inputSchema: {
    course_id: z.string().uuid().describe("UUID of the course."),
    limit: z.number().int().describe("Maximum sessions to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ course_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const capped = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 200);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("class_sessions")
      .select("*")
      .eq("course_id", course_id)
      .order("starts_at", { ascending: false })
      .limit(capped);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const rows = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { rows },
    };
  },
});
