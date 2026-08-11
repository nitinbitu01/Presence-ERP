/**
 * Phase 8.6 World-Class Student ID Card Generation Engine
 * Generates:
 * - Structured ID card data with HMAC-SHA256 QR verification token
 * - Printable HTML template (CR80 card dimensions, 3.375" x 2.125")
 * - Token verification endpoint
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface StudentIdCardData {
  studentId: string;
  displayName: string;
  rollNo: string;
  departmentName: string;
  programName: string;
  photoUrl: string | null;
  issuedAt: string;
  expiresAt: string;
  verificationQrToken: string;
  verificationUrl: string;
}

export interface IdCardVerificationResult {
  valid: boolean;
  studentId?: string;
  issuedAt?: string;
  reason?: string;
}

const ID_CARD_SECRET = process.env.ID_CARD_SECRET ?? "rru_id_key_v1";
const BASE_URL = process.env.PUBLIC_SITE_URL ?? "https://presence.university.edu";

export function generateStudentIdCardToken(
  studentId: string,
  secretKey: string = ID_CARD_SECRET,
): string {
  const issuedAtMs = Date.now();
  const payload = `${studentId}:${issuedAtMs}`;
  const hmac = createHmac("sha256", secretKey).update(payload).digest("hex");
  return `${payload}:${hmac}`;
}

export function verifyIdCardToken(
  token: string,
  secretKey: string = ID_CARD_SECRET,
): IdCardVerificationResult {
  try {
    const parts = token.split(":");
    if (parts.length !== 3) return { valid: false, reason: "Malformed token" };
    const [studentId, issuedAtMs, providedHmac] = parts as [string, string, string];
    const payload = `${studentId}:${issuedAtMs}`;
    const expectedHmac = createHmac("sha256", secretKey).update(payload).digest("hex");

    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expectedHmac, "hex");
    const providedBuf = Buffer.from(providedHmac.padEnd(expectedHmac.length, "0"), "hex");
    const isValid =
      expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);

    if (!isValid) return { valid: false, reason: "Invalid HMAC signature" };

    // Check expiry: ID cards valid for 1 academic year (365 days)
    const ageMs = Date.now() - parseInt(issuedAtMs, 10);
    const maxAgeMs = 365 * 24 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
      return { valid: false, reason: "ID card expired. Please request a renewed card." };
    }

    return { valid: true, studentId, issuedAt: new Date(parseInt(issuedAtMs, 10)).toISOString() };
  } catch {
    return { valid: false, reason: "Token parse error" };
  }
}

export async function generateStudentIdCardData(
  studentId: string,
  profile: {
    displayName: string;
    rollNo: string;
    departmentName: string;
    programName: string;
    photoUrl?: string | null;
  },
): Promise<StudentIdCardData> {
  const verificationQrToken = generateStudentIdCardToken(studentId);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  return {
    studentId,
    displayName: profile.displayName,
    rollNo: profile.rollNo,
    departmentName: profile.departmentName,
    programName: profile.programName,
    photoUrl: profile.photoUrl ?? null,
    issuedAt,
    expiresAt,
    verificationQrToken,
    verificationUrl: `${BASE_URL}/verify-id?token=${encodeURIComponent(verificationQrToken)}`,
  };
}

/** Generate a print-ready HTML ID card template */
export function generateIdCardHTML(card: StudentIdCardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    @page { size: 3.375in 2.125in; margin: 0; }
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    .card {
      width: 3.375in; height: 2.125in;
      background: linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%);
      color: white; display: flex; flex-direction: column;
      border-radius: 0.15in; overflow: hidden; position: relative;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    }
    .card-header {
      background: rgba(255,255,255,0.1); padding: 0.08in 0.12in;
      display: flex; align-items: center; gap: 0.08in;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    }
    .institution-name { font-size: 0.09in; font-weight: bold; letter-spacing: 0.02em; }
    .card-body { display: flex; flex: 1; padding: 0.1in; gap: 0.1in; }
    .photo-section { display: flex; flex-direction: column; align-items: center; gap: 0.05in; }
    .student-photo {
      width: 0.65in; height: 0.65in; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.5);
      object-fit: cover; background: rgba(255,255,255,0.1);
    }
    .info-section { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 0.025in; }
    .student-name { font-size: 0.11in; font-weight: bold; }
    .field { font-size: 0.08in; opacity: 0.8; }
    .field strong { opacity: 1; color: #90caf9; }
    .card-footer {
      background: rgba(0,0,0,0.3); padding: 0.05in 0.12in;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.065in; opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="institution-name">PRESENCE ERP</div>
    </div>
    <div class="card-body">
      <div class="photo-section">
        ${card.photoUrl ? `<img class="student-photo" src="${card.photoUrl}" alt="Student photo" />` : '<div class="student-photo"></div>'}
      </div>
      <div class="info-section">
        <div class="student-name">${card.displayName}</div>
        <div class="field"><strong>Roll No:</strong> ${card.rollNo}</div>
        <div class="field"><strong>Dept:</strong> ${card.departmentName}</div>
        <div class="field"><strong>Program:</strong> ${card.programName}</div>
        <div class="field"><strong>Valid Until:</strong> ${new Date(card.expiresAt).getFullYear()}</div>
      </div>
    </div>
    <div class="card-footer">
      <span>ID: ${card.studentId.slice(0, 8)}</span>
      <span>Scan QR to verify</span>
      <span>${new Date(card.issuedAt).toLocaleDateString("en-IN")}</span>
    </div>
  </div>
</body>
</html>`;
}
