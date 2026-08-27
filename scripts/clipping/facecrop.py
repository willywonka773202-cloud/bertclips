#!/usr/bin/env python3
"""
scripts/clipping/facecrop.py - find where the speaker is, so a 9:16 crop keeps the
face in frame instead of blindly center-cropping.

Samples frames across a clip window, runs OpenCV's YuNet (FaceDetectorYN) DNN face
detector on each, and prints the MEDIAN normalized horizontal face center (0..1) on
stdout as JSON:
  {"centerX": 0.63, "found": 14, "sampled": 18}
If OpenCV / the model is missing, no face is confidently found, or anything fails, it
prints {"centerX": null, ...} so the engine falls back to a plain center crop and
NEVER hard-fails. This is an OPTIONAL enhancement, not a required dependency.

Usage: python facecrop.py <video> <startSec> <durSec> [samples] [modelPath]
"""

import json
import os
import sys

MODEL_REL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_detection_yunet_2023mar.onnx")


def main() -> int:
    if len(sys.argv) < 4:
        print(json.dumps({"centerX": None, "error": "usage: facecrop.py <video> <start> <dur> [samples] [model]"}))
        return 0
    video = sys.argv[1]
    try:
        start = float(sys.argv[2])
        dur = float(sys.argv[3])
    except ValueError:
        print(json.dumps({"centerX": None, "error": "bad start/dur"}))
        return 0
    samples = int(sys.argv[4]) if len(sys.argv) > 4 else 18
    model = sys.argv[5] if len(sys.argv) > 5 else MODEL_REL

    try:
        import cv2  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"centerX": None, "error": f"cv2 unavailable: {exc}"}))
        return 0

    if not os.path.isfile(model):
        print(json.dumps({"centerX": None, "error": f"model missing: {model}"}))
        return 0

    try:
        detector = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.6, 0.3, 5000)
        cap = cv2.VideoCapture(video)
        if not cap.isOpened():
            print(json.dumps({"centerX": None, "error": "cannot open video"}))
            return 0
        centers = []
        widths = []
        for i in range(samples):
            t = start + dur * ((i + 0.5) / samples)
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            h, w = frame.shape[:2]
            scale = 640.0 / w if w > 640 else 1.0
            small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
            sh, sw = small.shape[:2]
            detector.setInputSize((sw, sh))
            _, faces = detector.detect(small)
            if faces is None or len(faces) == 0:
                continue
            # Pick the highest-confidence face; its box is [x, y, w, h, ...landmarks, score].
            best = max(faces, key=lambda f: float(f[14]))
            cx = (float(best[0]) + float(best[2]) / 2.0) / float(sw)
            centers.append(min(1.0, max(0.0, cx)))
            widths.append(min(1.0, max(0.0, float(best[2]) / float(sw))))
        cap.release()

        if len(centers) < max(2, samples // 5):
            print(json.dumps({"centerX": None, "found": len(centers), "sampled": samples}))
            return 0
        centers.sort()
        widths.sort()
        med = centers[len(centers) // 2]
        med_width = widths[len(widths) // 2]
        print(json.dumps({"centerX": round(med, 4), "faceWidth": round(med_width, 4), "found": len(centers), "sampled": samples}))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"centerX": None, "error": f"facecrop failed: {exc}"}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
