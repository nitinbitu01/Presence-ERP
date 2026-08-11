// ─────────────────────────────────────────────────────────────────
// Single config object — no magic numbers scattered in code
// ─────────────────────────────────────────────────────────────────

export const AI_CONFIG = {
  // Models — ordered by preference
  models: {
    primary: "gpt-4o-mini",
    fallback: "gpt-3.5-turbo",
    embedding: "text-embedding-3-small",
  },

  // Limits
  maxQuestionLength: 500,
  maxHistoryMessages: 20,
  maxResponseTokens: 900,
  temperature: 0.2,

  // RAG
  ragTopK: 4, // How many records to retrieve semantically
  ragMinSimilarity: 0.3, // Cosine similarity threshold

  // Rate limiting (per user, sliding window)
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 10,
  },

  // Cache
  cache: {
    ttlMs: 5 * 60_000, // 5 minutes
    maxSize: 1_000,
  },

  // Timeouts
  openAiTimeoutMs: 30_000,
  embeddingTimeoutMs: 5_000,

  // Gate metadata (authoritative)
  gates: {
    LIVENESS_MATCH: { weight: 0.35, critical: true, label: "Face Liveness Match" },
    GEOFENCE: { weight: 0.25, critical: true, label: "Campus Geofence" },
    OTP: { weight: 0.2, critical: true, label: "Instructor OTP" },
    DEVICE_ATTEST: { weight: 0.1, critical: false, label: "Device Attestation" },
    NETWORK: { weight: 0.05, critical: false, label: "Campus Network" },
    TIMING: { weight: 0.05, critical: false, label: "Session Timing Window" },
  },

  // Trust score thresholds
  trustThresholds: {
    present: 75,
    review: 50,
  },
} as const;
