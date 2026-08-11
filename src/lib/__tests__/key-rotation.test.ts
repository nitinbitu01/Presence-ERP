/**
 * Tests for Phase 2 item 3 (hardening work order): key rotation support.
 * Pure crypto -- no Supabase/network involved, so no fetch stubbing needed here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encryptEmbedding,
  decryptEmbedding,
  issueChallenge,
  verifyChallenge,
} from "../attendance-crypto.server";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("BIOMETRIC_ENC_KEY versioning", () => {
  it("legacy mode (no CURRENT_VERSION set): round-trips exactly as before", async () => {
    vi.stubEnv("BIOMETRIC_ENC_KEY", "legacy-secret-key-material");
    const vec = [0.1, -0.2, 0.3, 0.4];
    const ct = await encryptEmbedding(vec);
    // Unversioned layout: 12-byte IV + ciphertext, no marker byte prepended.
    expect(ct[0]).not.toBe(0x01);
    const pt = await decryptEmbedding(ct);
    expect(Array.from(pt).map((n) => Math.fround(n))).toEqual(vec.map((n) => Math.fround(n)));
  });

  it("versioned mode: round-trips under the current version", async () => {
    vi.stubEnv("BIOMETRIC_ENC_KEY_CURRENT_VERSION", "1");
    vi.stubEnv("BIOMETRIC_ENC_KEY_V1", "versioned-secret-v1");
    const vec = [1, 2, 3];
    const ct = await encryptEmbedding(vec);
    expect(ct[0]).toBe(0x01); // version marker present
    expect(ct[1]).toBe(1); // key version 1
    const pt = await decryptEmbedding(ct);
    expect(Array.from(pt)).toEqual(vec.map((n) => Math.fround(n)));
  });

  it("rotation: data encrypted under V1 still decrypts after CURRENT_VERSION moves to V2", async () => {
    // Encrypt under V1.
    vi.stubEnv("BIOMETRIC_ENC_KEY_CURRENT_VERSION", "1");
    vi.stubEnv("BIOMETRIC_ENC_KEY_V1", "secret-v1");
    vi.stubEnv("BIOMETRIC_ENC_KEY_V2", "secret-v2-different");
    const vec = [5, 6, 7];
    const oldCiphertext = await encryptEmbedding(vec);
    expect(oldCiphertext[1]).toBe(1);

    // Rotate: new encryptions now use V2.
    vi.stubEnv("BIOMETRIC_ENC_KEY_CURRENT_VERSION", "2");
    const newCiphertext = await encryptEmbedding(vec);
    expect(newCiphertext[1]).toBe(2);

    // Both remain decryptable, since V1 key material is still configured.
    expect(Array.from(await decryptEmbedding(oldCiphertext))).toEqual(
      vec.map((n) => Math.fround(n)),
    );
    expect(Array.from(await decryptEmbedding(newCiphertext))).toEqual(
      vec.map((n) => Math.fround(n)),
    );
  });

  it("legacy (pre-rotation) ciphertext still decrypts after switching to versioned mode", async () => {
    // Data encrypted before this institution ever adopted key versioning.
    vi.stubEnv("BIOMETRIC_ENC_KEY", "original-unversioned-secret");
    const vec = [9, 9, 9];
    const legacyCiphertext = await encryptEmbedding(vec);
    expect(legacyCiphertext[0]).not.toBe(0x01);

    // Institution now adopts versioning for new data, but keeps the original
    // BIOMETRIC_ENC_KEY around (version 0) so old rows keep working.
    vi.stubEnv("BIOMETRIC_ENC_KEY_CURRENT_VERSION", "1");
    vi.stubEnv("BIOMETRIC_ENC_KEY_V1", "new-secret-v1");

    expect(Array.from(await decryptEmbedding(legacyCiphertext))).toEqual(
      vec.map((n) => Math.fround(n)),
    );
  });

  it("fails closed (throws) rather than silently returning wrong data for a bad key", async () => {
    vi.stubEnv("BIOMETRIC_ENC_KEY_CURRENT_VERSION", "1");
    vi.stubEnv("BIOMETRIC_ENC_KEY_V1", "correct-key");
    const ct = await encryptEmbedding([1, 2, 3]);

    vi.stubEnv("BIOMETRIC_ENC_KEY_V1", "wrong-key");
    await expect(decryptEmbedding(ct)).rejects.toThrow();
  });
});

describe("LIVENESS_HMAC_KEY rotation grace window", () => {
  it("round-trips normally with only the current key configured", async () => {
    vi.stubEnv("LIVENESS_HMAC_KEY", "current-secret");
    const c = await issueChallenge("session-1", "user-1");
    expect(await verifyChallenge(c)).toBe(true);
  });

  it("a challenge signed under the old key still verifies during the grace window", async () => {
    // Issue under what will become the "old" key.
    vi.stubEnv("LIVENESS_HMAC_KEY", "old-secret");
    const oldChallenge = await issueChallenge("session-1", "user-1");

    // Rotate: LIVENESS_HMAC_KEY is now the new key, but the old one is kept
    // around as LIVENESS_HMAC_KEY_PREVIOUS during the grace window.
    vi.stubEnv("LIVENESS_HMAC_KEY", "new-secret");
    vi.stubEnv("LIVENESS_HMAC_KEY_PREVIOUS", "old-secret");

    expect(await verifyChallenge(oldChallenge)).toBe(true);

    // New challenges sign with the current (new) key only.
    const newChallenge = await issueChallenge("session-1", "user-1");
    expect(await verifyChallenge(newChallenge)).toBe(true);
  });

  it("stops verifying once the grace window ends (LIVENESS_HMAC_KEY_PREVIOUS removed)", async () => {
    vi.stubEnv("LIVENESS_HMAC_KEY", "old-secret");
    const oldChallenge = await issueChallenge("session-1", "user-1");

    vi.stubEnv("LIVENESS_HMAC_KEY", "new-secret");
    // No LIVENESS_HMAC_KEY_PREVIOUS this time -- rotation complete.
    expect(await verifyChallenge(oldChallenge)).toBe(false);
  });
});
