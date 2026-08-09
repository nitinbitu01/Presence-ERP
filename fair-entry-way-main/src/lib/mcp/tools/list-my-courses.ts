import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_my_courses",
  title: "List my courses",
  description:
    "List courses relevant to the signed-in user: courses they teach and courses they are enrolled in.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();

    const [teaching, enrolled] = await Promise.all([
      supabase
        .from("courses")
        .select("id, code, name, department_id, semester_id")
        .eq("teacher_id", userId),
      supabase
        .from("enrollments")
        .select(
          "course_id, semester_id, courses:course_id(id, code, name, department_id, semester_id)",
        )
        .eq("student_id", userId),
    ]);

    if (teaching.error) {
      return { content: [{ type: "text", text: teaching.error.message }], isError: true };
    }
    if (enrolled.error) {
      return { content: [{ type: "text", text: enrolled.error.message }], isError: true };
    }

    const payload = {
      teaching: teaching.data ?? [],
      enrolled: (enrolled.data ?? []).map((row) => ({
        semester_id: row.semester_id,
        course: row.courses,
      })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
