import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { env } from "@/lib/core/env";

/**
 * lib/core/storage.ts — tiny atomic JSON store (standalone bertclips build).
 *
 * Files live under BERTOS_RUNTIME_DIR (default `.bertos-runtime`). Reads are safe on
 * missing/corrupt files (fall back to `fallback`, never throw). Writes are atomic
 * (temp file + rename). `updateJson` serializes read-modify-write PER FILE so two
 * concurrent writers cannot lose each other's updates — the invariant the clipping
 * store relies on for the cash-truth earnings ledger.
 */

function runtimeDir(): string {
  return path.resolve(process.cwd(), env.runtimeDir());
}

/** Resolve a store name to an absolute path, refusing path traversal. */
function resolveStorePath(name: string): string {
  const safe = name.endsWith(".json") ? name : `${name}.json`;
  const base = runtimeDir();
  const full = path.resolve(base, safe);
  if (full !== path.join(base, path.basename(safe))) {
    throw new Error(`Invalid storage name: ${name}`);
  }
  return full;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(runtimeDir(), { recursive: true });
}

/** Read a JSON store. Returns `fallback` on a missing/corrupt file (never throws). */
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(resolveStorePath(name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Atomically write a JSON store (temp file + rename). */
export async function writeJson<T>(name: string, value: T): Promise<void> {
  await ensureDir();
  const file = resolveStorePath(name);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// Per-file promise queue: serialize read-modify-write so concurrent updaters chain
// instead of racing on the same file.
const chains = new Map<string, Promise<unknown>>();

/**
 * Serialized read-modify-write. `updater` receives the current value (or `fallback`)
 * and returns the next value, which is atomically written. Returns the written value.
 */
export async function updateJson<T>(name: string, fallback: T, updater: (cur: T) => T): Promise<T> {
  const prev = chains.get(name) ?? Promise.resolve();
  const next = prev.then(async () => {
    const cur = await readJson<T>(name, fallback);
    const updated = updater(cur);
    await writeJson(name, updated);
    return updated;
  });
  // Keep the chain alive even if this link rejects, so later updates still run.
  chains.set(name, next.catch(() => undefined));
  return next;
}
