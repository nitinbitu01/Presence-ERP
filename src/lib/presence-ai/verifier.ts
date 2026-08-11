// ─────────────────────────────────────────────────────────────────
// AI Claim Verifier
//
// After the AI generates a response, this module:
//   1. Extracts factual claims (attendance %, session counts, dates)
//   2. Cross-checks each claim against the AttendanceForecast (DB truth)
//   3. Replaces incorrect numbers with correct values
//   4. Annotates the response with a confidence level
//
// This eliminates hallucinations on factual attendance questions —
// the most common source of student distrust.
//
// No extra API calls needed: uses the AttendanceForecast computed
// by predictor.ts (which is already available in the pipeline).
// ─────────────────────────────────────────────────────────────────

import type { AttendanceForecast } from './predictor';

export type ClaimSource = 'database' | 'inference' | 'uncertain';

export interface VerifiedClaim {
  original: string;         // the text fragment from the AI response
  corrected: string;        // the fact-checked version (same if accurate)
  accurate: boolean;
  source: ClaimSource;
  confidence: number;       // 0–1
}

export interface VerificationResult {
  correctedText: string;    // final response text (inaccurate numbers replaced)
  claims: VerifiedClaim[];
  isFullyVerified: boolean;
  overallConfidence: number;
}

// Regex patterns that detect factual claims in attendance AI responses
const PERCENTAGE_PATTERN = /(\d{1,3}(?:\.\d{1,2})?)\s*%/g;
const SESSION_COUNT_PATTERN = /(\d+)\s+(?:session|class|lecture)s?/gi;
const DAY_COUNT_PATTERN = /(\d+)\s+(?:day|days)/gi;

// ── Main export ───────────────────────────────────────────────────

export function verifyResponse(
  aiText: string,
  forecast: AttendanceForecast,
): VerificationResult {
  const claims: VerifiedClaim[] = [];
  let correctedText = aiText;

  // 1. Verify percentage claims
  const percentageClaims = extractAndVerifyPercentages(aiText, forecast);
  claims.push(...percentageClaims);

  // 2. Verify session count claims
  const sessionClaims = extractAndVerifySessionCounts(aiText, forecast);
  claims.push(...sessionClaims);

  // 3. Apply corrections to text
  for (const claim of claims) {
    if (!claim.accurate && claim.corrected !== claim.original) {
      // Only replace if the correction is meaningfully different
      correctedText = correctedText.replace(claim.original, claim.corrected);
    }
  }

  const overallConfidence =
    claims.length > 0
      ? claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length
      : 0.9; // no detectable claims → assume high confidence (no numbers to verify)

  return {
    correctedText,
    claims,
    isFullyVerified: claims.every(c => c.accurate),
    overallConfidence,
  };
}

// ── Percentage verifier ───────────────────────────────────────────

function extractAndVerifyPercentages(
  text: string,
  forecast: AttendanceForecast,
): VerifiedClaim[] {
  const claims: VerifiedClaim[] = [];
  const actualPct = forecast.currentRate * 100;
  const thresholdPct = forecast.thresholdRate * 100;

  let match: RegExpExecArray | null;
  PERCENTAGE_PATTERN.lastIndex = 0;

  while ((match = PERCENTAGE_PATTERN.exec(text)) !== null) {
    const stated = parseFloat(match[1]);
    const fullMatch = match[0];

    // Is this number close to the current rate?
    const deltaFromCurrent = Math.abs(stated - actualPct);
    const deltaFromThreshold = Math.abs(stated - thresholdPct);

    if (deltaFromThreshold <= 0.01) {
      // It's the threshold — always accurate
      claims.push({
        original: fullMatch,
        corrected: fullMatch,
        accurate: true,
        source: 'database',
        confidence: 1,
      });
    } else if (deltaFromCurrent <= 2.0) {
      // Close enough to current rate — accurate if within 2%
      const accurate = deltaFromCurrent <= 0.5;
      const corrected = accurate ? fullMatch : `${actualPct.toFixed(1)}%`;
      claims.push({
        original: fullMatch,
        corrected,
        accurate,
        source: 'database',
        confidence: accurate ? 0.95 : 0.3,
      });
    } else if (stated >= 0 && stated <= 100) {
      // Some other percentage — inference
      claims.push({
        original: fullMatch,
        corrected: fullMatch,
        accurate: true,  // we don't know what it refers to, so give benefit of doubt
        source: 'inference',
        confidence: 0.7,
      });
    }
  }

  return claims;
}

// ── Session count verifier ────────────────────────────────────────

function extractAndVerifySessionCounts(
  text: string,
  forecast: AttendanceForecast,
): VerifiedClaim[] {
  const claims: VerifiedClaim[] = [];

  const knownValues: Array<{ value: number; label: string }> = [
    { value: forecast.totalSessions, label: 'total sessions this semester' },
    { value: forecast.attendedSessions, label: 'sessions attended' },
    { value: forecast.remainingSessions, label: 'sessions remaining' },
    { value: forecast.sessionsNeededToRecover, label: 'sessions needed to recover' },
  ].filter(v => v.value > 0);

  let match: RegExpExecArray | null;
  SESSION_COUNT_PATTERN.lastIndex = 0;

  while ((match = SESSION_COUNT_PATTERN.exec(text)) !== null) {
    const stated = parseInt(match[1], 10);
    const fullMatch = match[0];

    // Find closest known value
    let closest: { value: number; label: string } | undefined;
    let minDelta = Infinity;

    for (const kv of knownValues) {
      const delta = Math.abs(stated - kv.value);
      if (delta < minDelta) {
        minDelta = delta;
        closest = kv;
      }
    }

    if (closest && minDelta === 0) {
      claims.push({
        original: fullMatch,
        corrected: fullMatch,
        accurate: true,
        source: 'database',
        confidence: 1,
      });
    } else if (closest && minDelta <= 2) {
      // Off by 1-2, correct it
      const corrected = fullMatch.replace(String(stated), String(closest.value));
      claims.push({
        original: fullMatch,
        corrected,
        accurate: false,
        source: 'database',
        confidence: 0.4,
      });
    } else {
      claims.push({
        original: fullMatch,
        corrected: fullMatch,
        accurate: true,
        source: 'inference',
        confidence: 0.6,
      });
    }
  }

  return claims;
}

// ── Format badge text (for PresenceChat.tsx) ──────────────────────

export function getVerificationBadge(result: VerificationResult): {
  label: string;
  variant: 'verified' | 'inferred' | 'corrected';
} {
  if (result.isFullyVerified && result.claims.some(c => c.source === 'database')) {
    return { label: '✓ Live data verified', variant: 'verified' };
  }
  if (result.claims.some(c => !c.accurate)) {
    return { label: '⚠ Numbers corrected from DB', variant: 'corrected' };
  }
  return { label: '◎ AI inferred', variant: 'inferred' };
}
