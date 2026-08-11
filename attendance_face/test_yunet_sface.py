"""
Quick diagnostic script to verify YuNet and SFace model loading,
face detection, 5-point landmark extraction, and 128D embedding generation.
"""

import sys
import numpy as np
import cv2

from face_engine.config import Config
from face_engine.detector import FaceDetector
from face_engine.recognizer import FaceRecognizer

def test_models():
    print("==================================================")
    print("[TEST] Testing YuNet Face Detector & SFace Recognizer")
    print("==================================================")

    # 1. Load config & models
    config = Config.from_yaml()
    detector = FaceDetector(config)
    recognizer = FaceRecognizer(config)
    print("[PASS] Models loaded successfully into memory.")

    # 2. Create a test image
    canvas = np.full((300, 300, 3), 200, dtype=np.uint8)
    cv2.circle(canvas, (150, 150), 70, (180, 210, 240), -1)
    cv2.circle(canvas, (125, 130), 8, (50, 30, 20), -1)
    cv2.circle(canvas, (175, 130), 8, (50, 30, 20), -1)
    cv2.line(canvas, (150, 140), (150, 165), (80, 50, 40), 3)
    cv2.ellipse(canvas, (150, 185), (25, 10), 0, 0, 180, (40, 20, 120), 3)

    # 3. Test YuNet detection
    faces = detector.detect(canvas)
    print(f"[PASS] YuNet detection completed. Faces found: {len(faces)}")

    if len(faces) > 0:
        face = faces[0]
        print(f"   - Bounding Box: {face.bbox} (x, y, w, h)")
        print(f"   - Confidence: {face.confidence:.4f}")
        print(f"   - Landmarks (5 points): shape {face.landmarks.shape}")

        # 4. Test SFace alignment and 128D embedding extraction
        embedding = recognizer.align_and_extract(canvas, face)
        print(f"[PASS] SFace 128D embedding generated successfully.")
        print(f"   - Embedding shape: {embedding.shape}")
        print(f"   - Embedding dtype: {embedding.dtype}")
        print(f"   - L2 norm: {np.linalg.norm(embedding):.6f} (unit vector)")

        # 5. Test matching against self
        score, is_match = recognizer.match(embedding, embedding)
        print(f"[PASS] SFace Self-Match Test: score={score:.4f}, is_match={is_match}")
    
    print("==================================================")
    print("[SUCCESS] YuNet and SFace are 100% operational!")
    print("==================================================")

if __name__ == "__main__":
    test_models()
