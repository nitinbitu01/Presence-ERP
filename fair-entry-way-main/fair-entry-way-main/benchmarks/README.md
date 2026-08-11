# Face-Match Pilot Benchmark Dataset Guide

This directory holds the pilot benchmark dataset and outputs for evaluating the Face-Match biometric pipeline in `scripts/benchmark-face-match.mjs`.

## Dataset Directory Structure

To run the benchmark script against real or test images, populate a `dataset` directory inside `benchmarks/` structured as follows:

```
benchmarks/
  dataset/
    <subject_id_1>/
      reference.jpg
      normal_light.jpg
      dim_light.jpg
      side_light.jpg
      with_glasses.jpg
      head_tilt.jpg
    <subject_id_2>/
      reference.jpg
      normal_light.jpg
      ...
```

### Image Requirements

- **`reference.jpg`**: A clear, well-lit, frontal enrollment photo.
- **Probe images (`<condition>.jpg`)**: Test images representing real classroom/device capture conditions (e.g. `dim_light.jpg`, `side_light.jpg`, `with_glasses.jpg`, `head_tilt.jpg`).
- All images should be standard JPEG or PNG files captured from front-facing camera devices.

## Running the Benchmark

Execute the script from the repository root:

```bash
node scripts/benchmark-face-match.mjs
```

### Options / Custom Dataset Path

If your dataset is located in a custom path or directory:

```bash
node scripts/benchmark-face-match.mjs --dataset /path/to/dataset
```

## Results & Output

When execution finishes, the script generates two result files in this directory:

- **`benchmarks/results.json`**: Detailed JSON output containing per-subject, per-probe similarity scores, match decisions (auto-accept $\ge 0.82$, review $0.75-0.82$, reject $< 0.75$), and overall summary metrics.
- **`benchmarks/results.csv`**: Tabular CSV export suitable for analysis in Excel/Python/R.

## Reproducibility & Integrity Note

This benchmark pipeline uses `@vladmandic/face-api` model weights and exact cosine similarity algorithms from production (`src/lib/attendance-crypto.server.ts`). Results must never be hardcoded or fabricated.
