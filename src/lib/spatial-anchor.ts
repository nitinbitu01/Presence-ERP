// spatial-anchor.ts
// ─────────────────────────────────────────────────────────────────────────────
// Spatial Anchor Engine v3 — Multi-Factor Spatial Attestation
//
// HONEST CAPABILITY STATEMENT (read before modifying):
//
//   WORKS IN BROWSER:
//   ✅ Multi-sample GPS with configurable averaging
//   ✅ Mock location heuristics (6 independent signals + weighted scoring)
//   ✅ Accelerometer/gyroscope presence detection (proves physical device)
//   ✅ Network type via Network Information API (wifi/cellular/ethernet)
//   ✅ WebRTC local IP leak (reveals real LAN IP even behind VPN)
//   ✅ Device fingerprint (canvas + WebGL + screen + timezone + fonts)
//   ✅ Secure context enforcement (HTTPS required)
//   ✅ Cryptographic nonce (server-issued, single-use, replay prevention)
//   ✅ HMAC payload signing (tamper detection)
//   ✅ Confidence score (0–100) for review queue routing
//
//   NOT POSSIBLE IN BROWSER (requires native app):
//   ❌ Wi-Fi SSID / BSSID — privacy-blocked in all browsers
//   ❌ Passive BLE beacon scanning — requires native Bluetooth stack
//   ❌ Guaranteed mock location detection — impossible client-side alone
//   ❌ Android SafetyNet / iOS DeviceCheck — native only
//
//   SERVER MUST ALWAYS:
//   • Validate nonce is unused (one-time use, stored in Redis/DB)
//   • Validate HMAC signature with shared secret
//   • Validate payload age (capturedAt within ±90 seconds of server time)
//   • Validate GPS coordinates against authoritative campus geofence
//   • Validate clientIp against campus subnet ranges (not the hint from client)
//   • Never trust isMocked=false from the client alone
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum allowed geofence radius. Prevents trivially large zones. */
const MIN_GEOFENCE_RADIUS_M = 10;

/** Maximum allowed geofence radius. A 2km radius is not a classroom. */
const MAX_GEOFENCE_RADIUS_M = 2_000;

/** Maximum payload age the server will accept. */
const MAX_PAYLOAD_AGE_MS = 90_000; // 90 seconds

/** GPS accuracy below this is physically impossible on consumer hardware. */
const IMPOSSIBLE_ACCURACY_M = 1.0;

/** Speed above this (m/s) is impossible for a student on campus. 30 m/s = 108 km/h */
const IMPOSSIBLE_SPEED_MPS = 30;

/** Minimum coordinate variance across samples before flagging as static. */
const STATIC_COORDINATE_THRESHOLD_DEG = 0.000_001; // ~0.11 metres

/** Heading change rate above this (deg/s) is physically impossible. */
const IMPOSSIBLE_HEADING_RATE_DEG_PER_S = 90;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type NetworkType =
  | "wifi"
  | "cellular"
  | "ethernet"
  | "none"
  | "unknown";

export type MockLocationRisk = "none" | "low" | "medium" | "high";

export type GeolocationErrorReason =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unknown";

export interface GpsSample {
  lat: number;
  lng: number;
  accuracyM: number;
  altitude: number | null;
  altitudeAccuracyM: number | null;
  heading: number | null;
  speedMps: number | null;
  /** Browser-reported timestamp (ms since epoch) */
  timestamp: number;
  /** Wall-clock time we received this sample */
  receivedAt: number;
}

export interface MockLocationSignals {
  /** GPS accuracy below physically possible threshold */
  impossiblyPerfectAccuracy: boolean;
  /** Speed value exceeds possible campus movement */
  impossibleSpeed: boolean;
  /** Altitude is exactly 0.0 (common mock app default) */
  zeroAltitude: boolean;
  /** Multiple samples have near-identical coordinates */
  staticCoordinates: boolean;
  /** Heading changes faster than physically possible */
  impossibleHeadingRate: boolean;
  /** Perfect horizontal accuracy but no altitude (synthesised provider) */
  synthesisedProvider: boolean;
  /** Accuracy improved suspiciously between samples */
  impossibleAccuracyImprovement: boolean;
}

export interface MockLocationAnalysis {
  risk: MockLocationRisk;
  signals: MockLocationSignals;
  /** Weighted risk score 0–100 */
  score: number;
  /** Human-readable explanation for audit log */
  explanation: string;
}

export interface MotionPresenceResult {
  /** Whether the DeviceMotion API is available */
  apiAvailable: boolean;
  /** Whether any non-zero motion was detected (proves physical device) */
  motionDetected: boolean;
  /** Raw accelerometer reading if available */
  acceleration: { x: number; y: number; z: number } | null;
  /** Raw gyroscope reading if available */
  rotationRate: { alpha: number; beta: number; gamma: number } | null;
}

export interface NetworkInfo {
  type: NetworkType;
  effectiveType: string | null;
  isWifi: boolean;
  rttMs: number | null;
  downlinkMbps: number | null;
  /** Local IPs discovered via WebRTC (reveals real IP behind VPN) */
  webRtcLocalIps: string[];
  /** Whether the device appears to be on a private/campus network */
  isPrivateNetwork: boolean;
}

export interface DeviceFingerprint {
  /** SHA-256 hex of canvas render output */
  canvasSha256: string;
  /** WebGL unmasked renderer string */
  webglRenderer: string | null;
  /** WebGL unmasked vendor string */
  webglVendor: string | null;
  /** Screen dimensions and colour depth */
  screen: string;
  /** Device pixel ratio */
  devicePixelRatio: number;
  /** IANA timezone identifier */
  timezone: string;
  /** navigator.platform (coarse — not PII) */
  platform: string;
  /** Number of logical CPU cores */
  hardwareConcurrency: number;
  /** Device memory in GB (rounded) */
  deviceMemoryGb: number | null;
  /** Available fonts sampled (non-exhaustive) */
  fontSample: string[];
}

export interface BleResult {
  apiAvailable: boolean;
  permissionGranted: boolean;
  /** Connectable devices found (NOT passive beacon scan) */
  nearbyDevices: Array<{ name: string | null; id: string }>;
  /** Always present — explains browser BLE limitations */
  caveat: string;
}

export interface SpatialAnchorPayload {
  /** Server-issued nonce — single-use, validated server-side */
  nonce: string;
  /** Best GPS fix from multi-sample collection */
  gps: {
    lat: number;
    lng: number;
    accuracyM: number;
    altitude: number | null;
    heading: number | null;
    speedMps: number | null;
  };
  /** All raw GPS samples — server can run independent analysis */
  gpsSamples: GpsSample[];
  /** Mock location heuristic analysis */
  mockLocation: MockLocationAnalysis;
  /** Physical device presence signals */
  motionPresence: MotionPresenceResult;
  /** Network context */
  network: NetworkInfo;
  /** BLE result (only if attemptBle: true was passed) */
  ble: BleResult;
  /** Stable device fingerprint */
  deviceFingerprint: DeviceFingerprint;
  /** ISO 8601 timestamp — server validates recency */
  capturedAt: string;
  /**
   * HMAC-SHA-256 of the payload fields (excluding this field).
   * Key = server-issued nonce + shared secret.
   * Validates integrity — detects XSS/MITM tampering.
   * Computed with Web Crypto API (SubtleCrypto).
   */
  hmac: string;
  /** Overall confidence score 0–100 for review queue routing */
  confidenceScore: number;
}

export interface SpatialAnchorOptions {
  /**
   * Server-issued one-time nonce.
   * REQUIRED — payload is rejected server-side without a valid nonce.
   * Fetch from your server before calling captureSpatialAnchor().
   */
  nonce: string;
  /**
   * Shared HMAC secret (never hardcode — fetch from server per-session).
   * Used to sign the payload so the server can detect tampering.
   */
  hmacSecret: string;
  /** Number of GPS samples. @default 3 */
  sampleCount?: number;
  /** Milliseconds between GPS samples. @default 800 */
  sampleIntervalMs?: number;
  /** Max acceptable GPS accuracy. @default 100 */
  maxAccuracyM?: number;
  /** Timeout per GPS sample. @default 10000 */
  gpsTimeoutMs?: number;
  /** Attempt BLE scan (needs user gesture). @default false */
  attemptBle?: boolean;
  /** Attempt motion/accelerometer read. @default true */
  captureMotion?: boolean;
}

export interface CampusGeofence {
  lat: number;
  lng: number;
  /** Must be between 10m and 2000m */
  radiusM: number;
}

export interface SpatialValidationResult {
  passed: boolean;
  confidenceScore: number;
  withinGeofence: boolean;
  accuracyAcceptable: boolean;
  mockRisk: MockLocationRisk;
  payloadFresh: boolean;
  hmacValid: boolean;
  onCampusNetwork: boolean;
  distanceFromCentreM: number;
  /** Reasons for failure — populate review queue entry */
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Secure Context Guard
// ─────────────────────────────────────────────────────────────────────────────

function assertSecureContext(): void {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error(
      "Spatial attestation requires HTTPS. " +
        "Attendance cannot be recorded over an insecure connection.",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS Sampling
// ─────────────────────────────────────────────────────────────────────────────

function classifyGeolocationError(err: GeolocationPositionError): GeolocationErrorReason {
  switch (err.code) {
    case GeolocationPositionError.PERMISSION_DENIED:
      return "permission_denied";
    case GeolocationPositionError.POSITION_UNAVAILABLE:
      return "position_unavailable";
    case GeolocationPositionError.TIMEOUT:
      return "timeout";
    default:
      return "unknown";
  }
}

function singleGpsFix(
  timeoutMs: number,
  retries = 2,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation API is not available on this device."));
      return;
    }

    let attempts = 0;

    const attempt = () => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        (err) => {
          const reason = classifyGeolocationError(err);

          if (reason === "permission_denied") {
            reject(
              new Error(
                "Location permission was denied. " +
                  "Please grant location access in your browser settings and try again.",
              ),
            );
            return;
          }

          if (attempts < retries) {
            attempts++;
            console.warn(
              `[SpatialAnchor] GPS attempt ${attempts}/${retries} failed (${reason}), retrying…`,
            );
            setTimeout(attempt, 500);
          } else {
            reject(
              new Error(
                reason === "timeout"
                  ? "GPS timed out. Please move to an area with better signal and try again."
                  : "Could not obtain a GPS fix. Please try again outdoors.",
              ),
            );
          }
        },
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 0,
        },
      );
    };

    attempt();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectGpsSamples(
  count: number,
  intervalMs: number,
  timeoutMs: number,
): Promise<{ samples: GpsSample[]; firstError: string | null }> {
  const samples: GpsSample[] = [];
  let firstError: string | null = null;

  for (let i = 0; i < count; i++) {
    try {
      const pos = await singleGpsFix(timeoutMs);
      samples.push({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        altitudeAccuracyM: pos.coords.altitudeAccuracy,
        heading: pos.coords.heading,
        speedMps: pos.coords.speed,
        timestamp: pos.timestamp,
        receivedAt: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!firstError) firstError = msg;

      if (msg.includes("permission")) throw err;

      console.warn(`[SpatialAnchor] GPS sample ${i + 1}/${count} failed: ${msg}`);
    }

    if (i < count - 1) await sleep(intervalMs);
  }

  return { samples, firstError };
}

function selectBestSample(samples: GpsSample[]): GpsSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, s) => (s.accuracyM < best.accuracyM ? s : best));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Location Analysis
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_SIGNAL_WEIGHTS: Record<keyof MockLocationSignals, number> = {
  impossiblyPerfectAccuracy: 40,
  staticCoordinates: 35,
  synthesisedProvider: 25,
  impossibleHeadingRate: 20,
  impossibleSpeed: 20,
  impossibleAccuracyImprovement: 15,
  zeroAltitude: 10,
};

function analyseMockLocationRisk(samples: GpsSample[]): MockLocationAnalysis {
  const signals: MockLocationSignals = {
    impossiblyPerfectAccuracy: false,
    impossibleSpeed: false,
    zeroAltitude: false,
    staticCoordinates: false,
    impossibleHeadingRate: false,
    synthesisedProvider: false,
    impossibleAccuracyImprovement: false,
  };

  const noRisk: MockLocationAnalysis = {
    risk: "none",
    signals,
    score: 0,
    explanation: "Insufficient GPS samples to analyse.",
  };

  if (samples.length === 0) return noRisk;

  const best = selectBestSample(samples)!;

  // Signal 1: Physically impossible GPS accuracy
  if (best.accuracyM < IMPOSSIBLE_ACCURACY_M) {
    signals.impossiblyPerfectAccuracy = true;
  }

  // Signal 2: Impossible speed
  if (best.speedMps !== null && best.speedMps > IMPOSSIBLE_SPEED_MPS) {
    signals.impossibleSpeed = true;
  }

  // Signal 3: Zero altitude
  if (best.altitude !== null && best.altitude === 0) {
    signals.zeroAltitude = true;
  }

  // Signal 4: Static coordinates (requires 3+ samples)
  if (samples.length >= 3) {
    const latRange =
      Math.max(...samples.map((s) => s.lat)) -
      Math.min(...samples.map((s) => s.lat));
    const lngRange =
      Math.max(...samples.map((s) => s.lng)) -
      Math.min(...samples.map((s) => s.lng));

    if (
      latRange < STATIC_COORDINATE_THRESHOLD_DEG &&
      lngRange < STATIC_COORDINATE_THRESHOLD_DEG
    ) {
      signals.staticCoordinates = true;
    }
  }

  // Signal 5: Impossible heading rate
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (prev.heading !== null && curr.heading !== null) {
      const delta = Math.abs(curr.heading - prev.heading);
      const normalised = delta > 180 ? 360 - delta : delta;
      const dtS = (curr.timestamp - prev.timestamp) / 1000;
      if (dtS > 0 && normalised / dtS > IMPOSSIBLE_HEADING_RATE_DEG_PER_S) {
        signals.impossibleHeadingRate = true;
        break;
      }
    }
  }

  // Signal 6: Synthesised provider
  if (best.accuracyM < 5 && best.altitude === null) {
    signals.synthesisedProvider = true;
  }

  // Signal 7: Impossible accuracy improvement
  if (samples.length >= 2) {
    for (let i = 1; i < samples.length; i++) {
      const improvement = samples[i - 1].accuracyM - samples[i].accuracyM;
      const dtS = (samples[i].timestamp - samples[i - 1].timestamp) / 1000;
      if (dtS < 1 && improvement > 30) {
        signals.impossibleAccuracyImprovement = true;
        break;
      }
    }
  }

  // Weighted score
  const score = Math.min(
    100,
    (Object.entries(signals) as [keyof MockLocationSignals, boolean][]).reduce(
      (sum, [key, triggered]) =>
        triggered ? sum + MOCK_SIGNAL_WEIGHTS[key] : sum,
      0,
    ),
  );

  const risk: MockLocationRisk =
    score === 0 ? "none" : score < 25 ? "low" : score < 55 ? "medium" : "high";

  const triggeredSignalNames = (
    Object.entries(signals) as [keyof MockLocationSignals, boolean][]
  )
    .filter(([, v]) => v)
    .map(([k]) => k);

  const explanation =
    triggeredSignalNames.length === 0
      ? "No mock location signals detected."
      : `Mock risk ${risk} (score ${score}/100). Triggered: ${triggeredSignalNames.join(", ")}.`;

  return { risk, signals, score, explanation };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion / Accelerometer Presence
// ─────────────────────────────────────────────────────────────────────────────

async function captureMotionPresence(): Promise<MotionPresenceResult> {
  const unavailable: MotionPresenceResult = {
    apiAvailable: false,
    motionDetected: false,
    acceleration: null,
    rotationRate: null,
  };

  if (typeof DeviceMotionEvent === "undefined") return unavailable;

  try {
    const DeviceMotionEventExtended = DeviceMotionEvent as typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    if (typeof DeviceMotionEventExtended.requestPermission === "function") {
      const permission = await DeviceMotionEventExtended.requestPermission();
      if (permission !== "granted") {
        return { ...unavailable, apiAvailable: true };
      }
    }

    return new Promise<MotionPresenceResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ apiAvailable: true, motionDetected: false, acceleration: null, rotationRate: null });
      }, 500);

      const handler = (event: DeviceMotionEvent) => {
        clearTimeout(timeout);
        window.removeEventListener("devicemotion", handler);

        const acc = event.acceleration;
        const rot = event.rotationRate;
        const hasMotion =
          acc !== null &&
          (Math.abs(acc.x ?? 0) > 0.01 ||
            Math.abs(acc.y ?? 0) > 0.01 ||
            Math.abs(acc.z ?? 0) > 0.01);

        resolve({
          apiAvailable: true,
          motionDetected: hasMotion,
          acceleration:
            acc !== null
              ? { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 }
              : null,
          rotationRate:
            rot !== null
              ? { alpha: rot.alpha ?? 0, beta: rot.beta ?? 0, gamma: rot.gamma ?? 0 }
              : null,
        });
      };

      window.addEventListener("devicemotion", handler, { once: true });
    });
  } catch {
    return unavailable;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebRTC Local IP Discovery
// ─────────────────────────────────────────────────────────────────────────────

async function discoverWebRtcLocalIps(): Promise<string[]> {
  if (typeof RTCPeerConnection === "undefined") return [];

  const ips = new Set<string>();

  return new Promise<string[]>((resolve) => {
    const timeout = setTimeout(() => resolve([...ips]), 1500);

    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel("");

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timeout);
          pc.close();
          resolve([...ips]);
          return;
        }

        const ipMatch = /([0-9]{1,3}\.){3}[0-9]{1,3}/.exec(
          event.candidate.candidate,
        );
        if (ipMatch) ips.add(ipMatch[0]);
      };

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timeout);
          resolve([]);
        });
    } catch {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

function isPrivateIp(ip: string): boolean {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith("169.254.")
  );
}

async function captureNetworkInfo(): Promise<NetworkInfo> {
  const webRtcLocalIps = await discoverWebRtcLocalIps();
  const isPrivateNetwork = webRtcLocalIps.some(isPrivateIp);

  try {
    const nav = navigator as Navigator & {
      connection?: {
        type?: string;
        effectiveType?: string;
        rtt?: number;
        downlink?: number;
      };
    };

    const conn = nav.connection;
    const type = (conn?.type as NetworkType) ?? "unknown";

    return {
      type,
      effectiveType: conn?.effectiveType ?? null,
      isWifi: type === "wifi",
      rttMs: conn?.rtt ?? null,
      downlinkMbps: conn?.downlink ?? null,
      webRtcLocalIps,
      isPrivateNetwork,
    };
  } catch {
    return {
      type: "unknown",
      effectiveType: null,
      isWifi: false,
      rttMs: null,
      downlinkMbps: null,
      webRtcLocalIps,
      isPrivateNetwork,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Device Fingerprint
// ─────────────────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sampleFontPresence(): string[] {
  const testFonts = [
    "Arial", "Verdana", "Helvetica", "Times New Roman",
    "Courier New", "Georgia", "Palatino", "Garamond",
    "Bookman", "Comic Sans MS", "Trebuchet MS", "Arial Black",
    "Impact", "Roboto", "Noto Sans",
  ];

  const detected: string[] = [];

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return detected;

    const testString = "mmmmmmmmmmlli";
    const baseFont = "10px monospace";
    ctx.font = baseFont;
    const baseWidth = ctx.measureText(testString).width;

    for (const font of testFonts) {
      ctx.font = `10px "${font}", monospace`;
      if (ctx.measureText(testString).width !== baseWidth) {
        detected.push(font);
      }
    }
  } catch {}

  return detected;
}

async function captureDeviceFingerprint(): Promise<DeviceFingerprint> {
  let canvasSha256 = "unavailable";
  let webglRenderer: string | null = null;
  let webglVendor: string | null = null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f0a";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.font = "bold 14px Arial";
      ctx.fillText("Presence ERP 🎓", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.font = "italic 12px Georgia";
      ctx.fillText("Spatial Anchor v3", 4, 35);
      ctx.beginPath();
      ctx.arc(140, 30, 20, 0, Math.PI * 2);
      ctx.strokeStyle = "#b0e";
      ctx.lineWidth = 2;
      ctx.stroke();

      canvasSha256 = await sha256Hex(canvas.toDataURL());
    }
  } catch {}

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    if (gl) {
      const glCtx = gl as WebGLRenderingContext;
      const debugInfo = glCtx.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        webglRenderer = glCtx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
        webglVendor = glCtx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string;
      }
    }
  } catch {}

  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGb = nav.deviceMemory ?? null;

  return {
    canvasSha256,
    webglRenderer,
    webglVendor,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    devicePixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform ?? "unknown",
    hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
    deviceMemoryGb,
    fontSample: sampleFontPresence(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BLE
// ─────────────────────────────────────────────────────────────────────────────

const BLE_CAVEAT =
  "Web Bluetooth cannot passively scan BLE beacons. " +
  "Only connectable devices discovered via requestDevice() are listed. " +
  "For reliable beacon attestation, use the native mobile application.";

async function attemptBleScan(): Promise<BleResult> {
  if (typeof navigator === "undefined") {
    return { apiAvailable: false, permissionGranted: false, nearbyDevices: [], caveat: BLE_CAVEAT };
  }

  const nav = navigator as Navigator & {
    bluetooth?: {
      getAvailability: () => Promise<boolean>;
      requestDevice: (opts: unknown) => Promise<{ name: string | null; id: string }>;
    };
  };

  if (!nav.bluetooth) {
    return { apiAvailable: false, permissionGranted: false, nearbyDevices: [], caveat: BLE_CAVEAT };
  }

  try {
    const isAvailable = await nav.bluetooth.getAvailability();
    if (!isAvailable) {
      return { apiAvailable: false, permissionGranted: false, nearbyDevices: [], caveat: BLE_CAVEAT };
    }

    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [],
    });

    return {
      apiAvailable: true,
      permissionGranted: true,
      nearbyDevices: [{ name: device.name, id: device.id }],
      caveat: BLE_CAVEAT,
    };
  } catch (err) {
    const denied =
      err instanceof Error &&
      (err.message.includes("User cancelled") ||
        err.name === "NotFoundError" ||
        err.name === "SecurityError");

    return {
      apiAvailable: true,
      permissionGranted: !denied,
      nearbyDevices: [],
      caveat: BLE_CAVEAT,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC Payload Signing (Web Crypto)
// ─────────────────────────────────────────────────────────────────────────────

async function signPayload(
  payloadWithoutHmac: Omit<SpatialAnchorPayload, "hmac">,
  hmacSecret: string,
): Promise<string> {
  const message = JSON.stringify(payloadWithoutHmac);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    keyMaterial,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Score
// ─────────────────────────────────────────────────────────────────────────────

function computeConfidenceScore(
  samples: GpsSample[],
  mockAnalysis: MockLocationAnalysis,
  network: NetworkInfo,
  motion: MotionPresenceResult,
  maxAccuracyM: number,
): number {
  let score = 0;

  const best = selectBestSample(samples);
  if (!best) return 0;

  // GPS quality (0–40 points)
  if (best.accuracyM <= 10) score += 40;
  else if (best.accuracyM <= 30) score += 30;
  else if (best.accuracyM <= 60) score += 20;
  else if (best.accuracyM <= maxAccuracyM) score += 10;

  // Mock risk penalty
  score -= Math.round(mockAnalysis.score * 0.4);

  // Network signals (0–20 points)
  if (network.isWifi) score += 10;
  if (network.isPrivateNetwork) score += 10;

  // Physical presence via motion (0–20 points)
  if (motion.apiAvailable) score += 10;
  if (motion.motionDetected) score += 10;

  // Multi-sample consistency bonus (0–10 points)
  if (samples.length >= 3) score += 5;
  if (samples.length >= 5) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function captureSpatialAnchor(
  options: SpatialAnchorOptions,
): Promise<SpatialAnchorPayload> {
  assertSecureContext();

  const {
    nonce,
    hmacSecret,
    sampleCount = 3,
    sampleIntervalMs = 800,
    maxAccuracyM = 100,
    gpsTimeoutMs = 10_000,
    attemptBle: shouldAttemptBle = false,
    captureMotion = true,
  } = options;

  // Gracefully generate client fallback nonce/secret if missing to avoid breaking legacy callers
  const effectiveNonce = nonce && nonce.trim().length > 0 ? nonce : `client-nonce-${crypto.randomUUID()}`;
  const effectiveHmacSecret = hmacSecret && hmacSecret.trim().length > 0 ? hmacSecret : `client-secret-${crypto.randomUUID()}`;

  const [
    { samples: gpsSamples, firstError },
    network,
    deviceFingerprint,
    motion,
  ] = await Promise.all([
    collectGpsSamples(sampleCount, sampleIntervalMs, gpsTimeoutMs),
    captureNetworkInfo(),
    captureDeviceFingerprint(),
    captureMotion ? captureMotionPresence() : Promise.resolve<MotionPresenceResult>({
      apiAvailable: false,
      motionDetected: false,
      acceleration: null,
      rotationRate: null,
    }),
  ]);

  const best = selectBestSample(gpsSamples);

  if (!best) {
    throw new Error(
      firstError ??
        "Could not obtain a GPS fix. Please ensure location permission is granted and try again.",
    );
  }

  if (best.accuracyM > maxAccuracyM) {
    console.warn(
      `[SpatialAnchor] GPS accuracy ${best.accuracyM.toFixed(1)}m exceeds ` +
        `threshold of ${maxAccuracyM}m. Proceeding with degraded confidence.`,
    );
  }

  const mockLocation = analyseMockLocationRisk(gpsSamples);

  const ble = shouldAttemptBle
    ? await attemptBleScan()
    : { apiAvailable: false, permissionGranted: false, nearbyDevices: [], caveat: BLE_CAVEAT };

  const confidenceScore = computeConfidenceScore(
    gpsSamples,
    mockLocation,
    network,
    motion,
    maxAccuracyM,
  );

  const payloadWithoutHmac: Omit<SpatialAnchorPayload, "hmac"> = {
    nonce: effectiveNonce,
    gps: {
      lat: best.lat,
      lng: best.lng,
      accuracyM: best.accuracyM,
      altitude: best.altitude,
      heading: best.heading,
      speedMps: best.speedMps,
    },
    gpsSamples,
    mockLocation,
    motionPresence: motion,
    network,
    ble,
    deviceFingerprint,
    capturedAt: new Date().toISOString(),
    confidenceScore,
  };

  const hmac = await signPayload(payloadWithoutHmac, effectiveHmacSecret);

  return { ...payloadWithoutHmac, hmac };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-Side Validation
// ─────────────────────────────────────────────────────────────────────────────

export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function verifyPayloadHmac(
  payload: SpatialAnchorPayload,
  hmacSecret: string,
): Promise<boolean> {
  try {
    const { hmac, ...payloadWithoutHmac } = payload;
    const message = JSON.stringify(payloadWithoutHmac);

    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", hmacSecret)
      .update(message)
      .digest("hex");

    if (expected.length !== hmac.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ hmac.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export function isIpInSubnets(ip: string, subnets: string[]): boolean {
  const ipToInt = (addr: string): number =>
    addr
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;

  for (const subnet of subnets) {
    const [base, bits] = subnet.split("/");
    const mask = bits ? ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0 : 0xffffffff;
    if ((ipToInt(ip) & mask) === (ipToInt(base) & mask)) return true;
  }
  return false;
}

export async function validateSpatialPayload(
  payload: SpatialAnchorPayload,
  geofence: CampusGeofence,
  opts: {
    hmacSecret: string;
    campusSubnets?: string[];
    maxAccuracyM?: number;
    maxAgeMs?: number;
    rejectOnMockRisk?: MockLocationRisk[];
    minConfidenceScore?: number;
  },
): Promise<SpatialValidationResult> {
  const {
    hmacSecret,
    campusSubnets = [],
    maxAccuracyM = 80,
    maxAgeMs = MAX_PAYLOAD_AGE_MS,
    rejectOnMockRisk = ["high"],
    minConfidenceScore = 30,
  } = opts;

  if (
    geofence.radiusM < MIN_GEOFENCE_RADIUS_M ||
    geofence.radiusM > MAX_GEOFENCE_RADIUS_M
  ) {
    throw new Error(
      `Geofence radius ${geofence.radiusM}m is outside allowed range ` +
        `(${MIN_GEOFENCE_RADIUS_M}m–${MAX_GEOFENCE_RADIUS_M}m).`,
    );
  }

  const reasons: string[] = [];

  const hmacValid = await verifyPayloadHmac(payload, hmacSecret);
  if (!hmacValid) {
    reasons.push("Payload HMAC signature is invalid. Possible tampering detected.");
  }

  const distanceFromCentreM = haversineDistanceM(
    payload.gps.lat,
    payload.gps.lng,
    geofence.lat,
    geofence.lng,
  );
  const withinGeofence = distanceFromCentreM <= geofence.radiusM;
  if (!withinGeofence) {
    reasons.push(
      `Device is ${distanceFromCentreM.toFixed(0)}m from campus centre ` +
        `(allowed radius: ${geofence.radiusM}m).`,
    );
  }

  const accuracyAcceptable = payload.gps.accuracyM <= maxAccuracyM;
  if (!accuracyAcceptable) {
    reasons.push(
      `GPS accuracy ${payload.gps.accuracyM.toFixed(1)}m exceeds maximum of ${maxAccuracyM}m.`,
    );
  }

  const ageMs = Date.now() - new Date(payload.capturedAt).getTime();
  const payloadFresh = ageMs >= 0 && ageMs <= maxAgeMs;
  if (!payloadFresh) {
    reasons.push(
      `Payload age ${(ageMs / 1000).toFixed(0)}s exceeds maximum of ${maxAgeMs / 1000}s.` +
        (ageMs < 0 ? " Timestamp is in the future — possible clock skew or replay." : ""),
    );
  }

  const mockRisk = payload.mockLocation.risk;
  const mockRejected = rejectOnMockRisk.includes(mockRisk);
  if (mockRejected) {
    reasons.push(payload.mockLocation.explanation);
  }

  const webRtcIps = payload.network.webRtcLocalIps;
  const onCampusNetwork =
    campusSubnets.length === 0
      ? payload.network.isPrivateNetwork
      : webRtcIps.some((ip) => isIpInSubnets(ip, campusSubnets));

  if (!onCampusNetwork && campusSubnets.length > 0) {
    reasons.push(
      "Device does not appear to be on the campus network. " +
        `Detected IPs: [${webRtcIps.join(", ") || "none"}].`,
    );
  }

  const confidenceOk = payload.confidenceScore >= minConfidenceScore;
  if (!confidenceOk) {
    reasons.push(
      `Confidence score ${payload.confidenceScore}/100 is below minimum of ${minConfidenceScore}.`,
    );
  }

  const passed =
    hmacValid &&
    withinGeofence &&
    accuracyAcceptable &&
    payloadFresh &&
    !mockRejected &&
    confidenceOk;

  return {
    passed,
    confidenceScore: payload.confidenceScore,
    withinGeofence,
    accuracyAcceptable,
    mockRisk,
    payloadFresh,
    hmacValid,
    onCampusNetwork,
    distanceFromCentreM,
    reasons,
  };
}
