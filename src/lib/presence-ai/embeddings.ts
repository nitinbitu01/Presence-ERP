// ─────────────────────────────────────────────────────────────────
// OpenAI embedding generation with batching + caching
// ─────────────────────────────────────────────────────────────────

import { AI_CONFIG } from './config';

const EMBEDDING_CACHE = new Map<string, number[]>();

export async function embedText(
  text: string,
  apiKey: string,
): Promise<number[]> {
  const cacheKey = text.slice(0, 100); // cache by first 100 chars
  if (EMBEDDING_CACHE.has(cacheKey)) {
    return EMBEDDING_CACHE.get(cacheKey)!;
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_CONFIG.models.embedding,
      input: text.slice(0, 8000), // token limit for embedding model
      encoding_format: 'float',
    }),
    signal: typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function' ? (AbortSignal as any).timeout(AI_CONFIG.embeddingTimeoutMs) : undefined,
  });

  if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);

  const result = await response.json();
  const embedding: number[] = result.data[0].embedding;

  EMBEDDING_CACHE.set(cacheKey, embedding);
  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
