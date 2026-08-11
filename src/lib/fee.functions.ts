import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  isRazorpayConfigured,
  getRazorpayPublicKeyId,
} from "@/lib/razorpay.server";

async function requireAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

function computeStatus(
  amountDue: number,
  amountPaid: number,
  dueDate: string,
): "pending" | "partial" | "paid" | "overdue" {
  if (amountPaid >= amountDue) return "paid";
  const isOverdue = new Date(dueDate).getTime() < Date.now();
  if (amountPaid > 0) return "partial"; // partial takes precedence for display even if also overdue
  return isOverdue ? "overdue" : "pending";
}

// ============= Admin: Fee structure & invoice generation =============

export const createFeeStructure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        category: z.enum(["tuition", "hostel", "exam", "library", "transport", "misc"]),
        amount: z.number().positive().max(10_000_000),
        dueDate: z.string(),
        programId: z.string().uuid().nullable().optional(),
        semesterId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("fee_structures")
      .insert({
        name: data.name,
        category: data.category,
        amount: data.amount,
        due_date: data.dueDate,
        program_id: data.programId ?? null,
        semester_id: data.semesterId ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listFeeStructures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fee_structures")
      .select("id, name, category, amount, due_date, program_id, semester_id, created_at")
      .order("due_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const generateInvoicesForStructure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ feeStructureId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: structure, error: structErr } = await supabaseAdmin
      .from("fee_structures")
      .select("id, amount, due_date, program_id, semester_id")
      .eq("id", data.feeStructureId)
      .single();
    if (structErr || !structure) throw new Error("Fee structure not found");

    let studentQuery = supabaseAdmin.from("profiles").select("user_id");
    if (structure.program_id) studentQuery = studentQuery.eq("program_id", structure.program_id);
    const { data: students, error: studentsErr } = await studentQuery;
    if (studentsErr) throw new Error(studentsErr.message);

    const rows = (students ?? []).map((s) => ({
      student_id: s.user_id,
      fee_structure_id: structure.id,
      amount_due: structure.amount,
      due_date: structure.due_date,
    }));
    if (rows.length === 0) return { created: 0 };

    const { error: insertErr } = await supabaseAdmin
      .from("fee_invoices")
      .upsert(rows, { onConflict: "student_id,fee_structure_id", ignoreDuplicates: true });
    if (insertErr) throw new Error(insertErr.message);

    return { created: rows.length };
  });

export const listAllInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z.enum(["pending", "partial", "paid", "overdue", "waived"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("fee_invoices")
      .select(
        "id, student_id, fee_structure_id, amount_due, amount_paid, status, due_date, created_at, fee_structures(name, category), profiles:student_id(display_name, roll_no)",
      )
      .order("due_date", { ascending: true });
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Recompute display status on the fly (overdue is time-dependent, not stored as truth).
    interface InvoiceJoinRow {
      id: string;
      amount_due: number;
      amount_paid: number;
      status: string;
      due_date: string;
      [key: string]: unknown;
    }
    return ((rows ?? []) as InvoiceJoinRow[]).map((r) => ({
      ...r,
      status:
        r.status === "waived" ? "waived" : computeStatus(r.amount_due, r.amount_paid, r.due_date),
    }));
  });

export const recordManualPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        amount: z.number().positive().max(10_000_000),
        method: z.enum(["cash", "cheque", "bank_transfer"]),
        notes: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invoice, error: invErr } = await supabaseAdmin
      .from("fee_invoices")
      .select("id, student_id, amount_due, amount_paid, due_date")
      .eq("id", data.invoiceId)
      .single();
    if (invErr || !invoice) throw new Error("Invoice not found");

    const { error: payErr } = await supabaseAdmin.from("fee_payments").insert({
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      amount: data.amount,
      method: data.method,
      status: "success",
      recorded_by: context.userId,
      notes: data.notes ?? null,
      paid_at: new Date().toISOString(),
    });
    if (payErr) throw new Error(payErr.message);

    const newAmountPaid = Number(invoice.amount_paid) + data.amount;
    const newStatus = computeStatus(invoice.amount_due, newAmountPaid, invoice.due_date);
    const { error: updateErr } = await supabaseAdmin
      .from("fee_invoices")
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoice.id);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true, newStatus };
  });

export const waiveInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ invoiceId: z.string().uuid(), reason: z.string().trim().min(1).max(500) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invoice, error: invErr } = await supabaseAdmin
      .from("fee_invoices")
      .select("student_id")
      .eq("id", data.invoiceId)
      .single();
    if (invErr || !invoice) throw new Error("Invoice not found");

    const { error } = await supabaseAdmin
      .from("fee_invoices")
      .update({ status: "waived", updated_at: new Date().toISOString() })
      .eq("id", data.invoiceId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("fee_payments").insert({
      invoice_id: data.invoiceId,
      student_id: invoice.student_id,
      amount: 0.01, // nominal audit row; waivers aren't "payments" but this keeps a trail with the reason
      method: "bank_transfer",
      status: "success",
      recorded_by: context.userId,
      notes: `WAIVED: ${data.reason}`,
      paid_at: new Date().toISOString(),
    });

    return { ok: true };
  });

export const getFeeCollectionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invoices, error } = await supabaseAdmin
      .from("fee_invoices")
      .select("amount_due, amount_paid, status, due_date");
    if (error) throw new Error(error.message);

    let totalDue = 0;
    let totalCollected = 0;
    let overdueCount = 0;
    let pendingCount = 0;
    for (const inv of invoices ?? []) {
      totalDue += Number(inv.amount_due);
      totalCollected += Number(inv.amount_paid);
      const status =
        inv.status === "waived"
          ? "waived"
          : computeStatus(inv.amount_due, inv.amount_paid, inv.due_date);
      if (status === "overdue") overdueCount++;
      if (status === "pending") pendingCount++;
    }

    return {
      totalDue: Math.round(totalDue * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round((totalDue - totalCollected) * 100) / 100,
      overdueCount,
      pendingCount,
      invoiceCount: invoices?.length ?? 0,
    };
  });

// ============= Student: view invoices & pay =============

export const getMyInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fee_invoices")
      .select("id, amount_due, amount_paid, status, due_date, fee_structures(name, category)")
      .eq("student_id", context.userId)
      .order("due_date", { ascending: true });
    if (error) throw new Error(error.message);

    interface InvoiceRow {
      id: string;
      amount_due: number;
      amount_paid: number;
      status: string;
      due_date: string;
      [key: string]: unknown;
    }
    return ((data ?? []) as InvoiceRow[]).map((r) => ({
      ...r,
      status:
        r.status === "waived" ? "waived" : computeStatus(r.amount_due, r.amount_paid, r.due_date),
    }));
  });

export const getRazorpayConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    configured: isRazorpayConfigured(),
    keyId: getRazorpayPublicKeyId(),
  }));

export const createPaymentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invoice, error } = await supabaseAdmin
      .from("fee_invoices")
      .select("id, student_id, amount_due, amount_paid, status")
      .eq("id", data.invoiceId)
      .single();
    if (error || !invoice) throw new Error("Invoice not found");
    if (invoice.student_id !== context.userId) throw new Error("Forbidden");
    if (invoice.status === "paid" || invoice.status === "waived") {
      throw new Error("This invoice is already settled");
    }

    const balance = Number(invoice.amount_due) - Number(invoice.amount_paid);
    if (balance <= 0) {
      throw new Error("This invoice has no outstanding balance.");
    }
    const amountPaise = Math.round(balance * 100);

    const order = await createRazorpayOrder(amountPaise, invoice.id, {
      invoice_id: invoice.id,
      student_id: invoice.student_id,
    });

    const { error: payErr } = await supabaseAdmin.from("fee_payments").insert({
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      amount: balance,
      method: "razorpay",
      status: "created",
      razorpay_order_id: order.id,
    });
    if (payErr) throw new Error(payErr.message);

    return { orderId: order.id, amountPaise, currency: order.currency };
  });

export const confirmPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        razorpayOrderId: z.string(),
        razorpayPaymentId: z.string(),
        razorpaySignature: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invoice, error } = await supabaseAdmin
      .from("fee_invoices")
      .select("id, student_id, amount_due, amount_paid, due_date")
      .eq("id", data.invoiceId)
      .single();
    if (error || !invoice) throw new Error("Invoice not found");
    if (invoice.student_id !== context.userId) throw new Error("Forbidden");

    const isValid = verifyRazorpaySignature(
      data.razorpayOrderId,
      data.razorpayPaymentId,
      data.razorpaySignature,
    );
    if (!isValid) {
      await supabaseAdmin
        .from("fee_payments")
        .update({ status: "failed" })
        .eq("razorpay_order_id", data.razorpayOrderId);
      throw new Error("Payment signature verification failed");
    }

    const { data: existingPayment } = await supabaseAdmin
      .from("fee_payments")
      .select("id, amount, status")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .maybeSingle();

    if (existingPayment?.status === "success") {
      const currentStatus = computeStatus(
        invoice.amount_due,
        invoice.amount_paid,
        invoice.due_date,
      );
      return { ok: true, status: currentStatus };
    }

    if (!existingPayment) throw new Error("Matching payment record not found");

    await supabaseAdmin
      .from("fee_payments")
      .update({
        status: "success",
        razorpay_payment_id: data.razorpayPaymentId,
        razorpay_signature: data.razorpaySignature,
        paid_at: new Date().toISOString(),
      })
      .eq("id", existingPayment.id);

    const newAmountPaid = Number(invoice.amount_paid) + Number(existingPayment.amount);
    const newStatus = computeStatus(invoice.amount_due, newAmountPaid, invoice.due_date);
    await supabaseAdmin
      .from("fee_invoices")
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoice.id);

    (async () => {
      try {
        const { notifyUser, notifyGuardiansOfStudent } = await import("./notifications.server");
        const notif = {
          userId: invoice.student_id,
          title: "Payment received",
          message: `Payment of ₹${existingPayment.amount} received. ${newStatus === "paid" ? "Invoice fully paid." : "Partial payment recorded."}`,
          type: "success" as const,
        };
        await notifyUser(supabaseAdmin, notif);
        await notifyGuardiansOfStudent(supabaseAdmin, invoice.student_id, notif);
      } catch (e) {
        console.error("Failed to dispatch payment confirmation notification:", e);
      }
    })();

    return { ok: true, status: newStatus };
  });
