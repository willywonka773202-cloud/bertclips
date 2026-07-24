import "server-only";

import { run } from "./proc";
import { ffmpegBin, ffprobeBin, pythonBin } from "./paths";
import type { DepStatus, DepsReport } from "@/types/clipping";

/**
 * lib/clipping/deps.ts — health check for the FREE local clip engine.
 *
 * The engine shells out to ffmpeg (cut/crop/burn), yt-dlp (download), and
 * faster-whisper (transcribe). This probes each one so the cockpit can show an
 * honest setup card and the engine can refuse cleanly (with the fix command)
 * instead of hard-failing mid-render with a raw ENOENT.
 */

const PROBE_TIMEOUT_MS = 15_000;

async function probe(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await run(cmd, args, { timeoutMs: PROBE_TIMEOUT_MS });
    const out = `${r.stdout}\n${r.stderr}`.trim();
    return { ok: r.code === 0, out };
  } catch {
    return { ok: false, out: "" };
  }
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
}

export async function checkClipDeps(): Promise<DepsReport> {
  const py = pythonBin();
  const [ff, probeFf, python, ytdlp, whisper, opencv] = await Promise.all([
    probe(ffmpegBin(), ["-version"]),
    probe(ffprobeBin(), ["-version"]),
    probe(py, ["--version"]),
    probe(py, ["-m", "yt_dlp", "--version"]),
    probe(py, ["-c", "import faster_whisper; print(faster_whisper.__version__)"]),
    probe(py, ["-c", "import cv2; print(cv2.__version__)"]),
  ]);

  const deps: DepStatus[] = [
    {
      id: "ffmpeg",
      label: "ffmpeg",
      ok: ff.ok,
      version: ff.ok ? firstLine(ff.out).replace(/^ffmpeg version /, "").split(" ")[0] : undefined,
      hint: ff.ok ? undefined : "Install ffmpeg (winget install Gyan.FFmpeg) and put it on PATH.",
    },
    {
      id: "ffprobe",
      label: "ffprobe",
      ok: probeFf.ok,
      version: probeFf.ok ? firstLine(probeFf.out).replace(/^ffprobe version /, "").split(" ")[0] : undefined,
      hint: probeFf.ok ? undefined : "ffprobe ships with ffmpeg — install the full ffmpeg build.",
    },
    {
      id: "python",
      label: "Python 3",
      ok: python.ok,
      version: python.ok ? firstLine(python.out).replace(/^Python /, "") : undefined,
      hint: python.ok ? undefined : "Install Python 3 (winget install Python.Python.3.12).",
    },
    {
      id: "yt-dlp",
      label: "yt-dlp",
      ok: ytdlp.ok,
      version: ytdlp.ok ? firstLine(ytdlp.out) : undefined,
      hint: ytdlp.ok ? undefined : "pip install yt-dlp (py -m pip install --user yt-dlp).",
    },
    {
      id: "faster-whisper",
      label: "faster-whisper",
      ok: whisper.ok,
      version: whisper.ok ? firstLine(whisper.out) : undefined,
      hint: whisper.ok ? undefined : "pip install faster-whisper (py -m pip install --user faster-whisper).",
    },
    {
      // OPTIONAL: enables face-aware cropping (keeps the speaker centered). Missing it
      // just falls back to a plain center crop — it never blocks a render.
      id: "opencv",
      label: "OpenCV (face-aware crop)",
      ok: opencv.ok,
      version: opencv.ok ? firstLine(opencv.out) : undefined,
      hint: opencv.ok ? undefined : "Optional: pip install opencv-python-headless for speaker-centered crops.",
      optional: true,
    },
  ];

  // engineReady gates on the REQUIRED deps only; optional ones (OpenCV) just enhance output.
  const engineReady = deps.filter((d) => !d.optional).every((d) => d.ok);
  return {
    ok: true,
    engineReady,
    deps,
    checkedAt: new Date().toISOString(),
  };
}
