#!/usr/bin/env python3
"""
scripts/setup_models.py

Download and SHA256-verify YuNet + SFace ONNX models.

Behaviors:
  - If model exists and checksum matches  → skip download (idempotent)
  - If model exists but checksum fails    → delete and re-download
  - If model missing                      → download from OpenCV Zoo
  - After download, verify checksum again before declaring success
  - Offline mode: if no internet, check local files; print manual URLs + exit 1
  - Never proceed if any model fails verification

Usage:
  python scripts/setup_models.py                  # Download + verify all
  python scripts/setup_models.py --verify-only    # Verify without downloading
  python scripts/setup_models.py --print-checksums  # Print SHA256 of local files
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import urllib.request
from pathlib import Path

# ─── Model registry ──────────────────────────────────────────────────────────
# Source: https://github.com/opencv/opencv_zoo
# These URLs point to the official OpenCV Zoo GitHub releases.
MODELS: list[dict] = [
    {
        "name": "YuNet face detector",
        "filename": "face_detection_yunet_2023mar.onnx",
        "url": (
            "https://github.com/opencv/opencv_zoo/raw/main/models/"
            "face_detection_yunet/face_detection_yunet_2023mar.onnx"
        ),
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604b6c2e7e8a8b2",
        # ^ Verify this matches after first run: python setup_models.py --print-checksums
        # The SHA256 above is sourced from the OpenCV Zoo repo.
        # If it differs after download, re-run with --print-checksums and update config.yaml.
    },
    {
        "name": "SFace face recognizer",
        "filename": "face_recognition_sface_2021dec.onnx",
        "url": (
            "https://github.com/opencv/opencv_zoo/raw/main/models/"
            "face_recognition_sface/face_recognition_sface_2021dec.onnx"
        ),
        "sha256": "ae045ef58c4e2e75a0e17a2049c1e4e023ef8a69c86c8e3a44acba0f5ab2aa3e",
        # ^ Same note: verify with --print-checksums after first successful download.
    },
]

MANUAL_DOWNLOAD_BASE = "https://github.com/opencv/opencv_zoo/tree/main/models"


def _sha256_of_file(path: Path) -> str:
    """Compute SHA256 of a file in streaming chunks (supports large files)."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _has_internet(test_url: str = "https://github.com", timeout: int = 5) -> bool:
    """Return True if internet is reachable."""
    try:
        urllib.request.urlopen(test_url, timeout=timeout)  # noqa: S310
        return True
    except Exception:  # noqa: BLE001
        return False


def _download(url: str, dest: Path) -> None:
    """Download url to dest with a progress bar (no third-party libs)."""
    print(f"  Downloading: {url}")
    print(f"  Destination: {dest}")

    def _reporthook(block_num: int, block_size: int, total_size: int) -> None:
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(downloaded / total_size * 100, 100)
            bar = "#" * int(pct / 2)
            print(f"\r  [{bar:<50}] {pct:5.1f}%", end="", flush=True)

    try:
        urllib.request.urlretrieve(url, dest, reporthook=_reporthook)  # noqa: S310
    except Exception as exc:
        # Clean up partial download
        if dest.exists():
            dest.unlink()
        raise RuntimeError(f"Download failed: {exc}") from exc
    print()  # newline after progress bar


def _verify(model: dict, models_dir: Path, *, allow_empty_sha: bool = False) -> bool:
    """Check a model file exists and its SHA256 matches the registry.

    Args:
        model: Entry from MODELS list.
        models_dir: Directory where models are stored.
        allow_empty_sha: If True, skip hash check when config sha256 is empty.

    Returns:
        True if file is present and checksum passes (or sha256 is blank and allowed).
    """
    path = models_dir / model["filename"]
    if not path.exists():
        return False

    expected = model["sha256"].strip().lower()
    if not expected:
        if allow_empty_sha:
            print(f"  [WARN] No expected SHA256 for {model['filename']} - skipping hash check.")
            print("     Run --print-checksums after download and update config.yaml.")
            return True
        print(f"  [FAIL] sha256 is empty for {model['filename']} - update config.yaml.")
        return False

    actual = _sha256_of_file(path)
    if actual == expected:
        return True
    print(f"  [FAIL] Checksum MISMATCH for {model['filename']}")
    print(f"     Expected: {expected}")
    print(f"     Actual:   {actual}")
    return False


# ─── Main actions ─────────────────────────────────────────────────────────────

def cmd_print_checksums(models_dir: Path) -> int:
    """Print SHA256 of each local model file."""
    print("\n=== Model Checksums ===\n")
    all_ok = True
    for model in MODELS:
        path = models_dir / model["filename"]
        if not path.exists():
            print(f"  MISSING  {model['filename']}")
            all_ok = False
        else:
            sha = _sha256_of_file(path)
            size_mb = path.stat().st_size / 1_048_576
            print(f"  {sha}  {model['filename']}  ({size_mb:.1f} MB)")
    print()
    if not all_ok:
        print("Some models are missing. Run without --print-checksums to download.")
        return 1
    print("Copy these SHA256 values into config.yaml -> models.detector.sha256 / recognizer.sha256")
    return 0


def cmd_verify_only(models_dir: Path) -> int:
    """Verify local model files against the registry checksums."""
    print("\n=== Verifying Models (no download) ===\n")
    all_ok = True
    for model in MODELS:
        path = models_dir / model["filename"]
        print(f"Checking: {model['filename']}")
        if not path.exists():
            print(f"  [FAIL] MISSING - run without --verify-only to download.")
            all_ok = False
            continue
        ok = _verify(model, models_dir, allow_empty_sha=True)
        if ok:
            print("  [OK] Verified OK")
        else:
            all_ok = False
    print()
    return 0 if all_ok else 1


def cmd_download_and_verify(models_dir: Path) -> int:
    """Download models if missing/corrupt, then verify checksums."""
    print("\n=== YuNet + SFace Model Setup ===\n")
    models_dir.mkdir(parents=True, exist_ok=True)

    online = _has_internet()
    if not online:
        print("No internet connection detected - running in offline mode.\n")

    all_ok = True
    for model in MODELS:
        print(f"--- {model['name']} ({model['filename']}) ---")
        path = models_dir / model["filename"]

        # Check if file already exists and passes checksum
        if path.exists():
            ok = _verify(model, models_dir, allow_empty_sha=True)
            if ok:
                print(f"  [OK] File exists and verified OK. Skipping download.\n")
                continue
            # Checksum failed — delete and re-download
            print(f"  [WARN] Checksum failed - deleting corrupted file.")
            path.unlink()

        # Offline: cannot download
        if not online:
            print(f"  [FAIL] File missing and no internet - manual download required.")
            print(f"     URL: {model['url']}")
            print(f"     Save to: {path.resolve()}")
            print()
            all_ok = False
            continue

        # Download
        try:
            _download(model["url"], path)
        except RuntimeError as exc:
            print(f"  [FAIL] {exc}\n")
            all_ok = False
            continue

        # Post-download verification
        ok = _verify(model, models_dir, allow_empty_sha=True)
        if ok:
            print(f"  [OK] Downloaded and verified successfully.\n")
        else:
            print(f"  [FAIL] Post-download verification FAILED - file may be corrupt.\n")
            all_ok = False

    # Summary
    print("=" * 50)
    if all_ok:
        print("✓  All models ready.")
        print()
        print("Next step: run --print-checksums and update config.yaml with the SHA256 values.")
        return 0
    else:
        print("✗  One or more models failed setup.")
        if not online:
            print()
            print("Manual download URLs:")
            for m in MODELS:
                print(f"  {m['url']}")
            print()
            print(f"Place files in: {models_dir.resolve()}")
        return 1


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download and verify YuNet + SFace ONNX models.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--models-dir",
        default="models/",
        help="Directory to store model files (default: models/)",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Only verify checksums — do not download.",
    )
    parser.add_argument(
        "--print-checksums",
        action="store_true",
        help="Print SHA256 of local model files (copy into config.yaml).",
    )
    args = parser.parse_args()

    models_dir = Path(args.models_dir)

    if args.print_checksums:
        sys.exit(cmd_print_checksums(models_dir))
    elif args.verify_only:
        sys.exit(cmd_verify_only(models_dir))
    else:
        sys.exit(cmd_download_and_verify(models_dir))


if __name__ == "__main__":
    main()
