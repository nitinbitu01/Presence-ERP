import { describe, test, expect } from "vitest";
import { isWebNfcSupported, getWebNfcAdapter } from "@/lib/adapters/web-nfc-checkin.adapter";

describe("Web NFC Adapter", () => {
    test("isWebNfcSupported returns false when NDEFReader is absent (Node environment)", () => {
        expect(isWebNfcSupported()).toBe(false);
    });

    test("WebNfcCheckinAdapter reports isConfigured = true", () => {
        const adapter = getWebNfcAdapter();
        expect(adapter.type).toBe("nfc");
        expect(adapter.isConfigured()).toBe(true);
    });

    test("WebNfcCheckinAdapter fails gracefully if rawData tag UID is missing", async () => {
        const adapter = getWebNfcAdapter();
        const result = await adapter.verifyCheckin({
            hardwareType: "nfc",
            readerId: "test-reader",
            rawData: "",
            capturedAt: new Date().toISOString(),
        });
        expect(result.verified).toBe(false);
        expect(result.confidence).toBe(0);
        expect(result.errorDetail).toContain("No tag UID provided");
    });
});
