// ─────────────────────────────────────────────────────────────────
// Accurate token counting using tiktoken WASM
// Falls back to char-based estimate if tiktoken unavailable
// Handles Hindi/Gujarati/Arabic scripts correctly
// ─────────────────────────────────────────────────────────────────

import type { ChatMessage } from './types';

let encoder: { encode: (text: string) => Uint32Array } | null = null;

async function getEncoder() {
  if (encoder) return encoder;
  try {
    // tiktoken for edge/node
    const { Tiktoken } = await import('js-tiktoken');
    const { cl100k_base } = await import('js-tiktoken/ranks/cl100k_base');
    encoder = new Tiktoken(
      cl100k_base.bpe_ranks,
      cl100k_base.special_tokens,
      cl100k_base.pat_str,
    );
    return encoder;
  } catch {
    return null;
  }
}

export async function countTokens(text: string): Promise<number> {
  const enc = await getEncoder();
  if (enc) return enc.encode(text).length;

  // Fallback: segment-aware estimation
  // CJK/Devanagari chars are ~2-3 tokens each
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x0900 && code <= 0x097f) || // Devanagari (Hindi)
      (code >= 0x0a80 && code <= 0x0aff) || // Gujarati
      (code >= 0x4e00 && code <= 0x9fff) || // CJK
      (code >= 0x0600 && code <= 0x06ff)    // Arabic
    ) {
      count += 2.5;
    } else {
      count += 0.25; // ASCII: ~4 chars per token
    }
  }
  return Math.ceil(count);
}

export async function trimToContextWindow(
  systemPrompt: string,
  history: ChatMessage[],
  newQuestion: string,
  model: string,
  reserveTokens = 1000,
): Promise<ChatMessage[]> {
  const contextLimits: Record<string, number> = {
    'gpt-4o-mini': 128_000,
    'gpt-4o': 128_000,
    'gpt-3.5-turbo': 16_385,
  };

  const limit = contextLimits[model] ?? 16_000;
  const budget = limit - reserveTokens;

  const [systemTokens, questionTokens] = await Promise.all([
    countTokens(systemPrompt),
    countTokens(newQuestion),
  ]);

  let remaining = budget - systemTokens - questionTokens;
  const kept: ChatMessage[] = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = (await countTokens(history[i].content)) + 4;
    if (remaining - msgTokens < 50) break; // 50-token safety buffer
    remaining -= msgTokens;
    kept.unshift(history[i]);
  }

  return kept;
}
