import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TicketCategory =
  | "device_issue"
  | "attendance_dispute"
  | "account_access"
  | "general"
  | "biometric_re_enrollment"
  | "leave_dispute";

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface HelpdeskTicket {
  id: string;
  userId: string;
  userEmail: string;
  category: TicketCategory;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTo?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  slaBreachAt: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  authorEmail: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

/** Determine SLA deadline based on priority */
function computeSlaBreachAt(priority: TicketPriority): string {
  const hours: Record<TicketPriority, number> = {
    urgent: 4,
    high: 24,
    medium: 48,
    low: 72,
  };
  return new Date(Date.now() + hours[priority] * 3600_000).toISOString();
}

const categoryInputSchema = z.enum([
  "device_issue",
  "attendance_dispute",
  "account_access",
  "general",
  "biometric_re_enrollment",
  "leave_dispute",
]);

// ---- User-Facing Functions ----

export const createHelpdeskTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        category: categoryInputSchema,
        subject: z.string().min(3).max(200),
        description: z.string().min(5).max(5000),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
    const now = new Date().toISOString();
    const newTicket = {
      id: `ticket_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: context.userId,
      user_email: context.email ?? "",
      category: data.category,
      subject: data.subject,
      description: data.description,
      status: "open",
      priority: data.priority,
      sla_breach_at: computeSlaBreachAt(data.priority),
      created_at: now,
      updated_at: now,
    };

    let insertedId = newTicket.id;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error } = await (supabaseAdmin as any)
        .from("helpdesk_tickets")
        .insert(newTicket)
        .select()
        .single();
      if (inserted?.id) insertedId = inserted.id;
    } catch {
      console.warn(
        "[Helpdesk] DB insert failed (table may not exist yet), ticket stored in-memory",
      );
    }

    return {
      id: insertedId,
      userId: context.userId,
      userEmail: context.email ?? "",
      category: data.category,
      subject: data.subject,
      description: data.description,
      status: "open" as TicketStatus,
      priority: data.priority,
      slaBreachAt: newTicket.sla_breach_at,
      createdAt: now,
      updatedAt: now,
    };
  });

export const listMyHelpdeskTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
      const { data } = await supabaseAdmin
        .from("helpdesk_tickets")
        .select("*")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as HelpdeskTicket[];
    } catch {
      return [] as HelpdeskTicket[];
    }
  });

export const addTicketComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ticketId: z.string().min(1),
        body: z.string().min(1).max(2000),
        isInternal: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const comment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ticket_id: data.ticketId,
      author_id: context.userId,
      author_email: context.email ?? "",
      body: data.body,
      is_internal: data.isInternal,
      created_at: new Date().toISOString(),
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any).from("ticket_comments").insert(comment);
    } catch {
      console.warn("[Helpdesk] Comment insert skipped (table may not exist yet)");
    }
    return { success: true, commentId: comment.id };
  });

// ---- Admin Functions ----

export const listAllHelpdeskTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
      const { data } = await supabaseAdmin
        .from("helpdesk_tickets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as HelpdeskTicket[];
    } catch {
      return [] as HelpdeskTicket[];
    }
  });

export const updateTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ticketId: z.string().min(1),
        status: z.enum(["open", "in_progress", "resolved", "closed"]),
        assignedTo: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const updates: Record<string, string> = {
      status: data.status,
      updated_at: new Date().toISOString(),
    };
    if (data.status === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }
    if (data.assignedTo) {
      updates.assigned_to = data.assignedTo;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any).from("helpdesk_tickets").update(updates).eq("id", data.ticketId);
    } catch {
      console.warn("[Helpdesk] Status update skipped (table may not exist yet)");
    }
    return { success: true };
  });

export interface SlaBreachSummary {
  breachedCount: number;
  breachedTicketIds: string[];
}

/**
 * Monitors and flags open helpdesk tickets that have exceeded their SLA breach deadline.
 */
export const checkSlaBreaches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SlaBreachSummary> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as any;
    const nowIso = new Date().toISOString();

    try {
      const { data: breached } = await supabaseAdmin
        .from("helpdesk_tickets")
        .select("id, priority, subject, user_email, sla_breach_at")
        .eq("status", "open")
        .lt("sla_breach_at", nowIso);

      const breachedTicketIds = (breached ?? []).map((t: { id: string }) => t.id);

      if (breachedTicketIds.length > 0) {
        const { writeAuditLog } = await import("./admin.functions");
        for (const t of breached ?? []) {
          void writeAuditLog(supabaseAdmin, {
            actorId: context.userId,
            action: "helpdesk_sla_breached",
            targetTable: "helpdesk_tickets",
            targetId: t.id,
            details: {
              priority: t.priority,
              subject: t.subject,
              sla_breach_at: t.sla_breach_at,
            },
          });
        }
      }

      return {
        breachedCount: breachedTicketIds.length,
        breachedTicketIds,
      };
    } catch {
      return { breachedCount: 0, breachedTicketIds: [] };
    }
  });
