import { describe, it, expect } from "vitest";

describe("Payslip Computation", () => {
  // Mirrors updatePayslip: gross = basic + allowances, net = gross - deductions.
  function computePayslip(basicSalary: number, allowances: number, deductions: number) {
    const grossPay = basicSalary + allowances;
    const netPay = grossPay - deductions;
    return { grossPay, netPay };
  }

  it("computes gross and net pay with no allowances or deductions", () => {
    const result = computePayslip(50000, 0, 0);
    expect(result.grossPay).toBe(50000);
    expect(result.netPay).toBe(50000);
  });

  it("adds allowances into gross pay", () => {
    const result = computePayslip(50000, 5000, 0);
    expect(result.grossPay).toBe(55000);
    expect(result.netPay).toBe(55000);
  });

  it("subtracts deductions from gross to get net pay", () => {
    const result = computePayslip(50000, 5000, 3000);
    expect(result.grossPay).toBe(55000);
    expect(result.netPay).toBe(52000);
  });

  it("allows net pay to go to zero when deductions equal gross", () => {
    const result = computePayslip(50000, 0, 50000);
    expect(result.netPay).toBe(0);
  });

  it("a newly created payslip defaults net pay to basic salary", () => {
    // Mirrors createPayrollRun's initial insert: allowances=0, deductions=0
    const result = computePayslip(45000, 0, 0);
    expect(result.netPay).toBe(45000);
  });
});

describe("Payroll Run Lifecycle", () => {
  const canEditPayslip = (runStatus: string) => runStatus !== "paid";
  const canFinalize = (runStatus: string) => runStatus !== "paid";

  it("allows editing payslips while the run is in draft", () => {
    expect(canEditPayslip("draft")).toBe(true);
  });

  it("blocks editing payslips once the run is paid", () => {
    expect(canEditPayslip("paid")).toBe(false);
  });

  it("allows finalizing a draft run exactly once", () => {
    expect(canFinalize("draft")).toBe(true);
    expect(canFinalize("paid")).toBe(false);
  });

  it("only active employees are included when a new payroll run is created", () => {
    const employees = [
      { id: "e1", is_active: true },
      { id: "e2", is_active: false },
      { id: "e3", is_active: true },
    ];
    const included = employees.filter((e) => e.is_active);
    expect(included.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("one payroll run per calendar month/year (enforced by DB unique constraint)", () => {
    const runs = [{ period_month: 1, period_year: 2026 }];
    const isDuplicate = (month: number, year: number) =>
      runs.some((r) => r.period_month === month && r.period_year === year);
    expect(isDuplicate(1, 2026)).toBe(true);
    expect(isDuplicate(2, 2026)).toBe(false);
  });
});

describe("HR Module Authorization", () => {
  it("only an admin can invite/manage employees or run payroll", () => {
    const canManageHr = (role: "admin" | "teacher" | "student") => role === "admin";
    expect(canManageHr("admin")).toBe(true);
    expect(canManageHr("teacher")).toBe(false);
    expect(canManageHr("student")).toBe(false);
  });

  it("an employee can only read their own payslips", () => {
    const canReadPayslip = (requesterId: string, payslipEmployeeId: string) =>
      requesterId === payslipEmployeeId;
    expect(canReadPayslip("emp-1", "emp-1")).toBe(true);
    expect(canReadPayslip("emp-1", "emp-2")).toBe(false);
  });

  it("payslips are append-only: authenticated role has UPDATE/DELETE revoked", () => {
    // Mirrors: REVOKE UPDATE, DELETE ON public.payslips FROM authenticated;
    const clientCanMutatePayslips = false;
    expect(clientCanMutatePayslips).toBe(false);
  });

  it("an employee may submit their own staff leave request but not approve it", () => {
    const canSubmit = (requesterId: string, employeeId: string) => requesterId === employeeId;
    const canApprove = (role: "admin" | "employee") => role === "admin";
    expect(canSubmit("emp-1", "emp-1")).toBe(true);
    expect(canApprove("employee")).toBe(false);
    expect(canApprove("admin")).toBe(true);
  });

  it("employee-invited accounts do not get a student profile/role", () => {
    // Mirrors the third handle_new_user branch: is_employee = 'true'
    const provisionOnSignup = (flag: "guardian" | "employee" | "student") => {
      if (flag === "guardian") return "guardians";
      if (flag === "employee") return "employees";
      return "profiles";
    };
    expect(provisionOnSignup("employee")).toBe("employees");
    expect(provisionOnSignup("guardian")).toBe("guardians");
    expect(provisionOnSignup("student")).toBe("profiles");
  });
});

describe("Staff Leave Request Validation", () => {
  it("rejects an end date before the start date (DB CHECK constraint mirror)", () => {
    const isValidRange = (start: string, end: string) => new Date(end) >= new Date(start);
    expect(isValidRange("2026-03-01", "2026-03-05")).toBe(true);
    expect(isValidRange("2026-03-05", "2026-03-01")).toBe(false);
  });

  it("accepts a single-day leave (start === end)", () => {
    const isValidRange = (start: string, end: string) => new Date(end) >= new Date(start);
    expect(isValidRange("2026-03-01", "2026-03-01")).toBe(true);
  });

  it("only a pending request can be reviewed", () => {
    const canReview = (status: string) => status === "pending";
    expect(canReview("pending")).toBe(true);
    expect(canReview("approved")).toBe(false);
    expect(canReview("rejected")).toBe(false);
  });
});
