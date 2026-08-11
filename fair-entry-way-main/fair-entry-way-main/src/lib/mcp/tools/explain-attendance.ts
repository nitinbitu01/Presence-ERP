import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "explain_attendance_decision",
  title: "Explain an attendance decision",
  description:
    "Explain why a specific attendance record was marked present/absent/review, citing the underlying gate signals and trust score breakdown.",
  inputSchema: {
    ledgerId: z.string().optional().describe("Specific ledger row ID to explain"),
    courseName: z.string().optional().describe("Course name to search by"),
    date: z.string().optional().describe("Date to search by (YYYY-MM-DD)"),
  },
  handler: async (input: any, ctx: any) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return { content: [{ type: "text" as const, text: "Supabase credentials not configured" }] };
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the user ID from MCP context
    const userId = ctx.getUserId?.() ?? null;

    let query = supabase
      .from("attendance_ledger")
      .select(
        "id, session_id, student_id, decision, similarity, gate_reasons, trust_score, trust_breakdown, reason_code, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(5);

    if (userId) query = query.eq("student_id", userId);
    if (input.ledgerId) query = query.eq("id", input.ledgerId);

    const { data: rows, error } = await query;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    if (!rows?.length)
      return {
        content: [
          { type: "text" as const, text: "No attendance records found matching your query." },
        ],
      };

    const explanations = rows.map((row: any) => {
      const gates = row.gate_reasons ?? {};
      const breakdown = row.trust_breakdown?.components ?? [];
      let text = `## Attendance Record (${new Date(row.created_at).toLocaleDateString()})\n`;
      text += `**Decision**: ${row.decision}\n`;
      text += `**Reason Code**: ${row.reason_code ?? "N/A"}\n`;
      text += `**Trust Score**: ${row.trust_score ?? "N/A"}/100\n\n`;
      text += `### Gate Signal Breakdown:\n`;
      for (const comp of breakdown) {
        const icon = comp.achieved > 0.7 ? "✅" : comp.achieved < 0.3 ? "❌" : "⚠️";
        text += `${icon} **${comp.label}** (weight: ${comp.weight}): ${comp.detail}\n`;
      }
      if (row.similarity != null) {
        text += `\n**Face Similarity**: ${(row.similarity * 100).toFixed(1)}%\n`;
      }
      return text;
    });

    return {
      content: [{ type: "text" as const, text: explanations.join("\n---\n") }],
    };
  },
});
