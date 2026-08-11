/**
 * Performance regression guard for saveEnrollment's duplicate-identity check.
 *
 * Context: a prior review flagged this O(N) decrypt+compare loop as "won't scale past ~300
 * students" and suggested a pgvector index. Neither held up under an actual benchmark:
 *  - pgvector needs plaintext floats; face_embeddings.ciphertext is AES-GCM encrypted at rest
 *    on purpose, so a vector index would mean storing biometric data unencrypted -- a security
 *    regression, not a scaling fix. Not applicable here.
 *  - The real cost, benchmarked against this file's actual crypto functions with N=1000
 *    synthetic embeddings, is ~150ms of CPU-bound work (AES-GCM decrypt dominates; JS-level
 *    parallelization was also benchmarked and gave ~0% speedup, since this isn't overhead that
 *    concurrency can hide).
 *
 * This test locks in a generous ceiling so a future change (e.g. switching decrypt
 * implementations, adding per-row overhead) can't silently regress this without CI noticing.
 * The real deployment constraint isn't this number -- it's that Cloudflare Workers' FREE plan
 * caps CPU time at 10ms/request, which this gate alone exceeds well before N=100; see the
 * comment in attendance.functions.ts's saveEnrollment for the full reasoning. That's a hosting
 * plan requirement (Workers Paid, $5/month minimum), not something fixable in this loop.
 */

import { describe, it, expect } from "vitest";

process.env.BIOMETRIC_ENC_KEY = "0".repeat(64); // 32-byte hex key, test-only

import { encryptEmbedding, decryptEmbedding, cosineSimilarity } from "../attendance-crypto.server";

function randomEmbedding(): number[] {
  return Array.from({ length: 128 }, () => Math.random() * 2 - 1);
}

describe("duplicate-check decrypt+compare performance", () => {
  it("processes 1000 candidate embeddings well within the Workers Paid plan's CPU budget", async () => {
    const N = 1000;
    const plain: number[][] = Array.from({ length: N }, randomEmbedding);
    const encrypted = await Promise.all(plain.map((v) => encryptEmbedding(v)));
    const newVec = new Float32Array(randomEmbedding());

    const start = performance.now();
    for (const ct of encrypted) {
      const vec = await decryptEmbedding(ct);
      cosineSimilarity(newVec, vec);
    }
    const elapsedMs = performance.now() - start;

    // Generous ceiling (real measured value is ~150ms in this environment) -- this is a
    // regression guard, not a tight performance budget. Cloudflare Workers Paid plan allows
    // 30,000ms of CPU time by default, so even 10x this ceiling would still be safe there;
    // the point is catching an accidental 50-100x regression, not chasing milliseconds.
    expect(elapsedMs).toBeLessThan(3000);
  });
});
