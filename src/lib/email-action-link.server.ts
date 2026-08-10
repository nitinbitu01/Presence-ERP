import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ACTION_SECRET = process.env.EMAIL_ACTION_SECRET || "presence_erp_action_link_secret_key_2026";

export function generateActionToken(
  requestId: string,
  action: "approved" | "rejected",
  approverId: string,
): string {
  const expiresAt = Date.now() + 24 * 3600 * 1000; // 24 hours
  const payload = `${requestId}:${action}:${approverId}:${expiresAt}`;

  // Simple HMAC-like signature
  let hash = 0;
  const str = `${payload}:${ACTION_SECRET}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const sig = Math.abs(hash).toString(36);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyActionToken(
  token: string,
): { requestId: string; action: "approved" | "rejected"; approverId: string } | null {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf-8");
    const parts = raw.split(":");
    if (parts.length !== 5) return null;

    const [requestId, action, approverId, expiresAtStr, sig] = parts;
    if (Date.now() > parseInt(expiresAtStr, 10)) return null;

    const payload = `${requestId}:${action}:${approverId}:${expiresAtStr}`;
    let hash = 0;
    const str = `${payload}:${ACTION_SECRET}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const expectedSig = Math.abs(hash).toString(36);
    if (sig !== expectedSig) return null;

    return { requestId, action: action as "approved" | "rejected", approverId };
  } catch (e) {
    return null;
  }
}

export const executeEmailActionLink = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const verified = verifyActionToken(data.token);
    if (!verified) {
      return { success: false, error: "Invalid or expired 1-click email action link." };
    }

    const { reviewLeaveRequest } = await import("./admin.functions");
    // Action review
    const result = await reviewLeaveRequest({
      data: {
        requestId: verified.requestId,
        action: verified.action,
        rejectionReason:
          verified.action === "rejected" ? "Rejected via 1-click email action link" : undefined,
      },
    });

    return {
      success: true,
      requestId: verified.requestId,
      action: verified.action,
      message: `Successfully ${verified.action} leave request!`,
    };
  });
