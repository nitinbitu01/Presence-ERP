/**
 * Task 3 — Face Match Benchmark Script
 *
 * Runs the SAME production face-extraction pipeline (face-api.js FaceRecognitionNet)
 * and the SAME cosine similarity function used in attendance-crypto.server.ts against
 * a labeled dataset, and reports honest per-condition results.
 *
 * Dataset structure (populate with real captured data — do NOT use synthetic data):
 *   benchmarks/dataset/<subject_id>/reference.jpg          <- enrollment reference image
 *   benchmarks/dataset/<subject_id>/<condition>.jpg        <- probe image(s)
 *
 * Usage:
 *   node scripts/benchmark-face-match.mjs [--dataset <path>] [--out <path>]
 *
 * Outputs:
 *   benchmarks/results.csv  — per-probe: subject, condition, similarity, decision
 *   benchmarks/results.json — same data as JSON
 *   stdout summary          — overall match rate per condition, false-reject estimate
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DATASET_DIR = resolve(process.argv[2] ?? "benchmarks/dataset");
const OUT_DIR = resolve(process.argv[3] ?? "benchmarks");
const THRESHOLD_MATCH = 0.82;
const THRESHOLD_REVIEW = 0.75;

const faceapi = require("@vladmandic/face-api");
const MODELS_URL = resolve("public/models");

function cosineSimilarity(a, b) {
  const len = a.length;
  if (len !== b.length || len === 0) return -1;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i],
      bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na * nb);
  return denom === 0 ? 0 : dot / denom;
}

async function extractDescriptorFromFile(filePath) {
  const buffer = readFileSync(filePath);
  const img = await faceapi.bufferToImage(buffer);
  const detection = await faceapi
    .detectSingleFace(
      img,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 }),
    )
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!detection?.descriptor) return null;
  return Array.from(detection.descriptor);
}

async function main() {
  console.log(`Loading face-api models from ${MODELS_URL}...`);
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_URL);
  await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODELS_URL);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_URL);
  console.log("Models loaded.\n");

  if (!existsSync(DATASET_DIR)) {
    console.error(`Dataset directory not found: ${DATASET_DIR}`);
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
  let totalProbes = 0,
    autoAccepted = 0,
    sentToReview = 0,
    rejected = 0,
    noFaceDetected = 0;

  for (const subject of subjects) {
    const subjectDir = join(DATASET_DIR, subject);
    const files = readdirSync(subjectDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
    const referenceFile = files.find((f) => f.toLowerCase().includes("reference"));
    if (!referenceFile) {
      console.warn(`  [${subject}] No reference.jpg found — skipping.`);
      continue;
    }

    const referenceDescriptor = await extractDescriptorFromFile(join(subjectDir, referenceFile));
    if (!referenceDescriptor) {
      console.warn(`  [${subject}] No face in reference — skipping.`);
      continue;
    }

    const probeFiles = files.filter((f) => f !== referenceFile);
    console.log(`  [${subject}] Reference: ${referenceFile} | ${probeFiles.length} probe(s)`);

    for (const probeFile of probeFiles) {
      totalProbes++;
      const condition = probeFile.replace(/\.(jpg|jpeg|png)$/i, "");
      const probeDescriptor = await extractDescriptorFromFile(join(subjectDir, probeFile));
      if (!probeDescriptor) {
        noFaceDetected++;
        results.push({ subject, condition, similarity: null, decision: "no_face_detected" });
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

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Subjects: ${subjects.length}`);
  console.log(`Total probes: ${totalProbes}`);
  console.log(
    `Auto-accepted (>= ${THRESHOLD_MATCH}): ${autoAccepted} (${((autoAccepted / totalProbes) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Sent to review (${THRESHOLD_REVIEW}-${THRESHOLD_MATCH}): ${sentToReview} (${((sentToReview / totalProbes) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Rejected (< ${THRESHOLD_REVIEW}): ${rejected} (${((rejected / totalProbes) * 100).toFixed(1)}%)`,
  );
  console.log(
    `No face detected: ${noFaceDetected} (${((noFaceDetected / totalProbes) * 100).toFixed(1)}%)`,
  );

  const falseRejects = results.filter((r) => r.decision === "rejected");
  console.log(
    `\nFalse-reject estimate (same subject, similarity < ${THRESHOLD_REVIEW}): ${falseRejects.length} of ${totalProbes} probes (${((falseRejects.length / totalProbes) * 100).toFixed(1)}%)`,
  );

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
    console.log(
      `  ${condition}: ${rows.length} probes | accepted=${accepted} review=${review} rejected=${rej} no_face=${noFace}`,
    );
  }

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
  console.log(
    `\nResults written to ${join(OUT_DIR, "results.csv")} and ${join(OUT_DIR, "results.json")}`,
  );
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
