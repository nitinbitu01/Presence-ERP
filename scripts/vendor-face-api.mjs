#!/usr/bin/env node
// Vendors the face-api.js UMD bundle and the 3 model weight sets actually used by
// src/lib/face-api-loader.ts into public/vendor and public/models, sourced from the pinned
// @vladmandic/face-api devDependency (see package.json).
//
// Why this exists: the app previously loaded both the bundle and the model weights from
// cdn.jsdelivr.net at runtime, in the student's browser, on every enrollment/attendance
// check-in. That's a single point of failure -- a slow, blocked (institutional firewalls
// commonly block unfamiliar CDNs), or down CDN breaks enrollment and attendance app-wide with
// no local fallback. Serving these same-origin removes that dependency entirely.
//
// Run this after bumping the @vladmandic/face-api version in package.json:
//   npm install && npm run vendor:face-api
//
// Only vendors the 3 models face-api-loader.ts actually calls loadFromUri for (tinyFaceDetector,
// faceLandmark68TinyNet, faceRecognitionNet) -- not the full model zoo -- to keep the payload
// every student downloads on first load as small as possible. If face-api-loader.ts starts
// using additional nets, add their manifest/bin filenames to MODEL_FILES below.

import { existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const pkgDir = join(repoRoot, "node_modules", "@vladmandic", "face-api");

const VENDOR_DIR = join(repoRoot, "public", "vendor");
const MODELS_DIR = join(repoRoot, "public", "models");

const MODEL_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_tiny_model-weights_manifest.json",
  "face_landmark_68_tiny_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

function fail(msg) {
  const isPostinstall = process.env.npm_lifecycle_event === "postinstall";
  console.error(`[vendor:face-api] ${msg}`);
  if (isPostinstall) {
    // A production-only install (npm ci --omit=dev) won't have devDependencies present, so
    // @vladmandic/face-api won't exist here -- that's expected, not an error, in that context.
    // Don't fail the whole `npm install`; a prior CI/build step (or dev install) is expected
    // to have already produced public/vendor and public/models before a prod-only install runs.
    console.warn(
      "[vendor:face-api] Skipping (likely a production-only install without devDependencies). " +
        "Run `npm run vendor:face-api` explicitly after a full `npm install` if public/vendor " +
        "or public/models are missing.",
    );
    process.exit(0);
  }
  process.exit(1);
}

if (!existsSync(pkgDir)) {
  fail(
    `@vladmandic/face-api not found in node_modules. Run "npm install" first ` +
      `(it must be listed in package.json devDependencies).`,
  );
}

rmSync(VENDOR_DIR, { recursive: true, force: true });
rmSync(MODELS_DIR, { recursive: true, force: true });
mkdirSync(VENDOR_DIR, { recursive: true });
mkdirSync(MODELS_DIR, { recursive: true });

// Bundle: Copy the face-api bundle directly to vendor directory.
const bundleSrc = join(pkgDir, "dist", "face-api.js");
if (!existsSync(bundleSrc)) fail(`Expected bundle not found at ${bundleSrc}`);
copyFileSync(bundleSrc, join(VENDOR_DIR, "face-api.min.js"));

// Models: copy all model files referenced by face-api-loader.ts.
for (const file of MODEL_FILES) {
  const src = join(pkgDir, "model", file);
  if (!existsSync(src)) fail(`Expected model file not found at ${src}`);
  copyFileSync(src, join(MODELS_DIR, file));
}

console.log(
  `[vendor:face-api] Vendored face-api.min.js + ${MODEL_FILES.length} model files into public/.`,
);
