// Client-safe face quality gate for enrollment frame selection.
// No server imports — this file runs entirely in the browser alongside face-api.js.
//
// Usage:
//   import { assessFrameQuality, averageEmbeddings } from "@/lib/face-quality";
//
// Every exported constant is intentionally named so callers can override them in
// tests without monkey-patching (pass synthetics that satisfy / violate each check).

// ── Tunable thresholds ──────────────────────────────────────────────────────

/** Laplacian variance below this → frame too blurry. Start conservative. */
export const QUALITY_LAPLACIAN_THRESHOLD = 60;

/**
 * Minimum inter-ocular distance (pixels, left-eye-outer to right-eye-outer).
 * Below this the face is too small / too far from the camera to produce a
 * reliable 128-d descriptor from TinyFaceDetector's 160px input grid.
 */
export const QUALITY_MIN_INTER_EYE_PX = 60;

/** Maximum |yaw| in degrees before the pose is considered off-axis. */
export const QUALITY_MAX_YAW_DEG = 15;

/** Maximum |pitch| in degrees before the pose is considered off-axis. */
export const QUALITY_MAX_PITCH_DEG = 15;

/**
 * Maximum |roll| in degrees before the head tilt is too extreme.
 * Roll is approximated from the angle of the eye-line (left-outer to right-outer
 * eye landmark) relative to the image horizontal.
 */
export const QUALITY_MAX_ROLL_DEG = 8;

/** Mean pixel brightness (0–255) below which the frame is too dark. */
export const QUALITY_MIN_BRIGHTNESS = 40;

/**
 * Mean pixel brightness above which the frame may be over-exposed.
 * Combined with stddev check: if mean > this AND stddev < QUALITY_MIN_BRIGHTNESS_STDDEV
 * the face is considered "blown out".
 */
export const QUALITY_MAX_BRIGHTNESS = 230;

/**
 * If the mean brightness is high but stddev is below this, the face region
 * is considered uniformly saturated (blown out / harsh direct light).
 */
export const QUALITY_MIN_BRIGHTNESS_STDDEV = 15;

/**
 * EAR (Eye Aspect Ratio) below this → eyes are likely closed (blink artifact
 * or severe occlusion). Distinct from the liveness blink check — here we want
 * to *reject* frames where eyes are shut, so the stored descriptor is from an
 * open-eye pose.
 */
export const QUALITY_MIN_EAR = 0.15;

/**
 * Minimum number of quality-passing frames required for enrollment to proceed.
 * If fewer frames pass, the student is asked to retry in better conditions.
 */
export const MIN_PASSING_FRAMES = 3;

/** Maximum |yaw| in degrees for a frame to be eligible as an identity template embedding. */
export const EMBEDDING_MAX_YAW_DEG = 20;

/** Maximum |pitch| in degrees for a frame to be eligible as an identity template embedding. */
export const EMBEDDING_MAX_PITCH_DEG = 20;

/**
 * Check if a pose is sufficiently near-frontal to be eligible for inclusion
 * in the identity template embedding.
 *
 * Face embedding models (including face-api.js FaceRecognitionNet) degrade in accuracy
 * when fed off-angle faces (>20° yaw/pitch). Turn gestures are used ONLY for liveness proof.
 */
export function isEmbeddingEligible(pose: { yaw: number; pitch: number; roll?: number }): boolean {
  if (!pose) return false;
  return (
    Math.abs(pose.yaw) <= EMBEDDING_MAX_YAW_DEG &&
    Math.abs(pose.pitch) <= EMBEDDING_MAX_PITCH_DEG
  );
}

// ── Reason codes → human-readable UI messages ───────────────────────────────

export const QUALITY_REASON_MESSAGES: Record<string, string> = {
  blurry: "Camera image is too blurry — hold still and ensure lens is clean.",
  excessive_yaw: "Look straight ahead — your head is turned too far left or right.",
  excessive_pitch: "Level your head — you are tilting up or down too much.",
  excessive_roll: "Keep your head upright — tilt is too extreme.",
  off_angle_pose: "Head is turned too far (>20°) for identity template — look directly at camera.",
  face_too_far: "Move closer to the camera so your face fills more of the frame.",
  eyes_closed: "Please keep your eyes open during capture.",
  too_dark: "Lighting is too dim — move to a brighter area or turn on more lights.",
  blown_out: "Lighting is too harsh or you are facing a bright light source — try facing a window or softer light.",
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface FrameQualityResult {
  /** Whether this frame passes all quality checks. */
  passed: boolean;
  /** Composite score 0–1 (higher = better). Informational only. */
  score: number;
  /** Machine-readable reason codes for each failing check (empty if passed). */
  reasons: string[];
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Euclidean distance between two 2-D points. */
function dist2d(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Compute EAR (Eye Aspect Ratio) from the 68-point landmark array.
 * Mirrors the logic already in attendance-crypto.server.ts → computeEAR()
 * but kept here so this module has zero server imports.
 *
 * Left eye indices : 36-41   Right eye indices : 42-47
 */
function computeEAR(landmarks: { x: number; y: number }[]): number {
  if (!landmarks || landmarks.length < 48) return 0.3; // assume open
  const l1 = dist2d(landmarks[37], landmarks[41]);
  const l2 = dist2d(landmarks[38], landmarks[40]);
  const l3 = dist2d(landmarks[36], landmarks[39]);
  const leftEar = l3 === 0 ? 0.3 : (l1 + l2) / (2 * l3);

  const r1 = dist2d(landmarks[43], landmarks[47]);
  const r2 = dist2d(landmarks[44], landmarks[46]);
  const r3 = dist2d(landmarks[42], landmarks[45]);
  const rightEar = r3 === 0 ? 0.3 : (r1 + r2) / (2 * r3);

  return (leftEar + rightEar) / 2;
}

/**
 * Estimate head yaw, pitch, and roll from the 68-point landmark array.
 * Mirrors estimateHeadPose() in attendance-crypto.server.ts for yaw/pitch;
 * adds roll from the eye-line angle (not available in the server version).
 */
function estimatePoseAngles(landmarks: { x: number; y: number }[]): {
  yaw: number;
  pitch: number;
  roll: number;
} {
  if (!landmarks || landmarks.length < 46) return { yaw: 0, pitch: 0, roll: 0 };

  const noseTip = landmarks[30];
  const leftEyeOuter = landmarks[36];
  const rightEyeOuter = landmarks[45];

  const eyeCenter = {
    x: (leftEyeOuter.x + rightEyeOuter.x) / 2,
    y: (leftEyeOuter.y + rightEyeOuter.y) / 2,
  };
  const eyeWidth = Math.abs(rightEyeOuter.x - leftEyeOuter.x) || 1;

  const yaw = ((noseTip.x - eyeCenter.x) / eyeWidth) * 90;
  // Subtract baseline vertical offset (nose tip is naturally below eye center line) so frontal face pitch is ~0°
  const pitchRatio = (noseTip.y - eyeCenter.y) / eyeWidth - 0.0625;
  const pitch = pitchRatio * 90;

  // Roll: angle of the eye-line relative to image horizontal (in degrees).
  // Positive = head tilted to the right.
  const dx = rightEyeOuter.x - leftEyeOuter.x;
  const dy = rightEyeOuter.y - leftEyeOuter.y;
  const roll = (Math.atan2(dy, dx) * 180) / Math.PI;

  return { yaw, pitch, roll };
}

/**
 * Compute Laplacian variance of the luminance channel in the cropped face region.
 * High variance → sharp edge detail → good frame.
 * Low variance → uniform / blurry.
 *
 * Laplacian kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
 * We operate on greyscale (Y from YUV).
 *
 * @param imageData - ImageData object for the cropped face bounding box.
 * @returns variance of the Laplacian response.
 */
function laplacianVariance(imageData: ImageData): number {
  const { data, width, height } = imageData;

  // Convert to greyscale luminance array (Y ≈ 0.299R + 0.587G + 0.114B)
  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) {
    const base = i * 4;
    grey[i] = 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2];
  }

  // Apply discrete Laplacian and accumulate squared responses
  const responses: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        grey[idx - width] +
        grey[idx + width] +
        grey[idx - 1] +
        grey[idx + 1] -
        4 * grey[idx];
      responses.push(lap);
    }
  }

  if (responses.length === 0) return 0;
  const mean = responses.reduce((a, b) => a + b, 0) / responses.length;
  const variance =
    responses.reduce((a, v) => a + (v - mean) ** 2, 0) / responses.length;
  return variance;
}

/**
 * Sample mean and standard deviation of pixel brightness (greyscale)
 * across the face bounding box ImageData.
 */
function brightnessStats(imageData: ImageData): { mean: number; stddev: number } {
  const { data, width, height } = imageData;
  const n = width * height;
  if (n === 0) return { mean: 128, stddev: 50 };

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const base = i * 4;
    sum += 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2];
  }
  const mean = sum / n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const base = i * 4;
    const lum = 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2];
    variance += (lum - mean) ** 2;
  }
  const stddev = Math.sqrt(variance / n);

  return { mean, stddev };
}

/**
 * Crop the face bounding box from a video element using an offscreen canvas
 * and return the raw ImageData for pixel analysis.
 * Returns null if the bounding box is degenerate or the 2D context is unavailable.
 */
function cropFaceRegion(
  videoEl: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
): ImageData | null {
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoEl, x, y, w, h, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Assess a single video frame for enrollment quality.
 *
 * @param landmarks - 68-point landmark array from face-api.js detection result.
 * @param faceBox   - Bounding box {x, y, width, height} in video pixel space.
 * @param videoEl   - Live video element (used for pixel access via canvas crop).
 * @returns FrameQualityResult with passed flag, 0–1 composite score, and reason codes.
 */
export function assessFrameQuality(
  landmarks: { x: number; y: number }[],
  faceBox: { x: number; y: number; width: number; height: number },
  videoEl: HTMLVideoElement,
): FrameQualityResult {
  const reasons: string[] = [];
  let checksTotal = 0;
  let checksPassed = 0;

  // ── (a) Sharpness — Laplacian variance on cropped face region ───────────
  checksTotal++;
  const imageData = cropFaceRegion(videoEl, faceBox);
  let lapVariance = 0;
  if (imageData) {
    lapVariance = laplacianVariance(imageData);
    if (lapVariance >= QUALITY_LAPLACIAN_THRESHOLD) {
      checksPassed++;
    } else {
      reasons.push("blurry");
    }
  } else {
    // If we can't crop (e.g. cross-origin), skip this check and count it passed
    // to avoid falsely penalising every frame in restricted environments.
    checksPassed++;
  }

  // ── (b) Pose bounds — yaw, pitch, roll ──────────────────────────────────
  const { yaw, pitch, roll } = estimatePoseAngles(landmarks);

  checksTotal++;
  if (Math.abs(yaw) <= QUALITY_MAX_YAW_DEG) {
    checksPassed++;
  } else {
    reasons.push("excessive_yaw");
  }

  checksTotal++;
  if (Math.abs(pitch) <= QUALITY_MAX_PITCH_DEG) {
    checksPassed++;
  } else {
    reasons.push("excessive_pitch");
  }

  checksTotal++;
  if (Math.abs(roll) <= QUALITY_MAX_ROLL_DEG) {
    checksPassed++;
  } else {
    reasons.push("excessive_roll");
  }

  // ── (c) Minimum face size — inter-ocular distance ───────────────────────
  checksTotal++;
  const interEyeDist =
    landmarks.length >= 46 ? dist2d(landmarks[36], landmarks[45]) : 0;
  if (interEyeDist >= QUALITY_MIN_INTER_EYE_PX) {
    checksPassed++;
  } else {
    reasons.push("face_too_far");
  }

  // ── (d) Occlusion / EAR — eyes must be visibly open ─────────────────────
  checksTotal++;
  const ear = computeEAR(landmarks);
  if (ear >= QUALITY_MIN_EAR) {
    checksPassed++;
  } else {
    reasons.push("eyes_closed");
  }

  // ── (e) Illumination — mean brightness and blown-out detection ───────────
  if (imageData) {
    checksTotal++;
    const { mean: bMean, stddev: bStddev } = brightnessStats(imageData);
    if (bMean < QUALITY_MIN_BRIGHTNESS) {
      reasons.push("too_dark");
    } else if (bMean > QUALITY_MAX_BRIGHTNESS && bStddev < QUALITY_MIN_BRIGHTNESS_STDDEV) {
      reasons.push("blown_out");
    } else {
      checksPassed++;
    }
  }

  const passed = reasons.length === 0;
  const score = checksTotal > 0 ? checksPassed / checksTotal : 0;

  return { passed, score, reasons };
}

// ── Embedding aggregation ───────────────────────────────────────────────────

/**
 * Compute the component-wise arithmetic mean of a set of 128-d (or any fixed-D)
 * embedding vectors. This is the canonical way to aggregate multi-frame descriptors:
 * the mean sits closer to the centroid of the within-subject embedding cloud than
 * any single frame, producing a more robust template.
 *
 * Preconditions:
 *   - `vectors` is non-empty.
 *   - All vectors have the same dimensionality.
 * If the array is empty, returns an empty array.
 * If vectors have mismatched lengths, the shorter length is used (safe fallback).
 *
 * Pure function — no side effects, no I/O. Unit-testable in isolation.
 */
export function averageEmbeddings(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = Math.min(...vectors.map((v) => v.length));
  if (dim === 0) return [];

  const sum = new Float64Array(dim); // use float64 accumulator to avoid precision loss
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i];
    }
  }
  const n = vectors.length;
  return Array.from(sum, (s) => s / n);
}
