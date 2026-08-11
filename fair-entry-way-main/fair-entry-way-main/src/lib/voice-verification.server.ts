/**
 * Task 2 — Voice Verification Server Functions
 *
 * Implements the review-queue secondary check: when a student's face-match similarity
 * lands in [THRESHOLD_REVIEW, THRESHOLD_MATCH) (0.75–0.82), they can verify by voice
 * instead of waiting for manual teacher approval.
 *
 * HONEST LIMITATION (do not remove this comment):
 *   This is NOT true voice biometric identity verification (speaker-verification). It does
 *   NOT compare voice embeddings/speaker models. What it does:
 *     1. Transcript correctness — did the student say the right passphrase? (fuzzy match
 *        via Levenshtein distance, tolerant of minor SpeechRecognition transcription errors)
 *     2. Basic liveness signals — duration and (if provided) amplitude variance, to reject
 *        a static/silent clip or a too-short recording.
 *   This is a knowledge+liveness factor, NOT a voiceprint. A real speaker-verification
 *   system would need a speaker-embedding model (e.g. TensorFlow.js speaker-id models or
 *   resemblyzer-style embeddings), which is heavier than this codebase's current client-side
 *   ML footprint (face-api.js only). That is a documented future upgrade path, not a shipped
 *   feature under this task. Do not claim this is voice biometric identity verification.
 *
 * Rationale (qualitative, not citing specific numbers): face-match confidence drops in dim
 * lighting (see docs/BIAS_FAIRNESS_AUDIT.md — but do not cite its current numbers, they are
 * being redone in Task 3). Voice doesn't share that failure mode — lighting affects vision,
 * not audio. So a voice secondary check can resolve a meaningful fraction of the review
 * queue that fails purely due to poor lighting, without a human in the loop.
 *
 * Uses the browser-native Web Speech API (SpeechRecognition) — zero marginal cost, offline-
 * capable where the browser supports it, consistent with this project's avoidance of paid
 * third-party biometric APIs.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Levenshtein distance for fuzzy transcript matching ──────────────────────
// Tolerant of minor SpeechRecognition transcription errors (e.g. "seven" → "sevan").

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return dp[m][n];
}

// Fuzzy match: returns true if the transcript is "close enough" to the passphrase.
// Threshold: allow up to 30% of the passphrase length in edit distance (rounded up, min 2).
function fuzzyMatch(transcript: string, passphrase: string): boolean {
  const t = transcript.toLowerCase().trim();
  const p = passphrase.toLowerCase().trim();
  if (!t || !p) return false;
  if (t === p) return true;

  const dist = levenshtein(t, p);
  const threshold = Math.max(2, Math.ceil(p.length * 0.3));
  return dist <= threshold;
}

// ── HMAC-SHA256 hash for passphrase storage/verification ────────────────────
import { getOptionalSecret } from "./cf-env.server";

async function hashPassphrase(passphrase: string): Promise<string> {
  const keyName = "LIVENESS_HMAC_KEY";
  const secret = getOptionalSecret(keyName) ?? "dev_liveness_action_key";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`voice_passphrase:${passphrase}`)),
  );
  return Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── generateVoicePassphrase — generates a random 4-6 digit passphrase ────────

export const generateVoicePassphrase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    // Generate 4-6 random digits as a string. Short enough to speak quickly,
    // long enough to not be guessable in the few seconds before the check.
    const length = 4 + Math.floor(Math.random() * 3); // 4, 5, or 6
    const digits = Array.from({ length }, () => Math.floor(Math.random() * 10).toString());
    return { passphrase: digits.join(" ") }; // Space-separated for clearer speech
  });

// ── getMyVoiceEnrollmentStatus — student checks if they have voice enrolled ──

export const getMyVoiceEnrollmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any)
      .from("biometric_consent")
      .select("voice_enrolled")
      .eq("student_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return { voiceEnrolled: !!data?.voice_enrolled };
  });

// ── submitVoiceVerification — the core review-queue resolution ──────────────
//
// Called when submitAttendance returns decision === "review" AND the student has
// voiceEnrolled = true. Compares the transcript against the stored passphrase hash,
// applies basic liveness heuristics, and on success inserts a NEW ledger row with
// decision = "present" (the ledger is append-only — we never UPDATE the review row).
// On failure, the review row stays unchanged — humans still get final say.

export const submitVoiceVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().min(1),
        transcript: z.string().trim().min(1).max(256),
        // The passphrase the student was shown (non-secret — displayed at check-in).
        // We verify its hash matches the stored hash to prevent client-side fabrication,
        // then fuzzy-match the transcript against it.
        passphrase: z.string().trim().min(1).max(64),
        // Optional audio metadata for basic liveness checks
        audioDurationMs: z.number().optional(),
        audioAmplitudeVariance: z.number().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    // 1. Fetch the student's voice enrollment + stored passphrase hash.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: consent, error: consentErr } = await (supabaseAdmin as any)
      .from("biometric_consent")
      .select("voice_enrolled, voice_passphrase_hash")
      .eq("student_id", userId)
      .maybeSingle();

    if (consentErr || !consent) {
      return {
        verified: false,
        reason: "not_voice_enrolled",
        message: "You have not enrolled a voice passphrase.",
      };
    }

    if (!consent.voice_enrolled || !consent.voice_passphrase_hash) {
      return {
        verified: false,
        reason: "not_voice_enrolled",
        message: "You have not enrolled a voice passphrase.",
      };
    }

    // 2. Find the most recent "review" ledger entry for this student + session.
    const { data: reviewEntry, error: reviewErr } = await supabaseAdmin
      .from("attendance_ledger")
      .select("id, similarity, gate_reasons")
      .eq("session_id", data.sessionId)
      .eq("student_id", userId)
      .eq("decision", "review")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reviewErr || !reviewEntry) {
      return {
        verified: false,
        reason: "no_pending_review",
        message: "No pending review entry found for this session.",
      };
    }

    // 3. Verify the passphrase hash matches stored (prevents client-side fabrication).
    const passphraseHash = await hashPassphrase(data.passphrase.replace(/\s+/g, ""));
    if (passphraseHash !== consent.voice_passphrase_hash) {
      return {
        verified: false,
        reason: "passphrase_mismatch",
        message: "The passphrase does not match your enrollment.",
      };
    }

    // 4. Basic liveness heuristics (if audio metadata was provided).
    const livenessIssues: string[] = [];

    if (data.audioDurationMs !== undefined) {
      if (data.audioDurationMs < 800) {
        livenessIssues.push("audio_too_short");
      } else if (data.audioDurationMs > 30_000) {
        livenessIssues.push("audio_too_long");
      }
    }

    if (data.audioAmplitudeVariance !== undefined) {
      if (data.audioAmplitudeVariance < 0.001) {
        livenessIssues.push("audio_static_or_silent");
      }
    }

    // 5. Fuzzy-match the transcript against the passphrase.
    const transcriptOk = fuzzyMatch(data.transcript, data.passphrase);

    if (!transcriptOk) {
      await supabaseAdmin.from("attendance_events").insert({
        session_id: data.sessionId,
        student_id: userId,
        event_type: "voice_verification_failed",
        reason_code: "transcript_mismatch",
        gate_reasons: {
          liveness_issues: livenessIssues,
          voice_secondary_check: false,
        },
      });

      return {
        verified: false,
        reason: "transcript_mismatch",
        message:
          "The spoken passphrase did not match. Please try again or wait for teacher approval.",
      };
    }

    if (livenessIssues.length > 0) {
      await supabaseAdmin.from("attendance_events").insert({
        session_id: data.sessionId,
        student_id: userId,
        event_type: "voice_verification_failed",
        reason_code: "liveness_check_failed",
        gate_reasons: {
          liveness_issues: livenessIssues,
          voice_secondary_check: false,
        },
      });

      return {
        verified: false,
        reason: "liveness_check_failed",
        message:
          "The audio did not pass liveness checks. Please speak naturally into the microphone.",
      };
    }

    // 6. SUCCESS: insert a NEW ledger row with decision = "present".
    //    The ledger is append-only — we never UPDATE the review row.
    const { data: prevRows } = await supabaseAdmin
      .from("attendance_ledger")
      .select("id")
      .eq("session_id", data.sessionId)
      .eq("student_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    const previous_entry_id = prevRows?.[0]?.id ?? null;

    const { error: insertErr } = await supabaseAdmin.from("attendance_ledger").insert({
      session_id: data.sessionId,
      student_id: userId,
      decision: "present",
      similarity: reviewEntry.similarity,
      gate_reasons: {
        resolved_by: "voice_secondary_check",
        original_review_ledger_id: reviewEntry.id,
        voice_transcript_match: true,
        liveness_issues: [],
      },
      reason_code: "voice_verified_present",
      previous_entry_id,
    });

    if (insertErr) {
      const msg = insertErr.message || "";
      if (msg.includes("attendance_ledger_one_present_per_student_session")) {
        return {
          verified: false,
          reason: "already_present",
          message: "You are already marked present for this session.",
        };
      }
      throw new Error(`Voice verification ledger insert failed: ${msg}`);
    }

    // 7. Audit event — distinguishable from face-only and manual approval.
    await supabaseAdmin.from("attendance_events").insert({
      session_id: data.sessionId,
      student_id: userId,
      event_type: "voice_verification_passed",
      reason_code: "voice_secondary_check",
      liveness_method: "hmac_fallback",
      gate_reasons: {
        resolved_by: "voice_secondary_check",
        original_review_ledger_id: reviewEntry.id,
      },
    });

    return {
      verified: true,
      reason: "voice_verified",
      message: "Voice verification successful. You are marked present.",
    };
  });
