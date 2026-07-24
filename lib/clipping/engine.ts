import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { appendLog } from "@/lib/core/logging";
import { run } from "./proc";
import { checkClipDeps } from "./deps";
import { rankHighlights, type Highlight, type TranscriptSegment } from "./rank";
import {
  clipFilePath,
  clipFontsDir,
  clippingMediaDir,
  clippingWorkDir,
  facecropScriptPath,
  ffmpegBin,
  ffprobeBin,
  pythonBin,
  transcribeScriptPath,
} from "./paths";
import { addClips, bumpRenderCount, newId, readClippingStore, updateSource } from "./store";
import type { Clip, ClipAspect, ClipPlatform } from "@/types/clipping";

/**
 * lib/clipping/engine.ts — the FREE local clip engine.
 *
 * Pipeline: yt-dlp (download) -> faster-whisper (transcribe) -> free-brain highlight
 * ranking (rank.ts, with a deterministic fallback) -> ffmpeg (cut, crop to aspect,
 * burn word-timed captions). Output clips land in the review queue as status "review"
 * — nothing is ever posted automatically.
 *
 * Generation is CPU/credit work, so it is a GATED action (a user click / an explicit
 * cockpit start), NEVER the autonomous loop. Caps + the kill switch bound it. Every
 * external step runs via `run` (argument arrays, no shell) with a timeout.
 */

interface Word {
  start: number;
  end: number;
  word: string;
}

interface Transcript {
  duration: number;
  segments: TranscriptSegment[];
  words: Word[];
}

export interface GenerateInput {
  url: string;
  sourceId?: string;
  campaignId?: string | null;
  clipsNum?: number;
  aspect?: ClipAspect;
  subtitleFont?: string;
  platforms?: ClipPlatform[];
  signal?: AbortSignal;
}

export interface GenerateResult {
  ok: boolean;
  clips: Clip[];
  reason?: string;
}

// Shared yt-dlp args. `--js-runtimes node` is REQUIRED: modern YouTube extraction
// needs a JS runtime for signature deciphering, and Node is always present (the app
// runs on it) — without this, many videos fail with "Video unavailable".
const YT_DLP_BASE_ARGS = ["--js-runtimes", "node", "--no-playlist"] as const;

// YouTube now gates media URLs behind a JS "n-challenge" that a bare JS runtime can no
// longer solve on its own — every download 403s ("unable to download video data: HTTP
// Error 403: Forbidden") without an external challenge-solver. `--remote-components
// ejs:github` fetches yt-dlp's official EJS solver (cached after first use) so the
// signed media URLs resolve. Only the download needs it; the metadata probe does not.
const YT_DLP_DOWNLOAD_ARGS = ["--remote-components", "ejs:github"] as const;

const ASPECT_DIMS: Record<ClipAspect, { w: number; h: number; crop: string }> = {
  "9:16": { w: 1080, h: 1920, crop: "crop=ih*9/16:ih:(iw-ih*9/16)/2:0" },
  "1:1": { w: 1080, h: 1080, crop: "crop=ih:ih:(iw-ih)/2:0" },
  "16:9": { w: 1920, h: 1080, crop: "crop=iw:iw*9/16:0:(ih-iw*9/16)/2" },
};

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

function assTime(t: number): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${pad2(m)}:${pad2(sec)}.${pad2(cs)}`;
}

function sanitizeCaption(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ").trim();
}

/** Strip a stray leading punctuation token (e.g. a lone comma) and trailing punctuation
 *  except sentence enders, so a whisper token never renders as ",WORD". */
function cleanToken(w: string): string {
  return String(w).replace(/\s+/g, "").replace(/^[^0-9A-Za-z$(]+/, "").replace(/[^0-9A-Za-z.!?%)]+$/, "");
}
function hasAlnum(s: string): boolean {
  return /[0-9a-z]/i.test(s);
}

/**
 * Build the burned-in subtitle: smooth, POSITION-LOCKED word-by-word captions (the active
 * word lights up warm-yellow over white). Every line is drawn at one fixed point via
 * \an5\pos so the caption never bounces up/down between chunks. No top banner.
 *
 * IMPORTANT: the [Events] Format line MUST list MarginV. Omitting it (an old bug) makes
 * libass mis-parse every Dialogue field-by-field and prepend a stray comma to the text.
 */
function buildAss(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  font: string,
  dims: { w: number; h: number },
): string {
  const durTotal = clipEnd - clipStart;
  const capSize = Math.round(dims.h * 0.06);
  const capOutline = Math.max(5, Math.round(dims.h * 0.007));
  const capShadow = Math.max(1, Math.round(dims.h * 0.0016));
  // Lock every caption to one fixed point (middle-center anchor) so it never bounces.
  const lock = `{\\an5\\pos(${Math.round(dims.w / 2)},${Math.round(dims.h * 0.66)})}`;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${dims.w}`,
    `PlayResY: ${dims.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // White fill, thick black outline + soft shadow; anchored middle-center (\pos overrides).
    `Style: Cap,${font},${capSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,0,0,0,0,100,100,0,0,1,${capOutline},${capShadow},5,120,120,60,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events: string[] = [];
  const inWindow = words
    .filter((w) => w.start >= clipStart - 0.05 && w.start < clipEnd)
    .map((w) => ({ start: w.start, end: w.end, word: cleanToken(w.word) }))
    .filter((w) => w.word && hasAlnum(w.word));

  const GROUP = 3;
  for (let k = 0; k < inWindow.length; k++) {
    const cur = inWindow[k]!;
    const nextWord = inWindow[k + 1];
    const s = Math.max(0, cur.start - clipStart);
    // End exactly when the NEXT word begins (measured globally, across chunk boundaries)
    // so a caption is never still on screen when the next one appears; the final word of
    // the clip gets a short tail. This is what keeps captions from overlapping.
    const e = Math.min(durTotal, nextWord ? nextWord.start - clipStart : cur.end - clipStart + 0.3);
    if (e <= s) continue;
    const base = k - (k % GROUP);
    const grp = inWindow.slice(base, base + GROUP);
    const active = k - base;
    const text = grp
      .map((w, j) => {
        const t = sanitizeCaption(w.word).toUpperCase();
        return j === active ? `{\\c&H00E0FF&}${t}{\\c&HFFFFFF&}` : t; // active word warm-yellow
      })
      .join(" ");
    events.push(`Dialogue: 1,${assTime(s)},${assTime(e)},Cap,,0,0,0,,${lock}${text}`);
  }

  return `${header}\n${events.join("\n")}\n`;
}

/** Fetch title + duration cheaply (no download) so we can cap length + name the source. */
async function fetchMeta(url: string, signal?: AbortSignal): Promise<{ title?: string; duration?: number }> {
  const r = await run(pythonBin(), ["-m", "yt_dlp", ...YT_DLP_BASE_ARGS, "--skip-download", "--print", "%(title)s\n%(duration)s", url], {
    timeoutMs: 60_000,
    signal,
  });
  if (r.code !== 0) return {};
  const [title, dur] = r.stdout.trim().split(/\r?\n/);
  const duration = Number(dur);
  return { title: title?.trim() || undefined, duration: Number.isFinite(duration) ? duration : undefined };
}

/** Download the source into the work dir; return the produced file path. */
async function download(url: string, workDir: string, jobId: string, signal?: AbortSignal): Promise<string | null> {
  const outTemplate = path.join(workDir, `${jobId}.%(ext)s`);
  const r = await run(
    pythonBin(),
    [
      "-m",
      "yt_dlp",
      ...YT_DLP_BASE_ARGS,
      ...YT_DLP_DOWNLOAD_ARGS,
      "-f",
      "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format",
      "mp4",
      "--no-part",
      "-o",
      outTemplate,
      url,
    ],
    { timeoutMs: 15 * 60 * 1000, signal },
  );
  if (r.code !== 0) {
    await appendLog({ level: "warn", source: "clipping:download", message: r.stderr.slice(-400) });
    return null;
  }
  const files = await fs.readdir(workDir).catch(() => [] as string[]);
  const produced = files.find((f) => f.startsWith(`${jobId}.`));
  return produced ? path.join(workDir, produced) : null;
}

/** Transcribe with faster-whisper; parse the single JSON document from stdout. */
async function transcribe(videoPath: string, signal?: AbortSignal): Promise<Transcript | null> {
  const r = await run(pythonBin(), [transcribeScriptPath(), videoPath, "base"], {
    timeoutMs: 20 * 60 * 1000,
    signal,
  });
  const jsonLine = r.stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  if (!jsonLine) {
    await appendLog({ level: "warn", source: "clipping:transcribe", message: r.stderr.slice(-400) });
    return null;
  }
  try {
    const parsed = JSON.parse(jsonLine) as { error?: string; duration?: number; segments?: TranscriptSegment[]; words?: Word[] };
    if (parsed.error) {
      await appendLog({ level: "warn", source: "clipping:transcribe", message: parsed.error });
      return null;
    }
    return {
      duration: Number(parsed.duration) || 0,
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
    };
  } catch {
    return null;
  }
}

/** Probe the source's pixel dimensions (needed for face-aware crop math). */
async function probeDimensions(file: string, signal?: AbortSignal): Promise<{ w: number; h: number } | null> {
  const r = await run(
    ffprobeBin(),
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file],
    { timeoutMs: 30_000, signal },
  );
  const parts = r.stdout.trim().split("x");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/** Run the OPTIONAL face detector over a clip window; returns a normalized center-x
 *  (0..1) or null when OpenCV/the model is absent or no face is found. Never throws. */
async function faceCenterX(file: string, start: number, dur: number, signal?: AbortSignal): Promise<number | null> {
  try {
    const r = await run(pythonBin(), [facecropScriptPath(), file, String(start), String(dur), "18"], {
      timeoutMs: 120_000,
      signal,
    });
    const line = r.stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
    if (!line) return null;
    const j = JSON.parse(line) as { centerX?: number | null };
    return typeof j.centerX === "number" ? j.centerX : null;
  } catch {
    return null;
  }
}

/** ffmpeg crop expression for a clip. For 9:16 it centers the crop on the detected
 *  speaker; every other aspect (and any detection miss) uses the deterministic center
 *  crop — so a missing OpenCV never degrades output beyond the old behavior. */
async function cropExprFor(
  input: { file: string; start: number; end: number; aspect: ClipAspect; srcW: number; srcH: number },
  signal?: AbortSignal,
): Promise<string> {
  const fallback = ASPECT_DIMS[input.aspect].crop;
  if (input.aspect !== "9:16") return fallback;
  let cropW = Math.round((input.srcH * 9) / 16);
  if (cropW % 2) cropW += 1;
  if (cropW >= input.srcW) return fallback; // portrait/narrow source — center crop is right
  const cx = await faceCenterX(input.file, input.start, input.end - input.start, signal);
  if (cx == null) return fallback;
  let x = Math.round(cx * input.srcW - cropW / 2);
  x = Math.max(0, Math.min(input.srcW - cropW, x));
  if (x % 2) x -= 1;
  return `crop=${cropW}:${input.srcH}:${x}:0`;
}

/** Cut + crop + burn one clip. Runs ffmpeg with cwd=workDir so subtitle/input paths
 *  are relative basenames (no Windows drive-colon escaping in the filtergraph). */
async function renderClip(
  input: {
    videoFile: string;
    workDir: string;
    clipId: string;
    start: number;
    end: number;
    words: Word[];
    aspect: ClipAspect;
    font: string;
    cropExpr: string;
  },
  signal?: AbortSignal,
): Promise<boolean> {
  const dims = ASPECT_DIMS[input.aspect];
  const assName = `${input.clipId}.ass`;
  const ass = buildAss(input.words, input.start, input.end, input.font, dims);
  await fs.writeFile(path.join(input.workDir, assName), ass, "utf8");

  // Bundle the caption font next to the .ass so libass finds it via a RELATIVE fontsdir
  // (no drive-colon escaping in the filtergraph). Fail-soft: absent font -> system fallback.
  const fontsRel = "fonts";
  await fs.mkdir(path.join(input.workDir, fontsRel), { recursive: true }).catch(() => {});
  await fs
    .copyFile(path.join(clipFontsDir(), "Poppins-ExtraBold.ttf"), path.join(input.workDir, fontsRel, "Poppins-ExtraBold.ttf"))
    .catch(() => {});

  const inputRel = path.basename(input.videoFile);
  const outAbs = clipFilePath(input.clipId);
  const dur = Math.max(1, input.end - input.start);
  const vf = `${input.cropExpr},scale=${dims.w}:${dims.h}:flags=lanczos,setsar=1,ass=${assName}:fontsdir=${fontsRel}`;

  const r = await run(
    ffmpegBin(),
    [
      "-ss",
      String(input.start),
      "-i",
      inputRel,
      "-t",
      String(dur),
      "-vf",
      vf,
      // Spoken-word punch + platform loudness target (~-14 LUFS) so clips are not buried.
      "-af",
      "acompressor=threshold=-18dB:ratio=3:attack=5:release=120,loudnorm=I=-14:TP=-1.5:LRA=11",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-level",
      "4.2",
      "-r",
      "30",
      "-g",
      "60",
      "-maxrate",
      "8M",
      "-bufsize",
      "12M",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-y",
      outAbs,
    ],
    { cwd: input.workDir, timeoutMs: 10 * 60 * 1000, signal },
  );
  if (r.code !== 0) {
    await appendLog({ level: "warn", source: "clipping:render", message: r.stderr.slice(-400) });
    return false;
  }
  return true;
}

/**
 * Generate clips from one source. Enforces the kill switch + daily caps, then runs the
 * full free pipeline and files the results into the review queue. Long-running: callers
 * should start it and return; progress is written onto the source row.
 */
export async function generateClips(input: GenerateInput): Promise<GenerateResult> {
  const store = await readClippingStore();
  const { config, counters } = store;

  if (config.killSwitch) return { ok: false, clips: [], reason: "Kill switch is on." };
  if (counters.renders >= config.caps.maxRendersPerDay) {
    return { ok: false, clips: [], reason: `Daily render cap reached (${config.caps.maxRendersPerDay}).` };
  }

  const deps = await checkClipDeps();
  if (!deps.engineReady) {
    const missing = deps.deps.filter((d) => !d.ok).map((d) => d.label).join(", ");
    return { ok: false, clips: [], reason: `Engine not ready — missing: ${missing}. See the setup card.` };
  }

  const aspect = input.aspect ?? config.defaultAspect;
  const font = input.subtitleFont ?? config.defaultSubtitleFont;
  const platforms = input.platforms ?? ["tiktok", "instagram", "youtube"];
  const campaign = input.campaignId ? store.campaigns.find((c) => c.id === input.campaignId) ?? null : null;

  const dailyClipRoom = Math.max(0, config.caps.maxClipsPerDay - counters.clips);
  const clipsNum = Math.min(
    input.clipsNum ?? config.defaultClipsPerSource,
    config.caps.maxClipsPerSource,
    dailyClipRoom,
  );
  if (clipsNum < 1) return { ok: false, clips: [], reason: "Daily clip cap reached." };

  const jobId = newId("job").replace("job_", "");
  const workDir = clippingWorkDir();
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(clippingMediaDir(), { recursive: true });

  const progress = async (msg: string) => {
    if (input.sourceId) await updateSource(input.sourceId, { status: "clipping", progress: msg }).catch(() => {});
  };

  try {
    await bumpRenderCount();
    await progress("fetching source info");
    const meta = await fetchMeta(input.url, input.signal);
    if (meta.duration && meta.duration / 60 > config.caps.maxSourceMinutes) {
      const reason = `Source is ${Math.round(meta.duration / 60)} min — over the ${config.caps.maxSourceMinutes} min cap.`;
      if (input.sourceId) await updateSource(input.sourceId, { status: "failed", error: reason, progress: undefined });
      return { ok: false, clips: [], reason };
    }

    await progress("downloading");
    const videoFile = await download(input.url, workDir, jobId, input.signal);
    if (!videoFile) {
      const reason = "Download failed (yt-dlp). Check the URL / that the video is public.";
      if (input.sourceId) await updateSource(input.sourceId, { status: "failed", error: reason, progress: undefined });
      return { ok: false, clips: [], reason };
    }

    await progress("transcribing (first run downloads the whisper model)");
    const transcript = await transcribe(videoFile, input.signal);
    if (!transcript || !transcript.segments.length) {
      const reason = "Transcription produced no text.";
      if (input.sourceId) await updateSource(input.sourceId, { status: "failed", error: reason, progress: undefined });
      await fs.rm(videoFile, { force: true }).catch(() => {});
      return { ok: false, clips: [], reason };
    }
    const duration = transcript.duration || meta.duration || 0;

    await progress("ranking the best moments");
    const ranked = await rankHighlights({ segments: transcript.segments, duration, count: clipsNum, campaign });
    const highlights: Highlight[] = ranked.highlights.slice(0, clipsNum);

    const srcDims = await probeDimensions(videoFile, input.signal);

    const now = new Date().toISOString();
    const clips: Clip[] = [];
    for (let i = 0; i < highlights.length; i++) {
      const h = highlights[i];
      if (!h) continue;
      await progress(`rendering ${i + 1}/${highlights.length}`);
      const clipId = newId("clip");
      const cropExpr = srcDims
        ? await cropExprFor(
            { file: videoFile, start: h.start, end: h.end, aspect, srcW: srcDims.w, srcH: srcDims.h },
            input.signal,
          )
        : ASPECT_DIMS[aspect].crop;
      const ok = await renderClip(
        { videoFile, workDir, clipId, start: h.start, end: h.end, words: transcript.words, aspect, font, cropExpr },
        input.signal,
      );
      const excerpt = transcript.segments
        .filter((s) => s.start >= h.start - 1 && s.start <= h.end)
        .map((s) => s.text)
        .join(" ")
        .slice(0, 400);
      clips.push({
        id: clipId,
        sourceId: input.sourceId ?? jobId,
        sourceUrl: input.url,
        campaignId: input.campaignId ?? null,
        title: h.title || meta.title || "Clip",
        hook: h.hook,
        transcriptExcerpt: excerpt,
        startSec: h.start,
        endSec: h.end,
        durationSec: Math.round((h.end - h.start) * 10) / 10,
        viralityScore: h.score,
        reasons: h.reasons,
        aspect,
        subtitleFont: font,
        engine: "local",
        status: ok ? "review" : "failed",
        file: ok ? clipFilePath(clipId) : undefined,
        hashtags: h.hashtags,
        platforms,
        posts: [],
        createdAt: now,
        updatedAt: now,
        error: ok ? undefined : "ffmpeg render failed",
      });
    }

    await addClips(clips);
    await fs.rm(videoFile, { force: true }).catch(() => {});
    if (input.sourceId) await updateSource(input.sourceId, { status: "done", progress: undefined, title: meta.title });

    const made = clips.filter((c) => c.status === "review").length;
    await appendLog({ level: "info", source: "clipping:engine", message: `generated ${made}/${clips.length} clips from ${input.url} (brain=${ranked.usedBrain})` });
    return { ok: made > 0, clips, reason: made > 0 ? undefined : "All renders failed." };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (input.sourceId) await updateSource(input.sourceId, { status: "failed", error: reason, progress: undefined }).catch(() => {});
    await appendLog({ level: "error", source: "clipping:engine", message: reason });
    return { ok: false, clips: [], reason };
  }
}
