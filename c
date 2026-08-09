/**
 * Task 3 — Face Match Benchmark Script
 *
 * Runs the SAME production face-extraction pipeline (face-api.js FaceRecognitionNet)
 * and the SAME cosine similarity function used in attendance-crypto.server.ts against
 * a labeled dataset, and reports honest per-condition results.
 *
 * Dataset structure (populate with real captured data — do NOT use synthetic data):
 *   benchmarks/dataset/<subject_id>/reference.jpg          <- enrollment reference image
 *   benchmarks/dataset/<subject_id>/<condition>.jpg        <- probe image(s), e.g.:
 *       normal_light.jpg, dim_light.jpg, side_light.jpg, with_glasses.jpg, etc.
 *
 * Usage:
 *   node scripts/benchmark-face-match.mjs [--dataset <path>] [--out <path>]
 *
 * Outputs:
 *   benchmarks/results.csv  — per-probe: subject, condition, similarity, decision
 *   benchmarks/results.json — same data as JSON
 *   stdout summary          — overall match rate per condition, false-reject estimate
 *
 * IMPORTANT: This script exercises the actual production code path (face-api.js
 * descriptor extraction + cosine similarity), NOT a reimplementation. The cosine
 * similarity function below is a byte-for-byte copy of the one in
 * src/lib/attendance-crypto.server.ts (see the comment there).
 *
 * Honest scope: this is a small pilot benchmark. It does NOT claim demographic
 * breakdowns unless the dataset actually includes that variation. It reports only
 * what the collected data supports.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ── Config ──────────────────────────────────────────────────────────────────
const DATASET_DIR = resolve(process.argv[2] ?? "benchmarks/dataset");
const OUT_DIR = resolve(process.argv[3] ?? "benchmarks");
const THRESHOLD_MATCH = 0.82; // Same as submitAttendance
const THRESHOLD_REVIEW = 0.75; // Same as submitAttendance

// ── Load face-api.js (same package as production) ───────────────────────────
const faceapi = require("@vladmandic/face-api");
const MODELS_URL = resolve("public/models");

// ── Cosine similarity — byte-for-byte copy of attendance-crypto.server.ts ───
function cosineSimilarity(a, b) {
  const len = a.length;
  if (len !== b.length || len === 0) return -1;

  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }

  const denom = Math.sqrt(na * nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Extract descriptor from an image file (same pipeline as face-api-loader) ─
async function extractDescriptorFromFile(filePath) {
  const buffer = readFileSync(filePath);
  const img = await faceapi.bufferToImage(buffer);
  const detection = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!detection?.descriptor) return null;
  return Array.from(detection.descriptor);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Loading face-api models from ${MODELS_URL}...`);
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_URL);
  await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODELS_URL);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_URL);
  console.log("Models loaded.\n");

  if (!existsSync(DATASET_DIR)) {
    console.error(`Dataset directory not found: ${DATASET_DIR}`);
    console.error("Create it with one folder per subject containing reference.jpg + probe images.");
    process.exit(1);
  }

  const subjects = readdirSync(DATASET_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (subjects.length === 0) {
    console.error(`No subject folders found in ${DATASET_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${subjects.length} subject(s): ${subjects.join(", ")}\n`);

  const results = [];
  let totalProbes = 0;
  let autoAccepted = 0;
  let sentToReview = 0;
  let rejected = 0;
  let noFaceDetected = 0;

  for (const subject of subjects) {
    const subjectDir = join(DATASET_DIR, subject);
    const files = readdirSync(subjectDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));

    const referenceFile = files.find((f) => f.toLowerCase().includes("reference"));
    if (!referenceFile) {
      console.warn(`  [${subject}] No reference.jpg found — skipping subject.`);
      continue;
    }

    const referencePath = join(subjectDir, referenceFile);
    const referenceDescriptor = await extractDescriptorFromFile(referencePath);
    if (!referenceDescriptor) {
      console.warn(`  [${subject}] No face detected in reference image — skipping subject.`);
      continue;
    }

    const probeFiles = files.filter((f) => f !== referenceFile);
    console.log(`  [${subject}] Reference: ${referenceFile} | ${probeFiles.length} probe(s)`);

    for (const probeFile of probeFiles) {
      totalProbes++;
      const probePath = join(subjectDir, probeFile);
      const condition = probeFile.replace(/\.(jpg|jpeg|png)$/i, "");

      const probeDescriptor = await extractDescriptorFromFile(probePath);
      if (!probeDescriptor) {
        noFaceDetected++;
        results.push({
          subject,
          condition,
          similarity: null,
          decision: "no_face_detected",
        });
        console.log(`    ${condition}: NO FACE DETECTED`);
        continue;
      }

      const similarity = cosineSimilarity(referenceDescriptor, probeDescriptor);
      let decision;
      if (similarity >= THRESHOLD_MATCH) {
        decision = "auto_accepted";
        autoAccepted++;
      } else if (similarity >= THRESHOLD_REVIEW) {
        decision = "sent_to_review";
        sentToReview++;
      } else {
        decision = "rejected";
        rejected++;
      }

      results.push({ subject, condition, similarity, decision });
      console.log(`    ${condition}: similarity=${similarity.toFixed(4)} → ${decision}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Subjects: ${subjects.length}`);
  console.log(`Total probes: ${totalProbes}`);
  console.log(`Auto-accepted (≥ ${THRESHOLD_MATCH}): ${autoAccepted} (${((autoAccepted / totalProbes) * 100).toFixed(1)}%)`);
  console.log(`Sent to review (${THRESHOLD_REVIEW}–${THRESHOLD_MATCH}): ${sentToReview} (${((sentToReview / totalProbes) * 100).toFixed(1)}%)`);
  console.log(`Rejected (< ${THRESHOLD_REVIEW}): ${rejected} (${((rejected / totalProbes) * 100).toFixed(1)}%)`);
  console.log(`No face detected: ${noFaceDetected} (${((noFaceDetected / totalProbes) * 100).toFixed(1)}%)`);

  // False-reject estimate: same-subject probes that fell below THRESHOLD_REVIEW
  // (i.e. would have been rejected even though they're the same person).
  const falseRejects = results.filter((r) => r.decision === "rejected");
  console.log(`\nFalse-reject estimate (same subject, similarity < ${THRESHOLD_REVIEW}): ${falseRejects.length} of ${totalProbes} probes (${((falseRejects.length / totalProbes) * 100).toFixed(1)}%)`);

  // Per-condition breakdown (only if the dataset actually has condition variation)
  const byCondition = {};
  for (const r of results) {
    if (!byCondition[r.condition]) byCondition[r.condition] = [];
    byCondition[r.condition].push(r);
  }
  console.log("\nPer-condition breakdown:");
  for (const [condition, rows] of Object.entries(byCondition)) {
    const accepted = rows.filter((r) => r.decision === "auto_accepted").length;
    const review = rows.filter((r) => r.decision === "sent_to_review").length;
    const rej = rows.filter((r) => r.decision === "rejected").length;
    const noFace = rows.filter((r) => r.decision === "no_face_detected").length;
    console.log(`  ${condition}: ${rows.length} probes | accepted=${accepted} review=${review} rejected=${rej} no_face=${noFace}`);
  }

  // ── Write outputs ──────────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });

  const csv = [
    "subject,condition,similarity,decision",
    ...results.map((r) => `${r.subject},${r.condition},${r.similarity ?? ""},${r.decision}`),
  ].join("\n");
  writeFileSync(join(OUT_DIR, "results.csv"), csv);

  writeFileSync(
    join(OUT_DIR, "results.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        datasetDir: DATASET_DIR,
        thresholds: { match: THRESHOLD_MATCH, review: THRESHOLD_REVIEW },
        subjects: subjects.length,
        totalProbes,
        autoAccepted,
        sentToReview,
        rejected,
        noFaceDetected,
        falseRejectEstimate: falseRejects.length,
        results,
      },
      null,
      2,
    ),
  );

  console.log(`\nResults written to ${join(OUT_DIR, "results.csv")} and ${join(OUT_DIR, "results.json")}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});