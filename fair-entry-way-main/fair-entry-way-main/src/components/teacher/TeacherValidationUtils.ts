import { z } from "zod";

/**
 * Validates session start and end times
 */
export function validateSessionTimes(
  startsAt: string,
  endsAt: string,
): { valid: boolean; error?: string } {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();

  if (isNaN(start) || isNaN(end)) {
    return { valid: false, error: "Please enter valid date and time values." };
  }

  if (end <= start) {
    return { valid: false, error: "Session end time must be after the start time." };
  }

  const durationMin = (end - start) / (1000 * 60);
  if (durationMin < 5) {
    return { valid: false, error: "Session duration must be at least 5 minutes." };
  }

  if (durationMin > 720) {
    return { valid: false, error: "Session duration cannot exceed 12 hours." };
  }

  return { valid: true };
}

/**
 * Validates Geographic Coordinates and Radius
 */
export function validateGeoCoordinates(
  latStr: string,
  lngStr: string,
  radiusStr: string,
): { valid: boolean; lat?: number; lng?: number; radius?: number; error?: string } {
  // Default to Main Campus coordinates (23.2156, 72.6369) if unprovided or blank
  const effectiveLatStr = !latStr || latStr.trim() === "" ? "23.2156" : latStr;
  const effectiveLngStr = !lngStr || lngStr.trim() === "" ? "72.6369" : lngStr;
  const effectiveRadiusStr = !radiusStr || radiusStr.trim() === "" ? "50" : radiusStr;

  const lat = parseFloat(effectiveLatStr);
  const lng = parseFloat(effectiveLngStr);
  const radius = parseFloat(effectiveRadiusStr);

  if (isNaN(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: "Latitude must be a valid number between -90 and 90." };
  }

  if (isNaN(lng) || lng < -180 || lng > 180) {
    return { valid: false, error: "Longitude must be a valid number between -180 and 180." };
  }

  if (isNaN(radius) || radius < 5 || radius > 1000) {
    return { valid: false, error: "Geofence radius must be between 5 meters and 1000 meters." };
  }

  return { valid: true, lat, lng, radius };
}

/**
 * Validates IP Allowlist format (IPv4 / IPv6)
 */
export function validateIpAllowlist(ipString: string): {
  valid: boolean;
  ips: string[];
  error?: string;
} {
  if (!ipString.trim()) return { valid: true, ips: [] };

  const rawIps = ipString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ipv4Regex = /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  const invalid = rawIps.find((ip) => !ipv4Regex.test(ip) && !ipv6Regex.test(ip));

  if (invalid) {
    return {
      valid: false,
      ips: [],
      error: `Invalid IP format: "${invalid}". Example valid formats: "192.168.1.1", "10.0.0.0/24"`,
    };
  }

  return { valid: true, ips: rawIps };
}

/**
 * Validates exam weightage distribution across exams for a course
 */
export function validateExamWeightage(
  existingExams: { id?: string; weightage: number }[],
  newWeightage: number,
  currentExamId?: string,
): { valid: boolean; currentTotal: number; newTotal: number; error?: string } {
  const currentTotal = existingExams
    .filter((e) => e.id !== currentExamId)
    .reduce((sum, e) => sum + (e.weightage || 0), 0);

  const newTotal = currentTotal + newWeightage;

  if (newTotal > 100) {
    return {
      valid: false,
      currentTotal,
      newTotal,
      error: `Total exam weightage would exceed 100% (${newTotal}%). Remaining available weightage: ${100 - currentTotal}%.`,
    };
  }

  return { valid: true, currentTotal, newTotal };
}
