import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getMyEmployeeProfile,
  getMyPayslips,
  submitStaffLeaveRequest,
  listMyStaffLeaveRequests,
} from "@/lib/hr.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Briefcase } from "lucide-react";

export const Route = createFileRoute("/_authenticated/employee")({
  component: EmployeePortal,
});

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type Payslip = {
  id: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  gross_pay: number;
  net_pay: number;
  status: string;
  payroll_runs: { period_month: number; period_year: number } | null;
};

type StaffLeaveRow = {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  created_at: string;
};

function EmployeePortal() {
  const getProfileFn = useServerFn(getMyEmployeeProfile);
  const getPayslipsFn = useServerFn(getMyPayslips);
  const submitLeaveFn = useServerFn(submitStaffLeaveRequest);
  const listLeaveFn = useServerFn(listMyStaffLeaveRequests);
  const queryClient = useQueryClient();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-employee-profile"],
    queryFn: () => getProfileFn(),
  });
  const { data: payslips } = useQuery({
    queryKey: ["my-payslips"],
    queryFn: () => getPayslipsFn() as Promise<Payslip[]>,
    enabled: !!profile,
  });
  const { data: leaveRequests } = useQuery({
    queryKey: ["my-staff-leave"],
    queryFn: () => listLeaveFn() as Promise<StaffLeaveRow[]>,
    enabled: !!profile,
  });

  const [form, setForm] = useState({
    leaveType: "casual" as "casual" | "sick" | "earned" | "unpaid",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmitLeave = async () => {
    if (!form.startDate || !form.endDate || !form.reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await submitLeaveFn({ data: form });
      setForm({ leaveType: "casual", startDate: "", endDate: "", reason: "" });
      await queryClient.invalidateQueries({ queryKey: ["my-staff-leave"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Briefcase className="h-5 w-5 text-primary" />
            Presence — Employee Portal
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {profileLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!profileLoading && !profile && (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              No employee record found for your account. Contact HR/admin to be onboarded.
            </CardContent>
          </Card>
        )}

        {profile && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">
                  {profile.display_name} — {profile.designation}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Employee code: {profile.employee_code} ·{" "}
                {(profile.employment_type ?? "full_time").replace("_", " ")} · Joined{" "}
                {profile.date_joined ?? "recently"}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">My Payslips</CardTitle>
              </CardHeader>
              <CardContent>
                {!payslips || payslips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payslips yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Basic</TableHead>
                        <TableHead className="text-right">Allowances</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net Pay</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payslips.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">
                            {p.payroll_runs
                              ? `${MONTH_NAMES[p.payroll_runs.period_month - 1]} ${p.payroll_runs.period_year}`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs">₹{p.basic_salary}</TableCell>
                          <TableCell className="text-right text-xs">₹{p.allowances}</TableCell>
                          <TableCell className="text-right text-xs">₹{p.deductions}</TableCell>
                          <TableCell className="text-right text-xs font-semibold">
                            ₹{p.net_pay}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              className={
                                p.status === "paid"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              }
                            >
                              {p.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Request Leave</CardTitle>
              </CardHeader>
              <CardContent>
                {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select
                    value={form.leaveType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, leaveType: e.target.value as typeof f.leaveType }))
                    }
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="casual">Casual</option>
                    <option value="sick">Sick</option>
                    <option value="earned">Earned</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  />
                  <input
                    placeholder="Reason"
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  />
                </div>
                <button
                  onClick={handleSubmitLeave}
                  disabled={busy || !form.startDate || !form.endDate || !form.reason.trim()}
                  className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Submit Request
                </button>

                {leaveRequests && leaveRequests.length > 0 && (
                  <ul className="mt-4 divide-y divide-border">
                    {leaveRequests.map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2 text-xs">
                        <span>
                          <span className="uppercase text-muted-foreground">{r.leave_type}</span>{" "}
                          {r.start_date} to {r.end_date} — {r.reason}
                        </span>
                        <Badge
                          className={
                            r.status === "approved"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : r.status === "rejected"
                                ? "bg-red-500/15 text-red-700 dark:text-red-400"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          }
                        >
                          {r.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
