import path from "node:path";
import os from "node:os";

/**
 * lib/clipping/paths.ts — where clip media + work files live, and how the free
 * engine's binaries are resolved.
 *
 * Media + work files live under a per-user ops dir (NOT the app tree), so a deploy's
 * `npm ci` / rebuild never wipes rendered clips, and the files persist across restarts
 * exactly like the Agentic snapshot. Binary names are overridable via env so a
 * different host (different Python launcher, a portable ffmpeg) can point them without
 * a code change.
 */

/** Root ops dir for clipping media + scratch work. Override with BERTAI_CLIPPING_DIR. */
export function clippingHomeDir(): string {
  const override = process.env.BERTAI_CLIPPING_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), "bert-ai-ops", "clipping");
}

/** Rendered, review-ready clips (served read-only via /api/clipping/media/[id]). */
export function clippingMediaDir(): string {
  return path.join(clippingHomeDir(), "media");
}

/** Scratch space for downloads + transcripts during a render (cleaned per job). */
export function clippingWorkDir(): string {
  return path.join(clippingHomeDir(), "work");
}

/** Absolute path to a clip's rendered mp4. */
export function clipFilePath(id: string): string {
  return path.join(clippingMediaDir(), `${id}.mp4`);
}

/**
 * The Python launcher. On Windows the bare `python` alias is often the Store stub,
 * so we default to the `py` launcher (which resolves the real interpreter). Override
 * with CLIPPING_PYTHON_BIN (e.g. an absolute python.exe or a venv).
 */
export function pythonBin(): string {
  const override = process.env.CLIPPING_PYTHON_BIN;
  if (override && override.trim()) return override.trim();
  return process.platform === "win32" ? "py" : "python3";
}

/** ffmpeg binary. Override with CLIPPING_FFMPEG_BIN / FFMPEG_BIN. */
export function ffmpegBin(): string {
  return (
    process.env.CLIPPING_FFMPEG_BIN?.trim() ||
    process.env.FFMPEG_BIN?.trim() ||
    "ffmpeg"
  );
}

/** ffprobe binary (ships with ffmpeg). Override with CLIPPING_FFPROBE_BIN. */
export function ffprobeBin(): string {
  return process.env.CLIPPING_FFPROBE_BIN?.trim() || "ffprobe";
}

/** The bundled faster-whisper transcription script (checked into the repo). */
export function transcribeScriptPath(): string {
  return path.resolve(process.cwd(), "scripts", "clipping", "transcribe.py");
}

/** The bundled OpenCV face-crop helper (checked into the repo, with its YuNet model). */
export function facecropScriptPath(): string {
  return path.resolve(process.cwd(), "scripts", "clipping", "facecrop.py");
}

/** The bundled caption fonts directory (Poppins-ExtraBold.ttf, checked into the repo). */
export function clipFontsDir(): string {
  return path.resolve(process.cwd(), "scripts", "clipping", "fonts");
}
