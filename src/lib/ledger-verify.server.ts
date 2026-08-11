import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createHash } from 'node:crypto';

function recomputeHash(
  row: { session_id: string; student_id: string; decision: string; similarity: number | null; trust_score: number | null; created_at: string },
  prevHash: string | null,
): string {
  const payload =
    (prevHash ?? 'GENESIS') + '|' +
    row.session_id + '|' +
    row.student_id + '|' +
    row.decision + '|' +
    (row.similarity?.toString() ?? '') + '|' +
    (row.trust_score?.toString() ?? '') + '|' +
    row.created_at;
  return createHash('sha256').update(payload).digest('hex');
}

export const verifyLedgerChain = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await supabaseAdmin
      .from('attendance_ledger')
      .select('id, session_id, student_id, decision, similarity, trust_score, trust_breakdown, record_hash, previous_entry_id, created_at, profiles:student_id(display_name, roll_no)')
      .eq('session_id', data.sessionId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    const hashMap = new Map<string, string>();
    const results = (rows ?? []).map((row: any) => {
      const prevHash = row.previous_entry_id ? (hashMap.get(row.previous_entry_id) ?? null) : null;
      const recomputed = recomputeHash(row, prevHash);
      const verified = row.record_hash ? recomputed === row.record_hash : true; // no hash yet = legacy row
      hashMap.set(row.id, row.record_hash ?? recomputed);
      return {
        id: row.id,
        studentName: row.profiles?.display_name ?? 'Unknown',
        rollNo: row.profiles?.roll_no ?? '',
        decision: row.decision,
        similarity: row.similarity,
        trustScore: row.trust_score,
        trustBreakdown: row.trust_breakdown,
        recordHash: row.record_hash,
        recomputedHash: recomputed,
        verified,
        createdAt: row.created_at,
      };
    });

    return { rows: results, allVerified: results.every((r: any) => r.verified), count: results.length };
  });

export const attemptLedgerTamper = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ledgerId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    // Try a direct UPDATE — the append_only trigger SHOULD reject this
    try {
      const { error } = await supabaseAdmin
        .from('attendance_ledger')
        .update({ decision: 'TAMPERED' as any })
        .eq('id', data.ledgerId);
      if (error) {
        return {
          tamperBlocked: true,
          message: `Tamper BLOCKED by append-only trigger: ${error.message}`,
          dbError: error.message,
        };
      }
      return {
        tamperBlocked: false,
        message: 'WARNING: Tamper was NOT blocked — append-only trigger may be missing!',
      };
    } catch (e: any) {
      return {
        tamperBlocked: true,
        message: `Tamper BLOCKED: ${e.message}`,
        dbError: e.message,
      };
    }
  });
