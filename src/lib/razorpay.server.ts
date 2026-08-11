import { createHmac } from "node:crypto";

function getEnv(key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (globalThis as any).process?.env || {};
  return env[key];
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Create a Razorpay order for a given amount (in the smallest currency unit,
 * i.e. paise for INR — a ₹500 invoice is amountPaise=50000). Requires
 * RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Throws a clear error if
 * unconfigured — unlike notifications, payments cannot silently no-op.
 */
export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes?: Record<string, string>,
): Promise<RazorpayOrder> {
  const keyId = getEnv("RAZORPAY_KEY_ID");
  const keySecret = getEnv("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    throw new Error(
      "Payments are not configured on this deployment (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET).",
    );
  }

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes: notes ?? {},
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Razorpay order creation failed: ${response.status} ${text}`);
  }

  return (await response.json()) as RazorpayOrder;
}

/**
 * Verify a Razorpay checkout callback's signature per Razorpay's documented
 * scheme: HMAC-SHA256(order_id + "|" + payment_id, key_secret) must equal
 * the signature returned by checkout.js. This MUST be done server-side —
 * never trust a client-reported "payment succeeded" without this check.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const keySecret = getEnv("RAZORPAY_KEY_SECRET");
  if (!keySecret) {
    throw new Error(
      "Payments are not configured on this deployment (missing RAZORPAY_KEY_SECRET).",
    );
  }
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return timingSafeEqualStrings(expected, signature);
}

/** Constant-time string comparison to avoid timing side-channels on signature checks. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function isRazorpayConfigured(): boolean {
  return !!getEnv("RAZORPAY_KEY_ID") && !!getEnv("RAZORPAY_KEY_SECRET");
}

export function getRazorpayPublicKeyId(): string | null {
  return getEnv("RAZORPAY_KEY_ID") ?? null;
}
