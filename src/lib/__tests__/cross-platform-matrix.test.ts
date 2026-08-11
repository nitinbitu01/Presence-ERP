import { describe, it, expect } from "vitest";
import { isNativePlatform, getPlatformType, getDeviceSecurityTelemetry } from "../native-bridge";

describe("Cross-Platform Matrix Test Suite (Windows, iOS, Android)", () => {
  it("verifies Windows platform environment configuration", async () => {
    const winUa =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";

    expect(getPlatformType(winUa)).toBe("web");
    expect(isNativePlatform()).toBe(false);

    const telemetry = await getDeviceSecurityTelemetry(winUa);
    expect(telemetry.platform).toBe("web");
    expect(telemetry.isNative).toBe(false);
  });

  it("verifies iOS browser environment detection", async () => {
    const iosUa =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1";

    expect(getPlatformType(iosUa)).toBe("ios");

    const telemetry = await getDeviceSecurityTelemetry(iosUa);
    expect(telemetry.platform).toBe("ios");
  });

  it("verifies Android browser environment detection", async () => {
    const androidUa =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36";

    expect(getPlatformType(androidUa)).toBe("android");

    const telemetry = await getDeviceSecurityTelemetry(androidUa);
    expect(telemetry.platform).toBe("android");
  });
});
