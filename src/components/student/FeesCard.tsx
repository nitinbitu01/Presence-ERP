// src/components/student/FeesCard.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { memo, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getMyInvoices,
  getRazorpayConfig,
  createPaymentOrder,
  confirmPayment,
} from "@/lib/fee.functions";
import { useStableServerFn } from "@/lib/useStableServerFn";
import { SectionErrorBoundary } from "@/components/student/ErrorBoundary";
import { TableSkeleton } from "@/components/student/Skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

declare global {
  interface Window {
    Razorpay: any;
  }
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, FileText, RefreshCw } from "lucide-react";

type InvoiceRow = {
  id: string;
  amount_due: number;
  amount_paid: number;
  status: string;
  due_date: string;
  fee_structures: { name: string; category: string } | null;
};

const RAZORPAY_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

let razorpayScriptPromise: Promise<boolean> | null = null;
function loadRazorpayScript(): Promise<boolean> {
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve) => {
    if (typeof window === "undefined") { resolve(false); return; }
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      razorpayScriptPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return razorpayScriptPromise;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const FeesCard = memo(function FeesCard({
  showToast,
}: {
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const getInvoices = useStableServerFn(useServerFn(getMyInvoices));
  const getConfig = useStableServerFn(useServerFn(getRazorpayConfig));
  const createOrder = useStableServerFn(useServerFn(createPaymentOrder));
  const confirm = useStableServerFn(useServerFn(confirmPayment));

  const { data: invoices, isLoading, error, refetch } = useQuery({
    queryKey: ["my-invoices"],
    queryFn: () => getInvoices() as Promise<InvoiceRow[]>,
    staleTime: 60_000,
  });

  const { data: rzpConfig } = useQuery({
    queryKey: ["razorpay-config"],
    queryFn: () => getConfig(),
    staleTime: 5 * 60_000,
  });

  const [payingId, setPayingId] = useState<string | null>(null);

  const handlePay = useCallback(
    async (invoice: InvoiceRow) => {
      if (!rzpConfig?.configured || !rzpConfig.keyId) {
        showToast(
          "Online payments are not enabled. Please pay at the administration office.",
          "info",
        );
        return;
      }
      if (payingId) return;

      setPayingId(invoice.id);
      try {
        const loaded = await loadRazorpayScript();
        if (!loaded || !window.Razorpay) {
          throw new Error(
            "Could not load payment gateway. Check your connection and try again.",
          );
        }
        const order = await createOrder({
          data: { invoiceId: invoice.id },
        });
        const rzp = new window.Razorpay({
          key: rzpConfig.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          order_id: order.orderId,
          name: "Presence ERP — Fee Payment",
          description: invoice.fee_structures?.name ?? "Fee payment",
          theme: { color: "#6366f1" },
          handler: async (response: any) => {
            try {
              await confirm({
                data: {
                  invoiceId: invoice.id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                },
              });
              await refetch();
              showToast("Payment successful! Receipt will be emailed to you.", "success");
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Payment confirmation failed.";
              showToast(msg, "error");
            } finally {
              setPayingId(null);
            }
          },
          modal: { ondismiss: () => setPayingId(null) },
        });
        rzp.open();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not initiate payment.";
        showToast(msg, "error");
        setPayingId(null);
      }
    },
    [rzpConfig, payingId, refetch, showToast, createOrder, confirm],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <FileText className="h-4 w-4" aria-hidden="true" />
          Fee Invoices
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SectionErrorBoundary sectionName="Fee Invoices">
          {isLoading && <TableSkeleton rows={2} />}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1 text-sm text-destructive">
                Could not load invoices.
              </div>
              <button
                onClick={() => refetch()}
                className="shrink-0 text-xs text-destructive underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
          {!isLoading && !error && (!invoices || invoices.length === 0) && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No fee invoices yet.</p>
            </div>
          )}
          {invoices && invoices.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fee</TableHead>
                  <TableHead>Paid / Due</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-xs">
                      {inv.fee_structures?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {fmtCurrency(inv.amount_paid)} / {fmtCurrency(inv.amount_due)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {fmtDate(inv.due_date)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          inv.status === "paid"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : inv.status === "overdue"
                              ? "bg-red-500/15 text-red-700 dark:text-red-400"
                              : inv.status === "waived"
                                ? "bg-muted text-muted-foreground"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        }
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.status !== "paid" && inv.status !== "waived" && (
                        <Button
                          size="sm"
                          onClick={() => handlePay(inv)}
                          disabled={payingId !== null}
                          aria-busy={payingId === inv.id}
                          className="h-7 text-xs"
                        >
                          {payingId === inv.id ? (
                            <span className="flex items-center gap-1.5">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Processing…
                            </span>
                          ) : (
                            "Pay Now"
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionErrorBoundary>
      </CardContent>
    </Card>
  );
});
