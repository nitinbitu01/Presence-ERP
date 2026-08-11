/**
 * Phase 5 Gap Closure: Ray-Casting Geo-Polygon & BLE Beacon Proximity Engine
 * Provides indoor positioning for multi-story campus buildings using Point-in-Polygon
 * (Ray-Casting) geofencing and Bluetooth Low Energy (BLE) RSSI signal validation.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface BleBeaconSignal {
  uuid: string;
  major: number;
  minor: number;
  rssi: number; // Signal strength e.g. -65 dBm
}

export interface RequiredBleBeacon {
  uuid: string;
  major: number;
  minor: number;
  minRssi: number; // Minimum acceptable signal strength e.g. -85 dBm
}

/**
 * isPointInPolygon — Ray-casting algorithm to determine if a GPS coordinate
 * falls inside an arbitrary multi-vertex campus building polygon.
 */
export function isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const x = point.lng;
  const y = point.lat;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * verifyBleBeaconProximity — Verifies that client-detected Bluetooth Low Energy (BLE)
 * beacons match classroom beacon specifications and meet required RSSI threshold.
 */
export function verifyBleBeaconProximity(
  detectedBeacons: BleBeaconSignal[],
  requiredBeacons: RequiredBleBeacon[],
): { isWithinRange: boolean; matchedCount: number; strongestRssi: number | null } {
  if (requiredBeacons.length === 0) {
    return { isWithinRange: true, matchedCount: 0, strongestRssi: null };
  }

  let matchedCount = 0;
  let strongestRssi: number | null = null;

  for (const req of requiredBeacons) {
    const match = detectedBeacons.find(
      (b) =>
        b.uuid.toLowerCase() === req.uuid.toLowerCase() &&
        b.major === req.major &&
        b.minor === req.minor &&
        b.rssi >= req.minRssi,
    );

    if (match) {
      matchedCount++;
      if (strongestRssi === null || match.rssi > strongestRssi) {
        strongestRssi = match.rssi;
      }
    }
  }

  const isWithinRange = matchedCount > 0;
  return { isWithinRange, matchedCount, strongestRssi };
}
