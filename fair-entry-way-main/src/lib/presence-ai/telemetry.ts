// ─────────────────────────────────────────────────────────────────
// Structured telemetry — plug in PostHog / Datadog / OTEL
// ─────────────────────────────────────────────────────────────────

export interface AITelemetryEvent {
  requestId: string;
  userId: string;

  // Input
  questionLength: number;
  historyTurns: number;
  language?: string;

  // Security
  injectionBlocked: boolean;
  rateLimited: boolean;

  // RAG
  totalRecords: number;
  retrievedRecords: number;
  ragUsed: boolean;
  avgRetrievalScore?: number;

  // AI
  model: string;
  tokensUsed: number;
  latencyMs: number;
  cached: boolean;
  streamed: boolean;

  // Quality
  outputValidationIssues: number;
  hallucinated: boolean;

  // Outcome
  success: boolean;
  errorType?: string;
}

export async function track(event: AITelemetryEvent): Promise<void> {
  // ── Development ──
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Presence Telemetry] ${event.requestId}`, {
      model: event.model,
      latency: `${event.latencyMs}ms`,
      tokens: event.tokensUsed,
      rag: `${event.retrievedRecords}/${event.totalRecords} records`,
      cached: event.cached,
      success: event.success,
    });
    return;
  }

  // ── PostHog ──────────────────────────────────────────────────
  if (process.env.POSTHOG_API_KEY) {
    await fetch('https://app.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.POSTHOG_API_KEY,
        event: 'presence_ai_query',
        distinct_id: event.userId,
        properties: event,
      }),
    }).catch(() => {}); // fire and forget
  }
}
