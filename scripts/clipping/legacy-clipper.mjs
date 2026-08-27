#!/usr/bin/env node

/**
 * Compatibility renderer for the original BertClipsHub generators.
 *
 * Usage:
 *   node legacy-clipper.mjs <url> <count> <outDir> <workDir> [transcribe.py] [facecrop.py]
 *
 * If workDir/source.mp4 already exists (the normal Twitch path), the download is
 * skipped. Outputs are named v2_clip_N.mp4 and the face-quality line is kept
 * compatible with autopilot-gen.mjs and viral-clips.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [url, rawCount, rawOutDir, rawWorkDir, rawTranscribe, rawFacecrop] = process.argv.slice(2);

if (!url || !rawOutDir || !rawWorkDir) {
  console.error("usage: legacy-clipper.mjs <url> <count> <outDir> <workDir> [transcribe.py] [facecrop.py]");
  process.exit(2);
}

const count = Math.max(1, Math.min(12, Number(rawCount) || 1));
const outDir = path.resolve(rawOutDir);
const workDir = path.resolve(rawWorkDir);
const transcribeScript = path.resolve(rawTranscribe || path.join(HERE, "transcribe.py"));
const facecropScript = path.resolve(rawFacecrop || path.join(HERE, "facecrop.py"));
const python = String(process.env.BERTCLIPS_PYTHON || process.env.CLIPPING_PYTHON_BIN || "").trim()
  || (process.platform === "win32" ? "py" : "python3");
const ffmpeg = String(process.env.CLIPPING_FFMPEG_BIN || process.env.FFMPEG_BIN || "ffmpeg");
const ffprobe = String(process.env.CLIPPING_FFPROBE_BIN || process.env.FFPROBE_BIN || "ffprobe");
const wholeMode = process.env.CLIP_WHOLE === "1";
const fullMode = process.env.CLIP_MODE === "full";
const wholeMax = Math.max(15, Math.min(90, Number(process.env.CLIP_WHOLE_MAX) || 68));

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) console.error(`${cmd}: ${result.error.message}`);
  if (result.status !== 0 && result.stderr) console.error(result.stderr.trim().slice(-2000));
  return result;
}

function lastJson(stdout) {
  const line = String(stdout || "").split(/\r?\n/).reverse().find((entry) => entry.trim().startsWith("{"));
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}

function downloadSource() {
  const source = path.join(workDir, "source.mp4");
  if (fs.existsSync(source) && fs.statSync(source).size > 1024) return source;
  const result = run(python, [
    "-m", "yt_dlp", "--js-runtimes", "node", "--no-playlist",
    "--remote-components", "ejs:github",
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
    "--no-part", "-o", source, url,
  ], { timeout: 20 * 60 * 1000 });
  return result.status === 0 && fs.existsSync(source) ? source : null;
}

function durationOf(file) {
  const result = run(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ], { timeout: 30_000 });
  const duration = Number(String(result.stdout || "").trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function dimensionsOf(file) {
  const result = run(ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x", file,
  ], { timeout: 30_000 });
  const [width, height] = String(result.stdout || "").trim().split("x").map(Number);
  return width > 0 && height > 0 ? { width, height } : { width: 1920, height: 1080 };
}

function transcribe(file) {
  const result = run(python, [transcribeScript, file, process.env.CLIPPING_WHISPER_MODEL || "base"], {
    timeout: 30 * 60 * 1000,
  });
  const transcript = lastJson(result.stdout);
  if (!transcript || transcript.error || !Array.isArray(transcript.segments)) {
    if (transcript?.error) console.error(transcript.error);
    return null;
  }
  return transcript;
}

function scoreText(text) {
  const strong = /\b(secret|never|always|best|worst|crazy|insane|truth|mistake|money|million|win|lose|hate|love|why|how|actually|problem|changed|risk|believe)\b/gi;
  const hits = text.match(strong)?.length || 0;
  return hits * 5 + (text.match(/[!?]/g)?.length || 0) * 3 + Math.min(10, text.length / 80);
}

function chooseWindows(transcript, duration) {
  if (wholeMode) return [{ start: 0, end: Math.min(duration, wholeMax) }];
  const clipLength = Math.min(55, Math.max(25, duration / Math.max(2, count * 1.5)));
  const segments = transcript.segments || [];
  const candidates = [];
  const usableStart = duration > 120 ? 15 : 0;
  const usableEnd = duration > 120 ? duration - 15 : duration;
  const step = Math.max(12, clipLength / 2);
  for (let start = usableStart; start + 15 <= usableEnd; start += step) {
    const end = Math.min(usableEnd, start + clipLength);
    const text = segments.filter((s) => s.end >= start && s.start <= end).map((s) => s.text).join(" ");
    candidates.push({ start, end, score: scoreText(text) });
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((pick) => Math.abs(pick.start - candidate.start) < clipLength * 0.75)) continue;
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected.sort((a, b) => a.start - b.start);
}

function faceInfo(file, start, duration) {
  if (!fs.existsSync(facecropScript)) return { centerX: null, faceWidth: 0, found: 0, sampled: 18 };
  const result = run(python, [facecropScript, file, String(start), String(duration), "18"], { timeout: 180_000 });
  const info = lastJson(result.stdout) || {};
  return {
    centerX: typeof info.centerX === "number" ? info.centerX : null,
    faceWidth: typeof info.faceWidth === "number" ? info.faceWidth : 0,
    found: Number(info.found) || 0,
    sampled: Number(info.sampled) || 18,
  };
}

function cleanToken(word) {
  return String(word || "").replace(/\s+/g, "").replace(/^[^0-9A-Za-z$(]+/, "").replace(/[^0-9A-Za-z.!?%)]+$/, "");
}

function assTime(raw) {
  const value = Math.max(0, raw);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  const centis = Math.floor((value - Math.floor(value)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function buildAss(words, start, end) {
  const header = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cap,Poppins ExtraBold,112,&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,0,0,0,0,100,100,0,0,1,8,3,5,90,90,60,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const activeWords = (words || [])
    .filter((word) => word.start >= start - 0.05 && word.start < end)
    .map((word) => ({ ...word, word: cleanToken(word.word) }))
    .filter((word) => /[0-9A-Za-z]/.test(word.word));
  for (let index = 0; index < activeWords.length; index++) {
    const current = activeWords[index];
    const next = activeWords[index + 1];
    const eventStart = Math.max(0, current.start - start);
    const eventEnd = Math.min(end - start, next ? next.start - start : current.end - start + 0.3);
    if (eventEnd <= eventStart) continue;
    const groupStart = index - (index % 3);
    const text = activeWords.slice(groupStart, groupStart + 3).map((word, groupIndex) => {
      const token = word.word.replace(/[{}\\]/g, "").toUpperCase();
      return groupIndex === index - groupStart ? `{\\c&H00E0FF&}${token}{\\c&HFFFFFF&}` : token;
    }).join(" ");
    header.push(`Dialogue: 1,${assTime(eventStart)},${assTime(eventEnd)},Cap,,0,0,0,,{\\an5\\pos(540,1267)}${text}`);
  }
  return `${header.join("\n")}\n`;
}

function cropFilter(info, dims) {
  if (fullMode) {
    return "split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28[blur];[fg]scale=1080:1920:force_original_aspect_ratio=decrease[front];[blur][front]overlay=(W-w)/2:(H-h)/2";
  }
  let cropWidth = Math.round(dims.height * 9 / 16);
  if (cropWidth % 2) cropWidth += 1;
  if (cropWidth >= dims.width) return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const center = info.centerX == null ? 0.5 : info.centerX;
  let x = Math.round(center * dims.width - cropWidth / 2);
  x = Math.max(0, Math.min(dims.width - cropWidth, x));
  if (x % 2) x -= 1;
  return `crop=${cropWidth}:${dims.height}:${x}:0,scale=1080:1920:flags=lanczos,setsar=1`;
}

const source = downloadSource();
if (!source) process.exit(3);
const transcript = transcribe(source);
if (!transcript) process.exit(4);
const duration = Number(transcript.duration) || durationOf(source);
const windows = chooseWindows(transcript, duration);
const dims = dimensionsOf(source);
let rendered = 0;

for (let index = 0; index < windows.length; index++) {
  const window = windows[index];
  const clipDuration = Math.max(1, window.end - window.start);
  const info = faceInfo(source, window.start, clipDuration);
  const assName = `v2_clip_${index}.ass`;
  fs.writeFileSync(path.join(workDir, assName), buildAss(transcript.words, window.start, window.end));
  const output = path.join(outDir, `v2_clip_${index}.mp4`);
  const videoFilter = `${cropFilter(info, dims)},ass=${assName}`;
  const result = run(ffmpeg, [
    "-ss", String(window.start), "-i", source, "-t", String(clipDuration),
    "-vf", videoFilter,
    "-af", "acompressor=threshold=-18dB:ratio=3:attack=5:release=120,loudnorm=I=-14:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-profile:v", "high", "-level", "4.2", "-r", "60", "-g", "120", "-maxrate", "8M", "-bufsize", "12M",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-y", output,
  ], { cwd: workDir, timeout: 15 * 60 * 1000 });
  if (result.status !== 0 || !fs.existsSync(output)) continue;
  rendered++;
  const confidence = info.sampled ? info.found / info.sampled : 0;
  console.log(`v2_clip_${index}: face cx=${info.centerX ?? "center"} (found ${info.found} w=${info.faceWidth.toFixed(4)} conf=${confidence.toFixed(3)})`);
}

console.log(`rendered ${rendered}/${windows.length} clip(s)`);
// The parent generator has everything it needs in outDir once this process exits.
// Source downloads are much larger than final clips, so never leave them behind on
// the small production droplet. Also discard generated subtitle scratch files.
try { fs.rmSync(source, { force: true }); } catch {}
try {
  for (const file of fs.readdirSync(workDir)) {
    if (file.endsWith(".ass")) fs.rmSync(path.join(workDir, file), { force: true });
  }
} catch {}
process.exit(rendered > 0 ? 0 : 5);
