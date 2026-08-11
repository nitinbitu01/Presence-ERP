// ─────────────────────────────────────────────────────────────────
// Retrieval-Augmented Generation
//
// Instead of dumping all 10 records, we:
//   1. Embed the user's question
//   2. Embed each attendance record's text representation
//   3. Return only the top-K most semantically relevant records
//
// "Why was I absent on Tuesday?" → retrieves Tuesday's record
// "What is my liveness score?"  → retrieves records with face data
// ─────────────────────────────────────────────────────────────────

import type { AttendanceRecord } from "./types";
import { embedText, cosineSimilarity } from "./embeddings";
import { AI_CONFIG } from "./config";

function recordToText(r: AttendanceRecord): string {
  const gates = (r.trust_breakdown?.components ?? [])
    .map(
      (c) =>
        `${c.label} ${c.achieved >= c.threshold ? "passed" : "failed"}: ` +
        `${c.detail} (${(c.achieved * 100).toFixed(0)}% of ${(c.threshold * 100).toFixed(0)}% required)`,
    )
    .join(". ");

  return [
    `Date: ${new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    `Decision: ${r.decision}`,
    `Trust score: ${r.trust_score ?? "unknown"} out of 100`,
    `Reason code: ${r.reason_code ?? "none"}`,
    `Face similarity: ${r.similarity != null ? `${(r.similarity * 100).toFixed(1)}%` : "not recorded"}`,
    gates ? `Verification gates: ${gates}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

export interface RagResult {
  relevantRecords: AttendanceRecord[];
  allRecords: AttendanceRecord[];
  retrievalScores: number[];
}

export async function retrieveRelevantRecords(
  question: string,
  records: AttendanceRecord[],
  apiKey: string,
): Promise<RagResult> {
  if (records.length === 0) {
    return { relevantRecords: [], allRecords: [], retrievalScores: [] };
  }

  // If small number of records, no need for RAG — just return all
  if (records.length <= 3) {
    return {
      relevantRecords: records,
      allRecords: records,
      retrievalScores: records.map(() => 1.0),
    };
  }

  // Detect if question is about a specific record or global summary
  const isGlobalQuery =
    /\b(all|total|average|overall|summary|percentage|how many|attendance rate)\b/i.test(question);
  if (isGlobalQuery) {
    return {
      relevantRecords: records, // Return all for aggregate questions
      allRecords: records,
      retrievalScores: records.map(() => 1.0),
    };
  }

  try {
    // Embed question + all records in parallel
    const [questionEmbedding, ...recordEmbeddings] = await Promise.all([
      embedText(question, apiKey),
      ...records.map((r) => embedText(recordToText(r), apiKey)),
    ]);

    // Score each record
    const scored = records.map((record, i) => ({
      record,
      score: cosineSimilarity(questionEmbedding, recordEmbeddings[i]),
    }));

    // Sort by relevance, filter by minimum threshold
    scored.sort((a, b) => b.score - a.score);

    const relevant = scored
      .filter((s) => s.score >= AI_CONFIG.ragMinSimilarity)
      .slice(0, AI_CONFIG.ragTopK);

    // Always include at least 1 record even if below threshold
    const final = relevant.length > 0 ? relevant : [scored[0]];

    return {
      relevantRecords: final.map((s) => s.record),
      allRecords: records,
      retrievalScores: final.map((s) => s.score),
    };
  } catch {
    // Embedding failed — fall back to most recent records
    return {
      relevantRecords: records.slice(0, AI_CONFIG.ragTopK),
      allRecords: records,
      retrievalScores: [],
    };
  }
}
