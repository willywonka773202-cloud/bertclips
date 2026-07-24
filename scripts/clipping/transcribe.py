#!/usr/bin/env python3
"""
scripts/clipping/transcribe.py - free, local transcription for the clip engine.

Uses faster-whisper (CTranslate2) on CPU to transcribe a video/audio file and emit
JSON on stdout: language, duration, phrase-level segments, and word-level timings
(so the engine can burn word-timed captions). All progress/log noise goes to stderr,
so stdout is a single clean JSON document the Node engine parses.

Usage: python transcribe.py <input_path> [model_size]
  model_size defaults to "base" (a good speed/accuracy tradeoff on CPU).
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: transcribe.py <input> [model]"}))
        return 2

    input_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"faster-whisper not importable: {exc}"}))
        return 3

    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            input_path,
            word_timestamps=True,
            vad_filter=True,
        )

        segs = []
        words = []
        for seg in segments:
            text = (seg.text or "").strip()
            if text:
                segs.append(
                    {"start": round(seg.start, 3), "end": round(seg.end, 3), "text": text}
                )
            for w in seg.words or []:
                token = (w.word or "").strip()
                if token:
                    words.append(
                        {"start": round(w.start, 3), "end": round(w.end, 3), "word": token}
                    )

        print(
            json.dumps(
                {
                    "language": info.language,
                    "duration": round(info.duration, 3),
                    "segments": segs,
                    "words": words,
                }
            )
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"transcription failed: {exc}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
