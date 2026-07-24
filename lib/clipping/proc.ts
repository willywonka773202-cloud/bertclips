import "server-only";

import { spawn } from "node:child_process";

/**
 * lib/clipping/proc.ts — a tiny, safe child-process runner for the clip engine.
 *
 * Uses spawn with an ARGUMENT ARRAY (never a shell string) so a source URL or title
 * can never be interpreted as a shell command. Enforces a timeout so a wedged
 * yt-dlp / ffmpeg can't hang a render forever, and streams stdout lines to an
 * optional callback so the cockpit can show live progress.
 */

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  /** Kill the process after this many ms (default 20 min). */
  timeoutMs?: number;
  /** Called with each stdout line as it arrives (live progress). */
  onStdoutLine?: (line: string) => void;
  /** Called with each stderr line (ffmpeg/yt-dlp report progress on stderr). */
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      signal: opts.signal,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const pump = (buf: string, onLine?: (l: string) => void, isErr = false): string => {
      if (isErr) stderr += buf;
      else stdout += buf;
      if (!onLine) return "";
      return buf;
    };

    let stdoutTail = "";
    let stderrTail = "";
    const emitLines = (chunk: string, tailKey: "out" | "err") => {
      const prev = tailKey === "out" ? stdoutTail : stderrTail;
      const combined = prev + chunk;
      const parts = combined.split(/\r?\n/);
      const tail = parts.pop() ?? "";
      if (tailKey === "out") stdoutTail = tail;
      else stderrTail = tail;
      const cb = tailKey === "out" ? opts.onStdoutLine : opts.onStderrLine;
      if (cb) for (const line of parts) if (line.trim()) cb(line);
    };

    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      pump(s, opts.onStdoutLine, false);
      emitLines(s, "out");
    });
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      pump(s, opts.onStderrLine, true);
      emitLines(s, "err");
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on("error", (err) => {
      stderr += `\n${err instanceof Error ? err.message : String(err)}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
