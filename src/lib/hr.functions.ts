import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

// ============= Admin: Employee management =============

export const inviteOrLinkEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        displayName: z.string().trim().min(1).max(200),
        employeeCode: z.string().trim().min(1).max(32),
        designation: z.string().trim().min(1).max(100),
        employmentType: z.enum(["full_time", "part_time", "contract"]).default("full_time"),
        departmentId: z.string().uuid().nullable().optional(),
        baseSalary: z.number().min(0).max(10_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const existing = existingUsers?.users.find(
      (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
    );

    let employeeId: string;
    if (existing) {
      // Existing account (e.g. a teacher) being onboarded into payroll.
      employeeId = existing.id;
      const { error: upsertErr } = await supabaseAdmin.from("employees").upsert(
        {
          id: employeeId,
          employee_code: data.employeeCode,
          display_name: data.displayName,
          designation: data.designation,
          employment_type: data.employmentType,
          department_id: data.departmentId ?? null,
          base_salary: data.baseSalary,
        },
        { onConflict: "id" },
      );
      if (upsertErr) throw new Error(upsertErr.message);
    } else {
      const { data: invite, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        data.email,
        {
          data: {
            display_name: data.displayName,
            is_employee: "true",
            employee_code: data.employeeCode,
            designation: data.designation,
            employment_type: data.employmentType,
          },
        },
      );
      if (inviteErr || !invite?.user) {
        throw new Error(inviteErr?.message ?? "Failed to invite employee");
      }
      employeeId = invite.user.id;
      // The signup trigger creates the base row; patch in the fields it
      // can't get from auth metadata alone (department, salary).
      const { error: patchErr } = await supabaseAdmin
        .from("employees")
        .update({ department_id: data.departmentId ?? null, base_salary: data.baseSalary })
        .eq("id", employeeId);
      if (patchErr) throw new Error(patchErr.message);
    }

    return { ok: true, employeeId };
  });

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("employees")
      .select(
        "id, employee_code, display_name, designation, employment_type, department_id, base_salary, is_active, date_joined",
      )
      .order("display_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        employeeId: z.string().uuid(),
        baseSalary: z.number().min(0).max(10_000_000).optional(),
        designation: z.string().trim().min(1).max(100).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      base_salary?: number;
      designation?: string;
      is_active?: boolean;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };
    if (data.baseSalary !== undefined) patch.base_salary = data.baseSalary;
    if (data.designation !== undefined) patch.designation = data.designation;
    if (data.isActive !== undefined) patch.is_active = data.isActive;

    const { error } = await supabaseAdmin.from("employees").update(patch).eq("id", data.employeeId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Admin: Payroll processing =============

export const createPayrollRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        periodMonth: z.number().int().min(1).max(12),
        periodYear: z.number().int().min(2000).max(2100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: run, error: runErr } = await supabaseAdmin
      .from("payroll_runs")
      .insert({
        period_month: data.periodMonth,
        period_year: data.periodYear,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (runErr) throw new Error(runErr.message);

    const { data: employees, error: empErr } = await supabaseAdmin
      .from("employees")
      .select("id, base_salary")
      .eq("is_active", true);
    if (empErr) throw new Error(empErr.message);

    const rows = (employees ?? []).map((e) => ({
      payroll_run_id: run.id,
      employee_id: e.id,
      basic_salary: e.base_salary,
      allowances: 0,
      deductions: 0,
      gross_pay: e.base_salary,
      net_pay: e.base_salary,
    }));
    if (rows.length > 0) {
      const { error: payslipErr } = await supabaseAdmin.from("payslips").insert(rows);
      if (payslipErr) throw new Error(payslipErr.message);
    }

    return { runId: run.id, payslipsCreated: rows.length };
  });

export const listPayrollRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("payroll_runs")
      .select("id, period_month, period_year, status, created_at, finalized_at")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listPayslipsForRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ payrollRunId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("payslips")
      .select(
        "id, employee_id, basic_salary, allowances, deductions, gross_pay, net_pay, status, paid_at, employees(display_name, employee_code, designation)",
      )
      .eq("payroll_run_id", data.payrollRunId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updatePayslip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        payslipId: z.string().uuid(),
        allowances: z.number().min(0).max(10_000_000),
        deductions: z.number().min(0).max(10_000_000),
        notes: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: slip, error: getErr } = await supabaseAdmin
      .from("payslips")
      .select("basic_salary")
      .eq("id", data.payslipId)
      .single();
    if (getErr || !slip) throw new Error("Payslip not found");

    const grossPay = Number(slip.basic_salary) + data.allowances;
    const netPay = grossPay - data.deductions;

    const { error } = await supabaseAdmin
      .from("payslips")
      .update({
        allowances: data.allowances,
        deductions: data.deductions,
        gross_pay: grossPay,
        net_pay: netPay,
        notes: data.notes ?? null,
      })
      .eq("id", data.payslipId);
    if (error) throw new Error(error.message);
    return { ok: true, grossPay, netPay };
  });

export const finalizeAndPayPayrollRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ payrollRunId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date().toISOString();
    const { error: runErr } = await supabaseAdmin
      .from("payroll_runs")
      .update({ status: "paid", finalized_at: now })
      .eq("id", data.payrollRunId);
    if (runErr) throw new Error(runErr.message);

    const { data: slips, error: slipErr } = await supabaseAdmin
      .from("payslips")
      .update({ status: "paid", paid_at: now })
      .eq("payroll_run_id", data.payrollRunId)
      .select("id, employee_id, net_pay");
    if (slipErr) throw new Error(slipErr.message);

    (async () => {
      try {
        const { notifyUser } = await import("./notifications.server");
        await Promise.all(
          (slips ?? []).map((s) =>
            notifyUser(supabaseAdmin, {
              userId: s.employee_id,
              title: "Payslip ready",
              message: `Your payslip for this period has been processed. Net pay: ₹${s.net_pay}.`,
              type: "success",
            }),
          ),
        );
      } catch (e) {
        console.error("Failed to dispatch payslip notifications:", e);
      }
    })();

    return { ok: true, payslipsPaid: slips?.length ?? 0 };
  });

// ============= Admin: Staff leave approval =============

export const listStaffLeaveRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("staff_leave_requests")
      .select(
        "id, employee_id, leave_type, start_date, end_date, reason, status, created_at, employees(display_name, employee_code)",
      )
      .eq("status", data.status)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const reviewStaffLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ requestId: z.string().uuid(), action: z.enum(["approved", "rejected"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: getErr } = await supabaseAdmin
      .from("staff_leave_requests")
      .select("employee_id, status, start_date, end_date, leave_type")
      .eq("id", data.requestId)
      .single();
    if (getErr || !req) throw new Error("Leave request not found");
    if (req.status !== "pending") throw new Error("Already reviewed");

    const { error } = await supabaseAdmin
      .from("staff_leave_requests")
      .update({
        status: data.action,
        approved_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.requestId);
    if (error) throw new Error(error.message);

    (async () => {
      try {
        const { notifyUser } = await import("./notifications.server");
        await notifyUser(supabaseAdmin, {
          userId: req.employee_id,
          title: `Leave request ${data.action}`,
          message: `Your ${req.leave_type} leave (${req.start_date} to ${req.end_date}) was ${data.action}.`,
          type: data.action === "approved" ? "success" : "error",
        });
      } catch (e) {
        console.error("Failed to dispatch staff leave notification:", e);
      }
    })();

    return { ok: true };
  });

// ============= Employee-facing =============

export const getMyEmployeeProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("employees")
      .select(
        "id, employee_code, display_name, designation, employment_type, date_joined, is_active",
      )
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const getMyPayslips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("payslips")
      .select(
        "id, basic_salary, allowances, deductions, gross_pay, net_pay, status, paid_at, payroll_runs(period_month, period_year)",
      )
      .eq("employee_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const submitStaffLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leaveType: z.enum(["casual", "sick", "earned", "unpaid"]),
        startDate: z.string(),
        endDate: z.string(),
        reason: z.string().trim().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("staff_leave_requests").insert({
      employee_id: context.userId,
      leave_type: data.leaveType,
      start_date: data.startDate,
      end_date: data.endDate,
      reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyStaffLeaveRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("staff_leave_requests")
      .select("id, leave_type, start_date, end_date, reason, status, created_at")
      .eq("employee_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
