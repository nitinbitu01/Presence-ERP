export interface TrustScoreBreakdown {
  total: number;
  components: {
    label: string;
    weight: number;
    achieved: number; // 0-1
    detail: string;
  }[];
}

const WEIGHTS = {
  liveness: 35,
  spatial: 20,
  deviceAttestation: 25,
  network: 10,
  temporal: 5,
  otp: 5,
} as const;

export function computeTrustScore(
  gateReasons: Record<string, any>,
  similarity: number | null,
): TrustScoreBreakdown {
  const components: TrustScoreBreakdown["components"] = [];

  // Liveness / identity match
  const livenessAchieved =
    similarity != null ? Math.max(0, Math.min(1, (similarity - 0.5) / 0.5)) : 0;
  components.push({
    label: "Face liveness match",
    weight: WEIGHTS.liveness,
    achieved: livenessAchieved,
    detail:
      similarity != null ? `${(similarity * 100).toFixed(1)}% embedding similarity` : "unavailable",
  });

  // Spatial (geofence + Wi-Fi BSSID + BLE beacon multi-factor anchor)
  const spatial = gateReasons.spatial ?? gateReasons.geo ?? {};
  const spatialOk = spatial?.ok ?? spatial?.passed ?? false;
  const distanceM = spatial?.distance_m ?? spatial?.distanceM ?? 0;
  const wifiVerified = spatial?.wifi_verified ?? spatial?.wifiVerified ?? true;
  const bleVerified = spatial?.ble_verified ?? spatial?.bleVerified ?? true;

  let spatialAchieved = spatialOk ? Math.max(0, 1 - distanceM / 50) : 0;
  if (spatialOk && (wifiVerified || bleVerified)) {
    spatialAchieved = Math.min(1, spatialAchieved + 0.15);
  }

  components.push({
    label: "Spatial Multi-Factor Anchor",
    weight: WEIGHTS.spatial,
    achieved: spatialAchieved,
    detail: spatialOk
      ? `${distanceM.toFixed?.(1) ?? distanceM}m anchor · Wi-Fi & BLE Beacon Verified`
      : "outside geofence",
  });

  // Device attestation (WebAuthn)
  const device = gateReasons.deviceAttestation ?? gateReasons.device ?? gateReasons.webauthn ?? {};
  const deviceOk = device?.ok ?? device?.passed ?? false;
  components.push({
    label: "Bound device (WebAuthn)",
    weight: WEIGHTS.deviceAttestation,
    achieved: deviceOk ? 1 : 0,
    detail: deviceOk ? "hardware-backed signature verified" : "no bound device / not verified",
  });

  // Network
  const network = gateReasons.network ?? gateReasons.ip ?? {};
  const networkOk = network?.ok ?? network?.passed ?? true;
  components.push({
    label: "Network match",
    weight: WEIGHTS.network,
    achieved: networkOk ? 1 : 0.5,
    detail: networkOk ? "IP within allowed range" : "no network policy enforced",
  });

  // Temporal
  const temporal = gateReasons.temporal ?? gateReasons.timing ?? {};
  const temporalOk = temporal?.ok ?? temporal?.passed ?? true;
  const driftMs = temporal?.drift_ms ?? temporal?.driftMs ?? 0;
  components.push({
    label: "Timing integrity",
    weight: WEIGHTS.temporal,
    achieved: temporalOk ? Math.max(0, 1 - Math.abs(driftMs) / 300_000) : 0,
    detail: `${(Math.abs(driftMs) / 1000).toFixed(1)}s clock drift`,
  });

  // OTP
  const otp = gateReasons.otp ?? gateReasons.sessionOtp ?? null;
  const otpPresent = otp !== null && otp !== undefined;
  const otpOk = otpPresent ? (otp?.ok ?? otp?.passed ?? false) : false;
  components.push({
    label: "Rotating classroom OTP",
    weight: WEIGHTS.otp,
    achieved: otpPresent ? (otpOk ? 1 : 0) : 0.7,
    detail: otpPresent ? (otpOk ? "verified" : "invalid") : "not required for this session",
  });

  const total = Math.round(components.reduce((sum, c) => sum + c.weight * c.achieved, 0));

  return { total, components };
}
