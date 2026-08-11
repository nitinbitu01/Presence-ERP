// ─────────────────────────────────────────────────────────────────
// Feedback Server Function
//
// Exposes submitFeedback as a TanStack Start server function so
// it can be safely called from client components without leaking
// the supabaseAdmin server-only import into the client bundle.
// ─────────────────────────────────────────────────────────────────

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const FeedbackSchema = z.object({
  question: z.string().max(300),
  answer: z.string().max(500),
  wasHelpful: z.boolean(),
  correction: z.string().max(500).optional(),
});

export const saveFeedback = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    let payload = input;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch {}
    }
    if (payload && typeof payload === 'object' && 'data' in payload && (payload as any).data) {
      payload = (payload as any).data;
    }
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch {}
    }
    return FeedbackSchema.parse(payload ?? {});
  })
  .handler(async ({ data, context }) => {
    const userId = context.userId as string;
    const { submitFeedback } = await import('@/lib/presence-ai/feedback');
    await submitFeedback(userId, data.question, data.answer, data.wasHelpful, data.correction);
    return { ok: true };
  });
