// ─────────────────────────────────────────────────────────────────
// askPresence — World-class AI attendance assistant
//
// Pipeline (upgraded):
//   Auth → Rate Limit → Injection Guard (2-layer)
//   → Memory Recall (parallel) → DB (parallel)
//   → Forecast (parallel) → Cache
//   → RAG → Token Trim → Build Prompt (with Memory + Forecast)
//   → Stream → Claim Verify → Validate → Cache → Telemetry
//   → Memory Update (async, post-response)
// ─────────────────────────────────────────────────────────────────

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

import type {
  AttendanceRecord,
  ChatMessage,
  SourceRecord,
  StreamMetadata,
} from '@/lib/presence-ai/types';
import { AI_CONFIG } from '@/lib/presence-ai/config';
import { checkRateLimit } from '@/lib/presence-ai/rate-limiter';
import { getCached, setCached } from '@/lib/presence-ai/cache';
import {
  fastInjectCheck,
  semanticInjectCheck,
} from '@/lib/presence-ai/injection-guard';
import { trimToContextWindow } from '@/lib/presence-ai/token-utils';
import { retrieveRelevantRecords } from '@/lib/presence-ai/rag';
import {
  buildSystemPrompt,
} from '@/lib/presence-ai/prompt-builder';
import { streamOpenAI } from '@/lib/presence-ai/openai-stream';
import { validateOutput } from '@/lib/presence-ai/output-validator';
import { track } from '@/lib/presence-ai/telemetry';

// ── Type-only imports for intelligence layer (dynamic at runtime) ──
import type { StudentMemory } from '@/lib/presence-ai/memory';
import type { AttendanceForecast } from '@/lib/presence-ai/predictor';

export type { ChatMessage, SourceRecord, StreamMetadata };

// ─── Extended Metadata (includes verification + forecast) ─────────

export interface PresenceStreamMetadata extends StreamMetadata {
  verificationBadge?: { label: string; variant: 'verified' | 'inferred' | 'corrected' };
  forecast?: {
    currentRate: number;
    riskLevel: string;
    headline: string;
    sessionsNeededToRecover: number;
    nextSessionMinutes: number | null;
  };
  memoryActive?: boolean;
}

// ─── Input Schema ──────────────────────────────────────────────────

const InputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Please enter a question')
    .max(AI_CONFIG.maxQuestionLength, `Max ${AI_CONFIG.maxQuestionLength} characters`),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(2000),
      }),
    )
    .max(AI_CONFIG.maxHistoryMessages)
    .default([]),
  stream: z.boolean().default(true),
});

// ─── Rule-Based Fallback ──────────────────────────────────────────

// ─── World-Class Intelligent Answer Engine (no API key required) ──────────────
// Understands any attendance question and gives smart, data-driven answers

function smartAnswer(question: string, records: AttendanceRecord[], profile: any): string {
  const q = question.toLowerCase().trim();
  const name = profile?.display_name ?? profile?.email?.split("@")[0] ?? "Student";

  // ── Helpers ────────────────────────────────────────────────────────────────
  const validRecords = records.filter((r) => r.reason_code !== "session_not_found" && r.decision);
  const presentRecords = validRecords.filter((r) => r.decision === "present");
  const absentRecords = validRecords.filter((r) => r.decision !== "present");
  const totalValid = validRecords.length;
  const totalPresent = presentRecords.length;
  const pct = totalValid > 0 ? ((totalPresent / totalValid) * 100).toFixed(1) : "0.0";
  const latestRecord = validRecords[0] ?? null;
  const latestAbsent = absentRecords[0] ?? null;
  const avgTrust = totalValid > 0
    ? (validRecords.reduce((s, r) => s + (r.trust_score ?? 0), 0) / totalValid).toFixed(0)
    : "N/A";

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });

  const eligibilityStatus = (rate: number) => {
    if (rate >= 85) return "✅ **Excellent** — You are well above the 85% threshold.";
    if (rate >= 75) return "🟡 **Safe** — You meet the 75% minimum requirement.";
    if (rate >= 65) return "🟠 **At Risk** — Below 75%. You need to improve urgently.";
    return "🔴 **Critical** — Below 65%. You may be barred from exams.";
  };

  const sessionsNeededFor75 = () => {
    if (totalValid === 0) return null;
    const rate = totalPresent / totalValid;
    if (rate >= 0.75) return 0;
    // solve: (totalPresent + x) / (totalValid + x) = 0.75
    const x = Math.ceil((0.75 * totalValid - totalPresent) / (1 - 0.75));
    return Math.max(0, x);
  };

  const sessionsNeededFor85 = () => {
    if (totalValid === 0) return null;
    const rate = totalPresent / totalValid;
    if (rate >= 0.85) return 0;
    const x = Math.ceil((0.85 * totalValid - totalPresent) / (1 - 0.85));
    return Math.max(0, x);
  };

  const getAbsenceReason = (r: AttendanceRecord) => {
    const code = r.reason_code ?? "unknown";
    const reasonMap: Record<string, string> = {
      session_not_found: "No active session was open when you attempted check-in.",
      face_mismatch: "Your face scan did not match the enrolled photo with sufficient confidence.",
      location_out_of_range: "Your GPS location was outside the classroom geofence boundary.",
      device_not_registered: "Your device has not been registered for biometric authentication.",
      duplicate_checkin: "A check-in was already recorded for this session from another device.",
      time_expired: "The session check-in window had already closed.",
      webauthn_failed: "Your device attestation (fingerprint/PIN) verification failed.",
      low_trust_score: "Your composite trust score was below the minimum threshold.",
      voice_mismatch: "Your voice signature did not match the enrolled voice profile.",
      manual_reject: "A manual review resulted in this session being marked absent.",
    };
    return reasonMap[code] ?? `The system recorded reason code: "${code}". Contact your instructor for details.`;
  };

  // ── Intent Detection ───────────────────────────────────────────────────────

  const is = (...keywords: string[]) => keywords.some((k) => q.includes(k));

  // GREETING / INTRO
  if (
    /^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening))\b/.test(q) ||
    /^(how are you|who are you|what can you do|help me)\??$/.test(q)
  ) {
    return [
      `Hello ${name}! 👋 I'm **Presence AI**, your intelligent attendance assistant at **Presence ERP**.`,
      "",
      "I'm here to help you understand your attendance integrity and academic eligibility.",
      "",
      "**Here's what I can answer for you:**",
      "• 📊 *What is my current attendance rate?*",
      "• ❓ *Why was I marked absent last session?*",
      "• 🎯 *How many sessions do I need to attend to reach 75%?*",
      "• 🔒 *What is my trust score and what does it mean?*",
      "• 📅 *Show me my attendance history*",
      "• ⚠️ *Am I at risk of being barred from exams?*",
      "",
      `You currently have **${totalValid}** recorded sessions. What would you like to know?`,
    ].join("\n");
  }

  // ABSENCE REASON — "why absent", "why rejected", "why marked absent"
  if (
    is("why", "reason", "cause", "what happened") &&
    (is("absent", "rejected", "marked", "fail", "denied", "not present", "missing"))
  ) {
    if (!latestAbsent) {
      return `Great news, ${name}! 🎉 You have no rejected or absent sessions in your recent records. All your check-ins are verified as **PRESENT**.`;
    }
    const gates = (latestAbsent.trust_breakdown?.components ?? [])
      .map((c) => {
        const passed = c.achieved >= (c.threshold ?? 0.7);
        return `  • **${c.label}**: ${(c.achieved * 100).toFixed(0)}% achieved — ${passed ? "✅ PASS" : "❌ FAIL (threshold: " + Math.round((c.threshold ?? 0.7) * 100) + "%)"}`;
      })
      .join("\n");

    return [
      `**Why You Were Marked Absent** (${formatDate(latestAbsent.created_at)})`,
      "",
      `**Root Cause**: ${getAbsenceReason(latestAbsent)}`,
      `**Trust Score**: ${latestAbsent.trust_score ?? "N/A"}/100`,
      "",
      gates ? "**Verification Gate Breakdown**:" : "",
      gates || "",
      "",
      "**What you can do:**",
      "1. If you were physically present, contact your instructor for a manual override.",
      "2. Ensure your face enrollment photo is recent and clear.",
      "3. Check that you are inside the classroom before checking in.",
      "4. Make sure your device's location services are enabled.",
    ].filter(Boolean).join("\n");
  }

  // ATTENDANCE RATE / PERCENTAGE
  if (is("attendance", "rate", "percentage", "percent", "how much", "overall") || is("my record", "my status")) {
    if (totalValid === 0) {
      return `${name}, you don't have any verified attendance records yet. Start attending sessions to build your record!`;
    }
    const rate = totalValid > 0 ? (totalPresent / totalValid) * 100 : 0;
    const n75 = sessionsNeededFor75();
    const n85 = sessionsNeededFor85();
    return [
      `**Your Attendance Summary for ${name}**`,
      "",
      `📊 **Overall Rate**: ${pct}% (${totalPresent} present / ${totalValid} sessions)`,
      `${eligibilityStatus(rate)}`,
      `📈 **Average Trust Score**: ${avgTrust}/100`,
      "",
      `**Eligibility Goals:**`,
      n75 === 0 ? "✅ 75% target — Already achieved!" : `• To reach 75%: attend **${n75} more consecutive sessions**`,
      n85 === 0 ? "✅ 85% target — Already achieved!" : `• To reach 85%: attend **${n85} more consecutive sessions**`,
      "",
      latestRecord
        ? `**Last Check-in**: ${formatDate(latestRecord.created_at)} — ${latestRecord.decision === "present" ? "✅ PRESENT" : "❌ ABSENT"}`
        : "",
    ].filter(Boolean).join("\n");
  }

  // TRUST SCORE
  if (is("trust", "score", "trust score", "what is trust", "explain trust")) {
    if (!latestRecord) {
      return "You have no recorded sessions yet. Your trust score will appear once you complete your first check-in.";
    }
    const gates = (latestRecord.trust_breakdown?.components ?? [])
      .map((c) => {
        const passed = c.achieved >= (c.threshold ?? 0.7);
        return `  • **${c.label}**: ${(c.achieved * 100).toFixed(0)}% — ${passed ? "✅ PASS" : "❌ FAIL"}`;
      })
      .join("\n");
    return [
      "**Understanding Your Trust Score**",
      "",
      "Your Trust Score (0–100) is a composite proof-of-presence measurement combining multiple biometric and contextual signals.",
      "",
      `**Your Latest Trust Score**: ${latestRecord.trust_score ?? "N/A"}/100`,
      `**Average across all sessions**: ${avgTrust}/100`,
      "",
      gates ? "**Gate Breakdown (latest session):**" : "No gate breakdown data available.",
      gates,
      "",
      "**Score Interpretation:**",
      "• 90–100: Strong presence proof across all gates",
      "• 70–89: Acceptable — minor signal weaknesses",
      "• 50–69: At risk — review your biometric enrollment",
      "• Below 50: Likely rejected — contact your instructor",
    ].filter(Boolean).join("\n");
  }

  // HOW MANY SESSIONS NEEDED / ELIGIBILITY
  if (
    is("how many", "need to attend", "sessions needed", "to reach", "to get", "75", "85", "eligible", "eligib", "barred", "bar from exam")
  ) {
    if (totalValid === 0) {
      return "You have no attendance records yet. Start attending your classes to track your eligibility progress.";
    }
    const rate = (totalPresent / totalValid) * 100;
    const n75 = sessionsNeededFor75();
    const n85 = sessionsNeededFor85();
    return [
      `**Your Eligibility Calculation for ${name}**`,
      "",
      `Current: **${pct}%** (${totalPresent}/${totalValid} sessions)`,
      `${eligibilityStatus(rate)}`,
      "",
      "**To Reach 75% (Minimum Requirement):**",
      n75 === 0 ? "✅ Already achieved — keep it up!" : `→ Attend **${n75} consecutive sessions** without missing any.`,
      "",
      "**To Reach 85% (Distinction Level):**",
      n85 === 0 ? "✅ Already achieved — excellent!" : `→ Attend **${n85} consecutive sessions** without missing any.`,
      "",
      rate < 75
        ? "⚠️ **Urgent**: Missing more sessions could result in being barred from the semester exam. Attend every available session."
        : "Keep attending consistently to maintain your eligibility.",
    ].join("\n");
  }

  // HISTORY / SHOW RECORDS
  if (is("history", "show", "list", "all session", "previous", "past", "record")) {
    if (totalValid === 0) {
      return "No attendance records found. Once you start attending sessions, your complete history will appear here.";
    }
    const rows = validRecords.slice(0, 8).map((r, i) =>
      `${i + 1}. **${formatDate(r.created_at)}** — ${r.decision === "present" ? "✅ PRESENT" : "❌ ABSENT"} (Trust: ${r.trust_score ?? "N/A"}/100)`
    );
    return [
      `**Your Recent Attendance History** (last ${Math.min(8, totalValid)} sessions)`,
      "",
      ...rows,
      "",
      `**Total**: ${totalPresent} present / ${totalValid} sessions = **${pct}%**`,
    ].join("\n");
  }

  // FACE / BIOMETRIC QUESTIONS
  if (is("face", "biometric", "photo", "camera", "enroll", "recognition")) {
    return [
      "**Face Verification in Presence AI**",
      "",
      "The system uses real-time face recognition to confirm your identity during check-in.",
      "",
      "**Common Issues:**",
      "• Poor lighting — ensure your face is well-lit when checking in",
      "• Outdated enrollment photo — re-enroll if you've changed your appearance significantly",
      "• Camera obstruction — remove glasses or masks during the face scan",
      "• Network lag — stay still for 2–3 seconds during the scan",
      "",
      latestRecord
        ? `**Your latest face gate result**: Trust Score = ${latestRecord.trust_score ?? "N/A"}/100 (${latestRecord.decision === "present" ? "PASSED ✅" : "FAILED ❌"})`
        : "No face verification data available yet.",
      "",
      "**To re-enroll your face**: Go to **Face Enrollment** tab in the app.",
    ].join("\n");
  }

  // LOCATION / GPS / GEOFENCE
  if (is("location", "gps", "geofence", "distance", "outside", "range")) {
    return [
      "**Location Verification in Presence AI**",
      "",
      "The system verifies that you are physically inside the classroom geofence (typically 50–100 metres radius) when you check in.",
      "",
      "**Common Causes of Location Failure:**",
      "• GPS is disabled on your device — enable it in Settings",
      "• You are outside the geofence boundary — move closer to the classroom",
      "• GPS signal is weak (inside a building) — move near a window",
      "• VPN or location spoofer detected — disable VPN during check-in",
      "",
      "**If you are physically present but flagged:**",
      "Ask your instructor to issue a manual override for that session.",
    ].join("\n");
  }

  // WHAT HAPPENED LAST SESSION / LATEST CHECK-IN
  if (is("last session", "latest", "most recent", "yesterday", "today")) {
    if (!latestRecord) {
      return "No session records found yet. Once you complete your first check-in, I can explain the result here.";
    }
    const gates = (latestRecord.trust_breakdown?.components ?? [])
      .map((c) => `  • **${c.label}**: ${(c.achieved * 100).toFixed(0)}% — ${c.achieved >= (c.threshold ?? 0.7) ? "✅ PASS" : "❌ FAIL"}`)
      .join("\n");
    return [
      `**Your Latest Session** (${formatDate(latestRecord.created_at)})`,
      "",
      `**Decision**: ${latestRecord.decision === "present" ? "✅ PRESENT" : "❌ ABSENT"}`,
      `**Trust Score**: ${latestRecord.trust_score ?? "N/A"}/100`,
      latestRecord.reason_code && latestRecord.reason_code !== "present"
        ? `**Reason**: ${getAbsenceReason(latestRecord)}`
        : "",
      "",
      gates ? "**Gate Breakdown:**" : "",
      gates || "",
    ].filter(Boolean).join("\n");
  }

  // GENERAL FALLBACK — intelligent generic response using their data
  const rate = totalValid > 0 ? (totalPresent / totalValid) * 100 : 0;
  return [
    `Hi ${name}! Here's a summary of your attendance to help answer your question:`,
    "",
    `📊 **Attendance Rate**: ${pct}% (${totalPresent}/${totalValid} sessions)`,
    totalValid > 0 ? `${eligibilityStatus(rate)}` : "",
    totalValid > 0 ? `🔒 **Average Trust Score**: ${avgTrust}/100` : "",
    latestRecord
      ? `📅 **Last Check-in**: ${formatDate(latestRecord.created_at)} — ${latestRecord.decision === "present" ? "✅ PRESENT" : `❌ ABSENT (${latestRecord.reason_code ?? "unknown"})`}`
      : "",
    "",
    "You can ask me more specific questions like:",
    "• *\"Why was I absent last session?\"*",
    "• *\"How many sessions do I need to reach 75%?\"*",
    "• *\"Explain my trust score\"*",
    "• *\"Show my attendance history\"*",
  ].filter(Boolean).join("\n");
}


// ─── Main Server Function ──────────────────────────────────────────

export const askPresence = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    let payload = input;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        // keep as is if not valid JSON
      }
    }
    if (payload && typeof payload === 'object' && 'data' in payload && (payload as any).data) {
      payload = (payload as any).data;
    }
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        // keep as is
      }
    }
    return InputSchema.parse(payload ?? {});
  })
  .handler(async ({ data, context }) => {
    const startTime = Date.now();
    const userId = context.userId as string;
    const apiKey = process.env.OPENAI_API_KEY;

    try {
      // ── STEP 1: Rate Limiting ───────────────────────────────────────
    const rateLimit = await checkRateLimit(userId);

    if (!rateLimit.allowed) {
      const waitSecs = Math.ceil(rateLimit.resetInMs / 1000);
      throw new Error(
        `You've reached the query limit. Please wait ${waitSecs} seconds before asking again.`,
      );
    }

    // ── STEP 2: Injection Guard — Layer 1 (free, instant) ──────────
    let injectionBlocked = false;

    if (fastInjectCheck(data.question)) {
      injectionBlocked = true;
    }

    // Injection Guard — Layer 2 (semantic, ~200ms, only if needed)
    if (!injectionBlocked && apiKey && data.question.length > 30) {
      injectionBlocked = await semanticInjectCheck(data.question, apiKey);
    }

    if (injectionBlocked) {
      await track({
        requestId: rateLimit.requestId,
        userId,
        questionLength: data.question.length,
        historyTurns: data.conversationHistory.length,
        injectionBlocked: true,
        rateLimited: false,
        totalRecords: 0,
        retrievedRecords: 0,
        ragUsed: false,
        model: 'guard',
        tokensUsed: 0,
        latencyMs: Date.now() - startTime,
        cached: false,
        streamed: false,
        outputValidationIssues: 0,
        hallucinated: false,
        success: true,
      });

      return {
        answer:
          'I can only assist with attendance-related questions. ' +
          'Please ask me about your verification results, trust scores, or check-in status.',
        sources: [] as SourceRecord[],
        metadata: {
          model: 'guard',
          cached: false,
          ragRecordsUsed: 0,
          rateLimitRemaining: rateLimit.remaining,
          requestId: rateLimit.requestId,
        } satisfies StreamMetadata,
      };
    }

    // ── STEP 3: Parallel data fetch (DB + Memory + Forecast) ────────
    const { supabaseAdmin } = await import(
      '@/integrations/supabase/client.server'
    );

    const [attendanceResult, profileResult, memory, forecast] = await Promise.all([
      // Attendance ledger
      (supabaseAdmin as any)
        .from('attendance_ledger')
        .select(
          [
            'id',
            'session_id',
            'decision',
            'similarity',
            'gate_reasons',
            'trust_score',
            'trust_breakdown',
            'reason_code',
            'created_at',
          ].join(', '),
        )
        .eq('student_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // Profile
      (supabaseAdmin as any)
        .from('profiles')
        .select('display_name, roll_no, department_id, email')
        .eq('user_id', userId)
        .maybeSingle(),

      // NEW: Student memory (non-blocking — empty if never used)
      import('@/lib/presence-ai/memory').then(m => m.recallMemory(userId)),

      // NEW: Live attendance forecast (deterministic, no AI)
      import('@/lib/presence-ai/predictor').then(m => m.computeForecast(userId)),
    ]);

    const allRecords: AttendanceRecord[] = attendanceResult.data ?? [];
    const profile = profileResult.data;

    const sources: SourceRecord[] = allRecords.map((r) => ({
      id: r.id,
      date: new Date(r.created_at).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
      }),
      decision: r.decision,
      trustScore: r.trust_score,
      sessionId: r.session_id,
    }));

    // ── STEP 4: Cache Lookup (single-turn only) ────────────────────
    const isSingleTurn = data.conversationHistory.length === 0;

    if (isSingleTurn) {
      const cached = await getCached(userId, data.question);
      if (cached) {
        await track({
          requestId: rateLimit.requestId,
          userId,
          questionLength: data.question.length,
          historyTurns: 0,
          injectionBlocked: false,
          rateLimited: false,
          totalRecords: allRecords.length,
          retrievedRecords: 0,
          ragUsed: false,
          model: 'cache',
          tokensUsed: 0,
          latencyMs: Date.now() - startTime,
          cached: true,
          streamed: false,
          outputValidationIssues: 0,
          hallucinated: false,
          success: true,
        });

        return {
          answer: cached.answer,
          sources,
          metadata: {
            model: cached.model,
            cached: true,
            ragRecordsUsed: 0,
            rateLimitRemaining: rateLimit.remaining,
            requestId: rateLimit.requestId,
          } satisfies StreamMetadata,
        };
      }
    }

    // ── STEP 5: No API Key — Intelligent Rule-Based Engine ───────
    if (!apiKey) {
      const answer = smartAnswer(data.question, allRecords, profile);

      return {
        answer,
        sources,
        metadata: {
          model: 'presence-ai-smart',
          cached: false,
          ragRecordsUsed: allRecords.length,
          rateLimitRemaining: rateLimit.remaining,
          requestId: rateLimit.requestId,
        } satisfies StreamMetadata,
      };
    }

    // ── STEP 6: RAG — Retrieve Relevant Records ───────────────────
    const { relevantRecords, retrievalScores } = await retrieveRelevantRecords(
      data.question,
      allRecords,
      apiKey,
    );

    // ── STEP 7: Build Prompt (with Memory + Forecast injected) ────
    const currentDateIST = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'short',
    });

    // NEW: Build enriched system prompt with memory and forecast prepended
    const [memoryMod, predictorMod] = await Promise.all([
      import('@/lib/presence-ai/memory'),
      import('@/lib/presence-ai/predictor'),
    ]);
    const memoryBlock = memoryMod.formatMemoryForPrompt(memory);
    const forecastBlock = predictorMod.formatForecastForPrompt(forecast);

    const baseSystemPrompt = buildSystemPrompt(
      profile,
      relevantRecords,
      allRecords,
      currentDateIST,
    );

    // Prepend forecast + memory to system prompt (forecast first — highest priority)
    const systemPrompt = [
      forecastBlock,
      memoryBlock,
      baseSystemPrompt,
    ].filter(Boolean).join('\n\n');

    // ── STEP 8: Trim History to Context Window ───────────────────
    const trimmedHistory = await trimToContextWindow(
      systemPrompt,
      data.conversationHistory,
      data.question,
      AI_CONFIG.models.primary,
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: data.question },
    ];

    // ── STEP 9: Stream Response ───────────────────────────────────
    let finalAnswer = '';
    let finalModel: string = AI_CONFIG.models.primary;
    let finalTokens = 0;
    let streamError: Error | null = null;

    await streamOpenAI(messages, apiKey, {
      onToken: (token) => {
        finalAnswer += token;
      },
      onComplete: (text, model, tokens) => {
        finalAnswer = text;
        finalModel = model;
        finalTokens = tokens;
      },
      onError: (err) => {
        streamError = err;
      },
    });

    // ── STEP 10: Graceful Degradation on Stream Failure ──────────
    if (streamError || !finalAnswer) {
      console.error('[Presence AI] Stream failed:', streamError);
      finalAnswer = smartAnswer(data.question, allRecords, profile);
      finalModel = 'presence-ai-smart';

      if (streamError) {
        finalAnswer +=
          '\n\n_Note: Live AI streaming is temporarily unavailable. Using built-in intelligent engine._';
      }
    }

    // ── STEP 11: Claim Verification (NEW) ────────────────────────
    // Cross-checks factual numbers in AI response against DB truth
    const verifierMod = await import('@/lib/presence-ai/verifier');
    const verification = verifierMod.verifyResponse(finalAnswer, forecast);
    finalAnswer = verification.correctedText;
    const verificationBadge = verifierMod.getVerificationBadge(verification);

    // ── STEP 12: Output Validation ────────────────────────────────
    const validation = validateOutput(finalAnswer, allRecords);

    if (!validation.safe) {
      console.warn(
        '[Presence AI] Output validation issues:',
        validation.issues,
      );
      finalAnswer = validation.sanitized;
    }

    // ── STEP 13: Cache Successful Single-Turn Responses ──────────
    if (isSingleTurn && !streamError && validation.safe) {
      await setCached(userId, data.question, {
        answer: finalAnswer,
        sources,
        model: finalModel,
      });
    }

    // ── STEP 14: Telemetry ────────────────────────────────────────
    await track({
      requestId: rateLimit.requestId,
      userId,
      questionLength: data.question.length,
      historyTurns: data.conversationHistory.length,
      injectionBlocked: false,
      rateLimited: false,
      totalRecords: allRecords.length,
      retrievedRecords: relevantRecords.length,
      ragUsed: relevantRecords.length < allRecords.length,
      avgRetrievalScore:
        retrievalScores.length > 0
          ? retrievalScores.reduce((a, b) => a + b, 0) /
            retrievalScores.length
          : undefined,
      model: finalModel,
      tokensUsed: finalTokens,
      latencyMs: Date.now() - startTime,
      cached: false,
      streamed: true,
      outputValidationIssues: validation.issues.length,
      hallucinated: !validation.safe,
      success: !streamError,
      errorType: streamError
        ? (streamError as Error).message
        : undefined,
    });

    // ── STEP 15: Update Memory (async — never blocks response) ────
    // Fires after we return — student gets their answer immediately
    import('@/lib/presence-ai/memory').then(m =>
      m.updateMemoryAsync(userId, data.question, finalAnswer, memory, apiKey)
    ).catch(() => {});

    // ── RETURN ────────────────────────────────────────────────────
    return {
      answer: finalAnswer,
      sources,
      metadata: {
        model: finalModel,
        cached: false,
        ragRecordsUsed: relevantRecords.length,
        rateLimitRemaining: rateLimit.remaining,
        requestId: rateLimit.requestId,
        verificationBadge,
        forecast: {
          currentRate: forecast.currentRate,
          riskLevel: forecast.riskLevel,
          headline: forecast.headline,
          sessionsNeededToRecover: forecast.sessionsNeededToRecover,
          nextSessionMinutes: forecast.nextSessionMinutes,
        },
        memoryActive: memory.interactionCount > 0,
      } satisfies PresenceStreamMetadata,
    };
    } catch (err: any) {
      console.error('[Presence AI Handler Error]', err);
      // Fail-safe response — never throw 500 error to the client
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: records } = await (supabaseAdmin as any)
        .from('attendance_ledger')
        .select('id, session_id, decision, similarity, trust_score, reason_code, created_at')
        .eq('student_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      const allRecords: AttendanceRecord[] = records ?? [];
      const sources: SourceRecord[] = allRecords.map((r) => ({
        id: r.id,
        date: new Date(r.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
        decision: r.decision,
        trustScore: r.trust_score,
        sessionId: r.session_id,
      }));

      const answer = smartAnswer(data.question ?? 'status', allRecords, null);
      return {
        answer,
        sources,
        metadata: {
          model: 'rule-based-fallback',
          cached: false,
          ragRecordsUsed: allRecords.length,
          rateLimitRemaining: 10,
          requestId: crypto.randomUUID(),
        } satisfies StreamMetadata,
      };
    }
  });
