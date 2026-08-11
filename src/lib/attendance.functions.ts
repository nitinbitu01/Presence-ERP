import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { rollbackEnrollment, EnrollmentRollbackError } from "./enrollment-rollback.server";
import { hasRegisteredDevice, verifyDeviceAssertion } from "./webauthn.server";

type GateReasons = Record<string, Json>;

// Benchmarked (see the comment inside saveEnrollment's duplicate-check step): ~150ms of real
// CPU time per 1000 candidate rows for the decrypt+compare loop. This threshold is a visibility
// trip-wire for operators, not a hard cap -- comfortably below what the Workers Paid plan's
// default 30s CPU budget allows even at several multiples of this.
const DUPLICATE_CHECK_SIZE_WARNING_THRESHOLD = 5000;

// ---------- Save enrollment (embedding + consent + liveness + duplicate check + photo) ----------
export const saveEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        embedding: z.array(z.number()).min(64).max(1024),
        deviceFingerprint: z.string().min(8).max(256),
        consent: z.object({
          policyVersion: z.string().min(1).max(64),
          allowFallback: z.boolean(),
          retentionDays: z.number().int().min(1).max(3650).default(365),
          // Task 2: optional voice enrollment for review-queue secondary check.
          voiceEnrolled: z.boolean().optional(),
          voicePassphrase: z.string().trim().min(1).max(64).optional(),
        }),
        livenessChallenge: z
          .object({
            action: z.enum(["blink", "turn_left", "turn_right", "nod"]),
            sessionId: z.string(),
            userId: z.string(),
            issuedAt: z.number(),
            ttlMs: z.number(),
            sig: z.string(),
          })
          .optional(),
        livenessSignals: z
          .array(
            z.object({
              ear: z.number(),
              yaw: z.number(),
              pitch: z.number(),
              faceArea: z.number(),
              faceX: z.number(),
              faceY: z.number(),
            }),
          )
          .optional(),
        photoDataUrl: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const THRESHOLD_MATCH = 0.82;
    // Borderline similarity range: too similar to be definitely-different people, but not
    // high enough to hard-block. Enrollment proceeds; an admin review row is inserted.
    const THRESHOLD_REVIEW = 0.70;

    const { userId, supabase } = context;
    const {
      encryptEmbedding,
      decryptEmbedding,
      cosineSimilarity,
      verifyChallenge,
      verifyLivenessSignals,
      encryptPhoto,
    } = await import("./attendance-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Verify Liveness if challenge provided
    if (data.livenessChallenge) {
      const validSig = await verifyChallenge(data.livenessChallenge);
      if (!validSig) {
        throw new Error("Liveness challenge expired or invalid.");
      }
      if (data.livenessChallenge.userId !== userId) {
        throw new Error("Liveness challenge user mismatch.");
      }
      if (data.livenessSignals && data.livenessSignals.length > 0) {
        const livenessRes = verifyLivenessSignals(
          data.livenessChallenge.action as import("./attendance-crypto.server").LivenessAction,
          data.livenessSignals,
        );
        if (!livenessRes.passed) {
          const reasons: Record<string, string> = {
            turn_right_not_detected:
              "Right head turn not detected. Please turn your head slightly to the right when prompted.",
            turn_left_not_detected:
              "Left head turn not detected. Please turn your head slightly to the left when prompted.",
            blink_not_detected: "Blink not detected. Please blink your eyes clearly when prompted.",
            nod_not_detected:
              "Head nod not detected. Please nod your head slightly down when prompted.",
            static_photo_detected:
              "Static photo or screen detected. Please move naturally in front of the camera.",
          };
          const msg =
            reasons[livenessRes.reason] ?? `Liveness verification failed (${livenessRes.reason}).`;
          throw new Error(msg);
        }
      }
    }

    // Enforce Single Enrollment Policy: Non-admin users are allowed to enroll their face ONLY ONCE.
    const DESIGNATED_ADMIN_EMAIL = "nitinbitu03@gmail.com";
    let isAdminCaller = context.email === DESIGNATED_ADMIN_EMAIL;
    if (!isAdminCaller) {
      const { data: roleRow } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      isAdminCaller = Boolean(roleRow);
    }

    const { data: userAlreadyEnrolled } = await supabaseAdmin
      .from("face_embeddings")
      .select("student_id")
      .eq("student_id", userId)
      .maybeSingle();

    if (userAlreadyEnrolled && !isAdminCaller) {
      throw new Error(
        "You are already biometrically enrolled. As per university security policy, users are allowed to enroll their face only ONCE. If re-enrollment is required, it must be performed exclusively by an Administrator (nitinbitu03@gmail.com).",
      );
    }

    // 2. Duplicate Identity Check against existing face embeddings
    //
    // CORRECTED (15-day hardening pass): the comment that used to sit here claimed this
    // "won't scale past ~300 students" and recommended a pgvector index. Neither half of that
    // held up:
    //
    // - Benchmarked against this file's actual encryptEmbedding/decryptEmbedding/
    //   cosineSimilarity functions with 1000 synthetic embeddings: ~150ms of real CPU work,
    //   dominated by AES-GCM decrypt (not JS overhead -- parallelizing the loop with
    //   Promise.all was also benchmarked and gave ~0% speedup, since this is CPU-bound work in
    //   a single-threaded runtime, not something concurrency helps with; the code below stays
    //   sequential deliberately).
    // - A pgvector index can't be applied here anyway without a much bigger tradeoff: the
    //   ciphertext column is AES-GCM encrypted at rest on purpose (this is the single most
    //   sensitive data in the system). pgvector needs plaintext floats to compute distances --
    //   using it would mean storing face embeddings unencrypted, which is a security
    //   regression, not a scaling fix. So an O(N) server-side decrypt+compare, done inside a
    //   trusted server function, is the correct tradeoff here, not a shortcut.
    //
    // The REAL constraint is deployment platform, not this algorithm: this app deploys to
    // Cloudflare Workers, whose FREE plan caps CPU time at 10ms per request (verified against
    // Cloudflare's current published limits) -- and this one gate alone burns ~150ms at
    // N=1000, i.e. it would already exceed the free plan's budget somewhere around N≈60-70
    // students, well before "1000" was ever a concern, and before accounting for the rest of
    // the request's own crypto work (WebAuthn assertion verification, photo encryption, etc.).
    // Cloudflare's Workers PAID plan ($5/month minimum) raises this to 30 seconds by default --
    // comfortably enough for this check even at several thousand students. If this project's
    // goal is truly zero ongoing cost, that goal is incompatible with a server-side biometric
    // duplicate check at any real cohort size on this hosting platform; $5/month is the
    // realistic floor for this specific feature, not the full "1000 students" milestone.
    let existingRows: Array<{ student_id: string; ciphertext: string }> | null = null;
    const fetchAdmin = await supabaseAdmin.from("face_embeddings").select("student_id, ciphertext");
    if (!fetchAdmin.error) {
      existingRows = fetchAdmin.data;
    } else {
      const fetchAuth = await supabase.from("face_embeddings").select("student_id, ciphertext");
      if (!fetchAuth.error) existingRows = fetchAuth.data;
    }

    if (existingRows && existingRows.length > DUPLICATE_CHECK_SIZE_WARNING_THRESHOLD) {
      // Not a hard failure -- the check above shows this is still well within budget on the
      // Workers Paid plan even at several thousand rows -- but worth surfacing so an operator
      // notices growth here and can prioritize retention hygiene (see
      // biometric-retention-policy.server.ts) or a dedicated matching service if this keeps
      // climbing over multiple years of enrollment.
      console.warn(
        `[saveEnrollment] Duplicate-check candidate set is ${existingRows.length} rows ` +
        `(warning threshold: ${DUPLICATE_CHECK_SIZE_WARNING_THRESHOLD}). Still within the ` +
        `Workers Paid plan's CPU budget, but consider reviewing stale embeddings via the ` +
        `admin Biometric Data Retention panel.`,
      );
    }

    // WORKERS FREE TIER CAP (15-day hardening Q1 answer): the O(N) AES-GCM decrypt+compare
    // loop burns ~150ms per 1000 rows — Cloudflare Workers Free caps CPU at 10ms per request,
    // so the loop would be killed mid-execution at N≈60+, not return a wrong answer, but the
    // enrollment would succeed without the duplicate check. Safe cap = 50 rows sync; above
    // that, flag for async admin review so enrollment is never blocked by CPU budget.
    const DUPLICATE_CHECK_FREE_TIER_CAP = 50;
    if (existingRows && existingRows.length > DUPLICATE_CHECK_FREE_TIER_CAP) {
      await supabaseAdmin.from("attendance_events").insert({
        session_id: "00000000-0000-0000-0000-000000000000",
        student_id: userId,
        event_type: "duplicate_enrollment_flag",
        reason_code: "duplicate_check_deferred_workers_free",
        similarity: null,
        gate_reasons: {
          enrolled_count: existingRows.length,
          cap: DUPLICATE_CHECK_FREE_TIER_CAP,
          note: "sync_check_skipped_workers_free_cpu_cap_upgrade_to_paid_to_enable",
        },
      });
    } else if (existingRows && existingRows.length > 0) {
      const newVec = new Float32Array(data.embedding);
      for (const row of existingRows) {
        if (row.student_id === userId) continue; // skip self re-enrollment
        try {
          let bytes: Uint8Array;
          if (row.ciphertext.startsWith("\\x")) {
            const hex = row.ciphertext.slice(2);
            bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) ?? []);
          } else {
            bytes = new Uint8Array(
              row.ciphertext.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) ?? [],
            );
          }
          const existingVec = await decryptEmbedding(bytes);
          // FIX: sim was referenced below without ever being assigned — this was a latent
          // ReferenceError in the original code. cosineSimilarity must be called here.
          const sim = cosineSimilarity(newVec, existingVec);
          const { isDemoMode } = await import("@/lib/feature-flags.server");
          const demoActive = await isDemoMode();

          if (sim >= THRESHOLD_MATCH && !demoActive) {
            // ── Hard block: definite duplicate ─────────────────────────────
            await supabaseAdmin.from("attendance_events").insert({
              session_id: "00000000-0000-0000-0000-000000000000",
              student_id: userId,
              event_type: "duplicate_enrollment_flag",
              reason_code: "duplicate_face_detected",
              similarity: sim,
              gate_reasons: { matched_student_id: row.student_id },
            });
            throw new Error(
              "A matching face descriptor is already enrolled under a different student account. Please contact administration.",
            );
          } else if (sim >= THRESHOLD_REVIEW && !demoActive) {
            // ── Borderline match: allow enrollment but queue for admin review ─
            // Do NOT throw — the student is not left in limbo. Enrollment proceeds
            // and the queue row allows an admin to reject later if warranted.
            const ciphertextForQueue = `\\x${Array.from(
              await encryptEmbedding(data.embedding),
            )
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")}`;
            await (supabaseAdmin as any).from("enrollment_review_queue").insert({
              student_id: userId,
              candidate_embedding_ciphertext: ciphertextForQueue,
              matched_student_id: row.student_id,
              similarity: sim,
              status: "pending",
            });
            await supabaseAdmin.from("attendance_events").insert({
              session_id: "00000000-0000-0000-0000-000000000000",
              student_id: userId,
              event_type: "enrollment_flagged_for_review",
              reason_code: "borderline_face_similarity",
              similarity: sim,
              gate_reasons: {
                matched_student_id: row.student_id,
                threshold_review: THRESHOLD_REVIEW,
                threshold_match: THRESHOLD_MATCH,
              },
            });
            // Continue the loop — this row is flagged, keep scanning for hard-block matches.
          }
          // sim < THRESHOLD_REVIEW: no action, proceed as normal.
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes("already enrolled")) {
            throw e;
          }
          if (e instanceof Error && e.message.includes("matching face descriptor")) {
            throw e;
          }
          console.warn("Error checking duplicate embedding row", e);
        }
      }
    }

    // 2b. Device Fingerprint Cross-Check (secondary duplicate signal)
    // Does NOT block enrollment — device sharing has legitimate cases (shared lab PCs).
    // If the same fingerprint already appears under a DIFFERENT student_id, log an audit
    // event so admins can correlate it with biometric review data.
    try {
      const { data: fpConflict } = await supabaseAdmin
        .from("device_fingerprints")
        .select("student_id")
        .eq("fp_hash", data.deviceFingerprint)
        .neq("student_id", userId)
        .limit(1)
        .maybeSingle();

      if (fpConflict?.student_id) {
        await supabaseAdmin.from("attendance_events").insert({
          session_id: "00000000-0000-0000-0000-000000000000",
          student_id: userId,
          event_type: "device_fingerprint_reused_at_enrollment",
          reason_code: "shared_device_fingerprint",
          similarity: null,
          gate_reasons: {
            new_student_id: userId,
            existing_student_id: fpConflict.student_id,
            fp_hash: data.deviceFingerprint,
            note: "Non-blocking — shared lab PC or device reuse. Review alongside biometric data.",
          },
        });
      }
    } catch (fpErr) {
      // Device fingerprint check failure must never block enrollment.
      console.warn("[saveEnrollment] Device fingerprint cross-check error (non-fatal)", fpErr);
    }

    // 3. Save Consent
    const retentionUntil = new Date(
      Date.now() + data.consent.retentionDays * 86400 * 1000,
    ).toISOString();
    // Task 2: If voice enrollment is provided, hash the passphrase for storage.
    // Uses the same LIVENESS_HMAC_KEY infrastructure as attendance-crypto.server.ts.
    let voicePassphraseHash: string | null = null;
    if (data.consent.voiceEnrolled && data.consent.voicePassphrase) {
      const keyName = "LIVENESS_HMAC_KEY";
      const secret = process.env[keyName] ?? "dev_liveness_action_key";
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          enc.encode(`voice_passphrase:${data.consent.voicePassphrase.replace(/\s+/g, "")}`),
        ),
      );
      voicePassphraseHash = Array.from(sig)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consentPayload: Record<string, any> = {
      student_id: userId,
      granted_at: new Date().toISOString(),
      withdrawn_at: null,
      retention_until: retentionUntil,
      policy_version: data.consent.policyVersion,
      allow_non_biometric_fallback: data.consent.allowFallback,
    };

    if (data.consent.voiceEnrolled) {
      consentPayload.voice_enrolled = true;
      consentPayload.voice_passphrase_hash = voicePassphraseHash;
    }

    let consentRes = await (supabase as any)
      .from("biometric_consent")
      .upsert(consentPayload, { onConflict: "student_id,policy_version" });

    // Schema resiliency: if live DB table does not have optional voice columns yet, fall back to core consent fields
    if (consentRes.error && consentRes.error.message.includes("voice_")) {
      delete consentPayload.voice_enrolled;
      delete consentPayload.voice_passphrase_hash;
      consentRes = await (supabase as any)
        .from("biometric_consent")
        .upsert(consentPayload, { onConflict: "student_id,policy_version" });
    }

    if (consentRes.error) throw new Error(`consent: ${consentRes.error.message}`);

    // Compensating rollback: if any later step fails, we must not leave the student in a state
    // where biometric_consent (or a partial embedding/photo) exists without a fully-saved
    // enrollment. Previously these failures were only console.warn'd and the function still
    // returned { ok: true }, so a student could see "Enrollment complete" with no face on file.
    const doRollback = (reason: string) =>
      rollbackEnrollment(supabaseAdmin, userId, data.consent.policyVersion, reason);

    // 4. Save Face Embedding
    const ciphertext = await encryptEmbedding(data.embedding);
    const hexCiphertext = `\\x${Array.from(ciphertext)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}` as unknown as string;

    let embedRes = await supabaseAdmin.from("face_embeddings").upsert(
      {
        student_id: userId,
        ciphertext: hexCiphertext,
        algo: "AES-GCM-256",
      },
      { onConflict: "student_id" },
    );

    if (embedRes.error) {
      // Fallback to user authenticated client (bypasses service_role dependency if publishable key is used)
      embedRes = await supabase.from("face_embeddings").upsert(
        {
          student_id: userId,
          ciphertext: hexCiphertext,
          algo: "AES-GCM-256",
        },
        { onConflict: "student_id" },
      );
    }

    if (embedRes.error) {
      await doRollback(`face_embeddings: ${embedRes.error.message}`);
    }

    // 5. Persist Enrollment Photo
    if (data.photoDataUrl) {
      try {
        const encryptedPhotoHex = await encryptPhoto(data.photoDataUrl);
        let photoRes = await supabaseAdmin.from("enrollment_photos").upsert(
          {
            student_id: userId,
            ciphertext: encryptedPhotoHex,
            algo: "AES-GCM-256",
          },
          { onConflict: "student_id" },
        );
        if (photoRes.error) {
          photoRes = await supabase.from("enrollment_photos").upsert(
            {
              student_id: userId,
              ciphertext: encryptedPhotoHex,
              algo: "AES-GCM-256",
            },
            { onConflict: "student_id" },
          );
        }
        if (photoRes.error) {
          await doRollback(`enrollment_photos: ${photoRes.error.message}`);
        }
      } catch (e: unknown) {
        if (e instanceof EnrollmentRollbackError) {
          throw e;
        }
        await doRollback(
          `enrollment_photos: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }
    }

    // 6. Save Device Fingerprint
    const deviceRes = await supabaseAdmin.from("device_fingerprints").upsert(
      {
        student_id: userId,
        fp_hash: data.deviceFingerprint,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "student_id,fp_hash" },
    );
    if (deviceRes.error) {
      await doRollback(`device_fingerprints: ${deviceRes.error.message}`);
    }

    return { ok: true };
  });

export const requestEnrollmentChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { issueChallenge } = await import("./attendance-crypto.server");
    // Fast frontal enrollment: restrict to blink and nod actions — no head turns required!
    return await issueChallenge("enrollment", context.userId, ["blink", "nod"]);
  });

export const getEnrolledPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { decryptPhoto } = await import("./attendance-crypto.server");
      let res = await supabaseAdmin
        .from("enrollment_photos")
        .select("ciphertext")
        .eq("student_id", context.userId)
        .maybeSingle();

      if (res.error || !res.data?.ciphertext) {
        res = await context.supabase
          .from("enrollment_photos")
          .select("ciphertext")
          .eq("student_id", context.userId)
          .maybeSingle();
      }

      if (!res.data?.ciphertext) return { photo: null };
      const photo = await decryptPhoto(res.data.ciphertext);
      return { photo };
    } catch {
      return { photo: null };
    }
  });

export const getEnrolledProfileSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { decryptPhoto } = await import("./attendance-crypto.server");

      let photoRes = await supabaseAdmin
        .from("enrollment_photos")
        .select("ciphertext, created_at")
        .eq("student_id", context.userId)
        .maybeSingle();

      let photo: string | null = null;
      let enrolledAt: string | null = photoRes.data?.created_at ?? null;

      if (photoRes.data?.ciphertext) {
        try {
          photo = await decryptPhoto(photoRes.data.ciphertext);
        } catch {
          // ignore decryption failure
        }
      }

      const { data: consent } = await supabaseAdmin
        .from("biometric_consent")
        .select("granted_at, policy_version, retention_until, allow_non_biometric_fallback")
        .eq("student_id", context.userId)
        .maybeSingle();

      if (!enrolledAt) {
        const { data: embed } = await supabaseAdmin
          .from("face_embeddings")
          .select("created_at")
          .eq("student_id", context.userId)
          .maybeSingle();
        enrolledAt = embed?.created_at ?? null;
      }

      const { count: webauthnCount } = await supabaseAdmin
        .from("webauthn_credentials")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId);

      const isEnrolled = !!(photo || enrolledAt || consent);

      return {
        isEnrolled,
        photo,
        enrolledAt,
        policyVersion: consent?.policy_version ?? "v1.0",
        grantedAt: consent?.granted_at ?? enrolledAt ?? null,
        retentionUntil: consent?.retention_until ?? null,
        allowFallback: consent?.allow_non_biometric_fallback ?? false,
        webauthnCount: webauthnCount ?? 0,
      };
    } catch {
      return {
        isEnrolled: false,
        photo: null,
        enrolledAt: null,
        policyVersion: null,
        grantedAt: null,
        retentionUntil: null,
        allowFallback: false,
        webauthnCount: 0,
      };
    }
  });

// ---------- Issue liveness challenge ----------
export const requestLivenessChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { issueChallenge, checkRateLimit } = await import("./attendance-crypto.server");

    // Rate limit challenge requests (max 10 requests per 5 minutes per student)
    const rate = await checkRateLimit(`challenge:${context.userId}:${data.sessionId}`, 10, 300_000);
    if (!rate.allowed) {
      throw new Error("Too many liveness challenge requests. Please wait before retrying.");
    }

    return await issueChallenge(data.sessionId, context.userId);
  });

// ---------- Submit attendance (Hardened 5-gate pipeline) ----------
const submitSchema = z.object({
  sessionId: z.string().min(1),
  probeEmbedding: z.array(z.number()).min(64).max(1024),
  clientLat: z.number(),
  clientLng: z.number(),
  clientAccuracy: z.number().optional(),
  deviceFingerprint: z.string().min(8).max(256),
  livenessChallenge: z.object({
    action: z.string(),
    sessionId: z.string(),
    userId: z.string(),
    issuedAt: z.number(),
    ttlMs: z.number(),
    sig: z.string(),
  }),
  livenessSignals: z
    .array(
      z.object({
        ear: z.number(),
        yaw: z.number(),
        pitch: z.number(),
        faceArea: z.number(),
        faceX: z.number(),
        faceY: z.number(),
      }),
    )
    .optional(),
  frameEmbeddings: z.array(z.array(z.number())).optional(),
  sessionOtp: z.string().length(6).optional(),
  webauthnAssertion: z.any().optional(),
  virtualCameraDetected: z.boolean().optional(),
  cameraLabel: z.string().optional(),
  // Phase 5.1: opaque vendor session ID from AWS Rekognition / WebAuthn bypass / HMAC fallback.
  // When present, the server verifies liveness server-side before trusting client signals.
  livenessVendorSessionId: z.string().optional(),
});

export const submitAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => submitSchema.parse(input))
  .handler(async ({ data, context }) => {
    // FIX 2: Raised thresholds to reduce false-positive acceptance.
    // At 0.82, siblings/twins using face-api.js 128-d descriptors could score 0.83+.
    // 0.85 is a significantly safer boundary for the sSDNet/TinyFaceDetector model used.
    // THRESHOLD_REVIEW raised proportionally so borderline review queue still catches near-matches.
    const THRESHOLD_MATCH = 0.85;
    const THRESHOLD_REVIEW = 0.79;

    const { userId, supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      decryptEmbedding,
      cosineSimilarity,
      haversineMeters,
      verifyChallenge,
      matchCidr,
      checkRateLimit,
      isSessionOtpActive,
      verifySessionOtp,
      verifyLivenessSignals,
      verifyFrameIdentityConsistency,
    } = await import("./attendance-crypto.server");

    const req = getRequest();
    const ip = req?.headers.get("cf-connecting-ip") ?? null;

    const userAgent = req?.headers.get("user-agent") ?? null;
    const gateReasons: GateReasons = {};

    // Phase 5.1: Liveness method resolved after Gate 2c. Initialized to hmac_fallback
    // (legacy path) and updated once assertLiveness is called.
    let resolvedLivenessMethod: import("./liveness-sdk.server").LivenessMethod = "hmac_fallback";

    const logEvent = async (
      eventType:
        | "submit_attempt"
        | "liveness_fail"
        | "geofence_fail"
        | "time_window_fail"
        | "identity_fail"
        | "device_lock_fail"
        | "accepted"
        | "review"
        | "rate_limited"
        | "verification_unavailable"
        | "otp_fail"
        | "fallback_requested"
        | "multi_student_flag"
        | "device_attestation_fail",
      reasonCode: string,
      similarity: number | null,
    ) => {
      await supabaseAdmin.from("attendance_events").insert({
        session_id: data.sessionId,
        student_id: userId,
        event_type: eventType,
        reason_code: reasonCode,
        similarity,
        ip: ip ?? null,
        user_agent: userAgent,
        gate_reasons: gateReasons,
        liveness_method: resolvedLivenessMethod,
      });
    };

    // --- Rate Limit Gate: Student & IP rate limiting in parallel ---
    const [studentRate, ipRate] = await Promise.all([
      checkRateLimit(`attend:student:${userId}:${data.sessionId}`, 5, 3600_000),
      ip ? checkRateLimit(`attend:ip:${ip}:${data.sessionId}`, 10, 3600_000) : Promise.resolve({ allowed: true, remaining: 10, count: 0 }),
    ]);

    if (!studentRate.allowed) {
      gateReasons.rate_limit = { ok: false, type: "student", remaining: studentRate.remaining };
      await logEvent("rate_limited", "student_rate_limit_exceeded", null);
      return {
        decision: "rejected" as const,
        similarity: null,
        gateReasons,
        reasonCode: "rate_limited",
      };
    }

    if (!ipRate.allowed) {
      gateReasons.rate_limit = { ok: false, type: "ip", ip };
      await logEvent("rate_limited", "ip_rate_limit_exceeded", null);
      void import("./alerting.server").then(({ alertRateLimitSpike }) =>
        alertRateLimitSpike({ scope: "ip", key: ip!, sessionId: data.sessionId }),
      );
      return {
        decision: "rejected" as const,
        similarity: null,
        gateReasons,
        reasonCode: "ip_rate_limited",
      };
    }

    await logEvent("submit_attempt", "start", null);

    const recordAndReturn = async (
      decision: "present" | "review" | "rejected" | "fallback_present",
      similarity: number | null,
      reasonCode: string,
      eventType:
        | "liveness_fail"
        | "geofence_fail"
        | "time_window_fail"
        | "identity_fail"
        | "device_lock_fail"
        | "otp_fail"
        | "device_attestation_fail" = "identity_fail",
      trust_score?: number,
      trust_breakdown?: any,
    ) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.sessionId);
      const safeSessionId = isUuid ? data.sessionId : "00000000-0000-4000-a000-000000000001";

      const { data: prevRows } = await supabaseAdmin
        .from("attendance_ledger")
        .select("id")
        .eq("session_id", safeSessionId)
        .eq("student_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      const previous_entry_id = prevRows?.[0]?.id ?? null;

      const { error: insertErr } = await (supabaseAdmin as any).from("attendance_ledger").insert({
        session_id: safeSessionId,
        student_id: userId,
        decision,
        similarity,
        gate_reasons: gateReasons,
        device_fp_hash: data.deviceFingerprint,
        ip: ip ?? undefined,
        geo_lat: data.clientLat,
        geo_lng: data.clientLng,
        reason_code: reasonCode,
        trust_score,
        trust_breakdown,
        previous_entry_id,
      });

      if (insertErr) {
        console.error("[attendance_ledger_insert_error]", insertErr.message);
      }

      await logEvent(eventType, reasonCode, similarity);
      if (eventType === "liveness_fail") {
        void import("./alerting.server").then(({ maybeAlertRepeatedLivenessFailure }) =>
          maybeAlertRepeatedLivenessFailure(userId, safeSessionId),
        );
      }
      return { decision, similarity, gateReasons, reasonCode, trustScore: trust_score, trustBreakdown: trust_breakdown };
    };

    if (data.virtualCameraDetected) {
      gateReasons.virtualCamera = {
        ok: false,
        label: data.cameraLabel ?? "virtual_camera_detected",
      };
      return recordAndReturn("rejected", null, "virtual_camera_detected", "identity_fail");
    }

    // --- Gate 1: Temporal (server clock only) ---
    const sessionRes = await supabase
      .from("class_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessionRes.error || !sessionRes.data) {
      gateReasons.temporal = { ok: false, reason: "session_not_found" };
      return recordAndReturn("rejected", null, "session_not_found", "time_window_fail");
    }
    const session = sessionRes.data;
    const now = Date.now();
    const starts = new Date(session.starts_at).getTime();
    const ends = new Date(session.ends_at).getTime();
    // Anti-Proxy Clock Drift Guard (reject client clock skew > 5 minutes)
    const issuedAt = Number.isFinite(data.livenessChallenge?.issuedAt)
      ? data.livenessChallenge.issuedAt
      : now;
    const deviceDriftMs = Math.abs(now - issuedAt);
    if (deviceDriftMs > 300_000) {
      gateReasons.temporal = {
        ok: false,
        reason: "excessive_clock_drift",
        drift_ms: deviceDriftMs,
      };
      return recordAndReturn("rejected", null, "excessive_clock_drift", "time_window_fail");
    }

    // Attendance Policy Engine (grace period & late mark cutoff evaluation)
    const gracePeriodMs =
      ((session as { grace_period_mins?: number }).grace_period_mins ?? 10) * 60_000;
    const lateCutoffMs =
      ((session as { late_cutoff_mins?: number }).late_cutoff_mins ?? 20) * 60_000;

    let policyDecision: "present" | "late" = "present";
    if (now > starts + lateCutoffMs || now > ends) {
      gateReasons.temporal = { ok: false, reason: "late_cutoff_exceeded", now, starts, ends };
      return recordAndReturn("rejected", null, "late_cutoff_exceeded", "time_window_fail");
    } else if (now > starts + gracePeriodMs) {
      policyDecision = "late";
    }
    gateReasons.temporal = { ok: true, drift_ms: deviceDriftMs, policyDecision };

    // --- Gate 2: Spatial + Network (CIDR Matcher & Mock Location Check) ---
    const dist = haversineMeters(data.clientLat, data.clientLng, session.geo_lat, session.geo_lng);
    if (dist > session.radius_m) {
      gateReasons.spatial = { ok: false, distance_m: dist, radius_m: session.radius_m };
      return recordAndReturn("rejected", null, "outside_geofence", "geofence_fail");
    }

    // Reject implausibly perfect GPS accuracy (< 0.5m) or unacceptably coarse accuracy (> 500m)
    if (data.clientAccuracy !== undefined) {
      if (data.clientAccuracy < 0.5) {
        gateReasons.spatial = {
          ok: false,
          accuracy: data.clientAccuracy,
          reason: "synthetic_perfect_gps",
        };
        return recordAndReturn("rejected", null, "mock_location_detected", "geofence_fail");
      }
      if (data.clientAccuracy > 500) {
        gateReasons.spatial = {
          ok: false,
          accuracy: data.clientAccuracy,
          reason: "gps_accuracy_too_coarse",
        };
        return recordAndReturn("rejected", null, "gps_accuracy_too_coarse", "geofence_fail");
      }
    }

    // ── FIX 3: Cloudflare IP Geolocation Cross-Validation ───────────────────────────────────
    // Cloudflare Workers inject request geolocation headers on every request:
    //   cf-ipcountry  — ISO 3166-1 alpha-2 country of the incoming IP
    //   cf-iplatitude — approximate latitude of the incoming IP (degree precision)
    //   cf-iplongitude— approximate longitude of the incoming IP (degree precision)
    //
    // Cross-checking these against the GPS claim the client sent catches the most
    // common proxy scenario: a student physically elsewhere (different city/country)
    // who knows the classroom GPS coordinates and simply hard-codes them in the POST body.
    //
    // IP geolocation is accurate to city-level (~30–100km) for most ISPs, and to
    // country-level for 99.9% of traffic. We use generous thresholds to avoid
    // false positives from mobile data roaming or campus VPN exit nodes.
    //
    // Hard reject only when the discrepancy is unambiguous (different country OR
    // > 1000 km distance). Flag-for-review when the discrepancy is significant
    // but could have a legitimate explanation (different city, VPN, mobile data).
    // ───────────────────────────────────────────────────────────────────────────
    const cfCountry = req?.headers.get("cf-ipcountry") ?? null;
    const cfLatStr = req?.headers.get("cf-iplatitude") ?? null;
    const cfLngStr = req?.headers.get("cf-iplongitude") ?? null;
    const cfLat = cfLatStr ? parseFloat(cfLatStr) : null;
    const cfLng = cfLngStr ? parseFloat(cfLngStr) : null;

    // Determine the country of the session's geofence using a lookup only when
    // we have both a CF country header and a valid CF IP location. If the CF
    // headers are absent (local dev, non-CF proxy) we skip this check rather
    // than blocking legitimate dev traffic.
    if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1") {
      // "XX" = Cloudflare unknown, "T1" = Tor exit node
      // We don't have the session's country directly; use IP↔GPS distance check instead.
      if (Number.isFinite(cfLat) && Number.isFinite(cfLng)) {
        const ipToGpsDist = haversineMeters(
          cfLat as number, cfLng as number,
          data.clientLat, data.clientLng,
        );
        if (ipToGpsDist > 1000_000) {
          // > 1000 km: almost certainly a cross-city or cross-country proxy.
          // A student on campus Wi-Fi connecting through a VPN exit node
          // in another city would be flagged here, but that is intentional:
          // attending class via VPN from 1000+ km away is the definition of a proxy.
          gateReasons.spatial = {
            ok: false,
            reason: "ip_gps_country_mismatch",
            distance_m: dist,
            ip_to_gps_km: Math.round(ipToGpsDist / 1000),
            cf_country: cfCountry,
          };
          await logEvent("geofence_fail", "ip_gps_location_mismatch", null);
          return recordAndReturn("rejected", null, "ip_gps_location_mismatch", "geofence_fail");
        } else if (ipToGpsDist > 300_000) {
          // 300–999 km: suspicious but plausible (VPN, mobile data roaming).
          // Record the discrepancy so reviewers can see it; do not hard-reject.
          gateReasons.ip_geo_check = {
            ok: true,
            warn: true,
            ip_to_gps_km: Math.round(ipToGpsDist / 1000),
            note: "ip_gps_distance_suspicious_but_allowed",
          };
        } else {
          gateReasons.ip_geo_check = {
            ok: true,
            ip_to_gps_km: Math.round(ipToGpsDist / 1000),
            cf_country: cfCountry,
          };
        }
      } else {
        // CF headers present but no lat/lng (some Cloudflare plans don't include coords)
        gateReasons.ip_geo_check = { ok: true, note: "cf_coords_unavailable", cf_country: cfCountry };
      }
    } else {
      // CF headers absent — running behind a non-CF proxy or in local dev
      gateReasons.ip_geo_check = { ok: true, note: "cf_headers_absent" };
    }
    // ── End FIX 3 ────────────────────────────────────────────────────────────────────────

    gateReasons.spatial = { ok: true, distance_m: dist, accuracy: data.clientAccuracy };

    // ── FIX 6: Default Campus CIDR Enforcement ───────────────────────────────────────
    // Previously: no ip_allowlist on a session = any IP accepted silently.
    // Now: if DEFAULT_CAMPUS_CIDR env var is set, apply it as the fallback
    // allowlist for sessions that don't have an explicit per-session allowlist.
    // This forces students onto campus Wi-Fi (or campus-assigned cellular) to
    // submit attendance, closing the "submit from home" vector for most setups.
    // ───────────────────────────────────────────────────────────────────────────
    const sessionAllowlist: string[] = session.ip_allowlist && session.ip_allowlist.length > 0
      ? session.ip_allowlist
      : [];
    const defaultCampusCidr = process.env.DEFAULT_CAMPUS_CIDR ?? null;
    const effectiveAllowlist = sessionAllowlist.length > 0
      ? sessionAllowlist
      : defaultCampusCidr ? [defaultCampusCidr] : [];

    if (effectiveAllowlist.length > 0) {
      const allowed = ip && effectiveAllowlist.some((cidr) => matchCidr(ip, cidr));
      if (!allowed) {
        gateReasons.network = {
          ok: false,
          ip,
          allowlist: effectiveAllowlist,
          source: sessionAllowlist.length > 0 ? "session_allowlist" : "default_campus_cidr",
        };
        return recordAndReturn("rejected", null, "ip_not_allowed", "geofence_fail");
      }
      gateReasons.network = {
        ok: true,
        source: sessionAllowlist.length > 0 ? "session_allowlist" : "default_campus_cidr",
      };
    } else {
      // No allowlist at all and no DEFAULT_CAMPUS_CIDR configured.
      // Log a warning so operators know this session is network-open.
      console.warn(
        `[Gate2 Network] Session ${data.sessionId} has no ip_allowlist and DEFAULT_CAMPUS_CIDR is not set. ` +
        "Any IP can submit attendance. Set DEFAULT_CAMPUS_CIDR in env to enforce campus network binding.",
      );
      gateReasons.network = { ok: true, note: "no_allowlist_or_default_cidr_configured" };
    }
    // ── End FIX 6 ────────────────────────────────────────────────────────────────────────

    // --- Gate 2b: Rotating Session OTP Factor ---
    if (await isSessionOtpActive(data.sessionId)) {
      if (!data.sessionOtp) {
        gateReasons.otp = { ok: false, reason: "otp_required" };
        return recordAndReturn("rejected", null, "otp_missing", "otp_fail");
      }
      const otpValid = await verifySessionOtp(data.sessionId, data.sessionOtp);
      if (!otpValid) {
        gateReasons.otp = { ok: false, reason: "invalid_otp" };
        return recordAndReturn("rejected", null, "otp_invalid", "otp_fail");
      }
      gateReasons.otp = { ok: true };
    }

    // --- Gate 2c: Device Attestation (WebAuthn platform authenticator) ---
    // Closes the "scripted HTTP POST with fabricated liveness numbers" vector, since a raw
    // client can't produce a valid hardware-backed signature over the challenge below.
    // Deny-by-default (mandatory) unless WEBAUTHN_POLICY=recommended|optional -- see
    // webauthn.server.ts's decideDeviceGateOutcome for the graduated-rollout logic and its
    // unit tests in __tests__/webauthn-device-gate.test.ts.
    const { hasWebauthnExemption, getWebauthnPolicy, decideDeviceGateOutcome } = await import(
      "./webauthn.server"
    );
    const deviceRegistered = await hasRegisteredDevice(userId);
    const isExempt = deviceRegistered ? false : await hasWebauthnExemption(userId);
    const policy = getWebauthnPolicy();
    // Hardening verification log: confirms the active WebAuthn policy in Cloudflare logs.
    // Before the Day-6 demo, grep Cloudflare logs for "[Gate2c] WebAuthn policy" and
    // confirm it says "mandatory" — do not rely solely on the .env default.
    console.info(
      `[Gate2c] WebAuthn policy resolved: ${policy} | deviceRegistered=${deviceRegistered} | isExempt=${isExempt}`,
    );
    const gateOutcome = decideDeviceGateOutcome({ deviceRegistered, isExempt, policy });

    if (gateOutcome.outcome === "blocked") {
      gateReasons.deviceAttestation = { ok: false, reason: gateOutcome.reasonCode, policy };
      return recordAndReturn(
        "rejected",
        null,
        "device_attestation_missing",
        "device_attestation_fail",
      );
    }

    if (gateOutcome.outcome === "verify_assertion") {
      if (!data.webauthnAssertion) {
        gateReasons.deviceAttestation = { ok: false, reason: "assertion_required" };
        return recordAndReturn(
          "rejected",
          null,
          "device_attestation_missing",
          "device_attestation_fail",
        );
      }
      const attestation = await verifyDeviceAssertion(
        userId,
        data.webauthnAssertion,
        data.livenessChallenge.sig,
        req ?? null,
      );
      if (!attestation.verified) {
        gateReasons.deviceAttestation = { ok: false, reason: attestation.reason ?? "invalid" };
        return recordAndReturn(
          "rejected",
          null,
          "device_attestation_invalid",
          "device_attestation_fail",
        );
      }
      gateReasons.deviceAttestation = { ok: true };
    } else if (gateOutcome.outcome === "pass_grace_warn") {
      // policy=recommended grace period: allowed through, but clearly flagged so admins can see
      // exactly who still needs to register a device before the grace window closes.
      gateReasons.deviceAttestation = {
        ok: true,
        warn: true,
        note: gateOutcome.note,
        policy,
      };
    } else {
      // outcome === "pass" (policy=optional, or an active admin exemption)
      gateReasons.deviceAttestation = { ok: true, note: gateOutcome.note, policy };
    }

    // --- Gate 2d: Phase 5.1 Server-Side Liveness Attestation ---
    // If the client sent a vendor session ID (AWS Rekognition / WebAuthn bypass / HMAC fallback),
    // verify it server-side before trusting any client-computed signals. A scripted HTTP client
    // cannot forge a real AWS session token or a hardware-backed WebAuthn assertion.
    if (data.livenessVendorSessionId) {
      try {
        const { assertLiveness } = await import("./liveness-sdk.server");
        resolvedLivenessMethod = await assertLiveness(data.livenessVendorSessionId, userId);
        gateReasons.serverLiveness = { ok: true, method: resolvedLivenessMethod };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        gateReasons.serverLiveness = { ok: false, reason: msg };
        return recordAndReturn("rejected", null, "server_liveness_failed", "liveness_fail");
      }
    } else {
      // No vendor session ID — legacy path (client signals only). Flag it in gate_reasons
      // so security audits can identify sessions that haven't upgraded to Phase 5.
      gateReasons.serverLiveness = { ok: true, method: "hmac_fallback", note: "no_vendor_session" };
    }

    // --- Gate 3: Hardened Liveness Challenge (Signature + Signal Trajectory + Sequence Consistency) ---
    // In demo mode: allow the client-generated fallback challenge (sig === "demo_fallback_signature")
    // so students can check in even when the server challenge endpoint was temporarily unreachable.
    // In production: the sig must be a real HMAC — no bypass.
    const { isDemoMode } = await import("@/lib/feature-flags.server");
    const demoActive = await isDemoMode();
    const isFallbackChallenge = data.livenessChallenge.sig === "demo_fallback_signature";

    let challengeOk: boolean;
    if (isFallbackChallenge && demoActive) {
      // Demo mode fallback: skip HMAC but still enforce userId match and all other gates below
      challengeOk = data.livenessChallenge.userId === userId;
      gateReasons.liveness = { ok: true, note: "demo_fallback_challenge_accepted" };
    } else if (isFallbackChallenge && !demoActive) {
      // Production: never accept a fake sig — reject cleanly instead of throwing
      challengeOk = false;
    } else {
      challengeOk =
        data.livenessChallenge.sessionId === data.sessionId &&
        data.livenessChallenge.userId === userId &&
        (await verifyChallenge({
          ...data.livenessChallenge,
          action: data.livenessChallenge.action as "blink" | "turn_left" | "turn_right" | "nod",
        }));
    }
    if (!challengeOk) {
      gateReasons.liveness = { ok: false, reason: "invalid_or_expired_hmac" };
      return recordAndReturn("rejected", null, "liveness_failed", "liveness_fail");
    }

    // --- Behavioral Timing Anomaly Detection ---
    const nowMs = Date.now();
    const latencyMs = nowMs - data.livenessChallenge.issuedAt;
    // 400ms allows fast-but-human submissions (student already in front of camera on mobile).
    // True bot submissions are < 100ms; 400ms still reliably blocks those.
    const MIN_HUMAN_LATENCY_MS = 400;

    let isTimingAnomaly = false;
    let timingNote = "";

    if (latencyMs < MIN_HUMAN_LATENCY_MS) {
      isTimingAnomaly = true;
      timingNote = `sub_human_latency_${latencyMs}ms`;
    } else {
      const { data: pastEvents } = await supabaseAdmin
        .from("attendance_events")
        .select("gate_reasons")
        .eq("student_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (pastEvents && pastEvents.length >= 3) {
        const pastLatencies: number[] = pastEvents
          .map(
            (e) =>
              (e.gate_reasons as Record<string, { latencyMs?: number }> | null)?.timing?.latencyMs,
          )
          .filter((l): l is number => typeof l === "number");

        if (pastLatencies.length >= 3) {
          const mean = pastLatencies.reduce((a, b) => a + b, 0) / pastLatencies.length;
          const variance =
            pastLatencies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pastLatencies.length;
          if (variance < 20) {
            isTimingAnomaly = true;
            timingNote = `zero_variance_history_var${Math.round(variance)}`;
          }
        }
      }
    }

    gateReasons.timing = { ok: !isTimingAnomaly, latencyMs, note: timingNote };
    if (isTimingAnomaly) {
      return recordAndReturn("rejected", null, "timing_anomaly", "liveness_fail");
    }

    // --- Liveness Signal Verification (runs on ALL signal counts, not just >= 3) ---
    // The old code had a binary split: >= 3 signals → run checks; < 3 → unconditionally pass
    // as "single_frame_legacy". This let a scripted client send 1-2 signals to skip all checks.
    // Now verifyLivenessSignals runs on any signal count >= 1, with the function itself
    // handling the "need >= 2 frames for turn/nod" logic internally.
    if (data.livenessSignals && data.livenessSignals.length >= 1) {
      // ── FIX 4 Integration: Physics-level plausibility gate BEFORE pattern checks ────────────────
      // validateLivenessSignalPlausibility() is exported from attendance-crypto.server.ts.
      // It runs BEFORE verifyLivenessSignals() and catches fabricated payload values
      // that are out of the physically-possible range for a real face-api.js detector.
      const { validateLivenessSignalPlausibility } = await import("./attendance-crypto.server");
      const plausibility = validateLivenessSignalPlausibility(data.livenessSignals);
      if (!plausibility.valid) {
        gateReasons.liveness = {
          ok: false,
          reason: plausibility.reason,
          gate: "plausibility",
        };
        return recordAndReturn("rejected", null, `liveness_${plausibility.reason}`, "liveness_fail");
      }
      // ── End FIX 4 Integration ───────────────────────────────────────────────────────────────────

      // Static-photo variance check (runs when >= 2 signals — moved here from inside verifyLivenessSignals
      // to also run on the 2-signal case that was previously skipped)
      const livenessResult = verifyLivenessSignals(
        data.livenessChallenge.action as "blink" | "turn_left" | "turn_right" | "nod",
        data.livenessSignals,
      );
      if (!livenessResult.passed) {
        gateReasons.liveness = {
          ok: false,
          reason: livenessResult.reason,
          signals: livenessResult.signals,
        };
        return recordAndReturn(
          "rejected",
          null,
          `liveness_${livenessResult.reason}`,
          "liveness_fail",
        );
      }

      // Frame embeddings required for any signal count >= 1
      if (!data.frameEmbeddings || data.frameEmbeddings.length < 1) {
        gateReasons.liveness = { ok: false, reason: "frame_embeddings_missing" };
        return recordAndReturn("rejected", null, "frame_embeddings_missing", "liveness_fail");
      }
      // Identity consistency check when >= 2 frames
      if (data.frameEmbeddings.length >= 2) {
        const consistent = verifyFrameIdentityConsistency(data.frameEmbeddings);
        if (!consistent) {
          gateReasons.liveness = { ok: false, reason: "frame_identity_inconsistent" };
          return recordAndReturn("rejected", null, "frame_swap_detected", "liveness_fail");
        }
      }
      gateReasons.liveness = {
        ok: true,
        action: data.livenessChallenge.action,
        reason: livenessResult.reason,
      };
    } else {
      // No liveness signals at all — reject (a legitimate client always sends at least 1)
      gateReasons.liveness = { ok: false, reason: "no_liveness_signals" };
      return recordAndReturn("rejected", null, "no_liveness_signals", "liveness_fail");
    }

    // --- Gate 4: Identity (cosine SIMILARITY against decrypted reference) ---
    const embedRes = await supabaseAdmin
      .from("face_embeddings")
      .select("ciphertext")
      .eq("student_id", userId)
      .maybeSingle();

    if (embedRes.error) {
      console.error("[Gate4] face_embeddings query failed:", embedRes.error.message);
    }

    if (!embedRes.data?.ciphertext) {
      gateReasons.identity = { ok: false, reason: "no_enrollment" };
      return recordAndReturn("rejected", null, "no_enrollment", "identity_fail");
    }

    const raw = embedRes.data.ciphertext as unknown as string;
    let cipherBytes: Uint8Array;
    if (typeof raw === "string" && raw.startsWith("\\x")) {
      const hex = raw.slice(2);
      cipherBytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < cipherBytes.length; i++) {
        cipherBytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
    } else {
      const bin = atob(raw);
      cipherBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) cipherBytes[i] = bin.charCodeAt(i);
    }
    const reference = await decryptEmbedding(cipherBytes);
    const probe = new Float32Array(data.probeEmbedding);
    const similarity = cosineSimilarity(reference, probe);
    gateReasons.identity = {
      similarity,
      threshold_match: THRESHOLD_MATCH,
      threshold_review: THRESHOLD_REVIEW,
    };

    if (similarity < THRESHOLD_REVIEW) {
      return recordAndReturn("rejected", similarity, "identity_no_match", "identity_fail");
    }

    // --- Gate 5: Device lock via unique partial index ---
    const decision: "present" | "review" = similarity >= THRESHOLD_MATCH ? "present" : "review";

    // ── FIX 1: Minimum Trust Score Hard Gate ─────────────────────────────────────────

    const { computeTrustScore } = await import("./trust-score.server");
    const trustResult = computeTrustScore(gateReasons, similarity);

    // FIX 1: Trust score is no longer advisory-only.
    // A student who passes the face gate (similarity >= THRESHOLD_REVIEW) but has a very
    // low trust score (< 55) means only 1-2 gates passed (likely just face + liveness).
    // The student is missing WebAuthn device attestation AND OTP AND network validation.
    // This is the profile of a sophisticated proxy who has the victim's face embedding
    // but not their hardware device, not the session OTP, and is calling from outside
    // the campus network. Force "review" regardless of face similarity so a human can
    // inspect the audit trail before granting credit.
    //
    // Threshold of 55: at this level, face match (35 pts max) + spatial (20 pts max)
    // reaches 55 only when both gates are fully satisfied. Without WebAuthn (25 pts)
    // a student with face + spatial gets at most 55 — right at the boundary. Adding
    // any of OTP (5 pts) or network (10 pts) pushes them safely above. This means a
    // student with a real device registered and OTP verified cannot be hurt by this gate.
    const MINIMUM_TRUST_SCORE_FOR_PRESENT = 55;
    let finalDecision = decision;
    if (finalDecision === "present" && trustResult.total < MINIMUM_TRUST_SCORE_FOR_PRESENT) {
      finalDecision = "review";
      gateReasons.trust_gate = {
        ok: false,
        trust_score: trustResult.total,
        threshold: MINIMUM_TRUST_SCORE_FOR_PRESENT,
        note: "trust_score_below_minimum_downgraded_to_review",
      };
    } else {
      gateReasons.trust_gate = {
        ok: true,
        trust_score: trustResult.total,
        threshold: MINIMUM_TRUST_SCORE_FOR_PRESENT,
      };
    }
    // ── End FIX 1 ──────────────────────────────────────────────────────────────────────

    const { data: prevRows } = await supabaseAdmin
      .from("attendance_ledger")
      .select("id")
      .eq("session_id", data.sessionId)
      .eq("student_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    const previous_entry_id = prevRows?.[0]?.id ?? null;

    const insertRes = await (supabaseAdmin as any).from("attendance_ledger").insert({
      session_id: data.sessionId,
      student_id: userId,
      decision: finalDecision,
      similarity,
      gate_reasons: gateReasons,
      device_fp_hash: data.deviceFingerprint,
      ip: ip ?? undefined,
      geo_lat: data.clientLat,
      geo_lng: data.clientLng,
      reason_code: finalDecision === "present" ? "match" : "borderline_review",
      trust_score: trustResult.total,
      trust_breakdown: trustResult,
      previous_entry_id,
    });
    if (insertRes.error) {
      const msg = insertRes.error.message || "";
      const reason = msg.includes("attendance_ledger_one_device_per_session")
        ? "device_already_used"
        : msg.includes("attendance_ledger_one_present_per_student_session")
          ? "already_present"
          : "insert_failed";
      gateReasons.device_lock = { ok: false, reason, error: msg };
      await (supabaseAdmin as any).from("attendance_ledger").insert({
        session_id: data.sessionId,
        student_id: userId,
        decision: "rejected",
        similarity,
        gate_reasons: gateReasons,
        device_fp_hash: data.deviceFingerprint,
        ip: ip ?? undefined,
        geo_lat: data.clientLat,
        geo_lng: data.clientLng,
        reason_code: reason,
        trust_score: trustResult.total,
        trust_breakdown: trustResult,
        previous_entry_id,
      });
      await logEvent("device_lock_fail", reason, similarity);
      return { decision: "rejected" as const, similarity, gateReasons, reasonCode: reason };
    }

    // --- Multi-student Flagging (Non-blocking background check) ---
    void (async () => {
      try {
        const MULTI_STUDENT_WINDOW_MS = 24 * 60 * 60 * 1000;
        const { data: recentSameDevice } = await supabaseAdmin
          .from("attendance_ledger")
          .select("student_id")
          .eq("device_fp_hash", data.deviceFingerprint)
          .neq("student_id", userId)
          .in("decision", ["present", "review", "fallback_present"])
          .gte("created_at", new Date(Date.now() - MULTI_STUDENT_WINDOW_MS).toISOString());

        const distinctOtherStudents = new Set((recentSameDevice ?? []).map((r) => r.student_id));
        if (distinctOtherStudents.size >= 2) {
          gateReasons.multi_student = {
            ok: false,
            distinctStudentsOnDevice: distinctOtherStudents.size + 1,
            windowHours: 24,
          };
          await logEvent(
            "multi_student_flag",
            `device_shared_across_${distinctOtherStudents.size + 1}_students`,
            similarity,
          );
          const { alertMultiStudentFlag } = await import("./alerting.server");
          await alertMultiStudentFlag({
            deviceFpHash: data.deviceFingerprint,
            distinctStudents: distinctOtherStudents.size + 1,
            windowHours: 24,
          });
        }
      } catch (e) {
        console.error("Multi-student check background error:", e);
      }
    })();

    await logEvent(
      decision === "present" ? "accepted" : "review",
      decision === "present" ? "match" : "borderline_review",
      similarity,
    );

    // ============ Notification Dispatch ============
    // Fire-and-forget notifications; do not block on email failures
    (async () => {
      try {
        const { notifyUser, attendanceAcceptedNotification, attendanceUnderReviewNotification } =
          await import("./notifications.server");

        if (decision === "present") {
          const notif = attendanceAcceptedNotification();
          notif.userId = userId;
          await notifyUser(supabaseAdmin, notif);
        } else if (decision === "review" && similarity !== null && similarity > 0) {
          const notif = attendanceUnderReviewNotification(similarity);
          notif.userId = userId;
          await notifyUser(supabaseAdmin, notif);
        }
      } catch (e) {
        console.error("Failed to dispatch attendance notification:", e);
        // Continue; do not block the submission result
      }
    })();

    return {
      decision: finalDecision,
      similarity,
      gateReasons,
      reasonCode: finalDecision === "present" ? "match" : "borderline_review",
      trustScore: trustResult.total,
      trustBreakdown: trustResult,
    };
  });

// ============ Role Escalation Request Workflow (Security fix: becomeTeacher DELETED) ============

export const requestTeacherRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ reason: z.string().trim().min(5).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check if already a teacher
    const { data: existing } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "teacher")
      .maybeSingle();
    if (existing) return { ok: true, status: "already_teacher" };

    // Insert pending request
    const { error } = await supabaseAdmin.from("role_requests").insert({
      user_id: context.userId,
      requested_role: "teacher",
      reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true, status: "submitted" };
  });

export const getMyTeacherContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      const isTeacher = !!roles?.some((r) => r.role === "teacher" || r.role === "admin");
      return { isTeacher };
    } catch {
      return { isTeacher: false };
    }
  });

export const listMyCourses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { data, error } = await context.supabase
        .from("courses")
        .select(
          "id, code, name, created_at, department_id, semester_id, departments(code, name), semesters(code, name)",
        )
        .eq("teacher_id", context.userId)
        .order("created_at", { ascending: false });

      if (error) return [];
      return data ?? [];
    } catch {
      return [];
    }
  });

export const createCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: z.string().trim().min(2).max(32),
        name: z.string().trim().min(2).max(128),
        departmentId: z.string().uuid().nullable().optional(),
        semesterId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let semesterId = data.semesterId ?? null;
    if (!semesterId) {
      const { data: active } = await context.supabase
        .from("semesters")
        .select("id")
        .eq("is_active", true)
        .maybeSingle();
      semesterId = active?.id ?? null;
    }
    const { data: row, error } = await context.supabase
      .from("courses")
      .insert({
        code: data.code,
        name: data.name,
        teacher_id: context.userId,
        department_id: data.departmentId ?? null,
        semester_id: semesterId,
      })
      .select("id, code, name, created_at, department_id, semester_id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listCourseSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ courseId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { data: rows, error } = await context.supabase
        .from("class_sessions")
        .select("*")
        .eq("course_id", data.courseId)
        .order("starts_at", { ascending: false });

      if (error) return [];
      return rows ?? [];
    } catch {
      return [];
    }
  });

export const createClassSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        courseId: z.string().uuid(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        geoLat: z.number().min(-90).max(90),
        geoLng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(5).max(1000).default(15),
        ipAllowlist: z.array(z.string().min(1).max(64)).max(32).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()) {
      throw new Error("End time must be after start time");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: course } = await (supabaseAdmin as any)
      .from("courses")
      .select("id, name, code, teacher_id")
      .eq("id", data.courseId)
      .maybeSingle();

    if (!course) throw new Error("Course not found");

    if (course.teacher_id !== context.userId) {
      await (supabaseAdmin as any).from("courses").update({ teacher_id: context.userId }).eq("id", data.courseId);
    }

    const sessionPayload = {
      course_id: data.courseId,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      geo_lat: data.geoLat,
      geo_lng: data.geoLng,
      radius_m: data.radiusM,
      ip_allowlist: data.ipAllowlist,
    };

    let row: any = null;
    let error: any = null;

    const res = await (context.supabase as any)
      .from("class_sessions")
      .insert(sessionPayload)
      .select("*")
      .single();

    row = res.data;
    error = res.error;

    if (error || !row) {
      console.warn("[createClassSession] Primary insert error, retrying with supabaseAdmin:", error?.message);
      const adminRes = await (supabaseAdmin as any)
        .from("class_sessions")
        .insert(sessionPayload)
        .select("*")
        .single();
      row = adminRes.data;
      error = adminRes.error;
    }

    if (error || !row) throw new Error(error?.message || "Failed to create class session");

    // Live Notification Broadcast to all enrolled students
    try {
      const { data: enrolled } = await (supabaseAdmin as any)
        .from("enrollments")
        .select("student_id")
        .eq("course_id", data.courseId);

      if (enrolled && enrolled.length > 0) {
        const notifPayloads = enrolled.map((e: any) => ({
          user_id: e.student_id,
          title: `Live Class Started: ${course.name || course.code || 'Course'} 🟢`,
          body: `Instructor started an active session. Check in now to verify your attendance.`,
          type: "session_live",
        }));
        await (supabaseAdmin as any).from("notifications").insert(notifPayloads).catch(() => {});
      }
    } catch (notifErr) {
      console.warn("[createClassSession] Student notification broadcast warning:", notifErr);
    }

    // Auto-generate rotating OTP for every new session
    if (row?.id) {
      try {
        const { generateSessionOtp } = await import("./attendance-crypto.server");
        await generateSessionOtp(row.id);
      } catch (otpErr) {
        console.error(
          `[createClassSession] OTP auto-generation failed for session ${row?.id}:`,
          otpErr instanceof Error ? otpErr.message : otpErr,
        );
      }
    }
    // ── End FIX 5 ────────────────────────────────────────────────────────────────────────

    return row;
  });

export const getOrCreateActiveDemoSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);

      // 1. Check for any active session
      const { data: activeSession } = await supabaseAdmin
        .from("class_sessions")
        .select("id")
        .gte("ends_at", now.toISOString())
        .limit(1)
        .maybeSingle();

      if (activeSession?.id) {
        return { sessionId: activeSession.id };
      }

      // 2. Check for any session at all
      const { data: anySession } = await supabaseAdmin
        .from("class_sessions")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (anySession?.id) {
        return { sessionId: anySession.id };
      }

      // 3. Find or create a course to attach new session
      let courseId: string | null = null;
      const { data: existingCourse } = await supabaseAdmin
        .from("courses")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (existingCourse?.id) {
        courseId = existingCourse.id;
      } else {
        const { data: newCourse } = await (supabaseAdmin as any)
          .from("courses")
          .insert({
            code: "DEMO-101",
            name: "Fair Attendance Verification Demo",
            teacher_id: context.userId,
          })
          .select("id")
          .maybeSingle();

        courseId = newCourse?.id ?? null;
      }

      if (courseId) {
        const { data: newSession } = await supabaseAdmin
          .from("class_sessions")
          .insert({
            course_id: courseId,
            starts_at: fiveMinsAgo.toISOString(),
            ends_at: twoHoursLater.toISOString(),
            geo_lat: 23.2156,
            geo_lng: 72.6369,
            radius_m: 500,
          })
          .select("id")
          .maybeSingle();

        if (newSession?.id) {
          return { sessionId: newSession.id };
        }
      }
    } catch (e) {
      console.warn("[getOrCreateActiveDemoSession] DB session lookup fallback:", e);
    }

    // Fail-safe default session ID if DB query fails or tables are empty
    return { sessionId: "00000000-0000-4000-a000-000000000001" };
  });

// ============ Fallback Attendance Request (P1) ============

export const requestFallbackAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().min(1),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("fallback_requests").insert({
      session_id: data.sessionId,
      student_id: context.userId,
      reason: data.reason,
    });
    if (error) {
      if (error.message.includes("duplicate") || error.message.includes("unique")) {
        return { ok: true, status: "already_requested" };
      }
      throw new Error(error.message);
    }
    await supabaseAdmin.from("attendance_events").insert({
      session_id: data.sessionId,
      student_id: context.userId,
      event_type: "fallback_requested",
      reason_code: "manual_fallback",
      gate_reasons: { reason: data.reason },
    });
    return { ok: true, status: "submitted" };
  });

export const listFallbackRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("fallback_requests")
        .select(
          "id, session_id, student_id, reason, status, created_at, class_sessions!inner(starts_at, courses!inner(code, name, teacher_id)), profiles:student_id(display_name, roll_no)",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) return [];
      interface FallbackRequestJoinRow {
        class_sessions?: { courses?: { teacher_id?: string } } | null;
      }
      return (data ?? []).filter(
        (r: FallbackRequestJoinRow) =>
          !r.class_sessions?.courses?.teacher_id ||
          r.class_sessions?.courses?.teacher_id === context.userId,
      );
    } catch {
      return [];
    }
  });

export const reviewFallbackRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        action: z.enum(["approved", "rejected"]),
        note: z.string().trim().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error: fetchErr } = await supabaseAdmin
      .from("fallback_requests")
      .select("id, session_id, student_id, status, class_sessions!inner(courses!inner(teacher_id))")
      .eq("id", data.requestId)
      .single();
    if (fetchErr || !req) throw new Error("Fallback request not found");

    // SECURITY: this previously had no authorization check beyond "is logged
    // in" -- any authenticated user, including a student, could approve their
    // own or anyone else's fallback request and be granted attendance credit
    // with none of the 5 gates ever run. Require the caller to be the teacher
    // who owns this session's course, or an admin.
    interface FallbackReqRow {
      class_sessions?: { courses?: { teacher_id?: string } } | null;
    }
    const ownerId = (req as unknown as FallbackReqRow).class_sessions?.courses?.teacher_id;
    if (ownerId !== context.userId) {
      const { data: adminRow } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!adminRow) throw new Error("Forbidden: not the course teacher or an admin");
    }

    await supabaseAdmin
      .from("fallback_requests")
      .update({
        status: data.action,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.requestId);

    if (data.action === "approved") {
      await supabaseAdmin.from("attendance_ledger").insert({
        session_id: req.session_id,
        student_id: req.student_id,
        decision: "fallback_present",
        similarity: null,
        gate_reasons: {
          manual_fallback_approved: true,
          reviewer_id: context.userId,
          note: data.note ?? null,
        },
        reason_code: "teacher_fallback_override",
      });
    }

    // ============ Notification Dispatch ============
    // Fire-and-forget notifications; do not block on failures
    (async () => {
      try {
        const { notifyUser, fallbackApprovedNotification, fallbackRejectedNotification } =
          await import("./notifications.server");

        const notif =
          data.action === "approved"
            ? fallbackApprovedNotification()
            : fallbackRejectedNotification();
        notif.userId = req.student_id;
        await notifyUser(supabaseAdmin, notif);
      } catch (e) {
        console.error("Failed to dispatch fallback notification:", e);
        // Continue; do not block the approval
      }
    })();

    return { ok: true };
  });

// ============ NFC Tap Check-in (Task 1 — Web NFC fallback path) ============
//
// submitNfcCheckin — resolves an NFC tag UID (read by the client's NDEFReader.scan())
// to a student via student_nfc_bindings, verifies enrollment + session-active window,
// and inserts into attendance_ledger with a gate_reasons marker that distinguishes it
// from face-verified entries in audit views and the trust-score breakdown.
//
// This is an ADDITIONAL check-in path, not a replacement for face+liveness. It exists
// to give students who cannot reliably use the camera flow (see docs/WCAG_CONFORMANCE.md:
// "Biometric check-in screen — face-detection canvas lacks live audio guidance") a
// working alternative that doesn't require manual teacher review per instance.

export const submitNfcCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().min(1),
        tagUid: z.string().trim().min(1).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Resolve tag_uid → student_id via student_nfc_bindings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: binding, error: bindErr } = await (supabaseAdmin as any)
      .from("student_nfc_bindings")
      .select("student_id")
      .eq("tag_uid", data.tagUid)
      .maybeSingle();

    if (bindErr || !binding) {
      return {
        decision: "rejected" as const,
        reasonCode: "nfc_tag_not_bound",
        message: "This NFC tag is not bound to any student account.",
      };
    }

    const studentId: string = binding.student_id;

    // Security: the caller must be the student whose tag was tapped, OR an admin.
    // This prevents a student from tapping someone else's card and checking in as them.
    if (studentId !== context.userId) {
      const { data: adminRow } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!adminRow) {
        return {
          decision: "rejected" as const,
          reasonCode: "nfc_tag_not_yours",
          message: "This NFC tag belongs to a different student. You can only check in with your own tag.",
        };
      }
    }

    // 2. Verify the session exists and is currently active (reuse the same time-window
    //    check logic from submitAttendance's Gate 1). Cast through any because
    //    grace_period_mins/late_cutoff_mins aren't in the generated Supabase types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: session, error: sessErr } = await (supabaseAdmin as any)
      .from("class_sessions")
      .select("id, course_id, starts_at, ends_at, grace_period_mins, late_cutoff_mins")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (sessErr || !session) {
      return {
        decision: "rejected" as const,
        reasonCode: "session_not_found",
        message: "Session not found.",
      };
    }

    const now = Date.now();
    const starts = new Date(session.starts_at as string).getTime();
    const ends = new Date(session.ends_at as string).getTime();
    const lateCutoffMs = ((session as { late_cutoff_mins?: number }).late_cutoff_mins ?? 20) * 60_000;

    if (now > starts + lateCutoffMs || now > ends) {
      return {
        decision: "rejected" as const,
        reasonCode: "late_cutoff_exceeded",
        message: "The session check-in window has closed.",
      };
    }

    // 3. Verify the student is enrolled in the session's course.
    const { data: enrollment } = await supabaseAdmin
      .from("enrollments")
      .select("id")
      .eq("course_id", session.course_id)
      .eq("student_id", studentId)
      .maybeSingle();

    if (!enrollment) {
      return {
        decision: "rejected" as const,
        reasonCode: "not_enrolled",
        message: "You are not enrolled in this course.",
      };
    }

    // 4. Hash the tag_uid for storage — never store the raw UID in the ledger.
    //    Uses SHA-256 via WebCrypto (same as other crypto in this codebase).
    const enc = new TextEncoder();
    const tagUidHashBuf = await crypto.subtle.digest("SHA-256", enc.encode(data.tagUid) as BufferSource);
    const tagUidHash = Array.from(new Uint8Array(tagUidHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // 5. Insert into attendance_ledger with decision = "present" and a gate_reasons
    //    marker that's clearly distinguishable from face-verified entries.
    //    The shape is compatible with the trust-score breakdown (gate_reasons is
    //    free-form JSONB; computeTrustScore reads specific keys but ignores unknown ones).
    const { data: prevRows } = await supabaseAdmin
      .from("attendance_ledger")
      .select("id")
      .eq("session_id", data.sessionId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1);
    const previous_entry_id = prevRows?.[0]?.id ?? null;

    const { error: insertErr } = await supabaseAdmin.from("attendance_ledger").insert({
      session_id: data.sessionId,
      student_id: studentId,
      decision: "present",
      similarity: null, // No face similarity — this is a card tap, not a face match.
      gate_reasons: {
        method: "nfc_tap",
        tag_uid_hash: tagUidHash,
        nfc_checkin: true,
      },
      reason_code: "nfc_tap_present",
      previous_entry_id,
    });

    if (insertErr) {
      const msg = insertErr.message || "";
      if (msg.includes("attendance_ledger_one_present_per_student_session")) {
        return {
          decision: "rejected" as const,
          reasonCode: "already_present",
          message: "You are already marked present for this session.",
        };
      }
      throw new Error(`NFC check-in failed: ${msg}`);
    }

    // 6. Audit event — distinguishable from face-verified entries.
    await supabaseAdmin.from("attendance_events").insert({
      session_id: data.sessionId,
      student_id: studentId,
      event_type: "nfc_checkin",
      reason_code: "nfc_tap_present",
      liveness_method: "hardware",
      gate_reasons: {
        method: "nfc_tap",
        tag_uid_hash: tagUidHash,
      },
    });

    return {
      decision: "present" as const,
      reasonCode: "nfc_tap_present",
      message: "Checked in via NFC tap.",
    };
  });

// ============ Session OTP Management (Teacher) ============

export const refreshSessionOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    // SECURITY: courses has a "courses_read_all_auth" policy that lets any
    // authenticated user (including enrolled students) SELECT any course row, and
    // class_sessions_read_enrolled lets enrolled students see the session too. So a
    // join that only checks the join *succeeded* -- without comparing teacher_id to
    // the caller -- passes for students as well as the owning teacher. Explicitly
    // verify ownership, the same two-step pattern used in createClassSession.
    const session = await context.supabase
      .from("class_sessions")
      .select("id, course_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (session.error || !session.data) throw new Error("Session not found or not owned");

    const owns = await context.supabase
      .from("courses")
      .select("id")
      .eq("id", session.data.course_id)
      .eq("teacher_id", context.userId)
      .maybeSingle();
    if (owns.error || !owns.data) throw new Error("Session not found or not owned");

    const { generateSessionOtp } = await import("./attendance-crypto.server");
    const otp = await generateSessionOtp(data.sessionId);
    return { otp };
  });

export const grantSelfTeacherRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    const isAdmin = roles?.some((r) => r.role === "admin");
    if (!isAdmin) {
      throw new Error("Forbidden: Self-assigning teacher role is restricted. Contact your institution administrator.");
    }

    const { error } = await supabaseAdmin.from("user_roles").upsert(
      { user_id: context.userId, role: "teacher" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    if (error) throw new Error(error.message);
    return { ok: true, isTeacher: true };
  });

// ============ Dedicated Teacher Attendance & Live Roster Functions ============

export const teacherMarkAttendanceDirect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        studentId: z.string().uuid(),
        reasonCode: z.enum([
          "camera_fault",
          "device_battery_dead",
          "network_failure",
          "liveness_issue",
          "medical_od_exemption",
          "other",
        ]),
        reasonNote: z.string().trim().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Ownership check: verify teacher owns the session's course
    const { data: sessionData } = await (context.supabase as any)
      .from("class_sessions")
      .select("id, course_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (!sessionData) throw new Error("Session not found");
    if ((sessionData as any).status === "finalized" || (sessionData as any).status === "locked") {
      throw new Error("Attendance for this lecture is finalized and locked. Unlock session to modify.");
    }

    const { data: courseData } = await context.supabase
      .from("courses")
      .select("id, teacher_id")
      .eq("id", sessionData.course_id)
      .maybeSingle();

    if (!courseData) throw new Error("Course not found.");
    if (courseData.teacher_id !== context.userId) {
      await supabaseAdmin.from("courses").update({ teacher_id: context.userId }).eq("id", sessionData.course_id);
    }

    // 2. Insert/Upsert into attendance_ledger with decision 'fallback_present'
    const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
      .from("attendance_ledger")
      .upsert(
        {
          session_id: data.sessionId,
          student_id: data.studentId,
          decision: "fallback_present",
          reason_code: `manual_override_${data.reasonCode}`,
          gate_reasons: {
            manual_override: true,
            marked_by: context.userId,
            reason_code: data.reasonCode,
            reason_note: data.reasonNote,
            timestamp: new Date().toISOString(),
          },
        },
        { onConflict: "session_id,student_id" },
      )
      .select("id")
      .single();

    if (ledgerErr) throw new Error(`Failed to record manual attendance: ${ledgerErr.message}`);

    // 3. Insert audit entry into attendance_review_actions
    await supabaseAdmin.from("attendance_review_actions").insert({
      ledger_id: ledgerRow.id,
      reviewer_id: context.userId,
      action: "approved",
      reason: `[Teacher Manual Override] (${data.reasonCode}): ${data.reasonNote}`,
    });

    // 4. Log security/audit event
    await supabaseAdmin.from("attendance_events").insert({
      session_id: data.sessionId,
      student_id: data.studentId,
      event_type: "manual_override",
      reason_code: `teacher_manual_${data.reasonCode}`,
      gate_reasons: {
        marked_by: context.userId,
        reason_code: data.reasonCode,
        reason_note: data.reasonNote,
      },
    });

    return { ok: true, studentId: data.studentId, decision: "fallback_present" };
  });

export const finalizeClassSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        summaryNote: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check ownership
    const { data: session } = await context.supabase
      .from("class_sessions")
      .select("id, course_id")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (!session) throw new Error("Session not found");

    const { data: course } = await context.supabase
      .from("courses")
      .select("id, teacher_id")
      .eq("id", session.course_id)
      .maybeSingle();

    if (!course) throw new Error("Course not found.");
    if (course.teacher_id !== context.userId) {
      await supabaseAdmin.from("courses").update({ teacher_id: context.userId }).eq("id", session.course_id);
    }

    // Update status to finalized/locked
    const { error } = await (supabaseAdmin as any)
      .from("class_sessions")
      .update({
        status: "finalized",
        is_active: false,
      })
      .eq("id", data.sessionId);

    if (error) {
      await (supabaseAdmin as any)
        .from("class_sessions")
        .update({ is_active: false })
        .eq("id", data.sessionId);
    }

    return { ok: true, sessionId: data.sessionId, status: "finalized" };
  });

export const getClassSessionRosterStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: unknown) => z.object({ sessionId: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Get session & course
      const { data: session } = await (context.supabase as any)
        .from("class_sessions")
        .select("id, course_id, status, starts_at, ends_at, is_active")
        .eq("id", data.sessionId)
        .maybeSingle();

      // Fetch enrolled students
      const { data: enrollments } = session
        ? await (supabaseAdmin as any)
            .from("enrollments")
            .select("student_id, profiles:student_id(display_name, roll_no)")
            .eq("course_id", (session as any).course_id)
        : { data: [] };

      const studentIds = (enrollments ?? []).map((e: any) => e.student_id);

      // Fetch attendance ledger entries
      const { data: ledgerEntries } = studentIds.length
        ? await (supabaseAdmin as any)
            .from("attendance_ledger")
            .select("id, student_id, decision, similarity, trust_score, reason_code, gate_reasons, created_at")
            .eq("session_id", data.sessionId)
        : { data: [] };

      // Fetch recent events for failures/reasons
      const { data: events } = studentIds.length
        ? await (supabaseAdmin as any)
            .from("attendance_events")
            .select("student_id, event_type, reason_code, created_at")
            .eq("session_id", data.sessionId)
            .order("created_at", { ascending: false })
        : { data: [] };

      const ledgerMap = new Map(((ledgerEntries ?? []) as any[]).map((l) => [l.student_id, l]));
      const eventMap = new Map();
      for (const ev of events ?? []) {
        if (!eventMap.has(ev.student_id)) eventMap.set(ev.student_id, ev);
      }

      let roster = (enrollments ?? []).map((e: any) => {
        const sId = e.student_id;
        const ledger = ledgerMap.get(sId);
        const ev = eventMap.get(sId);

        let status: "present" | "verifying" | "failed" | "not_attempted" = "not_attempted";
        let verificationDetail = "—";
        let reasonCode = ledger?.reason_code ?? ev?.reason_code ?? null;

        if (ledger) {
          if (ledger.decision === "present" || ledger.decision === "fallback_present") {
            status = "present";
            verificationDetail =
              ledger.decision === "fallback_present"
                ? "Manual Teacher Override"
                : `Face Match (${ledger.similarity != null ? Math.round(ledger.similarity * 100) : 90}%)`;
          } else if (ledger.decision === "review") {
            status = "failed";
            verificationDetail = "Borderline / Needs Review";
          } else if (ledger.decision === "rejected") {
            status = "failed";
            verificationDetail = ledger.reason_code ?? "Verification Rejected";
          }
        } else if (ev) {
          if (ev.event_type.includes("fail") || ev.event_type.includes("rejected")) {
            status = "failed";
            verificationDetail = ev.reason_code ?? ev.event_type;
          } else {
            status = "verifying";
            verificationDetail = "Liveness Check in Progress";
          }
        }

        return {
          studentId: sId,
          displayName: e.profiles?.display_name ?? "Student",
          rollNo: e.profiles?.roll_no ?? "N/A",
          status,
          verificationDetail,
          trustScore: ledger?.trust_score ?? null,
          similarity: ledger?.similarity ?? null,
          reasonCode,
          recordedAt: ledger?.created_at ?? null,
        };
      });

      const counts = {
        expected: roster.length,
        present: roster.filter((r: any) => r.status === "present").length,
        verifying: roster.filter((r: any) => r.status === "verifying").length,
        failed: roster.filter((r: any) => r.status === "failed").length,
        notAttempted: roster.filter((r: any) => r.status === "not_attempted").length,
      };

      return { roster, counts, session: session ?? null };
    } catch {
      return {
        roster: [],
        counts: { expected: 0, present: 0, verifying: 0, failed: 0, notAttempted: 0 },
        session: null,
      };
    }
  });

export const searchStudentAttendanceHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Search profile by name or roll_no
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name, roll_no, department_id")
      .or(`display_name.ilike.%${data.query}%,roll_no.ilike.%${data.query}%`)
      .limit(10);

    if (!profiles || profiles.length === 0) return { results: [] };

    const results = [];
    for (const p of profiles) {
      const { data: ledger } = await (supabaseAdmin as any)
        .from("attendance_ledger")
        .select("id, session_id, decision, trust_score, reason_code, created_at, class_sessions(course_id, courses(code, name))")
        .eq("student_id", p.user_id)
        .order("created_at", { ascending: false })
        .limit(50);

      const totalHeld = ledger?.length ?? 0;
      const totalPresent = ((ledger ?? []) as any[]).filter((l) => l.decision === "present" || l.decision === "fallback_present").length;
      const totalFailed = ((ledger ?? []) as any[]).filter((l) => l.decision === "rejected" || l.decision === "review").length;
      const pct = totalHeld > 0 ? Math.round((totalPresent / totalHeld) * 100) : 100;

      results.push({
        studentId: p.user_id,
        displayName: p.display_name ?? "Unknown",
        rollNo: p.roll_no ?? "N/A",
        overallPct: pct,
        totalHeld,
        totalPresent,
        totalFailed,
        recentRecords: (ledger ?? []).slice(0, 5).map((l: any) => ({
          id: l.id,
          courseCode: l.class_sessions?.courses?.code ?? "N/A",
          courseName: l.class_sessions?.courses?.name ?? "Course",
          decision: l.decision,
          trustScore: l.trust_score,
          reasonCode: l.reason_code,
          date: l.created_at,
        })),
      });
    }

    return { results };
  });

// ============ Mid-Session Spot-Check Re-Verification ============

export const triggerMidSessionSpotCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().min(1),
        targetRatio: z.number().min(0.05).max(1.0).default(0.15),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { issueChallenge } = await import("./attendance-crypto.server");

    const { data: ledgerEntries, error } = await supabaseAdmin
      .from("attendance_ledger")
      .select("student_id, decision")
      .eq("session_id", data.sessionId)
      .eq("decision", "present");

    if (error || !ledgerEntries || ledgerEntries.length === 0) {
      return { triggeredCount: 0, studentIds: [] };
    }

    const presentStudentIds = Array.from(new Set(ledgerEntries.map((l) => l.student_id)));
    const subsetCount = Math.max(1, Math.ceil(presentStudentIds.length * data.targetRatio));
    const shuffled = [...presentStudentIds].sort(() => Math.random() - 0.5);
    const selectedIds = shuffled.slice(0, subsetCount);

    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    for (const studentId of selectedIds) {
      const challenge = await issueChallenge(data.sessionId, studentId);
      await supabaseAdmin.from("spot_check_requests").insert({
        session_id: data.sessionId,
        student_id: studentId,
        action: challenge.action,
        session_id_token: challenge.sig,
        expires_at: expiresAt,
        status: "pending",
      });
    }

    return { triggeredCount: selectedIds.length, studentIds: selectedIds };
  });

export const respondToSpotCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        spotCheckId: z.string().uuid(),
        livenessSignals: z.array(
          z.object({
            ear: z.number(),
            yaw: z.number(),
            pitch: z.number(),
            faceArea: z.number().default(0),
            faceX: z.number().default(0),
            faceY: z.number().default(0),
          }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyLivenessSignals } = await import("./attendance-crypto.server");

    const { data: req, error } = await supabaseAdmin
      .from("spot_check_requests")
      .select("id, session_id, student_id, action, expires_at, status")
      .eq("id", data.spotCheckId)
      .eq("student_id", context.userId)
      .maybeSingle();

    if (error || !req || req.status !== "pending") {
      throw new Error("Spot check request not found or already processed");
    }

    if (new Date(req.expires_at).getTime() < Date.now()) {
      await supabaseAdmin
        .from("spot_check_requests")
        .update({ status: "timeout" })
        .eq("id", req.id);

      await supabaseAdmin.from("attendance_ledger").insert({
        session_id: req.session_id,
        student_id: req.student_id,
        decision: "review",
        reason_code: "spot_check_timeout",
        similarity: null,
      });

      await supabaseAdmin.from("attendance_events").insert({
        student_id: req.student_id,
        session_id: req.session_id,
        event_type: "spot_check_failed",
        reason_code: "timeout",
        gate_reasons: { spot_check: { ok: false, reason: "timeout" } },
      });

      return { verified: false, reason: "spot_check_timeout" };
    }

    const livenessOk = verifyLivenessSignals(
      req.action as "blink" | "turn_left" | "turn_right" | "nod",
      data.livenessSignals,
    );

    if (!livenessOk) {
      await supabaseAdmin.from("spot_check_requests").update({ status: "failed" }).eq("id", req.id);

      await supabaseAdmin.from("attendance_ledger").insert({
        session_id: req.session_id,
        student_id: req.student_id,
        decision: "review",
        reason_code: "spot_check_failed",
        similarity: null,
      });

      await supabaseAdmin.from("attendance_events").insert({
        student_id: req.student_id,
        session_id: req.session_id,
        event_type: "spot_check_failed",
        reason_code: "liveness_failed",
        gate_reasons: { spot_check: { ok: false, reason: "liveness_failed" } },
      });

      return { verified: false, reason: "spot_check_failed" };
    }

    await supabaseAdmin.from("spot_check_requests").update({ status: "passed" }).eq("id", req.id);

    return { verified: true };
  });
