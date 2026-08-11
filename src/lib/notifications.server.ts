/**
 * Notification system helper functions.
 * Handles creating in-app notifications (for UI) and email dispatch via Resend.
 * Server-side only; runs in Node environment.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { sendSecurityAlert } from "./alerting.server";

let emailFailureWindow: { count: number; windowStart: number } = {
  count: 0,
  windowStart: Date.now(),
};

async function recordEmailFailure(errorDetails: string) {
  const now = Date.now();
  if (now - emailFailureWindow.windowStart > 3600000) {
    emailFailureWindow = { count: 1, windowStart: now };
  } else {
    emailFailureWindow.count++;
  }

  if (emailFailureWindow.count >= 5) {
    await sendSecurityAlert({
      kind: "rate_limit_spike",
      summary: `Email dispatch failed ${emailFailureWindow.count} times in the last hour`,
      details: { errorDetails, failureCount: emailFailureWindow.count },
    });
  }
}

type SupabaseAdmin = SupabaseClient<Database>;

export type NotificationType = "info" | "warning" | "success" | "error";

export interface NotificationPayload {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  deepLinkUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export interface SmsPayload {
  to: string; // E.164 format, e.g. +919876543210
  body: string;
}

/**
 * Send an SMS. Supports Twilio out of the box via TWILIO_* env vars; falls
 * back to a console log (visible in server logs) when no provider is
 * configured, so the rest of the notification pipeline works in dev/demo
 * environments without real SMS credentials. Swap in MSG91/Gupshup here for
 * India-specific deployments — same interface, different fetch call.
 */
export async function sendSms(payload: SmsPayload): Promise<boolean> {
  const getEnv = (key: string): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env || {};
    return env[key];
  };

  const sid = getEnv("TWILIO_ACCOUNT_SID");
  const token = getEnv("TWILIO_AUTH_TOKEN");
  const from = getEnv("TWILIO_FROM_NUMBER");

  if (!sid || !token || !from) {
    console.warn(`[SMS disabled - no provider configured] to=${payload.to}: ${payload.body}`);
    return false;
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        body: new URLSearchParams({ To: payload.to, From: from, Body: payload.body }).toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Twilio SMS API error:", response.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Exception sending SMS:", e);
    return false;
  }
}

/**
 * Send a WhatsApp message via Twilio's WhatsApp API. Same fallback behavior
 * as sendSms when unconfigured.
 */
export async function sendWhatsApp(payload: SmsPayload): Promise<boolean> {
  const getEnv = (key: string): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env || {};
    return env[key];
  };

  const sid = getEnv("TWILIO_ACCOUNT_SID");
  const token = getEnv("TWILIO_AUTH_TOKEN");
  const from = getEnv("TWILIO_WHATSAPP_FROM"); // e.g. "whatsapp:+14155238886"

  if (!sid || !token || !from) {
    console.warn(`[WhatsApp disabled - no provider configured] to=${payload.to}: ${payload.body}`);
    return false;
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          To: `whatsapp:${payload.to}`,
          From: from,
          Body: payload.body,
        }).toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Twilio WhatsApp API error:", response.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Exception sending WhatsApp message:", e);
    return false;
  }
}

/**
 * Insert an in-app notification into the database.
 * This is always called; the notification is visible in the app UI.
 */
export async function insertNotification(
  supabaseAdmin: SupabaseAdmin,
  payload: NotificationPayload,
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: payload.userId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      metadata: (payload.metadata ?? {}) as Json,
    });

    if (error) {
      console.error("Failed to insert notification:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Exception inserting notification:", e);
    return false;
  }
}

/**
 * Check if the email service credentials are configured and functional
 */
export async function checkEmailConfig(): Promise<{ configured: boolean; message: string }> {
  const getEnv = (key: string): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env || {};
    return env[key];
  };

  const apiKey = getEnv("RESEND_API_KEY");
  if (!apiKey) {
    return { configured: false, message: "RESEND_API_KEY is missing from environment secrets." };
  }
  return { configured: true, message: "Resend API key configured." };
}

/**
 * Dispatch transactional email via Resend API
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  // Access environment variables securely (server-side only)
  const getEnv = (key: string): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env || {};
    return env[key];
  };

  const apiKey = getEnv("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set; email dispatch disabled");
    await recordEmailFailure("RESEND_API_KEY missing");
    return false;
  }

  try {
    const fromEmail = getEnv("RESEND_FROM_EMAIL") || "noreply@presence.local";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Resend API error:", response.status, text);
      await recordEmailFailure(`Resend API error ${response.status}: ${text}`);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Exception sending email:", e);
    await recordEmailFailure(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * Get user email via the Supabase Admin Auth API.
 * The `profiles` table intentionally does not store email (it lives on auth.users),
 * so we must use the service-role admin API rather than a table query.
 */
export async function getUserEmail(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (error) {
      console.error("Failed to fetch user email:", error);
      return null;
    }

    return data?.user?.email ?? null;
  } catch (e) {
    console.error("Exception fetching user email:", e);
    return null;
  }
}

/**
 * Combined: insert notification + send email.
 * If either fails, logs error but continues.
 */
export async function notifyUser(
  supabaseAdmin: SupabaseAdmin,
  payload: NotificationPayload & { userEmail?: string },
): Promise<void> {
  // Always insert in-app notification
  await insertNotification(supabaseAdmin, payload);

  // Attempt email if email provided or can be fetched
  let email: string | null | undefined = payload.userEmail;
  if (!email) {
    email = await getUserEmail(supabaseAdmin, payload.userId);
  }

  if (email) {
    const emailPayload: EmailPayload = {
      to: email,
      subject: payload.title,
      html: `<p>${payload.message}</p>`,
    };
    await sendEmail(emailPayload);
  }
}

/**
 * Notify every guardian linked to a student via SMS/WhatsApp (whichever
 * channel(s) are configured) plus an in-app notification on the guardian's
 * own account. Best-effort: failures are logged, never thrown, so this can
 * never block the underlying workflow (attendance, leave approval, etc).
 */
export async function notifyGuardiansOfStudent(
  supabaseAdmin: SupabaseAdmin,
  studentId: string,
  payload: { title: string; message: string; type: NotificationType },
): Promise<void> {
  try {
    const { data: links, error } = await supabaseAdmin
      .from("guardian_students")
      .select("guardian_id, guardians(display_name, phone)")
      .eq("student_id", studentId);

    if (error) {
      console.error("Failed to look up guardians for student:", error);
      return;
    }

    interface GuardianLinkRow {
      guardian_id: string;
      guardians?: { display_name: string; phone: string | null } | null;
    }

    await Promise.all(
      ((links ?? []) as GuardianLinkRow[]).map(async (link) => {
        await insertNotification(supabaseAdmin, {
          userId: link.guardian_id,
          title: payload.title,
          message: payload.message,
          type: payload.type,
        });

        const phone = link.guardians?.phone;
        if (phone) {
          const smsBody = `${payload.title}: ${payload.message}`;
          // Prefer WhatsApp when configured, SMS otherwise; both are safe
          // no-ops (logged, not thrown) if no provider is configured.
          const waSent = await sendWhatsApp({ to: phone, body: smsBody });
          if (!waSent) await sendSms({ to: phone, body: smsBody });
        }
      }),
    );
  } catch (e) {
    console.error("Exception notifying guardians:", e);
  }
}

// ============ Notification Templates ============

/**
 * Role request approved notification
 */
export function roleApprovedNotification(role: string): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: `Your ${role} request was approved`,
    message: `Your request to become a ${role} has been approved. You now have ${role} privileges in Presence.`,
    type: "success",
  };
}

/**
 * Role request rejected notification
 */
export function roleRejectedNotification(role: string): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: `Your ${role} request was rejected`,
    message: `Your request to become a ${role} was not approved. Contact your administrator if you believe this is a mistake.`,
    type: "error",
  };
}

/**
 * Leave/OD request approved notification
 */
export function leaveApprovedNotification(
  requestType: string,
  startDate: string,
  endDate: string,
): NotificationPayload {
  const label = requestType === "od" ? "On-Duty (OD)" : "Leave";
  return {
    userId: "", // Populated by caller
    title: `${label} request approved`,
    message: `Your ${label.toLowerCase()} request for ${startDate} to ${endDate} has been approved. These days will be excluded from your attendance percentage.`,
    type: "success",
    metadata: { requestType, startDate, endDate },
  };
}

/**
 * Leave/OD request rejected notification
 */
export function leaveRejectedNotification(
  requestType: string,
  startDate: string,
  endDate: string,
): NotificationPayload {
  const label = requestType === "od" ? "On-Duty (OD)" : "Leave";
  return {
    userId: "", // Populated by caller
    title: `${label} request rejected`,
    message: `Your ${label.toLowerCase()} request for ${startDate} to ${endDate} was not approved. Contact your administrator if you believe this is a mistake.`,
    type: "error",
    metadata: { requestType, startDate, endDate },
  };
}

/**
 * Fallback attendance approved notification
 */
export function fallbackApprovedNotification(): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: "Fallback attendance approved",
    message: `Your request for manual attendance has been approved by your instructor.`,
    type: "success",
  };
}

/**
 * Fallback attendance rejected notification
 */
export function fallbackRejectedNotification(): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: "Fallback attendance rejected",
    message: `Your request for manual attendance was not approved. Please contact your instructor for details.`,
    type: "error",
  };
}

/**
 * Attendance marked as under review (borderline similarity)
 */
export function attendanceUnderReviewNotification(similarity: number): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: "Check-in under review",
    message: `Your check-in has been recorded but is under instructor review (similarity: ${similarity.toFixed(2)}). You will be notified once reviewed.`,
    type: "warning",
    metadata: { similarity },
  };
}

/**
 * Attendance check-in accepted
 */
export function attendanceAcceptedNotification(): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: "Check-in confirmed",
    message: `Your attendance has been successfully recorded.`,
    type: "success",
  };
}

/**
 * Attendance check-in rejected
 */
export function attendanceRejectedNotification(reason: string): NotificationPayload {
  return {
    userId: "", // Populated by caller
    title: "Check-in rejected",
    message: `Your check-in was rejected: ${reason}. Please try again or contact your instructor.`,
    type: "error",
    metadata: { reason },
  };
}

/**
 * Send password reset email with secure link (30-minute expiry disclosure)
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  expiryMinutes = 30,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; rounded: 8px;">
      <h2 style="color: #0f172a;">Reset Your Password — Presence ERP</h2>
      <p>We received a request to reset the password for your Presence ERP account (${to}).</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p style="color: #64748b; font-size: 14px;">
        <strong>This link will expire in ${expiryMinutes} minutes.</strong> For security reasons, it can only be used once.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 12px;">
        If you did not request this password reset, please ignore this email or contact security if you suspect unauthorized activity. Your password will remain unchanged.
      </p>
    </div>
  `;

  return sendEmail({
    to,
    subject: "Reset Your Password — Presence ERP",
    html,
  });
}

/**
 * Send confirmation email after password reset success
 */
export async function sendPasswordChangedNotification(
  to: string,
  ipAddress?: string,
): Promise<boolean> {
  const timeString = new Date().toUTCString();
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; rounded: 8px;">
      <h2 style="color: #0f172a;">Password Changed Successfully</h2>
      <p>The password for your account (${to}) was successfully updated on <strong>${timeString}</strong>${ipAddress ? ` from IP address <code>${ipAddress}</code>` : ""}.</p>
      <p style="color: #64748b; font-size: 14px;">
        All active login sessions for your account have been ended for your security.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #dc2626; font-size: 13px; font-weight: bold;">
        Wasn't you? If you did not make this change, please contact support or your system administrator immediately to secure your account.
      </p>
    </div>
  `;

  return sendEmail({
    to,
    subject: "Security Alert: Password Changed — Presence ERP",
    html,
  });
}

/**
 * Phase 6.5 — iOS Push Reality Check & Fallback Dispatcher
 * For critical alerts (low-attendance warning, leave rejected), checks if the target
 * user has an active Web Push subscription. If missing/iOS device, falls back to SMS/WhatsApp.
 */
export async function notifyUserWithIosFallback(
  supabaseAdmin: SupabaseAdmin,
  payload: NotificationPayload & { userPhone?: string },
): Promise<{ inApp: boolean; pushOrFallback: string }> {
  const inAppOk = await insertNotification(supabaseAdmin, payload);

  // Check for Web Push subscription
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pushSub } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("id, endpoint")
    .eq("user_id", payload.userId)
    .maybeSingle();

  if (pushSub) {
    // Has web push sub
    return { inApp: inAppOk, pushOrFallback: "web_push" };
  }

  // Fallback to SMS / WhatsApp if phone is available
  if (payload.userPhone) {
    const textBody = `[Presence ERP Alert] ${payload.title}: ${payload.message}${payload.deepLinkUrl ? ` Details: https://presence.local${payload.deepLinkUrl}` : ""}`;
    const smsSent = await sendSms({ to: payload.userPhone, body: textBody });
    if (smsSent) return { inApp: inAppOk, pushOrFallback: "sms_fallback" };

    const waSent = await sendWhatsApp({ to: payload.userPhone, body: textBody });
    if (waSent) return { inApp: inAppOk, pushOrFallback: "whatsapp_fallback" };
  }

  return { inApp: inAppOk, pushOrFallback: "in_app_only" };
}
