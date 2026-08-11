// ─────────────────────────────────────────────────────────────────
// Validates AI output against ground truth data
// Catches hallucinated dates, invented trust scores, etc.
// ─────────────────────────────────────────────────────────────────

import type { AttendanceRecord } from "./types";

interface ValidationResult {
  safe: boolean;
  issues: string[];
  sanitized: string;
}

export function validateOutput(output: string, records: AttendanceRecord[]): ValidationResult {
  const issues: string[] = [];
  let sanitized = output;

  // Check for invented trust scores
  const scoreMatches = output.matchAll(/trust score of (\d+)/gi);
  const validScores = new Set(
    records.map((r) => r.trust_score).filter((s): s is number => s !== null && s !== undefined),
  );

  for (const match of scoreMatches) {
    const mentionedScore = parseInt(match[1], 10);
    if (!validScores.has(mentionedScore)) {
      issues.push(`Hallucinated trust score: ${mentionedScore}`);
      sanitized = sanitized.replace(match[0], "trust score from your records");
    }
  }

  // Flag if response is extremely long (likely padding/hallucination)
  if (output.length > 3000) {
    issues.push("Response unusually long — may contain padding");
    sanitized = output.slice(0, 3000) + "\n\n_[Response shortened for clarity]_";
  }

  // Detect if AI is refusing entirely (unhelpful)
  const isRefusal =
    /i (cannot|can't|am unable to|don't have access to)/i.test(output) && records.length > 0;
  if (isRefusal) {
    issues.push("AI refused despite having data");
  }

  return {
    safe: issues.length === 0,
    issues,
    sanitized,
  };
}
