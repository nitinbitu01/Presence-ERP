/**
 * Task 1 — Web NFC Check-in Adapter
 *
 * Implements the HardwareCheckinAdapter interface using the browser-native Web NFC API
 * (NDEFReader). This is the PRIMARY working NFC check-in path — it requires no vendor SDK
 * and is genuinely shippable inside a browser-based hackathon timeline.
 *
 * Architecture:
 *   - The client-side capability probe (isWebNfcSupported) runs in the browser to check
 *     whether NDEFReader is available (Android/Chrome with NFC support).
 *   - The client reads the tag UID via NDEFReader.scan() and sends it to the server.
 *   - The server-side verifyCheckin trusts the client-provided tag UID and resolves it
 *     to a student via the student_nfc_bindings table. It does NOT talk to hardware itself
 *     (the server has no NFC reader) — this is the correct trust model for a browser-native
 *     path where the client IS the reader.
 *
 * What works today: Web NFC API path (Android/Chrome with NFC support) — end-to-end
 *   tap-to-check-in via NDEFReader.scan().
 * What is NOT shipped: Physical RFID reader hardware integration. That remains a scaffolded
 *   extension point via the same HardwareCheckinAdapter interface — implement RFIDAdapterImpl
 *   when you have a real vendor SDK. Do not claim RFID hardware support that isn't real.
 */

import type {
  HardwareCheckinAdapter,
  HardwareCheckinPayload,
  HardwareCheckinResult,
  HardwareType,
} from "@/lib/hardware-checkin-adapter.server";

// ── Client-side capability probe ────────────────────────────────────────────
// This function is safe to call in the browser. It checks whether the Web NFC API
// is available in the current browser. NDEFReader is available on Android Chrome
// and other Chromium-based browsers with NFC support.

export function isWebNfcSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "NDEFReader" in window;
}

// ── Client-side tag reading helper ──────────────────────────────────────────
// Wraps NDEFReader.scan() in a Promise that resolves with the tag UID.
// The caller (attend.$sessionId.tsx) invokes this when the student taps "Tap your card".

// NDEFReader / NDEFReadingEvent are not yet in TypeScript's DOM lib. Declare minimal
// structural types so the client-side helper type-checks without a full lib update.
/* eslint-disable @typescript-eslint/no-explicit-any */
type NDEFReaderLike = {
  scan: () => Promise<void>;
  addEventListener: (type: "reading" | "error", listener: (event: any) => void) => void;
};

export async function readNfcTagUid(timeoutMs = 10_000): Promise<string> {
  if (!isWebNfcSupported()) {
    throw new Error(
      "Web NFC is not supported in this browser. Use Android Chrome with NFC enabled.",
    );
  }

  // NDEFReader is a browser global; cast through unknown to satisfy TS in non-DOM contexts.
  const NDEFReaderCtor = (window as unknown as { NDEFReader?: new () => NDEFReaderLike })
    .NDEFReader;
  if (!NDEFReaderCtor) {
    throw new Error("NDEFReader constructor not available.");
  }

  const reader = new NDEFReaderCtor();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("NFC scan timed out. Please tap your card/phone again."));
    }, timeoutMs);

    reader.addEventListener("reading", (event: any) => {
      clearTimeout(timer);
      // The serial number of the tag is the UID we use for binding.
      // NDEFReadingEvent has a `serialNumber` property (hex string).
      const uid: string = event?.serialNumber ?? "";
      if (!uid) {
        reject(new Error("NFC tag read but no serial number (UID) was returned."));
        return;
      }
      resolve(uid);
    });

    reader.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("NFC reader error. Ensure NFC is enabled and tap your card/phone again."));
    });

    // scan() returns a Promise that resolves when scanning starts; reading events
    // arrive via the 'reading' event listener above.
    reader.scan().catch((err: unknown) => {
      clearTimeout(timer);
      reject(
        new Error(
          `NFC scan failed to start: ${err instanceof Error ? err.message : "unknown error"}`,
        ),
      );
    });
  });
}

// ── Server-side adapter implementation ──────────────────────────────────────
// The server-side verifyCheckin resolves a tag_uid (sent by the client) to a student_id
// via the student_nfc_bindings table. The server trusts the client-provided UID because
// the client IS the NFC reader in the Web NFC architecture — there's no separate hardware
// device to authenticate against. The binding table itself is admin-provisioned, so only
// pre-bound tags resolve to students.

class WebNfcCheckinAdapter implements HardwareCheckinAdapter {
  readonly type: HardwareType = "nfc";

  /**
   * isConfigured — returns true because the Web NFC path requires no vendor SDK or
   * credentials. It's always "configured" on the server side; the actual capability
   * check (does this browser support NFC?) happens client-side via isWebNfcSupported().
   */
  isConfigured(): boolean {
    return true;
  }

  /**
   * verifyCheckin — resolves a tag_uid to a student_id via student_nfc_bindings.
   * This is called server-side; the payload.rawData contains the tag UID read by
   * the client's NDEFReader.scan().
   */
  async verifyCheckin(payload: HardwareCheckinPayload): Promise<HardwareCheckinResult> {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const tagUid = payload.rawData?.trim();
      if (!tagUid) {
        return {
          verified: false,
          studentId: null,
          confidence: 0,
          errorDetail: "No tag UID provided in payload.",
        };
      }

      // student_nfc_bindings is a new table not yet in the generated Supabase types;
      // cast through any the same way hardware-checkin-adapter.server.ts and
      // liveness-sdk.server.ts do for tables outside the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: binding, error } = await (supabaseAdmin as any)
        .from("student_nfc_bindings")
        .select("student_id")
        .eq("tag_uid", tagUid)
        .maybeSingle();

      if (error || !binding) {
        return {
          verified: false,
          studentId: null,
          confidence: 0,
          errorDetail: "NFC tag not bound to any student account.",
        };
      }

      return {
        verified: true,
        studentId: binding.student_id as string,
        confidence: 100, // Tag binding is a binary match — either bound or not.
      };
    } catch (err) {
      return {
        verified: false,
        studentId: null,
        confidence: 0,
        errorDetail: err instanceof Error ? err.message : "NFC verification failed.",
      };
    }
  }
}

// Singleton instance for server-side use.
let adapterInstance: WebNfcCheckinAdapter | null = null;

export function getWebNfcAdapter(): WebNfcCheckinAdapter {
  if (!adapterInstance) {
    adapterInstance = new WebNfcCheckinAdapter();
  }
  return adapterInstance;
}
