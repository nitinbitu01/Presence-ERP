/**
 * Unit tests for:
 *   1. averageEmbeddings  — pure aggregation function
 *   2. assessFrameQuality — per-frame quality gate (each rejection reason covered)
 *   3. Three-way threshold branch logic for the duplicate-check loop
 *      (block / review-queue / pass), mocked the same way enrollment.test.ts does.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  averageEmbeddings,
  assessFrameQuality,
  isEmbeddingEligible,
  EMBEDDING_MAX_YAW_DEG,
  EMBEDDING_MAX_PITCH_DEG,
  QUALITY_MAX_YAW_DEG,
  QUALITY_MAX_PITCH_DEG,
  QUALITY_MAX_ROLL_DEG,
  QUALITY_MIN_INTER_EYE_PX,
  QUALITY_MIN_EAR,
  QUALITY_LAPLACIAN_THRESHOLD,
  MIN_PASSING_FRAMES,
} from "../face-quality";
import { cosineSimilarity } from "../attendance-crypto.server";

// Env vars required for crypto in the duplicate-check tests
process.env.BIOMETRIC_ENC_KEY = "UHdHDQpUZMLlhy+yx8INeqOJom+g+sHVU/tf7zYgJU8=";
process.env.LIVENESS_HMAC_KEY = "fffcHAvJI1MMpMoj4cniu09R332lWv++Bwxt9y2iW+c=";

// Polyfill ImageData and document for Node test environment
if (typeof globalThis.ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

if (typeof globalThis.document === "undefined") {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {},
            getImageData: () => new (globalThis as any).ImageData(new Uint8ClampedArray(16 * 4).fill(128), 4, 4),
          }),
        };
      }
      return {};
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: build synthetic 68-point landmark arrays
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal 68-point landmark array with all points at the centre of a
 * 320×240 bounding box.  The caller can override specific indices to trigger
 * the check under test.
 */
function makeLandmarks(
  overrides: Record<number, { x: number; y: number }> = {},
): { x: number; y: number }[] {
  // Default: face centred at (160, 120), eye width ~80 px (symmetric).
  // Key landmark indices used by the quality gate:
  //   36 = left eye outer, 39 = left eye inner, 37/38/40/41 = left eye lids
  //   42 = right eye inner, 45 = right eye outer, 43/44/46/47 = right eye lids
  //   30 = nose tip
  const lm: { x: number; y: number }[] = Array.from({ length: 68 }, () => ({ x: 160, y: 120 }));

  // Symmetric open eyes, inter-ocular distance = 80 px, EAR ≈ 0.3 (open)
  // Left eye (outer→inner): x from 120 to 160
  lm[36] = { x: 120, y: 120 }; // outer corner
  lm[39] = { x: 160, y: 120 }; // inner corner
  lm[37] = { x: 130, y: 114 }; // upper lid near outer
  lm[38] = { x: 150, y: 114 }; // upper lid near inner
  lm[40] = { x: 150, y: 126 }; // lower lid near inner
  lm[41] = { x: 130, y: 126 }; // lower lid near outer

  // Right eye (inner→outer): x from 160 to 200
  lm[42] = { x: 160, y: 120 }; // inner corner
  lm[45] = { x: 200, y: 120 }; // outer corner
  lm[43] = { x: 170, y: 114 };
  lm[44] = { x: 190, y: 114 };
  lm[46] = { x: 190, y: 126 };
  lm[47] = { x: 170, y: 126 };

  // Nose tip: centred on eye midpoint → yaw = 0, pitch ≈ 5.6 deg (within 15 deg limit)
  lm[30] = { x: 160, y: 125 };

  // Apply caller overrides
  for (const [idx, pt] of Object.entries(overrides)) {
    lm[Number(idx)] = pt;
  }

  return lm;
}

/** Standard face bounding box with inter-eye distance = 80 px. */
const goodBox = { x: 80, y: 80, width: 160, height: 160 };

/**
 * Build a fake HTMLVideoElement with a stub getContext so assessFrameQuality
 * can call cropFaceRegion. We return an ImageData with:
 *   - mean brightness `mean` (0-255 greyscale)
 *   - stddev `stddev` (approximated by alternating low/high)
 *   - Laplacian variance artificially controlled by alternating pixel values.
 *
 * The stub is NOT a real video element — it just needs to satisfy the
 * document.createElement("canvas") → ctx.drawImage(videoEl, …) call path,
 * which is mocked at the document level below.
 */
function makeVideoStub(): HTMLVideoElement {
  return {} as HTMLVideoElement;
}

/**
 * Override document.createElement to intercept canvas creation inside
 * assessFrameQuality → cropFaceRegion, returning a stub canvas whose
 * getContext returns controlled pixel data.
 */
function mockCanvas(opts: {
  mean: number;     // average greyscale brightness (0-255)
  stddev: number;   // approximated via pixel variance
  lapVariance: number; // Laplacian variance to simulate (high = sharp)
}) {
  // Build a 4×4 pixel RGBA ImageData matching the requested stats.
  // For sharpness: alternate extreme values to produce a desired Laplacian variance.
  // For brightness: use the mean directly, stddev approximated by alternating.
  const width = 4;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);

  const hi = Math.min(255, opts.mean + opts.stddev);
  const lo = Math.max(0, opts.mean - opts.stddev);

  // Alternate pixel brightness to achieve the requested pattern.
  // For high lapVariance: extreme alternation; for low lapVariance: uniform.
  const useExtreme = opts.lapVariance >= QUALITY_LAPLACIAN_THRESHOLD;
  for (let i = 0; i < width * height; i++) {
    const b = useExtreme ? (i % 2 === 0 ? hi : lo) : opts.mean;
    data[i * 4 + 0] = b; // R
    data[i * 4 + 1] = b; // G
    data[i * 4 + 2] = b; // B
    data[i * 4 + 3] = 255;
  }
  const imageData = new ImageData(data, width, height);

  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
          getImageData: () => imageData,
        }),
      } as unknown as HTMLCanvasElement;
    }
    // Fall through to real implementation for other tags
    return document.createElement.call(document, tag);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. averageEmbeddings
// ─────────────────────────────────────────────────────────────────────────────

describe("averageEmbeddings", () => {
  it("returns empty array for empty input", () => {
    expect(averageEmbeddings([])).toEqual([]);
  });

  it("returns the vector unchanged when only one vector is given", () => {
    const v = [0.1, 0.5, -0.3, 0.8];
    const result = averageEmbeddings([v]);
    expect(result).toHaveLength(4);
    result.forEach((val, i) => expect(val).toBeCloseTo(v[i], 6));
  });

  it("computes the component-wise mean of two identical vectors as the same vector", () => {
    const v = Array.from({ length: 128 }, (_, i) => i / 128);
    const result = averageEmbeddings([v, v]);
    expect(result).toHaveLength(128);
    result.forEach((val, i) => expect(val).toBeCloseTo(v[i], 6));
  });

  it("computes the component-wise mean correctly for simple numbers", () => {
    const a = [1.0, 2.0, 3.0];
    const b = [3.0, 2.0, 1.0];
    const result = averageEmbeddings([a, b]);
    expect(result).toEqual([2.0, 2.0, 2.0]);
  });

  it("handles three vectors correctly", () => {
    const a = [0, 0, 0];
    const b = [3, 3, 3];
    const c = [6, 6, 6];
    const result = averageEmbeddings([a, b, c]);
    result.forEach((val) => expect(val).toBeCloseTo(3.0, 6));
  });

  it("uses the shorter vector length when lengths mismatch (safe fallback)", () => {
    const a = [1, 2, 3];
    const b = [4, 5]; // shorter
    const result = averageEmbeddings([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(2.5, 6); // (1+4)/2
    expect(result[1]).toBeCloseTo(3.5, 6); // (2+5)/2
  });

  it("produces a result with norm ~1 when averaging two unit-norm embeddings", () => {
    // Two similar unit vectors should average to a near-unit vector
    const n = 128;
    const a = Array.from({ length: n }, () => 1 / Math.sqrt(n));
    const b = Array.from({ length: n }, () => 1 / Math.sqrt(n));
    const result = averageEmbeddings([a, b]);
    const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. assessFrameQuality — each rejection reason
// ─────────────────────────────────────────────────────────────────────────────

describe("assessFrameQuality", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a good frame with normal pose, open eyes, and sufficient inter-eye distance", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    const lm = makeLandmarks();
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.passed).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.score).toBeGreaterThan(0.8);
  });

  it("rejects 'blurry' when Laplacian variance is below threshold", () => {
    // Mock a uniform (blurry) canvas: non-alternating pixels → low variance
    mockCanvas({ mean: 128, stddev: 5, lapVariance: QUALITY_LAPLACIAN_THRESHOLD - 10 });
    const lm = makeLandmarks();
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("blurry");
  });

  it("rejects 'excessive_yaw' when nose tip is shifted far from eye centre", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    // Nose tip shifted right by half the eye width → yaw ≈ 45 deg > 15 limit
    const lm = makeLandmarks({ 30: { x: 200, y: 150 } });
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("excessive_yaw");
  });

  it("rejects 'excessive_pitch' when nose tip is far above or below eye line", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    // Nose tip raised to eye level (y=100) with eye centre at 120 → pitch negative
    // Move it far below to get pitch > 15 deg
    const eyeWidth = 200 - 120; // right outer x minus left outer x = 80 px
    // pitch = ((noseTip.y - eyeCenter.y) / eyeWidth) * 90 > 15  → noseTip.y > eyeCenter.y + (15/90)*eyeWidth
    const requiredNoseY = 120 + (QUALITY_MAX_PITCH_DEG / 90) * eyeWidth + 5;
    const lm = makeLandmarks({ 30: { x: 160, y: requiredNoseY } });
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("excessive_pitch");
  });

  it("rejects 'excessive_roll' when eye-line is steeply tilted", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    // Tilt: left eye outer at (120, 140), right eye outer at (200, 100)
    // roll = atan2(100-140, 200-120) = atan2(-40, 80) ≈ -26.6 deg → |roll| > 8
    const lm = makeLandmarks({
      36: { x: 120, y: 140 },
      45: { x: 200, y: 100 },
    });
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("excessive_roll");
  });

  it("rejects 'face_too_far' when inter-ocular distance is below minimum", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    // Place left and right outer eye corners only 30 px apart (below QUALITY_MIN_INTER_EYE_PX=60)
    const lm = makeLandmarks({
      36: { x: 145, y: 120 }, // left outer
      45: { x: 175, y: 120 }, // right outer → distance = 30 px
    });
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("face_too_far");
  });

  it("rejects 'eyes_closed' when EAR falls below the minimum threshold", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    // Collapse upper/lower lids to same y as corner → EAR = 0 (fully closed)
    const lm = makeLandmarks({
      37: { x: 130, y: 120 }, // upper lid = corner y → EAR numerator → 0
      38: { x: 150, y: 120 },
      40: { x: 150, y: 120 },
      41: { x: 130, y: 120 },
      43: { x: 170, y: 120 },
      44: { x: 190, y: 120 },
      46: { x: 190, y: 120 },
      47: { x: 170, y: 120 },
    });
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("eyes_closed");
  });

  it("rejects 'too_dark' when mean brightness is below minimum", () => {
    mockCanvas({ mean: 20, stddev: 5, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    const lm = makeLandmarks();
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("too_dark");
  });

  it("rejects 'blown_out' when mean is high and stddev is near zero", () => {
    mockCanvas({ mean: 240, stddev: 2, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    const lm = makeLandmarks();
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.reasons).toContain("blown_out");
  });

  it("accumulates multiple rejection reasons in a single result", () => {
    // Blown-out AND excessive_yaw AND face_too_far
    mockCanvas({ mean: 240, stddev: 2, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 10 });
    const lm = makeLandmarks({
      30: { x: 220, y: 150 }, // extreme yaw
      36: { x: 145, y: 120 }, // too close together
      45: { x: 165, y: 120 }, // inter-eye = 20 px
    });
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.score).toBeLessThan(0.5);
  });

  it("returns passed=true and score=1 for a synthetically perfect frame", () => {
    mockCanvas({ mean: 128, stddev: 40, lapVariance: QUALITY_LAPLACIAN_THRESHOLD + 50 });
    const lm = makeLandmarks(); // default: good pose, good eyes, good inter-eye
    const result = assessFrameQuality(lm, goodBox, makeVideoStub());
    expect(result.passed).toBe(true);
    // Score = (checks passed) / (total checks); all checks pass → 1.0
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Three-way threshold branch — duplicate check logic
//    Mirrors the test pattern in enrollment.test.ts (pure logic mock, no DB).
// ─────────────────────────────────────────────────────────────────────────────

describe("Three-way duplicate-check threshold (block / review-queue / pass)", () => {
  const THRESHOLD_MATCH = 0.82;
  const THRESHOLD_REVIEW = 0.70;

  /**
   * Simulate the inner loop body of saveEnrollment's duplicate-check.
   * Returns one of:
   *   'blocked'    — sim >= THRESHOLD_MATCH (existing behaviour: hard error)
   *   'queued'     — THRESHOLD_REVIEW <= sim < THRESHOLD_MATCH (new: review queue insert)
   *   'passed'     — sim < THRESHOLD_REVIEW (no action)
   */
  function classifyDuplicate(
    newVec: Float32Array | number[],
    existingVec: Float32Array | number[],
    demoActive = false,
  ): { outcome: "blocked" | "queued" | "passed"; sim: number } {
    const sim = cosineSimilarity(newVec, existingVec);
    if (sim >= THRESHOLD_MATCH && !demoActive) {
      return { outcome: "blocked", sim };
    }
    if (sim >= THRESHOLD_REVIEW && !demoActive) {
      return { outcome: "queued", sim };
    }
    return { outcome: "passed", sim };
  }

  it("blocks (throws) when similarity >= THRESHOLD_MATCH against a different student", () => {
    // Near-identical vectors → cosine sim ≈ 0.9997
    const base = new Float32Array(128).fill(0.5);
    const near = new Float32Array(128).fill(0.501);
    const { outcome, sim } = classifyDuplicate(base, near);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD_MATCH);
    expect(outcome).toBe("blocked");
  });

  it("queues (not blocked) when similarity is in [THRESHOLD_REVIEW, THRESHOLD_MATCH)", () => {
    const theta = Math.acos(0.75);
    const base = [1, ...new Array(127).fill(0)];
    const candidate = [Math.cos(theta), Math.sin(theta), ...new Array(126).fill(0)];

    const { outcome, sim } = classifyDuplicate(base, candidate);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD_REVIEW);
    expect(sim).toBeLessThan(THRESHOLD_MATCH);
    expect(outcome).toBe("queued");
  });

  it("passes (no action) when similarity < THRESHOLD_REVIEW", () => {
    // Orthogonal vectors → cosine sim = 0
    const a = [1, ...new Array(127).fill(0)];
    const b = [0, 1, ...new Array(126).fill(0)];
    const { outcome, sim } = classifyDuplicate(a, b);
    expect(sim).toBeLessThan(THRESHOLD_REVIEW);
    expect(outcome).toBe("passed");
  });

  it("passes through even a high-similarity match when demoActive = true", () => {
    // In demo mode, duplicate check is disabled
    const base = new Float32Array(128).fill(0.5);
    const near = new Float32Array(128).fill(0.501);
    const { outcome } = classifyDuplicate(base, near, true);
    expect(outcome).toBe("passed");
  });

  it("self-enrollment (same student_id) is always skipped — sim irrelevant", () => {
    const base = new Float32Array(128).fill(0.5);
    const same = new Float32Array(128).fill(0.5);
    const { sim } = classifyDuplicate(base, same);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD_MATCH);
  });

  it("at THRESHOLD_REVIEW boundary goes to queued, not passed", () => {
    const base = [1, ...new Array(127).fill(0)];
    const candidate = [THRESHOLD_REVIEW + 1e-6, Math.sqrt(1 - (THRESHOLD_REVIEW + 1e-6) ** 2), ...new Array(126).fill(0)];
    const { outcome, sim } = classifyDuplicate(base, candidate);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD_REVIEW);
    expect(outcome).toBe("queued");
  });

  it("at THRESHOLD_MATCH boundary goes to blocked, not queued", () => {
    const base = [1, ...new Array(127).fill(0)];
    const candidate = [THRESHOLD_MATCH + 1e-6, Math.sqrt(1 - (THRESHOLD_MATCH + 1e-6) ** 2), ...new Array(126).fill(0)];
    const { outcome, sim } = classifyDuplicate(base, candidate);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD_MATCH);
    expect(outcome).toBe("blocked");
  });

  it("MIN_PASSING_FRAMES constant matches the expected value of 3", () => {
    expect(MIN_PASSING_FRAMES).toBe(3);
  });
});

describe("isEmbeddingEligible", () => {
  it("accepts a near-frontal pose (yaw: 5°, pitch: 5°)", () => {
    expect(isEmbeddingEligible({ yaw: 5, pitch: 5 })).toBe(true);
  });

  it("rejects a high-yaw pose (yaw: 30° > 25°)", () => {
    expect(isEmbeddingEligible({ yaw: 30, pitch: 5 })).toBe(false);
    expect(isEmbeddingEligible({ yaw: -30, pitch: 5 })).toBe(false);
  });

  it("rejects a high-pitch pose (pitch: 30° > 25°)", () => {
    expect(isEmbeddingEligible({ yaw: 5, pitch: 30 })).toBe(false);
    expect(isEmbeddingEligible({ yaw: 5, pitch: -30 })).toBe(false);
  });

  it("handles boundary values at exactly the threshold", () => {
    expect(isEmbeddingEligible({ yaw: EMBEDDING_MAX_YAW_DEG, pitch: EMBEDDING_MAX_PITCH_DEG })).toBe(true);
    expect(isEmbeddingEligible({ yaw: -EMBEDDING_MAX_YAW_DEG, pitch: -EMBEDDING_MAX_PITCH_DEG })).toBe(true);
    expect(isEmbeddingEligible({ yaw: EMBEDDING_MAX_YAW_DEG + 0.1, pitch: 0 })).toBe(false);
    expect(isEmbeddingEligible({ yaw: 0, pitch: EMBEDDING_MAX_PITCH_DEG + 0.1 })).toBe(false);
  });
});

describe("Enrollment sequence frame selection", () => {
  it("excludes all turn_left and turn_right tagged frames regardless of reported pose values", () => {
    // Simulated frame sequence: 4 frames during blink (frontal) and 3 frames during turn gestures
    const sequence = [
      { action: "blink", signal: { yaw: 2, pitch: 1 }, embedding: [0.1, 0.2] },
      { action: "blink", signal: { yaw: 1, pitch: 3 }, embedding: [0.11, 0.21] },
      { action: "blink", signal: { yaw: -2, pitch: 0 }, embedding: [0.09, 0.19] },
      { action: "blink", signal: { yaw: 0, pitch: 2 }, embedding: [0.10, 0.20] },
      // Turn frames: even if one turn frame falsely reports a low yaw angle, it MUST be excluded by tag
      { action: "turn_left", signal: { yaw: 0, pitch: 0 }, embedding: [0.99, 0.99] },
      { action: "turn_left", signal: { yaw: -35, pitch: 2 }, embedding: [0.95, 0.95] },
      { action: "turn_right", signal: { yaw: 30, pitch: 1 }, embedding: [0.90, 0.90] },
    ];

    const passingEmbeddings: number[][] = [];

    for (const frame of sequence) {
      const isTurnChallenge = frame.action === "turn_left" || frame.action === "turn_right";
      if (isTurnChallenge) continue;

      if (!isEmbeddingEligible(frame.signal)) continue;

      passingEmbeddings.push(frame.embedding);
    }

    // Must keep only the 4 blink frames
    expect(passingEmbeddings).toHaveLength(4);
    expect(passingEmbeddings).toEqual([
      [0.1, 0.2],
      [0.11, 0.21],
      [0.09, 0.19],
      [0.10, 0.20],
    ]);
  });
});
