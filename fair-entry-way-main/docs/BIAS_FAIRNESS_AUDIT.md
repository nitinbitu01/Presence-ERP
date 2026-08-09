# Demographic Bias & Fairness Audit Report
## Presence ERP — Biometric & Liveness Engine Evaluation

**Date:** 2026-08-05
**Version:** 2.0 (replaces v1.0 — see "Correction notice" below)
**Status:** Pilot benchmark — small N, honest scope, re-runnable

---

## Correction notice (v1.0 → v2.0)

The previous version of this document (v1.0, dated 2026-08-01) contained precise FAR/FRR
numbers broken down by Fitzpatrick skin-tone group and lighting condition, attributed to
"AWS Rekognition PAD" testing. **Those numbers were not backed by any actual test evidence
in this codebase.**

Verification performed as part of this revision:

- `@aws-sdk/client-rekognition` is **not** present in `package.json`.
- No code path in this repository invokes AWS Rekognition with real credentials under test
  conditions. The `liveness-sdk.server.ts` file has AWS Rekognition code gated behind
  environment variables, but the SDK package is not installed, so that path cannot execute.
- No benchmark dataset, test harness, or recorded results exist in this repository that
  would support the v1.0 numbers.

**AWS Rekognition was never actually invoked with real credentials in a completed test.**
The v1.0 numbers are therefore removed. This document now reports only what can be
reproduced from the benchmark script in this repository.

---

## 1. What this document reports

This is a **small pilot benchmark** of the face-match pipeline used in production:

- **Extraction:** `face-api.js` FaceRecognitionNet (128-D descriptor), the same model and
  pipeline used in `src/lib/face-api-loader.ts`.
- **Similarity:** cosine similarity, the same function as in
  `src/lib/attendance-crypto.server.ts`.
- **Thresholds:** `THRESHOLD_MATCH = 0.82` and `THRESHOLD_REVIEW = 0.75`, the same as in
  `src/lib/attendance.functions.ts`.

The benchmark script is `scripts/benchmark-face-match.mjs`. It accepts a labeled dataset
directory (one folder per subject, containing a `reference.jpg` + probe images under varied
conditions) and reports per-probe similarity scores and decisions.

## 2. Sample size and collection method

**Sample size: N = 0 (dataset not yet collected).**

The benchmark script is ready to run, but no real captured dataset has been collected yet.
This document will be updated with actual measured results once a volunteer group captures
the data. The intended collection method:

- Each volunteer provides one well-lit, frontal `reference.jpg` (enrollment-style).
- Each volunteer provides several probe images under varied conditions: normal light, dim
  light, side light, with glasses, etc.
- All images are captured with the same camera hardware used in production (laptop/phone
  front camera).

This matches the citation style of small, honestly-labeled academic studies (e.g. Shoewu
N=80/94%, Kadry N=300/98.3%, Mittal N=20/87–92%) — small real numbers with a described
methodology, not an unsourced table.

## 3. Conditions tested

The benchmark script supports arbitrary condition labels via probe filenames. Intended
conditions for the pilot:

| Condition | Description |
|---|---|
| `normal_light` | Standard classroom/office lighting (300–500 lux) |
| `dim_light` | Dim lighting (50–100 lux) |
| `side_light` | Strong side lighting |
| `with_glasses` | Wearing prescription glasses |
| `head_tilt` | Slight head tilt (non-frontal) |

## 4. Measured results

**No results yet — dataset not collected.** Once the dataset is collected and the benchmark
is run, the actual measured results will be reported here, including:

- Overall auto-accept rate (similarity ≥ 0.82)
- Review-queue rate (0.75 ≤ similarity < 0.82)
- Reject rate (similarity < 0.75)
- False-reject estimate (same-subject probes below THRESHOLD_REVIEW)
- Per-condition breakdown

**No demographic breakdowns will be fabricated.** If the pilot dataset does not include
demographic variation (skin-tone, etc.), this document will not claim demographic findings.

## 5. Limitations

- **Small N:** The pilot is intended for 50–100 volunteers, which is small for biometric
  performance claims.
- **Non-exhaustive coverage:** Only a few lighting/accessory conditions are tested, not the
  full range of real-world conditions.
- **Single-institution scope:** All data comes from one institution's student population and
  one camera hardware class (laptop/phone front cameras).
- **No demographic stratification:** Unless the dataset is explicitly collected with
  demographic labels, no demographic breakdowns are reported.
- **No PAD (presentation attack detection) testing:** This benchmark measures face-match
  accuracy only, not liveness/PAD performance.

## 6. How to reproduce

```bash
# 1. Collect a dataset (see benchmarks/README.md for structure)
# 2. Run the benchmark
node scripts/benchmark-face-match.mjs
# 3. Results are written to benchmarks/results.csv and benchmarks/results.json
```

The benchmark exercises the actual production code path (face-api.js descriptor extraction +
cosine similarity), so the numbers are directly relevant to the thresholds in
`src/lib/attendance.functions.ts`.

## 7. Threshold implications

The current thresholds (`THRESHOLD_MATCH = 0.82`, `THRESHOLD_REVIEW = 0.75`) are hardcoded
with no evidenced justification. This benchmark is designed to provide that evidence. If the
measured results suggest the thresholds should change, a proposal with supporting numbers
will be made as a separate, explicit diff — threshold changes affect every student's
attendance outcome and should not be bundled invisibly into a docs-cleanup commit.

---

## Revision History

| Date | Version | Change |
|---|---|---|
| 2026-08-01 | 1.0 | Initial (fabricated) conformance statement — **superseded** |
| 2026-08-05 | 2.0 | Removed unverifiable AWS Rekognition numbers; added honest pilot benchmark scope, methodology, and reproduction instructions |