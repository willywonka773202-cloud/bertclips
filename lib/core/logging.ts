import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { env } from "@/lib/core/env";

/**
 * lib/core/logging.ts — appendLog (standalone build). Appends a structured entry to a
 * capped JSON log under the runtime dir and mirrors it to the console. Fail-soft:
 * logging never throws into a caller.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogInput {
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogEntry extends LogInput {
  id: string;
  ts: string;
}

const LOG_FILE = "logs";
const MAX_LOGS = 500;

/** Append a log entry. Returns the persisted entry. */
export async function appendLog(input: LogInput): Promise<LogEntry> {
  const entry: LogEntry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    level: input.level,
    source: input.source,
    message: input.message,
  };
  try {
    const dir = path.resolve(process.cwd(), env.runtimeDir());
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${LOG_FILE}.json`);
    let logs: LogEntry[] = [];
    try {
      logs = JSON.parse(await fs.readFile(file, "utf8")) as LogEntry[];
    } catch {
      logs = [];
    }
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    await fs.writeFile(file, JSON.stringify(logs, null, 2), "utf8");
  } catch {
    // best-effort
  }
  const line = `[${entry.ts}] ${entry.level} ${entry.source}: ${entry.message}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
  return entry;
}
