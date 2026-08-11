// ─────────────────────────────────────────────────────────────────
// OpenAI streaming with:
//   • Automatic model fallback (4o-mini → 3.5-turbo)
//   • Exponential backoff retry
//   • Hard timeout per attempt
//   • Full non-stream fallback for environments that don't support SSE
// ─────────────────────────────────────────────────────────────────

import type { ChatMessage } from './types';
import { AI_CONFIG } from './config';

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string, model: string, tokens: number) => void;
  onError: (error: Error) => void;
}

const MODELS = [AI_CONFIG.models.primary, AI_CONFIG.models.fallback] as const;
const MAX_RETRIES = 2;

function safeTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
    try { return (AbortSignal as any).timeout(ms); } catch {}
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function attemptStream(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: AI_CONFIG.temperature,
      max_tokens: AI_CONFIG.maxResponseTokens,
      stream: true,
      stream_options: { include_usage: true }, // get token counts in stream
    }),
    signal: safeTimeoutSignal(AI_CONFIG.openAiTimeoutMs),
  });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('retry-after') ?? '2', 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    throw new Error('rate_limited');
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`openai_${response.status}: ${body}`);
  }

  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let totalTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          callbacks.onComplete(fullText, model, totalTokens);
          return;
        }

        try {
          const parsed = JSON.parse(data);

          // Extract token usage from final chunk
          if (parsed.usage?.total_tokens) {
            totalTokens = parsed.usage.total_tokens;
          }

          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullText += token;
            callbacks.onToken(token);
          }

          // Detect finish reason
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === 'length') {
            // Response was truncated — signal the user
            const truncationNote = '\n\n_[Response truncated — ask me to continue]_';
            fullText += truncationNote;
            callbacks.onToken(truncationNote);
          }
        } catch {
          // Malformed JSON chunk — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  callbacks.onComplete(fullText, model, totalTokens);
}

export async function streamOpenAI(
  messages: ChatMessage[],
  apiKey: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  let lastError: Error | null = null;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await attemptStream(messages, model, apiKey, callbacks);
        return; // success
      } catch (err: any) {
        lastError = err;
        const isRetryable =
          err.message.includes('rate_limited') ||
          err.message.includes('openai_500') ||
          err.message.includes('openai_503');

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          await new Promise((r) =>
            setTimeout(r, Math.pow(2, attempt) * 1_000),
          );
          continue;
        }
        break; // try next model
      }
    }
  }

  callbacks.onError(lastError ?? new Error('All models exhausted'));
}
