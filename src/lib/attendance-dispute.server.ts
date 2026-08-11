/**
 * Phase 5 Gap Closure: Student Attendance Dispute & Correction System
 * Allows students to submit attendance correction requests with proof attachments,
 * which instructors/admins can review, approve, or reject with full audit logging.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "./errors";

/**
 * submitAttendanceDispute — Student submits a dispute for a mis-recorded class session.
 */
export const submitAttendanceDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().min(1),
        reason: z.string().trim().min(5).max(1000),
        proofAttachmentUrl: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check if session exists
    const { data: session } = await supabaseAdmin
      .from("class_sessions")
      .select("id")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (!session) throw new PresenceErpError("NOT_FOUND", "Class session not found.");

    // Check for existing pending dispute
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabaseAdmin as any)
      .from("attendance_disputes")
      .select("id")
      .eq("student_id", context.userId)
      .eq("session_id", data.sessionId)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      throw new PresenceErpError(
        "CONFLICT",
        "A pending attendance dispute already exists for this session.",
      );
    }

    // Insert dispute
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: disputeRow, error } = await (supabaseAdmin as any)
      .from("attendance_disputes")
      .insert({
        student_id: context.userId,
        session_id: data.sessionId,
        reason: data.reason,
        proof_attachment_url: data.proofAttachmentUrl ?? null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) throw new PresenceErpError("DATABASE_ERROR", error.message);

    return { disputeId: disputeRow?.id, status: "pending" };
  });

/**
 * listMyDisputes — Lists attendance disputes submitted by the calling student.
 */
export const listMyDisputes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any)
      .from("attendance_disputes")
      .select(
        "id, session_id, reason, proof_attachment_url, status, resolution_notes, resolved_at, created_at, class_sessions(starts_at, courses(code, name))",
      )
      .eq("student_id", context.userId)
      .order("created_at", { ascending: false });

    if (error) throw new PresenceErpError("DATABASE_ERROR", error.message);
    return data ?? [];
  });

/**
 * resolveAttendanceDispute — Instructor/Admin approves or rejects an attendance dispute.
 * On approval, updates the attendance_ledger record decision to 'present' with audit trail.
 */
export const resolveAttendanceDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        disputeId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        resolutionNotes: z.string().trim().min(2).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check authority: admin or teacher
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    const isAuthorized = (roles ?? []).some((r) => r.role === "admin" || r.role === "teacher");
    if (!isAuthorized) {
      throw new PresenceErpError("FORBIDDEN", "Only teachers or admins can resolve disputes.");
    }

    // Fetch dispute
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dispute } = await (supabaseAdmin as any)
      .from("attendance_disputes")
      .select("id, student_id, session_id, status")
      .eq("id", data.disputeId)
      .single();

    if (!dispute) throw new PresenceErpError("NOT_FOUND", "Dispute not found.");
    if (dispute.status !== "pending") {
      throw new PresenceErpError("CONFLICT", "Dispute has already been resolved.");
    }

    const now = new Date().toISOString();

    // Update dispute row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from("attendance_disputes")
      .update({
        status: data.decision,
        resolved_by: context.userId,
        resolution_notes: data.resolutionNotes,
        resolved_at: now,
      })
      .eq("id", data.disputeId);

    // If approved, update or upsert attendance_ledger record to decision = 'present'
    if (data.decision === "approved") {
      await supabaseAdmin.from("attendance_ledger").upsert(
        {
          session_id: dispute.session_id,
          student_id: dispute.student_id,
          decision: "present",
          reason_code: "dispute_approved",
          gate_reasons: { disputeId: data.disputeId, resolvedBy: context.userId },
        },
        { onConflict: "session_id,student_id" },
      );
    }

    // Record audit log entry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from("audit_log")
      .insert({
        table_name: "attendance_disputes",
        record_id: data.disputeId,
        actor_id: context.userId,
        action: `dispute_${data.decision}`,
        payload: {
          studentId: dispute.student_id,
          sessionId: dispute.session_id,
          decision: data.decision,
          notes: data.resolutionNotes,
        },
      })
      .catch(() => {});

    return { disputeId: data.disputeId, status: data.decision, resolvedAt: now };
  });
