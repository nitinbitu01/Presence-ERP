/**
 * Phase 5.3 — Hardware Biometric Adapter Interface (opt-in)
 *
 * Defines a clean adapter interface so any physical hardware vendor (fingerprint
 * scanner, RFID reader, NFC badge) can plug into the attendance ledger without
 * touching the core attendance.functions.ts logic.
 *
 * Current state: stubs only (no physical vendor SDK shipped).
 * To integrate a real device:
 *   1. Implement HardwareCheckinAdapter for your hardware SDK.
 *   2. Set HARDWARE_CHECKIN_TYPE env var to "fingerprint" | "rfid" | "nfc".
 *   3. The rest of the ledger reconciliation is unchanged.
 *
 * The reconciliation model:
 *   Hardware checkins are an *additional* event type, not a replacement for
 *   face+liveness. They land in hardware_checkins and attendance_events with
 *   event_type = "hardware_checkin", then a reconciler (Phase 5 background job)
 *   can merge them into the attendance_ledger if desired by institution policy.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PresenceErpError } from "@/lib/errors";

// ── Types ──────────────────────────────────────────────────────────────────

export type HardwareType = "fingerprint" | "rfid" | "nfc";

export interface HardwareCheckinPayload {
  readerId: string; // Physical device identifier (e.g. "reader_hall_a_01")
  hardwareType: HardwareType;
  rawData: string; // Vendor-specific encoded payload (e.g. RFID card UID)
  capturedAt: string; // ISO timestamp from the reader
}

export interface HardwareCheckinResult {
  verified: boolean;
  studentId: string | null; // null if reader couldn't identify the student
  confidence: number; // 0–100
  errorDetail?: string;
}

// ── Interface ──────────────────────────────────────────────────────────────

export interface HardwareCheckinAdapter {
  readonly type: HardwareType;

  /**
   * verifyCheckin — verifies the hardware payload and resolves it to a student.
   * Must be idempotent (calling twice with the same payload is safe).
   */
  verifyCheckin(payload: HardwareCheckinPayload): Promise<HardwareCheckinResult>;

  /**
   * isConfigured — returns true if the adapter has valid credentials/config.
   * Used to surface configuration status in the admin UI without crashing.
   */
  isConfigured(): boolean;
}

// ── Stub implementations (for CI / no-hardware environments) ───────────────

class FingerprintAdapterStub implements HardwareCheckinAdapter {
  readonly type: HardwareType = "fingerprint";

  isConfigured(): boolean {
    return false;
  }

  async verifyCheckin(payload: HardwareCheckinPayload): Promise<HardwareCheckinResult> {
    console.warn(
      "[FingerprintAdapterStub] No real fingerprint SDK configured. " +
      "Set HARDWARE_CHECKIN_TYPE=fingerprint and implement FingerprintAdapterImpl.",
    );
    return {
      verified: false,
      studentId: null,
      confidence: 0,
      errorDetail: "Fingerprint hardware not configured (stub mode)",
    };
  }
}

class RFIDAdapterStub implements HardwareCheckinAdapter {
  readonly type: HardwareType = "rfid";

  isConfigured(): boolean {
    return false;
  }

  async verifyCheckin(payload: HardwareCheckinPayload): Promise<HardwareCheckinResult> {
    console.warn(
      "[RFIDAdapterStub] No real RFID SDK configured. " +
      "Set HARDWARE_CHECKIN_TYPE=rfid and implement RFIDAdapterImpl.",
    );
    return {
      verified: false,
      studentId: null,
      confidence: 0,
      errorDetail: "RFID hardware not configured (stub mode)",
    };
  }
}

class NFCAdapterStub implements HardwareCheckinAdapter {
  readonly type: HardwareType = "nfc";

  isConfigured(): boolean {
    return false;
  }

  async verifyCheckin(payload: HardwareCheckinPayload): Promise<HardwareCheckinResult> {
    console.warn("[NFCAdapterStub] No real NFC SDK configured.");
    return {
      verified: false,
      studentId: null,
      confidence: 0,
      errorDetail: "NFC hardware not configured (stub mode)",
    };
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * getHardwareAdapter — factory that returns the appropriate adapter based on
 * HARDWARE_CHECKIN_TYPE env var. Returns a stub if unset or unrecognised.
 *
 * Task 1 update: the "nfc" case now returns the real Web NFC adapter
 * (src/lib/adapters/web-nfc-checkin.adapter.ts) instead of a stub. The Web NFC
 * path uses the browser-native NDEFReader API — no vendor SDK required — and is
 * the genuinely working NFC check-in path shipped in this codebase.
 *
 * The "rfid" and "fingerprint" cases remain stubs. Physical RFID reader hardware
 * integration is a scaffolded extension point via this same interface — implement
 * RFIDAdapterImpl when you have a real vendor SDK. Do not claim RFID hardware
 * support that isn't real.
 */
export function getHardwareAdapter(): HardwareCheckinAdapter {
  const type = process.env.HARDWARE_CHECKIN_TYPE as HardwareType | undefined;
  switch (type) {
    case "fingerprint":
      return new FingerprintAdapterStub(); // Replace with FingerprintAdapterImpl when ready
    case "rfid":
      return new RFIDAdapterStub(); // Replace with RFIDAdapterImpl when ready
    case "nfc": {
      // Real Web NFC adapter — browser-native, no vendor SDK needed.
      const { getWebNfcAdapter } = require("@/lib/adapters/web-nfc-checkin.adapter");
      return getWebNfcAdapter();
    }
    default:
      return new RFIDAdapterStub(); // Default stub — safe no-op
  }
}

// ── Server function: record hardware checkin ───────────────────────────────

/**
 * recordHardwareCheckin — server function that:
 *   1. Calls the adapter to verify the hardware payload.
 *   2. Writes to hardware_checkins table.
 *   3. Appends a hardware_checkin event to attendance_events.
 *
 * Returns the hardware_checkins row ID for ledger reconciliation.
 */
export const recordHardwareCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("payload" in input) ||
      !("sessionId" in input)
    ) {
      throw new Error("Missing payload or sessionId");
    }
    return input as { payload: HardwareCheckinPayload; sessionId: string };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const adapter = getHardwareAdapter();
    const result = await adapter.verifyCheckin(data.payload);

    // Write to hardware_checkins.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: checkinRow, error: insertErr } = await (supabaseAdmin as any)
      .from("hardware_checkins")
      .insert({
        student_id: result.studentId ?? context.userId,
        session_id: data.sessionId,
        hardware_type: data.payload.hardwareType,
        reader_id: data.payload.readerId,
        checkin_at: data.payload.capturedAt,
        raw_payload: {
          rawData: data.payload.rawData,
          confidence: result.confidence,
          errorDetail: result.errorDetail,
        },
        verified: result.verified,
        error_detail: result.errorDetail ?? null,
      })
      .select("id")
      .single();

    if (insertErr) {
      throw new PresenceErpError("DATABASE_ERROR", (insertErr as { message: string }).message);
    }

    const checkinId = (checkinRow as { id?: string } | null)?.id;

    // Append to attendance_events for the unified audit trail.
    await supabaseAdmin.from("attendance_events").insert({
      student_id: result.studentId ?? context.userId,
      session_id: data.sessionId,
      event_type: "hardware_checkin",
      liveness_method: "hardware",
      gate_reasons: {
        hardwareType: data.payload.hardwareType,
        readerId: data.payload.readerId,
        verified: result.verified,
        confidence: result.confidence,
        checkinId,
      },
    });

    if (!result.verified) {
      throw new PresenceErpError(
        "FORBIDDEN",
        result.errorDetail ?? "Hardware biometric check failed.",
      );
    }

    return { checkinId, verified: result.verified, confidence: result.confidence };
  });

/**
 * Phase 5.3 Gap Closure: Wiegand RFID Payload Decoders
 * Utility helpers to decode raw Wiegand 26-bit and 34-bit access card hex strings.
 */
export function parseWiegand26(hexString: string): { facilityCode: number; cardId: number } | null {
  const cleanHex = hexString.replace(/^0x/i, "").trim();
  if (cleanHex.length !== 7 && cleanHex.length !== 8) return null;

  const rawBits = BigInt(`0x${cleanHex}`).toString(2).padStart(26, "0");
  if (rawBits.length > 26) {
    const sliced = rawBits.slice(-26);
    const facilityCode = parseInt(sliced.slice(1, 9), 2);
    const cardId = parseInt(sliced.slice(9, 25), 2);
    return { facilityCode, cardId };
  }

  const facilityCode = parseInt(rawBits.slice(1, 9), 2);
  const cardId = parseInt(rawBits.slice(9, 25), 2);
  return { facilityCode, cardId };
}

export function parseWiegand34(hexString: string): { facilityCode: number; cardId: number } | null {
  const cleanHex = hexString.replace(/^0x/i, "").trim();
  if (cleanHex.length !== 8 && cleanHex.length !== 9) return null;

  const rawBits = BigInt(`0x${cleanHex}`).toString(2).padStart(34, "0");
  if (rawBits.length > 34) {
    const sliced = rawBits.slice(-34);
    const facilityCode = parseInt(sliced.slice(1, 17), 2);
    const cardId = parseInt(sliced.slice(17, 33), 2);
    return { facilityCode, cardId };
  }

  const facilityCode = parseInt(rawBits.slice(1, 17), 2);
  const cardId = parseInt(rawBits.slice(17, 33), 2);
  return { facilityCode, cardId };
}
