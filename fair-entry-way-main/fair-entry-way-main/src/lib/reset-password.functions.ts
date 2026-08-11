import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

function getClientIp(req: Request | null): string {
  if (!req?.headers) return "127.0.0.1";
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xForwarded = req.headers.get("x-forwarded-for");
  if (xForwarded) return xForwarded.split(",")[0].trim();
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp;
  return "127.0.0.1";
}

function getUserAgent(req: Request | null): string {
  if (!req?.headers) return "Unknown";
  return req.headers.get("user-agent") || "Unknown";
}

function getRequestOrigin(req: Request | null): string | undefined {
  if (!req?.headers) return undefined;
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return undefined;
}

/**
 * Validate CSRF & Origin
 */
function validateCsrfAndOrigin(req: Request | null): void {
  if (!req) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (
        originHost !== host &&
        !originHost.includes("localhost") &&
        !originHost.includes("pages.dev")
      ) {
        throw new Error("CSRF security check failed: invalid origin header.");
      }
    } catch (e: any) {
      if (e.message.includes("CSRF")) throw e;
    }
  }
}

// ---------- 1. Request Password Reset Link ----------
export const requestPasswordResetFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email("Invalid email address"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const req = getRequest();
    validateCsrfAndOrigin(req ?? null);
    const ip = getClientIp(req ?? null);
    const origin = getRequestOrigin(req ?? null);
    const { requestPasswordReset } = await import("./reset-password.server");
    return await requestPasswordReset(data.email, ip, origin);
  });

// ---------- 2. Validate Reset Token Pre-flight ----------
export const validateResetTokenFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(1, "Token required"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const req = getRequest();
    validateCsrfAndOrigin(req ?? null);
    const { verifyResetToken } = await import("./reset-password.server");
    return await verifyResetToken(data.token);
  });

// ---------- 3. Check Password Breach Status (HIBP) ----------
export const checkPasswordPwnedFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        password: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { checkPasswordPwned } = await import("./reset-password.server");
    return await checkPasswordPwned(data.password);
  });

// ---------- 4. Complete Password Reset ----------
export const completePasswordResetFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(1, "Token required"),
        password: z.string().min(12, "Password must be at least 12 characters long"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const req = getRequest();
    validateCsrfAndOrigin(req ?? null);
    const ip = getClientIp(req ?? null);
    const userAgent = getUserAgent(req ?? null);
    const { completePasswordReset } = await import("./reset-password.server");
    return await completePasswordReset(data.token, data.password, ip, userAgent);
  });
