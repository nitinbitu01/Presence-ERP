// Client-side face-api.js loader. Loads the UMD bundle and pretrained models from this app's
// own /public directory (same-origin static assets), not a third-party CDN. Previously this
// pulled both from cdn.jsdelivr.net at runtime -- a single point of failure for enrollment and
// attendance if that CDN was slow, blocked by an institutional firewall, or down during a mass
// rollout window, with no local fallback. The bundle/model files here are vendored from the
// @vladmandic/face-api npm package (see package.json) so they stay same-origin and versioned
// alongside the rest of the app; update both together when bumping the package version.
// Biometric security requirement: Silent fallback to pixel-hash is strictly REMOVED.
// If models fail to load, check-in is loudly blocked with VERIFICATION_UNAVAILABLE.

/* eslint-disable @typescript-eslint/no-explicit-any */

let loadPromise: Promise<any> | null = null;
const FACEAPI_SRC = "/vendor/face-api.min.js";
const MODELS_URL = "/models";
const MODEL_LOAD_TIMEOUT_MS = 20_000;
const DETECTION_TIMEOUT_MS = 12_000;
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;

// Pre-flight: verify that model manifest JSON files are reachable and not HTML error pages.
// This prevents face-api from receiving a Cloudflare/server HTML 500 page and throwing
// a cryptic JSON-parse error (or propagating raw HTML as an error string to the UI).
async function validateModelManifestsReachable(): Promise<void> {
  const manifests = [
    `${MODELS_URL}/tiny_face_detector_model-weights_manifest.json`,
    `${MODELS_URL}/face_landmark_68_tiny_model-weights_manifest.json`,
    `${MODELS_URL}/face_recognition_model-weights_manifest.json`,
  ];
  for (const url of manifests) {
    let resp: Response;
    try {
      resp = await fetch(url, { cache: "no-store" });
    } catch {
      throw new Error(
        "VERIFICATION_UNAVAILABLE: Cannot reach face model files. Please check your internet connection.",
      );
    }
    if (!resp.ok) {
      throw new Error(
        `VERIFICATION_UNAVAILABLE: Face model file returned HTTP ${resp.status}. Try reloading the page.`,
      );
    }
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      // Server returned an HTML error page instead of the model manifest JSON.
      // This happens when the service worker serves a stale/cached HTML 500 response.
      throw new Error(
        "VERIFICATION_UNAVAILABLE: Face model files are unavailable (received error page). " +
          "Please clear your browser cache and reload.",
      );
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out. Please check your connection and try again.`));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const VIRTUAL_CAMERA_DENYLIST = [
  "obs virtual camera",
  "obs-camera",
  "droidcam",
  "manycam",
  "iriun",
  "e2esoft",
  "snap camera",
  "camo",
];

export function detectVirtualCamera(stream?: MediaStream | null): {
  isVirtual: boolean;
  label: string;
} {
  if (!stream) return { isVirtual: false, label: "unknown" };
  const tracks = stream.getVideoTracks();
  for (const track of tracks) {
    const label = (track.label || "").toLowerCase();
    for (const badSubstr of VIRTUAL_CAMERA_DENYLIST) {
      if (label.includes(badSubstr)) {
        return { isVirtual: true, label: track.label };
      }
    }
  }
  return { isVirtual: false, label: tracks[0]?.label || "hardware_camera" };
}

export async function loadFaceApi(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("VERIFICATION_UNAVAILABLE: Browser environment required.");
  }
  if ((window as any).faceapi) return (window as any).faceapi;
  if (!loadPromise) {
    loadPromise = (async () => {
      // Pre-flight: confirm model manifests are reachable JSON (not HTML error pages).
      // This guard catches the stale-SW-cache bug where the service worker serves a
      // cached Cloudflare HTML 500 page instead of the real .json manifest.
      await validateModelManifestsReachable();

      return new Promise<any>((resolve, reject) => {
        const s = document.createElement("script");
        const scriptTimer = window.setTimeout(() => {
          s.remove();
          reject(new Error("VERIFICATION_UNAVAILABLE: Face verification script timed out."));
        }, SCRIPT_LOAD_TIMEOUT_MS);
        s.src = FACEAPI_SRC;
        s.async = true;
        s.onload = async () => {
          window.clearTimeout(scriptTimer);
          try {
            const faceapi = (window as any).faceapi;
            await withTimeout(
              Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
              ]),
              MODEL_LOAD_TIMEOUT_MS,
              "Face model loading",
            );
            resolve(faceapi);
          } catch (e) {
            reject(e);
          }
        };
        s.onerror = () => {
          window.clearTimeout(scriptTimer);
          reject(new Error("VERIFICATION_UNAVAILABLE: Failed to load face verification script."));
        };
        document.head.appendChild(s);
      });
    })();
  }
  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null;
    console.error("face-api load failed:", e);
    // Surface a clean, human-readable message — never expose raw HTML in the error string.
    const raw = e instanceof Error ? e.message : String(e);
    const isHtml = /<!doctype|<html|<head|this page didn't load|something went wrong/i.test(raw);
    const clean = isHtml
      ? "Face model files returned an error page. Please clear your browser cache and reload."
      : raw;
    throw new Error(
      clean.startsWith("VERIFICATION_UNAVAILABLE") ? clean : `VERIFICATION_UNAVAILABLE: ${clean}`,
    );
  }
}

// Extract a single 128-D descriptor from a video element. Returns null if no face.
export async function extractDescriptor(
  el: HTMLVideoElement | HTMLImageElement,
): Promise<number[] | null> {
  const faceapi = await loadFaceApi();
  const detection: any = await withTimeout(
    faceapi
      .detectSingleFace(
        el,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 }),
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor(),
    DETECTION_TIMEOUT_MS,
    "Face detection",
  );
  if (!detection?.descriptor) return null;
  return Array.from(detection.descriptor as Float32Array);
}

// Detect number of faces in a video or image element
export async function detectFacesCount(el: HTMLVideoElement | HTMLImageElement): Promise<number> {
  const faceapi = await loadFaceApi();
  const detections: any[] = await withTimeout(
    faceapi.detectAllFaces(
      el,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 }),
    ),
    DETECTION_TIMEOUT_MS,
    "Multi-face detection",
  );
  return detections ? detections.length : 0;
}

export type FrameSample = {
  embedding: number[];
  signal: {
    ear: number;
    yaw: number;
    pitch: number;
    faceArea: number;
    faceX: number;
    faceY: number;
  };
};

// Compute EAR (Eye Aspect Ratio) from landmarks
function computeLandmarkEAR(positions: { x: number; y: number }[]): number {
  if (!positions || positions.length < 48) return 0.3;
  const dist = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
    Math.hypot(p1.x - p2.x, p1.y - p2.y);

  const l1 = dist(positions[37], positions[41]);
  const l2 = dist(positions[38], positions[40]);
  const l3 = dist(positions[36], positions[39]);
  const leftEar = l3 === 0 ? 0.3 : (l1 + l2) / (2 * l3);

  const r1 = dist(positions[43], positions[47]);
  const r2 = dist(positions[44], positions[46]);
  const r3 = dist(positions[42], positions[45]);
  const rightEar = r3 === 0 ? 0.3 : (r1 + r2) / (2 * r3);

  return (leftEar + rightEar) / 2;
}

// Estimate head yaw and pitch from landmarks
export function estimateHeadAngles(positions: { x: number; y: number }[]): {
  yaw: number;
  pitch: number;
} {
  if (!positions || positions.length < 34) return { yaw: 0, pitch: 0 };
  const noseTip = positions[30];
  const leftEye = positions[36];
  const rightEye = positions[45];

  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeWidth = Math.abs(rightEye.x - leftEye.x) || 1;

  const yaw = ((noseTip.x - eyeCenter.x) / eyeWidth) * 90;
  const pitchRatio = (noseTip.y - eyeCenter.y) / eyeWidth - 0.0625;
  const pitch = pitchRatio * 90;

  return { yaw, pitch };
}

export type FrameLandmark = { x: number; y: number };
export type FrameBbox = { x: number; y: number; width: number; height: number };

// Capture a sequence of ~8 frames over ~1.5 seconds for liveness verification.
// Returns per-frame landmarks and bounding boxes (in addition to embeddings and
// liveness signals) so quality-gate checks can be applied per frame without
// running a second detection pass.
export async function captureLivenessFrameSequence(
  video: HTMLVideoElement,
  onProgress?: (frameIndex: number, totalFrames: number) => void,
  challengeAction?: string,
): Promise<{
  probeEmbedding: number[];
  frameEmbeddings: number[][];
  livenessSignals: Array<{
    ear: number;
    yaw: number;
    pitch: number;
    faceArea: number;
    faceX: number;
    faceY: number;
  }>;
  /** Per-frame 68-point landmark arrays, index-aligned with frameEmbeddings. */
  frameLandmarks: FrameLandmark[][];
  /** Per-frame bounding boxes, index-aligned with frameEmbeddings. */
  frameBboxes: FrameBbox[];
  /** Per-frame challenge action tags, index-aligned with frameEmbeddings. */
  frameActions: string[];
} | null> {
  const faceapi = await loadFaceApi();
  const samples: FrameSample[] = [];
  const frameLandmarks: FrameLandmark[][] = [];
  const frameBboxes: FrameBbox[] = [];
  const TOTAL_FRAMES = 3;
  const INTER_FRAME_DELAY_MS = 80;

  if (!video || video.readyState < 2 || video.videoWidth === 0) {
    console.warn("[FaceAPI] Video element not ready (readyState < 2 or width === 0)");
    return null;
  }

  // Pass 1: standard sensitivity (0.35) — up to 3 attempts for rapid capture
  const runDetectionPass = async (scoreThreshold: number, maxFrames: number) => {
    for (let i = 0; i < maxFrames; i++) {
      if (samples.length >= 2) break; // early exit once 2 good frames captured
      onProgress?.(samples.length + 1, TOTAL_FRAMES);
      try {
        const detection: any = await faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold }),
          )
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (detection?.descriptor && detection?.landmarks) {
          const positions = detection.landmarks.positions as FrameLandmark[];
          const box = detection.detection.box;
          const ear = computeLandmarkEAR(positions);
          const { yaw, pitch } = estimateHeadAngles(positions);

          samples.push({
            embedding: Array.from(detection.descriptor as Float32Array),
            signal: {
              ear,
              yaw,
              pitch,
              faceArea: box.width * box.height,
              faceX: box.x + box.width / 2,
              faceY: box.y + box.height / 2,
            },
          });
          frameLandmarks.push(positions);
          frameBboxes.push({ x: box.x, y: box.y, width: box.width, height: box.height });
        }
      } catch (e) {
        console.warn("Frame detection error", e);
      }
      if (samples.length < 2) {
        await new Promise((resolve) => setTimeout(resolve, INTER_FRAME_DELAY_MS));
      }
    }
  };

  // Pass 1: standard sensitivity (0.35) — up to 3 frames max
  await runDetectionPass(0.35, 3);

  // Pass 2: retry with lower threshold (0.25) for dim light / low-end cameras
  // Only runs if pass 1 found 0 frames — avoids duplicate embeddings.
  if (samples.length === 0) {
    console.warn("[FaceAPI] Pass 1 found no face. Retrying with lower score threshold (0.25)…");
    await runDetectionPass(0.25, 3);
  }

  // Return null only if both passes found absolutely nothing
  if (samples.length < 1) return null;

  // Compute probe embedding as the element-wise mean of all captured frames.
  // Averaging reduces noise from any single frame (motion blur, partial occlusion)
  // and produces a more robust embedding for Gate 4 identity comparison.
  const dim = samples[0].embedding.length;
  const probeEmbedding = Array.from(
    { length: dim },
    (_, i) => samples.reduce((sum, s) => sum + s.embedding[i], 0) / samples.length,
  );
  const frameEmbeddings = samples.map((s) => s.embedding);
  const livenessSignals = samples.map((s) => s.signal);
  const frameActions = samples.map(() => challengeAction ?? "unknown");

  return {
    probeEmbedding,
    frameEmbeddings,
    livenessSignals,
    frameLandmarks,
    frameBboxes,
    frameActions,
  };
}

// Device fingerprint generator
export async function computeDeviceFingerprint(): Promise<string> {
  let canvasSig = "";
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("Presence🎓", 2, 15);
      canvasSig = c.toDataURL();
    }
  } catch (e) {
    // Canvas fingerprinting blocked/failed
  }

  const bits: string[] = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? ""),
    canvasSig,
  ];
  const enc = new TextEncoder().encode(bits.join("|"));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
