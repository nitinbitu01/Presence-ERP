// ─────────────────────────────────────────────────────────────────
// Core domain types — single source of truth
// ─────────────────────────────────────────────────────────────────

export type Decision = 'present' | 'absent' | 'review';
export type GateLabel =
  | 'LIVENESS_MATCH'
  | 'GEOFENCE'
  | 'DEVICE_ATTEST'
  | 'NETWORK'
  | 'TIMING'
  | 'OTP';

export interface TrustComponent {
  label: GateLabel | string;
  detail: string;
  achieved: number;   // 0.0 – 1.0
  threshold: number;  // 0.0 – 1.0
  weight: number;     // contribution to total score
  critical: boolean;  // if true, failure = ABSENT regardless of score
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  decision: Decision;
  similarity: number | null;
  gate_reasons: Record<string, unknown> | null;
  trust_score: number | null;
  trust_breakdown: { components: TrustComponent[] } | null;
  reason_code: string | null;
  created_at: string;
  // pgvector — populated after embedding fetch
  embedding?: number[];
}

export interface StudentProfile {
  display_name: string | null;
  roll_no: string | null;
  department_id: string | null;
  email: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SourceRecord {
  id: string;
  date: string;
  decision: Decision;
  trustScore: number | null;
  sessionId: string;
}

export interface StreamChunk {
  type: 'token' | 'sources' | 'error' | 'done' | 'metadata';
  payload: string | SourceRecord[] | StreamMetadata;
}

export interface StreamMetadata {
  model: string;
  cached: boolean;
  ragRecordsUsed: number;
  rateLimitRemaining: number;
  requestId: string;
}

export interface PresenceAIRequest {
  question: string;
  conversationHistory: ChatMessage[];
}

// Zod-independent validated type (inferred after parse)
export interface ValidatedRequest {
  question: string;
  conversationHistory: ChatMessage[];
}
