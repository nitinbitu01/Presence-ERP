/**
 * Task 1 — NFC Tag Provisioning (admin-only)
 *
 * Server functions for binding/unbinding NFC tags to student accounts.
 * Follows the same auth-middleware pattern (requireSupabaseAuth + checkIsAdmin)
 * used elsewhere in this repo (see admin.functions.ts).
 *
 * The tag_uid is the raw identifier read by NDEFReader.scan() in the browser.
 * Admins provision tags by reading a student's card/phone and entering the UID
 * (or the student reads it themselves in a provisioning flow and an admin confirms).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkIsAdmin } from "@/lib/admin.functions";

// ── bindNfcTag — admin binds an NFC tag to a student ────────────────────────

export const bindNfcTag = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .inputValidator((input: unknown) =>
        z
            .object({
                studentId: z.string().uuid(),
                tagUid: z.string().trim().min(1).max(128),
            })
            .parse(input),
    )
    .handler(async ({ data, context }) => {
        const isAdmin = await checkIsAdmin(context.userId, context.email);
        if (!isAdmin) {
            throw new Error("Forbidden: NFC tag provisioning requires administrator access.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Upsert: if the student already has a binding, replace it (rebind new card).
        // The unique constraint on tag_uid ensures a tag can't be bound to two students.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: row, error } = await (supabaseAdmin as any)
            .from("student_nfc_bindings")
            .upsert(
                {
                    student_id: data.studentId,
                    tag_uid: data.tagUid,
                    bound_at: new Date().toISOString(),
                    bound_by: context.userId,
                },
                { onConflict: "student_id" },
            )
            .select("student_id, tag_uid, bound_at")
            .single();

        if (error) {
            // Check for unique violation on tag_uid (tag already bound to another student)
            if (error.message?.includes("duplicate") || error.message?.includes("unique")) {
                throw new Error(
                    "This NFC tag is already bound to another student. Unbind it from that student first (lost-card flow).",
                );
            }
            throw new Error(error.message);
        }

        // Audit log
        await supabaseAdmin.from("attendance_events").insert({
            session_id: "00000000-0000-0000-0000-000000000000",
            student_id: data.studentId,
            event_type: "nfc_tag_bound",
            reason_code: "admin_provisioned",
            gate_reasons: {
                tag_uid: data.tagUid,
                bound_by: context.userId,
            },
        });

        return { ok: true, binding: row };
    });

// ── unbindNfcTag — admin removes an NFC binding (lost-card flow) ────────────

export const unbindNfcTag = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .inputValidator((input: unknown) =>
        z.object({ studentId: z.string().uuid() }).parse(input),
    )
    .handler(async ({ data, context }) => {
        const isAdmin = await checkIsAdmin(context.userId, context.email);
        if (!isAdmin) {
            throw new Error("Forbidden: NFC tag unbinding requires administrator access.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: deleted, error } = await (supabaseAdmin as any)
            .from("student_nfc_bindings")
            .delete()
            .eq("student_id", data.studentId)
            .select("student_id, tag_uid")
            .single();

        if (error) throw new Error(error.message);

        // Audit log
        await supabaseAdmin.from("attendance_events").insert({
            session_id: "00000000-0000-0000-0000-000000000000",
            student_id: data.studentId,
            event_type: "nfc_tag_unbound",
            reason_code: "admin_revoked",
            gate_reasons: {
                tag_uid: deleted?.tag_uid ?? null,
                unbound_by: context.userId,
            },
        });

        return { ok: true };
    });

// ── listNfcBindings — admin lists all NFC bindings ──────────────────────────

export const listNfcBindings = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .handler(async ({ context }) => {
        const isAdmin = await checkIsAdmin(context.userId, context.email);
        if (!isAdmin) {
            throw new Error("Forbidden: listing NFC bindings requires administrator access.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabaseAdmin as any)
            .from("student_nfc_bindings")
            .select(
                "student_id, tag_uid, bound_at, bound_by, profiles:student_id(display_name, roll_no)",
            )
            .order("bound_at", { ascending: false });

        if (error) throw new Error(error.message);
        return data ?? [];
    });

// ── getMyNfcBinding — student checks if they have a tag bound ───────────────

export const getMyNfcBinding = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .handler(async ({ context }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabaseAdmin as any)
            .from("student_nfc_bindings")
            .select("tag_uid, bound_at")
            .eq("student_id", context.userId)
            .maybeSingle();

        if (error) throw new Error(error.message);
        return { hasBinding: !!data, boundAt: data?.bound_at ?? null };
    });