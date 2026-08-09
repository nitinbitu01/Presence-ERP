// ─────────────────────────────────────────────────────────────────
// Student Memory Engine
//
// Stores compressed, AI-summarised per-student context so that
// every conversation continues from where the last one left off.
//
// Storage: ai_memory table via supabaseAdmin.from('ai_memory')
// Gracefully falls back to empty memory if table doesn't exist yet.
// Token budget: 500 tokens max (trimmed automatically)
// Update: async after each session — never blocks a response
// ─────────────────────────────────────────────────────────────────

export interface StudentMemory {
  userId: string;

  // Learned patterns (auto-detected from conversation history)
  commonIssues: string[];         // e.g. ['geofence_failures_block_c', 'late_checkins']
  resolvedIssues: string[];       // issues that were explicitly resolved
  unresolvedIssues: string[];     // issues flagged but not fixed

  // Preferences (learned or explicit)
  preferredLanguage: 'en' | 'hi' | 'gu';
  responseStyle: 'brief' | 'detailed';

  // Compressed history paragraph (max ~300 tokens)
  summary: string;

  // Conversation topic tracking
  pastTopics: string[];           // e.g. ['asked_manual_override', 'geofence_help']
  interactionCount: number;

  updatedAt: string;
}

const EMPTY_MEMORY = (userId: string): StudentMemory => ({
  userId,
  commonIssues: [],
  resolvedIssues: [],
  unresolvedIssues: [],
  preferredLanguage: 'en',
  responseStyle: 'detailed',
  summary: '',
  pastTopics: [],
  interactionCount: 0,
  updatedAt: new Date().toISOString(),
});

// ── Read ──────────────────────────────────────────────────────────

export async function recallMemory(userId: string): Promise<StudentMemory> {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    // Cast to any — ai_memory is not in the generated types yet
    const { data } = await (supabaseAdmin as any)
      .from('ai_memory')
      .select('memory_json')
      .eq('user_id', userId)
      .maybeSingle();

    if (data?.memory_json && typeof data.memory_json === 'object') {
      return { ...EMPTY_MEMORY(userId), ...(data.memory_json as Partial<StudentMemory>) };
    }
  } catch {
    // Non-fatal — table may not exist yet; new users start with empty memory
  }

  return EMPTY_MEMORY(userId);
}

// ── Write ─────────────────────────────────────────────────────────

async function persistMemory(memory: StudentMemory): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await (supabaseAdmin as any)
      .from('ai_memory')
      .upsert(
        { user_id: memory.userId, memory_json: memory, updated_at: memory.updatedAt },
        { onConflict: 'user_id' },
      );
  } catch (err) {
    console.warn('[Memory] Failed to persist student memory:', err);
  }
}

// ── Update (async — fires after response is sent) ──────────────────

export async function updateMemoryAsync(
  userId: string,
  question: string,
  answer: string,
  currentMemory: StudentMemory,
  apiKey?: string,
): Promise<void> {
  // Run in background — don't await from the main request handler
  updateMemoryImpl(userId, question, answer, currentMemory, apiKey).catch(
    (err) => console.warn('[Memory] Background update failed:', err),
  );
}

async function updateMemoryImpl(
  userId: string,
  question: string,
  answer: string,
  currentMemory: StudentMemory,
  apiKey?: string,
): Promise<void> {
  const newMemory: StudentMemory = {
    ...currentMemory,
    interactionCount: currentMemory.interactionCount + 1,
    updatedAt: new Date().toISOString(),
  };

  // Detect language preference from question
  const hindiChars = (question.match(/[\u0900-\u097F]/g) ?? []).length;
  const gujaratiChars = (question.match(/[\u0A80-\u0AFF]/g) ?? []).length;
  if (hindiChars > 3) newMemory.preferredLanguage = 'hi';
  else if (gujaratiChars > 3) newMemory.preferredLanguage = 'gu';

  // Extract topic from question keywords
  const topic = extractTopic(question);
  if (topic && !currentMemory.pastTopics.includes(topic)) {
    newMemory.pastTopics = [...currentMemory.pastTopics.slice(-9), topic]; // keep last 10
  }

  // Extract issues from question/answer
  if (/geofence|location|gps/i.test(question + answer)) {
    const issue = 'geofence_failure';
    if (!newMemory.commonIssues.includes(issue)) {
      newMemory.commonIssues = [...newMemory.commonIssues, issue];
    }
    if (/resolved|fixed|working/i.test(answer)) {
      newMemory.resolvedIssues = [...newMemory.resolvedIssues, issue];
      newMemory.unresolvedIssues = newMemory.unresolvedIssues.filter(i => i !== issue);
    } else {
      if (!newMemory.unresolvedIssues.includes(issue)) {
        newMemory.unresolvedIssues = [...newMemory.unresolvedIssues, issue];
      }
    }
  }

  // Every 5 interactions OR on first, summarise with AI
  if (apiKey && (newMemory.interactionCount % 5 === 0 || !currentMemory.summary)) {
    try {
      newMemory.summary = await summariseMemory(newMemory, question, answer, apiKey);
    } catch {
      // Keep old summary on failure
    }
  } else if (!apiKey && !currentMemory.summary) {
    newMemory.summary = buildRuleBasedSummary(newMemory);
  }

  await persistMemory(newMemory);
}

function extractTopic(question: string): string | null {
  const topicPatterns: Array<[RegExp, string]> = [
    [/absent|missed|miss/i, 'absence_inquiry'],
    [/geofence|location|gps/i, 'geofence_help'],
    [/trust score|score/i, 'trust_score_inquiry'],
    [/manual override|appeal/i, 'manual_override_request'],
    [/percentage|rate|how many/i, 'attendance_rate_inquiry'],
    [/liveness|face|camera/i, 'liveness_help'],
    [/otp|code/i, 'otp_help'],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(question)) return topic;
  }
  return null;
}

function buildRuleBasedSummary(memory: StudentMemory): string {
  const parts: string[] = [];
  if (memory.commonIssues.length > 0) {
    parts.push(`Common issues: ${memory.commonIssues.join(', ')}.`);
  }
  if (memory.unresolvedIssues.length > 0) {
    parts.push(`Unresolved: ${memory.unresolvedIssues.join(', ')}.`);
  }
  if (memory.pastTopics.length > 0) {
    parts.push(`Topics discussed: ${memory.pastTopics.slice(-3).join(', ')}.`);
  }
  parts.push(`Preferred language: ${memory.preferredLanguage}. ${memory.interactionCount} total interactions.`);
  return parts.join(' ');
}

async function summariseMemory(
  memory: StudentMemory,
  latestQuestion: string,
  latestAnswer: string,
  apiKey: string,
): Promise<string> {
  const context = `
Previous summary: ${memory.summary || 'none'}
Common issues: ${memory.commonIssues.join(', ') || 'none'}
Unresolved issues: ${memory.unresolvedIssues.join(', ') || 'none'}
Past topics: ${memory.pastTopics.slice(-5).join(', ') || 'none'}
Latest Q: ${latestQuestion.slice(0, 200)}
Latest A: ${latestAnswer.slice(0, 200)}
`.trim();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Compress the student\'s attendance assistant history into 2-3 sentences. Focus on: recurring issues, unresolved problems, what they need help with. Max 100 words.',
        },
        { role: 'user', content: context },
      ],
      max_tokens: 150,
      temperature: 0,
    }),
      signal: typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function' ? (AbortSignal as any).timeout(5_000) : undefined,
  });

  if (!response.ok) throw new Error('Summary API call failed');
  const result = await response.json();
  return result.choices?.[0]?.message?.content?.trim() ?? memory.summary;
}

// ── Format for Prompt Injection ───────────────────────────────────

export function formatMemoryForPrompt(memory: StudentMemory): string {
  if (!memory.summary && memory.interactionCount === 0) return '';

  const parts: string[] = ['━━━ STUDENT MEMORY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];

  if (memory.summary) {
    parts.push(memory.summary);
  }

  if (memory.unresolvedIssues.length > 0) {
    parts.push(`⚠️ Unresolved issues: ${memory.unresolvedIssues.join(', ')}.`);
  }

  if (memory.preferredLanguage !== 'en') {
    const langNames: Record<string, string> = { hi: 'Hindi', gu: 'Gujarati' };
    parts.push(`Preferred language: ${langNames[memory.preferredLanguage] ?? memory.preferredLanguage}.`);
  }

  parts.push(`Interactions: ${memory.interactionCount}`);

  return parts.join('\n');
}
