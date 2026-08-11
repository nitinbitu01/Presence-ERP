// ─────────────────────────────────────────────────────────────────
// Feedback Collection
//
// Stores thumbs-up/thumbs-down ratings on AI responses.
// Storage: ai_feedback table (cast to any — not in generated types)
// ─────────────────────────────────────────────────────────────────

export interface AIFeedback {
  id: string;
  userId: string;
  question: string;
  answer: string;
  wasHelpful: boolean;
  correction?: string;
  createdAt: string;
}

// ── Submit Feedback ───────────────────────────────────────────────

export async function submitFeedback(
  userId: string,
  question: string,
  answer: string,
  wasHelpful: boolean,
  correction?: string,
): Promise<void> {
  const feedback: AIFeedback = {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId,
    question: question.slice(0, 300),
    answer: answer.slice(0, 500),
    wasHelpful,
    correction: correction?.slice(0, 500),
    createdAt: new Date().toISOString(),
  };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("ai_feedback").insert({
      id: feedback.id,
      user_id: feedback.userId,
      question: feedback.question,
      answer: feedback.answer,
      was_helpful: feedback.wasHelpful,
      correction: feedback.correction ?? null,
      created_at: feedback.createdAt,
    });
  } catch (err) {
    console.warn("[Feedback] Failed to save feedback:", err);
  }
}

// ── Admin: Surface worst answers ─────────────────────────────────

export async function getWorstAnswers(limit = 10): Promise<AIFeedback[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("ai_feedback")
      .select("*")
      .eq("was_helpful", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data ?? []).map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      question: r.question,
      answer: r.answer,
      wasHelpful: r.was_helpful,
      correction: r.correction,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
