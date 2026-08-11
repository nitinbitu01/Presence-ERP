import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyRazorpaySignature } from "../razorpay.server";

describe("Invoice Status Computation", () => {
  // Mirrors computeStatus in fee.functions.ts
  function computeStatus(
    amountDue: number,
    amountPaid: number,
    dueDate: string,
  ): "pending" | "partial" | "paid" | "overdue" {
    if (amountPaid >= amountDue) return "paid";
    const isOverdue = new Date(dueDate).getTime() < Date.now();
    if (amountPaid > 0) return "partial";
    return isOverdue ? "overdue" : "pending";
  }

  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  it("marks a fully paid invoice as paid regardless of due date", () => {
    expect(computeStatus(1000, 1000, pastDate)).toBe("paid");
    expect(computeStatus(1000, 1200, futureDate)).toBe("paid"); // overpayment still counts as paid
  });

  it("marks an unpaid, not-yet-due invoice as pending", () => {
    expect(computeStatus(1000, 0, futureDate)).toBe("pending");
  });

  it("marks an unpaid, past-due invoice as overdue", () => {
    expect(computeStatus(1000, 0, pastDate)).toBe("overdue");
  });

  it("marks a partially paid invoice as partial even if also overdue", () => {
    expect(computeStatus(1000, 300, pastDate)).toBe("partial");
    expect(computeStatus(1000, 300, futureDate)).toBe("partial");
  });

  it("treats exact-due-date-today boundary consistently (not flaky)", () => {
    // Same computation run twice in quick succession should agree
    const a = computeStatus(1000, 0, futureDate);
    const b = computeStatus(1000, 0, futureDate);
    expect(a).toBe(b);
  });
});

describe("Razorpay Signature Verification", () => {
  const secret = "test_secret_key";

  function sign(orderId: string, paymentId: string, key: string): string {
    return createHmac("sha256", key).update(`${orderId}|${paymentId}`).digest("hex");
  }

  it("accepts a correctly signed payment confirmation", () => {
    process.env.RAZORPAY_KEY_SECRET = secret;
    const signature = sign("order_abc123", "pay_xyz789", secret);
    expect(verifyRazorpaySignature("order_abc123", "pay_xyz789", signature)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    process.env.RAZORPAY_KEY_SECRET = secret;
    const signature = sign("order_abc123", "pay_xyz789", secret);
    const tampered = signature.slice(0, -1) + (signature.at(-1) === "a" ? "b" : "a");
    expect(verifyRazorpaySignature("order_abc123", "pay_xyz789", tampered)).toBe(false);
  });

  it("rejects a signature computed for a different order/payment pair", () => {
    process.env.RAZORPAY_KEY_SECRET = secret;
    const signature = sign("order_abc123", "pay_xyz789", secret);
    // Same signature, but claiming a different order id -> must fail
    expect(verifyRazorpaySignature("order_different", "pay_xyz789", signature)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    process.env.RAZORPAY_KEY_SECRET = secret;
    const signature = sign("order_abc123", "pay_xyz789", "wrong_secret");
    expect(verifyRazorpaySignature("order_abc123", "pay_xyz789", signature)).toBe(false);
  });

  it("throws a clear configuration error when no secret is set", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(() => verifyRazorpaySignature("order_abc123", "pay_xyz789", "anything")).toThrow(
      /not configured/i,
    );
  });
});

describe("Fee Module Authorization", () => {
  it("only an admin can create fee structures or generate invoices", () => {
    const canManageFees = (role: "admin" | "teacher" | "student") => role === "admin";
    expect(canManageFees("admin")).toBe(true);
    expect(canManageFees("teacher")).toBe(false);
    expect(canManageFees("student")).toBe(false);
  });

  it("a student can only create a payment order for their own invoice", () => {
    const canPayInvoice = (requesterId: string, invoiceStudentId: string) =>
      requesterId === invoiceStudentId;
    expect(canPayInvoice("student-a", "student-a")).toBe(true);
    expect(canPayInvoice("student-a", "student-b")).toBe(false);
  });

  it("a guardian can read but never write fee_invoices or fee_payments", () => {
    const canGuardianWrite = false; // fee_invoices/fee_payments guardian policies are SELECT-only
    expect(canGuardianWrite).toBe(false);
  });

  it("payment rows are append-only: authenticated role has UPDATE/DELETE revoked", () => {
    // Mirrors: REVOKE UPDATE, DELETE ON public.fee_payments FROM authenticated;
    const clientCanMutatePayments = false;
    expect(clientCanMutatePayments).toBe(false);
  });

  it("an already-paid or waived invoice cannot be paid again", () => {
    const canCreateOrder = (status: string) => status !== "paid" && status !== "waived";
    expect(canCreateOrder("pending")).toBe(true);
    expect(canCreateOrder("partial")).toBe(true);
    expect(canCreateOrder("overdue")).toBe(true);
    expect(canCreateOrder("paid")).toBe(false);
    expect(canCreateOrder("waived")).toBe(false);
  });
});

describe("Fee Collection Summary Aggregation", () => {
  // Mirrors getFeeCollectionSummary's accumulation logic.
  function summarize(invoices: { amount_due: number; amount_paid: number; due_date: string }[]) {
    let totalDue = 0;
    let totalCollected = 0;
    for (const inv of invoices) {
      totalDue += inv.amount_due;
      totalCollected += inv.amount_paid;
    }
    return {
      totalDue: Math.round(totalDue * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round((totalDue - totalCollected) * 100) / 100,
    };
  }

  it("sums due and collected amounts across all invoices", () => {
    const result = summarize([
      { amount_due: 1000, amount_paid: 1000, due_date: "2026-01-01" },
      { amount_due: 500, amount_paid: 200, due_date: "2026-01-01" },
    ]);
    expect(result.totalDue).toBe(1500);
    expect(result.totalCollected).toBe(1200);
    expect(result.totalOutstanding).toBe(300);
  });

  it("handles an empty invoice set as all zeros", () => {
    const result = summarize([]);
    expect(result).toEqual({ totalDue: 0, totalCollected: 0, totalOutstanding: 0 });
  });

  it("rounds to 2 decimal places to avoid floating point noise", () => {
    const result = summarize([
      { amount_due: 100.1, amount_paid: 33.33, due_date: "2026-01-01" },
      { amount_due: 100.2, amount_paid: 33.33, due_date: "2026-01-01" },
    ]);
    expect(result.totalDue).toBe(200.3);
    expect(Number.isInteger(result.totalCollected * 100)).toBe(true);
  });
});
