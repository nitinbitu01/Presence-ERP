/**
 * Phase 6.4 — Native Bridge Abstraction Layer (Pinnacle Native ERP Grade)
 * Wraps Capacitor native plugins for Camera, Geolocation, and Push Notifications,
 * with automatic fallback to standard Browser Web APIs when running in PWA/browser.
 * Also provides hardware security module & biometric sensor telemetry.
 */

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface DeviceSecurityTelemetry {
  platform: "ios" | "android" | "web";
  isNative: boolean;
  hasWebAuthn: boolean;
  hasGeolocation: boolean;
  hasCamera: boolean;
  hardwareSecurityModule: boolean;
}

export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return Boolean(cap && cap.isNativePlatform && cap.isNativePlatform());
}

export function getPlatformType(customUa?: string): "ios" | "android" | "web" {
  const ua = customUa ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/iPad|iPhone|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (typeof window === "undefined") return "web";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.getPlatform === "function") {
    const p = cap.getPlatform();
    if (p === "ios" || p === "android") return p;
  }
  return "web";
}

export async function getDeviceSecurityTelemetry(
  customUa?: string,
): Promise<DeviceSecurityTelemetry> {
  const platform = getPlatformType(customUa);
  const isNative = isNativePlatform();
  const hasWebAuthn = typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
  const hasGeolocation = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const hasCamera =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  return {
    platform,
    isNative,
    hasWebAuthn,
    hasGeolocation,
    hasCamera,
    hardwareSecurityModule: isNative || hasWebAuthn,
  };
}

export async function registerNativePushToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pushPlugin = (window as any).Capacitor?.Plugins?.PushNotifications;
    if (pushPlugin && typeof pushPlugin.register === "function") {
      const perm = await pushPlugin.requestPermissions();
      if (perm.receive === "granted") {
        await pushPlugin.register();
        return "native_push_registered";
      }
    }
  } catch (e) {
    console.warn("Capacitor PushNotifications registration failed", e);
  }
  return null;
}

/**
 * getCurrentPositionNative — Fetches GPS position using Capacitor Geolocation when native,
 * or browser navigator.geolocation fallback.
 */
export async function getCurrentPositionNative(
  timeoutMs: number = 10_000,
): Promise<LocationCoordinates> {
  if (isNativePlatform()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const capGeo = (window as any).Capacitor?.Plugins?.Geolocation;
      if (capGeo && typeof capGeo.getCurrentPosition === "function") {
        const pos = await capGeo.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: timeoutMs,
        });
        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 10,
        };
      }
    } catch (e) {
      console.warn("Capacitor Geolocation plugin failed, falling back to browser API", e);
    }
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(err.message || "Failed to acquire location.")),
      { enableHighAccuracy: true, timeout: timeoutMs },
    );
  });
}

export interface OfflineAttendancePayload {
  sessionId: string;
  studentId: string;
  timestamp: string;
  signature: string;
  faceEmbeddingCiphertext?: string;
}

const OFFLINE_CHECKIN_KEY = "presence_offline_checkins_queue";

export function enqueueOfflineFaceCheckin(payload: OfflineAttendancePayload): void {
  if (typeof localStorage === "undefined") return;
  try {
    const existing: OfflineAttendancePayload[] = JSON.parse(
      localStorage.getItem(OFFLINE_CHECKIN_KEY) || "[]",
    );
    existing.push(payload);
    localStorage.setItem(OFFLINE_CHECKIN_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn("Failed to queue offline check-in payload", e);
  }
}

export function getQueuedOfflineFaceCheckins(): OfflineAttendancePayload[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_CHECKIN_KEY) || "[]");
  } catch {
    return [];
  }
}

export function clearQueuedOfflineFaceCheckins(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(OFFLINE_CHECKIN_KEY);
}
